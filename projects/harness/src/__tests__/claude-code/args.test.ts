import { describe, it, expect } from "vitest"
import { buildClaudeArgs } from "../../harnesses/claude-code/args.js"
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

    it("mode: 'read-only' produces --permission-mode plan", () => {
        const result = buildClaudeArgs(makeQuery({ mode: "read-only" }), {})
        expect(result.args).toContain("--permission-mode")
        expect(result.args).toContain("plan")
    })

    it("model: 'opus' produces --model opus", () => {
        const result = buildClaudeArgs(makeQuery({ model: "opus" }), {})
        expect(result.args).toContain("--model")
        expect(result.args).toContain("opus")
    })

    it("thinking: 'low' → --effort low", () => {
        const result = buildClaudeArgs(makeQuery({ thinking: "low" }), {})
        expect(result.args).toContain("--effort")
        expect(result.args).toContain("low")
        expect(result.args).toContain("--max-thinking-tokens")
        expect(result.args).toContain("3000")
    })

    it("thinking: 'med' → --effort medium", () => {
        const result = buildClaudeArgs(makeQuery({ thinking: "med" }), {})
        const effortIdx = result.args.indexOf("--effort")
        expect(result.args[effortIdx + 1]).toBe("medium")
        const tokensIdx = result.args.indexOf("--max-thinking-tokens")
        expect(result.args[tokensIdx + 1]).toBe("5000")
    })

    it("thinking: 'high' → --effort high", () => {
        const result = buildClaudeArgs(makeQuery({ thinking: "high" }), {})
        const effortIdx = result.args.indexOf("--effort")
        expect(result.args[effortIdx + 1]).toBe("high")
        const tokensIdx = result.args.indexOf("--max-thinking-tokens")
        expect(result.args[tokensIdx + 1]).toBe("10000")
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

    it("allowedTools produces --allowed-tools comma-separated", () => {
        const result = buildClaudeArgs(makeQuery({ allowedTools: ["Read", "Bash"] }), {})
        expect(result.args).toContain("--allowed-tools")
        expect(result.args).toContain("Read,Bash")
    })

    it("disallowedTools produces --disallowed-tools comma-separated", () => {
        const result = buildClaudeArgs(makeQuery({ disallowedTools: ["Write", "Edit"] }), {})
        expect(result.args).toContain("--disallowed-tools")
        expect(result.args).toContain("Write,Edit")
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
