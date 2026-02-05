import { extractSDKMessages } from "../electronAPI/claudeEventTypes"
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
        const sdkMessages = extractSDKMessages(event.execution.events)
        for (const msg of sdkMessages) {
            if (msg.type === "result") {
                const r = msg as unknown as {
                    total_cost_usd: number
                    usage: { input_tokens: number; output_tokens: number }
                }
                totalCostUsd += r.total_cost_usd ?? 0
                inputTokens += r.usage?.input_tokens ?? 0
                outputTokens += r.usage?.output_tokens ?? 0
                costByModel[modelId] = (costByModel[modelId] ?? 0) + (r.total_cost_usd ?? 0)
            }
        }
    }

    return { inputTokens, outputTokens, totalCostUsd, eventCount, costByModel }
}
