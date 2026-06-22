/**
 * Platform API Bridge
 *
 * Client-side API for platform information.
 * Communicates with the local runtime protocol bridge.
 * Provides cross-platform path handling utilities.
 */

import { localRuntimeClient } from "../runtime/localRuntimeClient"
import type { PlatformInfo as HostPlatformInfo } from "../../../electron/src/modules/code/hostBridgeTypes"

// ============================================================================
// Type Definitions
// ============================================================================

export type PlatformInfo = HostPlatformInfo

// ============================================================================
// Cached Platform Info
// ============================================================================

let cachedPlatformInfo: PlatformInfo | null = null
let platformInfoRequestInFlight: Promise<PlatformInfo> | null = null

export function resetPlatformInfoForTests(): void {
    cachedPlatformInfo = null
    platformInfoRequestInFlight = null
}

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
 * Fetch platform info from the local runtime
 * Caches the result for subsequent calls
 */
export async function fetchPlatformInfo(): Promise<PlatformInfo> {
    if (cachedPlatformInfo) return cachedPlatformInfo
    if (platformInfoRequestInFlight) return platformInfoRequestInFlight

    if (!window.openadeAPI?.runtime) {
        console.warn("[PlatformAPI] Not running in Electron, using default platform info")
        cachedPlatformInfo = defaultPlatformInfo
        return cachedPlatformInfo
    }

    platformInfoRequestInFlight = localRuntimeClient
        .request<PlatformInfo>("host/platform/info")
        .then((response) => {
            cachedPlatformInfo = response
            return response
        })
        .catch((error) => {
            console.error("[PlatformAPI] Failed to fetch platform info:", error)
            cachedPlatformInfo = defaultPlatformInfo
            return cachedPlatformInfo
        })
        .finally(() => {
            platformInfoRequestInFlight = null
        })
    return platformInfoRequestInFlight
}

/**
 * Get cached platform info synchronously
 * Returns default info if not yet fetched - call fetchPlatformInfo() first
 */
export function getPlatformInfo(): PlatformInfo {
    return cachedPlatformInfo ?? defaultPlatformInfo
}

/**
 * Get the OS-specific file manager name (Finder, Explorer, File Manager)
 */
export function getFileManagerName(): string {
    const { platform } = getPlatformInfo()
    if (platform === "darwin") return "Finder"
    if (platform === "win32") return "Explorer"
    return "File Manager"
}

/**
 * Get the platform's native path separator
 * Returns "/" on Unix/Mac, "\\" on Windows
 */
export function getPathSeparator(): "/" | "\\" {
    return getPlatformInfo().pathSeparator
}
