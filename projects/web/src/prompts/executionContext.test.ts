import { describe, expect, it } from "vitest"
import { buildRawRendererStyleInstruction, buildWorktreeExecutionInstruction, mergeAppendSystemPrompt } from "./executionContext"

// NOTE: No string-containment tests on prompt text. Test logic (conditional returns, merging), not wording.

describe("buildWorktreeExecutionInstruction", () => {
    it("returns undefined for head isolation", () => {
        const result = buildWorktreeExecutionInstruction({ type: "head" }, "/tmp/worktree")
        expect(result).toBeUndefined()
    })
})

describe("mergeAppendSystemPrompt", () => {
    it("returns undefined when both values are missing", () => {
        expect(mergeAppendSystemPrompt(undefined, undefined)).toBeUndefined()
    })

    it("returns base when only base exists", () => {
        expect(mergeAppendSystemPrompt("base", undefined)).toBe("base")
    })

    it("returns extra when only extra exists", () => {
        expect(mergeAppendSystemPrompt(undefined, "extra")).toBe("extra")
    })

    it("joins base and extra with spacing", () => {
        expect(mergeAppendSystemPrompt("base", "extra")).toBe("base\n\nextra")
    })
})

describe("buildRawRendererStyleInstruction", () => {
    it("returns undefined for claude-code", () => {
        expect(buildRawRendererStyleInstruction("claude-code", "do")).toBeUndefined()
    })

    it("returns defined hint for all codex modes", () => {
        expect(buildRawRendererStyleInstruction("codex", "do")).toBeDefined()
        expect(buildRawRendererStyleInstruction("codex", "ask")).toBeDefined()
        expect(buildRawRendererStyleInstruction("codex", "run_plan")).toBeDefined()
        expect(buildRawRendererStyleInstruction("codex", "plan")).toBeDefined()
        expect(buildRawRendererStyleInstruction("codex", "revise")).toBeDefined()
        expect(buildRawRendererStyleInstruction("codex", "hyperplan")).toBeDefined()
    })
})
