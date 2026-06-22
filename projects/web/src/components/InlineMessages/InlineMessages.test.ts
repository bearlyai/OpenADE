import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, it } from "vitest"
import type { HarnessStreamEvent } from "../../electronAPI/harnessEventTypes"
import { InlineMessages } from "./InlineMessages"

function stderrEvent(index: number): HarnessStreamEvent {
    return {
        id: `stderr-${index}`,
        type: "stderr",
        executionId: "exec-1",
        harnessId: "codex",
        direction: "execution",
        data: `stderr ${index}`,
    } as HarnessStreamEvent
}

function codexTurnStartedEvent(index: number): HarnessStreamEvent {
    return {
        id: `raw-${index}`,
        type: "raw_message",
        executionId: "exec-1",
        harnessId: "codex",
        direction: "execution",
        message: { type: "turn.started" },
    } as HarnessStreamEvent
}

function harnessErrorEvent(message: string): HarnessStreamEvent {
    return {
        id: "error-1",
        type: "error",
        executionId: "exec-1",
        harnessId: "codex",
        direction: "execution",
        error: message,
    } as HarnessStreamEvent
}

function renderInlineMessages(events: HarnessStreamEvent[], onRequestFullHistory?: () => void, omittedEventCount?: number) {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)

    act(() => {
        root.render(
            createElement(InlineMessages, {
                events,
                omittedEventCount,
                harnessId: "codex",
                sourceType: "do",
                taskId: "task-1",
                actionEventId: "action-1",
                onRequestFullHistory,
            })
        )
    })

    return {
        container,
        cleanup: () => {
            act(() => root.unmount())
            container.remove()
        },
    }
}

describe("InlineMessages", () => {
    it("renders the tail of long streams first and keeps earlier activity available", () => {
        const events = Array.from({ length: 220 }, (_, index) => [stderrEvent(index), codexTurnStartedEvent(index)]).flat()
        let fullHistoryRequests = 0
        const { container, cleanup } = renderInlineMessages(events, () => {
            fullHistoryRequests += 1
        })

        try {
            expect(container.textContent).toContain("Show 320 earlier stream events")
            expect(container.textContent).not.toContain("stderr 0")
            expect(container.textContent).toContain("stderr 219")

            const showEarlier = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Show 320 earlier stream events"))
            if (!showEarlier) throw new Error("Missing show-earlier control")

            act(() => {
                showEarlier.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
            })

            expect(fullHistoryRequests).toBe(1)
            expect(container.textContent).toContain("stderr 0")
            expect(container.textContent).toContain("stderr 219")
        } finally {
            cleanup()
        }
    })

    it("keeps omitted runtime history requestable when the loaded stream is already bounded", () => {
        const events = Array.from({ length: 20 }, (_, index) => stderrEvent(index))
        let fullHistoryRequests = 0
        const { container, cleanup } = renderInlineMessages(
            events,
            () => {
                fullHistoryRequests += 1
            },
            45
        )

        try {
            expect(container.textContent).toContain("Show 45 earlier stream events")

            const showEarlier = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Show 45 earlier stream events"))
            if (!showEarlier) throw new Error("Missing omitted-history control")

            act(() => {
                showEarlier.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
            })

            expect(fullHistoryRequests).toBe(1)
            expect(container.textContent).toContain("Loading 45 earlier stream events...")
        } finally {
            cleanup()
        }
    })

    it("does not offer omitted runtime history when no full-history callback is available", () => {
        const events = Array.from({ length: 20 }, (_, index) => stderrEvent(index))
        const { container, cleanup } = renderInlineMessages(events, undefined, 45)

        try {
            expect(container.textContent).not.toContain("Show 45 earlier stream events")
            expect(container.textContent).not.toContain("Loading 45 earlier stream events")
        } finally {
            cleanup()
        }
    })

    it("does not mount collapsed row content until the user expands the row", () => {
        const { container, cleanup } = renderInlineMessages([harnessErrorEvent("expensive collapsed content")])

        try {
            expect(container.textContent).not.toContain("expensive collapsed content")

            const row = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Error"))
            if (!row) throw new Error("Missing collapsed error row")

            act(() => {
                row.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
            })

            expect(container.textContent).toContain("expensive collapsed content")
        } finally {
            cleanup()
        }
    })
})
