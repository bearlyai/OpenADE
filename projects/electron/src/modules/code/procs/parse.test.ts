import { describe, expect, it } from "vitest"
import { parseEditableProcsFile, parseProcsFile } from "./parse"
import { serializeProcsFile } from "./serialize"

describe("parseProcsFile", () => {
	// ========================================================================
	// Process parsing (existing functionality)
	// ========================================================================

	it("parses a basic process definition", () => {
		const content = `
[[process]]
name = "Dev Server"
type = "daemon"
command = "npm run dev"
url = "http://localhost:3000"
`
		const result = parseProcsFile(content, "openade.toml")
		expect("config" in result).toBe(true)
		if ("config" in result) {
			expect(result.config.processes).toHaveLength(1)
			expect(result.config.processes[0]).toEqual({
				id: "openade.toml::Dev Server",
				name: "Dev Server",
				type: "daemon",
				command: "npm run dev",
				url: "http://localhost:3000",
				workDir: undefined,
			})
			expect(result.config.crons).toHaveLength(0)
		}
	})

	it("defaults process type to daemon", () => {
		const content = `
[[process]]
name = "Server"
command = "node server.js"
`
		const result = parseProcsFile(content, "openade.toml")
		expect("config" in result).toBe(true)
		if ("config" in result) {
			expect(result.config.processes[0].type).toBe("daemon")
		}
	})

	// ========================================================================
	// Cron parsing
	// ========================================================================

	it("parses a basic cron definition", () => {
		const content = `
[[cron]]
name = "Weekly Review"
schedule = "0 9 * * 1"
type = "plan"
prompt = "Review the codebase for issues"
`
		const result = parseProcsFile(content, "openade.toml")
		expect("config" in result).toBe(true)
		if ("config" in result) {
			expect(result.config.crons).toHaveLength(1)
			expect(result.config.crons[0]).toEqual({
				id: "openade.toml::Weekly Review",
				name: "Weekly Review",
				schedule: "0 9 * * 1",
				type: "plan",
				prompt: "Review the codebase for issues",
				appendSystemPrompt: undefined,
				images: undefined,
				isolation: undefined,
				harness: undefined,
				inTaskId: undefined,
				reuseTask: true,
			})
			expect(result.config.processes).toHaveLength(0)
		}
	})

	it("parses a cron with all optional fields", () => {
		const content = `
[[cron]]
name = "Full Cron"
schedule = "*/5 * * * *"
type = "do"
prompt = "Fix all lint errors"
append_system_prompt = "Be thorough"
images = ["screenshot.png"]
isolation = "worktree"
harness = "claude-code"
in_task_id = "task-123"
reuse_task = true
`
		const result = parseProcsFile(content, "pkg/openade.toml")
		expect("config" in result).toBe(true)
		if ("config" in result) {
			const cron = result.config.crons[0]
			expect(cron.id).toBe("pkg/openade.toml::Full Cron")
			expect(cron.type).toBe("do")
			expect(cron.appendSystemPrompt).toBe("Be thorough")
			expect(cron.images).toEqual(["screenshot.png"])
			expect(cron.isolation).toBe("worktree")
			expect(cron.harness).toBe("claude-code")
			expect(cron.inTaskId).toBe("task-123")
			expect(cron.reuseTask).toBe(true)
		}
	})

	it("parses all cron types", () => {
		for (const type of ["plan", "do", "ask", "hyperplan"] as const) {
			const content = `
[[cron]]
name = "Cron ${type}"
schedule = "0 0 * * *"
type = "${type}"
prompt = "Test"
`
			const result = parseProcsFile(content, "openade.toml")
			expect("config" in result).toBe(true)
			if ("config" in result) {
				expect(result.config.crons[0].type).toBe(type)
			}
		}
	})

	// ========================================================================
	// Mixed content
	// ========================================================================

	it("parses file with both processes and crons", () => {
		const content = `
[[process]]
name = "Dev Server"
type = "daemon"
command = "npm run dev"

[[process]]
name = "Build"
type = "task"
command = "npm run build"

[[cron]]
name = "Daily Check"
schedule = "0 9 * * *"
type = "ask"
prompt = "How is the project doing?"

[[cron]]
name = "Weekly Plan"
schedule = "0 9 * * 1"
type = "plan"
prompt = "Plan next sprint"
`
		const result = parseProcsFile(content, "openade.toml")
		expect("config" in result).toBe(true)
		if ("config" in result) {
			expect(result.config.processes).toHaveLength(2)
			expect(result.config.crons).toHaveLength(2)
			expect(result.config.processes[0].name).toBe("Dev Server")
			expect(result.config.processes[1].name).toBe("Build")
			expect(result.config.crons[0].name).toBe("Daily Check")
			expect(result.config.crons[1].name).toBe("Weekly Plan")
		}
	})

	it("handles empty file (no processes or crons)", () => {
		const result = parseProcsFile("", "openade.toml")
		expect("config" in result).toBe(true)
		if ("config" in result) {
			expect(result.config.processes).toHaveLength(0)
			expect(result.config.crons).toHaveLength(0)
		}
	})

	// ========================================================================
	// Validation errors
	// ========================================================================

	it("returns error for cron missing required field", () => {
		const content = `
[[cron]]
name = "Bad Cron"
schedule = "0 9 * * 1"
prompt = "Do something"
`
		const result = parseProcsFile(content, "openade.toml")
		expect("error" in result).toBe(true)
	})

	it("returns error for cron with invalid type", () => {
		const content = `
[[cron]]
name = "Bad Cron"
schedule = "0 9 * * 1"
type = "invalid"
prompt = "Do something"
`
		const result = parseProcsFile(content, "openade.toml")
		expect("error" in result).toBe(true)
	})

	it("returns error for invalid TOML syntax", () => {
		const content = `
[[cron]
name = "Bad"
`
		const result = parseProcsFile(content, "openade.toml")
		expect("error" in result).toBe(true)
	})

	// ========================================================================
	// Editable parser + serializer
	// ========================================================================

	it("parses editable shape without ids", () => {
		const content = `
[[process]]
name = "Dev"
type = "daemon"
command = "npm run dev"

[[cron]]
name = "Weekly"
schedule = "0 9 * * 1"
type = "plan"
prompt = "Review"
`
		const result = parseEditableProcsFile(content, "openade.toml")
		expect("error" in result).toBe(false)
		if ("error" in result) return

		expect(result.processes[0]).toEqual({
			name: "Dev",
			type: "daemon",
			command: "npm run dev",
			workDir: undefined,
			url: undefined,
		})
		expect(result.crons[0]).toEqual({
			name: "Weekly",
			schedule: "0 9 * * 1",
			type: "plan",
			prompt: "Review",
			appendSystemPrompt: undefined,
			images: undefined,
			isolation: undefined,
			harness: undefined,
			inTaskId: undefined,
			reuseTask: true,
		})
	})

	it("serializes editable entries with snake_case optional fields", () => {
		const toml = serializeProcsFile({
			processes: [
				{
					name: "Dev Server",
					type: "daemon",
					command: "npm run dev",
					workDir: "apps/web",
					url: "http://localhost:3000",
				},
			],
			crons: [
				{
					name: "Full Cron",
					schedule: "0 9 * * 1",
					type: "do",
					prompt: "Ship it",
					appendSystemPrompt: "Be careful",
					images: ["a.png", "b.png"],
					isolation: "worktree",
					harness: "codex",
					inTaskId: "task-1",
					reuseTask: true,
				},
			],
		})

		expect(toml).toContain("work_dir")
		expect(toml).toContain("append_system_prompt")
		expect(toml).toContain("in_task_id")
		expect(toml).not.toContain("reuse_task")

		const parsed = parseEditableProcsFile(toml, "openade.toml")
		expect("error" in parsed).toBe(false)
		if ("error" in parsed) return
		expect(parsed.processes).toHaveLength(1)
		expect(parsed.crons).toHaveLength(1)
		expect(parsed.processes[0].workDir).toBe("apps/web")
		expect(parsed.crons[0].appendSystemPrompt).toBe("Be careful")
		expect(parsed.crons[0].inTaskId).toBe("task-1")
		expect(parsed.crons[0].reuseTask).toBe(true)
	})

	it("serializes reuse_task = false and round-trips", () => {
		const toml = serializeProcsFile({
			processes: [],
			crons: [{ name: "No Reuse", schedule: "0 9 * * 1", type: "plan", prompt: "Test", reuseTask: false }],
		})
		expect(toml).toContain("reuse_task = false")

		const parsed = parseEditableProcsFile(toml, "openade.toml")
		expect("error" in parsed).toBe(false)
		if ("error" in parsed) return
		expect(parsed.crons[0].reuseTask).toBe(false)
	})

	it("rejects duplicate process names during serialization", () => {
		expect(() =>
			serializeProcsFile({
				processes: [
					{ name: "Dev", type: "daemon", command: "npm run dev" },
					{ name: "dev", type: "check", command: "npm run lint" },
				],
				crons: [],
			})
		).toThrow(/Duplicate process name/)
	})

	it("rejects invalid cron schedule during serialization", () => {
		expect(() =>
			serializeProcsFile({
				processes: [],
				crons: [{ name: "Bad", schedule: "0 9 * *", type: "plan", prompt: "x" }],
			})
		).toThrow(/Invalid cron schedule/)
	})

	it("serializes empty config and parses back to empty arrays", () => {
		const toml = serializeProcsFile({
			processes: [],
			crons: [],
		})
		const parsed = parseEditableProcsFile(toml, "openade.toml")
		expect("error" in parsed).toBe(false)
		if ("error" in parsed) return
		expect(parsed.processes).toEqual([])
		expect(parsed.crons).toEqual([])
	})
})
