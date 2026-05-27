/**
 * Platform Utilities Module for Electron
 *
 * Provides platform info (OS, path separator) to the trusted runtime host methods.
 * Enables cross-platform path handling in the renderer process.
 */

import logger from "electron-log"
import path from "path"
import os from "os"
import { execCommand } from "./subprocess"
import { resolve as resolveBinary } from "./binaries"

// ============================================================================
// Type Definitions
// IMPORTANT: Keep in sync with projects/dashboard/src/pages/code/electronAPI/platform.ts
// ============================================================================

export interface PlatformInfo {
    platform: "win32" | "darwin" | "linux"
    pathSeparator: "/" | "\\"
    homeDir: string
    isWindows: boolean
    isMac: boolean
    isLinux: boolean
}

export interface BinaryCheckResult {
    installed: boolean
    path?: string
    error?: string
}

/**
 * Get platform information
 */
export function getRuntimePlatformInfo(): PlatformInfo {
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
export async function checkRuntimeBinary(binary: string): Promise<BinaryCheckResult> {
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
export async function checkRuntimeVendoredRipgrep(): Promise<BinaryCheckResult> {
    const rgPath = resolveBinary("rg")
    if (!rgPath) {
        return { installed: false, error: "Managed ripgrep not available" }
    }

    return { installed: true, path: rgPath }
}

export const cleanup = () => {
    logger.info("[Platform] Cleanup called (no active resources to clean)")
    // No active resources to clean up
}
