/**
 * Device Configuration Module
 *
 * Manages device-specific configuration stored in ~/.openade/device.json
 * This is the single source of truth for device ID and telemetry preferences,
 * shared between main process (Sentry) and renderer (Amplitude + Sentry).
 */

import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import { randomUUID } from "crypto"

const OPENADE_DIR = ".openade"
const CONFIG_FILE = "device.json"

function getConfigPath(): string {
	return path.join(os.homedir(), OPENADE_DIR, CONFIG_FILE)
}

export interface DeviceConfig {
	deviceId: string
	telemetryDisabled?: boolean
}

/**
 * Get the device configuration, creating it if it doesn't exist.
 * Generates a new device ID on first run.
 */
export function getDeviceConfig(): DeviceConfig {
	const configPath = getConfigPath()

	try {
		if (fs.existsSync(configPath)) {
			const data = JSON.parse(fs.readFileSync(configPath, "utf-8"))
			if (data.deviceId) {
				return data as DeviceConfig
			}
		}
	} catch (err) {
		console.error("[DeviceConfig] Failed to read config:", err)
		// Fall through to create new config
	}

	// Generate new device ID
	const config: DeviceConfig = { deviceId: randomUUID() }
	saveDeviceConfig(config)
	return config
}

/**
 * Save device configuration, merging with existing values.
 */
function saveDeviceConfig(updates: Partial<DeviceConfig>): void {
	const configPath = getConfigPath()
	const dir = path.dirname(configPath)

	try {
		// Ensure directory exists
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true })
		}

		// Read existing config if present
		let existing: DeviceConfig = { deviceId: "" }
		try {
			if (fs.existsSync(configPath)) {
				existing = JSON.parse(fs.readFileSync(configPath, "utf-8"))
			}
		} catch {
			// Ignore read errors, will overwrite
		}

		// Merge and save
		const merged = { ...existing, ...updates }
		fs.writeFileSync(configPath, JSON.stringify(merged, null, 2))
	} catch (err) {
		console.error("[DeviceConfig] Failed to save config:", err)
	}
}

/**
 * Update the telemetry disabled preference.
 */
export function setTelemetryDisabled(disabled: boolean): void {
	saveDeviceConfig({ telemetryDisabled: disabled })
}
