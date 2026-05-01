import { calculateCodexCostUsd, type HarnessUsage } from "@openade/harness/browser"
import type { HarnessRawMessageEvent, HarnessStreamEvent } from "../electronAPI/harnessEventTypes"
import { extractRawMessageEvents } from "../electronAPI/harnessEventTypes"
import type { ActionEvent, CodeEvent, HarnessId } from "../types"
import type { TaskPreviewUsage } from "./repoStore"

export const TASK_USAGE_STATS_VERSION = 2

interface CodexUsageSnapshot {
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
}

interface UsageEntry {
    harnessId: HarnessId
    modelId: string
    events: HarnessStreamEvent[]
    sessionId?: string
    parentSessionId?: string
    allowLegacySameSessionDelta?: boolean
}

export function needsTaskUsageBackfill(usage?: TaskPreviewUsage): boolean {
    return !usage || usage.durationMs === undefined || usage.usageVersion !== TASK_USAGE_STATS_VERSION
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

        for (const entry of getUsageEntries(event)) {
            const messageEvents = extractRawMessageEvents(entry.events)
            if (entry.harnessId === "claude-code") {
                for (const evt of messageEvents) {
                    if (evt.harnessId === "claude-code" && evt.message.type === "result") {
                        const resultCostUsd = evt.message.total_cost_usd ?? 0
                        totalCostUsd += resultCostUsd
                        const usage = evt.message.usage as { input_tokens?: number; output_tokens?: number } | undefined
                        inputTokens += usage?.input_tokens ?? 0
                        outputTokens += usage?.output_tokens ?? 0
                        costByModel[entry.modelId] = (costByModel[entry.modelId] ?? 0) + resultCostUsd
                        durationMs += evt.message.duration_ms ?? 0
                    }
                }
                continue
            }

            const codexUsage = extractCodexUsageSnapshot(messageEvents, entry.events)
            if (codexUsage) {
                const sessionId = entry.sessionId ?? extractCodexSessionId(messageEvents)
                const usageToAdd = normalizeCodexUsage({
                    snapshot: codexUsage,
                    sessionId,
                    parentSessionId: entry.parentSessionId,
                    allowLegacySameSessionDelta: entry.allowLegacySameSessionDelta,
                    sessionTotals: codexSessionTotals,
                })

                inputTokens += usageToAdd.inputTokens
                outputTokens += usageToAdd.outputTokens

                const computedCostUsd = calculateCodexCostUsd(entry.modelId, usageToAdd.inputTokens, usageToAdd.outputTokens, usageToAdd.cacheReadTokens)
                if (computedCostUsd !== undefined) {
                    totalCostUsd += computedCostUsd
                    costByModel[entry.modelId] = (costByModel[entry.modelId] ?? 0) + computedCostUsd
                }
            }

            const completeUsage = extractCompleteUsage(entry.events)
            if (completeUsage?.durationMs) {
                durationMs += completeUsage.durationMs
            }
        }
    }

    return { usageVersion: TASK_USAGE_STATS_VERSION, inputTokens, outputTokens, totalCostUsd, eventCount, costByModel, durationMs }
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

function getUsageEntries(event: ActionEvent & { id: string }): UsageEntry[] {
    const entries: UsageEntry[] = []
    const mainModelId = event.execution.modelId ?? "unknown"

    // HyperPlan terminal executions can resume a sub-plan session. Process
    // sub-executions first so cumulative Codex snapshots delta correctly.
    for (const sub of event.hyperplanSubExecutions ?? []) {
        entries.push({
            harnessId: sub.harnessId ?? "claude-code",
            modelId: sub.modelId ?? mainModelId,
            events: sub.events,
            sessionId: sub.sessionId,
            parentSessionId: sub.parentSessionId,
        })
    }

    entries.push({
        harnessId: event.execution.harnessId ?? "claude-code",
        modelId: mainModelId,
        events: event.execution.events,
        sessionId: event.execution.sessionId,
        parentSessionId: event.execution.parentSessionId,
        allowLegacySameSessionDelta: (event.hyperplanSubExecutions?.length ?? 0) === 0,
    })

    return entries
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
    let latestTurnUsage: { inputTokens: number; outputTokens: number; cacheReadTokens: number } | undefined
    for (const evt of messageEvents) {
        if (evt.harnessId === "codex" && evt.message.type === "turn.completed") {
            latestTurnUsage = {
                inputTokens: evt.message.usage.input_tokens ?? 0,
                outputTokens: evt.message.usage.output_tokens ?? 0,
                cacheReadTokens: evt.message.usage.cached_input_tokens ?? 0,
            }
        }
    }

    const completeUsage = extractCompleteUsage(streamEvents)
    const input = completeUsage?.inputTokens ?? latestTurnUsage?.inputTokens
    const output = completeUsage?.outputTokens ?? latestTurnUsage?.outputTokens
    const cacheRead = completeUsage?.cacheReadTokens ?? latestTurnUsage?.cacheReadTokens ?? 0

    if (input === undefined && output === undefined) return undefined

    return {
        inputTokens: input ?? 0,
        outputTokens: output ?? 0,
        cacheReadTokens: cacheRead,
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
    allowLegacySameSessionDelta,
    sessionTotals,
}: {
    snapshot: CodexUsageSnapshot
    sessionId?: string
    parentSessionId?: string
    allowLegacySameSessionDelta?: boolean
    sessionTotals: Map<string, CodexUsageSnapshot>
}): CodexUsageSnapshot {
    if (!sessionId) return snapshot

    const prev = sessionTotals.get(sessionId)
    sessionTotals.set(sessionId, snapshot)
    if (!prev) return snapshot

    const canDeltaSameSession = parentSessionId === sessionId || (parentSessionId === undefined && allowLegacySameSessionDelta === true)
    const looksCumulative = snapshot.inputTokens >= prev.inputTokens && snapshot.outputTokens >= prev.outputTokens

    if (!looksCumulative || !canDeltaSameSession) {
        return snapshot
    }

    return {
        inputTokens: Math.max(0, snapshot.inputTokens - prev.inputTokens),
        outputTokens: Math.max(0, snapshot.outputTokens - prev.outputTokens),
        cacheReadTokens: Math.max(0, snapshot.cacheReadTokens - prev.cacheReadTokens),
    }
}
