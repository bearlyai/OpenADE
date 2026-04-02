import { describe, expect, it } from "vitest"
import { buildPlanReviewPrompt, buildReviewHandoffPrompt, buildWorkReviewPrompt } from "./reviewPrompts"

describe("reviewPrompts", () => {
    it("buildPlanReviewPrompt includes thread XML and plan text", () => {
        const result = buildPlanReviewPrompt({
            threadXml: '<task id="t1"><events /></task>',
            planText: "1. Add validation\n2. Add tests",
        })

        expect(result.systemPrompt).toContain('mode="review"')
        expect(result.systemPrompt).toContain("Do NOT modify any files")
        expect(result.userMessage).toContain("<task_thread_context>")
        expect(result.userMessage).toContain('<task id="t1"><events /></task>')
        expect(result.userMessage).toContain("<plan_to_review>")
        expect(result.userMessage).toContain("Add validation")
    })

    it("buildWorkReviewPrompt includes thread XML and review instructions", () => {
        const result = buildWorkReviewPrompt({
            threadXml: '<task id="t2"><events /></task>',
        })

        expect(result.systemPrompt).toContain('mode="review"')
        expect(result.userMessage).toContain("<task_thread_context>")
        expect(result.userMessage).toContain('<task id="t2"><events /></task>')
        expect(result.userMessage).toContain("Review the recent work done by the AI agent")
        expect(result.userMessage).toContain("Location")
        expect(result.userMessage).toContain("Suggestion")
    })

    it("buildReviewHandoffPrompt asks for agree/disagree and approval", () => {
        const prompt = buildReviewHandoffPrompt({
            reviewType: "plan",
            reviewText: "Issue: missing edge case",
        })

        expect(prompt).toContain("<review_feedback>")
        expect(prompt).toContain("Issue: missing edge case")
        expect(prompt).toContain("agree or disagree")
        expect(prompt).toContain("Would you like me to proceed with the agreed-upon changes?")
    })
})
