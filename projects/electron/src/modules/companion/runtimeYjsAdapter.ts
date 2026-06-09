import * as Y from "yjs"
import type { OpenADEYjsMutationStorageAdapter } from "../../../../openade-module/src"
import { deleteYjsDocument, listYjsDocuments, loadYjsDocument, saveYjsDocument } from "../code/yjsStorage"

type JsonPrimitive = string | number | boolean | null
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }
type JsonRecord = { [key: string]: JsonValue }

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

async function loadDoc(id: string, operation: string): Promise<Y.Doc | null> {
    const data = await loadYjsDocument(id, { operation })
    return data ? applyYjsUpdate(data) : null
}

export function createOpenADEYjsStorageAdapter(options: { hostName?: () => string | undefined } = {}): OpenADEYjsMutationStorageAdapter {
    return {
        hostName: options.hostName,
        listDocuments: listYjsDocuments,
        readDocumentUpdate: (id) => loadYjsDocument(id, { operation: "readDocumentUpdate" }),
        saveDocumentUpdate: (id, data) => saveYjsDocument(id, data, { operation: "saveDocumentUpdate" }),
        deleteDocument: deleteYjsDocument,
        async readDocumentBase64(id) {
            const data = await loadYjsDocument(id, { operation: "readDocumentBase64" })
            if (!data) return null
            return { id, data: Buffer.from(data).toString("base64") }
        },
        async readMapObject(documentId, mapName) {
            const doc = await loadDoc(documentId, "readMapObject")
            if (!doc) return null
            try {
                const value = toPlain(doc.getMap(mapName))
                return isRecord(value) ? value : {}
            } finally {
                doc.destroy()
            }
        },
        async readOrderedArray<T extends Record<string, unknown>>(documentId: string, name: string): Promise<T[] | null> {
            const doc = await loadDoc(documentId, "readOrderedArray")
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
