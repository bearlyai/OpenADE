import { exhaustive } from "exhaustive"
import { type GitSummaryResponse, gitApi } from "../electronAPI/git"
import type { IsolationStrategy, Repo, Task, TaskDeviceEnvironment } from "../types"
import { getDeviceId } from "../utils/deviceId"
import type { GitInfo } from "./managers/RepoManager"

// Re-export GitInfo for convenience
export type { GitInfo } from "./managers/RepoManager"

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

    get hasGhCli(): boolean {
        return this.gitInfo?.hasGhCli ?? false
    }

    async getGitSummary(): Promise<GitSummaryResponse> {
        if (!gitApi.isAvailable()) {
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

        const gitRoot = this.gitRoot
        if (!gitRoot) {
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

        const worktreeId = this.worktreeId
        return gitApi.getGitSummary({
            repoDir: gitRoot,
            workTreeId: worktreeId ?? undefined,
        })
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
