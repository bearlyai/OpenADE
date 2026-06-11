import { describe, it, expect, vi } from "vitest"
import { buildOpencodeArgs } from "./args.js"
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

describe("buildOpencodeArgs", () => {
    it("uses run with JSON output", async () => {
        const result = await buildOpencodeArgs(makeQuery(), {})
        expect(result.args.slice(0, 3)).toEqual(["run", "--format", "json"])
    })

    it("mode: 'yolo' auto-approves permissions", async () => {
        const result = await buildOpencodeArgs(makeQuery({ mode: "yolo" }), {})
        expect(result.args).toContain("--dangerously-skip-permissions")
    })

    it("mode: 'read-only' overlays deny edit/bash permissions", async () => {
        const result = await buildOpencodeArgs(makeQuery({ mode: "read-only" }), {})
        expect(result.args).not.toContain("--dangerously-skip-permissions")
        const config = JSON.parse(result.env.OPENCODE_CONFIG_CONTENT)
        expect(config.permission.edit).toBe("deny")
        expect(config.permission.bash).toBe("deny")
    })

    it("read-only config includes additional directory permissions", async () => {
        const result = await buildOpencodeArgs(makeQuery({ mode: "read-only", additionalDirectories: ["/tmp/extra"] }), {})
        const config = JSON.parse(result.env.OPENCODE_CONFIG_CONTENT)
        expect(config.permission.external_directory).toEqual({
            "/tmp/extra": "allow",
            "/tmp/extra/**": "allow",
        })
    })

    it("model produces -m provider/model", async () => {
        const result = await buildOpencodeArgs(makeQuery({ model: "anthropic/claude-sonnet-4-5" }), {})
        const modelIdx = result.args.indexOf("-m")
        expect(result.args[modelIdx + 1]).toBe("anthropic/claude-sonnet-4-5")
    })

    it("thinking maps to --variant", async () => {
        const result = await buildOpencodeArgs(makeQuery({ thinking: "med" }), {})
        const variantIdx = result.args.indexOf("--variant")
        expect(result.args[variantIdx + 1]).toBe("medium")
    })

    it("resume uses --session and supports --fork", async () => {
        const result = await buildOpencodeArgs(makeQuery({ resumeSessionId: "ses_123", forkSession: true }), {})
        expect(result.args).toContain("--session")
        expect(result.args[result.args.indexOf("--session") + 1]).toBe("ses_123")
        expect(result.args).toContain("--fork")
    })

    it("passes cwd through --dir", async () => {
        const result = await buildOpencodeArgs(makeQuery({ cwd: "/home/user/project" }), {})
        const dirIdx = result.args.indexOf("--dir")
        expect(result.args[dirIdx + 1]).toBe("/home/user/project")
    })

    it("system prompt is prepended to positional message", async () => {
        const result = await buildOpencodeArgs(makeQuery({ prompt: "do something", systemPrompt: "Be careful" }), {})
        const dashDashIdx = result.args.indexOf("--")
        const prompt = result.args[dashDashIdx + 1]
        expect(prompt).toContain("<system-instructions>")
        expect(prompt).toContain("Be careful")
        expect(prompt).toContain("do something")
    })

    it("outputSchema appends structured output instruction", async () => {
        const schema = {
            type: "object",
            properties: { answer: { type: "string" } },
            required: ["answer"],
        }
        const result = await buildOpencodeArgs(makeQuery({ outputSchema: schema }), {})
        const prompt = result.args[result.args.indexOf("--") + 1]
        expect(prompt).toContain("Return only valid JSON")
        expect(prompt).toContain('"answer"')
    })

    it("prompt as PromptPart[] joins text parts", async () => {
        const result = await buildOpencodeArgs(
            makeQuery({
                prompt: [
                    { type: "text", text: "part 1" },
                    { type: "text", text: "part 2" },
                ],
            }),
            {}
        )
        expect(result.args[result.args.indexOf("--") + 1]).toBe("part 1\npart 2")
    })

    it("forkSession without resume logs a warning", async () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
        await buildOpencodeArgs(makeQuery({ forkSession: true }), {})
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("forkSession requires"))
        warnSpy.mockRestore()
    })
})
