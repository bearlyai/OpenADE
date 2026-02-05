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
