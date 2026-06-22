import { describe, expect, it, vi } from "vitest"
import type { OpenADETaskChangesReadResult, OpenADETaskFilePairReadResult } from "../../../../openade-module/src"
import { gitApi, type GitFileInfo, type GitSummaryResponse, type UncommittedChangesStats } from "../../electronAPI/git"
import type { TaskModel } from "../TaskModel"
import { ChangesManager } from "./ChangesManager"

function stats(filesChanged: number): UncommittedChangesStats {
    return {
        filesChanged,
        insertions: 0,
        deletions: 0,
    }
}

function file(path: string): GitFileInfo {
    return {
        path,
        binary: false,
        status: "modified",
    }
}

function gitSummary(paths: string[]): GitSummaryResponse {
    const files = paths.map(file)

    return {
        branch: "main",
        headCommit: "abc123",
        ahead: 0,
        hasChanges: files.length > 0,
        staged: {
            files: [],
            stats: stats(0),
        },
        unstaged: {
            files,
            stats: stats(files.length),
        },
        untracked: [],
    }
}

function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
    let resolve!: (value: T) => void
    const promise = new Promise<T>((promiseResolve) => {
        resolve = promiseResolve
    })
    return { promise, resolve }
}

function createManager(initialStatus: GitSummaryResponse): {
    manager: ChangesManager
    setStatus: (status: GitSummaryResponse) => void
} {
    let currentStatus = initialStatus
    const taskModel = {
        get gitStatus() {
            return currentStatus
        },
        get environment() {
            return null
        },
    } as unknown as TaskModel

    return {
        manager: new ChangesManager(taskModel),
        setStatus: (status) => {
            currentStatus = status
        },
    }
}

function createRuntimeManager(
    initialStatus: GitSummaryResponse,
    options: {
        canReadChanges?: boolean
        canReadDiff?: boolean
        canReadFilePair?: boolean
        failOnEnvironmentRead?: boolean
        mergeBaseCommit?: string
        repoId?: string
        taskWorkingDirHint?: string
        workingDir?: string
        canReadChangesAfterConnect?: boolean
        canReadDiffAfterConnect?: boolean
        canReadFilePairAfterConnect?: boolean
    } = {}
): {
    manager: ChangesManager
    readProductTaskChanges: ReturnType<typeof vi.fn>
    readProductTaskDiff: ReturnType<typeof vi.fn>
    readProductTaskFilePair: ReturnType<typeof vi.fn>
} {
    const readProductTaskChanges = vi.fn(async (params: { fromTreeish?: string }) => ({
        repoId: "repo-1",
        taskId: "task-1",
        fromTreeish: params.fromTreeish ?? "core-default",
        toTreeish: "",
        files: [file("src/runtime.ts")],
    }))
    const readProductTaskDiff = vi.fn(async (params: { fromTreeish?: string; filePath: string; oldPath?: string; contextLines: number }) => ({
        repoId: "repo-1",
        taskId: "task-1",
        filePath: params.filePath,
        oldPath: params.oldPath,
        fromTreeish: params.fromTreeish ?? "core-default",
        toTreeish: "",
        patch: "diff --git a/src/runtime.ts b/src/runtime.ts\n+runtime diff\n",
        truncated: false,
        heavy: false,
        stats: { insertions: 1, deletions: 0, changedLines: 1, hunkCount: 1 },
    }))
    const readProductTaskFilePair = vi.fn(async (params: { fromTreeish?: string; filePath: string; oldPath?: string }) => ({
        repoId: "repo-1",
        taskId: "task-1",
        filePath: params.filePath,
        oldPath: params.oldPath,
        fromTreeish: params.fromTreeish ?? "core-default",
        toTreeish: "",
        before: "before\n",
        after: "after\n",
    }))
    const taskModel = {
        repoId: options.repoId ?? "repo-1",
        usesRuntimeProductAPI: true,
        get gitStatus() {
            return initialStatus
        },
        get taskWorkingDirHint() {
            return options.taskWorkingDirHint ?? options.workingDir ?? null
        },
        get environment() {
            if (options.failOnEnvironmentRead) {
                throw new Error("desktop environment state should not be read")
            }
            return options.mergeBaseCommit || options.workingDir
                ? {
                      mergeBaseCommit: options.mergeBaseCommit,
                      taskWorkingDir: options.workingDir,
                  }
                : null
        },
        canReadProductTaskChanges: () => options.canReadChanges ?? true,
        canReadProductTaskDiff: () => options.canReadDiff ?? true,
        canReadProductTaskFilePair: () => options.canReadFilePair ?? true,
        canReadProductTaskChangesAfterConnect: vi.fn(async () => options.canReadChangesAfterConnect ?? options.canReadChanges ?? true),
        canReadProductTaskDiffAfterConnect: vi.fn(async () => options.canReadDiffAfterConnect ?? options.canReadDiff ?? true),
        canReadProductTaskFilePairAfterConnect: vi.fn(async () => options.canReadFilePairAfterConnect ?? options.canReadFilePair ?? true),
        readProductTaskChanges,
        readProductTaskDiff,
        readProductTaskFilePair,
    } as unknown as TaskModel

    return {
        manager: new ChangesManager(taskModel),
        readProductTaskChanges,
        readProductTaskDiff,
        readProductTaskFilePair,
    }
}

describe("ChangesManager expansion state", () => {
    it("forces a fresh git summary for explicit refreshes", () => {
        const refreshGitState = vi.fn()
        const taskModel = {
            gitStatus: gitSummary(["src/a.ts"]),
            environment: null,
            refreshGitState,
        } as unknown as TaskModel
        const manager = new ChangesManager(taskModel)

        try {
            manager.refresh()

            expect(refreshGitState).toHaveBeenCalledWith({ force: true })
        } finally {
            manager.dispose()
        }
    })

    it("expands every directory when changes refresh", () => {
        const { manager, setStatus } = createManager(gitSummary(["src/a.ts", "src/components/Button.tsx"]))

        try {
            manager.initializeForTray()
            expect(manager.expandedPaths.has("src")).toBe(true)
            expect(manager.expandedPaths.has("src/components")).toBe(true)

            setStatus(gitSummary(["src/a.ts", "src/components/Button.tsx", "docs/api/reference.md"]))
            manager.initializeForTray()

            expect(manager.expandedPaths.has("src")).toBe(true)
            expect(manager.expandedPaths.has("docs")).toBe(true)
            expect(manager.expandedPaths.has("docs/api")).toBe(true)
        } finally {
            manager.dispose()
        }
    })

    it("flattens nested files without expansion toggles", () => {
        const { manager } = createManager(gitSummary(["src/a.ts", "docs/api/reference.md"]))

        try {
            manager.initializeForTray()

            expect(manager.flatEntries.map((entry) => entry.node.path)).toEqual(["docs", "docs/api", "docs/api/reference.md", "src", "src/a.ts"])
        } finally {
            manager.dispose()
        }
    })
})

describe("ChangesManager runtime scoped git reads", () => {
    it("does not call unavailable runtime changes methods from stale mounted viewers", async () => {
        const { manager, readProductTaskChanges, readProductTaskDiff, readProductTaskFilePair } = createRuntimeManager(gitSummary(["README.md"]), {
            canReadChanges: false,
            canReadDiff: false,
            canReadFilePair: false,
            mergeBaseCommit: "base-sha",
            taskWorkingDirHint: "/tmp/runtime-worktree",
        })
        const legacyFilePair = vi.spyOn(gitApi, "getFilePair").mockRejectedValue(new Error("legacy file pair should not be used"))
        const legacyFilePatch = vi.spyOn(gitApi, "getWorktreeFilePatch").mockRejectedValue(new Error("legacy file patch should not be used"))
        const legacyChangedFiles = vi.spyOn(gitApi, "getChangedFiles").mockRejectedValue(new Error("legacy changed-files read should not be used"))

        try {
            manager.initializeForTray()
            manager.ensureSelectedFileLoaded("current")
            manager.ensureSelectedFileLoaded("unified", 3)
            manager.setDiffSource("from-base")

            await new Promise((resolve) => setTimeout(resolve, 0))

            expect(readProductTaskFilePair).not.toHaveBeenCalled()
            expect(readProductTaskDiff).not.toHaveBeenCalled()
            expect(readProductTaskChanges).not.toHaveBeenCalled()
            expect(legacyFilePair).not.toHaveBeenCalled()
            expect(legacyFilePatch).not.toHaveBeenCalled()
            expect(legacyChangedFiles).not.toHaveBeenCalled()
            expect(manager.filePair).toBeNull()
            expect(manager.filePatch).toBeNull()
            expect(manager.fromBaseFiles).toBeNull()
        } finally {
            legacyFilePair.mockRestore()
            legacyFilePatch.mockRestore()
            legacyChangedFiles.mockRestore()
            manager.dispose()
        }
    })

    it("attaches Core-owned task git detail capabilities before explicit file and diff reads", async () => {
        const { manager, readProductTaskChanges, readProductTaskDiff, readProductTaskFilePair } = createRuntimeManager(gitSummary(["README.md"]), {
            canReadChanges: false,
            canReadDiff: false,
            canReadFilePair: false,
            canReadChangesAfterConnect: true,
            canReadDiffAfterConnect: true,
            canReadFilePairAfterConnect: true,
            mergeBaseCommit: "base-sha",
            taskWorkingDirHint: "/tmp/runtime-worktree",
        })
        const taskModel = (manager as unknown as { taskModel: TaskModel }).taskModel
        const canReadChangesAfterConnect = vi.mocked(taskModel.canReadProductTaskChangesAfterConnect)
        const canReadDiffAfterConnect = vi.mocked(taskModel.canReadProductTaskDiffAfterConnect)
        const canReadFilePairAfterConnect = vi.mocked(taskModel.canReadProductTaskFilePairAfterConnect)

        try {
            manager.initializeForTray()
            manager.ensureSelectedFileLoaded("current")
            manager.ensureSelectedFileLoaded("unified", 3)
            manager.setDiffSource("from-base")

            await vi.waitFor(() => expect(readProductTaskChanges).toHaveBeenCalledWith({ fromTreeish: "base-sha" }), {
                timeout: 1000,
                interval: 10,
            })

            expect(canReadFilePairAfterConnect).toHaveBeenCalled()
            expect(canReadDiffAfterConnect).toHaveBeenCalled()
            expect(canReadChangesAfterConnect).toHaveBeenCalled()
            expect(readProductTaskFilePair).toHaveBeenCalledWith({ fromTreeish: "HEAD", filePath: "README.md", oldPath: undefined })
            expect(readProductTaskDiff).toHaveBeenCalledWith({ fromTreeish: "HEAD", filePath: "README.md", oldPath: undefined, contextLines: 3 })
        } finally {
            manager.dispose()
        }
    })

    it("loads current runtime changes from the task working-dir hint without cached desktop environment state", async () => {
        const { manager, readProductTaskDiff, readProductTaskFilePair } = createRuntimeManager(gitSummary(["README.md"]), {
            failOnEnvironmentRead: true,
            taskWorkingDirHint: "/tmp/runtime-worktree/packages/web",
        })
        const legacyFilePair = vi.spyOn(gitApi, "getFilePair").mockRejectedValue(new Error("legacy file pair should not be used"))
        const legacyFilePatch = vi.spyOn(gitApi, "getWorktreeFilePatch").mockRejectedValue(new Error("legacy file patch should not be used"))

        try {
            manager.initializeForTray()
            manager.ensureSelectedFileLoaded("current")

            await vi.waitFor(() => expect(manager.filePair).toMatchObject({ before: "before\n", after: "after\n" }), {
                timeout: 1000,
                interval: 10,
            })

            manager.ensureSelectedFileLoaded("unified", 3)

            await vi.waitFor(() => expect(manager.filePatch).toMatchObject({ patch: expect.stringContaining("+runtime diff") }), {
                timeout: 1000,
                interval: 10,
            })

            expect(readProductTaskFilePair).toHaveBeenCalledWith({ fromTreeish: "HEAD", filePath: "README.md", oldPath: undefined })
            expect(readProductTaskDiff).toHaveBeenCalledWith({ fromTreeish: "HEAD", filePath: "README.md", oldPath: undefined, contextLines: 3 })
            expect(legacyFilePair).not.toHaveBeenCalled()
            expect(legacyFilePatch).not.toHaveBeenCalled()
        } finally {
            legacyFilePair.mockRestore()
            legacyFilePatch.mockRestore()
            manager.dispose()
        }
    })

    it("keeps the classic changes tray on runtime-backed file pair and patch reads", async () => {
        const { manager, readProductTaskDiff, readProductTaskFilePair } = createRuntimeManager(gitSummary(["README.md"]))
        const legacyFilePair = vi.spyOn(gitApi, "getFilePair")
        const legacyFilePatch = vi.spyOn(gitApi, "getWorktreeFilePatch")

        try {
            manager.initializeForTray()
            manager.ensureSelectedFileLoaded("current")

            await vi.waitFor(() => expect(manager.filePair).toMatchObject({ before: "before\n", after: "after\n" }), {
                timeout: 1000,
                interval: 10,
            })

            expect(readProductTaskFilePair).toHaveBeenCalledWith({ fromTreeish: "HEAD", filePath: "README.md", oldPath: undefined })
            expect(legacyFilePair).not.toHaveBeenCalled()

            manager.ensureSelectedFileLoaded("unified", 3)

            await vi.waitFor(() => expect(manager.filePatch).toMatchObject({ patch: expect.stringContaining("+runtime diff") }), {
                timeout: 1000,
                interval: 10,
            })

            expect(readProductTaskDiff).toHaveBeenCalledWith({ fromTreeish: "HEAD", filePath: "README.md", oldPath: undefined, contextLines: 3 })
            expect(legacyFilePatch).not.toHaveBeenCalled()
        } finally {
            legacyFilePair.mockRestore()
            legacyFilePatch.mockRestore()
            manager.dispose()
        }
    })

    it("lets the runtime core derive the merge base when local desktop environment state is absent", async () => {
        const { manager, readProductTaskChanges, readProductTaskDiff } = createRuntimeManager(gitSummary(["README.md"]))
        const legacyChangedFiles = vi.spyOn(gitApi, "getChangedFiles")

        try {
            manager.initializeForTray()
            manager.setDiffSource("from-base")

            await vi.waitFor(() => expect(manager.fromBaseFiles).toEqual([file("src/runtime.ts")]), {
                timeout: 1000,
                interval: 10,
            })

            expect(readProductTaskChanges).toHaveBeenCalledWith({ fromTreeish: undefined })
            expect(legacyChangedFiles).not.toHaveBeenCalled()

            manager.ensureSelectedFileLoaded("unified", 10)

            await vi.waitFor(() => expect(manager.filePatch).toMatchObject({ fromTreeish: "core-default" }), {
                timeout: 1000,
                interval: 10,
            })

            expect(readProductTaskDiff).toHaveBeenCalledWith({
                fromTreeish: undefined,
                filePath: "src/runtime.ts",
                oldPath: undefined,
                contextLines: 10,
            })
        } finally {
            legacyChangedFiles.mockRestore()
            manager.dispose()
        }
    })

    it("fails closed instead of using raw git when runtime task git scope is unavailable", async () => {
        const { manager, readProductTaskChanges, readProductTaskDiff, readProductTaskFilePair } = createRuntimeManager(gitSummary(["README.md"]), {
            repoId: "",
            mergeBaseCommit: "base-sha",
            workingDir: "/tmp/runtime-repo",
        })
        const legacyFilePair = vi.spyOn(gitApi, "getFilePair").mockRejectedValue(new Error("legacy file pair should not be used"))
        const legacyFilePatch = vi.spyOn(gitApi, "getWorktreeFilePatch").mockRejectedValue(new Error("legacy file patch should not be used"))
        const legacyChangedFiles = vi.spyOn(gitApi, "getChangedFiles").mockRejectedValue(new Error("legacy changed-files read should not be used"))

        try {
            manager.initializeForTray()
            manager.ensureSelectedFileLoaded("current")
            manager.ensureSelectedFileLoaded("unified", 3)
            manager.setDiffSource("from-base")

            await new Promise((resolve) => setTimeout(resolve, 0))

            expect(readProductTaskFilePair).not.toHaveBeenCalled()
            expect(readProductTaskDiff).not.toHaveBeenCalled()
            expect(readProductTaskChanges).not.toHaveBeenCalled()
            expect(legacyFilePair).not.toHaveBeenCalled()
            expect(legacyFilePatch).not.toHaveBeenCalled()
            expect(legacyChangedFiles).not.toHaveBeenCalled()
            expect(manager.filePair).toBeNull()
            expect(manager.filePatch).toBeNull()
            expect(manager.fromBaseFiles).toBeNull()
        } finally {
            legacyFilePair.mockRestore()
            legacyFilePatch.mockRestore()
            legacyChangedFiles.mockRestore()
            manager.dispose()
        }
    })

    it("drops delayed runtime file pair results after the selected file changes", async () => {
        const delayedFilePair = createDeferred<OpenADETaskFilePairReadResult>()
        const { manager, readProductTaskFilePair } = createRuntimeManager(gitSummary(["README.md", "LICENSE.md"]))
        const legacyFilePair = vi.spyOn(gitApi, "getFilePair").mockRejectedValue(new Error("legacy file pair should not be used"))

        readProductTaskFilePair.mockImplementation(
            async (params: { fromTreeish?: string; filePath: string; oldPath?: string }) =>
                params.filePath === "README.md"
                    ? delayedFilePair.promise
                    : {
                          repoId: "repo-1",
                          taskId: "task-1",
                          filePath: params.filePath,
                          oldPath: params.oldPath,
                          fromTreeish: params.fromTreeish ?? "core-default",
                          toTreeish: "",
                          before: "license before\n",
                          after: "license after\n",
                      }
        )

        try {
            manager.initializeForTray()
            expect(manager.selectedFile?.path).toBe("README.md")

            manager.ensureSelectedFileLoaded("current")
            manager.selectFile("LICENSE.md")
            delayedFilePair.resolve({
                repoId: "repo-1",
                taskId: "task-1",
                filePath: "README.md",
                fromTreeish: "HEAD",
                toTreeish: "",
                before: "readme before\n",
                after: "readme after\n",
            })
            await Promise.resolve()

            expect(manager.selectedFile?.path).toBe("LICENSE.md")
            expect(manager.filePair).toBeNull()
            expect(manager.filePairLoading).toBe(false)
            expect(legacyFilePair).not.toHaveBeenCalled()
        } finally {
            legacyFilePair.mockRestore()
            manager.dispose()
        }
    })

    it("drops delayed runtime from-base file lists after leaving from-base mode", async () => {
        const delayedChanges = createDeferred<OpenADETaskChangesReadResult>()
        const { manager, readProductTaskChanges } = createRuntimeManager(gitSummary(["README.md"]), {
            mergeBaseCommit: "base-sha",
        })
        const legacyChangedFiles = vi.spyOn(gitApi, "getChangedFiles").mockRejectedValue(new Error("legacy changed-files read should not be used"))

        readProductTaskChanges.mockImplementation(async () => delayedChanges.promise)

        try {
            manager.initializeForTray()
            manager.setDiffSource("from-base")
            expect(manager.fromBaseLoading).toBe(true)

            manager.setDiffSource("uncommitted")
            delayedChanges.resolve({
                repoId: "repo-1",
                taskId: "task-1",
                fromTreeish: "base-sha",
                toTreeish: "",
                files: [{ path: "src/stale.ts", status: "modified", binary: false }],
            })
            await Promise.resolve()

            expect(manager.diffSource).toBe("uncommitted")
            expect(manager.fromBaseFiles).toBeNull()
            expect(manager.fromBaseLoading).toBe(false)
            expect(legacyChangedFiles).not.toHaveBeenCalled()
        } finally {
            legacyChangedFiles.mockRestore()
            manager.dispose()
        }
    })
})
