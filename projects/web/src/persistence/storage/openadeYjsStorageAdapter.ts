import * as Y from "yjs"
import type { OpenADEYjsStorageAdapter } from "../../../../openade-module/src/yjsProjection"
import { listYjsDocs, loadYjsDoc } from "../../electronAPI/yjsStorage"

type JsonPrimitive = string | number | boolean | null
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }
type JsonRecord = { [key: string]: JsonValue }

export interface ElectronOpenADEYjsDocumentApi {
    listYjsDocs(): Promise<string[]>
    loadYjsDoc(id: string): Promise<Uint8Array | null>
}

const defaultDocumentApi: ElectronOpenADEYjsDocumentApi = {
    listYjsDocs,
    loadYjsDoc,
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
        return value
            .toArray()
            .map(toPlain)
            .filter((nested): nested is JsonValue => nested !== undefined)
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

function uint8ArrayToBase64(data: Uint8Array): string {
    let binary = ""
    const chunkSize = 0x8000
    for (let index = 0; index < data.length; index += chunkSize) {
        const chunk = data.subarray(index, index + chunkSize)
        binary += String.fromCharCode(...chunk)
    }
    return btoa(binary)
}

function applyYjsUpdate(data: Uint8Array): Y.Doc {
    const doc = new Y.Doc()
    Y.applyUpdate(doc, data)
    return doc
}

function readMapObjectFromDoc(doc: Y.Doc, mapName: string): Record<string, unknown> {
    const value = toPlain(doc.getMap(mapName))
    return isRecord(value) ? value : {}
}

function readOrderedArrayFromDoc<T extends Record<string, unknown>>(doc: Y.Doc, name: string): T[] {
    const dataMap = doc.getMap(`${name}:data`)
    const orderArray = doc.getArray<string>(`${name}:order`)
    const rows: T[] = []

    for (const id of orderArray.toArray()) {
        const row = toPlain(dataMap.get(id))
        if (isRecord(row)) rows.push(row as T)
    }

    return rows
}

async function loadDoc(api: ElectronOpenADEYjsDocumentApi, id: string): Promise<Y.Doc | null> {
    const data = await api.loadYjsDoc(id)
    return data ? applyYjsUpdate(data) : null
}

export function createElectronOpenADEYjsStorageAdapter(api: ElectronOpenADEYjsDocumentApi = defaultDocumentApi): OpenADEYjsStorageAdapter {
    return {
        listDocuments: () => api.listYjsDocs(),
        readDocumentUpdate: (id) => api.loadYjsDoc(id),
        async readDocumentBase64(id) {
            const data = await api.loadYjsDoc(id)
            return data ? { id, data: uint8ArrayToBase64(data) } : null
        },
        async readMapObject(documentId, mapName) {
            const doc = await loadDoc(api, documentId)
            if (!doc) return null
            try {
                return readMapObjectFromDoc(doc, mapName)
            } finally {
                doc.destroy()
            }
        },
        async readOrderedArray<T extends Record<string, unknown>>(documentId: string, name: string): Promise<T[] | null> {
            const doc = await loadDoc(api, documentId)
            if (!doc) return null
            try {
                return readOrderedArrayFromDoc<T>(doc, name)
            } finally {
                doc.destroy()
            }
        },
    }
}
