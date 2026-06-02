import { beforeEach, describe, expect, it, vi } from "vitest"
import type {
    OpenADEProjectFileReadResult,
    OpenADEProjectFilesFuzzySearchResult,
    OpenADEProjectFilesTreeEntry,
    OpenADEProjectFilesTreeResult,
} from "../../../../openade-module/src"

vi.mock("../../electronAPI/files", () => ({
    filesApi: {
        describePath: vi.fn(),
        fuzzySearch: vi.fn(),
    },
}))

import { filesApi } from "../../electronAPI/files"
import { FileBrowserManager } from "./FileBrowserManager"

type FileBrowserProductAccess = NonNullable<ConstructorParameters<typeof FileBrowserManager>[0]>
type ProductFileListArgs = Parameters<FileBrowserProductAccess["listProjectFiles"]>[0]
type ProductFileReadArgs = Parameters<FileBrowserProductAccess["readProjectFile"]>[0]
type ProductFileSearchArgs = Parameters<FileBrowserProductAccess["fuzzySearchProjectFiles"]>[0]

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

function productTreeResult(args: ProductFileListArgs): OpenADEProjectFilesTreeResult {
    const entries: OpenADEProjectFilesTreeEntry[] =
        args.path === "src"
            ? [{ name: "runtime.ts", path: "src/runtime.ts", type: "file", size: 18 }]
            : [
                  { name: "src", path: "src", type: "directory" },
                  { name: ".git", path: ".git", type: "directory" },
              ]

    return {
        repoId: args.repoId,
        taskId: args.taskId,
        path: args.path ?? "",
        truncated: false,
        entries,
    }
}

function productFileResult(args: ProductFileReadArgs): OpenADEProjectFileReadResult {
    return {
        repoId: args.repoId,
        taskId: args.taskId,
        path: args.path,
        encoding: "utf8",
        content: `content for ${args.path}`,
        size: 18,
        tooLarge: false,
        isReadable: true,
        isBinary: false,
        mediaType: "text/plain",
        previewKind: null,
    }
}

function productSearchResult(args: ProductFileSearchArgs): OpenADEProjectFilesFuzzySearchResult {
    return {
        repoId: args.repoId,
        taskId: args.taskId,
        results: ["src/runtime.ts"],
        truncated: false,
        source: "filesystem",
    }
}

function createProductAccess(overrides: Partial<FileBrowserProductAccess> = {}): FileBrowserProductAccess {
    return {
        getContext: vi.fn((_workingDir: string) => ({ repoId: "repo-1", taskId: "task-1" })),
        listProjectFiles: vi.fn(async (args: ProductFileListArgs) => productTreeResult(args)),
        readProjectFile: vi.fn(async (args: ProductFileReadArgs) => productFileResult(args)),
        fuzzySearchProjectFiles: vi.fn(async (args: ProductFileSearchArgs) => productSearchResult(args)),
        ...overrides,
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

    it("loads product-scoped directory contents without falling back to raw files API", async () => {
        const productAccess = createProductAccess()
        vi.mocked(filesApi.describePath).mockRejectedValue(new Error("legacy describe should not be used"))

        const manager = new FileBrowserManager(productAccess)
        manager.workingDir = "/repo"
        await manager.loadDirectoryContents("/repo")

        expect(productAccess.listProjectFiles).toHaveBeenCalledWith({
            repoId: "repo-1",
            taskId: "task-1",
            path: "",
            maxDepth: 0,
            maxEntries: 1000,
            includeHidden: true,
            includeGenerated: true,
        })
        expect(filesApi.describePath).not.toHaveBeenCalled()
        expect(manager.directoryContents.get("/repo")).toEqual([expect.objectContaining({ name: "src", path: "/repo/src", isDir: true })])
    })

    it("opens product-scoped files without falling back to raw files API", async () => {
        const productAccess = createProductAccess()
        vi.mocked(filesApi.describePath).mockRejectedValue(new Error("legacy describe should not be used"))

        const manager = new FileBrowserManager(productAccess)
        manager.workingDir = "/repo"

        await manager.openFile("/repo/src/runtime.ts", { line: 5 })

        expect(productAccess.readProjectFile).toHaveBeenCalledWith({
            repoId: "repo-1",
            taskId: "task-1",
            path: "src/runtime.ts",
            maxBytes: 5 * 1024 * 1024,
        })
        expect(filesApi.describePath).not.toHaveBeenCalled()
        expect(manager.activeFile).toBe("/repo/src/runtime.ts")
        expect(manager.activeFileData?.content).toBe("content for src/runtime.ts")
        expect(manager.activeLine).toBe(5)
    })

    it("resolves product-scoped fuzzy path references without falling back to raw files API", async () => {
        const productAccess = createProductAccess({
            listProjectFiles: vi.fn(async (args: ProductFileListArgs) => {
                if (args.path === "runtime.ts") throw new Error("exact path is not a directory")
                return productTreeResult(args)
            }),
            readProjectFile: vi.fn(async (args: ProductFileReadArgs) => {
                if (args.path !== "src/runtime.ts") throw new Error("exact path is not a file")
                return productFileResult(args)
            }),
        })
        vi.mocked(filesApi.fuzzySearch).mockRejectedValue(new Error("legacy fuzzy search should not be used"))
        vi.mocked(filesApi.describePath).mockRejectedValue(new Error("legacy describe should not be used"))

        const manager = new FileBrowserManager(productAccess)
        manager.workingDir = "/repo"

        await manager.openPathReference("runtime.ts")

        expect(productAccess.fuzzySearchProjectFiles).toHaveBeenCalledWith({
            repoId: "repo-1",
            taskId: "task-1",
            query: "runtime.ts",
            matchDirs: false,
            limit: 12,
            includeHidden: true,
            includeGenerated: true,
        })
        expect(filesApi.fuzzySearch).not.toHaveBeenCalled()
        expect(filesApi.describePath).not.toHaveBeenCalled()
        expect(manager.activeFile).toBe("/repo/src/runtime.ts")
    })
})
