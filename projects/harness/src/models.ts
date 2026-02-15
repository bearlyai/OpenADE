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

export const MODEL_REGISTRY: Record<HarnessId, HarnessModelConfig> = {
    "claude-code": {
        models: [
            { id: "opus", fullId: "claude-opus-4-6", label: "Opus 4.6", displayClass: "Opus" },
            { id: "sonnet", fullId: "claude-sonnet-4-5-20250929", label: "Sonnet 4.5", displayClass: "Sonnet" },
            { id: "haiku", fullId: "claude-haiku-4-5-20251001", label: "Haiku 4.5", displayClass: "Haiku" },
        ],
        defaultModel: "opus",
    },
    codex: {
        models: [
            { id: "gpt-5.3-codex", fullId: "gpt-5.3-codex", label: "GPT-5.3 Codex", displayClass: "Codex" },
            { id: "gpt-5.3-codex-spark", fullId: "gpt-5.3-codex-spark", label: "GPT-5.3 Codex Spark", displayClass: "Codex" },
        ],
        defaultModel: "gpt-5.3-codex",
    },
}

export const DEFAULT_HARNESS_ID: HarnessId = "claude-code"
export const DEFAULT_MODEL = "opus"

// ============================================================================
// Helpers
// ============================================================================

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
    const found = config.models.find((m) => m.id === alias)
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
    return "Other"
}
