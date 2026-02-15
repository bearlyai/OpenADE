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
    it("resolves alias with harnessId", () => {
        expect(getModelFullId("opus", "claude-code")).toBe("claude-opus-4-6")
    })

    it("resolves alias searching all harnesses", () => {
        expect(getModelFullId("gpt-5.3-codex")).toBe("gpt-5.3-codex")
    })

    it("returns alias as-is for unknown values", () => {
        expect(getModelFullId("unknown-model")).toBe("unknown-model")
    })

    it("does not resolve alias from wrong harness, falls back to all", () => {
        expect(getModelFullId("opus", "codex")).toBe("claude-opus-4-6")
    })
})

// ============================================================================
// getModelsForHarness
// ============================================================================

describe("getModelsForHarness", () => {
    it("returns models for claude-code", () => {
        const models = getModelsForHarness("claude-code")
        expect(models.length).toBe(3)
        expect(models.map((m) => m.id)).toEqual(["opus", "sonnet", "haiku"])
    })

    it("returns models for codex", () => {
        const models = getModelsForHarness("codex")
        expect(models.length).toBe(2)
        expect(models.map((m) => m.id)).toEqual(["gpt-5.3-codex", "gpt-5.3-codex-spark"])
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

    it("returns gpt-5.3-codex for codex", () => {
        expect(getDefaultModelForHarness("codex")).toBe("gpt-5.3-codex")
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
        expect(normalizeModelClass("sonnet")).toBe("Sonnet")
        expect(normalizeModelClass("haiku")).toBe("Haiku")
    })

    it("resolves from registry by fullId", () => {
        expect(normalizeModelClass("claude-opus-4-6")).toBe("Opus")
        expect(normalizeModelClass("gpt-5.3-codex")).toBe("Codex")
    })

    it("falls back to string matching for legacy model IDs", () => {
        expect(normalizeModelClass("claude-opus-4-20250514")).toBe("Opus")
        expect(normalizeModelClass("claude-sonnet-3-5-20241022")).toBe("Sonnet")
        expect(normalizeModelClass("some-codex-variant")).toBe("Codex")
    })

    it("returns Other for unknown models", () => {
        expect(normalizeModelClass("completely-unknown")).toBe("Other")
    })
})
