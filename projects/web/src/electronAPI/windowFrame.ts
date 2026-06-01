/**
 * Window Frame API Bridge
 *
 * Client-side API for Electron window frame customization.
 * Communicates with Electron main process via openadeAPI.
 * Provides frame visibility and color customization.
 */

import type { FrameColors as HostFrameColors } from "../../../electron/src/modules/code/hostBridgeTypes"

// ============================================================================
// Type Definitions
// ============================================================================

export type FrameColors = HostFrameColors

// ============================================================================
// Window Frame API Functions
// ============================================================================

/**
 * Check if window frame customization is enabled
 */
export async function windowFrameEnabled(): Promise<boolean> {
    if (!window.openadeAPI) return false
    try {
        return (await window.openadeAPI.codeWindowFrame.enabled()) as boolean
    } catch (e) {
        console.warn("[windowFrame] unable to check frame enabled", e)
        return false
    }
}

/**
 * Set window frame colors (Windows title bar overlay)
 */
export async function windowFrameSetColors(colors: FrameColors): Promise<{ type: "success" } | { type: "error" }> {
    if (!window.openadeAPI) return { type: "error" }
    try {
        await window.openadeAPI.codeWindowFrame.setColors(colors)
        return { type: "success" }
    } catch (e) {
        console.warn("[windowFrame] unable to set frame colors", e)
        return { type: "error" }
    }
}
