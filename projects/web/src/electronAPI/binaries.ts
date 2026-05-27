/**
 * Binaries API Bridge
 *
 * Client-side API for managing dynamically downloaded binaries (node, bun, uv).
 * Communicates with the local runtime protocol bridge.
 */

import { localRuntimeClient } from "../runtime/localRuntimeClient"

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
    if (!window.openadeAPI?.runtime) return []

    try {
        return await localRuntimeClient.request<ManagedBinaryStatus[]>("host/binaries/statuses")
    } catch (error) {
        console.error("[BinariesAPI] Failed to get statuses:", error)
        return []
    }
}

/** Ensure a binary is downloaded and available. Downloads if needed. */
export async function ensureBinary(name: string): Promise<{ ok: boolean; path?: string; error?: string }> {
    if (!window.openadeAPI?.runtime) return { ok: false, error: "Not running in Electron" }

    try {
        return await localRuntimeClient.request<{ ok: boolean; path?: string; error?: string }>("host/binaries/ensure", { name })
    } catch (error) {
        console.error("[BinariesAPI] Failed to ensure binary:", error)
        return { ok: false, error: error instanceof Error ? error.message : "Unknown error" }
    }
}
