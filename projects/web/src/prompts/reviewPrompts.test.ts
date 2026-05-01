import { describe, expect, it } from "vitest"
import { REVIEW_DIMENSIONS, REVIEW_ENGINEERING_GUIDANCE, buildPlanReviewPrompt, buildWorkReviewPrompt } from "./reviewPrompts"

function extractTag(text: string, tagName: string): string | undefined {
    return text.match(new RegExp(`<${tagName}>\\n([\\s\\S]*?)\\n</${tagName}>`))?.[1]
}

function expectSharedReviewGuidance(userMessage: string): void {
    expect(userMessage.includes(REVIEW_DIMENSIONS)).toBe(true)
    expect(userMessage.includes(REVIEW_ENGINEERING_GUIDANCE)).toBe(true)
}

function expectTextUserMessage(userMessage: ReturnType<typeof buildPlanReviewPrompt>["userMessage"]): string {
    if (typeof userMessage !== "string") {
        throw new Error("Expected review prompt userMessage to be text")
    }
    return userMessage
}

describe("buildPlanReviewPrompt", () => {
    it("wraps task thread, plan, changed files, and custom instructions", () => {
        const result = buildPlanReviewPrompt({
            threadXml: '<task id="task-1" />',
            planText: "Plan content",
            changedFiles: ["src/a.ts", "src/b.ts"],
            customInstructions: "  Focus on tests  ",
        })
        const userMessage = expectTextUserMessage(result.userMessage)

        expectSharedReviewGuidance(userMessage)
        expect(extractTag(userMessage, "task_thread_context")).toBe('<task id="task-1" />')
        expect(extractTag(userMessage, "plan_to_review")).toBe("Plan content")
        expect(extractTag(userMessage, "recent_changed_files")).toBe("- src/a.ts\n- src/b.ts")
        expect(extractTag(userMessage, "additional_instructions")).toBe("Focus on tests")
        expect(result.consumedCommentIds).toEqual([])
        expect(result.systemPrompt).toBeDefined()
    })
})

describe("buildWorkReviewPrompt", () => {
    it("wraps task thread, changed files, and custom instructions", () => {
        const result = buildWorkReviewPrompt({
            threadXml: '<task id="task-1" />',
            changedFiles: ["src/a.ts"],
            customInstructions: "Focus on risky tests",
        })
        const userMessage = expectTextUserMessage(result.userMessage)

        expectSharedReviewGuidance(userMessage)
        expect(extractTag(userMessage, "task_thread_context")).toBe('<task id="task-1" />')
        expect(extractTag(userMessage, "recent_changed_files")).toBe("- src/a.ts")
        expect(extractTag(userMessage, "additional_instructions")).toBe("Focus on risky tests")
        expect(extractTag(userMessage, "plan_to_review")).toBeUndefined()
        expect(result.consumedCommentIds).toEqual([])
        expect(result.systemPrompt).toBeDefined()
    })
})
