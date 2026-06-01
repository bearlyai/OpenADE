import { describe, expect, it, vi } from "vitest"
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
    options: { mergeBaseCommit?: string } = {}
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
        repoId: "repo-1",
        usesRuntimeProductReads: true,
        get gitStatus() {
            return initialStatus
        },
        get environment() {
            return options.mergeBaseCommit ? { mergeBaseCommit: options.mergeBaseCommit } : null
        },
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
})
