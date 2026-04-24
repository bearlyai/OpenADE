import { describe, it, expect } from "vitest"
import { ClaudeCodeHarness } from "./harnesses/claude-code/index.js"
import { CodexHarness } from "./harnesses/codex/index.js"
import {
    MODEL_REGISTRY,
    HARNESS_META,
    DEFAULT_HARNESS_ID,
    DEFAULT_MODEL,
    getModelFullId,
    getModelsForHarness,
    getDefaultModelForHarness,
    resolveModelForHarness,
    normalizeModelClass,
} from "./models.js"

// ============================================================================
// Sync tests — ensure static registry matches harness instances
// ============================================================================

describe("MODEL_REGISTRY sync", () => {
    it("matches ClaudeCodeHarness.models()", () => {
        const harness = new ClaudeCodeHarness()
        expect(harness.models()).toEqual(MODEL_REGISTRY["claude-code"])
    })

    it("matches CodexHarness.models()", () => {
        const harness = new CodexHarness()
        expect(harness.models()).toEqual(MODEL_REGISTRY["codex"])
    })

    it("HARNESS_META matches harness meta()", () => {
        for (const harness of [new ClaudeCodeHarness(), new CodexHarness()]) {
            const meta = harness.meta()
            expect(HARNESS_META[meta.id]).toEqual({ name: meta.name, vendor: meta.vendor })
        }
    })

    it("MODEL_REGISTRY keys match HARNESS_META keys", () => {
        expect(Object.keys(MODEL_REGISTRY).sort()).toEqual(Object.keys(HARNESS_META).sort())
    })
})

// ============================================================================
// Defaults
// ============================================================================

describe("defaults", () => {
    it("DEFAULT_HARNESS_ID is claude-code", () => {
        expect(DEFAULT_HARNESS_ID).toBe("claude-code")
    })

    it("DEFAULT_MODEL is opus", () => {
        expect(DEFAULT_MODEL).toBe("opus")
    })
})

// ============================================================================
// getModelFullId
// ============================================================================

describe("getModelFullId", () => {
    it("resolves rolling alias with harnessId", () => {
        expect(getModelFullId("opus", "claude-code")).toBe("opus")
    })

    it("resolves versioned alias with harnessId", () => {
        expect(getModelFullId("opus-4-7", "claude-code")).toBe("claude-opus-4-7")
    })

    it("resolves alias searching all harnesses", () => {
        expect(getModelFullId("gpt-5.3-codex")).toBe("gpt-5.3-codex")
    })

    it("returns alias as-is for unknown values", () => {
        expect(getModelFullId("unknown-model")).toBe("unknown-model")
    })

    it("does not resolve alias from wrong harness, falls back to all", () => {
        expect(getModelFullId("opus", "codex")).toBe("opus")
    })
})

// ============================================================================
// getModelsForHarness
// ============================================================================

describe("getModelsForHarness", () => {
    it("returns models for claude-code", () => {
        const models = getModelsForHarness("claude-code")
        expect(models.length).toBe(5)
        expect(models.map((m) => m.id)).toEqual(["opus-4-6", "opus-4-7", "opus", "sonnet", "haiku"])
    })

    it("returns models for codex", () => {
        const models = getModelsForHarness("codex")
        expect(models.length).toBe(4)
        expect(models.map((m) => m.id)).toEqual(["gpt-5.5", "gpt-5.4", "gpt-5.3-codex", "gpt-5.3-codex-spark"])
    })

    it("returns empty array for unknown harness", () => {
        expect(getModelsForHarness("unknown" as never)).toEqual([])
    })
})

// ============================================================================
// getDefaultModelForHarness
// ============================================================================

describe("getDefaultModelForHarness", () => {
    it("returns opus for claude-code", () => {
        expect(getDefaultModelForHarness("claude-code")).toBe("opus")
    })

    it("returns gpt-5.5 for codex", () => {
        expect(getDefaultModelForHarness("codex")).toBe("gpt-5.5")
    })

    it("falls back to DEFAULT_MODEL for unknown harness", () => {
        expect(getDefaultModelForHarness("unknown" as never)).toBe(DEFAULT_MODEL)
    })
})

// ============================================================================
// resolveModelForHarness
// ============================================================================

describe("resolveModelForHarness", () => {
    it("returns alias when it exists in harness", () => {
        expect(resolveModelForHarness("sonnet", "claude-code")).toBe("sonnet")
    })

    it("maps exact Opus full IDs to versioned aliases", () => {
        expect(resolveModelForHarness("claude-opus-4-6", "claude-code")).toBe("opus-4-6")
        expect(resolveModelForHarness("claude-opus-4-7", "claude-code")).toBe("opus-4-7")
        expect(resolveModelForHarness("gpt-5.3-codex", "codex")).toBe("gpt-5.3-codex")
    })

    it("maps future Claude family full IDs to stable aliases", () => {
        expect(resolveModelForHarness("claude-opus-4-8", "claude-code")).toBe("opus")
        expect(resolveModelForHarness("claude-sonnet-4-7-20260601", "claude-code")).toBe("sonnet")
    })

    it("keeps known Opus versions when the full ID grows a suffix", () => {
        expect(resolveModelForHarness("claude-opus-4-7-preview", "claude-code")).toBe("opus-4-7")
    })

    it("prefers the longest compatible Codex alias", () => {
        expect(resolveModelForHarness("gpt-5.3-codex-spark-preview", "codex")).toBe("gpt-5.3-codex-spark")
    })

    it("maps Codex variants that keep the alias prefix", () => {
        expect(resolveModelForHarness("gpt-5.5-xhigh", "codex")).toBe("gpt-5.5")
    })

    it("falls back to harness default for unknown alias", () => {
        expect(resolveModelForHarness("nonexistent", "claude-code")).toBe("opus")
    })

    it("returns alias as-is for unknown harness", () => {
        expect(resolveModelForHarness("whatever", "unknown" as never)).toBe("whatever")
    })
})

// ============================================================================
// normalizeModelClass
// ============================================================================

describe("normalizeModelClass", () => {
    it("resolves from registry by alias", () => {
        expect(normalizeModelClass("opus")).toBe("Opus")
        expect(normalizeModelClass("opus-4-7")).toBe("Opus")
        expect(normalizeModelClass("sonnet")).toBe("Sonnet")
        expect(normalizeModelClass("haiku")).toBe("Haiku")
    })

    it("resolves from registry by fullId", () => {
        expect(normalizeModelClass("claude-opus-4-7")).toBe("Opus")
        expect(normalizeModelClass("gpt-5.3-codex")).toBe("Codex")
        expect(normalizeModelClass("gpt-5.5")).toBe("Codex")
        expect(normalizeModelClass("gpt-5.4")).toBe("Codex")
    })

    it("falls back to string matching for legacy model IDs", () => {
        expect(normalizeModelClass("claude-opus-4-20250514")).toBe("Opus")
        expect(normalizeModelClass("claude-sonnet-3-5-20241022")).toBe("Sonnet")
        expect(normalizeModelClass("some-codex-variant")).toBe("Codex")
        expect(normalizeModelClass("gpt-5.5-xhigh")).toBe("Codex")
    })

    it("returns Other for unknown models", () => {
        expect(normalizeModelClass("completely-unknown")).toBe("Other")
    })
})
