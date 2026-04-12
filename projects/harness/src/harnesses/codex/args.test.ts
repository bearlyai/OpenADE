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
    it("--skip-git-repo-check is an exec-level flag (after exec subcommand)", async () => {
        const result = await buildCodexArgs(makeQuery(), {})
        expect(result.args).toContain("--skip-git-repo-check")
        const skipIdx = result.args.indexOf("--skip-git-repo-check")
        const execIdx = result.args.indexOf("exec")
        expect(skipIdx).toBeGreaterThan(execIdx)
    })

    it("mode: 'yolo' produces --yolo", async () => {
        const result = await buildCodexArgs(makeQuery({ mode: "yolo" }), {})
        expect(result.args).toContain("--yolo")
        expect(result.args).not.toContain("--full-auto")
        expect(result.args).toContain("--json")
        expect(result.args).toContain("exec")
    })

    it("mode: 'read-only' produces -a on-request and --sandbox read-only", async () => {
        const result = await buildCodexArgs(makeQuery({ mode: "read-only" }), {})
        // Root flags
        const aIdx = result.args.indexOf("-a")
        expect(aIdx).toBeGreaterThanOrEqual(0)
        expect(result.args[aIdx + 1]).toBe("on-request")
        // Subcommand flags
        expect(result.args).toContain("--sandbox")
        const sandboxIdx = result.args.indexOf("--sandbox")
        expect(result.args[sandboxIdx + 1]).toBe("read-only")
    })

    it("model: 'o3' produces -m o3", async () => {
        const result = await buildCodexArgs(makeQuery({ model: "o3" }), {})
        const mIdx = result.args.indexOf("-m")
        expect(mIdx).toBeGreaterThanOrEqual(0)
        expect(result.args[mIdx + 1]).toBe("o3")
    })

    it("thinking: 'low' → -c model_reasoning_effort=low", async () => {
        const result = await buildCodexArgs(makeQuery({ thinking: "low" }), {})
        const cIdx = result.args.indexOf("-c")
        expect(cIdx).toBeGreaterThanOrEqual(0)
        expect(result.args[cIdx + 1]).toBe("model_reasoning_effort=low")
    })

    it("thinking: 'med' → -c model_reasoning_effort=medium", async () => {
        const result = await buildCodexArgs(makeQuery({ thinking: "med" }), {})
        expect(result.args).toContain("model_reasoning_effort=medium")
    })

    it("thinking: 'high' → -c model_reasoning_effort=high", async () => {
        const result = await buildCodexArgs(makeQuery({ thinking: "high" }), {})
        expect(result.args).toContain("model_reasoning_effort=high")
    })

    it("thinking: 'max' → -c model_reasoning_effort=xhigh", async () => {
        const result = await buildCodexArgs(makeQuery({ thinking: "max" }), {})
        expect(result.args).toContain("model_reasoning_effort=xhigh")
    })

    it("resumeSessionId changes subcommand to exec resume", async () => {
        const result = await buildCodexArgs(makeQuery({ resumeSessionId: "abc-123" }), {})
        const execIdx = result.args.indexOf("exec")
        expect(execIdx).toBeGreaterThanOrEqual(0)
        expect(result.args[execIdx + 1]).toBe("resume")
        // Session ID and prompt should be positional args
        expect(result.args).toContain("abc-123")
    })

    it("resume preserves root mode flags", async () => {
        const result = await buildCodexArgs(makeQuery({ mode: "read-only", resumeSessionId: "abc" }), {})
        expect(result.args).toContain("-a")
        expect(result.args).toContain("on-request")
        expect(result.args).toContain("resume")
    })

    it("outputSchema adds --output-schema and --output-last-message for exec", async () => {
        const schema = {
            type: "object",
            additionalProperties: false,
            properties: {
                answer: { type: "string" },
            },
            required: ["answer"],
        }

        const result = await buildCodexArgs(makeQuery({ outputSchema: schema }), {})
        const outputSchemaIdx = result.args.indexOf("--output-schema")
        const outputLastMessageIdx = result.args.indexOf("--output-last-message")

        expect(outputSchemaIdx).toBeGreaterThan(-1)
        expect(result.args[outputSchemaIdx + 1]).toMatch(/harness-schema-.*\.json$/)
        expect(outputLastMessageIdx).toBeGreaterThan(-1)
        expect(result.args[outputLastMessageIdx + 1]).toMatch(/harness-output-.*\.json$/)
        expect(result.structuredOutputPath).toBe(result.args[outputLastMessageIdx + 1])
    })

    it("outputSchema also adds schema flags for resume", async () => {
        const schema = {
            type: "object",
            additionalProperties: false,
            properties: {
                answer: { type: "string" },
            },
            required: ["answer"],
        }

        const result = await buildCodexArgs(makeQuery({ resumeSessionId: "abc-123", outputSchema: schema }), {})
        expect(result.args).toContain("--output-schema")
        expect(result.args).toContain("--output-last-message")
    })

    it("forkSession: true logs a warning", async () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
        await buildCodexArgs(makeQuery({ forkSession: true }), {})
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("forkSession is not supported"))
        warnSpy.mockRestore()
    })

    it("cwd produces -C flag", async () => {
        const result = await buildCodexArgs(makeQuery({ cwd: "/home/user" }), {})
        const cIdx = result.args.indexOf("-C")
        expect(cIdx).toBeGreaterThanOrEqual(0)
        expect(result.args[cIdx + 1]).toBe("/home/user")
    })

    it("additionalDirectories → --add-dir per entry", async () => {
        const result = await buildCodexArgs(makeQuery({ additionalDirectories: ["/a", "/b"] }), {})
        const addDirIndices = result.args.reduce<number[]>((acc, arg, i) => {
            if (arg === "--add-dir") acc.push(i)
            return acc
        }, [])
        expect(addDirIndices).toHaveLength(2)
        expect(result.args[addDirIndices[0] + 1]).toBe("/a")
        expect(result.args[addDirIndices[1] + 1]).toBe("/b")
    })

    it("MCP servers produce -c overrides when passed through", async () => {
        const mcpConfigArgs = ['mcp_servers.test.type="stdio"', 'mcp_servers.test.command="node"']
        const result = await buildCodexArgs(makeQuery(), {}, mcpConfigArgs)

        // Should have -c flags for each override
        const cIndices = result.args.reduce<number[]>((acc, arg, i) => {
            if (arg === "-c") acc.push(i)
            return acc
        }, [])
        expect(cIndices.length).toBeGreaterThanOrEqual(2)
    })

    it("resume does not include exec-level flags (--sandbox, -m, -C, --add-dir, -c)", async () => {
        const result = await buildCodexArgs(
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

    it("disablePlanningTools is ignored for Codex (no args produced)", async () => {
        const result = await buildCodexArgs(makeQuery({ disablePlanningTools: true }), {})
        expect(result.args).not.toContain("--allowed-tools")
        expect(result.args).not.toContain("--disallowed-tools")
    })

    it("system prompt is prepended to the prompt text", async () => {
        const result = await buildCodexArgs(makeQuery({ prompt: "do something", systemPrompt: "Be helpful" }), {})
        // The last arg should be the prompt with system instructions prepended (after --)
        const lastArg = result.args[result.args.length - 1]
        expect(lastArg).toContain("<system-instructions>")
        expect(lastArg).toContain("Be helpful")
        expect(lastArg).toContain("do something")
    })

    it("appendSystemPrompt is treated same as systemPrompt", async () => {
        const result = await buildCodexArgs(makeQuery({ prompt: "do stuff", appendSystemPrompt: "Extra instructions" }), {})
        const lastArg = result.args[result.args.length - 1]
        expect(lastArg).toContain("<system-instructions>")
        expect(lastArg).toContain("Extra instructions")
    })

    it("prompt as PromptPart[] joins text parts", async () => {
        const result = await buildCodexArgs(
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

    it("prompt starting with '-' is placed after '--' separator to avoid flag parsing", async () => {
        const result = await buildCodexArgs(makeQuery({ prompt: "- Fix the download button" }), {})
        const dashDashIdx = result.args.indexOf("--")
        expect(dashDashIdx).toBeGreaterThan(-1)
        expect(result.args[dashDashIdx + 1]).toBe("- Fix the download button")
    })

    it("prompt starting with '--' is safely placed after '--' separator", async () => {
        const result = await buildCodexArgs(makeQuery({ prompt: "--help" }), {})
        const dashDashIdx = result.args.indexOf("--")
        expect(dashDashIdx).toBeGreaterThan(-1)
        expect(result.args[dashDashIdx + 1]).toBe("--help")
    })

    it("resume with dash-prefixed prompt uses '--' separator", async () => {
        const result = await buildCodexArgs(makeQuery({ prompt: "- Continue fixing", resumeSessionId: "abc-123" }), {})
        const dashDashIdx = result.args.indexOf("--")
        expect(dashDashIdx).toBeGreaterThan(-1)
        // After --, positional args: session ID then prompt
        expect(result.args[dashDashIdx + 1]).toBe("abc-123")
        expect(result.args[dashDashIdx + 2]).toBe("- Continue fixing")
    })

    it("multi-line prompt with dash-prefixed lines is placed after '--' separator", async () => {
        const prompt = "- Files should have a download button\n- We should show some metadata"
        const result = await buildCodexArgs(makeQuery({ prompt }), {})
        const dashDashIdx = result.args.indexOf("--")
        expect(dashDashIdx).toBeGreaterThan(-1)
        expect(result.args[dashDashIdx + 1]).toBe(prompt)
    })

    it("query env is merged into result env", async () => {
        const result = await buildCodexArgs(makeQuery({ env: { CUSTOM_VAR: "value" } }), {})
        expect(result.env.CUSTOM_VAR).toBe("value")
    })

    // ── Image support ──

    it("prompt with base64 image writes temp file and adds -i flag", async () => {
        const result = await buildCodexArgs(
            makeQuery({
                prompt: [
                    { type: "image", source: { kind: "base64", data: "aGVsbG8=", mediaType: "image/png" } },
                    { type: "text", text: "describe this" },
                ],
            }),
            {}
        )
        const iIdx = result.args.indexOf("-i")
        expect(iIdx).toBeGreaterThan(-1)
        expect(result.args[iIdx + 1]).toMatch(/harness-img-.*\.png$/)
        expect(result.cleanup.some((c) => c.type === "file")).toBe(true)
        // Prompt text after -- should be just the text part
        const dashDashIdx = result.args.indexOf("--")
        expect(result.args[dashDashIdx + 1]).toBe("describe this")
    })

    it("prompt with path image passes path directly via -i without cleanup", async () => {
        const result = await buildCodexArgs(
            makeQuery({
                prompt: [
                    { type: "image", source: { kind: "path", path: "/data/images/abc.png", mediaType: "image/png" } },
                    { type: "text", text: "describe this" },
                ],
            }),
            {}
        )
        const iIdx = result.args.indexOf("-i")
        expect(iIdx).toBeGreaterThan(-1)
        expect(result.args[iIdx + 1]).toBe("/data/images/abc.png")
        expect(result.cleanup).toHaveLength(0)
    })

    it("text-only PromptPart[] produces no -i flag", async () => {
        const result = await buildCodexArgs(
            makeQuery({ prompt: [{ type: "text", text: "hello" }] }),
            {}
        )
        expect(result.args).not.toContain("-i")
        expect(result.cleanup).toHaveLength(0)
    })

    it("resume mode includes -i flag with images", async () => {
        const result = await buildCodexArgs(
            makeQuery({
                prompt: [
                    { type: "image", source: { kind: "base64", data: "aGVsbG8=", mediaType: "image/png" } },
                    { type: "text", text: "describe this" },
                ],
                resumeSessionId: "abc-123",
            }),
            {}
        )
        const iIdx = result.args.indexOf("-i")
        expect(iIdx).toBeGreaterThan(-1)
        expect(result.args[iIdx + 1]).toMatch(/harness-img-.*\.png$/)
    })

    it("multiple images produce multiple -i flags", async () => {
        const result = await buildCodexArgs(
            makeQuery({
                prompt: [
                    { type: "image", source: { kind: "path", path: "/data/images/a.png", mediaType: "image/png" } },
                    { type: "image", source: { kind: "path", path: "/data/images/b.jpg", mediaType: "image/jpeg" } },
                    { type: "text", text: "compare these" },
                ],
            }),
            {}
        )
        const iIndices = result.args.reduce<number[]>((acc, arg, i) => {
            if (arg === "-i") acc.push(i)
            return acc
        }, [])
        expect(iIndices).toHaveLength(2)
        expect(result.args[iIndices[0] + 1]).toBe("/data/images/a.png")
        expect(result.args[iIndices[1] + 1]).toBe("/data/images/b.jpg")
    })
})
