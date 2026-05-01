import { describe, expect, it } from "vitest"
import type { HarnessStreamEvent } from "../electronAPI/harnessEventTypes"
import type { ActionEvent } from "../types"
import { TASK_USAGE_STATS_VERSION, computeTaskUsage, needsTaskUsageBackfill } from "./taskStatsUtils"

function codexEvents({
    executionId,
    sessionId,
    inputTokens,
    outputTokens,
    cacheReadTokens = 0,
    costUsd,
    includeComplete = true,
}: {
    executionId: string
    sessionId: string
    inputTokens: number
    outputTokens: number
    cacheReadTokens?: number
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
                    cached_input_tokens: cacheReadTokens,
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
                cacheReadTokens,
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
    cacheReadTokens,
    costUsd,
    includeComplete = true,
    modelId = "gpt-5.3-codex",
}: {
    id: string
    sessionId: string
    parentSessionId?: string
    inputTokens: number
    outputTokens: number
    cacheReadTokens?: number
    costUsd?: number
    includeComplete?: boolean
    modelId?: string
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
            modelId,
            events: codexEvents({
                executionId: `${id}-exec`,
                sessionId,
                inputTokens,
                outputTokens,
                cacheReadTokens,
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
        expect(usage.totalCostUsd).toBeCloseTo(0.0016975)
        expect(usage.costByModel["gpt-5.3-codex"]).toBeCloseTo(0.0016975)
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
        expect(usage.totalCostUsd).toBeCloseTo(0.001785)
    })

    it("computes known model cost from turn.completed usage when complete envelope usage is absent", () => {
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
        expect(usage.totalCostUsd).toBeCloseTo(0.0016975)
    })

    it("recomputes known model cost instead of trusting an old inflated complete cost", () => {
        const events = [
            codexAction({
                id: "a1",
                sessionId: "session-1",
                inputTokens: 1_000_000,
                outputTokens: 0,
                cacheReadTokens: 1_000_000,
                costUsd: 1.925,
            }),
        ]

        const usage = computeTaskUsage(events)
        expect(usage.inputTokens).toBe(1_000_000)
        expect(usage.outputTokens).toBe(0)
        expect(usage.totalCostUsd).toBeCloseTo(0.175)
    })

    it("does not trust reported Codex cost when model pricing is unknown", () => {
        const events = [
            codexAction({
                id: "a1",
                sessionId: "session-1",
                inputTokens: 1_000_000,
                outputTokens: 1_000_000,
                costUsd: 99,
                modelId: "gpt-unknown-codex",
            }),
        ]

        const usage = computeTaskUsage(events)
        expect(usage.inputTokens).toBe(1_000_000)
        expect(usage.outputTokens).toBe(1_000_000)
        expect(usage.totalCostUsd).toBe(0)
        expect(usage.costByModel["gpt-unknown-codex"]).toBeUndefined()
    })

    it("deltas legacy same-session cumulative usage even when parentSessionId is missing", () => {
        const events = [
            codexAction({
                id: "a1",
                sessionId: "session-1",
                inputTokens: 100,
                outputTokens: 40,
                cacheReadTokens: 10,
            }),
            codexAction({
                id: "a2",
                sessionId: "session-1",
                inputTokens: 250,
                outputTokens: 90,
                cacheReadTokens: 30,
            }),
        ]

        const usage = computeTaskUsage(events)
        expect(usage.inputTokens).toBe(250)
        expect(usage.outputTokens).toBe(90)
        expect(usage.totalCostUsd).toBeCloseTo(0.00165025)
    })

    it("deltas resumed cumulative usage even when cache-read tokens decrease", () => {
        const events = [
            codexAction({
                id: "a1",
                sessionId: "session-1",
                inputTokens: 100,
                outputTokens: 40,
                cacheReadTokens: 100,
            }),
            codexAction({
                id: "a2",
                sessionId: "session-1",
                parentSessionId: "session-1",
                inputTokens: 250,
                outputTokens: 90,
                cacheReadTokens: 0,
            }),
        ]

        const usage = computeTaskUsage(events)
        expect(usage.inputTokens).toBe(250)
        expect(usage.outputTokens).toBe(90)
        expect(usage.totalCostUsd).toBeCloseTo(0.00154)
    })

    it("does not delta unrelated HyperPlan sub-executions that reuse a session id without lineage", () => {
        const event: ActionEvent & { id: string } = {
            id: "hp-subs",
            type: "action",
            status: "completed",
            createdAt: "2026-01-01T00:00:00.000Z",
            completedAt: "2026-01-01T00:00:01.000Z",
            userInput: "test",
            execution: {
                harnessId: "claude-code",
                executionId: "terminal-exec",
                modelId: "claude-sonnet-4.5",
                events: [],
            },
            hyperplanSubExecutions: [
                {
                    stepId: "review_a",
                    primitive: "plan",
                    harnessId: "codex",
                    modelId: "gpt-5.3-codex",
                    executionId: "review-a-exec",
                    status: "completed",
                    events: codexEvents({
                        executionId: "review-a-exec",
                        sessionId: "shared-session",
                        inputTokens: 100,
                        outputTokens: 40,
                        cacheReadTokens: 10,
                    }),
                },
                {
                    stepId: "review_b",
                    primitive: "review",
                    harnessId: "codex",
                    modelId: "gpt-5.3-codex",
                    executionId: "review-b-exec",
                    status: "completed",
                    events: codexEvents({
                        executionId: "review-b-exec",
                        sessionId: "shared-session",
                        inputTokens: 250,
                        outputTokens: 90,
                        cacheReadTokens: 30,
                    }),
                },
            ],
            source: { type: "hyperplan", userLabel: "HyperPlan", strategyId: "peer-review" },
            includesCommentIds: [],
            result: { success: true },
        }

        const usage = computeTaskUsage([event])
        expect(usage.inputTokens).toBe(350)
        expect(usage.outputTokens).toBe(130)
        expect(usage.totalCostUsd).toBeCloseTo(0.0023695)
    })

    it("deltas HyperPlan sub-executions when a non-terminal revise resumes a sub-session", () => {
        const event: ActionEvent & { id: string } = {
            id: "hp-sub-revise",
            type: "action",
            status: "completed",
            createdAt: "2026-01-01T00:00:00.000Z",
            completedAt: "2026-01-01T00:00:01.000Z",
            userInput: "test",
            execution: {
                harnessId: "claude-code",
                executionId: "terminal-exec",
                modelId: "claude-sonnet-4.5",
                events: [],
            },
            hyperplanSubExecutions: [
                {
                    stepId: "plan_a",
                    primitive: "plan",
                    harnessId: "codex",
                    modelId: "gpt-5.3-codex",
                    executionId: "plan-a-exec",
                    sessionId: "shared-session",
                    status: "completed",
                    events: codexEvents({
                        executionId: "plan-a-exec",
                        sessionId: "shared-session",
                        inputTokens: 100,
                        outputTokens: 40,
                        cacheReadTokens: 10,
                    }),
                },
                {
                    stepId: "revise_a",
                    primitive: "revise",
                    harnessId: "codex",
                    modelId: "gpt-5.3-codex",
                    executionId: "revise-a-exec",
                    sessionId: "shared-session",
                    parentSessionId: "shared-session",
                    status: "completed",
                    events: codexEvents({
                        executionId: "revise-a-exec",
                        sessionId: "shared-session",
                        inputTokens: 250,
                        outputTokens: 90,
                        cacheReadTokens: 30,
                    }),
                },
            ],
            source: { type: "hyperplan", userLabel: "HyperPlan", strategyId: "custom" },
            includesCommentIds: [],
            result: { success: true },
        }

        const usage = computeTaskUsage([event])
        expect(usage.inputTokens).toBe(250)
        expect(usage.outputTokens).toBe(90)
        expect(usage.totalCostUsd).toBeCloseTo(0.00165025)
    })

    it("processes HyperPlan sub-executions before a resumed terminal step to avoid double counting", () => {
        const event: ActionEvent & { id: string } = {
            id: "hp1",
            type: "action",
            status: "completed",
            createdAt: "2026-01-01T00:00:00.000Z",
            completedAt: "2026-01-01T00:00:01.000Z",
            userInput: "test",
            execution: {
                harnessId: "codex",
                executionId: "terminal-exec",
                sessionId: "plan-session",
                parentSessionId: "plan-session",
                modelId: "gpt-5.3-codex",
                events: codexEvents({
                    executionId: "terminal-exec",
                    sessionId: "plan-session",
                    inputTokens: 250,
                    outputTokens: 90,
                    cacheReadTokens: 30,
                    costUsd: 0.25,
                }),
            },
            hyperplanSubExecutions: [
                {
                    stepId: "plan_a",
                    primitive: "plan",
                    harnessId: "codex",
                    modelId: "gpt-5.3-codex",
                    executionId: "plan-exec",
                    status: "completed",
                    events: codexEvents({
                        executionId: "plan-exec",
                        sessionId: "plan-session",
                        inputTokens: 100,
                        outputTokens: 40,
                        cacheReadTokens: 10,
                        costUsd: 0.1,
                    }),
                },
            ],
            source: { type: "hyperplan", userLabel: "HyperPlan", strategyId: "peer-review" },
            includesCommentIds: [],
            result: { success: true },
        }

        const usage = computeTaskUsage([event])
        expect(usage.inputTokens).toBe(250)
        expect(usage.outputTokens).toBe(90)
        expect(usage.totalCostUsd).toBeCloseTo(0.00165025)
    })

    it("marks current usage snapshots with the stats version", () => {
        const usage = computeTaskUsage([])
        expect(usage.usageVersion).toBe(TASK_USAGE_STATS_VERSION)
        expect(needsTaskUsageBackfill(usage)).toBe(false)
    })

    it("requests backfill for missing or stale usage snapshots", () => {
        expect(needsTaskUsageBackfill()).toBe(true)
        expect(
            needsTaskUsageBackfill({
                usageVersion: TASK_USAGE_STATS_VERSION - 1,
                inputTokens: 0,
                outputTokens: 0,
                totalCostUsd: 0,
                eventCount: 0,
                costByModel: {},
                durationMs: 0,
            })
        ).toBe(true)
    })
})
