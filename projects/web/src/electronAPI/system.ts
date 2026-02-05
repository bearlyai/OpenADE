/**
 * System API Bridge
 *
 * Client-side API for system utilities.
 * Communicates with Electron main process via openadeAPI.
 * Provides binary checking and system configuration utilities.
 */

// ============================================================================
// API Check
// ============================================================================

import { isCodeModuleAvailable } from "./capabilities"

// ============================================================================
// System API Functions
// ============================================================================

/**
 * Check if System API is available (running in Electron)
 */
export function isSystemApiAvailable(): boolean {
    return isCodeModuleAvailable()
}
