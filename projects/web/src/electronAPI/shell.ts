/**
 * Shell Utilities API Bridge
 *
 * Client-side API for shell/OS operations.
 * Communicates with Electron main process via openadeAPI.
 */

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
    if (!window.openadeAPI) {
        console.warn("[ShellAPI] Not running in Electron")
        return { success: false, error: "Not running in Electron" }
    }

    return (await window.openadeAPI.shell.createDirectory({ path })) as CreateDirectoryResponse
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
