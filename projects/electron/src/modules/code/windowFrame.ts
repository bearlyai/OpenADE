/**
 * Window Frame Module for Electron Code Module
 *
 * Provides window frame customization APIs via IPC to the dashboard frontend.
 * Handles frame visibility detection and color customization for Windows title bar.
 */

import { ipcMain, type IpcMainInvokeEvent } from "electron"
import logger from "electron-log"
import Store from "electron-store"
import { isDev } from "../../config"
import { currentExecutor } from "../../executor"

// ============================================================================
// Type Definitions
// IMPORTANT: Keep in sync with projects/dashboard/src/pages/code/electronAPI/windowFrame.ts
// ============================================================================

interface FrameColors {
    symbolColor: string
    color: string
}

// ============================================================================
// State
// ============================================================================

const frameColorStore = new Store<Record<string, FrameColors>>()

const storageKey = "code-window-frame-colors"


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
        logger.error("[WindowFrame:checkAllowed] Failed to parse origin:", error)
        return false
    }
}

const updateColorsOnExecutorWindow = (color: FrameColors) => {
    const executorWindow = currentExecutor().window
    if (process.platform === "win32") {
        // this method is only available on windows.
        executorWindow?.setTitleBarOverlay(color)
    }
    frameColorStore.set(storageKey, color)
}

// ============================================================================
// IPC Handlers
// ============================================================================

/**
 * Check if window frame is enabled
 */
function handleFrameEnabled(): boolean {
    return true
}

/**
 * Set window frame colors
 */
function handleSetColors(colors: FrameColors): void {
    updateColorsOnExecutorWindow(colors)
}

// ============================================================================
// Module Export
// ============================================================================

export const load = () => {
    logger.info("[WindowFrame] Registering IPC handlers")

    ipcMain.handle("code:windowFrame:enabled", async (event) => {
        if (!checkAllowed(event)) throw new Error("not allowed")
        return handleFrameEnabled()
    })

    ipcMain.handle("code:windowFrame:setColors", async (event, colors: FrameColors) => {
        if (!checkAllowed(event)) throw new Error("not allowed")
        return handleSetColors(colors)
    })

    logger.info("[WindowFrame] IPC handlers registered successfully")
}

export const cleanup = () => {
    logger.info("[WindowFrame] Cleanup called (no active resources to clean)")
    // No active resources to clean up
}
