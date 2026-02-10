import { exhaustive } from "exhaustive"
import { type GetFilePairResponse, type GitStatusResponse, gitApi } from "../electronAPI/git"
import type { IsolationStrategy, Repo, Task, TaskDeviceEnvironment } from "../types"
import { getDeviceId } from "../utils/deviceId"
import type { GitInfo } from "./managers/RepoManager"

// Re-export GitInfo for convenience
export type { GitInfo } from "./managers/RepoManager"

export interface PatchResult {
    patch: string
    stats: {
        filesChanged: number
        insertions: number
        deletions: number
    }
}

export interface SetupParams {
    taskSlug: string
    gitInfo: GitInfo | null
    isolationStrategy: IsolationStrategy
    onPhase?: (phase: "workspace") => void
    signal?: AbortSignal
}

export class TaskEnvironment {
    constructor(
        private task: Task,
        private repo: Repo,
        private gitInfo: GitInfo | null,
        private deviceEnv: TaskDeviceEnvironment
    ) {}

    get hasGit(): boolean {
        return this.gitInfo !== null
    }

    /** Git root for operations - worktree dir (worktree mode) or repo git root (head mode) */
    private get gitRoot(): string | null {
        return exhaustive.tag(this.task.isolationStrategy, "type", {
            worktree: () => this.deviceEnv.worktreeDir ?? null,
            head: () => this.gitInfo?.repoRoot ?? null,
        })
    }

    /** The working directory for this task */
    get taskWorkingDir(): string {
        return exhaustive.tag(this.task.isolationStrategy, "type", {
            worktree: () => {
                // Worktree: worktreeDir + relativePath from git info
                const worktreeDir = this.deviceEnv.worktreeDir
                if (!worktreeDir) {
                    throw new Error("Worktree mode requires worktreeDir")
                }
                const relativePath = this.gitInfo?.relativePath ?? ""
                return relativePath ? `${worktreeDir}/${relativePath}` : worktreeDir
            },
            head: () => {
                // Head mode: directly use repo.path (the source of truth)
                return this.repo.path
            },
        })
    }

    private get worktreeId(): string | null {
        return exhaustive.tag(this.task.isolationStrategy, "type", {
            worktree: () => this.task.slug,
            head: () => null,
        })
    }

    get mergeBaseCommit(): string | undefined {
        return this.deviceEnv.mergeBaseCommit
    }

    async getPatch(): Promise<PatchResult | null> {
        if (!gitApi.isAvailable()) {
            return null
        }

        const worktreeId = this.worktreeId
        const gitRoot = this.gitRoot

        // For head mode (no worktree), return uncommitted changes
        if (!worktreeId) {
            return this.getUncommittedPatch()
        }

        // For worktree mode, need merge base commit and git root
        if (!this.mergeBaseCommit || !gitRoot) {
            return null
        }

        try {
            const result = await gitApi.workTreeDiffPatch({
                repoDir: gitRoot,
                workTreeId: worktreeId,
                compareToCommit: this.mergeBaseCommit,
            })

            const stats = this.parsePatchStats(result.patch)

            return {
                patch: result.patch,
                stats,
            }
        } catch (err) {
            console.error("[TaskEnvironment] getPatch failed:", err)
            return null
        }
    }

    private async getUncommittedPatch(): Promise<PatchResult | null> {
        if (!gitApi.isAvailable()) {
            return null
        }

        try {
            const uncommitted = await this.getGitStatus()
            if (!uncommitted.hasChanges) {
                return {
                    patch: "",
                    stats: { filesChanged: 0, insertions: 0, deletions: 0 },
                }
            }

            // Combine staged and unstaged patches
            const patches: string[] = []
            if (uncommitted.staged.patch) {
                patches.push(uncommitted.staged.patch)
            }
            if (uncommitted.unstaged.patch) {
                patches.push(uncommitted.unstaged.patch)
            }

            const combinedPatch = patches.join("\n")
            const stats = {
                filesChanged: uncommitted.staged.stats.filesChanged + uncommitted.unstaged.stats.filesChanged + uncommitted.untracked.length,
                insertions: uncommitted.staged.stats.insertions + uncommitted.unstaged.stats.insertions,
                deletions: uncommitted.staged.stats.deletions + uncommitted.unstaged.stats.deletions,
            }

            return {
                patch: combinedPatch,
                stats,
            }
        } catch (err) {
            console.error("[TaskEnvironment] getUncommittedPatch failed:", err)
            return null
        }
    }

    async getFilePair(filePath: string, oldPath?: string): Promise<GetFilePairResponse> {
        const gitRoot = this.gitRoot
        if (!this.mergeBaseCommit || !gitRoot) {
            return { before: "", after: "", tooLarge: false }
        }

        if (!gitApi.isAvailable()) {
            return { before: "", after: "", tooLarge: false }
        }

        return gitApi.getFilePair({
            workDir: gitRoot,
            fromTreeish: this.mergeBaseCommit,
            toTreeish: "HEAD",
            filePath,
            oldPath,
        })
    }

    get hasGhCli(): boolean {
        return this.gitInfo?.hasGhCli ?? false
    }

    async getGitStatus(): Promise<GitStatusResponse> {
        if (!gitApi.isAvailable()) {
            return {
                branch: null,
                headCommit: "",
                ahead: null,
                hasChanges: false,
                staged: { files: [], patch: "", stats: { filesChanged: 0, insertions: 0, deletions: 0 } },
                unstaged: { files: [], patch: "", stats: { filesChanged: 0, insertions: 0, deletions: 0 } },
                untracked: [],
            }
        }

        const gitRoot = this.gitRoot
        if (!gitRoot) {
            return {
                branch: null,
                headCommit: "",
                ahead: null,
                hasChanges: false,
                staged: { files: [], patch: "", stats: { filesChanged: 0, insertions: 0, deletions: 0 } },
                unstaged: { files: [], patch: "", stats: { filesChanged: 0, insertions: 0, deletions: 0 } },
                untracked: [],
            }
        }

        const worktreeId = this.worktreeId
        return gitApi.getGitStatus({
            repoDir: gitRoot,
            workTreeId: worktreeId ?? undefined,
        })
    }

    private parsePatchStats(patch: string): PatchResult["stats"] {
        let filesChanged = 0
        let insertions = 0
        let deletions = 0

        const lines = patch.split("\n")
        for (const line of lines) {
            if (line.startsWith("diff --git")) {
                filesChanged++
            } else if (line.startsWith("+") && !line.startsWith("+++")) {
                insertions++
            } else if (line.startsWith("-") && !line.startsWith("---")) {
                deletions++
            }
        }

        return { filesChanged, insertions, deletions }
    }

    static async setup({ taskSlug, gitInfo, isolationStrategy, onPhase, signal }: SetupParams): Promise<TaskDeviceEnvironment> {
        const deviceId = getDeviceId()
        const now = new Date().toISOString()

        return exhaustive.tag(isolationStrategy, "type", {
            worktree: async (strategy) => {
                if (!gitApi.isAvailable()) {
                    throw new Error("Git API not available")
                }
                if (!gitInfo?.isGitRepo) {
                    throw new Error("Worktree mode requires a git repository")
                }
                onPhase?.("workspace")

                if (signal?.aborted) {
                    throw new Error("Setup cancelled")
                }

                console.debug("[TaskEnvironment.setup] Creating worktree:", {
                    repoRoot: gitInfo.repoRoot,
                    taskSlug,
                    sourceBranch: strategy.sourceBranch,
                })

                const result = await gitApi.getOrCreateWorkTree({
                    repoDir: gitInfo.repoRoot,
                    id: taskSlug,
                    sourceTreeish: strategy.sourceBranch,
                })

                if (signal?.aborted) {
                    throw new Error("Setup cancelled")
                }

                let mergeBaseCommit: string | undefined
                try {
                    const mergeBaseResult = await gitApi.getMergeBase({
                        repoDir: gitInfo.repoRoot,
                        workTreeId: taskSlug,
                        targetBranch: strategy.sourceBranch || gitInfo.mainBranch || "main",
                    })
                    mergeBaseCommit = mergeBaseResult.mergeBaseCommit
                    console.debug("[TaskEnvironment.setup] Got merge-base commit:", mergeBaseCommit)
                } catch (err) {
                    console.warn("[TaskEnvironment.setup] Failed to get merge-base:", err)
                }

                return {
                    id: deviceId, // Required for YArrayHandle
                    deviceId,
                    worktreeDir: result.worktreeDir,
                    setupComplete: true,
                    mergeBaseCommit,
                    createdAt: now,
                    lastUsedAt: now,
                }
            },

            head: async () => {
                onPhase?.("workspace")

                if (signal?.aborted) {
                    throw new Error("Setup cancelled")
                }

                // Head mode: no worktreeDir, working dir is derived from repo.path at runtime
                return {
                    id: deviceId, // Required for YArrayHandle
                    deviceId,
                    // No worktreeDir for head mode
                    setupComplete: true,
                    // No mergeBaseCommit for head mode
                    createdAt: now,
                    lastUsedAt: now,
                }
            },
        })
    }
}
