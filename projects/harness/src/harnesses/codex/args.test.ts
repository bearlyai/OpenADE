import { describe, it, expect, vi } from "vitest"
import { buildCodexArgs } from "./args.js"
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

describe("buildCodexArgs", () => {
    it("mode: 'yolo' produces --yolo", () => {
        const result = buildCodexArgs(makeQuery({ mode: "yolo" }), {})
        expect(result.args).toContain("--yolo")
        expect(result.args).not.toContain("--full-auto")
        expect(result.args).toContain("--json")
        expect(result.args).toContain("exec")
    })

    it("mode: 'read-only' produces -a on-request and --sandbox read-only", () => {
        const result = buildCodexArgs(makeQuery({ mode: "read-only" }), {})
        // Root flags
        const aIdx = result.args.indexOf("-a")
        expect(aIdx).toBeGreaterThanOrEqual(0)
        expect(result.args[aIdx + 1]).toBe("on-request")
        // Subcommand flags
        expect(result.args).toContain("--sandbox")
        const sandboxIdx = result.args.indexOf("--sandbox")
        expect(result.args[sandboxIdx + 1]).toBe("read-only")
    })

    it("model: 'o3' produces -m o3", () => {
        const result = buildCodexArgs(makeQuery({ model: "o3" }), {})
        const mIdx = result.args.indexOf("-m")
        expect(mIdx).toBeGreaterThanOrEqual(0)
        expect(result.args[mIdx + 1]).toBe("o3")
    })

    it("thinking: 'low' → -c model_reasoning_effort=low", () => {
        const result = buildCodexArgs(makeQuery({ thinking: "low" }), {})
        const cIdx = result.args.indexOf("-c")
        expect(cIdx).toBeGreaterThanOrEqual(0)
        expect(result.args[cIdx + 1]).toBe("model_reasoning_effort=low")
    })

    it("thinking: 'med' → -c model_reasoning_effort=medium", () => {
        const result = buildCodexArgs(makeQuery({ thinking: "med" }), {})
        expect(result.args).toContain("model_reasoning_effort=medium")
    })

    it("thinking: 'high' → -c model_reasoning_effort=xhigh", () => {
        const result = buildCodexArgs(makeQuery({ thinking: "high" }), {})
        expect(result.args).toContain("model_reasoning_effort=xhigh")
    })

    it("resumeSessionId changes subcommand to exec resume", () => {
        const result = buildCodexArgs(makeQuery({ resumeSessionId: "abc-123" }), {})
        const execIdx = result.args.indexOf("exec")
        expect(execIdx).toBeGreaterThanOrEqual(0)
        expect(result.args[execIdx + 1]).toBe("resume")
        // Session ID and prompt should be positional args
        expect(result.args).toContain("abc-123")
    })

    it("resume preserves root mode flags", () => {
        const result = buildCodexArgs(makeQuery({ mode: "read-only", resumeSessionId: "abc" }), {})
        expect(result.args).toContain("-a")
        expect(result.args).toContain("on-request")
        expect(result.args).toContain("resume")
    })

    it("forkSession: true logs a warning", () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
        buildCodexArgs(makeQuery({ forkSession: true }), {})
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("forkSession is not supported"))
        warnSpy.mockRestore()
    })

    it("cwd produces -C flag", () => {
        const result = buildCodexArgs(makeQuery({ cwd: "/home/user" }), {})
        const cIdx = result.args.indexOf("-C")
        expect(cIdx).toBeGreaterThanOrEqual(0)
        expect(result.args[cIdx + 1]).toBe("/home/user")
    })

    it("additionalDirectories → --add-dir per entry", () => {
        const result = buildCodexArgs(makeQuery({ additionalDirectories: ["/a", "/b"] }), {})
        const addDirIndices = result.args.reduce<number[]>((acc, arg, i) => {
            if (arg === "--add-dir") acc.push(i)
            return acc
        }, [])
        expect(addDirIndices).toHaveLength(2)
        expect(result.args[addDirIndices[0] + 1]).toBe("/a")
        expect(result.args[addDirIndices[1] + 1]).toBe("/b")
    })

    it("MCP servers produce -c overrides when passed through", () => {
        const mcpConfigArgs = ['mcp_servers.test.type="stdio"', 'mcp_servers.test.command="node"']
        const result = buildCodexArgs(makeQuery(), {}, mcpConfigArgs)

        // Should have -c flags for each override
        const cIndices = result.args.reduce<number[]>((acc, arg, i) => {
            if (arg === "-c") acc.push(i)
            return acc
        }, [])
        expect(cIndices.length).toBeGreaterThanOrEqual(2)
    })

    it("resume does not include exec-level flags (--sandbox, -m, -C, --add-dir, -c)", () => {
        const result = buildCodexArgs(
            makeQuery({
                mode: "read-only",
                resumeSessionId: "abc-123",
                model: "o3",
                cwd: "/tmp/test",
                thinking: "high",
                additionalDirectories: ["/extra"],
            }),
            {}
        )
        // Resume subcommand should only accept --json, session ID, and prompt
        expect(result.args).not.toContain("--sandbox")
        expect(result.args).not.toContain("-m")
        expect(result.args).not.toContain("-C")
        expect(result.args).not.toContain("--add-dir")
        // -c for thinking/config should also be excluded
        const cIndices = result.args.reduce<number[]>((acc, arg, i) => {
            if (arg === "-c") acc.push(i)
            return acc
        }, [])
        expect(cIndices).toHaveLength(0)
        // But should still have the basics
        expect(result.args).toContain("--json")
        expect(result.args).toContain("resume")
        expect(result.args).toContain("abc-123")
    })

    it("allowedTools and disallowedTools are ignored (no args produced)", () => {
        const result = buildCodexArgs(makeQuery({ allowedTools: ["Read", "Bash"], disallowedTools: ["Write"] }), {})
        expect(result.args).not.toContain("--allowed-tools")
        expect(result.args).not.toContain("--disallowed-tools")
    })

    it("system prompt is prepended to the prompt text", () => {
        const result = buildCodexArgs(makeQuery({ prompt: "do something", systemPrompt: "Be helpful" }), {})
        // The last arg should be the prompt with system instructions prepended
        const lastArg = result.args[result.args.length - 1]
        expect(lastArg).toContain("<system-instructions>")
        expect(lastArg).toContain("Be helpful")
        expect(lastArg).toContain("do something")
    })

    it("appendSystemPrompt is treated same as systemPrompt", () => {
        const result = buildCodexArgs(makeQuery({ prompt: "do stuff", appendSystemPrompt: "Extra instructions" }), {})
        const lastArg = result.args[result.args.length - 1]
        expect(lastArg).toContain("<system-instructions>")
        expect(lastArg).toContain("Extra instructions")
    })

    it("prompt as PromptPart[] joins text parts", () => {
        const result = buildCodexArgs(
            makeQuery({
                prompt: [
                    { type: "text", text: "part 1" },
                    { type: "text", text: "part 2" },
                ],
            }),
            {}
        )
        const lastArg = result.args[result.args.length - 1]
        expect(lastArg).toBe("part 1\npart 2")
    })

    it("query env is merged into result env", () => {
        const result = buildCodexArgs(makeQuery({ env: { CUSTOM_VAR: "value" } }), {})
        expect(result.env.CUSTOM_VAR).toBe("value")
    })
})
