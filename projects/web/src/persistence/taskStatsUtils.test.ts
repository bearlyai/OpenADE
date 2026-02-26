import { describe, expect, it } from "vitest"
import type { HarnessStreamEvent } from "../electronAPI/harnessEventTypes"
import type { ActionEvent } from "../types"
import { computeTaskUsage } from "./taskStatsUtils"

function codexEvents({
    executionId,
    sessionId,
    inputTokens,
    outputTokens,
    costUsd,
    includeComplete = true,
}: {
    executionId: string
    sessionId: string
    inputTokens: number
    outputTokens: number
    costUsd?: number
    includeComplete?: boolean
}): HarnessStreamEvent[] {
    const events: HarnessStreamEvent[] = [
        {
            id: `${executionId}-thread`,
            direction: "execution",
            type: "raw_message",
            executionId,
            harnessId: "codex",
            message: { type: "thread.started", thread_id: sessionId },
        },
        {
            id: `${executionId}-turn-completed`,
            direction: "execution",
            type: "raw_message",
            executionId,
            harnessId: "codex",
            message: {
                type: "turn.completed",
                usage: {
                    input_tokens: inputTokens,
                    output_tokens: outputTokens,
                    cached_input_tokens: 0,
                },
            },
        },
    ]

    if (includeComplete) {
        events.push({
            id: `${executionId}-complete`,
            direction: "execution",
            type: "complete",
            executionId,
            harnessId: "codex",
            usage: {
                inputTokens,
                outputTokens,
                costUsd,
            },
        })
    }

    return events
}

function codexAction({
    id,
    sessionId,
    parentSessionId,
    inputTokens,
    outputTokens,
    costUsd,
    includeComplete = true,
}: {
    id: string
    sessionId: string
    parentSessionId?: string
    inputTokens: number
    outputTokens: number
    costUsd?: number
    includeComplete?: boolean
}): ActionEvent & { id: string } {
    return {
        id,
        type: "action",
        status: "completed",
        createdAt: "2026-01-01T00:00:00.000Z",
        completedAt: "2026-01-01T00:00:01.000Z",
        userInput: "test",
        execution: {
            harnessId: "codex",
            executionId: `${id}-exec`,
            sessionId,
            parentSessionId,
            modelId: "gpt-5.3-codex",
            events: codexEvents({
                executionId: `${id}-exec`,
                sessionId,
                inputTokens,
                outputTokens,
                costUsd,
                includeComplete,
            }),
        },
        source: { type: "do", userLabel: "Do" },
        includesCommentIds: [],
        result: { success: true },
    }
}

describe("computeTaskUsage - codex", () => {
    it("adds token/cost deltas for resumed sessions with cumulative usage snapshots", () => {
        const events = [
            codexAction({
                id: "a1",
                sessionId: "session-1",
                inputTokens: 100,
                outputTokens: 40,
                costUsd: 0.1,
            }),
            codexAction({
                id: "a2",
                sessionId: "session-1",
                parentSessionId: "session-1",
                inputTokens: 250,
                outputTokens: 90,
                costUsd: 0.25,
            }),
        ]

        const usage = computeTaskUsage(events)
        expect(usage.eventCount).toBe(2)
        expect(usage.inputTokens).toBe(250)
        expect(usage.outputTokens).toBe(90)
        expect(usage.totalCostUsd).toBeCloseTo(0.25)
        expect(usage.costByModel["gpt-5.3-codex"]).toBeCloseTo(0.25)
    })

    it("does not subtract across distinct sessions", () => {
        const events = [
            codexAction({
                id: "a1",
                sessionId: "session-1",
                inputTokens: 100,
                outputTokens: 40,
                costUsd: 0.1,
            }),
            codexAction({
                id: "a2",
                sessionId: "session-2",
                inputTokens: 120,
                outputTokens: 60,
                costUsd: 0.13,
            }),
        ]

        const usage = computeTaskUsage(events)
        expect(usage.inputTokens).toBe(220)
        expect(usage.outputTokens).toBe(100)
        expect(usage.totalCostUsd).toBeCloseTo(0.23)
    })

    it("falls back to turn.completed usage when complete envelope usage is absent", () => {
        const events = [
            codexAction({
                id: "a1",
                sessionId: "session-1",
                inputTokens: 100,
                outputTokens: 40,
                includeComplete: false,
            }),
            codexAction({
                id: "a2",
                sessionId: "session-1",
                parentSessionId: "session-1",
                inputTokens: 250,
                outputTokens: 90,
                includeComplete: false,
            }),
        ]

        const usage = computeTaskUsage(events)
        expect(usage.inputTokens).toBe(250)
        expect(usage.outputTokens).toBe(90)
        expect(usage.totalCostUsd).toBe(0)
    })
})
