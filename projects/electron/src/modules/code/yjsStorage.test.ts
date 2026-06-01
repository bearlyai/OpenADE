import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import * as Y from "yjs"
import { afterEach, describe, expect, it } from "vitest"
import { loadYjsDocument, saveYjsDocument } from "./yjsStorage"

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

describe("Yjs filesystem storage", () => {
    afterEach(() => {
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
})
