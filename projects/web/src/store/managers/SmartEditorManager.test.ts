import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SmartEditorManager } from "./SmartEditorManager"

// Mock filesApi
vi.mock("../../electronAPI/files", () => ({
    filesApi: {
        describePath: vi.fn(),
    },
}))

import { filesApi } from "../../electronAPI/files"

const STORAGE_KEY = "code:fileUsageStats"
const WORKSPACE = "ws-1"
const DAY_MS = 24 * 60 * 60 * 1000

function seedStats(stats: Record<string, { count: number; lastUsed: number }>) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ [WORKSPACE]: stats }))
}

describe("SmartEditorManager frecency ranking", () => {
    beforeEach(() => {
        localStorage.clear()
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it("ranks recent files above old files with higher count", () => {
        const now = Date.now()
        seedStats({
            "src/old.ts": { count: 10, lastUsed: now - 14 * DAY_MS },
            "src/new.ts": { count: 3, lastUsed: now },
        })

        const manager = new SmartEditorManager("test", WORKSPACE)
        const paths = manager.favorites.map((f) => f.path)

        // new.ts (count=3, age=0) should beat old.ts (count=10, age=14d → decayed to ~2.5)
        expect(paths[0]).toBe("src/new.ts")
        expect(paths[1]).toBe("src/old.ts")
    })

    it("ranks higher count above lower count at equal recency", () => {
        const now = Date.now()
        seedStats({
            "src/low.ts": { count: 2, lastUsed: now },
            "src/high.ts": { count: 5, lastUsed: now },
        })

        const manager = new SmartEditorManager("test", WORKSPACE)
        const paths = manager.favorites.map((f) => f.path)

        expect(paths[0]).toBe("src/high.ts")
        expect(paths[1]).toBe("src/low.ts")
    })

    it("limits favorites to 5 entries", () => {
        const now = Date.now()
        const stats: Record<string, { count: number; lastUsed: number }> = {}
        for (let i = 0; i < 8; i++) {
            stats[`src/file${i}.ts`] = { count: i + 1, lastUsed: now }
        }
        seedStats(stats)

        const manager = new SmartEditorManager("test", WORKSPACE)
        expect(manager.favorites).toHaveLength(5)
    })

    it("disambiguates files with the same name using parent directory", () => {
        const now = Date.now()
        seedStats({
            "src/a/index.ts": { count: 3, lastUsed: now },
            "src/b/index.ts": { count: 2, lastUsed: now },
        })

        const manager = new SmartEditorManager("test", WORKSPACE)
        const items = manager.favorites

        expect(items[0].fileName).toBe("index.ts")
        expect(items[0].parentDir).toBe("a")
        expect(items[1].fileName).toBe("index.ts")
        expect(items[1].parentDir).toBe("b")
    })
})

describe("SmartEditorManager.validateFiles", () => {
    beforeEach(() => {
        localStorage.clear()
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it("removes files that no longer exist on disk", async () => {
        const now = Date.now()
        seedStats({
            "src/exists.ts": { count: 5, lastUsed: now },
            "src/deleted.ts": { count: 3, lastUsed: now },
        })

        const describeMock = vi.mocked(filesApi.describePath)
        describeMock.mockImplementation(async (params) => {
            if ((params as { path: string }).path.includes("deleted.ts")) {
                return { type: "not_found", path: (params as { path: string }).path }
            }
            return { type: "file", path: (params as { path: string }).path, size: 100, mode: 0o644, content: null, tooLarge: false, isReadable: true }
        })

        const manager = new SmartEditorManager("test", WORKSPACE)
        await manager.validateFiles("/repo")

        const paths = manager.favorites.map((f) => f.path)
        expect(paths).toContain("src/exists.ts")
        expect(paths).not.toContain("src/deleted.ts")
    })

    it("keeps files when describePath throws an error", async () => {
        const now = Date.now()
        seedStats({
            "src/ok.ts": { count: 5, lastUsed: now },
            "src/errored.ts": { count: 3, lastUsed: now },
        })

        const describeMock = vi.mocked(filesApi.describePath)
        describeMock.mockImplementation(async (params) => {
            if ((params as { path: string }).path.includes("errored.ts")) {
                throw new Error("IPC failed")
            }
            return { type: "file", path: (params as { path: string }).path, size: 100, mode: 0o644, content: null, tooLarge: false, isReadable: true }
        })

        const manager = new SmartEditorManager("test", WORKSPACE)
        await manager.validateFiles("/repo")

        const paths = manager.favorites.map((f) => f.path)
        expect(paths).toContain("src/ok.ts")
        expect(paths).toContain("src/errored.ts")
    })

    it("does nothing when there are no stats", async () => {
        const describeMock = vi.mocked(filesApi.describePath)

        const manager = new SmartEditorManager("test", WORKSPACE)
        await manager.validateFiles("/repo")

        expect(describeMock).not.toHaveBeenCalled()
    })

    it("does nothing when all files exist", async () => {
        const now = Date.now()
        seedStats({
            "src/a.ts": { count: 1, lastUsed: now },
        })

        const describeMock = vi.mocked(filesApi.describePath)
        describeMock.mockResolvedValue({
            type: "file",
            path: "/repo/src/a.ts",
            size: 100,
            mode: 0o644,
            content: null,
            tooLarge: false,
            isReadable: true,
        })

        const manager = new SmartEditorManager("test", WORKSPACE)
        await manager.validateFiles("/repo")

        // Stats should be unchanged
        const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}")
        expect(stored[WORKSPACE]["src/a.ts"]).toBeDefined()
    })
})
