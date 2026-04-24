import { describe, expect, it } from "vitest"
import type { ActionEvent } from "../../types"
import { getReviewUserInstructions } from "./ActionEventItem"

function makeActionEvent(overrides: Partial<ActionEvent> = {}): ActionEvent {
    return {
        id: "event-1",
        type: "action",
        status: "completed",
        createdAt: new Date().toISOString(),
        userInput: "Review",
        execution: {
            harnessId: "claude-code",
            executionId: "exec-1",
            events: [],
        },
        source: {
            type: "review",
            userLabel: "Review",
            reviewType: "work",
        },
        includesCommentIds: [],
        result: { success: true },
        ...overrides,
    }
}

describe("getReviewUserInstructions", () => {
    it("returns trimmed review instructions for review events", () => {
        const event = makeActionEvent({
            source: {
                type: "review",
                userLabel: "Review",
                reviewType: "work",
                userInstructions: "  Review the recent work carefully.  ",
            },
        })

        expect(getReviewUserInstructions(event)).toBe("Review the recent work carefully.")
    })

    it("returns undefined for legacy review events without persisted instructions", () => {
        expect(getReviewUserInstructions(makeActionEvent())).toBeUndefined()
    })

    it("returns undefined for blank review instructions", () => {
        const event = makeActionEvent({
            source: {
                type: "review",
                userLabel: "Review",
                reviewType: "plan",
                userInstructions: "   ",
            },
        })

        expect(getReviewUserInstructions(event)).toBeUndefined()
    })

    it("returns undefined for non-review events", () => {
        const event = makeActionEvent({
            source: {
                type: "ask",
                userLabel: "Ask",
            },
        })

        expect(getReviewUserInstructions(event)).toBeUndefined()
    })
})
