import * as Y from "yjs"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { createOpenADEYjsStorageAdapter } from "./runtimeYjsAdapter"
import { loadYjsDocument, saveYjsDocument } from "../code/yjsStorage"

vi.mock("../code/yjsStorage", () => ({
    deleteYjsDocument: vi.fn(async () => undefined),
    listYjsDocuments: vi.fn(async () => []),
    loadYjsDocument: vi.fn(async () => null),
    saveYjsDocument: vi.fn(async () => undefined),
}))

function updateWithMetaValue(value: string): Uint8Array {
    const doc = new Y.Doc()
    try {
        doc.getMap("meta").set("value", value)
        return Y.encodeStateAsUpdate(doc)
    } finally {
        doc.destroy()
    }
}

describe("runtime Yjs adapter", () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it("serves repeated raw document reads from the adapter cache", async () => {
        vi.mocked(loadYjsDocument).mockResolvedValueOnce(updateWithMetaValue("cached"))

        const storage = createOpenADEYjsStorageAdapter()
        const first = await storage.readDocumentUpdate?.("code:test", { operation: "first" })
        const second = await storage.readDocumentUpdate?.("code:test", { operation: "second" })

        expect(first).toBeInstanceOf(Uint8Array)
        expect(second).toBe(first)
        expect(loadYjsDocument).toHaveBeenCalledTimes(1)
        expect(loadYjsDocument).toHaveBeenCalledWith("code:test", { operation: "first" })
    })

    it("shares cached raw bytes with projected map reads and invalidates after saves", async () => {
        vi.mocked(loadYjsDocument).mockResolvedValueOnce(updateWithMetaValue("before")).mockResolvedValueOnce(updateWithMetaValue("after"))

        const storage = createOpenADEYjsStorageAdapter()

        await expect(storage.readDocumentUpdate?.("code:test", { operation: "raw" })).resolves.toBeInstanceOf(Uint8Array)
        await expect(storage.readMapObject("code:test", "meta")).resolves.toEqual({ value: "before" })
        expect(loadYjsDocument).toHaveBeenCalledTimes(1)

        const savedUpdate = updateWithMetaValue("saved")
        await storage.saveDocumentUpdate("code:test", savedUpdate, { operation: "save" })
        await expect(storage.readMapObject("code:test", "meta")).resolves.toEqual({ value: "after" })

        expect(saveYjsDocument).toHaveBeenCalledWith("code:test", savedUpdate, { operation: "save" })
        expect(loadYjsDocument).toHaveBeenCalledTimes(2)
    })
})
