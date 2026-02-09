/**
 * Snapshots API Bridge
 *
 * Client-side API for snapshot patch storage operations.
 * Delegates to the unified DataFolder API with folder="snapshots".
 *
 * Patches are stored at ~/.openade/data/snapshots/{snapshotId}.patch
 */

import { dataFolderApi } from "./dataFolder"

// ============================================================================
// Snapshots API Functions
// ============================================================================

async function save(id: string, patch: string): Promise<void> {
    await dataFolderApi.save("snapshots", id, patch, "patch")
}

async function load(id: string): Promise<string | null> {
    const result = await dataFolderApi.load("snapshots", id, "patch")
    if (result === null) return null
    // Convert Buffer/ArrayBuffer to string if needed
    if (typeof result === "string") return result
    return new TextDecoder().decode(result)
}

async function deletePatch(id: string): Promise<void> {
    await dataFolderApi.delete("snapshots", id, "patch")
}

function isAvailable(): boolean {
    return dataFolderApi.isAvailable()
}

// ============================================================================
// Export
// ============================================================================

export const snapshotsApi = {
    save,
    load,
    delete: deletePatch,
    isAvailable,
}
