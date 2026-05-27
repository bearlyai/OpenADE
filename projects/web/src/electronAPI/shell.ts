/**
 * Shell Utilities API Bridge
 *
 * Client-side API for shell/OS operations.
 * Uses direct Electron IPC for OS UI operations and local runtime for plain host operations.
 */

import { localRuntimeClient } from "../runtime/localRuntimeClient"

// ============================================================================
// Type Definitions
// IMPORTANT: Keep in sync with projects/electron/src/modules/code/shell.ts
// ============================================================================

export interface SelectDirectoryResponse {
    path: string | null
}

export interface CreateDirectoryResponse {
    success: boolean
    error?: string
}

// ============================================================================
// Shell API Functions
// ============================================================================

/**
 * Open directory selection dialog
 * Returns the selected directory path or null if canceled
 */
export async function selectDirectory(defaultPath?: string): Promise<string | null> {
    if (!window.openadeAPI) {
        console.warn("[ShellAPI] Not running in Electron")
        return null
    }

    const response = (await window.openadeAPI.shell.selectDirectory({ defaultPath })) as SelectDirectoryResponse
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
 * Open a path in the native file manager (Finder, Explorer, etc.)
 */
export function openPathInFileManager(path: string): void {
    if (!window.openadeAPI) {
        console.warn("[ShellAPI] Not running in Electron")
        return
    }
    window.openadeAPI.shell.openPath({ path })
}

/**
 * Open URL in native browser
 */
export function openUrlInNativeBrowser(url: string): void {
    if (!window.openadeAPI) {
        // Fallback for non-Electron environments
        window.open(url, "_blank")
        return
    }

    window.openadeAPI.shell.openUrl({ url })
}
