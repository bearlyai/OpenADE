import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../electronAPI/files", () => ({
    filesApi: {
        describePath: vi.fn(),
        fuzzySearch: vi.fn(),
    },
}))

import { filesApi } from "../../electronAPI/files"
import { FileBrowserManager } from "./FileBrowserManager"

function dirResult(path: string, entries: Array<{ name: string; path: string; isDir: boolean }> = []) {
    return {
        type: "dir" as const,
        path,
        mode: 0o40755,
        entries: entries.map((entry) => ({
            ...entry,
            isSymlink: false,
            size: 0,
            mode: entry.isDir ? 0o40755 : 0o100644,
        })),
    }
}

function fileResult(path: string, content = "one\ntwo\nthree") {
    return {
        type: "file" as const,
        path,
        size: content.length,
        mode: 0o100644,
        content,
        tooLarge: false,
        isReadable: true,
    }
}

function mockRepoFiles(): void {
    vi.mocked(filesApi.describePath).mockImplementation(async ({ path, readContents }) => {
        if (path === "/repo/TaskModel.ts") {
            return { type: "not_found", path }
        }

        if (readContents && path === "/repo/src/store/TaskModel.ts") {
            return fileResult(path)
        }

        if (path === "/repo") {
            return dirResult(path, [{ name: "src", path: "/repo/src", isDir: true }])
        }

        if (path === "/repo/src") {
            return dirResult(path, [{ name: "store", path: "/repo/src/store", isDir: true }])
        }

        if (path === "/repo/src/store") {
            return dirResult(path, [{ name: "TaskModel.ts", path: "/repo/src/store/TaskModel.ts", isDir: false }])
        }

        if (path === "/repo/src/store/TaskModel.ts") {
            return fileResult(path)
        }

        return { type: "not_found", path }
    })
}

function mockAnyOpenedFile(): void {
    vi.mocked(filesApi.describePath).mockImplementation(async ({ path, readContents }) => {
        if (readContents) return fileResult(path)
        return dirResult(path)
    })
}

describe("FileBrowserManager file references", () => {
    beforeEach(() => {
        vi.mocked(filesApi.describePath).mockReset()
        vi.mocked(filesApi.fuzzySearch).mockReset()
    })

    it("opens existing absolute file references directly", async () => {
        const manager = new FileBrowserManager()
        manager.workingDir = "/repo"
        mockRepoFiles()

        await manager.openFileReference("/repo/src/store/TaskModel.ts", { line: 42 })

        expect(filesApi.fuzzySearch).not.toHaveBeenCalled()
        expect(manager.activeFile).toBe("/repo/src/store/TaskModel.ts")
        expect(manager.activeLine).toBe(42)
        expect([...manager.expandedPaths]).toEqual(["/repo", "/repo/src", "/repo/src/store"])
    })

    it("falls back to fuzzy matching for short file references", async () => {
        const manager = new FileBrowserManager()
        manager.workingDir = "/repo"
        mockRepoFiles()
        vi.mocked(filesApi.fuzzySearch).mockResolvedValue({
            results: ["src/store/TaskModel.ts"],
            truncated: false,
            source: "git",
        })

        await manager.openFileReference("TaskModel.ts", { line: 7 })

        expect(filesApi.fuzzySearch).toHaveBeenCalledWith({
            dir: "/repo",
            query: "TaskModel.ts",
            matchDirs: false,
            limit: 12,
        })
        expect(manager.activeFile).toBe("/repo/src/store/TaskModel.ts")
        expect(manager.activeLine).toBe(7)
        expect([...manager.expandedPaths]).toEqual(["/repo", "/repo/src", "/repo/src/store"])
    })

    it("reveals normally opened files in the sidebar tree", async () => {
        const manager = new FileBrowserManager()
        manager.workingDir = "/repo"
        mockRepoFiles()

        await manager.openFile("/repo/src/store/TaskModel.ts")

        expect(manager.activeFile).toBe("/repo/src/store/TaskModel.ts")
        expect(manager.selectedPath).toBe("/repo/src/store/TaskModel.ts")
        expect([...manager.expandedPaths]).toEqual(["/repo", "/repo/src", "/repo/src/store"])
    })

    it("focuses directory references in the sidebar tree", async () => {
        const manager = new FileBrowserManager()
        manager.workingDir = "/repo"
        mockRepoFiles()

        await manager.openPathReference("src/store")

        expect(manager.activeFile).toBeNull()
        expect(manager.selectedPath).toBe("/repo/src/store")
        expect([...manager.expandedPaths]).toEqual(["/repo", "/repo/src", "/repo/src/store"])
    })

    it("opens fuzzy file matches through path references", async () => {
        const manager = new FileBrowserManager()
        manager.workingDir = "/repo"
        mockRepoFiles()
        vi.mocked(filesApi.fuzzySearch).mockResolvedValue({
            results: ["src/store/TaskModel.ts"],
            truncated: false,
            source: "git",
        })

        await manager.openPathReference("TaskModel.ts")

        expect(filesApi.fuzzySearch).toHaveBeenCalledWith({
            dir: "/repo",
            query: "TaskModel.ts",
            matchDirs: false,
            limit: 12,
        })
        expect(manager.activeFile).toBe("/repo/src/store/TaskModel.ts")
        expect(manager.selectedPath).toBe("/repo/src/store/TaskModel.ts")
    })

    it("strips chat mention markers before resolving path references", async () => {
        const manager = new FileBrowserManager()
        manager.workingDir = "/repo"
        mockRepoFiles()
        vi.mocked(filesApi.fuzzySearch).mockResolvedValue({
            results: ["src/store/TaskModel.ts"],
            truncated: false,
            source: "git",
        })

        await manager.openPathReference("@TaskModel.ts")

        expect(filesApi.fuzzySearch).toHaveBeenCalledWith({
            dir: "/repo",
            query: "TaskModel.ts",
            matchDirs: false,
            limit: 12,
        })
        expect(manager.activeFile).toBe("/repo/src/store/TaskModel.ts")
        expect(manager.selectedPath).toBe("/repo/src/store/TaskModel.ts")
    })

    it("keeps tab order stable when switching to an already-open file", async () => {
        const manager = new FileBrowserManager()
        manager.workingDir = "/repo"
        mockAnyOpenedFile()

        await manager.openFile("/repo/a.ts")
        await manager.openFile("/repo/b.ts")
        await manager.openFile("/repo/a.ts")

        expect(manager.activeFile).toBe("/repo/a.ts")
        expect(manager.openTabs.map((tab) => tab.path)).toEqual(["/repo/a.ts", "/repo/b.ts"])
    })
})
