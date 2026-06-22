import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { OpenADEProjectFileReadResult, OpenADEProjectSearchMatch, OpenADEProjectSearchResult } from "../../../../openade-module/src"

vi.mock("../../electronAPI/files", () => ({
    filesApi: {
        contentSearch: vi.fn(),
        describePath: vi.fn(),
    },
}))

import { filesApi } from "../../electronAPI/files"
import { ContentSearchManager } from "./ContentSearchManager"

type ContentSearchProductAccess = NonNullable<ConstructorParameters<typeof ContentSearchManager>[0]>
type ProductSearchArgs = Parameters<ContentSearchProductAccess["searchProject"]>[0]
type ProductFileReadArgs = Parameters<ContentSearchProductAccess["readProjectFile"]>[0]

function productSearchMatch(path = "src/runtime-search.ts"): OpenADEProjectSearchMatch {
    return {
        path,
        line: 3,
        content: "const needle = true",
        matchStart: 6,
        matchEnd: 12,
    }
}

function productSearchResult(args: ProductSearchArgs, matches: OpenADEProjectSearchMatch[] = [productSearchMatch()]): OpenADEProjectSearchResult {
    return {
        repoId: args.repoId,
        taskId: args.taskId,
        matches,
        truncated: false,
    }
}

function productFileReadResult(args: ProductFileReadArgs): OpenADEProjectFileReadResult {
    return {
        repoId: args.repoId,
        taskId: args.taskId,
        path: args.path,
        encoding: "utf8",
        size: 24,
        tooLarge: false,
        content: `file content for ${args.path}`,
        isReadable: true,
        isBinary: false,
        mediaType: "text/plain",
        previewKind: null,
    }
}

function createProductAccess(overrides: Partial<ContentSearchProductAccess> = {}): ContentSearchProductAccess {
    return {
        ownsFiles: vi.fn(() => true),
        getContext: vi.fn((_workingDir: string) => ({ repoId: "repo-1", taskId: "task-1" })),
        searchProject: vi.fn(async (args: ProductSearchArgs) => productSearchResult(args)),
        readProjectFile: vi.fn(async (args: ProductFileReadArgs) => productFileReadResult(args)),
        ...overrides,
    }
}

function createDeferred<T>() {
    let resolve!: (value: T) => void
    let reject!: (reason?: unknown) => void
    const promise = new Promise<T>((promiseResolve, promiseReject) => {
        resolve = promiseResolve
        reject = promiseReject
    })
    return { promise, resolve, reject }
}

describe("ContentSearchManager product access", () => {
    beforeEach(() => {
        vi.useFakeTimers()
        vi.mocked(filesApi.contentSearch).mockRejectedValue(new Error("legacy content search should not be used"))
        vi.mocked(filesApi.describePath).mockRejectedValue(new Error("legacy describe should not be used"))
    })

    afterEach(() => {
        vi.clearAllTimers()
        vi.useRealTimers()
        vi.restoreAllMocks()
    })

    it("searches through product access without falling back to raw files API", async () => {
        const productAccess = createProductAccess()
        const manager = new ContentSearchManager(productAccess)
        manager.setWorkingDir("/repo")

        manager.setQuery("needle")
        await vi.advanceTimersByTimeAsync(100)

        expect(productAccess.searchProject).toHaveBeenCalledWith({
            repoId: "repo-1",
            taskId: "task-1",
            query: "needle",
            limit: 100,
            caseSensitive: false,
        })
        expect(filesApi.contentSearch).not.toHaveBeenCalled()
        expect(manager.contentResults).toEqual([productSearchMatch()])
        expect(manager.contentTruncated).toBe(false)
        expect(manager.loading).toBe(false)
    })

    it("loads previews through product access without falling back to raw files API", async () => {
        const productAccess = createProductAccess()
        const manager = new ContentSearchManager(productAccess)
        manager.setWorkingDir("/repo")

        await manager.loadPreviewForMatch(productSearchMatch())

        expect(productAccess.readProjectFile).toHaveBeenCalledWith({
            repoId: "repo-1",
            taskId: "task-1",
            path: "src/runtime-search.ts",
            maxBytes: 5 * 1024 * 1024,
        })
        expect(filesApi.describePath).not.toHaveBeenCalled()
        expect(manager.previewPath).toBe("/repo/src/runtime-search.ts")
        expect(manager.previewData?.content).toBe("file content for src/runtime-search.ts")
        expect(manager.previewLoading).toBe(false)
        expect(manager.previewError).toBeNull()
    })

    it("fails closed when product context is unresolved", async () => {
        const productAccess = createProductAccess({
            getContext: vi.fn((_workingDir: string) => null),
        })
        const manager = new ContentSearchManager(productAccess)
        manager.setWorkingDir("/repo")

        manager.setQuery("needle")
        await vi.advanceTimersByTimeAsync(100)
        await manager.loadPreviewForMatch(productSearchMatch())

        expect(productAccess.searchProject).not.toHaveBeenCalled()
        expect(productAccess.readProjectFile).not.toHaveBeenCalled()
        expect(filesApi.contentSearch).not.toHaveBeenCalled()
        expect(filesApi.describePath).not.toHaveBeenCalled()
        expect(manager.contentResults).toEqual([])
        expect(manager.previewError).toBe("File not found")
        expect(manager.previewLoading).toBe(false)
    })

    it("keeps legacy content search when an adapter exists but does not own files", async () => {
        const productAccess = createProductAccess({
            ownsFiles: vi.fn(() => false),
            getContext: vi.fn(() => {
                throw new Error("product context should not be used")
            }),
            searchProject: vi.fn(async () => {
                throw new Error("product search should not be used")
            }),
            readProjectFile: vi.fn(async () => {
                throw new Error("product file read should not be used")
            }),
        })
        vi.mocked(filesApi.contentSearch).mockResolvedValue({
            matches: [
                {
                    file: "src/legacy.ts",
                    line: 7,
                    content: "const legacy = true",
                    matchStart: 6,
                    matchEnd: 12,
                },
            ],
            truncated: false,
        })
        vi.mocked(filesApi.describePath).mockResolvedValue({
            type: "file",
            path: "/repo/src/legacy.ts",
            size: 20,
            mode: 0o100644,
            content: "const legacy = true",
            tooLarge: false,
            isReadable: true,
        })
        const manager = new ContentSearchManager(productAccess)
        manager.setWorkingDir("/repo")

        manager.setQuery("legacy")
        await vi.advanceTimersByTimeAsync(100)
        await manager.loadPreviewForMatch(productSearchMatch("src/legacy.ts"))

        expect(productAccess.searchProject).not.toHaveBeenCalled()
        expect(productAccess.readProjectFile).not.toHaveBeenCalled()
        expect(filesApi.contentSearch).toHaveBeenCalledWith({
            dir: "/repo",
            query: "legacy",
            limit: 100,
            caseSensitive: false,
            regex: false,
            rankByHotFiles: true,
        })
        expect(filesApi.describePath).toHaveBeenCalledWith({
            path: "/repo/src/legacy.ts",
            readContents: true,
            maxReadSize: 5 * 1024 * 1024,
        })
        expect(manager.contentResults).toEqual([
            {
                path: "src/legacy.ts",
                line: 7,
                content: "const legacy = true",
                matchStart: 6,
                matchEnd: 12,
            },
        ])
        expect(manager.previewData?.content).toBe("const legacy = true")
    })

    it("does not apply delayed product search results after the search scope changes", async () => {
        const delayedSearch = createDeferred<OpenADEProjectSearchResult>()
        const productAccess = createProductAccess({
            getContext: vi.fn((workingDir: string) =>
                workingDir === "/repo-a" ? { repoId: "repo-a", taskId: "task-a" } : { repoId: "repo-b", taskId: "task-b" }
            ),
            searchProject: vi.fn(async (args: ProductSearchArgs) => (args.repoId === "repo-a" ? delayedSearch.promise : productSearchResult(args))),
        })
        const manager = new ContentSearchManager(productAccess)

        manager.setWorkingDir("/repo-a")
        manager.setQuery("needle")
        await vi.advanceTimersByTimeAsync(100)
        expect(manager.loading).toBe(true)

        manager.setWorkingDir("/repo-b")
        expect(manager.loading).toBe(false)

        delayedSearch.resolve(productSearchResult({ repoId: "repo-a", taskId: "task-a", query: "needle", limit: 100, caseSensitive: false }, [productSearchMatch("src/a.ts")]))
        await Promise.resolve()

        expect(manager.contentResults).toEqual([])
        expect(manager.previewPath).toBeNull()
        expect(manager.loading).toBe(false)
        expect(filesApi.contentSearch).not.toHaveBeenCalled()
    })

    it("does not apply delayed product preview results after the product context changes", async () => {
        const delayedPreview = createDeferred<OpenADEProjectFileReadResult>()
        let productContext = { repoId: "repo-a", taskId: "task-a" }
        const productAccess = createProductAccess({
            getContext: vi.fn((_workingDir: string) => productContext),
            readProjectFile: vi.fn(async (args: ProductFileReadArgs) => (args.repoId === "repo-a" ? delayedPreview.promise : productFileReadResult(args))),
        })
        const manager = new ContentSearchManager(productAccess)
        manager.setWorkingDir("/repo")

        const preview = manager.loadPreviewForMatch(productSearchMatch("src/a.ts"))
        expect(manager.previewLoading).toBe(true)

        productContext = { repoId: "repo-b", taskId: "task-b" }
        delayedPreview.resolve({
            repoId: "repo-a",
            taskId: "task-a",
            path: "src/a.ts",
            encoding: "utf8",
            size: 8,
            tooLarge: false,
            content: "stale a",
            isReadable: true,
            isBinary: false,
            mediaType: "text/plain",
            previewKind: null,
        })
        await preview

        expect(manager.previewData).toBeNull()
        expect(manager.previewError).toBeNull()
        expect(manager.previewLoading).toBe(false)
        expect(filesApi.describePath).not.toHaveBeenCalled()
    })
})
