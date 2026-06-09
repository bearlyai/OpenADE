import * as Y from "yjs"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ElectronStorage } from "./ElectronStorage"
import { loadYjsDoc, saveYjsDoc } from "../../electronAPI/yjsStorage"

vi.mock("../../electronAPI/yjsStorage", () => ({
    deleteYjsDoc: vi.fn(async () => undefined),
    loadYjsDoc: vi.fn(async () => null),
    saveYjsDoc: vi.fn(async () => undefined),
}))

describe("ElectronStorage", () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it("flushes a pending debounced save before disconnecting a document", async () => {
        const storage = new ElectronStorage()
        const connection = await storage.getYDoc("code:test")

        connection.doc.getMap("meta").set("id", "test")
        expect(saveYjsDoc).not.toHaveBeenCalled()

        connection.disconnect()

        expect(saveYjsDoc).toHaveBeenCalledTimes(1)
        expect(saveYjsDoc).toHaveBeenCalledWith("code:test", expect.any(Uint8Array))
    })

    it("preserves loaded document data when flushing on disconnect", async () => {
        const loadedDoc = new Y.Doc()
        loadedDoc.getMap("meta").set("existing", "yes")
        vi.mocked(loadYjsDoc).mockResolvedValueOnce(Y.encodeStateAsUpdate(loadedDoc))

        const storage = new ElectronStorage()
        const connection = await storage.getYDoc("code:test")

        connection.doc.getMap("meta").set("new", "yes")
        connection.disconnect()

        const saved = vi.mocked(saveYjsDoc).mock.calls[0]?.[1]
        expect(saved).toBeInstanceOf(Uint8Array)

        const roundTrip = new Y.Doc()
        Y.applyUpdate(roundTrip, saved)
        expect(roundTrip.getMap("meta").toJSON()).toEqual({ existing: "yes", new: "yes" })
    })

    it("does not skip changed refresh bytes", async () => {
        const loadedDoc = new Y.Doc()
        loadedDoc.getMap("meta").set("value", "before")
        const loadedUpdate = Y.encodeStateAsUpdate(loadedDoc)
        loadedDoc.destroy()

        const changedDoc = new Y.Doc()
        changedDoc.getMap("meta").set("value", "after")
        const changedUpdate = Y.encodeStateAsUpdate(changedDoc)
        changedDoc.destroy()

        vi.mocked(loadYjsDoc).mockResolvedValueOnce(loadedUpdate).mockResolvedValueOnce(loadedUpdate).mockResolvedValueOnce(changedUpdate)

        const storage = new ElectronStorage()
        const connection = await storage.getYDoc("code:test")

        await expect(connection.refresh()).resolves.toBe(true)
        expect(connection.doc.getMap("meta").get("value")).toBe("before")

        await expect(connection.refresh()).resolves.toBe(true)
        expect(connection.doc.getMap("meta").get("value")).toBe("after")
    })
})
