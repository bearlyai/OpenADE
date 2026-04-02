import { describe, expect, it } from "vitest"
import { buildPlanReviewPrompt, buildReviewHandoffPrompt, buildWorkReviewPrompt } from "./reviewPrompts"

describe("reviewPrompts", () => {
    it("buildPlanReviewPrompt includes thread XML and plan text", () => {
        const result = buildPlanReviewPrompt({
            threadXml: '<task id="t1"><events /></task>',
            planText: "1. Add validation\n2. Add tests",
            customInstructions: "Focus on auth edge cases",
        })

        expect(result.systemPrompt).toContain('mode="review"')
        expect(result.systemPrompt).toContain("Do NOT modify any files")
        expect(result.userMessage).toContain("<task_thread_context>")
        expect(result.userMessage).toContain('<task id="t1"><events /></task>')
        expect(result.userMessage).toContain("<plan_to_review>")
        expect(result.userMessage).toContain("Add validation")
        expect(result.userMessage).toContain("<additional_instructions>")
        expect(result.userMessage).toContain("Focus on auth edge cases")
    })

    it("buildWorkReviewPrompt includes thread XML and review instructions", () => {
        const result = buildWorkReviewPrompt({
            threadXml: '<task id="t2"><events /></task>',
            changedFiles: ["modified: src/a.ts", "added: src/new.ts"],
            customInstructions: "Prioritize bugs only",
        })

        expect(result.systemPrompt).toContain('mode="review"')
        expect(result.userMessage).toContain("<task_thread_context>")
        expect(result.userMessage).toContain('<task id="t2"><events /></task>')
        expect(result.userMessage).toContain("Review the recent work")
        expect(result.userMessage).toContain("Location")
        expect(result.userMessage).toContain("Suggestion")
        expect(result.userMessage).toContain("<recent_changed_files>")
        expect(result.userMessage).toContain("modified: src/a.ts")
        expect(result.userMessage).toContain("<additional_instructions>")
        expect(result.userMessage).toContain("Prioritize bugs only")
    })

    it("buildReviewHandoffPrompt asks for agree/disagree and approval", () => {
        const prompt = buildReviewHandoffPrompt({
            reviewType: "plan",
            reviewText: "Issue: missing edge case",
        })

        expect(prompt).toContain("<review_feedback>")
        expect(prompt).toContain("Issue: missing edge case")
        expect(prompt).toContain("Decision: Agree | Disagree")
        expect(prompt).toContain("short bug summary")
        expect(prompt).toContain("Would you like me to proceed with the agreed-upon changes?")
    })
})
