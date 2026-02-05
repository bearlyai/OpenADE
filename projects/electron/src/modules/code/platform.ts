/**
 * Platform Utilities Module for Electron
 *
 * Provides platform info (OS, path separator) via IPC to the dashboard frontend.
 * Enables cross-platform path handling in the renderer process.
 */

import { ipcMain, type IpcMainInvokeEvent } from "electron"
import logger from "electron-log"
import path from "path"
import os from "os"
import { isDev } from "../../config"
import { execCommand } from "./subprocess"
import { resolve as resolveBinary } from "./binaries"

// ============================================================================
// Type Definitions
// IMPORTANT: Keep in sync with projects/dashboard/src/pages/code/electronAPI/platform.ts
// ============================================================================

interface PlatformInfo {
    platform: "win32" | "darwin" | "linux"
    pathSeparator: "/" | "\\"
    homeDir: string
    isWindows: boolean
    isMac: boolean
    isLinux: boolean
}

interface BinaryCheckResult {
    installed: boolean
    path?: string
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
        logger.error("[Platform:checkAllowed] Failed to parse origin:", error)
        return false
    }
}

// ============================================================================
// IPC Handlers
// ============================================================================

/**
 * Get platform information
 */
function handleGetPlatformInfo(): PlatformInfo {
    const platform = process.platform as "win32" | "darwin" | "linux"
    return {
        platform,
        pathSeparator: path.sep as "/" | "\\",
        homeDir: os.homedir(),
        isWindows: platform === "win32",
        isMac: platform === "darwin",
        isLinux: platform === "linux",
    }
}

/**
 * Check if a binary is installed and available in PATH
 * Uses centralized subprocess runner to respect user-configured env vars (e.g., custom PATH)
 */
async function handleCheckBinary(binary: string): Promise<BinaryCheckResult> {
    const platform = process.platform
    const whichCommand = platform === "win32" ? "where" : "which"

    const result = await execCommand(whichCommand, [binary], { timeout: 5000 })

    if (result.success) {
        const binaryPath = result.stdout.trim().split("\n")[0] // Take first result on Windows (where returns multiple)
        return {
            installed: true,
            path: binaryPath,
        }
    }

    return {
        installed: false,
        error: result.stderr || "Binary not found",
    }
}

/**
 * Check if the managed ripgrep binary is present and functional.
 */
async function handleCheckVendoredRipgrep(): Promise<BinaryCheckResult> {
    const rgPath = resolveBinary("rg")
    if (!rgPath) {
        return { installed: false, error: "Managed ripgrep not available" }
    }

    return { installed: true, path: rgPath }
}

// ============================================================================
// Module Export
// ============================================================================

export const load = () => {
    logger.info("[Platform] Registering IPC handlers")

    ipcMain.handle("code:platform:getInfo", async (event) => {
        if (!checkAllowed(event)) throw new Error("not allowed")
        return handleGetPlatformInfo()
    })

    ipcMain.handle("code:system:checkBinary", async (event, { binary }: { binary: string }) => {
        if (!checkAllowed(event)) throw new Error("not allowed")
        return handleCheckBinary(binary)
    })

    ipcMain.handle("code:system:checkVendoredRipgrep", async (event) => {
        if (!checkAllowed(event)) throw new Error("not allowed")
        return handleCheckVendoredRipgrep()
    })

    logger.info("[Platform] IPC handlers registered successfully")
}

export const cleanup = () => {
    logger.info("[Platform] Cleanup called (no active resources to clean)")
    // No active resources to clean up
}
