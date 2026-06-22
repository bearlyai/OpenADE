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
const REFRESH_DEDUPE_MIN_MS = 5_000
const REFRESH_DEDUPE_MAX_MS = 60_000
const IDLE_DOC_CACHE_TTL_MS = 30_000
const MAX_IDLE_DOC_CACHE_SIZE = 24

interface CachedDoc {
    doc: Y.Doc
    unsubscribe: () => void
    flushPendingSave: () => void
    connectionCount: number
    idleSince: number | null
    idleEvictionTimer: ReturnType<typeof setTimeout> | null
    lastAppliedUpdate: Uint8Array | null
    refreshInFlight: Promise<boolean> | null
    lastRefreshAt: number
    lastRefreshResult: boolean
    cleanRefreshDedupeMs: number
    dirty: boolean
    changeVersion: number
}

const STORAGE_REFRESH_ORIGIN = Symbol("openade-storage-refresh")

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
    if (left.byteLength !== right.byteLength) return false
    for (let index = 0; index < left.byteLength; index += 1) {
        if (left[index] !== right[index]) return false
    }
    return true
}

function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
    if (typeof timer === "object" && timer !== null && "unref" in timer && typeof timer.unref === "function") {
        timer.unref()
    }
}

function nextCleanRefreshDedupeMs(current: number): number {
    return Math.min(Math.max(current, REFRESH_DEDUPE_MIN_MS) * 2, REFRESH_DEDUPE_MAX_MS)
}

export class ElectronStorage implements StorageDriver {
    private docCache: Map<string, CachedDoc> = new Map()
    private docLoadsInFlight: Map<string, Promise<CachedDoc>> = new Map()

    async getYDoc(id: string): Promise<GetDocResult> {
        // Check cache first
        const cached = this.docCache.get(id)
        if (cached) {
            return this.connectDoc(id, cached)
        }

        const inFlight = this.docLoadsInFlight.get(id)
        if (inFlight) return this.connectDoc(id, await inFlight)

        const load = this.loadYDoc(id).finally(() => {
            if (this.docLoadsInFlight.get(id) === load) {
                this.docLoadsInFlight.delete(id)
            }
        })
        this.docLoadsInFlight.set(id, load)
        return this.connectDoc(id, await load)
    }

    async deleteDoc(id: string): Promise<void> {
        this.docLoadsInFlight.delete(id)
        this.evictDoc(id)
        await deleteYjsDoc(id, { operation: "ElectronStorage.deleteDoc" })
    }

    disconnect(): void {
        this.docLoadsInFlight.clear()
        for (const id of this.docCache.keys()) {
            this.evictDoc(id)
        }
    }

    private connectDoc(id: string, cached: CachedDoc): GetDocResult {
        if (cached.idleEvictionTimer) {
            clearTimeout(cached.idleEvictionTimer)
            cached.idleEvictionTimer = null
        }
        cached.idleSince = null
        cached.connectionCount += 1
        let disconnected = false
        return {
            doc: cached.doc,
            sync: () => this.saveDoc(id, cached.doc),
            refresh: () => this.refreshDoc(id, cached.doc),
            disconnect: () => {
                if (disconnected) return
                disconnected = true
                this.releaseDoc(id, cached.doc)
            },
        }
    }

    private async loadYDoc(id: string): Promise<CachedDoc> {
        // Create new Y.Doc and load from filesystem via IPC
        const doc = new Y.Doc()

        const savedUpdate = await loadYjsDoc(id, { operation: "ElectronStorage.initialLoad" })
        let lastAppliedUpdate: Uint8Array | null = null
        if (savedUpdate) {
            Y.applyUpdate(doc, savedUpdate)
            lastAppliedUpdate = savedUpdate
        }

        // Setup debounced save on changes
        let saveTimeout: ReturnType<typeof setTimeout> | null = null

        const flushPendingSave = () => {
            if (!saveTimeout) return
            clearTimeout(saveTimeout)
            saveTimeout = null
            this.saveDoc(id, doc).catch((e) => console.error(`[ElectronStorage] Failed to flush ${id}:`, e))
        }

        const onUpdate = (_update: Uint8Array, origin: unknown) => {
            if (origin === STORAGE_REFRESH_ORIGIN) return
            cachedDoc.changeVersion += 1
            cachedDoc.dirty = true
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
            connectionCount: 0,
            idleSince: null,
            idleEvictionTimer: null,
            lastAppliedUpdate,
            refreshInFlight: null,
            lastRefreshAt: 0,
            lastRefreshResult: lastAppliedUpdate !== null,
            cleanRefreshDedupeMs: REFRESH_DEDUPE_MIN_MS,
            dirty: false,
            changeVersion: 0,
            flushPendingSave,
            unsubscribe: () => {
                doc.off("update", onUpdate)
                flushPendingSave()
            },
        }

        this.docCache.set(id, cachedDoc)

        return cachedDoc
    }

    private async saveDoc(id: string, doc: Y.Doc): Promise<void> {
        const cached = this.docCache.get(id)
        if (cached?.doc === doc && !cached.dirty) {
            return
        }

        const update = Y.encodeStateAsUpdate(doc)
        if (cached?.doc === doc && cached.lastAppliedUpdate && sameBytes(cached.lastAppliedUpdate, update)) {
            cached.cleanRefreshDedupeMs = REFRESH_DEDUPE_MIN_MS
            cached.dirty = false
            return
        }

        const savedChangeVersion = cached?.doc === doc ? cached.changeVersion : 0
        await saveYjsDoc(id, update, { operation: "ElectronStorage.saveDoc" })
        if (cached?.doc === doc) {
            cached.lastAppliedUpdate = update
            cached.cleanRefreshDedupeMs = REFRESH_DEDUPE_MIN_MS
            cached.dirty = cached.changeVersion !== savedChangeVersion
        }
    }

    private async refreshDoc(id: string, doc: Y.Doc): Promise<boolean> {
        const cached = this.docCache.get(id)
        if (cached?.doc === doc && cached.refreshInFlight) return cached.refreshInFlight
        if (cached?.doc === doc && !cached.dirty && cached.lastRefreshAt > 0 && Date.now() - cached.lastRefreshAt < cached.cleanRefreshDedupeMs) {
            return cached.lastRefreshResult
        }

        const refresh = this.refreshDocUncoalesced(id, doc).finally(() => {
            const current = this.docCache.get(id)
            if (current?.doc === doc && current.refreshInFlight === refresh) {
                current.refreshInFlight = null
            }
        })
        if (cached?.doc === doc) cached.refreshInFlight = refresh
        return refresh
    }

    private async refreshDocUncoalesced(id: string, doc: Y.Doc): Promise<boolean> {
        const cachedAtStart = this.docCache.get(id)
        const refreshStartedDirty = cachedAtStart?.doc === doc ? cachedAtStart.dirty : false
        const refreshStartChangeVersion = cachedAtStart?.doc === doc ? cachedAtStart.changeVersion : 0
        const savedUpdate = await loadYjsDoc(id, { operation: "ElectronStorage.refreshDoc" })
        const cached = this.docCache.get(id)
        if (!savedUpdate) {
            if (cached?.doc === doc) {
                cached.lastRefreshAt = Date.now()
                cached.lastRefreshResult = false
                cached.cleanRefreshDedupeMs = nextCleanRefreshDedupeMs(cached.cleanRefreshDedupeMs)
            }
            return false
        }
        if (cached?.doc === doc && cached.lastAppliedUpdate && sameBytes(cached.lastAppliedUpdate, savedUpdate)) {
            cached.lastRefreshAt = Date.now()
            cached.lastRefreshResult = true
            cached.cleanRefreshDedupeMs = nextCleanRefreshDedupeMs(cached.cleanRefreshDedupeMs)
            return true
        }
        Y.applyUpdate(doc, savedUpdate, STORAGE_REFRESH_ORIGIN)
        if (cached?.doc === doc) {
            cached.lastAppliedUpdate = savedUpdate
            cached.lastRefreshAt = Date.now()
            cached.lastRefreshResult = true
            cached.cleanRefreshDedupeMs = REFRESH_DEDUPE_MIN_MS
            cached.dirty = refreshStartedDirty || cached.changeVersion !== refreshStartChangeVersion
        }
        return true
    }

    private releaseDoc(id: string, doc: Y.Doc): void {
        const cached = this.docCache.get(id)
        if (!cached || cached.doc !== doc) return

        cached.connectionCount = Math.max(0, cached.connectionCount - 1)
        if (cached.connectionCount > 0) return

        cached.flushPendingSave()
        this.retainIdleDoc(id, cached)
    }

    private evictDoc(id: string): void {
        const cached = this.docCache.get(id)
        if (cached) {
            if (cached.idleEvictionTimer) {
                clearTimeout(cached.idleEvictionTimer)
                cached.idleEvictionTimer = null
            }
            cached.unsubscribe()
            this.docCache.delete(id)
        }
    }

    private retainIdleDoc(id: string, cached: CachedDoc): void {
        cached.idleSince = Date.now()
        if (cached.idleEvictionTimer) clearTimeout(cached.idleEvictionTimer)
        cached.idleEvictionTimer = setTimeout(() => {
            const current = this.docCache.get(id)
            if (!current || current.connectionCount > 0) return
            this.evictDoc(id)
        }, IDLE_DOC_CACHE_TTL_MS)
        unrefTimer(cached.idleEvictionTimer)

        this.pruneIdleDocs()
    }

    private pruneIdleDocs(): void {
        const idleDocs = Array.from(this.docCache.entries())
            .filter(([, cached]) => cached.connectionCount === 0 && cached.idleSince !== null)
            .sort(([, left], [, right]) => (left.idleSince ?? 0) - (right.idleSince ?? 0))

        const overflow = idleDocs.length - MAX_IDLE_DOC_CACHE_SIZE
        if (overflow <= 0) return

        for (const [id] of idleDocs.slice(0, overflow)) {
            this.evictDoc(id)
        }
    }
}
