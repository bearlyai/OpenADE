import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SmartEditorManager } from "./SmartEditorManager"

// Mock filesApi
vi.mock("../../electronAPI/files", () => ({
    filesApi: {
        describePath: vi.fn(),
    },
}))

vi.mock("../../electronAPI/dataFolder", () => ({
    dataFolderApi: {
        load: vi.fn(),
        isAvailable: vi.fn(() => true),
    },
}))

import { dataFolderApi } from "../../electronAPI/dataFolder"
import { filesApi } from "../../electronAPI/files"
import type { ImageAttachment } from "../../types"

const STORAGE_KEY = "code:fileUsageStats"
const STASH_STORAGE_KEY = "code:stashedDrafts:ws-1:test"
const WORKSPACE = "ws-1"
const DAY_MS = 24 * 60 * 60 * 1000
const DOC = {
    type: "doc",
    content: [
        {
            type: "paragraph",
            content: [{ type: "text", text: "Draft alpha" }],
        },
    ],
} satisfies Record<string, unknown>

function seedStats(stats: Record<string, { count: number; lastUsed: number }>) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ [WORKSPACE]: stats }))
}

function createImage(id: string): ImageAttachment {
    return {
        id,
        mediaType: "image/png",
        ext: "png",
        originalWidth: 100,
        originalHeight: 80,
        resizedWidth: 100,
        resizedHeight: 80,
    }
}

async function waitForCondition(condition: () => boolean): Promise<void> {
    for (let i = 0; i < 20; i++) {
        if (condition()) return
        await new Promise((resolve) => setTimeout(resolve, 0))
    }
    throw new Error("Condition was not met in time")
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

describe("SmartEditorManager stashed drafts", () => {
    beforeEach(() => {
        localStorage.clear()
        vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {})
        vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:restored-preview")
        vi.mocked(dataFolderApi.load).mockResolvedValue(new Uint8Array([1, 2, 3]).buffer)
        vi.mocked(dataFolderApi.isAvailable).mockReturnValue(true)
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it("returns null when stashing an empty editor", () => {
        const manager = new SmartEditorManager("test", WORKSPACE)

        expect(manager.stashCurrentDraft()).toBeNull()
        expect(manager.stashedDrafts).toHaveLength(0)
    })

    it("stashes full editor state and clears active state without revoking transferred previews", () => {
        const manager = new SmartEditorManager("test", WORKSPACE)
        const image = createImage("img-1")

        manager.setValue("Draft alpha")
        manager.setFiles(["src/a.ts"])
        manager.setEditorContent(DOC)
        manager.addImage(image, "blob:img-1")

        const draft = manager.stashCurrentDraft()

        expect(draft).not.toBeNull()
        expect(draft?.snapshot.value).toBe("Draft alpha")
        expect(draft?.snapshot.files).toEqual(["src/a.ts"])
        expect(draft?.snapshot.editorContent).toEqual(DOC)
        expect(draft?.snapshot.pendingImages).toEqual([image])
        expect(draft?.snapshot.pendingImageDataUrls.get("img-1")).toBe("blob:img-1")
        expect(manager.value).toBe("")
        expect(manager.files).toEqual([])
        expect(manager.pendingImages).toEqual([])
        expect(manager.pendingImageDataUrls.size).toBe(0)
        expect(URL.revokeObjectURL).not.toHaveBeenCalled()
    })

    it("pops a selected stash and restores full editor state", () => {
        const manager = new SmartEditorManager("test", WORKSPACE)
        const image = createImage("img-1")

        manager.setValue("Draft alpha")
        manager.setFiles(["src/a.ts"])
        manager.setEditorContent(DOC)
        manager.addImage(image, "blob:img-1")
        const draft = manager.stashCurrentDraft()

        expect(manager.popStash(draft?.id)).toBe(true)
        expect(manager.value).toBe("Draft alpha")
        expect(manager.files).toEqual(["src/a.ts"])
        expect(manager.editorContent).toEqual(DOC)
        expect(manager.pendingImages).toEqual([image])
        expect(manager.pendingImageDataUrls.get("img-1")).toBe("blob:img-1")
        expect(manager.stashedDrafts).toHaveLength(0)
    })

    it("auto-stashes the current draft before popping another stash", () => {
        const manager = new SmartEditorManager("test", WORKSPACE)

        manager.setValue("Draft alpha")
        manager.setEditorContent(DOC)
        const first = manager.stashCurrentDraft()

        manager.setValue("Draft beta")
        manager.setEditorContent({
            type: "doc",
            content: [
                {
                    type: "paragraph",
                    content: [{ type: "text", text: "Draft beta" }],
                },
            ],
        })

        expect(manager.popStash(first?.id)).toBe(true)
        expect(manager.value).toBe("Draft alpha")
        expect(manager.stashedDrafts).toHaveLength(1)
        expect(manager.stashedDrafts[0].snapshot.value).toBe("Draft beta")
    })

    it("deletes a stash and revokes only that stash preview URLs", () => {
        const manager = new SmartEditorManager("test", WORKSPACE)

        manager.setValue("Draft alpha")
        manager.addImage(createImage("img-1"), "blob:img-1")
        const first = manager.stashCurrentDraft()

        manager.setValue("Draft beta")
        manager.addImage(createImage("img-2"), "blob:img-2")
        const second = manager.stashCurrentDraft()

        manager.deleteStash(first?.id ?? "")

        expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
        expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:img-1")
        expect(manager.stashedDrafts).toHaveLength(1)
        expect(manager.stashedDrafts[0].id).toBe(second?.id)
    })

    it("persists stashes and restores them after a refresh", async () => {
        const manager = new SmartEditorManager("test", WORKSPACE)
        const image = createImage("img-1")

        manager.setValue("Draft alpha")
        manager.setFiles(["src/a.ts"])
        manager.setEditorContent(DOC)
        manager.addImage(image, "blob:img-1")
        manager.stashCurrentDraft()

        const stored = JSON.parse(localStorage.getItem(STASH_STORAGE_KEY) || "[]")
        expect(stored).toHaveLength(1)
        expect(stored[0].snapshot.value).toBe("Draft alpha")
        expect(stored[0].snapshot.pendingImages).toEqual([image])
        expect(stored[0].snapshot.pendingImageDataUrls).toBeUndefined()

        const reloadedManager = new SmartEditorManager("test", WORKSPACE)
        await waitForCondition(() => reloadedManager.stashedDrafts.length === 1)

        expect(vi.mocked(dataFolderApi.load)).toHaveBeenCalledWith("images", "img-1", "png")
        expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
        expect(reloadedManager.stashedDrafts).toHaveLength(1)
        expect(reloadedManager.stashedDrafts[0].snapshot.value).toBe("Draft alpha")
        expect(reloadedManager.stashedDrafts[0].snapshot.pendingImageDataUrls.get("img-1")).toBe("blob:restored-preview")
    })

    it("clear can preserve preview URLs during stash transfer", () => {
        const manager = new SmartEditorManager("test", WORKSPACE)

        manager.setValue("Draft alpha")
        manager.addImage(createImage("img-1"), "blob:img-1")
        manager.clear({ revokeImagePreviews: false })

        expect(URL.revokeObjectURL).not.toHaveBeenCalled()
        expect(manager.pendingImages).toEqual([])
        expect(manager.pendingImageDataUrls.size).toBe(0)
    })
})
