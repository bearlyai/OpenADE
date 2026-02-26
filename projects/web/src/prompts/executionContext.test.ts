import { describe, expect, it } from "vitest"
import { buildWorktreeExecutionInstruction, mergeAppendSystemPrompt } from "./executionContext"

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
