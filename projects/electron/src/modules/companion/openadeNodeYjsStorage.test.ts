import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import * as Y from "yjs"
import { afterEach, describe, expect, it } from "vitest"
import { createOpenADENodeYjsStorage } from "../../../../openade-module/src/nodeYjsStorage"

const tmpDirs: string[] = []

async function makeStorageDirs(): Promise<{ home: string; root: string; legacy: string }> {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "openade-node-yjs-"))
    tmpDirs.push(home)
    return {
        home,
        root: path.join(home, ".openade", "data", "yjs"),
        legacy: path.join(home, ".openade", ".openade", "data", "yjs"),
    }
}

function safeId(id: string): string {
    return id.replace(/:/g, "_")
}

function taskUpdate(taskId: string): Uint8Array {
    const doc = new Y.Doc()
    try {
        doc.getMap("task:meta").set("id", taskId)
        return Y.encodeStateAsUpdate(doc)
    } finally {
        doc.destroy()
    }
}

function taskMetaId(data: Uint8Array | Buffer | null): string | null {
    if (!data) return null
    const doc = new Y.Doc()
    try {
        Y.applyUpdate(doc, new Uint8Array(data))
        const id = doc.getMap("task:meta").get("id")
        return typeof id === "string" ? id : null
    } finally {
        doc.destroy()
    }
}

async function writeDocument(root: string, id: string, data: Uint8Array): Promise<void> {
    await fs.mkdir(root, { recursive: true })
    await fs.writeFile(path.join(root, safeId(id)), data)
}

async function readDocument(root: string, id: string): Promise<Buffer | null> {
    try {
        return await fs.readFile(path.join(root, safeId(id)))
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
        throw error
    }
}

afterEach(async () => {
    await Promise.all(tmpDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe("OpenADE Node Yjs storage", () => {
    it("migrates a valid task document from the legacy nested storage path", async () => {
        const dirs = await makeStorageDirs()
        await writeDocument(dirs.legacy, "code:task:task-1", taskUpdate("task-1"))

        const storage = createOpenADENodeYjsStorage(dirs.root)
        const loaded = await storage.readDocumentUpdate("code:task:task-1")

        expect(taskMetaId(loaded)).toBe("task-1")
        expect(taskMetaId(await readDocument(dirs.root, "code:task:task-1"))).toBe("task-1")
    })

    it("recovers a mismatched current task document from a valid legacy nested copy", async () => {
        const dirs = await makeStorageDirs()
        await writeDocument(dirs.root, "code:task:task-2", taskUpdate("wrong-task"))
        await writeDocument(dirs.legacy, "code:task:task-2", taskUpdate("task-2"))

        const storage = createOpenADENodeYjsStorage(dirs.root)
        const loaded = await storage.readDocumentUpdate("code:task:task-2")

        expect(taskMetaId(loaded)).toBe("task-2")
        expect(taskMetaId(await readDocument(dirs.root, "code:task:task-2"))).toBe("task-2")
    })

    it("keeps a mismatched current task document readable when no valid recovery copy exists", async () => {
        const dirs = await makeStorageDirs()
        await writeDocument(dirs.root, "code:task:task-3", taskUpdate("wrong-task"))

        const storage = createOpenADENodeYjsStorage(dirs.root)
        const loaded = await storage.readDocumentUpdate("code:task:task-3")

        expect(taskMetaId(loaded)).toBe("wrong-task")
    })
})
