import * as Y from "yjs"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { SimpleLocalStorage } from "./SimpleLocalStorage"

const mockDb = vi.hoisted(() => ({
    delete: vi.fn(async (_key: string) => undefined),
    get: vi.fn(async (_key: string) => undefined as Uint8Array | undefined),
    set: vi.fn(async (_key: string, _data: Uint8Array) => undefined),
}))

vi.mock("./indexdb", () => ({
    SimpleIndexDB: vi.fn(() => mockDb),
}))

describe("SimpleLocalStorage", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockDb.get.mockResolvedValue(undefined)
    })

    it("flushes a pending debounced save before disconnecting a document", async () => {
        const storage = new SimpleLocalStorage()
        const connection = await storage.getYDoc("code:test")

        connection.doc.getMap("meta").set("id", "test")
        expect(mockDb.set).not.toHaveBeenCalled()

        connection.disconnect()

        expect(mockDb.set).toHaveBeenCalledTimes(1)
        expect(mockDb.set).toHaveBeenCalledWith("code:test", expect.any(Uint8Array))
    })

    it("preserves loaded document data when flushing on disconnect", async () => {
        const loadedDoc = new Y.Doc()
        loadedDoc.getMap("meta").set("existing", "yes")
        mockDb.get.mockResolvedValueOnce(Y.encodeStateAsUpdate(loadedDoc))

        const storage = new SimpleLocalStorage()
        const connection = await storage.getYDoc("code:test")

        connection.doc.getMap("meta").set("new", "yes")
        connection.disconnect()

        const saved = mockDb.set.mock.calls[0]?.[1]
        expect(saved).toBeInstanceOf(Uint8Array)

        const roundTrip = new Y.Doc()
        Y.applyUpdate(roundTrip, saved)
        expect(roundTrip.getMap("meta").toJSON()).toEqual({ existing: "yes", new: "yes" })
    })
})
