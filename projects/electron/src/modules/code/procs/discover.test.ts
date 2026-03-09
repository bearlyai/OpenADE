import { describe, expect, it, beforeEach, afterEach } from "vitest"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import { findProcsFiles } from "./discover"

describe("findProcsFiles", () => {
	let tmpDir: string

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "discover-test-"))
	})

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true })
	})

	it("finds openade.toml in root", async () => {
		fs.writeFileSync(path.join(tmpDir, "openade.toml"), "[[process]]\nname = 'test'\ncommand = 'echo'\n")

		const files = await findProcsFiles(tmpDir, null)
		expect(files).toHaveLength(1)
		expect(path.basename(files[0])).toBe("openade.toml")
	})

	it("finds procs.toml in root", async () => {
		fs.writeFileSync(path.join(tmpDir, "procs.toml"), "[[process]]\nname = 'test'\ncommand = 'echo'\n")

		const files = await findProcsFiles(tmpDir, null)
		expect(files).toHaveLength(1)
		expect(path.basename(files[0])).toBe("procs.toml")
	})

	it("prefers openade.toml over procs.toml in same directory", async () => {
		fs.writeFileSync(path.join(tmpDir, "openade.toml"), "[[process]]\nname = 'ade'\ncommand = 'echo'\n")
		fs.writeFileSync(path.join(tmpDir, "procs.toml"), "[[process]]\nname = 'procs'\ncommand = 'echo'\n")

		const files = await findProcsFiles(tmpDir, null)
		expect(files).toHaveLength(1)
		expect(path.basename(files[0])).toBe("openade.toml")
	})

	it("finds config files in subdirectories", async () => {
		const subDir = path.join(tmpDir, "packages", "api")
		fs.mkdirSync(subDir, { recursive: true })
		fs.writeFileSync(path.join(subDir, "openade.toml"), "[[process]]\nname = 'api'\ncommand = 'echo'\n")

		const files = await findProcsFiles(tmpDir, null)
		expect(files).toHaveLength(1)
		expect(files[0]).toContain("packages/api/openade.toml")
	})

	it("deduplicates per-directory in subdirectories", async () => {
		// Root has openade.toml, subdir has both
		fs.writeFileSync(path.join(tmpDir, "openade.toml"), "")

		const subDir = path.join(tmpDir, "packages", "web")
		fs.mkdirSync(subDir, { recursive: true })
		fs.writeFileSync(path.join(subDir, "openade.toml"), "")
		fs.writeFileSync(path.join(subDir, "procs.toml"), "")

		const files = await findProcsFiles(tmpDir, null)
		expect(files).toHaveLength(2)

		// Both should be openade.toml
		for (const f of files) {
			expect(path.basename(f)).toBe("openade.toml")
		}
	})

	it("returns empty for directory with no config files", async () => {
		const files = await findProcsFiles(tmpDir, null)
		expect(files).toHaveLength(0)
	})

	it("ignores node_modules", async () => {
		const nodeModules = path.join(tmpDir, "node_modules", "some-pkg")
		fs.mkdirSync(nodeModules, { recursive: true })
		fs.writeFileSync(path.join(nodeModules, "openade.toml"), "")

		const files = await findProcsFiles(tmpDir, null)
		expect(files).toHaveLength(0)
	})
})
