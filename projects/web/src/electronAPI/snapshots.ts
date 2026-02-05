/**
 * Snapshots API Bridge
 *
 * Client-side API for snapshot patch storage operations.
 * Communicates with Electron main process via openadeAPI.
 *
 * Patches are stored at ~/.openade/snapshots/{snapshotId}.patch
 */

import { isCodeModuleAvailable } from "./capabilities"

// ============================================================================
// Snapshots API Functions
// ============================================================================

/**
 * Save a snapshot patch to the filesystem
 */
async function save(id: string, patch: string): Promise<void> {
    if (!window.openadeAPI?.snapshots) {
        throw new Error("Snapshots API not available")
    }
    await window.openadeAPI.snapshots.save({ id, patch })
}

/**
 * Load a snapshot patch from the filesystem
 * Returns null if the patch file doesn't exist
 */
async function load(id: string): Promise<string | null> {
    if (!window.openadeAPI?.snapshots) {
        throw new Error("Snapshots API not available")
    }
    return (await window.openadeAPI.snapshots.load({ id })) as string | null
}

/**
 * Delete a snapshot patch from the filesystem
 */
async function deletePatch(id: string): Promise<void> {
    if (!window.openadeAPI?.snapshots) {
        throw new Error("Snapshots API not available")
    }
    await window.openadeAPI.snapshots.delete({ id })
}

/**
 * Check if the snapshots API is available
 */
function isAvailable(): boolean {
    return isCodeModuleAvailable() && !!window.openadeAPI?.snapshots
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
