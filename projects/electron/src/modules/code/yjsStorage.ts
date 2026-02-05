/**
 * YJS Document Storage Module for Electron
 *
 * Persists YJS documents to the filesystem at ~/.openade/data/yjs/
 * Provides load, save, delete, and list operations via IPC.
 */

import { ipcMain, type IpcMainInvokeEvent } from "electron"
import logger from "electron-log"
import * as fs from "fs/promises"
import * as path from "path"
import * as os from "os"
import * as Y from "yjs"
import { isDev } from "../../config"

// ============================================================================
// Constants
// ============================================================================

const OPENADE_DIR = ".openade"
const DATA_DIR = "data"
const YJS_DIR = "yjs"

function getYjsStorageDir(): string {
    return path.join(os.homedir(), OPENADE_DIR, DATA_DIR, YJS_DIR)
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
    return filename.replace(/_/g, ":")
}

/**
 * Get the full file path for a document ID.
 */
function getDocPath(id: string): string {
    return path.join(getYjsStorageDir(), sanitizeId(id))
}

/**
 * Ensure the storage directory exists.
 */
async function ensureStorageDir(): Promise<void> {
    await fs.mkdir(getYjsStorageDir(), { recursive: true })
}

/**
 * Check if caller is allowed.
 */
function checkAllowed(e: IpcMainInvokeEvent): boolean {
    const origin = e.sender.getURL()
    try {
        const url = new URL(origin)
        if (isDev) {
            return url.hostname.endsWith("localhost")
        } else {
            // In production, allow localhost for Electron file:// loading
        return url.hostname.endsWith("localhost") || url.protocol === "file:"
        }
    } catch (error) {
        logger.error("[YjsStorage:checkAllowed] Failed to parse origin:", error)
        return false
    }
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

/**
 * Load a YJS document from disk.
 * Returns null if the document doesn't exist.
 */
async function handleLoad(id: string): Promise<Uint8Array | null> {
    const filePath = getDocPath(id)

    try {
        const data = await fs.readFile(filePath)
        logger.debug(`[YjsStorage] Loaded document: ${id} (${data.length} bytes)`)
        return new Uint8Array(data)
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return null
        }
        throw error
    }
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

// ============================================================================
// Module Export
// ============================================================================

export const load = () => {
    logger.info("[YjsStorage] Registering IPC handlers")

    ipcMain.handle("code:yjs:save", async (event, { id, data }: { id: string; data: Uint8Array }) => {
        if (!checkAllowed(event)) throw new Error("not allowed")
        await handleSave(id, data)
        return { success: true }
    })

    ipcMain.handle("code:yjs:load", async (event, { id }: { id: string }) => {
        if (!checkAllowed(event)) throw new Error("not allowed")
        return handleLoad(id)
    })

    ipcMain.handle("code:yjs:delete", async (event, { id }: { id: string }) => {
        if (!checkAllowed(event)) throw new Error("not allowed")
        await handleDelete(id)
        return { success: true }
    })

    ipcMain.handle("code:yjs:list", async (event) => {
        if (!checkAllowed(event)) throw new Error("not allowed")
        return handleList()
    })

    logger.info("[YjsStorage] IPC handlers registered successfully")
}

export const cleanup = () => {
    logger.info("[YjsStorage] Cleanup called (no active resources to clean)")
    // No active resources to clean up - files are persisted
}
