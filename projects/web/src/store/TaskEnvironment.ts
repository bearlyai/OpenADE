import { exhaustive } from "exhaustive"
import { type ChangedFileInfo, type GetFilePairResponse, type GitStatusResponse, type GitSummaryResponse, gitApi } from "../electronAPI/git"
import type { SnapshotPatchIndex } from "../electronAPI/snapshots"
import type { IsolationStrategy, Repo, SnapshotChangedFile, Task, TaskDeviceEnvironment } from "../types"
import { getDeviceId } from "../utils/deviceId"
import type { GitInfo } from "./managers/RepoManager"

// Re-export GitInfo for convenience
export type { GitInfo } from "./managers/RepoManager"

export interface PatchResult {
    patch: string
    index: SnapshotPatchIndex
    stats: {
        filesChanged: number
        insertions: number
        deletions: number
    }
    files?: SnapshotChangedFile[]
}

const textEncoder = new TextEncoder()

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

    /** Root directory for this task's execution context */
    get taskRootDir(): string {
        return exhaustive.tag(this.task.isolationStrategy, "type", {
            worktree: () => {
                const worktreeDir = this.deviceEnv.worktreeDir
                if (!worktreeDir) {
                    throw new Error("Worktree mode requires worktreeDir")
                }
                return worktreeDir
            },
            head: () => this.repo.path,
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

        const fromTreeish = exhaustive.tag(this.task.isolationStrategy, "type", {
            worktree: () => this.mergeBaseCommit ?? null,
            head: () => "HEAD",
        })

        if (!fromTreeish) {
            return null
        }

        try {
            const changedFiles = await this.getSnapshotChangedFiles(fromTreeish)
            return this.buildPatchResult(fromTreeish, changedFiles)
        } catch (err) {
            console.error("[TaskEnvironment] getPatch failed:", err)
            return null
        }
    }

    private async getSnapshotChangedFiles(fromTreeish: string): Promise<ChangedFileInfo[]> {
        const result = await gitApi.getChangedFiles({
            workDir: this.taskRootDir,
            fromTreeish,
            toTreeish: "",
        })
        return result.files
    }

    private async buildPatchResult(fromTreeish: string, changedFiles: ChangedFileInfo[]): Promise<PatchResult> {
        if (changedFiles.length === 0) {
            return {
                patch: "",
                index: { version: 1, patchSize: 0, files: [] },
                stats: { filesChanged: 0, insertions: 0, deletions: 0 },
                files: [],
            }
        }

        const patchParts: string[] = []
        const index: SnapshotPatchIndex = { version: 1, patchSize: 0, files: [] }
        let insertions = 0
        let deletions = 0

        for (const file of changedFiles) {
            const patchResult = await gitApi.getWorktreeFilePatch({
                workDir: this.taskRootDir,
                fromTreeish,
                filePath: file.path,
                oldPath: file.oldPath,
                contextLines: 3,
                allowTruncation: false,
            })

            if (!patchResult.patch) {
                continue
            }

            const normalizedPatch = patchResult.patch.endsWith("\n") ? patchResult.patch : `${patchResult.patch}\n`
            const patchStart = index.patchSize
            const patchSize = textEncoder.encode(normalizedPatch).length
            const patchEnd = patchStart + patchSize

            patchParts.push(normalizedPatch)
            index.patchSize = patchEnd
            index.files.push({
                id: String(index.files.length),
                path: file.path,
                oldPath: file.oldPath,
                status: file.status,
                binary: file.binary === true || normalizedPatch.includes("Binary files ") || normalizedPatch.includes("GIT binary patch"),
                insertions: patchResult.stats.insertions,
                deletions: patchResult.stats.deletions,
                changedLines: patchResult.stats.changedLines,
                hunkCount: patchResult.stats.hunkCount,
                patchStart,
                patchEnd,
            })

            insertions += patchResult.stats.insertions
            deletions += patchResult.stats.deletions
        }

        return {
            patch: patchParts.join(""),
            index,
            stats: {
                filesChanged: index.files.length,
                insertions,
                deletions,
            },
            files: index.files.map((file) => ({
                path: file.path,
                status: file.status,
                ...(file.oldPath ? { oldPath: file.oldPath } : {}),
            })),
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
