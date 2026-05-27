/**
 * YJS Document Storage Module for Electron
 *
 * Persists YJS documents to the filesystem at ~/.openade/data/yjs/
 * Provides load, save, delete, and list operations to runtime host adapters.
 */

import logger from "electron-log"
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
async function handleSave(id: string, data: Uint8Array): Promise<void> {
    // Chain this save after any pending save for the same document
    const prevSave = saveQueues.get(id) ?? Promise.resolve()

    const currentSave = prevSave.then(async () => {
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

export async function saveYjsDocument(id: string, data: Uint8Array): Promise<void> {
    await handleSave(id, data)
}

/**
 * Load a YJS document from disk.
 * Returns null if the document doesn't exist.
 */
async function handleLoad(id: string): Promise<Uint8Array | null> {
    const filePath = getDocPath(id)
    const legacyNestedPath = getLegacyNestedDocPath(id)

    try {
        const data = new Uint8Array(await fs.readFile(filePath))
        if (isExpectedTaskDoc(id, data)) {
            logger.debug(`[YjsStorage] Loaded document: ${id} (${data.length} bytes)`)
            return data
        }

        try {
            const legacyData = new Uint8Array(await fs.readFile(legacyNestedPath))
            if (isExpectedTaskDoc(id, legacyData)) {
                await writeMigratedDoc(filePath, legacyData)
                logger.warn(`[YjsStorage] Recovered task document from legacy nested path: ${id}`)
                return legacyData
            }
        } catch (legacyError) {
            if ((legacyError as NodeJS.ErrnoException).code !== "ENOENT") {
                logger.warn(`[YjsStorage] Failed to inspect legacy nested document for ${id}:`, legacyError)
            }
        }

        logger.warn(`[YjsStorage] Loaded task document with mismatched metadata: ${id}`)
        return data
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            try {
                const legacyData = new Uint8Array(await fs.readFile(legacyNestedPath))
                if (isExpectedTaskDoc(id, legacyData)) {
                    await writeMigratedDoc(filePath, legacyData)
                    logger.warn(`[YjsStorage] Migrated task document from legacy nested path: ${id}`)
                    return legacyData
                }
            } catch (legacyError) {
                if ((legacyError as NodeJS.ErrnoException).code !== "ENOENT") {
                    logger.warn(`[YjsStorage] Failed to load legacy nested document for ${id}:`, legacyError)
                }
            }
            return null
        }
        throw error
    }
}

export async function loadYjsDocument(id: string): Promise<Uint8Array | null> {
    return handleLoad(id)
}

/**
 * Delete a YJS document from disk.
 */
async function handleDelete(id: string): Promise<void> {
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
