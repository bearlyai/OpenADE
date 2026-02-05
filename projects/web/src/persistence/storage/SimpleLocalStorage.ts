/**
 * SimpleLocalStorage - A storage driver that persists YJS documents to IndexedDB.
 *
 * Uses a simple key-value model with debounced saves on document changes.
 */

import * as Y from "yjs"
import { SimpleIndexDB } from "./indexdb"
import type { GetDocResult, StorageDriver } from "./types"

const DB_NAME = "openade_code"
const SAVE_DEBOUNCE_MS = 1000

interface CachedDoc {
    doc: Y.Doc
    unsubscribe: () => void
    saveTimeout: ReturnType<typeof setTimeout> | null
}

export class SimpleLocalStorage implements StorageDriver {
    private db: SimpleIndexDB<Uint8Array>
    private docCache: Map<string, CachedDoc> = new Map()

    constructor() {
        this.db = new SimpleIndexDB<Uint8Array>(DB_NAME)
    }

    async getYDoc(id: string): Promise<GetDocResult> {
        // Check cache first
        const cached = this.docCache.get(id)
        if (cached) {
            return {
                doc: cached.doc,
                sync: () => this.saveDoc(id, cached.doc),
                disconnect: () => this.disconnectDoc(id),
            }
        }

        // Create new Y.Doc and load from IndexedDB
        const doc = new Y.Doc()

        const savedUpdate = await this.db.get(id)
        if (savedUpdate) {
            Y.applyUpdate(doc, savedUpdate)
        }

        // Setup debounced save on changes
        let saveTimeout: ReturnType<typeof setTimeout> | null = null

        const onUpdate = () => {
            if (saveTimeout) {
                clearTimeout(saveTimeout)
            }
            saveTimeout = setTimeout(() => {
                this.saveDoc(id, doc).catch((e) => console.error(`[SimpleLocalStorage] Failed to save ${id}:`, e))
            }, SAVE_DEBOUNCE_MS)
        }

        doc.on("update", onUpdate)

        const cachedDoc: CachedDoc = {
            doc,
            unsubscribe: () => {
                doc.off("update", onUpdate)
                if (saveTimeout) {
                    clearTimeout(saveTimeout)
                }
            },
            saveTimeout: null,
        }

        this.docCache.set(id, cachedDoc)

        return {
            doc,
            sync: () => this.saveDoc(id, doc),
            disconnect: () => this.disconnectDoc(id),
        }
    }

    async deleteDoc(id: string): Promise<void> {
        this.disconnectDoc(id)
        await this.db.delete(id)
    }

    disconnect(): void {
        for (const id of this.docCache.keys()) {
            this.disconnectDoc(id)
        }
    }

    private async saveDoc(id: string, doc: Y.Doc): Promise<void> {
        const update = Y.encodeStateAsUpdate(doc)
        await this.db.set(id, update)
    }

    private disconnectDoc(id: string): void {
        const cached = this.docCache.get(id)
        if (cached) {
            cached.unsubscribe()
            this.docCache.delete(id)
        }
    }
}
