import { createElement } from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { CodeStoreProvider } from "../../store/context"
import type { CodeStore } from "../../store/store"
import type { ActionEvent } from "../../types"
import { ActionEventItem, getReviewUserInstructions } from "./ActionEventItem"

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

describe("ActionEventItem", () => {
    let container: HTMLDivElement
    let root: Root

    beforeEach(() => {
        ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
        container = document.createElement("div")
        document.body.appendChild(container)
        root = createRoot(container)
    })

    afterEach(() => {
        act(() => root.unmount())
        container.remove()
    })

    it("does not recheck GitHub CLI status while rendering completed push events", async () => {
        const refreshGhCliStatus = vi.fn(async () => true)
        const store = {
            events: {
                hasDefunctSessionError: vi.fn(() => false),
            },
            tasks: {
                getTask: vi.fn(() => null),
                getTaskModel: vi.fn(() => ({
                    hasGhCli: false,
                    repoId: "repo-1",
                })),
            },
            repos: {
                refreshGhCliStatus,
            },
        } as unknown as CodeStore
        const event = makeActionEvent({
            userInput: "Commit and push this",
            source: {
                type: "do",
                userLabel: "Commit & Push",
            },
        })

        await act(async () => {
            root.render(
                createElement(
                    CodeStoreProvider,
                    { store },
                    createElement(ActionEventItem, {
                        event,
                        expanded: true,
                        onToggle: vi.fn(),
                        displayMode: "compact",
                        taskId: "task-1",
                    })
                )
            )
            await Promise.resolve()
        })

        expect(refreshGhCliStatus).not.toHaveBeenCalled()
        expect(container.textContent).toContain("installing the GitHub CLI")
    })
})
