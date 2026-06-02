import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, it } from "vitest"
import { CodeStoreProvider } from "../store/context"
import { CodeStore } from "../store/store"
import type { ActionEvent, CodeEvent } from "../types"
import { EventLog } from "./EventLog"

function actionEvent(index: number): ActionEvent {
    return {
        id: `event-${index}`,
        type: "action",
        status: "completed",
        createdAt: "2026-06-01T00:00:00.000Z",
        completedAt: "2026-06-01T00:00:01.000Z",
        userInput: `prompt-${index}`,
        execution: {
            harnessId: "codex",
            executionId: `exec-${index}`,
            modelId: "gpt-test",
            events: [],
        },
        source: { type: "do", userLabel: "Do" },
        includesCommentIds: [],
        result: { success: true },
    }
}

function renderEventLog(events: CodeEvent[], onRequestFullHistory?: () => void) {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    const store = new CodeStore({
        getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
        navigateToTask: () => undefined,
        enableRuntimeProductStore: false,
    })

    act(() => {
        root.render(createElement(CodeStoreProvider, { store }, createElement(EventLog, { taskId: "task-1", events, onRequestFullHistory })))
    })

    return {
        container,
        cleanup: () => {
            act(() => root.unmount())
            store.disconnectAllStores()
            container.remove()
        },
    }
}

describe("EventLog", () => {
    it("renders recent task events first and keeps earlier events available", () => {
        const events = Array.from({ length: 100 }, (_, index) => actionEvent(index))
        let fullHistoryRequests = 0
        const { container, cleanup } = renderEventLog(events, () => {
            fullHistoryRequests += 1
        })

        try {
            expect(container.textContent).toContain("Show 20 earlier events")
            expect(container.textContent).not.toContain("prompt-0")
            expect(container.textContent).toContain("prompt-99")

            const showEarlier = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Show 20 earlier events"))
            if (!showEarlier) throw new Error("Missing show-earlier control")

            act(() => {
                showEarlier.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
            })

            expect(fullHistoryRequests).toBe(1)
            expect(container.textContent).toContain("prompt-0")
            expect(container.textContent).toContain("prompt-99")
        } finally {
            cleanup()
        }
    })
})
