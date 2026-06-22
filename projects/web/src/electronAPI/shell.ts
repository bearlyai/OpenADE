/**
 * Shell Utilities API Bridge
 *
 * Client-side API for shell/OS operations.
 * Uses direct Electron IPC for OS UI operations and local runtime for plain host operations.
 */

import { localRuntimeClient } from "../runtime/localRuntimeClient"
import { getExternalUrlToOpen } from "../utils/externalLinks"
import type { CreateDirectoryResponse, SelectDirectoryResponse } from "../../../electron/src/modules/code/hostBridgeTypes"

// ============================================================================
// Type Definitions
// ============================================================================

export type { CreateDirectoryResponse, SelectDirectoryResponse }

// ============================================================================
// Shell API Functions
// ============================================================================

export function isDirectorySelectionAvailable(): boolean {
    return typeof window !== "undefined" && typeof window.openadeAPI?.shell?.selectDirectory === "function"
}

/**
 * Open directory selection dialog
 * Returns the selected directory path or null if canceled
 */
export async function selectDirectory(defaultPath?: string): Promise<string | null> {
    const shellApi = window.openadeAPI?.shell
    if (!isDirectorySelectionAvailable() || !shellApi) {
        console.warn("[ShellAPI] Not running in Electron")
        return null
    }

    const response = (await shellApi.selectDirectory({ defaultPath })) as SelectDirectoryResponse
    return response.path
}

/**
 * Create a directory at the specified path (recursive)
 */
export async function createDirectory(path: string): Promise<CreateDirectoryResponse> {
    if (!window.openadeAPI?.runtime) {
        console.warn("[ShellAPI] Not running in Electron")
        return { success: false, error: "Not running in Electron" }
    }

    return localRuntimeClient.request<CreateDirectoryResponse>("host/shell/createDirectory", { path })
}

/**
 * Open a path in the native default app (Preview, Finder, Explorer, etc.)
 */
export function openPathInNativeApp(path: string): void {
    if (!window.openadeAPI) {
        console.warn("[ShellAPI] Not running in Electron")
        return
    }
    window.openadeAPI.shell.openPath({ path })
}

export const openPathInFileManager = openPathInNativeApp

/**
 * Open URL in native browser
 */
export function openUrlInNativeBrowser(url: string): void {
    const externalUrl = getExternalUrlToOpen(url)
    if (!externalUrl) {
        console.warn("[ShellAPI] Refusing to open non-external URL", { url })
        return
    }

    if (!window.openadeAPI) {
        // Fallback for non-Electron environments
        window.open(externalUrl, "_blank", "noopener,noreferrer")
        return
    }

    window.openadeAPI.shell.openUrl({ url: externalUrl })
}
