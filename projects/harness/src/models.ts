import type { HarnessId, ModelEntry, HarnessModelConfig } from "./types.js"

// ============================================================================
// Harness Metadata (pure data — safe for renderer)
// ============================================================================

export interface HarnessMetaEntry {
    name: string
    vendor: string
}

export const HARNESS_META: Record<HarnessId, HarnessMetaEntry> = {
    "claude-code": { name: "Claude Code", vendor: "Anthropic" },
    codex: { name: "Codex", vendor: "OpenAI" },
}

// ============================================================================
// Model Registry (pure data — safe for renderer)
//
// This is the static counterpart of each harness's models() method.
// A sync test ensures these stay in lockstep.
// ============================================================================

export const CLAUDE_CODE_MODEL_CONFIG: HarnessModelConfig = {
    models: [
        { id: "opus-4-6", fullId: "claude-opus-4-6", label: "Opus 4.6", displayClass: "Opus" },
        { id: "opus-4-7", fullId: "claude-opus-4-7", label: "Opus 4.7", displayClass: "Opus" },
        { id: "opus", fullId: "opus", label: "Opus (latest)", displayClass: "Opus" },
        { id: "sonnet", fullId: "claude-sonnet-4-6", label: "Sonnet 4.6", displayClass: "Sonnet" },
        { id: "haiku", fullId: "claude-haiku-4-5-20251001", label: "Haiku 4.5", displayClass: "Haiku" },
    ],
    defaultModel: "opus",
}

export const CODEX_MODEL_CONFIG: HarnessModelConfig = {
    models: [
        { id: "gpt-5.5", fullId: "gpt-5.5", label: "GPT-5.5", displayClass: "Codex" },
        { id: "gpt-5.4", fullId: "gpt-5.4", label: "GPT-5.4", displayClass: "Codex" },
        { id: "gpt-5.3-codex", fullId: "gpt-5.3-codex", label: "GPT-5.3 Codex", displayClass: "Codex" },
        { id: "gpt-5.3-codex-spark", fullId: "gpt-5.3-codex-spark", label: "GPT-5.3 Codex Spark", displayClass: "Codex" },
    ],
    defaultModel: "gpt-5.5",
}

export const MODEL_REGISTRY: Record<HarnessId, HarnessModelConfig> = {
    "claude-code": CLAUDE_CODE_MODEL_CONFIG,
    codex: CODEX_MODEL_CONFIG,
}

export const DEFAULT_HARNESS_ID: HarnessId = "claude-code"
export const DEFAULT_MODEL = "opus"

// ============================================================================
// Helpers
// ============================================================================

function findExactModelEntry(value: string, config: HarnessModelConfig): ModelEntry | undefined {
    return config.models.find((model) => model.id === value || model.fullId === value)
}

function isRollingAlias(model: ModelEntry): boolean {
    return model.id.toLowerCase() === model.displayClass.toLowerCase()
}

function getModelCompatibilityScore(value: string, model: ModelEntry): number {
    const lower = value.toLowerCase()
    let score = 0

    for (const candidate of [model.id.toLowerCase(), model.displayClass.toLowerCase(), model.fullId.toLowerCase()]) {
        if (lower.includes(candidate)) {
            score = Math.max(score, candidate.length)
        }
    }

    return score
}

function findCompatibleModelEntry(value: string, config: HarnessModelConfig): ModelEntry | undefined {
    const exact = findExactModelEntry(value, config)
    if (exact) return exact

    let bestMatch: ModelEntry | undefined
    let bestScore = 0

    for (const model of config.models) {
        const score = getModelCompatibilityScore(value, model)
        if (score > bestScore) {
            bestMatch = model
            bestScore = score
            continue
        }

        if (score > 0 && score === bestScore && bestMatch && isRollingAlias(model) && !isRollingAlias(bestMatch)) {
            bestMatch = model
        }
    }

    return bestMatch
}

export function getModelFullId(alias: string, harnessId?: HarnessId): string {
    if (harnessId) {
        const config = MODEL_REGISTRY[harnessId]
        if (config) {
            const found = config.models.find((m) => m.id === alias)
            if (found) return found.fullId
        }
    }

    // Fallback: search all harnesses (backward compat)
    for (const config of Object.values(MODEL_REGISTRY)) {
        const found = config.models.find((m) => m.id === alias)
        if (found) return found.fullId
    }

    // If alias is already a full ID, return as-is
    return alias
}

export function getModelsForHarness(harnessId: HarnessId): ModelEntry[] {
    return MODEL_REGISTRY[harnessId]?.models ?? []
}

export function getDefaultModelForHarness(harnessId: HarnessId): string {
    return MODEL_REGISTRY[harnessId]?.defaultModel ?? DEFAULT_MODEL
}

export function resolveModelForHarness(alias: string, harnessId: HarnessId): string {
    const config = MODEL_REGISTRY[harnessId]
    if (!config) return alias
    const found = findCompatibleModelEntry(alias, config)
    if (found) return found.id
    return config.defaultModel
}

export function normalizeModelClass(modelId: string): string {
    // Registry lookup first
    for (const config of Object.values(MODEL_REGISTRY)) {
        const found = config.models.find((m) => m.id === modelId || m.fullId === modelId)
        if (found) return found.displayClass
    }

    // Fallback for legacy/unknown model IDs
    const lower = modelId.toLowerCase()
    if (lower.includes("opus")) return "Opus"
    if (lower.includes("sonnet")) return "Sonnet"
    if (lower.includes("haiku")) return "Haiku"
    if (lower.includes("codex")) return "Codex"
    if (lower.startsWith("gpt-")) return "Codex"
    return "Other"
}
