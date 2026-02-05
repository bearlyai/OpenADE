/**
 * Platform API Bridge
 *
 * Client-side API for platform information.
 * Communicates with Electron main process via openadeAPI.
 * Provides cross-platform path handling utilities.
 */

// ============================================================================
// Type Definitions
// IMPORTANT: Keep in sync with projects/electron/src/modules/code/platform.ts
// ============================================================================

export interface PlatformInfo {
    platform: "win32" | "darwin" | "linux"
    pathSeparator: "/" | "\\"
    homeDir: string
    isWindows: boolean
    isMac: boolean
    isLinux: boolean
}

// ============================================================================
// Cached Platform Info
// ============================================================================

let cachedPlatformInfo: PlatformInfo | null = null

/**
 * Default platform info for non-Electron environments (browser)
 * Assumes Unix-like environment for web fallback
 */
const defaultPlatformInfo: PlatformInfo = {
    platform: "darwin",
    pathSeparator: "/",
    homeDir: "/",
    isWindows: false,
    isMac: true,
    isLinux: false,
}

// ============================================================================
// Platform API Functions
// ============================================================================

/**
 * Fetch platform info from Electron main process
 * Caches the result for subsequent calls
 */
export async function fetchPlatformInfo(): Promise<PlatformInfo> {
    if (cachedPlatformInfo) return cachedPlatformInfo

    if (!window.openadeAPI) {
        console.warn("[PlatformAPI] Not running in Electron, using default platform info")
        cachedPlatformInfo = defaultPlatformInfo
        return cachedPlatformInfo
    }

    try {
        const response = (await window.openadeAPI.platform.getInfo()) as PlatformInfo
        cachedPlatformInfo = response
        return response
    } catch (error) {
        console.error("[PlatformAPI] Failed to fetch platform info:", error)
        cachedPlatformInfo = defaultPlatformInfo
        return cachedPlatformInfo
    }
}

/**
 * Get cached platform info synchronously
 * Returns default info if not yet fetched - call fetchPlatformInfo() first
 */
function getPlatformInfo(): PlatformInfo {
    return cachedPlatformInfo ?? defaultPlatformInfo
}

/**
 * Get the platform's native path separator
 * Returns "/" on Unix/Mac, "\\" on Windows
 */
export function getPathSeparator(): "/" | "\\" {
    return getPlatformInfo().pathSeparator
}
