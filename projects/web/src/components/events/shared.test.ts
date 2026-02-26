import { describe, expect, it } from "vitest"
import type { HarnessStreamEvent } from "../../electronAPI/harnessEventTypes"
import type { ActionEvent, CodeEvent } from "../../types"
import { getEventErrorReason } from "./shared"

/** Helper to build a minimal ActionEvent for testing */
function makeActionEvent(overrides: Partial<ActionEvent> = {}): ActionEvent {
    return {
        id: "test-event",
        type: "action",
        status: "error",
        createdAt: new Date().toISOString(),
        userInput: "test input",
        execution: { harnessId: "claude-code", executionId: "exec-1", events: [] },
        source: { type: "do", userLabel: "Do" },
        includesCommentIds: [],
        ...overrides,
    }
}

/** Helper to build a harness error stream event */
function errorStreamEvent(error: string, code?: string): HarnessStreamEvent {
    return {
        id: crypto.randomUUID(),
        type: "error",
        executionId: "exec-1",
        harnessId: "claude-code",
        direction: "execution",
        error,
        ...(code ? { code } : {}),
    } as unknown as HarnessStreamEvent
}

/** Helper to build a raw_message stream event */
function rawMessageEvent(message: Record<string, unknown>): HarnessStreamEvent {
    return {
        id: crypto.randomUUID(),
        type: "raw_message",
        executionId: "exec-1",
        harnessId: "claude-code",
        direction: "execution",
        message,
    } as unknown as HarnessStreamEvent
}

/** Helper to build a stderr stream event */
function stderrEvent(data: string): HarnessStreamEvent {
    return {
        id: crypto.randomUUID(),
        type: "stderr",
        executionId: "exec-1",
        harnessId: "claude-code",
        direction: "execution",
        data,
    } as unknown as HarnessStreamEvent
}

describe("getEventErrorReason", () => {
    it("returns undefined for non-action events", () => {
        const setupEvent: CodeEvent = {
            id: "setup-1",
            type: "setup_environment",
            status: "completed",
            createdAt: new Date().toISOString(),
            userInput: "",
            worktreeId: "wt-1",
            deviceId: "dev-1",
            workingDir: "/tmp",
        }
        expect(getEventErrorReason(setupEvent)).toBeUndefined()
    })

    it("extracts from harness error event with code", () => {
        const event = makeActionEvent({
            execution: {
                harnessId: "claude-code",
                executionId: "exec-1",
                events: [errorStreamEvent("Process crashed unexpectedly", "process_crashed")],
            },
        })
        expect(getEventErrorReason(event)).toBe("Process crashed unexpectedly (process_crashed)")
    })

    it("extracts from harness error event without code", () => {
        const event = makeActionEvent({
            execution: {
                harnessId: "claude-code",
                executionId: "exec-1",
                events: [errorStreamEvent("IPC connection lost")],
            },
        })
        expect(getEventErrorReason(event)).toBe("IPC connection lost")
    })

    it("uses the last error event when multiple exist", () => {
        const event = makeActionEvent({
            execution: {
                harnessId: "claude-code",
                executionId: "exec-1",
                events: [errorStreamEvent("First error", "rate_limited"), errorStreamEvent("Second error", "process_crashed")],
            },
        })
        expect(getEventErrorReason(event)).toBe("Second error (process_crashed)")
    })

    it("extracts from result message errors", () => {
        const event = makeActionEvent({
            execution: {
                harnessId: "claude-code",
                executionId: "exec-1",
                events: [
                    rawMessageEvent({
                        type: "result",
                        errors: ["Rate limited", "Context window exceeded"],
                    }),
                ],
            },
        })
        expect(getEventErrorReason(event)).toBe("Rate limited; Context window exceeded")
    })

    it("prefers harness error events over result errors", () => {
        const event = makeActionEvent({
            execution: {
                harnessId: "claude-code",
                executionId: "exec-1",
                events: [
                    rawMessageEvent({
                        type: "result",
                        errors: ["Some result error"],
                    }),
                    errorStreamEvent("Harness-level error", "ipc_error"),
                ],
            },
        })
        expect(getEventErrorReason(event)).toBe("Harness-level error (ipc_error)")
    })

    it("falls back to stderr", () => {
        const event = makeActionEvent({
            execution: {
                harnessId: "claude-code",
                executionId: "exec-1",
                events: [stderrEvent("Warning: something minor\n"), stderrEvent("Error: fatal crash on line 42\n")],
            },
        })
        expect(getEventErrorReason(event)).toBe("Error: fatal crash on line 42")
    })

    it("truncates long stderr lines to 200 characters", () => {
        const longLine = "E".repeat(250)
        const event = makeActionEvent({
            execution: {
                harnessId: "claude-code",
                executionId: "exec-1",
                events: [stderrEvent(longLine)],
            },
        })
        const result = getEventErrorReason(event)
        expect(result).toBe("E".repeat(200) + "...")
    })

    it("returns undefined when no error info exists", () => {
        const event = makeActionEvent({
            execution: {
                harnessId: "claude-code",
                executionId: "exec-1",
                events: [],
            },
        })
        expect(getEventErrorReason(event)).toBeUndefined()
    })

    it("returns undefined when execution has only non-error events", () => {
        const event = makeActionEvent({
            execution: {
                harnessId: "claude-code",
                executionId: "exec-1",
                events: [
                    rawMessageEvent({ type: "assistant", message: { content: [{ type: "text", text: "hello" }] } }),
                    {
                        id: crypto.randomUUID(),
                        type: "complete",
                        executionId: "exec-1",
                        harnessId: "claude-code",
                        direction: "execution",
                    } as unknown as HarnessStreamEvent,
                ],
            },
        })
        expect(getEventErrorReason(event)).toBeUndefined()
    })

    it("ignores command-direction events", () => {
        const event = makeActionEvent({
            execution: {
                harnessId: "claude-code",
                executionId: "exec-1",
                events: [
                    {
                        id: crypto.randomUUID(),
                        type: "error",
                        executionId: "exec-1",
                        harnessId: "claude-code",
                        direction: "command",
                        error: "Should be ignored",
                    } as unknown as HarnessStreamEvent,
                ],
            },
        })
        expect(getEventErrorReason(event)).toBeUndefined()
    })
})
