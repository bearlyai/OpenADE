import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import logger from "electron-log"
import * as Y from "yjs"
import { afterEach, describe, expect, it, vi } from "vitest"
import { loadYjsDocument, runWithYjsDocumentOperationContext, saveYjsDocument } from "./yjsStorage"

let storageDir = ""

function valueFromUpdate(data: Uint8Array, key: string): unknown {
    const doc = new Y.Doc()
    try {
        Y.applyUpdate(doc, data)
        return doc.getMap("pending").get(key)
    } finally {
        doc.destroy()
    }
}

function updateWithValue(value: string): Uint8Array {
    const doc = new Y.Doc()
    try {
        doc.getMap("pending").set("value", value)
        return Y.encodeStateAsUpdate(doc)
    } finally {
        doc.destroy()
    }
}

function docPath(id: string): string {
    return path.join(storageDir, id.replace(/:/g, "_"))
}

function wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

describe("Yjs filesystem storage", () => {
    afterEach(() => {
        vi.restoreAllMocks()
        delete process.env.OPENADE_YJS_STORAGE_DIR
        if (storageDir) fs.rmSync(storageDir, { recursive: true, force: true })
        storageDir = ""
    })

    it("waits for an in-flight save before loading the same document", async () => {
        storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "openade-yjs-storage-"))
        process.env.OPENADE_YJS_STORAGE_DIR = storageDir

        const doc = new Y.Doc()
        doc.getMap("pending").set("value", "read-after-write")
        const update = Y.encodeStateAsUpdate(doc)
        doc.destroy()
        const savePromise = saveYjsDocument("code:pending-read", update)

        const loaded = await loadYjsDocument("code:pending-read")
        await savePromise

        if (!loaded) throw new Error("Expected pending document save to be readable")
        expect(valueFromUpdate(loaded, "value")).toBe("read-after-write")
    })

    it("invalidates cached reads after saving a document", async () => {
        storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "openade-yjs-storage-"))
        process.env.OPENADE_YJS_STORAGE_DIR = storageDir

        await saveYjsDocument("code:cached-read", updateWithValue("before"))

        const firstLoaded = await loadYjsDocument("code:cached-read")
        if (!firstLoaded) throw new Error("Expected cached-read document")
        expect(valueFromUpdate(firstLoaded, "value")).toBe("before")

        await saveYjsDocument("code:cached-read", updateWithValue("after"))

        const secondLoaded = await loadYjsDocument("code:cached-read")
        if (!secondLoaded) throw new Error("Expected cached-read document after save")
        expect(valueFromUpdate(secondLoaded, "value")).toBe("after")
    })

    it("serves cached loads across short refresh-loop gaps", async () => {
        storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "openade-yjs-storage-"))
        process.env.OPENADE_YJS_STORAGE_DIR = storageDir

        const id = "code:cached-refresh-loop"
        await saveYjsDocument(id, updateWithValue("before"))
        await wait(1_100)

        fs.writeFileSync(docPath(id), updateWithValue("external-after"))

        const loaded = await loadYjsDocument(id)
        if (!loaded) throw new Error("Expected cached-refresh-loop document")
        expect(valueFromUpdate(loaded, "value")).toBe("before")
    })

    it("adds runtime method context to slow document load logs", async () => {
        storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "openade-yjs-storage-"))
        process.env.OPENADE_YJS_STORAGE_DIR = storageDir

        const id = "code:context-load"
        fs.writeFileSync(docPath(id), updateWithValue("from-disk"))
        const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined)
        let now = 1_000
        vi.spyOn(Date, "now").mockImplementation(() => {
            const current = now
            now += 300
            return current
        })

        const loaded = await runWithYjsDocumentOperationContext({ runtimeMethod: "openade/task/read" }, () =>
            loadYjsDocument(id, { operation: "readDocumentUpdate" })
        )

        if (!loaded) throw new Error("Expected context-load document")
        expect(valueFromUpdate(loaded, "value")).toBe("from-disk")
        const slowLoad = warn.mock.calls.find(([message]) => message === "[YjsStorage] Slow document load")
        expect(slowLoad).toBeDefined()
        const details = JSON.parse(String(slowLoad?.[1]))
        expect(details).toMatchObject({
            id,
            runtimeMethod: "openade/task/read",
            operation: "readDocumentUpdate",
        })
        expect(JSON.stringify(details)).not.toContain("from-disk")
    })
})
