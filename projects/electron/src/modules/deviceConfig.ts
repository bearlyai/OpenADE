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
import type { DeviceConfig, DeviceConfigResult } from "./deviceConfigTypes"

const OPENADE_DIR = ".openade"
const CONFIG_FILE = "device.json"

function getConfigPath(): string {
	return path.join(os.homedir(), OPENADE_DIR, CONFIG_FILE)
}

export type { DeviceConfig, DeviceConfigResult } from "./deviceConfigTypes"

let wasGeneratedThisRun = false
let readFailedThisRun = false

function withMetadata(config: DeviceConfig): DeviceConfigResult {
	return {
		...config,
		wasGenerated: wasGeneratedThisRun,
		readFailed: readFailedThisRun,
	}
}

/**
 * Get the device configuration, creating it if it doesn't exist.
 * Generates a new device ID on first run.
 */
export function getDeviceConfig(): DeviceConfigResult {
	const configPath = getConfigPath()

	try {
		if (fs.existsSync(configPath)) {
			const data = JSON.parse(fs.readFileSync(configPath, "utf-8"))
			if (data.deviceId) {
				return withMetadata(data as DeviceConfig)
			}
		}
	} catch (err) {
		console.error("[DeviceConfig] Failed to read config:", err)
		readFailedThisRun = true
		// Fall through to create new config.
	}

	// Generate new device ID
	const config: DeviceConfig = { deviceId: randomUUID() }
	wasGeneratedThisRun = true
	saveDeviceConfig(config)
	return withMetadata(config)
}

/**
 * Save device configuration, merging with existing values.
 */
function saveDeviceConfig(updates: Partial<DeviceConfig>): boolean {
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
		const tempPath = `${configPath}.${process.pid}.tmp`
		fs.writeFileSync(tempPath, JSON.stringify(merged, null, 2))
		fs.renameSync(tempPath, configPath)
		return true
	} catch (err) {
		console.error("[DeviceConfig] Failed to save config:", err)
		return false
	}
}

/**
 * Restore or replace the device ID from a trusted renderer-side backup.
 */
export function setDeviceId(deviceId: string): DeviceConfigResult {
	if (!deviceId.trim()) {
		throw new Error("Device ID cannot be empty")
	}

	if (!saveDeviceConfig({ deviceId })) {
		throw new Error("Failed to save device ID")
	}
	wasGeneratedThisRun = false
	readFailedThisRun = false
	const config = getDeviceConfig()
	if (config.deviceId !== deviceId) {
		throw new Error("Saved device ID did not match requested device ID")
	}
	return config
}

/**
 * Update the telemetry disabled preference.
 */
export function setTelemetryDisabled(disabled: boolean): void {
	saveDeviceConfig({ telemetryDisabled: disabled })
}
