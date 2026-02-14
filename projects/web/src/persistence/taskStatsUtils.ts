import type { HarnessUsage } from "@openade/harness"
import type { HarnessStreamEvent } from "../electronAPI/harnessEventTypes"
import { extractRawMessageEvents } from "../electronAPI/harnessEventTypes"
import type { CodeEvent } from "../types"
import type { TaskPreviewUsage } from "./repoStore"

export function computeTaskUsage(events: Array<CodeEvent & { id: string }>): TaskPreviewUsage {
    let inputTokens = 0
    let outputTokens = 0
    let totalCostUsd = 0
    let eventCount = 0
    const costByModel: Record<string, number> = {}

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
            }
            // Codex token usage comes from turn.completed events
            if (evt.harnessId === "codex" && evt.message.type === "turn.completed") {
                inputTokens += evt.message.usage.input_tokens ?? 0
                outputTokens += evt.message.usage.output_tokens ?? 0
            }
        }

        // Codex cost comes from the harness-level complete event (enriched by the harness lib)
        const harnessId = event.execution.harnessId ?? "claude-code"
        if (harnessId === "codex") {
            const completeCost = extractCompleteCost(event.execution.events)
            if (completeCost !== undefined) {
                totalCostUsd += completeCost
                costByModel[modelId] = (costByModel[modelId] ?? 0) + completeCost
            }
        }
    }

    return { inputTokens, outputTokens, totalCostUsd, eventCount, costByModel }
}

function extractCompleteCost(events: HarnessStreamEvent[]): number | undefined {
    for (const e of events) {
        if (e.direction === "execution" && e.type === "complete") {
            return (e as { usage?: HarnessUsage }).usage?.costUsd
        }
    }
    return undefined
}
