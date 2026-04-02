import { describe, expect, it } from "vitest"
import { buildRawRendererStyleInstruction, buildWorktreeExecutionInstruction, mergeAppendSystemPrompt } from "./executionContext"

describe("buildWorktreeExecutionInstruction", () => {
    it("returns undefined for head isolation", () => {
        const result = buildWorktreeExecutionInstruction({ type: "head" }, "/tmp/worktree")
        expect(result).toBeUndefined()
    })

    it("returns instruction text for worktree isolation", () => {
        const result = buildWorktreeExecutionInstruction({ type: "worktree", sourceBranch: "main" }, "/tmp/wt-123")
        expect(result).toContain("Important: you're in a worktree (/tmp/wt-123) do all your work in this worktree.")
        expect(result).toContain("<worktree_instruction>")
        expect(result).toContain("</worktree_instruction>")
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

    it("returns hint for codex do", () => {
        const hint = buildRawRendererStyleInstruction("codex", "do")
        expect(hint).toContain("<raw_renderer_response_style>")
        expect(hint).toContain("Do not use markdown links for local files.")
    })

    it("returns hint for codex ask", () => {
        const hint = buildRawRendererStyleInstruction("codex", "ask")
        expect(hint).toContain("Do not include absolute filesystem paths.")
    })

    it("returns hint for codex run_plan", () => {
        const hint = buildRawRendererStyleInstruction("codex", "run_plan")
        expect(hint).toContain("Keep it compact")
    })

    it("returns undefined for codex plan/revise/hyperplan", () => {
        expect(buildRawRendererStyleInstruction("codex", "plan")).toBeUndefined()
        expect(buildRawRendererStyleInstruction("codex", "revise")).toBeUndefined()
        expect(buildRawRendererStyleInstruction("codex", "hyperplan")).toBeUndefined()
    })
})
