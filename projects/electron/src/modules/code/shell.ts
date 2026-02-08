/**
 * Shell Utilities Module for Electron
 *
 * Provides shell/OS operations via IPC to the dashboard frontend.
 * Implements directory selection dialog and opening URLs in native browser.
 */

import { ipcMain, dialog, shell, type IpcMainInvokeEvent } from "electron"
import logger from "electron-log"
import fs from "fs/promises"
import { isDev } from "../../config"

// ============================================================================
// Type Definitions
// IMPORTANT: Keep in sync with projects/dashboard/src/pages/code/electronAPI/shell.ts
// ============================================================================

interface SelectDirectoryParams {
    defaultPath?: string
}

interface SelectDirectoryResponse {
    path: string | null
}

interface OpenUrlParams {
    url: string
}

interface CreateDirectoryParams {
    path: string
}

interface CreateDirectoryResponse {
    success: boolean
    error?: string
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
        logger.error("[Shell:checkAllowed] Failed to parse origin:", error)
        return false
    }
}

// ============================================================================
// IPC Handlers
// ============================================================================

/**
 * Show directory selection dialog
 */
async function handleSelectDirectory(params: SelectDirectoryParams): Promise<SelectDirectoryResponse> {
    const startTime = Date.now()
    logger.info("[Shell:selectDirectory] Opening directory dialog", JSON.stringify({ defaultPath: params.defaultPath }))

    const result = await dialog.showOpenDialog({
        properties: ["openDirectory"],
        defaultPath: params.defaultPath,
    })

    if (result.canceled || result.filePaths.length === 0) {
        logger.info("[Shell:selectDirectory] Dialog canceled", JSON.stringify({ duration: Date.now() - startTime }))
        return { path: null }
    }

    logger.info("[Shell:selectDirectory] Directory selected", JSON.stringify({
        path: result.filePaths[0],
        duration: Date.now() - startTime,
    }))
    return { path: result.filePaths[0] }
}

/**
 * Open URL in native browser
 */
async function handleOpenUrl(params: OpenUrlParams): Promise<void> {
    const startTime = Date.now()
    logger.info("[Shell:openUrl] Opening URL in native browser", JSON.stringify({ url: params.url }))

    await shell.openExternal(params.url)

    logger.info("[Shell:openUrl] URL opened", JSON.stringify({ duration: Date.now() - startTime }))
}

/**
 * Create a directory (with recursive parent creation)
 */
async function handleCreateDirectory(params: CreateDirectoryParams): Promise<CreateDirectoryResponse> {
    const startTime = Date.now()
    logger.info("[Shell:createDirectory] Creating directory", JSON.stringify({ path: params.path }))

    try {
        if (!params.path || !params.path.trim()) {
            return { success: false, error: "Path is required" }
        }

        await fs.mkdir(params.path, { recursive: true })

        logger.info("[Shell:createDirectory] Directory created", JSON.stringify({
            path: params.path,
            duration: Date.now() - startTime,
        }))
        return { success: true }
    } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to create directory"
        logger.error("[Shell:createDirectory] Error creating directory", JSON.stringify({
            path: params.path,
            error: message,
            duration: Date.now() - startTime,
        }))
        return { success: false, error: message }
    }
}

// ============================================================================
// Module Export
// ============================================================================

export const load = () => {
    logger.info("[Shell] Registering IPC handlers")

    ipcMain.handle("code:shell:selectDirectory", async (event, params: SelectDirectoryParams) => {
        if (!checkAllowed(event)) throw new Error("not allowed")
        return handleSelectDirectory(params)
    })

    ipcMain.handle("code:shell:openUrl", async (event, params: OpenUrlParams) => {
        if (!checkAllowed(event)) throw new Error("not allowed")
        return handleOpenUrl(params)
    })

    ipcMain.handle("code:shell:createDirectory", async (event, params: CreateDirectoryParams) => {
        if (!checkAllowed(event)) throw new Error("not allowed")
        return handleCreateDirectory(params)
    })

    logger.info("[Shell] IPC handlers registered successfully")
}

export const cleanup = () => {
    logger.info("[Shell] Cleanup called (no active resources to clean)")
    // No active resources to clean up
}
