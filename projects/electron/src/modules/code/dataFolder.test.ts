import { rm } from "node:fs/promises"
import { afterEach, describe, expect, it, vi } from "vitest"

const testHome = vi.hoisted(() => ({
	path: `/tmp/openade-data-folder-test-${Date.now()}-${Math.random().toString(16).slice(2)}`,
}))

const log = vi.hoisted(() => ({
	debug: vi.fn(),
	error: vi.fn(),
	info: vi.fn(),
	warn: vi.fn(),
}))

vi.mock("electron-log", () => ({
	default: log,
}))

vi.mock("os", async (importOriginal) => {
	const actual = await importOriginal<typeof import("os")>()
	return {
		...actual,
		homedir: () => testHome.path,
	}
})

import { loadRuntimeDataFile, saveRuntimeDataFile } from "./dataFolder"

afterEach(async () => {
	log.debug.mockClear()
	log.error.mockClear()
	log.info.mockClear()
	log.warn.mockClear()
	await rm(testHome.path, { recursive: true, force: true })
})

describe("data folder runtime bridge", () => {
	it("returns null for missing optional files without logging private paths", async () => {
		await expect(loadRuntimeDataFile({ folder: "cron", id: "repo-1", ext: "json" })).resolves.toBeNull()

		expect(log.debug).not.toHaveBeenCalled()
		expect(log.info).not.toHaveBeenCalled()
		expect(log.warn).not.toHaveBeenCalled()
		expect(log.error).not.toHaveBeenCalled()
	})

	it("still loads existing data-folder files", async () => {
		await saveRuntimeDataFile({ folder: "cron", id: "repo-1", ext: "json", data: JSON.stringify({ installations: {} }) })

		const data = await loadRuntimeDataFile({ folder: "cron", id: "repo-1", ext: "json" })

		expect(Buffer.isBuffer(data)).toBe(true)
		expect(data?.toString()).toBe(JSON.stringify({ installations: {} }))
		expect(log.debug).toHaveBeenCalledWith("[DataFolder] Loaded", { folder: "cron", id: "repo-1", ext: "json", size: 20 })
	})
})
