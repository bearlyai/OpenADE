/**
 * Binaries API Bridge
 *
 * Client-side API for managing dynamically downloaded binaries (node, bun, uv).
 * Communicates with Electron main process via openadeAPI.
 */

// ============================================================================
// Type Definitions
// IMPORTANT: Keep in sync with projects/electron/src/modules/code/binaries.ts
// ============================================================================

export interface ManagedBinaryStatus {
    name: string
    displayName: string
    version: string
    status: "available" | "downloading" | "not_downloaded" | "error"
    path: string | null
    error: string | null
}

// ============================================================================
// API Functions
// ============================================================================

/** Get statuses of all managed binaries */
export async function getStatuses(): Promise<ManagedBinaryStatus[]> {
    if (!window.openadeAPI) return []

    try {
        return (await window.openadeAPI.binaries.statuses()) as ManagedBinaryStatus[]
    } catch (error) {
        console.error("[BinariesAPI] Failed to get statuses:", error)
        return []
    }
}

/** Ensure a binary is downloaded and available. Downloads if needed. */
export async function ensureBinary(name: string): Promise<{ ok: boolean; path?: string; error?: string }> {
    if (!window.openadeAPI) return { ok: false, error: "Not running in Electron" }

    try {
        return (await window.openadeAPI.binaries.ensure({ name })) as { ok: boolean; path?: string; error?: string }
    } catch (error) {
        console.error("[BinariesAPI] Failed to ensure binary:", error)
        return { ok: false, error: error instanceof Error ? error.message : "Unknown error" }
    }
}
