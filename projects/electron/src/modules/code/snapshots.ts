/**
 * Snapshot Patch Storage Module for Electron
 *
 * Stores snapshot patches as files on the filesystem to reduce YJS document size.
 * Patches are stored at ~/.openade/snapshots/{snapshotId}.patch
 */

import { ipcMain, type IpcMainInvokeEvent } from "electron"
import * as path from "path"
import * as fs from "fs"
import * as os from "os"
import logger from "electron-log"
import { isDev } from "../../config"

// ============================================================================
// Constants
// ============================================================================

const SNAPSHOTS_DIR = path.join(os.homedir(), ".openade", "snapshots")

// ============================================================================
// Type Definitions
// ============================================================================

interface SaveParams {
    id: string
    patch: string
}

interface LoadParams {
    id: string
}

interface DeleteParams {
    id: string
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if caller is allowed
 */
function checkAllowed(e: IpcMainInvokeEvent): boolean {
    const origin = e.sender.getURL()
    try {
        const url = new URL(origin)
        if (isDev) {
            return url.hostname.endsWith("localhost")
        } else {
            return url.hostname.endsWith("localhost") || url.protocol === "file:"
        }
    } catch (error) {
        logger.error("[Snapshots:checkAllowed] Failed to parse origin:", error)
        return false
    }
}

/**
 * Sanitize snapshot ID to prevent path traversal attacks
 */
function sanitizeId(id: string): string | null {
    // Only allow alphanumeric, hyphens, and underscores (ULID format)
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
        logger.error("[Snapshots] Invalid snapshot ID:", id)
        return null
    }
    return id
}

/**
 * Get the file path for a snapshot patch
 */
function getPatchPath(id: string): string | null {
    const sanitizedId = sanitizeId(id)
    if (!sanitizedId) return null
    return path.join(SNAPSHOTS_DIR, `${sanitizedId}.patch`)
}

/**
 * Ensure the snapshots directory exists
 */
function ensureSnapshotsDir(): void {
    if (!fs.existsSync(SNAPSHOTS_DIR)) {
        fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true })
        logger.info("[Snapshots] Created snapshots directory:", SNAPSHOTS_DIR)
    }
}

// ============================================================================
// IPC Handlers
// ============================================================================

/**
 * Save a snapshot patch to the filesystem
 */
async function handleSave(params: SaveParams): Promise<void> {
    const { id, patch } = params

    const patchPath = getPatchPath(id)
    if (!patchPath) {
        throw new Error(`Invalid snapshot ID: ${id}`)
    }

    ensureSnapshotsDir()

    // Atomic write: write to temp file, then rename
    const tempPath = `${patchPath}.tmp`

    try {
        fs.writeFileSync(tempPath, patch, "utf8")
        fs.renameSync(tempPath, patchPath)
        logger.info("[Snapshots] Saved patch", { id, size: patch.length })
    } catch (error) {
        // Clean up temp file if it exists
        try {
            if (fs.existsSync(tempPath)) {
                fs.unlinkSync(tempPath)
            }
        } catch {
            // Ignore cleanup errors
        }
        throw error
    }
}

/**
 * Load a snapshot patch from the filesystem
 */
async function handleLoad(params: LoadParams): Promise<string | null> {
    const { id } = params

    const patchPath = getPatchPath(id)
    if (!patchPath) {
        logger.warn("[Snapshots] Invalid snapshot ID for load:", id)
        return null
    }

    if (!fs.existsSync(patchPath)) {
        logger.debug("[Snapshots] Patch file not found:", patchPath)
        return null
    }

    try {
        const patch = fs.readFileSync(patchPath, "utf8")
        logger.debug("[Snapshots] Loaded patch", { id, size: patch.length })
        return patch
    } catch (error) {
        logger.error("[Snapshots] Failed to read patch file:", error)
        return null
    }
}

/**
 * Delete a snapshot patch from the filesystem
 */
async function handleDelete(params: DeleteParams): Promise<void> {
    const { id } = params

    const patchPath = getPatchPath(id)
    if (!patchPath) {
        logger.warn("[Snapshots] Invalid snapshot ID for delete:", id)
        return
    }

    if (!fs.existsSync(patchPath)) {
        logger.debug("[Snapshots] Patch file already deleted:", patchPath)
        return
    }

    try {
        fs.unlinkSync(patchPath)
        logger.info("[Snapshots] Deleted patch", { id })
    } catch (error) {
        logger.error("[Snapshots] Failed to delete patch file:", error)
        // Don't throw - deletion is best-effort
    }
}

// ============================================================================
// Module Export
// ============================================================================

export const load = () => {
    logger.info("[Snapshots] Registering IPC handlers")

    ipcMain.handle("code:snapshots:save", async (event, params: SaveParams) => {
        if (!checkAllowed(event)) throw new Error("not allowed")
        return handleSave(params)
    })

    ipcMain.handle("code:snapshots:load", async (event, params: LoadParams) => {
        if (!checkAllowed(event)) throw new Error("not allowed")
        return handleLoad(params)
    })

    ipcMain.handle("code:snapshots:delete", async (event, params: DeleteParams) => {
        if (!checkAllowed(event)) throw new Error("not allowed")
        return handleDelete(params)
    })

    logger.info("[Snapshots] IPC handlers registered successfully")
}

export const cleanup = () => {
    logger.info("[Snapshots] Cleanup called")
    // No cleanup needed - files persist across sessions
}
