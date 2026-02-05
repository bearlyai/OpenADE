/**
 * YJS Storage API Bridge
 *
 * Client-side API for YJS document persistence.
 * Communicates with Electron main process via openadeAPI.
 * Used by ElectronStorage driver for filesystem-based YJS persistence.
 */

// ============================================================================
// YJS Storage API Functions
// ============================================================================

/**
 * Save a YJS document to the filesystem.
 * @param id Document ID (e.g., "code:repos", "code:task:abc123")
 * @param data YJS document state as Uint8Array
 */
export async function saveYjsDoc(id: string, data: Uint8Array): Promise<void> {
    if (!window.openadeAPI) {
        throw new Error("[YjsStorageAPI] Not running in Electron")
    }

    await window.openadeAPI.yjs.save({ id, data })
}

/**
 * Load a YJS document from the filesystem.
 * @param id Document ID (e.g., "code:repos", "code:task:abc123")
 * @returns YJS document state as Uint8Array, or null if not found
 */
export async function loadYjsDoc(id: string): Promise<Uint8Array | null> {
    if (!window.openadeAPI) {
        throw new Error("[YjsStorageAPI] Not running in Electron")
    }

    const result = await window.openadeAPI.yjs.load({ id })
    return result as Uint8Array | null
}

/**
 * Delete a YJS document from the filesystem.
 * @param id Document ID (e.g., "code:repos", "code:task:abc123")
 */
export async function deleteYjsDoc(id: string): Promise<void> {
    if (!window.openadeAPI) {
        throw new Error("[YjsStorageAPI] Not running in Electron")
    }

    await window.openadeAPI.yjs.delete({ id })
}
