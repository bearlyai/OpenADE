import type { ResultGroup } from "./messageGroups"

type ResultUsage = ResultGroup["usage"]

export function normalizedCacheReadTokens(usage: ResultUsage): number | undefined {
    if (usage.cacheReadTokens === undefined) return undefined
    return Math.min(Math.max(usage.cacheReadTokens, 0), Math.max(usage.inputTokens, 0))
}

export function formatInputCacheRate(usage: ResultUsage): string | undefined {
    const cacheReadTokens = normalizedCacheReadTokens(usage)
    if (cacheReadTokens === undefined || usage.inputTokens <= 0) return undefined

    const percent = (cacheReadTokens / usage.inputTokens) * 100
    if (percent > 0 && percent < 1) return "<1%"
    return `${Math.round(percent)}%`
}
