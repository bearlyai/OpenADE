/**
 * RepoManager
 *
 * Manages repository state and operations using RepoStore:
 * - Repository CRUD
 * - In-memory git info cache (fetched on-demand, not persisted)
 */

import { computed, makeAutoObservable, runInAction } from "mobx"
import { OPENADE_METHOD, type OpenADEMethod } from "../../../../openade-client/src"
import type { OpenADERepoCreateRequest, OpenADETaskGitChangedFile } from "../../../../openade-module/src"
import { type BranchInfo, type GitFileInfo, type GitSummaryResponse, gitApi } from "../../electronAPI/git"
import type { Repo } from "../../types"
import type { CodeStore } from "../store"

/** Git info - computed at runtime, not persisted */
export interface GitInfo {
    isGitRepo: boolean
    repoRoot: string
    relativePath: string
    mainBranch: string
    hasGhCli: boolean
}

export function projectPathFromGitInfo(gitInfo: GitInfo): string {
    const repoRoot = gitInfo.repoRoot.replace(/[\\/]+$/, "")
    const relativePath = gitInfo.relativePath.replace(/^[\\/]+/, "").replace(/[\\/]+$/, "")
    return relativePath ? `${repoRoot}/${relativePath}` : repoRoot
}

function emptyGitSummary(): GitSummaryResponse {
    return {
        branch: null,
        headCommit: "",
        ahead: null,
        hasChanges: false,
        staged: { files: [], stats: { filesChanged: 0, insertions: 0, deletions: 0 } },
        unstaged: { files: [], stats: { filesChanged: 0, insertions: 0, deletions: 0 } },
        untracked: [],
    }
}

function gitSummaryFiles(files: OpenADETaskGitChangedFile[]): GitFileInfo[] {
    return files.map((file) => ({
        ...file,
        binary: file.binary ?? false,
    }))
}

export class RepoManager {
    reposLoading = false
    // In-memory cache (cleared on app restart, or when repo.path changes)
    private gitInfoCache: Map<string, GitInfo | null> = new Map()
    private gitInfoInFlight: Map<string, Promise<GitInfo | null>> = new Map()

    constructor(private store: CodeStore) {
        makeAutoObservable(this, {
            repos: computed,
        })
    }

    // ==================== Computed from RepoStore ====================

    get repos(): Repo[] {
        const runtimeProjectProjection = this.store.getRuntimeProductProjectProjection()
        if (runtimeProjectProjection) {
            return runtimeProjectProjection.map((item) => ({
                id: item.id,
                name: item.name,
                path: item.path,
                createdBy: this.store.currentUser,
                createdAt: "",
                updatedAt: "",
                archived: item.archived,
            }))
        }

        if (!this.store.repoStore) return []
        return this.store.repoStore.repos.all().map((item) => ({
            id: item.id,
            name: item.name,
            path: item.path,
            createdBy: item.createdBy,
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
            archived: item.archived,
        }))
    }

    // ==================== CRUD Operations ====================

    getRepo(id: string): Repo | undefined {
        return this.repos.find((r) => r.id === id)
    }

    async addRepo(params: Pick<OpenADERepoCreateRequest, "name" | "path" | "createDirectory" | "initializeGit">): Promise<Repo | null> {
        return this.createRepo(params)
    }

    private canUseProductMethod(method: OpenADEMethod): boolean {
        return this.store.canUseProductMethod(method)
    }

    private async canUseProductMethodAfterConnect(method: OpenADEMethod): Promise<boolean> {
        return this.store.canUseProductMethodAfterConnect(method)
    }

    private async canUseRuntimeOwnedProductMethod(method: OpenADEMethod): Promise<boolean> {
        if (this.store.usesCoreOwnedProductRuntime()) return this.canUseProductMethodAfterConnect(method)
        if (this.store.shouldUseRuntimeProductAPI()) return this.canUseProductMethod(method)
        return this.canUseProductMethodAfterConnect(method)
    }

    private get productRuntimeOwnsHostReads(): boolean {
        return this.store.shouldUseRuntimeProductAPI() || this.store.usesCoreOwnedProductRuntime()
    }

    private get productRuntimeOwnsRepoMutations(): boolean {
        return this.store.shouldUseRuntimeProductAPI() || this.store.usesCoreOwnedProductRuntime()
    }

    private hasRepoMutationBackend(): boolean {
        return Boolean(this.store.repoStore) || this.productRuntimeOwnsRepoMutations
    }

    private async canUseRepoMutationMethod(method: OpenADEMethod): Promise<boolean> {
        if (!this.productRuntimeOwnsRepoMutations) return this.canUseProductMethod(method)
        return this.canUseRuntimeOwnedProductMethod(method)
    }

    private shouldRefreshLegacyRepoAfterMutation(): boolean {
        return !this.store.shouldUseRuntimeProductAPI() && !this.store.usesCoreOwnedProductRuntime()
    }

    async createRepo(params: Pick<OpenADERepoCreateRequest, "name" | "path" | "createDirectory" | "initializeGit">): Promise<Repo | null> {
        if (!this.hasRepoMutationBackend()) return null
        if (!(await this.canUseRepoMutationMethod(OPENADE_METHOD.repoCreate))) return null

        const result = await this.store.createProductRepo({
            name: params.name,
            path: params.path,
            createdBy: this.store.currentUser,
            createDirectory: params.createDirectory,
            initializeGit: params.initializeGit,
        })

        const repo = this.getRepo(result.repoId)
        if (repo || this.productRuntimeOwnsRepoMutations) return repo ?? null

        if (this.shouldRefreshLegacyRepoAfterMutation()) await this.store.refreshProductStateAfterRepoMutation()
        return this.getRepo(result.repoId) ?? null
    }

    async updateRepo(id: string, updates: Partial<Pick<Repo, "name" | "path">> & { initializeGit?: boolean }): Promise<Repo | null> {
        if (!this.hasRepoMutationBackend()) return null
        if (!(await this.canUseRepoMutationMethod(OPENADE_METHOD.repoUpdate))) return null

        // Clear git info cache if path changed
        if (updates.path !== undefined) {
            this.clearGitInfoCache(id)
        }

        await this.store.updateProductRepo({ repoId: id, ...updates })
        if (this.shouldRefreshLegacyRepoAfterMutation()) await this.store.refreshProductStateAfterRepoMutation()

        const repo = this.getRepo(id)
        if (repo || this.productRuntimeOwnsRepoMutations) return repo ?? null

        if (this.shouldRefreshLegacyRepoAfterMutation()) await this.store.refreshProductStateAfterRepoMutation()
        return this.getRepo(id) ?? null
    }

    async setRepoArchived(id: string, archived: boolean): Promise<void> {
        if (!this.hasRepoMutationBackend()) return
        if (!(await this.canUseRepoMutationMethod(OPENADE_METHOD.repoUpdate))) return
        await this.store.updateProductRepo({ repoId: id, archived })
        if (this.shouldRefreshLegacyRepoAfterMutation()) {
            await this.store.refreshProductStateAfterRepoMutation()
        }
    }

    async removeRepo(id: string): Promise<boolean> {
        return this.deleteRepo(id)
    }

    async deleteRepo(id: string): Promise<boolean> {
        if (!this.hasRepoMutationBackend()) return false
        if (!(await this.canUseRepoMutationMethod(OPENADE_METHOD.repoDelete))) return false

        // Clean up cache
        this.clearGitInfoCache(id)

        await this.store.deleteProductRepo({ repoId: id })
        if (this.shouldRefreshLegacyRepoAfterMutation()) await this.store.refreshProductStateAfterRepoMutation()
        return true
    }

    // ==================== Git Info (In-Memory Cache) ====================

    /**
     * Get git info for a repo, fetching from Electron if not cached.
     * Returns null if the directory is not a git repo.
     */
    async getGitInfo(repoId: string): Promise<GitInfo | null> {
        const repo = this.getRepo(repoId)
        if (!repo && !this.productRuntimeOwnsHostReads) return null
        if (this.productRuntimeOwnsHostReads) {
            const canRead = await this.canUseRuntimeOwnedProductMethod(OPENADE_METHOD.projectGitInfoRead)
            if (!canRead) return null
        }

        // Check cache
        if (this.gitInfoCache.has(repoId)) {
            return this.gitInfoCache.get(repoId) ?? null
        }

        const existing = this.gitInfoInFlight.get(repoId)
        if (existing) return existing

        const useRuntimeProductAPI = this.productRuntimeOwnsHostReads || this.store.shouldUseRuntimeProductAPI()
        const request = this.loadGitInfo({ repoId, repoPath: repo?.path ?? "", useRuntimeProductAPI }).finally(() => {
            runInAction(() => {
                this.gitInfoInFlight.delete(repoId)
            })
        })
        runInAction(() => {
            this.gitInfoInFlight.set(repoId, request)
        })
        return request
    }

    private async loadGitInfo({
        repoId,
        repoPath,
        useRuntimeProductAPI,
    }: {
        repoId: string
        repoPath: string
        useRuntimeProductAPI: boolean
    }): Promise<GitInfo | null> {
        try {
            const response = useRuntimeProductAPI
                ? await this.store.readProductProjectGitInfo({ repoId })
                : await gitApi.isGitDirectory({ directory: repoPath })
            const gitInfo: GitInfo | null =
                "isGitRepo" in response
                    ? response.isGitRepo
                        ? {
                              isGitRepo: true,
                              repoRoot: response.repoRoot,
                              relativePath: response.relativePath,
                              mainBranch: response.mainBranch,
                              hasGhCli: response.hasGhCli,
                          }
                        : null
                    : response.isGitDirectory
                      ? {
                            isGitRepo: true,
                            repoRoot: response.repoRoot,
                            relativePath: response.relativePath,
                            mainBranch: response.mainBranch,
                            hasGhCli: response.hasGhCli,
                        }
                      : null

            runInAction(() => {
                this.gitInfoCache.set(repoId, gitInfo)
            })
            return gitInfo
        } catch (err) {
            console.error(`[RepoManager] Failed to detect git info for ${repoId}:`, err)
            runInAction(() => {
                this.gitInfoCache.set(repoId, null)
            })
            return null
        }
    }

    /** Check if git info is cached (without fetching) */
    getGitInfoSync(repoId: string): GitInfo | null | undefined {
        return this.gitInfoCache.get(repoId)
    }

    /** Clear cached git info for a repo */
    clearGitInfoCache(repoId: string): void {
        runInAction(() => {
            this.gitInfoCache.delete(repoId)
            this.gitInfoInFlight.delete(repoId)
        })
    }

    /**
     * Re-check gh CLI availability and update the cached git info.
     * Returns the fresh hasGhCli value.
     */
    async refreshGhCliStatus(repoId: string): Promise<boolean> {
        if (this.productRuntimeOwnsHostReads) {
            const canRead = await this.canUseRuntimeOwnedProductMethod(OPENADE_METHOD.projectGitInfoRead)
            if (!canRead) return false
        }

        try {
            const useRuntimeProductAPI = this.productRuntimeOwnsHostReads || this.store.shouldUseRuntimeProductAPI()
            const hasGhCli = useRuntimeProductAPI
                ? await this.store.readProductProjectGitInfo({ repoId }).then((result) => (result.isGitRepo === true ? result.hasGhCli : false))
                : await gitApi.checkGhCli().then((result) => result.hasGhCli)

            // Update the cached git info entry if it exists
            const cached = this.gitInfoCache.get(repoId)
            if (cached) {
                runInAction(() => {
                    this.gitInfoCache.set(repoId, { ...cached, hasGhCli })
                })
            }

            return hasGhCli
        } catch (err) {
            console.error(`[RepoManager] Failed to refresh gh CLI status for ${repoId}:`, err)
            return false
        }
    }

    // ==================== Git Operations ====================

    /**
     * List branches for a repo.
     * Legacy host reads require git info first; product reads resolve scope server-side.
     */
    async listBranches(
        repoId: string,
        { includeRemote = false }: { includeRemote?: boolean } = {}
    ): Promise<{
        branches: BranchInfo[]
        defaultBranch: string
    }> {
        if (this.productRuntimeOwnsHostReads) {
            const canRead = await this.canUseRuntimeOwnedProductMethod(OPENADE_METHOD.projectGitBranchesRead)
            if (!canRead) return { branches: [], defaultBranch: "main" }
            const result = await this.store.readProductProjectGitBranches({ repoId, includeRemote })
            return {
                branches: result.branches,
                defaultBranch: result.defaultBranch,
            }
        }

        const gitInfo = await this.getGitInfo(repoId)
        if (!gitInfo) {
            return { branches: [], defaultBranch: "main" }
        }

        if (!gitApi.isAvailable()) {
            return { branches: [], defaultBranch: gitInfo.mainBranch }
        }

        return gitApi.listBranches({
            repoDir: gitInfo.repoRoot,
            includeRemote,
        })
    }

    /**
     * Get git status for a repo.
     * Legacy host reads require git info first; product reads resolve scope server-side.
     */
    async getGitSummary(repoId: string): Promise<GitSummaryResponse> {
        if (this.productRuntimeOwnsHostReads) {
            const canRead = await this.canUseRuntimeOwnedProductMethod(OPENADE_METHOD.projectGitSummaryRead)
            if (!canRead) return emptyGitSummary()
            const result = await this.store.readProductProjectGitSummary({ repoId })
            return {
                branch: result.branch,
                headCommit: result.headCommit,
                ahead: result.ahead,
                hasChanges: result.hasChanges,
                staged: {
                    files: gitSummaryFiles(result.staged.files),
                    stats: result.staged.stats,
                },
                unstaged: {
                    files: gitSummaryFiles(result.unstaged.files),
                    stats: result.unstaged.stats,
                },
                untracked: gitSummaryFiles(result.untracked),
            }
        }

        const gitInfo = await this.getGitInfo(repoId)
        if (!gitInfo) {
            return emptyGitSummary()
        }

        if (!gitApi.isAvailable()) {
            return emptyGitSummary()
        }

        return gitApi.getGitSummary({
            repoDir: gitInfo.repoRoot,
        })
    }

    // ==================== Loading ====================

    async loadRepos(): Promise<void> {
        if (this.reposLoading) return

        runInAction(() => {
            this.reposLoading = true
        })
        try {
            // Initialize stores if not done
            await this.store.initializeStores()
            if (this.store.shouldUseRuntimeProductProjectListProjection() && this.store.runtimeProductStoreStatus !== "ready") {
                await this.store.loadRuntimeProductProjects()
            }
            this.store.trackRepoListFallbackIfNeeded()
        } finally {
            runInAction(() => {
                this.reposLoading = false
            })
        }
    }
}
