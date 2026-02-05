/**
 * RepoManager
 *
 * Manages repository state and operations using RepoStore:
 * - Repository CRUD
 * - In-memory git info cache (fetched on-demand, not persisted)
 */

import { computed, makeAutoObservable } from "mobx"
import { type BranchInfo, type GitStatusResponse, gitApi } from "../../electronAPI/git"
import { addRepo as addRepoToStore, deleteRepo as deleteRepoFromStore, updateRepo as updateRepoInStore } from "../../persistence"
import type { Repo } from "../../types"
import type { CodeStore } from "../store"

/** Git info - computed at runtime, not persisted */
export interface GitInfo {
    isGitRepo: boolean
    repoRoot: string
    relativePath: string
    mainBranch: string
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
        if (!this.store.repoStore) return []
        return this.store.repoStore.repos.all().map((item) => ({
            id: item.id,
            name: item.name,
            path: item.path,
            createdBy: item.createdBy,
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
        }))
    }

    // ==================== CRUD Operations ====================

    getRepo(id: string): Repo | undefined {
        return this.repos.find((r) => r.id === id)
    }

    /** Alias for createRepo - kept for backward compatibility */
    async addRepo(params: { name: string; path: string }): Promise<Repo | null> {
        return this.createRepo(params)
    }

    async createRepo(params: { name: string; path: string }): Promise<Repo | null> {
        if (!this.store.repoStore) return null

        const repoId = addRepoToStore(this.store.repoStore, {
            name: params.name,
            path: params.path,
            createdBy: this.store.currentUser,
        })

        return this.getRepo(repoId) ?? null
    }

    async updateRepo(id: string, updates: Partial<Pick<Repo, "name" | "path">>): Promise<Repo | null> {
        if (!this.store.repoStore) return null

        // Clear git info cache if path changed
        if (updates.path !== undefined) {
            this.gitInfoCache.delete(id)
        }

        updateRepoInStore(this.store.repoStore, id, updates)

        return this.getRepo(id) ?? null
    }

    /** Alias for deleteRepo - kept for backward compatibility */
    async removeRepo(id: string): Promise<boolean> {
        return this.deleteRepo(id)
    }

    async deleteRepo(id: string): Promise<boolean> {
        if (!this.store.repoStore) return false

        // Clean up cache
        this.gitInfoCache.delete(id)

        deleteRepoFromStore(this.store.repoStore, id)
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

        // Fetch from Electron
        try {
            const response = await gitApi.isGitDirectory({ directory: repo.path })
            const gitInfo = response.isGitDirectory
                ? {
                      isGitRepo: true,
                      repoRoot: response.repoRoot,
                      relativePath: response.relativePath,
                      mainBranch: response.mainBranch,
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

    /** Check if a path is a git repo - returns true/false */
    async isGitRepo(directory: string): Promise<boolean> {
        try {
            const response = await gitApi.isGitDirectory({ directory })
            return response.isGitDirectory
        } catch {
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
    async getGitStatus(repoId: string): Promise<GitStatusResponse> {
        const gitInfo = await this.getGitInfo(repoId)
        if (!gitInfo) {
            return {
                branch: null,
                headCommit: "",
                hasChanges: false,
                staged: { files: [], patch: "", stats: { filesChanged: 0, insertions: 0, deletions: 0 } },
                unstaged: { files: [], patch: "", stats: { filesChanged: 0, insertions: 0, deletions: 0 } },
                untracked: [],
            }
        }

        if (!gitApi.isAvailable()) {
            return {
                branch: null,
                headCommit: "",
                hasChanges: false,
                staged: { files: [], patch: "", stats: { filesChanged: 0, insertions: 0, deletions: 0 } },
                unstaged: { files: [], patch: "", stats: { filesChanged: 0, insertions: 0, deletions: 0 } },
                untracked: [],
            }
        }

        return gitApi.getGitStatus({
            repoDir: gitInfo.repoRoot,
        })
    }

    // ==================== Loading ====================

    async loadRepos(): Promise<void> {
        if (this.reposLoading) return

        this.reposLoading = true
        try {
            // Initialize stores if not done
            await this.store.initializeStores()
        } finally {
            this.reposLoading = false
        }
    }
}
