import { describe, expect, it } from "vitest"
import { type ReconcileInput, buildHyperPlanStepPrompt, buildReconcileStepPrompt, buildReviewStepPrompt } from "./prompts"

describe("buildHyperPlanStepPrompt", () => {
    it("returns system prompt and user message", () => {
        const result = buildHyperPlanStepPrompt("Add a dark mode toggle")
        expect(result.systemPrompt).toContain("Risks & Alternatives")
        expect(result.userMessage).toBe("Add a dark mode toggle")
    })

    it("includes plan mode instructions in system prompt", () => {
        const result = buildHyperPlanStepPrompt("task")
        // Should contain planning-related content from PLAN_MODE_INSTRUCTIONS
        expect(result.systemPrompt.length).toBeGreaterThan(100)
    })
})

describe("buildReviewStepPrompt", () => {
    it("wraps plan text in XML tags with step ID", () => {
        const result = buildReviewStepPrompt("task desc", "The plan content", "plan_0")
        expect(result.userMessage).toContain("<plan_to_review id=\"plan_0\">")
        expect(result.userMessage).toContain("The plan content")
        expect(result.userMessage).toContain("</plan_to_review>")
    })

    it("includes task description", () => {
        const result = buildReviewStepPrompt("Add a dark mode toggle", "plan", "plan_0")
        expect(result.userMessage).toContain("<task_description>")
        expect(result.userMessage).toContain("Add a dark mode toggle")
    })

    it("system prompt instructs review mode", () => {
        const result = buildReviewStepPrompt("task", "plan", "plan_0")
        expect(result.systemPrompt).toContain("mode=\"review\"")
        expect(result.systemPrompt).toContain("Strengths")
        expect(result.systemPrompt).toContain("Weaknesses")
        expect(result.systemPrompt).toContain("Risks")
        expect(result.systemPrompt).toContain("Suggestions")
    })

    it("system prompt forbids producing a new plan", () => {
        const result = buildReviewStepPrompt("task", "plan", "plan_0")
        expect(result.systemPrompt).toContain("Do not produce a new plan")
    })
})

describe("buildReconcileStepPrompt", () => {
    const planA: ReconcileInput = { stepId: "plan_0", primitive: "plan", text: "Plan A content" }
    const planB: ReconcileInput = { stepId: "plan_1", primitive: "plan", text: "Plan B content" }

    it("includes all input texts", () => {
        const result = buildReconcileStepPrompt("task", [planA, planB])
        expect(result.userMessage).toContain("Plan A content")
        expect(result.userMessage).toContain("Plan B content")
    })

    it("marks inputs as randomly ordered", () => {
        const result = buildReconcileStepPrompt("task", [planA, planB])
        expect(result.userMessage).toContain('randomly_ordered="true"')
    })

    it("includes task description", () => {
        const result = buildReconcileStepPrompt("Fix the login bug", [planA])
        expect(result.userMessage).toContain("<task_description>")
        expect(result.userMessage).toContain("Fix the login bug")
    })

    it("assigns anonymous labels (A, B, etc.)", () => {
        const result = buildReconcileStepPrompt("task", [planA, planB])
        // After shuffling, each gets a label — A and B should both appear
        expect(result.userMessage).toMatch(/id="A"/)
        expect(result.userMessage).toMatch(/id="B"/)
    })

    it("includes review attributes for review inputs", () => {
        const review: ReconcileInput = {
            stepId: "review_0",
            primitive: "review",
            text: "Review of plan A",
            reviewsStepId: "plan_0",
        }
        const result = buildReconcileStepPrompt("task", [planA, review])
        // Review should have a reviews attribute referencing the plan
        expect(result.userMessage).toContain("reviews=")
    })

    it("uses reconcile mode system prompt", () => {
        const result = buildReconcileStepPrompt("task", [planA, planB])
        expect(result.systemPrompt).toContain('mode="reconcile"')
        expect(result.systemPrompt).toContain("evaluation_rubric")
        expect(result.systemPrompt).toContain("Reconciliation Notes")
    })

    it("system prompt emphasizes no plan has priority", () => {
        const result = buildReconcileStepPrompt("task", [planA])
        expect(result.systemPrompt).toContain("no plan has inherent priority")
    })

    it("shuffles inputs (statistical test)", () => {
        // Run many times and check that the content order varies
        // Each plan has unique text, so we track which text appears under label A
        const inputs: ReconcileInput[] = [
            { stepId: "x", primitive: "plan", text: "CONTENT_FIRST" },
            { stepId: "y", primitive: "plan", text: "CONTENT_SECOND" },
            { stepId: "z", primitive: "plan", text: "CONTENT_THIRD" },
        ]

        const contentOrders = new Set<string>()
        for (let i = 0; i < 50; i++) {
            const result = buildReconcileStepPrompt("task", inputs)
            // Extract the order of content blocks by finding which content appears first
            const contentPositions = ["CONTENT_FIRST", "CONTENT_SECOND", "CONTENT_THIRD"]
                .map((c) => result.userMessage.indexOf(c))
                .join(",")
            contentOrders.add(contentPositions)
        }

        // With 3 items and 50 iterations, we should see more than 1 ordering
        // (probability of always getting the same order is (1/6)^49, essentially 0)
        expect(contentOrders.size).toBeGreaterThan(1)
    })
})
