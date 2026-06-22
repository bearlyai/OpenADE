/**
 * YJS Document Storage Module for Electron
 *
 * Persists YJS documents to the filesystem at ~/.openade/data/yjs/
 * Provides load, save, delete, and list operations to runtime host adapters.
 */

import logger from "electron-log"
import { AsyncLocalStorage } from "node:async_hooks"
import * as fs from "fs/promises"
import * as path from "path"
import * as os from "os"
import * as Y from "yjs"

// ============================================================================
// Constants
// ============================================================================

const OPENADE_DIR = ".openade"
const DATA_DIR = "data"
const YJS_DIR = "yjs"

function getYjsStorageDir(): string {
    if (process.env.OPENADE_YJS_STORAGE_DIR) return process.env.OPENADE_YJS_STORAGE_DIR
    return path.join(os.homedir(), OPENADE_DIR, DATA_DIR, YJS_DIR)
}

function getLegacyNestedYjsStorageDir(): string {
    return path.join(os.homedir(), OPENADE_DIR, OPENADE_DIR, DATA_DIR, YJS_DIR)
}

// Per-document save queue to prevent race conditions
const saveQueues = new Map<string, Promise<void>>()
const LOAD_CACHE_TTL_MS = 15_000
const LOAD_CACHE_MAX_DOCUMENTS = 96
const LOAD_CACHE_MAX_BYTES = 160 * 1024 * 1024
const LOAD_CACHE_INVALIDATION_MAX_DOCUMENTS = 128
const SLOW_YJS_LOAD_MS = 250
const SLOW_YJS_SAVE_MS = 500
const YJS_LOAD_BURST_WINDOW_MS = 5_000
const YJS_LOAD_BURST_COUNT = 8

type LoadCacheInvalidationReason = "save" | "delete" | "evicted" | "expired"

interface LoadCacheEntry {
    data: Uint8Array | null
    expiresAt: number
}

interface LoadCacheInvalidation {
    reason: LoadCacheInvalidationReason
    at: number
}

interface LoadBurstEntry {
    startedAt: number
    count: number
    lastWarnedCount: number
}

export interface YjsDocumentOperationContext {
    runtimeMethod?: string
    runtimeRequestId?: string
    operation?: string
}

const loadQueues = new Map<string, Promise<Uint8Array | null>>()
const loadCache = new Map<string, LoadCacheEntry>()
let loadCacheBytes = 0
const loadCacheInvalidations = new Map<string, LoadCacheInvalidation>()
const loadBursts = new Map<string, LoadBurstEntry>()
const operationContext = new AsyncLocalStorage<YjsDocumentOperationContext>()
const PROTECTED_LOAD_CACHE_DOCUMENTS = new Set(["code:personal_settings", "code:repos", "code:mcp_servers"])

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Sanitize document ID for safe filesystem usage.
 * Replaces colons with underscores and validates no path traversal.
 */
function sanitizeId(id: string): string {
    // Replace colons with underscores (e.g., "code:repos" -> "code_repos")
    const sanitized = id.replace(/:/g, "_")

    // Validate no path traversal
    if (sanitized.includes("..") || sanitized.includes("/") || sanitized.includes("\\")) {
        throw new Error(`Invalid document ID: ${id}`)
    }

    return sanitized
}

/**
 * Unsanitize document ID (convert back from filesystem name).
 * Replaces underscores with colons.
 */
function unsanitizeId(filename: string): string {
    if (filename === "code_repos") return "code:repos"
    if (filename === "code_personal_settings") return "code:personal_settings"
    if (filename === "code_mcp_servers") return "code:mcp_servers"
    if (filename.startsWith("code_task_")) return `code:task:${filename.slice("code_task_".length)}`
    if (filename.startsWith("code_scratchpad-index_")) return `code:scratchpad-index:${filename.slice("code_scratchpad-index_".length)}`
    if (filename.startsWith("code_scratchpad_")) return `code:scratchpad:${filename.slice("code_scratchpad_".length)}`
    return filename.replace(/_/g, ":")
}

/**
 * Get the full file path for a document ID.
 */
function getDocPath(id: string): string {
    return path.join(getYjsStorageDir(), sanitizeId(id))
}

function getLegacyNestedDocPath(id: string): string {
    return path.join(getLegacyNestedYjsStorageDir(), sanitizeId(id))
}

/**
 * Ensure the storage directory exists.
 */
async function ensureStorageDir(): Promise<void> {
    await fs.mkdir(getYjsStorageDir(), { recursive: true })
}

async function awaitPendingSave(id: string): Promise<void> {
    await (saveQueues.get(id) ?? Promise.resolve())
}

async function awaitPendingSaves(): Promise<void> {
    await Promise.all(Array.from(saveQueues.values()))
}

function rememberLoadCacheInvalidation(id: string, reason: LoadCacheInvalidationReason): void {
    loadCacheInvalidations.delete(id)
    loadCacheInvalidations.set(id, { reason, at: Date.now() })
    while (loadCacheInvalidations.size > LOAD_CACHE_INVALIDATION_MAX_DOCUMENTS) {
        const oldestKey = loadCacheInvalidations.keys().next().value
        if (typeof oldestKey !== "string") break
        loadCacheInvalidations.delete(oldestKey)
    }
}

function clearLoadCache(id: string, reason: LoadCacheInvalidationReason): void {
    const cached = loadCache.get(id)
    if (cached) loadCacheBytes -= cached.data?.byteLength ?? 0
    loadCache.delete(id)
    loadQueues.delete(id)
    rememberLoadCacheInvalidation(id, reason)
}

function evictLoadCacheEntry(id: string): void {
    const cached = loadCache.get(id)
    if (cached) loadCacheBytes -= cached.data?.byteLength ?? 0
    loadCache.delete(id)
    rememberLoadCacheInvalidation(id, "evicted")
}

function oldestEvictableLoadCacheKey(): string | null {
    for (const key of loadCache.keys()) {
        if (!PROTECTED_LOAD_CACHE_DOCUMENTS.has(key)) return key
    }
    return null
}

function cacheLoadedDocument(id: string, data: Uint8Array | null): Uint8Array | null {
    const existing = loadCache.get(id)
    if (existing) loadCacheBytes -= existing.data?.byteLength ?? 0
    loadCache.delete(id)
    loadCache.set(id, { data, expiresAt: Date.now() + LOAD_CACHE_TTL_MS })
    loadCacheBytes += data?.byteLength ?? 0
    while ((loadCache.size > LOAD_CACHE_MAX_DOCUMENTS || loadCacheBytes > LOAD_CACHE_MAX_BYTES) && loadCache.size > 1) {
        const oldestKey = oldestEvictableLoadCacheKey()
        if (!oldestKey) break
        evictLoadCacheEntry(oldestKey)
    }
    return data
}

function getCachedLoadedDocument(id: string): Uint8Array | null | undefined {
    const cached = loadCache.get(id)
    if (!cached) return undefined
    if (cached.expiresAt <= Date.now()) {
        loadCacheBytes -= cached.data?.byteLength ?? 0
        loadCache.delete(id)
        rememberLoadCacheInvalidation(id, "expired")
        return undefined
    }

    loadCache.delete(id)
    loadCache.set(id, cached)
    return cached.data
}

function sanitizeLogLabel(value: string | undefined): string | undefined {
    const trimmed = value?.trim()
    if (!trimmed) return undefined
    const printable = trimmed.replace(/[^\x20-\x7E]/g, "?")
    return printable.length > 120 ? `${printable.slice(0, 120)}...` : printable
}

function currentOperationContext(options: YjsDocumentOperationContext = {}): YjsDocumentOperationContext {
    const stored = operationContext.getStore()
    return {
        runtimeMethod: sanitizeLogLabel(options.runtimeMethod ?? stored?.runtimeMethod),
        runtimeRequestId: sanitizeLogLabel(options.runtimeRequestId ?? stored?.runtimeRequestId),
        operation: sanitizeLogLabel(options.operation ?? stored?.operation),
    }
}

function operationContextFields(context: YjsDocumentOperationContext): Record<string, string> {
    return {
        ...(context.runtimeMethod ? { runtimeMethod: context.runtimeMethod } : {}),
        ...(context.runtimeRequestId ? { runtimeRequestId: context.runtimeRequestId } : {}),
        ...(context.operation ? { operation: context.operation } : {}),
    }
}

function loadCacheMissFields(id: string): Record<string, number | string> {
    const invalidation = loadCacheInvalidations.get(id)
    return {
        cacheMissReason: invalidation?.reason ?? "cold",
        cacheMissAgeMs: invalidation ? Date.now() - invalidation.at : 0,
        loadCacheSize: loadCache.size,
        loadCacheBytes,
        pid: process.pid,
    }
}

function loadLogFields(id: string, size: number, context: YjsDocumentOperationContext): Record<string, number | string> {
    return {
        id,
        size,
        ...loadCacheMissFields(id),
        ...operationContextFields(context),
    }
}

function loadLogDetails(id: string, size: number, context: YjsDocumentOperationContext): string {
    return JSON.stringify(loadLogFields(id, size, context))
}

export function runWithYjsDocumentOperationContext<T>(context: YjsDocumentOperationContext, run: () => T): T {
    return operationContext.run(currentOperationContext(context), run)
}

function recordYjsLoad(id: string, data: Uint8Array | null, durationMs: number, context: YjsDocumentOperationContext): void {
    const size = data?.length ?? 0
    const fields = loadLogFields(id, size, context)
    if (durationMs >= SLOW_YJS_LOAD_MS) {
        logger.warn("[YjsStorage] Slow document load", JSON.stringify({ ...fields, durationMs }))
    }

    const now = Date.now()
    const existing = loadBursts.get(id)
    const burst = existing && now - existing.startedAt <= YJS_LOAD_BURST_WINDOW_MS
        ? existing
        : { startedAt: now, count: 0, lastWarnedCount: 0 }
    burst.count += 1
    if (burst.count >= YJS_LOAD_BURST_COUNT && burst.count - burst.lastWarnedCount >= YJS_LOAD_BURST_COUNT) {
        burst.lastWarnedCount = burst.count
        logger.warn(
            "[YjsStorage] Repeated document loads",
            JSON.stringify({ ...fields, count: burst.count, windowMs: now - burst.startedAt })
        )
    }
    loadBursts.set(id, burst)
    loadCacheInvalidations.delete(id)
}

function recordYjsSave(id: string, size: number, durationMs: number, context: YjsDocumentOperationContext): void {
    if (durationMs < SLOW_YJS_SAVE_MS) return
    logger.warn("[YjsStorage] Slow document save", JSON.stringify({ id, size, durationMs, ...operationContextFields(context) }))
}

function expectedTaskMetaId(id: string): string | null {
    return id.startsWith("code:task:") ? id.slice("code:task:".length) : null
}

function readTaskMetaId(data: Uint8Array): string | null {
    const doc = new Y.Doc()
    try {
        Y.applyUpdate(doc, data)
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

async function writeMigratedDoc(filePath: string, data: Uint8Array): Promise<void> {
    await ensureStorageDir()
    const tempPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`
    await fs.writeFile(tempPath, data)
    await fs.rename(tempPath, filePath)
}

// ============================================================================
// Storage Operations
// ============================================================================

/**
 * Save a YJS document to disk.
 * Uses atomic write (temp file + rename) to prevent corruption.
 * Merges incoming data with existing disk state to never lose data.
 * Serializes saves per document to prevent race conditions.
 */
async function handleSave(id: string, data: Uint8Array, options: YjsDocumentOperationContext = {}): Promise<void> {
    const logContext = currentOperationContext(options)
    const pendingLoad = loadQueues.get(id) ?? Promise.resolve()
    const startedAt = Date.now()
    // Chain this save after any pending save for the same document
    const prevSave = saveQueues.get(id) ?? Promise.resolve()

    const currentSave = prevSave.then(async () => {
        await pendingLoad
        clearLoadCache(id, "save")
        await ensureStorageDir()

        const filePath = getDocPath(id)
        const tempPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`

        let doc: Y.Doc | null = null
        try {
            // Load existing state if present
            let existingData: Buffer | null = null
            try {
                existingData = await fs.readFile(filePath)
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
                    throw error
                }
                // File doesn't exist yet, that's fine
            }

            // Fast path: if incoming data exactly matches existing, skip the save
            if (existingData && existingData.length === data.length) {
                let identical = true
                for (let i = 0; i < data.length; i++) {
                    if (existingData[i] !== data[i]) {
                        identical = false
                        break
                    }
                }
                if (identical) {
                    cacheLoadedDocument(id, new Uint8Array(existingData))
                    logger.debug(`[YjsStorage] Skipped save (unchanged): ${id} (${data.length} bytes)`)
                    return
                }
            }

            // Merge with existing data to never lose updates
            doc = new Y.Doc()

            if (existingData) {
                Y.applyUpdate(doc, new Uint8Array(existingData))
            }

            // Apply incoming update (merges with existing via CRDT)
            Y.applyUpdate(doc, data)

            // Encode merged state
            const mergedState = Y.encodeStateAsUpdate(doc)

            // Atomic write: write to temp file, then rename
            await fs.writeFile(tempPath, mergedState)
            await fs.rename(tempPath, filePath)
            cacheLoadedDocument(id, mergedState)
            recordYjsSave(id, mergedState.length, Date.now() - startedAt, logContext)

            logger.debug(`[YjsStorage] Saved document: ${id} (${mergedState.length} bytes)`)
        } catch (error) {
            // Clean up temp file if it exists
            try {
                await fs.unlink(tempPath)
            } catch {
                // Ignore cleanup errors
            }
            throw error
        } finally {
            // Destroy the temporary Y.Doc to free memory immediately
            if (doc) {
                doc.destroy()
            }
        }
    }).finally(() => {
        // Clean up queue entry if this was the last operation
        if (saveQueues.get(id) === currentSave) {
            saveQueues.delete(id)
        }
    })

    // Store in queue, catching errors to prevent rejection from blocking future saves
    saveQueues.set(id, currentSave.catch(() => {}))
    return currentSave
}

export async function saveYjsDocument(id: string, data: Uint8Array, options: YjsDocumentOperationContext = {}): Promise<void> {
    await handleSave(id, data, options)
}

/**
 * Load a YJS document from disk.
 * Returns null if the document doesn't exist.
 */
async function handleLoad(id: string, options: YjsDocumentOperationContext = {}): Promise<Uint8Array | null> {
    const logContext = currentOperationContext(options)
    const startedAt = Date.now()
    await awaitPendingSave(id)
    const cached = getCachedLoadedDocument(id)
    if (cached !== undefined) return cached

    const queued = loadQueues.get(id)
    if (queued) return queued

    const filePath = getDocPath(id)
    const legacyNestedPath = getLegacyNestedDocPath(id)

    const load = (async () => {
        try {
            const data = new Uint8Array(await fs.readFile(filePath))
            if (isExpectedTaskDoc(id, data)) {
                const loaded = cacheLoadedDocument(id, data)
                logger.debug(`[YjsStorage] Loaded document: ${id} (${data.length} bytes) ${loadLogDetails(id, data.length, logContext)}`)
                return loaded
            }

            try {
                const legacyData = new Uint8Array(await fs.readFile(legacyNestedPath))
                if (isExpectedTaskDoc(id, legacyData)) {
                    await writeMigratedDoc(filePath, legacyData)
                    logger.warn(`[YjsStorage] Recovered task document from legacy nested path: ${id}`)
                    return cacheLoadedDocument(id, legacyData)
                }
            } catch (legacyError) {
                if ((legacyError as NodeJS.ErrnoException).code !== "ENOENT") {
                    logger.warn(`[YjsStorage] Failed to inspect legacy nested document for ${id}:`, legacyError)
                }
            }

            logger.warn(`[YjsStorage] Loaded task document with mismatched metadata: ${id}`)
            return cacheLoadedDocument(id, data)
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {
                try {
                    const legacyData = new Uint8Array(await fs.readFile(legacyNestedPath))
                    if (isExpectedTaskDoc(id, legacyData)) {
                        await writeMigratedDoc(filePath, legacyData)
                        logger.warn(`[YjsStorage] Migrated task document from legacy nested path: ${id}`)
                        return cacheLoadedDocument(id, legacyData)
                    }
                } catch (legacyError) {
                    if ((legacyError as NodeJS.ErrnoException).code !== "ENOENT") {
                        logger.warn(`[YjsStorage] Failed to load legacy nested document for ${id}:`, legacyError)
                    }
                }
                return cacheLoadedDocument(id, null)
            }
            throw error
        }
    })().finally(() => {
        if (loadQueues.get(id) === load) {
            loadQueues.delete(id)
        }
    })

    loadQueues.set(id, load)
    const data = await load
    recordYjsLoad(id, data, Date.now() - startedAt, logContext)
    return data
}

export async function loadYjsDocument(id: string, options: YjsDocumentOperationContext = {}): Promise<Uint8Array | null> {
    return handleLoad(id, options)
}

/**
 * Delete a YJS document from disk.
 */
async function handleDelete(id: string): Promise<void> {
    await (loadQueues.get(id) ?? Promise.resolve())
    clearLoadCache(id, "delete")
    await awaitPendingSave(id)

    const filePath = getDocPath(id)

    try {
        await fs.unlink(filePath)
        logger.debug(`[YjsStorage] Deleted document: ${id}`)
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            // Already deleted, ignore
            return
        }
        throw error
    }
}

export async function deleteYjsDocument(id: string): Promise<void> {
    await handleDelete(id)
}

/**
 * List all document IDs in storage.
 */
async function handleList(): Promise<string[]> {
    await awaitPendingSaves()

    try {
        const files = await fs.readdir(getYjsStorageDir())

        // Filter out temp files and convert back to document IDs
        return files
            .filter((f) => !f.includes(".tmp."))
            .map((f) => unsanitizeId(f))
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return []
        }
        throw error
    }
}

export async function listYjsDocuments(): Promise<string[]> {
    return handleList()
}

export const cleanup = () => {
    logger.info("[YjsStorage] Cleanup called (no active resources to clean)")
    // No active resources to clean up - files are persisted
}
