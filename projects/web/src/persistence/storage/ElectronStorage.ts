/**
 * ElectronStorage - A storage driver that persists YJS documents to the filesystem via the trusted runtime protocol.
 *
 * Uses ~/.openade/data/yjs/ for storage with debounced saves on document changes.
 * Includes migration from IndexedDB for existing users.
 */

import * as Y from "yjs"
import { deleteYjsDoc, loadYjsDoc, saveYjsDoc } from "../../electronAPI/yjsStorage"
import type { GetDocResult, StorageDriver } from "./types"

const SAVE_DEBOUNCE_MS = 1000

interface CachedDoc {
    doc: Y.Doc
    unsubscribe: () => void
    lastAppliedUpdate: Uint8Array | null
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
    if (left.byteLength !== right.byteLength) return false
    for (let index = 0; index < left.byteLength; index += 1) {
        if (left[index] !== right[index]) return false
    }
    return true
}

export class ElectronStorage implements StorageDriver {
    private docCache: Map<string, CachedDoc> = new Map()

    async getYDoc(id: string): Promise<GetDocResult> {
        // Check cache first
        const cached = this.docCache.get(id)
        if (cached) {
            return {
                doc: cached.doc,
                sync: () => this.saveDoc(id, cached.doc),
                refresh: () => this.refreshDoc(id, cached.doc),
                disconnect: () => this.disconnectDoc(id),
            }
        }

        // Create new Y.Doc and load from filesystem via IPC
        const doc = new Y.Doc()

        const savedUpdate = await loadYjsDoc(id)
        let lastAppliedUpdate: Uint8Array | null = null
        if (savedUpdate) {
            Y.applyUpdate(doc, savedUpdate)
            lastAppliedUpdate = savedUpdate
        }

        // Setup debounced save on changes
        let saveTimeout: ReturnType<typeof setTimeout> | null = null

        const onUpdate = () => {
            if (saveTimeout) {
                clearTimeout(saveTimeout)
            }
            saveTimeout = setTimeout(() => {
                this.saveDoc(id, doc).catch((e) => console.error(`[ElectronStorage] Failed to save ${id}:`, e))
            }, SAVE_DEBOUNCE_MS)
        }

        doc.on("update", onUpdate)

        const cachedDoc: CachedDoc = {
            doc,
            lastAppliedUpdate,
            unsubscribe: () => {
                doc.off("update", onUpdate)
                if (saveTimeout) {
                    clearTimeout(saveTimeout)
                    saveTimeout = null
                    this.saveDoc(id, doc).catch((e) => console.error(`[ElectronStorage] Failed to flush ${id}:`, e))
                }
            },
        }

        this.docCache.set(id, cachedDoc)

        return {
            doc,
            sync: () => this.saveDoc(id, doc),
            refresh: () => this.refreshDoc(id, doc),
            disconnect: () => this.disconnectDoc(id),
        }
    }

    async deleteDoc(id: string): Promise<void> {
        this.disconnectDoc(id)
        await deleteYjsDoc(id)
    }

    disconnect(): void {
        for (const id of this.docCache.keys()) {
            this.disconnectDoc(id)
        }
    }

    private async saveDoc(id: string, doc: Y.Doc): Promise<void> {
        const update = Y.encodeStateAsUpdate(doc)
        await saveYjsDoc(id, update)
        const cached = this.docCache.get(id)
        if (cached?.doc === doc) {
            cached.lastAppliedUpdate = update
        }
    }

    private async refreshDoc(id: string, doc: Y.Doc): Promise<boolean> {
        const savedUpdate = await loadYjsDoc(id)
        if (!savedUpdate) return false
        const cached = this.docCache.get(id)
        if (cached?.doc === doc && cached.lastAppliedUpdate && sameBytes(cached.lastAppliedUpdate, savedUpdate)) {
            return true
        }
        Y.applyUpdate(doc, savedUpdate)
        if (cached?.doc === doc) {
            cached.lastAppliedUpdate = savedUpdate
        }
        return true
    }

    private disconnectDoc(id: string): void {
        const cached = this.docCache.get(id)
        if (cached) {
            cached.unsubscribe()
            this.docCache.delete(id)
        }
    }
}
