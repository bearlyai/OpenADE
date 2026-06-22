import * as Y from "yjs"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ElectronStorage } from "./ElectronStorage"
import { deleteYjsDoc, loadYjsDoc, saveYjsDoc } from "../../electronAPI/yjsStorage"

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
        expect(saveYjsDoc).toHaveBeenCalledWith("code:test", expect.any(Uint8Array), { operation: "ElectronStorage.saveDoc" })
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

    it("does not save an unchanged loaded document on sync or disconnect", async () => {
        const loadedDoc = new Y.Doc()
        loadedDoc.getMap("meta").set("existing", "yes")
        vi.mocked(loadYjsDoc).mockResolvedValueOnce(Y.encodeStateAsUpdate(loadedDoc))

        const storage = new ElectronStorage()
        const connection = await storage.getYDoc("code:test")

        await connection.sync()
        connection.disconnect()

        expect(saveYjsDoc).not.toHaveBeenCalled()
    })

    it("does not mark newer local changes clean when an older save finishes", async () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date("2026-06-10T12:00:00.000Z"))
        try {
            const storage = new ElectronStorage()
            const connection = await storage.getYDoc("code:test")
            let resolveFirstSave: () => void = () => undefined
            vi.mocked(saveYjsDoc)
                .mockImplementationOnce(() => {
                    connection.doc.getMap("meta").set("value", "after")
                    return new Promise<void>((resolve) => {
                        resolveFirstSave = resolve
                    })
                })
                .mockResolvedValue(undefined)

            connection.doc.getMap("meta").set("value", "before")
            const firstSave = connection.sync()
            expect(saveYjsDoc).toHaveBeenCalledTimes(1)

            resolveFirstSave()
            await firstSave
            await vi.advanceTimersByTimeAsync(1_001)

            expect(saveYjsDoc).toHaveBeenCalledTimes(2)
            const saved = vi.mocked(saveYjsDoc).mock.calls[1]?.[1]
            expect(saved).toBeInstanceOf(Uint8Array)
            const roundTrip = new Y.Doc()
            Y.applyUpdate(roundTrip, saved)
            expect(roundTrip.getMap("meta").get("value")).toBe("after")
            roundTrip.destroy()
        } finally {
            vi.useRealTimers()
        }
    })

    it("keeps local changes dirty when a storage refresh merges remote bytes", async () => {
        const initialDoc = new Y.Doc()
        initialDoc.getMap("meta").set("value", "initial")
        const initialUpdate = Y.encodeStateAsUpdate(initialDoc)
        initialDoc.destroy()

        const remoteDoc = new Y.Doc()
        remoteDoc.getMap("remote").set("value", "remote")
        const remoteUpdate = Y.encodeStateAsUpdate(remoteDoc)
        remoteDoc.destroy()

        vi.mocked(loadYjsDoc).mockResolvedValueOnce(initialUpdate).mockResolvedValueOnce(remoteUpdate)

        const storage = new ElectronStorage()
        const connection = await storage.getYDoc("code:test")
        connection.doc.getMap("local").set("value", "local")

        await expect(connection.refresh()).resolves.toBe(true)
        await connection.sync()

        expect(saveYjsDoc).toHaveBeenCalledTimes(1)
        const saved = vi.mocked(saveYjsDoc).mock.calls[0]?.[1]
        expect(saved).toBeInstanceOf(Uint8Array)
        const roundTrip = new Y.Doc()
        Y.applyUpdate(roundTrip, saved)
        expect(roundTrip.getMap("local").get("value")).toBe("local")
        expect(roundTrip.getMap("remote").get("value")).toBe("remote")
        roundTrip.destroy()
    })

    it("does not save an untouched missing document", async () => {
        const storage = new ElectronStorage()
        const connection = await storage.getYDoc("code:test")

        await connection.sync()
        connection.disconnect()

        expect(saveYjsDoc).not.toHaveBeenCalled()
    })

    it("does not save storage refresh updates back through IPC", async () => {
        const loadedDoc = new Y.Doc()
        loadedDoc.getMap("meta").set("value", "before")
        const loadedUpdate = Y.encodeStateAsUpdate(loadedDoc)
        loadedDoc.destroy()

        const changedDoc = new Y.Doc()
        Y.applyUpdate(changedDoc, loadedUpdate)
        changedDoc.getMap("meta").set("value", "after")
        const changedUpdate = Y.encodeStateAsUpdate(changedDoc)
        changedDoc.destroy()

        vi.mocked(loadYjsDoc).mockResolvedValueOnce(loadedUpdate).mockResolvedValueOnce(changedUpdate)

        const storage = new ElectronStorage()
        const connection = await storage.getYDoc("code:test")

        await expect(connection.refresh()).resolves.toBe(true)
        expect(connection.doc.getMap("meta").get("value")).toBe("after")

        connection.disconnect()

        expect(saveYjsDoc).not.toHaveBeenCalled()
    })

    it("labels initial loads, refreshes, saves, and deletes for Yjs storage diagnostics", async () => {
        const storage = new ElectronStorage()
        const connection = await storage.getYDoc("code:test")

        expect(loadYjsDoc).toHaveBeenCalledWith("code:test", { operation: "ElectronStorage.initialLoad" })

        await connection.refresh()
        expect(loadYjsDoc).toHaveBeenLastCalledWith("code:test", { operation: "ElectronStorage.refreshDoc" })

        connection.doc.getMap("meta").set("value", "after")
        await connection.sync()
        expect(saveYjsDoc).toHaveBeenCalledWith("code:test", expect.any(Uint8Array), { operation: "ElectronStorage.saveDoc" })

        await storage.deleteDoc("code:test")
        expect(deleteYjsDoc).toHaveBeenCalledWith("code:test", { operation: "ElectronStorage.deleteDoc" })
    })

    it("does not skip changed refresh bytes", async () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date("2026-06-10T12:00:00.000Z"))
        try {
            const loadedDoc = new Y.Doc()
            loadedDoc.getMap("meta").set("value", "before")
            const loadedUpdate = Y.encodeStateAsUpdate(loadedDoc)
            loadedDoc.destroy()

            const changedDoc = new Y.Doc()
            Y.applyUpdate(changedDoc, loadedUpdate)
            changedDoc.getMap("meta").set("value", "after")
            const changedUpdate = Y.encodeStateAsUpdate(changedDoc)
            changedDoc.destroy()

            vi.mocked(loadYjsDoc).mockResolvedValueOnce(loadedUpdate).mockResolvedValueOnce(loadedUpdate).mockResolvedValueOnce(changedUpdate)

            const storage = new ElectronStorage()
            const connection = await storage.getYDoc("code:test")

            await expect(connection.refresh()).resolves.toBe(true)
            expect(connection.doc.getMap("meta").get("value")).toBe("before")

            await vi.advanceTimersByTimeAsync(10_001)
            await expect(connection.refresh()).resolves.toBe(true)
            expect(connection.doc.getMap("meta").get("value")).toBe("after")
        } finally {
            vi.useRealTimers()
        }
    })

    it("dedupes recently completed clean refreshes", async () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date("2026-06-10T12:00:00.000Z"))
        try {
            const loadedDoc = new Y.Doc()
            loadedDoc.getMap("meta").set("value", "before")
            const loadedUpdate = Y.encodeStateAsUpdate(loadedDoc)
            loadedDoc.destroy()

            const changedDoc = new Y.Doc()
            Y.applyUpdate(changedDoc, loadedUpdate)
            changedDoc.getMap("meta").set("value", "after")
            const changedUpdate = Y.encodeStateAsUpdate(changedDoc)
            changedDoc.destroy()

            vi.mocked(loadYjsDoc).mockResolvedValueOnce(loadedUpdate).mockResolvedValueOnce(changedUpdate)

            const storage = new ElectronStorage()
            const connection = await storage.getYDoc("code:test")

            await expect(connection.refresh()).resolves.toBe(true)
            await expect(connection.refresh()).resolves.toBe(true)

            expect(loadYjsDoc).toHaveBeenCalledTimes(2)
            expect(connection.doc.getMap("meta").get("value")).toBe("after")
        } finally {
            vi.useRealTimers()
        }
    })

    it("backs off repeated unchanged refreshes", async () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date("2026-06-10T12:00:00.000Z"))
        try {
            const loadedDoc = new Y.Doc()
            loadedDoc.getMap("meta").set("value", "before")
            const loadedUpdate = Y.encodeStateAsUpdate(loadedDoc)
            loadedDoc.destroy()

            vi.mocked(loadYjsDoc).mockResolvedValue(loadedUpdate)

            const storage = new ElectronStorage()
            const connection = await storage.getYDoc("code:test")

            await expect(connection.refresh()).resolves.toBe(true)
            expect(loadYjsDoc).toHaveBeenCalledTimes(2)

            await vi.advanceTimersByTimeAsync(5_001)
            await expect(connection.refresh()).resolves.toBe(true)
            expect(loadYjsDoc).toHaveBeenCalledTimes(2)

            await vi.advanceTimersByTimeAsync(5_000)
            await expect(connection.refresh()).resolves.toBe(true)
            expect(loadYjsDoc).toHaveBeenCalledTimes(3)

            await vi.advanceTimersByTimeAsync(10_001)
            await expect(connection.refresh()).resolves.toBe(true)
            expect(loadYjsDoc).toHaveBeenCalledTimes(3)
        } finally {
            vi.useRealTimers()
        }
    })

    it("coalesces concurrent initial loads for the same document", async () => {
        const loadedDoc = new Y.Doc()
        loadedDoc.getMap("meta").set("value", "loaded")
        const loadedUpdate = Y.encodeStateAsUpdate(loadedDoc)
        loadedDoc.destroy()

        let resolveLoad: (update: Uint8Array) => void = () => undefined
        vi.mocked(loadYjsDoc).mockReturnValueOnce(
            new Promise((resolve) => {
                resolveLoad = resolve
            })
        )

        const storage = new ElectronStorage()
        const firstLoad = storage.getYDoc("code:test")
        const secondLoad = storage.getYDoc("code:test")

        expect(loadYjsDoc).toHaveBeenCalledTimes(1)

        resolveLoad(loadedUpdate)
        const [firstConnection, secondConnection] = await Promise.all([firstLoad, secondLoad])

        expect(firstConnection.doc).toBe(secondConnection.doc)
        expect(firstConnection.doc.getMap("meta").get("value")).toBe("loaded")

        await storage.getYDoc("code:test")
        expect(loadYjsDoc).toHaveBeenCalledTimes(1)
    })

    it("keeps recently disconnected documents hot before idle eviction", async () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date("2026-06-10T12:00:00.000Z"))
        try {
            const loadedDoc = new Y.Doc()
            loadedDoc.getMap("meta").set("value", "loaded")
            const loadedUpdate = Y.encodeStateAsUpdate(loadedDoc)
            loadedDoc.destroy()

            const reloadedDoc = new Y.Doc()
            reloadedDoc.getMap("meta").set("value", "reloaded")
            const reloadedUpdate = Y.encodeStateAsUpdate(reloadedDoc)
            reloadedDoc.destroy()

            vi.mocked(loadYjsDoc).mockResolvedValueOnce(loadedUpdate).mockResolvedValueOnce(reloadedUpdate)

            const storage = new ElectronStorage()
            const firstConnection = await storage.getYDoc("code:test")
            const secondConnection = await storage.getYDoc("code:test")

            expect(firstConnection.doc).toBe(secondConnection.doc)
            expect(loadYjsDoc).toHaveBeenCalledTimes(1)

            firstConnection.disconnect()
            firstConnection.disconnect()

            const thirdConnection = await storage.getYDoc("code:test")
            expect(thirdConnection.doc).toBe(secondConnection.doc)
            expect(loadYjsDoc).toHaveBeenCalledTimes(1)

            secondConnection.disconnect()
            thirdConnection.disconnect()

            const fourthConnection = await storage.getYDoc("code:test")
            expect(fourthConnection.doc).toBe(secondConnection.doc)
            expect(loadYjsDoc).toHaveBeenCalledTimes(1)
            fourthConnection.disconnect()

            await vi.advanceTimersByTimeAsync(30_001)

            const fifthConnection = await storage.getYDoc("code:test")
            expect(fifthConnection.doc).not.toBe(secondConnection.doc)
            expect(fifthConnection.doc.getMap("meta").get("value")).toBe("reloaded")
            expect(loadYjsDoc).toHaveBeenCalledTimes(2)
            fifthConnection.disconnect()
            storage.disconnect()
        } finally {
            vi.useRealTimers()
        }
    })

    it("bounds idle document retention", async () => {
        const storage = new ElectronStorage()
        for (let index = 0; index < 25; index += 1) {
            const doc = new Y.Doc()
            doc.getMap("meta").set("value", `doc-${index}`)
            vi.mocked(loadYjsDoc).mockResolvedValueOnce(Y.encodeStateAsUpdate(doc))
            doc.destroy()

            const connection = await storage.getYDoc(`code:test-${index}`)
            connection.disconnect()
        }

        const reloadedDoc = new Y.Doc()
        reloadedDoc.getMap("meta").set("value", "reloaded")
        vi.mocked(loadYjsDoc).mockResolvedValueOnce(Y.encodeStateAsUpdate(reloadedDoc))
        reloadedDoc.destroy()

        const oldestConnection = await storage.getYDoc("code:test-0")
        expect(oldestConnection.doc.getMap("meta").get("value")).toBe("reloaded")
        expect(loadYjsDoc).toHaveBeenCalledTimes(26)
        oldestConnection.disconnect()
        storage.disconnect()
    })

    it("retains separate handles returned from one in-flight initial load", async () => {
        const loadedDoc = new Y.Doc()
        loadedDoc.getMap("meta").set("value", "loaded")
        const loadedUpdate = Y.encodeStateAsUpdate(loadedDoc)
        loadedDoc.destroy()

        let resolveLoad: (update: Uint8Array) => void = () => undefined
        vi.mocked(loadYjsDoc).mockReturnValueOnce(
            new Promise((resolve) => {
                resolveLoad = resolve
            })
        )

        const storage = new ElectronStorage()
        const firstLoad = storage.getYDoc("code:test")
        const secondLoad = storage.getYDoc("code:test")

        resolveLoad(loadedUpdate)
        const [firstConnection, secondConnection] = await Promise.all([firstLoad, secondLoad])
        firstConnection.disconnect()

        const thirdConnection = await storage.getYDoc("code:test")
        expect(thirdConnection.doc).toBe(secondConnection.doc)
        expect(loadYjsDoc).toHaveBeenCalledTimes(1)
        secondConnection.disconnect()
        thirdConnection.disconnect()
    })

    it("coalesces concurrent refreshes for the same document", async () => {
        const loadedDoc = new Y.Doc()
        loadedDoc.getMap("meta").set("value", "before")
        const loadedUpdate = Y.encodeStateAsUpdate(loadedDoc)
        loadedDoc.destroy()

        const changedDoc = new Y.Doc()
        Y.applyUpdate(changedDoc, loadedUpdate)
        changedDoc.getMap("meta").set("value", "after")
        const changedUpdate = Y.encodeStateAsUpdate(changedDoc)
        changedDoc.destroy()

        let resolveRefresh!: (update: Uint8Array) => void
        vi.mocked(loadYjsDoc)
            .mockResolvedValueOnce(loadedUpdate)
            .mockReturnValueOnce(
                new Promise((resolve) => {
                    resolveRefresh = resolve
                })
            )

        const storage = new ElectronStorage()
        const connection = await storage.getYDoc("code:test")

        const firstRefresh = connection.refresh()
        const secondRefresh = connection.refresh()
        expect(loadYjsDoc).toHaveBeenCalledTimes(2)

        resolveRefresh(changedUpdate)
        await expect(Promise.all([firstRefresh, secondRefresh])).resolves.toEqual([true, true])

        expect(loadYjsDoc).toHaveBeenCalledTimes(2)
        expect(connection.doc.getMap("meta").get("value")).toBe("after")
    })
})
