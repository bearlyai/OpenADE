import { describe, expect, it } from "vitest"
import { ACTION_PROMPTS } from "./prompts"

describe("buildCommitPrompt", () => {
    it("returns base commit prompt when no additional instructions", () => {
        const prompt = ACTION_PROMPTS.commit()
        expect(prompt).toContain("Review the current git working tree")
        expect(prompt).not.toContain("user_commit_instructions")
    })

    it("returns base commit prompt for empty string", () => {
        const prompt = ACTION_PROMPTS.commit("")
        expect(prompt).toContain("Review the current git working tree")
        expect(prompt).not.toContain("user_commit_instructions")
    })

    it("returns base commit prompt for whitespace-only string", () => {
        const prompt = ACTION_PROMPTS.commit("   ")
        expect(prompt).not.toContain("user_commit_instructions")
    })

    it("includes user instructions with precedence language when provided", () => {
        const prompt = ACTION_PROMPTS.commit("Use conventional commits format")
        expect(prompt).toContain("Review the current git working tree")
        expect(prompt).toContain("take precedence")
        expect(prompt).toContain("<user_commit_instructions>")
        expect(prompt).toContain("Use conventional commits format")
    })
})
