/**
 * Device Config API Bridge
 *
 * Client-side API for device configuration stored in ~/.openade/device.json.
 * Communicates with Electron main process via openadeAPI.
 */

// ============================================================================
// Type Definitions
// ============================================================================

export interface DeviceConfig {
    deviceId: string
    telemetryDisabled?: boolean
}

// ============================================================================
// Device Config API Functions
// ============================================================================

/**
 * Get the device configuration from ~/.openade/device.json.
 * Creates a new device ID if one doesn't exist.
 */
export async function getDeviceConfig(): Promise<DeviceConfig | null> {
    if (!window.openadeAPI) {
        console.warn("[DeviceConfigAPI] Not running in Electron, cannot get device config")
        return null
    }

    try {
        const response = (await window.openadeAPI.settings.getDeviceConfig()) as DeviceConfig
        return response
    } catch (error) {
        console.error("[DeviceConfigAPI] Failed to get device config:", error)
        return null
    }
}

/**
 * Update the telemetry disabled preference.
 * This syncs the preference to ~/.openade/device.json for the main process.
 */
export async function setTelemetryDisabled(disabled: boolean): Promise<void> {
    if (!window.openadeAPI) {
        console.warn("[DeviceConfigAPI] Not running in Electron, cannot set telemetry preference")
        return
    }

    try {
        await window.openadeAPI.settings.setTelemetryDisabled(disabled)
    } catch (error) {
        console.error("[DeviceConfigAPI] Failed to set telemetry preference:", error)
    }
}
