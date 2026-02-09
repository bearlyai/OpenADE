/**
 * Data Folder API Bridge
 *
 * Client-side API for unified file storage operations.
 * Communicates with Electron main process via openadeAPI.
 *
 * Files are stored at ~/.openade/data/{folder}/{id}.{ext}
 */

import { isCodeModuleAvailable } from "./capabilities"

// ============================================================================
// Data Folder API Functions
// ============================================================================

async function save(folder: string, id: string, data: string | ArrayBuffer, ext: string): Promise<void> {
    if (!window.openadeAPI?.data) {
        throw new Error("Data API not available")
    }
    await window.openadeAPI.data.save({ folder, id, data, ext })
}

async function load(folder: string, id: string, ext: string): Promise<ArrayBuffer | string | null> {
    if (!window.openadeAPI?.data) {
        throw new Error("Data API not available")
    }
    return (await window.openadeAPI.data.load({ folder, id, ext })) as ArrayBuffer | string | null
}

async function deleteFile(folder: string, id: string, ext: string): Promise<void> {
    if (!window.openadeAPI?.data) {
        throw new Error("Data API not available")
    }
    await window.openadeAPI.data.delete({ folder, id, ext })
}

function isAvailable(): boolean {
    return isCodeModuleAvailable() && !!window.openadeAPI?.data
}

// ============================================================================
// Export
// ============================================================================

export const dataFolderApi = {
    save,
    load,
    delete: deleteFile,
    isAvailable,
}
