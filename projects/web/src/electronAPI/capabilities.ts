/**
 * Code Module Capabilities API Bridge
 *
 * Provides detection of code module availability and version.
 * Replaces raw Electron detection (`"require" in window`) with a
 * semantic check that queries the Electron backend.
 *
 * Usage:
 *   - Call `initCodeModuleCapabilities()` once during app startup
 *   - Use `isCodeModuleAvailable()` synchronously anywhere after init
 *   - Use `hasElectronIpc()` for low-level IPC availability (e.g., in getIpc helpers)
 */

// ============================================================================
// Type Definitions
// IMPORTANT: Keep in sync with projects/electron/src/modules/code/capabilities.ts
// ============================================================================

export interface CodeModuleCapabilities {
    enabled: boolean
    version: string
}

// ============================================================================
// Low-level Electron detection
// ============================================================================

/**
 * Check if Electron IPC is available (raw environment check).
 * With contextIsolation, we check for window.openadeAPI.
 */
export const hasElectronIpc = () => typeof window !== "undefined" && "openadeAPI" in window

// ============================================================================
// Cached Capabilities
// ============================================================================

let cachedCapabilities: CodeModuleCapabilities | null = null

/**
 * Initialize code module capabilities by querying Electron.
 * Call this once during app startup (e.g., in CodeLayout init).
 * After this call, `isCodeModuleAvailable()` returns the real value.
 */
export async function initCodeModuleCapabilities(): Promise<CodeModuleCapabilities> {
    if (cachedCapabilities) return cachedCapabilities

    if (!window.openadeAPI) {
        cachedCapabilities = { enabled: false, version: "" }
        return cachedCapabilities
    }

    try {
        const response = (await window.openadeAPI.capabilities.get()) as CodeModuleCapabilities
        cachedCapabilities = response
        return response
    } catch (error) {
        console.error("[CapabilitiesAPI] Failed to fetch capabilities:", error)
        cachedCapabilities = { enabled: false, version: "" }
        return cachedCapabilities
    }
}

/**
 * Check if the code module is available.
 * Returns `false` before `initCodeModuleCapabilities()` is called,
 * or if not running in Electron with code modules enabled.
 */
export function isCodeModuleAvailable(): boolean {
    // Before init, fall back to raw Electron check for early gates (Routes.tsx)
    if (!cachedCapabilities) return hasElectronIpc()
    return cachedCapabilities.enabled
}

// ============================================================================
// SDK Capabilities (slash commands, skills, plugins)
// IMPORTANT: Keep SdkCapabilities in sync with projects/electron/src/modules/code/capabilities.ts
// ============================================================================

export interface SdkCapabilities {
    slash_commands: string[]
    skills: string[]
    plugins: { name: string; path: string }[]
    cachedAt: number
}

/**
 * Fetch SDK capabilities for a working directory.
 * Returns cached data if available, otherwise runs a lightweight probe (~1.4s).
 */
export async function getSdkCapabilities(cwd: string): Promise<SdkCapabilities | null> {
    if (!window.openadeAPI) return null

    try {
        const response = (await window.openadeAPI.capabilities.getSdk({ cwd })) as SdkCapabilities | null
        return response
    } catch (error) {
        console.error("[CapabilitiesAPI] Failed to fetch SDK capabilities:", error)
        return null
    }
}
