import type { HarnessUsage } from "@openade/harness/browser"
import type { HarnessRawMessageEvent, HarnessStreamEvent } from "../electronAPI/harnessEventTypes"
import { extractRawMessageEvents } from "../electronAPI/harnessEventTypes"
import type { CodeEvent } from "../types"
import type { TaskPreviewUsage } from "./repoStore"

interface CodexUsageSnapshot {
    inputTokens: number
    outputTokens: number
    costUsd?: number
}

export function computeTaskUsage(events: Array<CodeEvent & { id: string }>): TaskPreviewUsage {
    let inputTokens = 0
    let outputTokens = 0
    let totalCostUsd = 0
    let eventCount = 0
    let durationMs = 0
    const costByModel: Record<string, number> = {}
    const codexSessionTotals = new Map<string, CodexUsageSnapshot>()

    for (const event of events) {
        if (event.type !== "action") continue
        eventCount++
        const modelId = event.execution.modelId ?? "unknown"
        const messageEvents = extractRawMessageEvents(event.execution.events)
        for (const evt of messageEvents) {
            // Usage/cost data is only in Claude Code result events currently
            if (evt.harnessId === "claude-code" && evt.message.type === "result") {
                totalCostUsd += evt.message.total_cost_usd ?? 0
                const usage = evt.message.usage as { input_tokens?: number; output_tokens?: number } | undefined
                inputTokens += usage?.input_tokens ?? 0
                outputTokens += usage?.output_tokens ?? 0
                costByModel[modelId] = (costByModel[modelId] ?? 0) + (evt.message.total_cost_usd ?? 0)
                durationMs += evt.message.duration_ms ?? 0
            }
        }

        // Codex usage snapshots are session-based and can be cumulative across resumed runs.
        // Track per-session totals and only add the delta when we detect cumulative snapshots.
        const harnessId = event.execution.harnessId ?? "claude-code"
        if (harnessId === "codex") {
            const codexUsage = extractCodexUsageSnapshot(messageEvents, event.execution.events)
            if (codexUsage) {
                const sessionId = event.execution.sessionId ?? extractCodexSessionId(messageEvents)
                const usageToAdd = normalizeCodexUsage({
                    snapshot: codexUsage,
                    sessionId,
                    parentSessionId: event.execution.parentSessionId,
                    sessionTotals: codexSessionTotals,
                })

                inputTokens += usageToAdd.inputTokens
                outputTokens += usageToAdd.outputTokens

                if (usageToAdd.costUsd !== undefined) {
                    totalCostUsd += usageToAdd.costUsd
                    costByModel[modelId] = (costByModel[modelId] ?? 0) + usageToAdd.costUsd
                }
            }

            const completeUsage = extractCompleteUsage(event.execution.events)
            if (completeUsage?.durationMs) {
                durationMs += completeUsage.durationMs
            }
        }

        // HyperPlan sub-executions: aggregate cost/tokens from each sub-plan
        if (event.hyperplanSubExecutions) {
            for (const sub of event.hyperplanSubExecutions) {
                const subModelId = sub.modelId ?? modelId
                const subHarnessId = sub.harnessId ?? "claude-code"
                const subMessageEvents = extractRawMessageEvents(sub.events)
                for (const evt of subMessageEvents) {
                    if (evt.harnessId === "claude-code" && evt.message.type === "result") {
                        totalCostUsd += evt.message.total_cost_usd ?? 0
                        const usage = evt.message.usage as { input_tokens?: number; output_tokens?: number } | undefined
                        inputTokens += usage?.input_tokens ?? 0
                        outputTokens += usage?.output_tokens ?? 0
                        costByModel[subModelId] = (costByModel[subModelId] ?? 0) + (evt.message.total_cost_usd ?? 0)
                        durationMs += evt.message.duration_ms ?? 0
                    }
                }

                if (subHarnessId === "codex") {
                    const codexUsage = extractCodexUsageSnapshot(subMessageEvents, sub.events)
                    if (codexUsage) {
                        const sessionId = extractCodexSessionId(subMessageEvents)
                        const usageToAdd = normalizeCodexUsage({
                            snapshot: codexUsage,
                            sessionId,
                            parentSessionId: undefined,
                            sessionTotals: codexSessionTotals,
                        })

                        inputTokens += usageToAdd.inputTokens
                        outputTokens += usageToAdd.outputTokens

                        if (usageToAdd.costUsd !== undefined) {
                            totalCostUsd += usageToAdd.costUsd
                            costByModel[subModelId] = (costByModel[subModelId] ?? 0) + usageToAdd.costUsd
                        }
                    }

                    const subCompleteUsage = extractCompleteUsage(sub.events)
                    if (subCompleteUsage?.durationMs) {
                        durationMs += subCompleteUsage.durationMs
                    }
                }
            }
        }
    }

    return { inputTokens, outputTokens, totalCostUsd, eventCount, costByModel, durationMs }
}

/**
 * Format a duration in ms as a compact human-readable string.
 *
 *   < 1s     → "0.0s" (1 decimal)
 *   < 1min   → "12.3s" (1 decimal)
 *   < 1hr    → "5m 23s"
 *   < 1day   → "2h 14m"
 *   ≥ 1day   → "1.5h" (decimal hours)
 */
export function formatDuration(durationMs: number): string {
    if (!Number.isFinite(durationMs) || durationMs <= 0) return "0s"
    const totalSeconds = durationMs / 1000
    if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`
    const totalMinutes = totalSeconds / 60
    if (totalMinutes < 60) {
        const m = Math.floor(totalMinutes)
        const s = Math.round(totalSeconds - m * 60)
        return s === 0 ? `${m}m` : `${m}m ${s}s`
    }
    const totalHours = totalMinutes / 60
    if (totalHours < 24) {
        const h = Math.floor(totalHours)
        const m = Math.round(totalMinutes - h * 60)
        return m === 0 ? `${h}h` : `${h}h ${m}m`
    }
    return `${totalHours.toFixed(1)}h`
}

function extractCompleteUsage(events: HarnessStreamEvent[]): HarnessUsage | undefined {
    for (const e of events) {
        if (e.direction === "execution" && e.type === "complete" && e.usage) {
            return e.usage as HarnessUsage
        }
    }
    return undefined
}

function extractCodexUsageSnapshot(messageEvents: HarnessRawMessageEvent[], streamEvents: HarnessStreamEvent[]): CodexUsageSnapshot | undefined {
    let latestTurnUsage: { inputTokens: number; outputTokens: number } | undefined
    for (const evt of messageEvents) {
        if (evt.harnessId === "codex" && evt.message.type === "turn.completed") {
            latestTurnUsage = {
                inputTokens: evt.message.usage.input_tokens ?? 0,
                outputTokens: evt.message.usage.output_tokens ?? 0,
            }
        }
    }

    const completeUsage = extractCompleteUsage(streamEvents)
    const input = completeUsage?.inputTokens ?? latestTurnUsage?.inputTokens
    const output = completeUsage?.outputTokens ?? latestTurnUsage?.outputTokens

    if (input === undefined && output === undefined) return undefined

    return {
        inputTokens: input ?? 0,
        outputTokens: output ?? 0,
        costUsd: completeUsage?.costUsd,
    }
}

function extractCodexSessionId(messageEvents: HarnessRawMessageEvent[]): string | undefined {
    for (const evt of messageEvents) {
        if (evt.harnessId === "codex" && evt.message.type === "thread.started") {
            return evt.message.session_id ?? evt.message.thread_id
        }
    }
    return undefined
}

function normalizeCodexUsage({
    snapshot,
    sessionId,
    parentSessionId,
    sessionTotals,
}: {
    snapshot: CodexUsageSnapshot
    sessionId?: string
    parentSessionId?: string
    sessionTotals: Map<string, CodexUsageSnapshot>
}): CodexUsageSnapshot {
    if (!sessionId) return snapshot

    const prev = sessionTotals.get(sessionId)
    sessionTotals.set(sessionId, snapshot)
    if (!prev) return snapshot

    const resumedSameSession = parentSessionId === sessionId
    const looksCumulative =
        snapshot.inputTokens >= prev.inputTokens &&
        snapshot.outputTokens >= prev.outputTokens &&
        (snapshot.costUsd === undefined || prev.costUsd === undefined || snapshot.costUsd >= prev.costUsd)

    if (!looksCumulative || !resumedSameSession) {
        return snapshot
    }

    return {
        inputTokens: Math.max(0, snapshot.inputTokens - prev.inputTokens),
        outputTokens: Math.max(0, snapshot.outputTokens - prev.outputTokens),
        costUsd: snapshot.costUsd !== undefined && prev.costUsd !== undefined ? Math.max(0, snapshot.costUsd - prev.costUsd) : snapshot.costUsd,
    }
}
