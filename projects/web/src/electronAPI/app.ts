/**
 * Electron App API wrapper
 *
 * Provides typed wrappers for app-level Electron IPC calls.
 * IMPORTANT: Keep in sync with projects/electron/src/preload.ts
 */

export function onUpdateAvailable(callback: () => void): () => void {
    if (!window.openadeAPI) return () => {}
    return window.openadeAPI.app.onUpdateAvailable(callback)
}

export async function applyUpdate(): Promise<void> {
    if (!window.openadeAPI) return
    await window.openadeAPI.app.applyUpdate()
}
