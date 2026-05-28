interface ModelPricing {
    standard: TokenPricing
    fast?: TokenPricing
}

interface TokenPricing {
    inputPerMillion: number
    outputPerMillion: number
    cacheReadPerMillion?: number
}

export interface CodexCostOptions {
    fastMode?: boolean
}

// Prices from https://platform.openai.com/docs/pricing/ and model release notes, per million tokens.
// Codex fast mode maps to OpenAI's priority/fast service-tier pricing where published.
const CODEX_PRICING: Record<string, ModelPricing> = {
    "codex-mini-latest": { standard: { inputPerMillion: 1.5, outputPerMillion: 6.0, cacheReadPerMillion: 0.375 } },
    "gpt-5-codex": { standard: { inputPerMillion: 1.25, outputPerMillion: 10.0, cacheReadPerMillion: 0.125 } },
    "gpt-5.1-codex": { standard: { inputPerMillion: 1.25, outputPerMillion: 10.0, cacheReadPerMillion: 0.125 } },
    "gpt-5.1-codex-max": { standard: { inputPerMillion: 1.25, outputPerMillion: 10.0, cacheReadPerMillion: 0.125 } },
    "gpt-5.1-codex-mini": { standard: { inputPerMillion: 0.25, outputPerMillion: 2.0, cacheReadPerMillion: 0.025 } },
    "gpt-5.2-codex": { standard: { inputPerMillion: 1.75, outputPerMillion: 14.0, cacheReadPerMillion: 0.175 } },
    "gpt-5.3-codex": {
        standard: { inputPerMillion: 1.75, outputPerMillion: 14.0, cacheReadPerMillion: 0.175 },
        fast: { inputPerMillion: 3.5, outputPerMillion: 28.0, cacheReadPerMillion: 0.35 },
    },
    "gpt-5.5": {
        standard: { inputPerMillion: 5.0, outputPerMillion: 30.0, cacheReadPerMillion: 0.5 },
        fast: { inputPerMillion: 12.5, outputPerMillion: 75.0, cacheReadPerMillion: 1.25 },
    },
    "gpt-5.4": {
        standard: { inputPerMillion: 2.5, outputPerMillion: 15.0, cacheReadPerMillion: 0.25 },
        fast: { inputPerMillion: 5.0, outputPerMillion: 30.0, cacheReadPerMillion: 0.5 },
    },
}

// Suffixes appended by model_reasoning_effort config — don't affect per-token pricing
const EFFORT_SUFFIXES = ["-xhigh", "-high", "-medium", "-low"]

export function calculateCodexCostUsd(
    model: string | undefined,
    inputTokens: number,
    outputTokens: number,
    cacheReadTokens = 0,
    options: CodexCostOptions = {},
): number | undefined {
    if (!model) return undefined

    const modelPricing = resolvePricing(model)
    if (!modelPricing) return undefined
    const pricing = options.fastMode && modelPricing.fast ? modelPricing.fast : modelPricing.standard

    const cachedInputTokens = Math.min(Math.max(cacheReadTokens, 0), Math.max(inputTokens, 0))
    const uncachedInputTokens = Math.max(0, inputTokens - cachedInputTokens)

    return (
        (uncachedInputTokens / 1_000_000) * pricing.inputPerMillion +
        (cachedInputTokens / 1_000_000) * (pricing.cacheReadPerMillion ?? pricing.inputPerMillion) +
        (outputTokens / 1_000_000) * pricing.outputPerMillion
    )
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
