interface ModelPricing {
    inputPerMillion: number
    outputPerMillion: number
    cacheReadPerMillion?: number
}

// Prices from https://models.dev/api.json (OpenAI provider), per million tokens
const CODEX_PRICING: Record<string, ModelPricing> = {
    "codex-mini-latest": { inputPerMillion: 1.5, outputPerMillion: 6.0, cacheReadPerMillion: 0.375 },
    "gpt-5-codex": { inputPerMillion: 1.25, outputPerMillion: 10.0, cacheReadPerMillion: 0.125 },
    "gpt-5.1-codex": { inputPerMillion: 1.25, outputPerMillion: 10.0, cacheReadPerMillion: 0.125 },
    "gpt-5.1-codex-max": { inputPerMillion: 1.25, outputPerMillion: 10.0, cacheReadPerMillion: 0.125 },
    "gpt-5.1-codex-mini": { inputPerMillion: 0.25, outputPerMillion: 2.0, cacheReadPerMillion: 0.025 },
    "gpt-5.2-codex": { inputPerMillion: 1.75, outputPerMillion: 14.0, cacheReadPerMillion: 0.175 },
    "gpt-5.3-codex": { inputPerMillion: 1.75, outputPerMillion: 14.0, cacheReadPerMillion: 0.175 },
    "gpt-5.3-codex-spark": { inputPerMillion: 1.75, outputPerMillion: 14.0, cacheReadPerMillion: 0.175 },
}

// Suffixes appended by model_reasoning_effort config — don't affect per-token pricing
const EFFORT_SUFFIXES = ["-xhigh", "-high", "-medium", "-low"]

export function calculateCostUsd(
    model: string | undefined,
    inputTokens: number,
    outputTokens: number,
    cacheReadTokens?: number,
): number | undefined {
    if (!model) return undefined

    const pricing = resolvePricing(model)
    if (!pricing) return undefined

    let cost =
        (inputTokens / 1_000_000) * pricing.inputPerMillion +
        (outputTokens / 1_000_000) * pricing.outputPerMillion

    if (cacheReadTokens && pricing.cacheReadPerMillion) {
        cost += (cacheReadTokens / 1_000_000) * pricing.cacheReadPerMillion
    }

    return cost
}

function resolvePricing(model: string): ModelPricing | undefined {
    const lower = model.toLowerCase()

    // Exact match
    if (CODEX_PRICING[lower]) return CODEX_PRICING[lower]

    // Strip effort suffixes and retry
    for (const suffix of EFFORT_SUFFIXES) {
        if (lower.endsWith(suffix)) {
            const base = lower.slice(0, -suffix.length)
            if (CODEX_PRICING[base]) return CODEX_PRICING[base]
        }
    }

    return undefined
}
