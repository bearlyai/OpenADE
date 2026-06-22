import { mkdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"
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

import { listRuntimeDataFileIds, loadRuntimeDataFile, runWithDataFolderOperationContext, saveRuntimeDataFile } from "./dataFolder"

afterEach(async () => {
	vi.restoreAllMocks()
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

	it("lists sanitized data-folder ids for an extension", async () => {
		await saveRuntimeDataFile({ folder: "cron", id: "repo-2", ext: "json", data: JSON.stringify({ installations: {} }) })
		await saveRuntimeDataFile({ folder: "cron", id: "repo-1", ext: "json", data: JSON.stringify({ installations: {} }) })
		await mkdir(path.join(testHome.path, ".openade", "data", "cron"), { recursive: true })
		await writeFile(path.join(testHome.path, ".openade", "data", "cron", "not valid.json"), "{}", "utf8")
		await writeFile(path.join(testHome.path, ".openade", "data", "cron", "repo-3.txt"), "{}", "utf8")

		await expect(listRuntimeDataFileIds({ folder: "cron", ext: "json" })).resolves.toEqual(["repo-1", "repo-2"])
		expect(log.error).not.toHaveBeenCalled()
	})

	it("adds runtime request context to slow data-folder load logs", async () => {
		await saveRuntimeDataFile({ folder: "cron", id: "repo-1", ext: "json", data: JSON.stringify({ installations: {} }) })
		log.warn.mockClear()
		let now = 1_000
		vi.spyOn(Date, "now").mockImplementation(() => {
			const current = now
			now += 300
			return current
		})

		const data = await runWithDataFolderOperationContext({ runtimeMethod: "data/file/load", runtimeRequestId: "openade-client:17" }, () =>
			loadRuntimeDataFile({ folder: "cron", id: "repo-1", ext: "json" })
		)

		expect(Buffer.isBuffer(data)).toBe(true)
		expect(log.warn).toHaveBeenCalledWith("[DataFolder] Slow operation", {
			folder: "cron",
			id: "repo-1",
			ext: "json",
			size: 20,
			durationMs: 300,
			operation: "load",
			runtimeMethod: "data/file/load",
			runtimeRequestId: "openade-client:17",
		})
		expect(JSON.stringify(log.warn.mock.calls)).not.toContain(testHome.path)
	})
})
