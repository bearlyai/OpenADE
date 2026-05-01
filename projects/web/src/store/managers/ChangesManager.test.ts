import { describe, expect, it } from "vitest"
import type { GitFileInfo, GitSummaryResponse, UncommittedChangesStats } from "../../electronAPI/git"
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

describe("ChangesManager expansion state", () => {
    it("auto-expands newly introduced directories when changes refresh", () => {
        const { manager, setStatus } = createManager(gitSummary(["src/a.ts"]))

        try {
            manager.initializeForTray()
            expect(manager.expandedPaths.has("src")).toBe(true)

            setStatus(gitSummary(["src/a.ts", "docs/guide.md"]))
            manager.initializeForTray()

            expect(manager.expandedPaths.has("src")).toBe(true)
            expect(manager.expandedPaths.has("docs")).toBe(true)
        } finally {
            manager.dispose()
        }
    })

    it("does not reopen a directory the user collapsed", () => {
        const { manager, setStatus } = createManager(gitSummary(["src/a.ts", "docs/guide.md"]))

        try {
            manager.initializeForTray()
            manager.toggleExpanded("docs")

            expect(manager.expandedPaths.has("docs")).toBe(false)

            setStatus(gitSummary(["src/a.ts", "docs/guide.md", "docs/api/reference.md"]))
            manager.initializeForTray()

            expect(manager.expandedPaths.has("docs")).toBe(false)
        } finally {
            manager.dispose()
        }
    })
})
