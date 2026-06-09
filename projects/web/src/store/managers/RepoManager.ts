/**
 * RepoManager
 *
 * Manages repository state and operations using RepoStore:
 * - Repository CRUD
 * - In-memory git info cache (fetched on-demand, not persisted)
 */

import { computed, makeAutoObservable, runInAction } from "mobx"
import { type BranchInfo, type GitFileInfo, type GitSummaryResponse, gitApi } from "../../electronAPI/git"
import type { OpenADETaskGitChangedFile } from "../../../../openade-module/src"
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

    constructor(private store: CodeStore) {
        makeAutoObservable(this, {
            repos: computed,
        })
    }

    // ==================== Computed from RepoStore ====================

    get repos(): Repo[] {
        if (this.store.runtimeProductSnapshot) {
            return this.store.runtimeProductSnapshot.repos.map((item) => ({
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

    async addRepo(params: { name: string; path: string }): Promise<Repo | null> {
        return this.createRepo(params)
    }

    async createRepo(params: { name: string; path: string }): Promise<Repo | null> {
        if (!this.store.repoStore && !this.store.shouldUseRuntimeProductReads()) return null

        const result = await this.store.createProductRepo({
            name: params.name,
            path: params.path,
            createdBy: this.store.currentUser,
        })
        await this.store.refreshProductStateAfterRepoMutation()

        return this.getRepo(result.repoId) ?? null
    }

    async updateRepo(id: string, updates: Partial<Pick<Repo, "name" | "path">>): Promise<Repo | null> {
        if (!this.store.repoStore && !this.store.shouldUseRuntimeProductReads()) return null

        // Clear git info cache if path changed
        if (updates.path !== undefined) {
            this.gitInfoCache.delete(id)
        }

        await this.store.updateProductRepo({ repoId: id, ...updates })
        await this.store.refreshProductStateAfterRepoMutation()

        return this.getRepo(id) ?? null
    }

    async setRepoArchived(id: string, archived: boolean): Promise<void> {
        if (!this.store.repoStore && !this.store.shouldUseRuntimeProductReads()) return
        await this.store.updateProductRepo({ repoId: id, archived })
        await this.store.refreshProductStateAfterRepoMutation()
    }

    async removeRepo(id: string): Promise<boolean> {
        return this.deleteRepo(id)
    }

    async deleteRepo(id: string): Promise<boolean> {
        if (!this.store.repoStore && !this.store.shouldUseRuntimeProductReads()) return false

        // Clean up cache
        this.gitInfoCache.delete(id)

        await this.store.deleteProductRepo({ repoId: id })
        await this.store.refreshProductStateAfterRepoMutation()
        return true
    }

    // ==================== Git Info (In-Memory Cache) ====================

    /**
     * Get git info for a repo, fetching from Electron if not cached.
     * Returns null if the directory is not a git repo.
     */
    async getGitInfo(repoId: string): Promise<GitInfo | null> {
        const repo = this.getRepo(repoId)
        if (!repo) return null

        // Check cache
        if (this.gitInfoCache.has(repoId)) {
            return this.gitInfoCache.get(repoId) ?? null
        }

        try {
            const response = this.store.shouldUseRuntimeProductReads()
                ? await this.store.readProductProjectGitInfo({ repoId })
                : await gitApi.isGitDirectory({ directory: repo.path })
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

            this.gitInfoCache.set(repoId, gitInfo)
            return gitInfo
        } catch (err) {
            console.error(`[RepoManager] Failed to detect git info for ${repoId}:`, err)
            this.gitInfoCache.set(repoId, null)
            return null
        }
    }

    /** Check if git info is cached (without fetching) */
    getGitInfoSync(repoId: string): GitInfo | null | undefined {
        return this.gitInfoCache.get(repoId)
    }

    /** Clear cached git info for a repo */
    clearGitInfoCache(repoId: string): void {
        this.gitInfoCache.delete(repoId)
    }

    /**
     * Re-check gh CLI availability and update the cached git info.
     * Returns the fresh hasGhCli value.
     */
    async refreshGhCliStatus(repoId: string): Promise<boolean> {
        try {
            const hasGhCli = this.store.shouldUseRuntimeProductReads()
                ? await this.store.readProductProjectGitInfo({ repoId }).then((result) => (result.isGitRepo === true ? result.hasGhCli : false))
                : await gitApi.checkGhCli().then((result) => result.hasGhCli)

            // Update the cached git info entry if it exists
            const cached = this.gitInfoCache.get(repoId)
            if (cached) {
                cached.hasGhCli = hasGhCli
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
     * Requires git info to be fetched first.
     */
    async listBranches(
        repoId: string,
        { includeRemote = false }: { includeRemote?: boolean } = {}
    ): Promise<{
        branches: BranchInfo[]
        defaultBranch: string
    }> {
        const gitInfo = await this.getGitInfo(repoId)
        if (!gitInfo) {
            return { branches: [], defaultBranch: "main" }
        }

        if (this.store.shouldUseRuntimeProductReads()) {
            const result = await this.store.readProductProjectGitBranches({ repoId, includeRemote })
            return {
                branches: result.branches,
                defaultBranch: result.defaultBranch,
            }
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
     * Requires git info to be fetched first.
     */
    async getGitSummary(repoId: string): Promise<GitSummaryResponse> {
        const gitInfo = await this.getGitInfo(repoId)
        if (!gitInfo) {
            return emptyGitSummary()
        }

        if (this.store.shouldUseRuntimeProductReads()) {
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
            if (!this.store.runtimeProductSnapshot && this.store.repoStore?.repos.all().length) {
                this.store.trackRuntimeProductFallback("repo_list", "snapshot_unavailable")
            }
        } finally {
            runInAction(() => {
                this.reposLoading = false
            })
        }
    }
}
