import { describe, expect, it } from "vitest"
import { type ReconcileInput, buildHyperPlanStepPrompt, buildReconcileStepPrompt, buildReviewStepPrompt, buildReviseStepPrompt } from "./prompts"

describe("buildHyperPlanStepPrompt", () => {
    it("returns raw task description when no thread context is provided", () => {
        const result = buildHyperPlanStepPrompt("Add dark mode")
        expect(result.userMessage).toBe("Add dark mode")
        expect(result.systemPrompt.length).toBeGreaterThan(0)
    })

    it("embeds thread context and metadata when provided", () => {
        const xml = '<task id="task-1"><events /></task>'
        const result = buildHyperPlanStepPrompt("Add dark mode", {
            mainThreadContextXml: xml,
            mainThreadContextMeta: {
                truncated: true,
                includedEvents: 8,
                omittedEvents: 12,
                byteLength: 12345,
            },
        })

        const tagMatch = result.userMessage.match(/<main_thread_context ([^>]+)>/)
        expect(tagMatch).toBeTruthy()
        const attrs = Object.fromEntries(Array.from(tagMatch![1].matchAll(/([a-zA-Z]+)="([^"]*)"/g), (m) => [m[1], m[2]]))
        expect(attrs.format).toBe("task_thread_xml")
        expect(attrs.truncated).toBe("true")
        expect(attrs.includedEvents).toBe("8")
        expect(attrs.omittedEvents).toBe("12")
        expect(attrs.byteLength).toBe("12345")
        expect(result.userMessage.endsWith(`\n${xml}\n</main_thread_context>`)).toBe(true)
    })
})

describe("buildReviewStepPrompt", () => {
    it("wraps task and plan content with the expected XML structure", () => {
        const result = buildReviewStepPrompt("task desc", "The plan content", "plan_0")
        const taskMatch = result.userMessage.match(/<task_description>\n([\s\S]*?)\n<\/task_description>/)
        const planMatch = result.userMessage.match(/<plan_to_review id="([^"]+)">\n([\s\S]*?)\n<\/plan_to_review>/)
        expect(taskMatch?.[1]).toBe("task desc")
        expect(planMatch?.[1]).toBe("plan_0")
        expect(planMatch?.[2]).toBe("The plan content")
        expect(result.systemPrompt.length).toBeGreaterThan(0)
    })
})

describe("buildReviseStepPrompt", () => {
    it("interpolates reviewer id and review body into the peer_review wrapper", () => {
        const reviewBody = "Review content here"
        const result = buildReviseStepPrompt(reviewBody, "review_b")
        const peerReviewMatch = result.userMessage.match(/<peer_review from="([^"]+)">\n([\s\S]*?)\n<\/peer_review>/)
        expect(peerReviewMatch?.[1]).toBe("review_b")
        expect(peerReviewMatch?.[2]).toBe(reviewBody)
        expect(result.systemPrompt.length).toBeGreaterThan(0)
    })
})

describe("buildReconcileStepPrompt", () => {
    const planA: ReconcileInput = {
        stepId: "plan_0",
        primitive: "plan",
        text: "Plan A content",
    }
    const planB: ReconcileInput = {
        stepId: "plan_1",
        primitive: "plan",
        text: "Plan B content",
    }

    it("returns labelMapping with correct stepIds and unique labels", () => {
        const result = buildReconcileStepPrompt("task", [planA, planB])
        expect(result.labelMapping).toHaveLength(2)

        const stepIds = result.labelMapping.map((m) => m.stepId).sort()
        expect(stepIds).toEqual(["plan_0", "plan_1"])

        const labels = result.labelMapping.map((m) => m.label).sort()
        expect(labels).toEqual(["A", "B"])
    })

    it("review input references the mapped plan label via reviews attribute", () => {
        const review: ReconcileInput = {
            stepId: "review_0",
            primitive: "review",
            text: "Review content",
            reviewsStepId: "plan_0",
        }
        const result = buildReconcileStepPrompt("task", [planA, review])
        const planLabel = result.labelMapping.find((m) => m.stepId === "plan_0")?.label
        const reviewLabel = result.labelMapping.find((m) => m.stepId === "review_0")?.label

        expect(planLabel).toBeTruthy()
        expect(reviewLabel).toBeTruthy()
        expect(result.userMessage.match(new RegExp(`<review id="${reviewLabel}" reviews="Plan ${planLabel}">`))).toBeTruthy()
    })

    it("labelMapping labels match the XML ids", () => {
        const result = buildReconcileStepPrompt("task", [planA, planB])
        for (const { label } of result.labelMapping) {
            expect(result.userMessage.match(new RegExp(`id="${label}"`))).toBeTruthy()
        }
    })

    it("shuffles inputs (statistical test)", () => {
        const inputs: ReconcileInput[] = [
            { stepId: "x", primitive: "plan", text: "CONTENT_FIRST" },
            { stepId: "y", primitive: "plan", text: "CONTENT_SECOND" },
            { stepId: "z", primitive: "plan", text: "CONTENT_THIRD" },
        ]

        const contentOrders = new Set<string>()
        for (let i = 0; i < 50; i++) {
            const result = buildReconcileStepPrompt("task", inputs)
            const contentPositions = ["CONTENT_FIRST", "CONTENT_SECOND", "CONTENT_THIRD"].map((c) => result.userMessage.indexOf(c)).join(",")
            contentOrders.add(contentPositions)
        }

        // With 3 items and 50 iterations, we should see more than 1 ordering
        expect(contentOrders.size).toBeGreaterThan(1)
    })
})
