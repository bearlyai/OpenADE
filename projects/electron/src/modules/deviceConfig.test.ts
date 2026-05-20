import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

let tempHome: string

async function loadDeviceConfigModule() {
	vi.resetModules()
	return import("./deviceConfig")
}

function writeDeviceConfig(config: unknown): void {
	const configDir = path.join(tempHome, ".openade")
	fs.mkdirSync(configDir, { recursive: true })
	fs.writeFileSync(path.join(configDir, "device.json"), JSON.stringify(config))
}

beforeEach(() => {
	tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "openade-device-config-"))
	vi.stubEnv("HOME", tempHome)
	vi.stubEnv("USERPROFILE", tempHome)
})

afterEach(() => {
	vi.restoreAllMocks()
	vi.unstubAllEnvs()
	fs.rmSync(tempHome, { recursive: true, force: true })
})

describe("deviceConfig", () => {
	it("returns existing device config without generated metadata", async () => {
		writeDeviceConfig({ deviceId: "existing-device", telemetryDisabled: true })
		const { getDeviceConfig } = await loadDeviceConfigModule()

		expect(getDeviceConfig()).toEqual({
			deviceId: "existing-device",
			telemetryDisabled: true,
			wasGenerated: false,
			readFailed: false,
		})
	})

	it("keeps generated metadata sticky until the device ID is restored", async () => {
		const { getDeviceConfig, setDeviceId } = await loadDeviceConfigModule()

		const generated = getDeviceConfig()
		expect(generated.wasGenerated).toBe(true)
		expect(generated.readFailed).toBe(false)

		const secondRead = getDeviceConfig()
		expect(secondRead.deviceId).toBe(generated.deviceId)
		expect(secondRead.wasGenerated).toBe(true)

		const restored = setDeviceId("backup-device")
		expect(restored).toEqual({
			deviceId: "backup-device",
			wasGenerated: false,
			readFailed: false,
		})
	})

	it("marks read failures and clears them after restore", async () => {
		const configDir = path.join(tempHome, ".openade")
		fs.mkdirSync(configDir, { recursive: true })
		fs.writeFileSync(path.join(configDir, "device.json"), "{not-json")
		vi.spyOn(console, "error").mockImplementation(() => {})

		const { getDeviceConfig, setDeviceId } = await loadDeviceConfigModule()

		const generated = getDeviceConfig()
		expect(generated.wasGenerated).toBe(true)
		expect(generated.readFailed).toBe(true)

		const restored = setDeviceId("backup-device")
		expect(restored.wasGenerated).toBe(false)
		expect(restored.readFailed).toBe(false)
	})
})
