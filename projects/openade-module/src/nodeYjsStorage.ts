import fs from "node:fs/promises"
import path from "node:path"
import * as Y from "yjs"

type JsonPrimitive = string | number | boolean | null
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }
type JsonRecord = { [key: string]: JsonValue }

export interface OpenADENodeYjsStorage {
    listDocuments(): Promise<string[]>
    readDocumentUpdate(id: string): Promise<Uint8Array | null>
    saveDocumentUpdate(id: string, data: Uint8Array): Promise<void>
    deleteDocument(id: string): Promise<void>
    readDocumentBase64(id: string): Promise<{ id: string; data: string } | null>
    readMapObject(documentId: string, mapName: string): Promise<Record<string, unknown> | null>
    readOrderedArray<T extends Record<string, unknown>>(documentId: string, name: string): Promise<T[] | null>
}

export interface OpenADENodeYjsStorageOptions {
    legacyNestedRootDir?: string | null
}

const saveQueues = new Map<string, Promise<void>>()

function sanitizeId(id: string): string {
    const sanitized = id.replace(/:/g, "_")
    if (sanitized.includes("..") || sanitized.includes("/") || sanitized.includes("\\")) {
        throw new Error(`Invalid document ID: ${id}`)
    }
    return sanitized
}

function unsanitizeId(filename: string): string {
    if (filename === "code_repos") return "code:repos"
    if (filename === "code_personal_settings") return "code:personal_settings"
    if (filename === "code_mcp_servers") return "code:mcp_servers"
    if (filename.startsWith("code_task_")) return `code:task:${filename.slice("code_task_".length)}`
    if (filename.startsWith("code_scratchpad-index_")) return `code:scratchpad-index:${filename.slice("code_scratchpad-index_".length)}`
    if (filename.startsWith("code_scratchpad_")) return `code:scratchpad:${filename.slice("code_scratchpad_".length)}`
    return filename.replace(/_/g, ":")
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

function toPlain(value: unknown): JsonValue | undefined {
    if (value instanceof Y.Map) {
        const result: JsonRecord = {}
        value.forEach((nested: unknown, key: string) => {
            const converted = toPlain(nested)
            if (converted !== undefined) result[key] = converted
        })
        return result
    }

    if (value instanceof Y.Array) {
        return value.toArray().map(toPlain).filter((nested): nested is JsonValue => nested !== undefined)
    }

    if (value === null || typeof value === "string" || typeof value === "boolean") return value
    if (typeof value === "number") return Number.isFinite(value) ? value : undefined

    if (Array.isArray(value)) {
        return value.map(toPlain).filter((nested): nested is JsonValue => nested !== undefined)
    }

    if (isRecord(value)) {
        const result: JsonRecord = {}
        for (const [key, nested] of Object.entries(value)) {
            const converted = toPlain(nested)
            if (converted !== undefined) result[key] = converted
        }
        return result
    }

    return undefined
}

function applyYjsUpdate(data: Uint8Array): Y.Doc {
    const doc = new Y.Doc()
    Y.applyUpdate(doc, data)
    return doc
}

function expectedTaskMetaId(id: string): string | null {
    return id.startsWith("code:task:") ? id.slice("code:task:".length) : null
}

function readTaskMetaId(data: Uint8Array): string | null {
    const doc = applyYjsUpdate(data)
    try {
        const metaId = doc.getMap("task:meta").get("id")
        return typeof metaId === "string" ? metaId : null
    } finally {
        doc.destroy()
    }
}

function isExpectedTaskDoc(id: string, data: Uint8Array): boolean {
    const expected = expectedTaskMetaId(id)
    if (!expected) return true
    try {
        return readTaskMetaId(data) === expected
    } catch {
        return false
    }
}

function defaultLegacyNestedRootDir(rootDir: string): string | null {
    const resolved = path.resolve(rootDir)
    const dataDir = path.dirname(resolved)
    const openadeDir = path.dirname(dataDir)
    if (path.basename(resolved) !== "yjs" || path.basename(dataDir) !== "data" || path.basename(openadeDir) !== ".openade") return null
    return path.join(openadeDir, ".openade", "data", "yjs")
}

export function createOpenADENodeYjsStorage(rootDir: string, options: OpenADENodeYjsStorageOptions = {}): OpenADENodeYjsStorage {
    const legacyNestedRootDir = options.legacyNestedRootDir === undefined ? defaultLegacyNestedRootDir(rootDir) : options.legacyNestedRootDir
    const docPath = (id: string) => path.join(rootDir, sanitizeId(id))
    const legacyDocPath = (id: string) => legacyNestedRootDir ? path.join(legacyNestedRootDir, sanitizeId(id)) : null
    const ensureRoot = () => fs.mkdir(rootDir, { recursive: true })

    async function writeMigratedDoc(id: string, data: Uint8Array): Promise<void> {
        await ensureRoot()
        const filePath = docPath(id)
        const tempPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`
        try {
            await fs.writeFile(tempPath, data)
            await fs.rename(tempPath, filePath)
        } catch (error) {
            await fs.unlink(tempPath).catch(() => undefined)
            throw error
        }
    }

    async function readLegacyUpdate(id: string): Promise<Uint8Array | null> {
        const filePath = legacyDocPath(id)
        if (!filePath || filePath === docPath(id)) return null
        try {
            const data = new Uint8Array(await fs.readFile(filePath))
            return isExpectedTaskDoc(id, data) ? data : null
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
            throw error
        }
    }

    async function readUpdate(id: string): Promise<Uint8Array | null> {
        try {
            const data = new Uint8Array(await fs.readFile(docPath(id)))
            if (isExpectedTaskDoc(id, data)) return data

            const legacyData = await readLegacyUpdate(id)
            if (legacyData) {
                await writeMigratedDoc(id, legacyData)
                return legacyData
            }

            return data
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {
                const legacyData = await readLegacyUpdate(id)
                if (legacyData) {
                    await writeMigratedDoc(id, legacyData)
                    return legacyData
                }
                return null
            }
            throw error
        }
    }

    async function saveUpdate(id: string, data: Uint8Array): Promise<void> {
        const previous = saveQueues.get(id) ?? Promise.resolve()
        const current = previous.then(async () => {
            await ensureRoot()
            const filePath = docPath(id)
            const tempPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`
            const doc = new Y.Doc()
            try {
                const existing = await readUpdate(id)
                if (existing) Y.applyUpdate(doc, existing)
                Y.applyUpdate(doc, data)
                await fs.writeFile(tempPath, Y.encodeStateAsUpdate(doc))
                await fs.rename(tempPath, filePath)
            } catch (error) {
                await fs.unlink(tempPath).catch(() => undefined)
                throw error
            } finally {
                doc.destroy()
            }
        })
        saveQueues.set(id, current.catch(() => undefined))
        await current.finally(() => {
            if (saveQueues.get(id) === current) saveQueues.delete(id)
        })
    }

    async function loadDoc(id: string): Promise<Y.Doc | null> {
        const data = await readUpdate(id)
        return data ? applyYjsUpdate(data) : null
    }

    return {
        async listDocuments() {
            try {
                const files = await fs.readdir(rootDir)
                return files.filter((file) => !file.includes(".tmp.")).map((file) => unsanitizeId(file))
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
                throw error
            }
        },
        readDocumentUpdate: readUpdate,
        saveDocumentUpdate: saveUpdate,
        async deleteDocument(id) {
            await fs.unlink(docPath(id)).catch((error) => {
                if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
            })
        },
        async readDocumentBase64(id) {
            const data = await readUpdate(id)
            return data ? { id, data: Buffer.from(data).toString("base64") } : null
        },
        async readMapObject(documentId, mapName) {
            const doc = await loadDoc(documentId)
            if (!doc) return null
            try {
                const value = toPlain(doc.getMap(mapName))
                return isRecord(value) ? value : {}
            } finally {
                doc.destroy()
            }
        },
        async readOrderedArray<T extends Record<string, unknown>>(documentId: string, name: string): Promise<T[] | null> {
            const doc = await loadDoc(documentId)
            if (!doc) return null
            try {
                const dataMap = doc.getMap(`${name}:data`)
                const orderArray = doc.getArray<string>(`${name}:order`)
                const rows: T[] = []
                for (const id of orderArray.toArray()) {
                    const row = toPlain(dataMap.get(id))
                    if (isRecord(row)) rows.push(row as T)
                }
                return rows
            } finally {
                doc.destroy()
            }
        },
    }
}
