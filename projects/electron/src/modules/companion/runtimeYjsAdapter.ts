import * as Y from "yjs"
import type { OpenADEYjsDocumentOperationOptions, OpenADEYjsMutationStorageAdapter } from "../../../../openade-module/src"
import { deleteYjsDocument, listYjsDocuments, loadYjsDocument, saveYjsDocument } from "../code/yjsStorage"

type JsonPrimitive = string | number | boolean | null
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }
type JsonRecord = { [key: string]: JsonValue }

interface CachedPlainDocument {
    data: Uint8Array
    maps: Map<string, Record<string, unknown>>
    arrays: Map<string, Record<string, unknown>[]>
    expiresAt: number
}

interface CachedDocumentUpdate {
    data: Uint8Array | null
    expiresAt: number
}

const DOCUMENT_UPDATE_CACHE_TTL_MS = 15_000
const DOCUMENT_UPDATE_CACHE_MAX = 128
const PLAIN_DOCUMENT_CACHE_TTL_MS = DOCUMENT_UPDATE_CACHE_TTL_MS
const PLAIN_DOCUMENT_CACHE_MAX = 32

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

function sameDocumentData(left: Uint8Array, right: Uint8Array): boolean {
    if (left === right) return true
    if (left.byteLength !== right.byteLength) return false
    for (let index = 0; index < left.byteLength; index += 1) {
        if (left[index] !== right[index]) return false
    }
    return true
}

export function createOpenADEYjsStorageAdapter(options: { hostName?: () => string | undefined } = {}): OpenADEYjsMutationStorageAdapter {
    const documentUpdateCache = new Map<string, CachedDocumentUpdate>()
    const plainDocumentCache = new Map<string, CachedPlainDocument>()

    async function readDocumentUpdateCached(id: string, operation: string): Promise<Uint8Array | null> {
        const cached = documentUpdateCache.get(id)
        if (cached) {
            if (cached.expiresAt > Date.now()) {
                documentUpdateCache.delete(id)
                documentUpdateCache.set(id, {
                    ...cached,
                    expiresAt: Date.now() + DOCUMENT_UPDATE_CACHE_TTL_MS,
                })
                return cached.data
            }
            documentUpdateCache.delete(id)
        }

        const data = await loadYjsDocument(id, { operation })
        documentUpdateCache.set(id, {
            data,
            expiresAt: Date.now() + DOCUMENT_UPDATE_CACHE_TTL_MS,
        })

        while (documentUpdateCache.size > DOCUMENT_UPDATE_CACHE_MAX) {
            const oldestKey = documentUpdateCache.keys().next().value
            if (typeof oldestKey !== "string") break
            documentUpdateCache.delete(oldestKey)
        }

        return data
    }

    function clearDocumentCaches(id: string): void {
        documentUpdateCache.delete(id)
        plainDocumentCache.delete(id)
    }

    function cachedPlainDocument(id: string, data: Uint8Array): CachedPlainDocument | null {
        const cached = plainDocumentCache.get(id)
        if (!cached) return null
        if (cached.expiresAt <= Date.now() || !sameDocumentData(cached.data, data)) {
            plainDocumentCache.delete(id)
            return null
        }

        plainDocumentCache.delete(id)
        plainDocumentCache.set(id, {
            ...cached,
            expiresAt: Date.now() + PLAIN_DOCUMENT_CACHE_TTL_MS,
        })
        return cached
    }

    function rememberPlainDocument(id: string, data: Uint8Array): CachedPlainDocument {
        plainDocumentCache.delete(id)
        const cached: CachedPlainDocument = {
            data,
            maps: new Map(),
            arrays: new Map(),
            expiresAt: Date.now() + PLAIN_DOCUMENT_CACHE_TTL_MS,
        }
        plainDocumentCache.set(id, cached)

        while (plainDocumentCache.size > PLAIN_DOCUMENT_CACHE_MAX) {
            const oldestKey = plainDocumentCache.keys().next().value
            if (typeof oldestKey !== "string") break
            plainDocumentCache.delete(oldestKey)
        }
        return cached
    }

    async function readPlainDocumentValue<T>(
        id: string,
        operation: string,
        readCachedValue: (cached: CachedPlainDocument) => T | undefined,
        storeCachedValue: (cached: CachedPlainDocument, doc: Y.Doc) => T
    ): Promise<T | null> {
        const data = await readDocumentUpdateCached(id, operation)
        if (!data) {
            plainDocumentCache.delete(id)
            return null
        }

        const cached = cachedPlainDocument(id, data) ?? rememberPlainDocument(id, data)
        const cachedValue = readCachedValue(cached)
        if (cachedValue !== undefined) return cachedValue

        const doc = new Y.Doc()
        try {
            Y.applyUpdate(doc, data)
            return storeCachedValue(cached, doc)
        } finally {
            doc.destroy()
        }
    }

    return {
        hostName: options.hostName,
        listDocuments: listYjsDocuments,
        readDocumentUpdate: (id, options) => readDocumentUpdateCached(id, options?.operation ?? "readDocumentUpdate"),
        saveDocumentUpdate: async (id, data, options) => {
            clearDocumentCaches(id)
            await saveYjsDocument(id, data, { operation: options?.operation ?? "saveDocumentUpdate" })
        },
        deleteDocument: async (id) => {
            clearDocumentCaches(id)
            await deleteYjsDocument(id)
        },
        async readDocumentBase64(id: string, options?: OpenADEYjsDocumentOperationOptions) {
            const data = await readDocumentUpdateCached(id, options?.operation ?? "readDocumentBase64")
            if (!data) return null
            return { id, data: Buffer.from(data).toString("base64") }
        },
        async readMapObject(documentId, mapName) {
            return readPlainDocumentValue(
                documentId,
                "readMapObject",
                (cached) => cached.maps.get(mapName),
                (cached, doc) => {
                    const value = toPlain(doc.getMap(mapName))
                    const result = isRecord(value) ? value : {}
                    cached.maps.set(mapName, result)
                    return result
                }
            )
        },
        async readOrderedArray<T extends Record<string, unknown>>(documentId: string, name: string): Promise<T[] | null> {
            return readPlainDocumentValue(
                documentId,
                "readOrderedArray",
                (cached) => cached.arrays.get(name) as T[] | undefined,
                (cached, doc) => {
                    const dataMap = doc.getMap(`${name}:data`)
                    const orderArray = doc.getArray<string>(`${name}:order`)
                    const rows: T[] = []

                    for (const id of orderArray.toArray()) {
                        const row = toPlain(dataMap.get(id))
                        if (isRecord(row)) rows.push(row as T)
                    }

                    cached.arrays.set(name, rows)
                    return rows
                }
            )
        },
    }
}
