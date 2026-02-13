import { describe, it, expect } from "vitest"
import { buildClaudeArgs } from "./args.js"
import type { HarnessQuery } from "../../types.js"

function makeQuery(overrides: Partial<HarnessQuery> = {}): HarnessQuery {
    return {
        prompt: "test prompt",
        cwd: "/tmp/test",
        mode: "yolo",
        signal: new AbortController().signal,
        ...overrides,
    }
}

describe("buildClaudeArgs", () => {
    it("includes default flags: --output-format stream-json, --verbose", () => {
        const result = buildClaudeArgs(makeQuery(), {})
        expect(result.args).toContain("--output-format")
        expect(result.args).toContain("stream-json")
        expect(result.args).toContain("--verbose")
    })

    it("includes prompt with -p flag", () => {
        const result = buildClaudeArgs(makeQuery({ prompt: "hello world" }), {})
        const pIdx = result.args.indexOf("-p")
        expect(pIdx).toBeGreaterThanOrEqual(0)
        expect(result.args[pIdx + 1]).toBe("hello world")
    })

    it("handles PromptPart[] by joining text parts", () => {
        const result = buildClaudeArgs(
            makeQuery({
                prompt: [
                    { type: "text", text: "line 1" },
                    { type: "text", text: "line 2" },
                ],
            }),
            {}
        )
        const pIdx = result.args.indexOf("-p")
        expect(result.args[pIdx + 1]).toBe("line 1\nline 2")
    })

    it("mode: 'yolo' produces --dangerously-skip-permissions", () => {
        const result = buildClaudeArgs(makeQuery({ mode: "yolo" }), {})
        expect(result.args).toContain("--dangerously-skip-permissions")
    })

    it("mode: 'read-only' uses --permission-mode dontAsk (not plan)", () => {
        const result = buildClaudeArgs(makeQuery({ mode: "read-only" }), {})
        expect(result.args).toContain("--permission-mode")
        expect(result.args).toContain("dontAsk")
        // Must NOT use plan mode (it injects unwanted system prompts)
        expect(result.args).not.toContain("plan")
        expect(result.args).not.toContain("--dangerously-skip-permissions")
    })

    it("mode: 'read-only' adds read-only allowed tools and Bash patterns to --allowedTools", () => {
        const result = buildClaudeArgs(makeQuery({ mode: "read-only" }), {})
        const allowedIdx = result.args.indexOf("--allowedTools")
        expect(allowedIdx).toBeGreaterThan(-1)
        const afterAllowed = result.args.slice(allowedIdx + 1)
        // Read-only tools
        expect(afterAllowed).toContain("Read")
        expect(afterAllowed).toContain("Glob")
        expect(afterAllowed).toContain("Grep")
        expect(afterAllowed).toContain("WebSearch")
        expect(afterAllowed).toContain("WebFetch")
        // Bash patterns
        expect(afterAllowed).toContain("Bash(git status *)")
        expect(afterAllowed).toContain("Bash(git log *)")
        expect(afterAllowed).toContain("Bash(git diff *)")
        expect(afterAllowed).toContain("Bash(ls *)")
        expect(afterAllowed).toContain("Bash(gh api *)")
    })

    it("mode: 'read-only' disallows write tools", () => {
        const result = buildClaudeArgs(makeQuery({ mode: "read-only" }), {})
        const disallowedIdx = result.args.indexOf("--disallowed-tools")
        expect(disallowedIdx).toBeGreaterThan(-1)
        const disallowedValue = result.args[disallowedIdx + 1]
        expect(disallowedValue).toContain("Edit")
        expect(disallowedValue).toContain("Write")
        expect(disallowedValue).toContain("NotebookEdit")
    })

    it("model: 'opus' produces --model opus", () => {
        const result = buildClaudeArgs(makeQuery({ model: "opus" }), {})
        expect(result.args).toContain("--model")
        expect(result.args).toContain("opus")
    })

    it("thinking: 'low' → --effort low", () => {
        const result = buildClaudeArgs(makeQuery({ thinking: "low" }), {})
        const effortIdx = result.args.indexOf("--effort")
        expect(effortIdx).toBeGreaterThan(-1)
        expect(result.args[effortIdx + 1]).toBe("low")
    })

    it("thinking: 'med' → --effort medium", () => {
        const result = buildClaudeArgs(makeQuery({ thinking: "med" }), {})
        const effortIdx = result.args.indexOf("--effort")
        expect(effortIdx).toBeGreaterThan(-1)
        expect(result.args[effortIdx + 1]).toBe("medium")
    })

    it("thinking: 'high' → --effort high", () => {
        const result = buildClaudeArgs(makeQuery({ thinking: "high" }), {})
        const effortIdx = result.args.indexOf("--effort")
        expect(effortIdx).toBeGreaterThan(-1)
        expect(result.args[effortIdx + 1]).toBe("high")
    })

    it("resumeSessionId produces --resume <id>", () => {
        const result = buildClaudeArgs(makeQuery({ resumeSessionId: "sess-123" }), {})
        expect(result.args).toContain("--resume")
        expect(result.args).toContain("sess-123")
    })

    it("forkSession produces --fork-session", () => {
        const result = buildClaudeArgs(makeQuery({ resumeSessionId: "sess-123", forkSession: true }), {})
        expect(result.args).toContain("--fork-session")
        expect(result.args).toContain("--resume")
    })

    it("disablePlanningTools: true adds planning tools to --disallowed-tools", () => {
        const result = buildClaudeArgs(makeQuery({ disablePlanningTools: true }), {})
        const disallowedIdx = result.args.indexOf("--disallowed-tools")
        expect(disallowedIdx).toBeGreaterThan(-1)
        const disallowedValue = result.args[disallowedIdx + 1]
        expect(disallowedValue).toContain("EnterPlanMode")
        expect(disallowedValue).toContain("ExitPlanMode")
        expect(disallowedValue).toContain("Task(Plan)")
        expect(disallowedValue).toContain("AskUserQuestion")
    })

    it("disablePlanningTools: false does not add planning tools to --disallowed-tools", () => {
        const result = buildClaudeArgs(makeQuery({ disablePlanningTools: false }), {})
        expect(result.args).not.toContain("--disallowed-tools")
    })

    it("mode: 'read-only' + disablePlanningTools combines both deny lists", () => {
        const result = buildClaudeArgs(makeQuery({ mode: "read-only", disablePlanningTools: true }), {})
        const disallowedIdx = result.args.indexOf("--disallowed-tools")
        expect(disallowedIdx).toBeGreaterThan(-1)
        const disallowedValue = result.args[disallowedIdx + 1]
        // Write tools from read-only
        expect(disallowedValue).toContain("Edit")
        expect(disallowedValue).toContain("Write")
        expect(disallowedValue).toContain("NotebookEdit")
        // Planning tools
        expect(disallowedValue).toContain("EnterPlanMode")
        expect(disallowedValue).toContain("ExitPlanMode")
    })

    it("mode: 'yolo' without disablePlanningTools produces no tool lists", () => {
        const result = buildClaudeArgs(makeQuery({ mode: "yolo" }), {})
        expect(result.args).not.toContain("--allowedTools")
        expect(result.args).not.toContain("--disallowed-tools")
    })

    it("additionalDirectories → --add-dir per entry", () => {
        const result = buildClaudeArgs(makeQuery({ additionalDirectories: ["/a", "/b"] }), {})
        const addDirIndices = result.args.reduce<number[]>((acc, arg, i) => {
            if (arg === "--add-dir") acc.push(i)
            return acc
        }, [])
        expect(addDirIndices).toHaveLength(2)
        expect(result.args[addDirIndices[0] + 1]).toBe("/a")
        expect(result.args[addDirIndices[1] + 1]).toBe("/b")
    })

    it("systemPrompt produces --system-prompt", () => {
        const result = buildClaudeArgs(makeQuery({ systemPrompt: "You are helpful" }), {})
        expect(result.args).toContain("--system-prompt")
        expect(result.args).toContain("You are helpful")
    })

    it("appendSystemPrompt produces --append-system-prompt", () => {
        const result = buildClaudeArgs(makeQuery({ appendSystemPrompt: "Be concise" }), {})
        expect(result.args).toContain("--append-system-prompt")
        expect(result.args).toContain("Be concise")
    })

    it("disableTelemetry: true (default) sets DISABLE_TELEMETRY=1 in env", () => {
        const result = buildClaudeArgs(makeQuery(), {})
        expect(result.env.DISABLE_TELEMETRY).toBe("1")
        expect(result.env.DISABLE_ERROR_REPORTING).toBe("1")
    })

    it("disableTelemetry: false does not set telemetry env vars", () => {
        const result = buildClaudeArgs(makeQuery(), { disableTelemetry: false })
        expect(result.env.DISABLE_TELEMETRY).toBeUndefined()
        expect(result.env.DISABLE_ERROR_REPORTING).toBeUndefined()
    })

    it("forceSubagentModel: true with model sets ANTHROPIC_DEFAULT_*_MODEL env vars", () => {
        const result = buildClaudeArgs(makeQuery({ model: "opus" }), { forceSubagentModel: true })
        expect(result.env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe("opus")
        expect(result.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe("opus")
        expect(result.env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe("opus")
        expect(result.env.CLAUDE_CODE_SUBAGENT_MODEL).toBe("opus")
    })

    it("forceSubagentModel: true without model does not set subagent env vars", () => {
        const result = buildClaudeArgs(makeQuery(), { forceSubagentModel: true })
        expect(result.env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBeUndefined()
    })

    it("includes --setting-sources with default values", () => {
        const result = buildClaudeArgs(makeQuery(), {})
        expect(result.args).toContain("--setting-sources")
        expect(result.args).toContain("user,project,local")
    })

    it("custom settingSources override default", () => {
        const result = buildClaudeArgs(makeQuery(), { settingSources: ["user"] })
        const idx = result.args.indexOf("--setting-sources")
        expect(result.args[idx + 1]).toBe("user")
    })

    it("cwd is set from query", () => {
        const result = buildClaudeArgs(makeQuery({ cwd: "/home/user/project" }), {})
        expect(result.cwd).toBe("/home/user/project")
    })

    it("query env is merged into result env", () => {
        const result = buildClaudeArgs(makeQuery({ env: { CUSTOM_VAR: "value" } }), {})
        expect(result.env.CUSTOM_VAR).toBe("value")
    })
})
