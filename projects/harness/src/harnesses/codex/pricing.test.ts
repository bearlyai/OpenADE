import { describe, it, expect } from "vitest"
import { calculateCostUsd } from "./pricing.js"

describe("calculateCostUsd", () => {
    it("returns correct cost for exact model match", () => {
        // gpt-5.3-codex: $1.75/M input, $14.00/M output
        const cost = calculateCostUsd("gpt-5.3-codex", 1_000_000, 1_000_000)
        expect(cost).toBeCloseTo(1.75 + 14.0)
    })

    it("strips effort suffix -xhigh", () => {
        const cost = calculateCostUsd("gpt-5.3-codex-xhigh", 1_000_000, 0)
        expect(cost).toBeCloseTo(1.75)
    })

    it("strips effort suffix -high", () => {
        const cost = calculateCostUsd("gpt-5.3-codex-high", 0, 1_000_000)
        expect(cost).toBeCloseTo(14.0)
    })

    it("strips effort suffix -medium", () => {
        const cost = calculateCostUsd("gpt-5.2-codex-medium", 1_000_000, 0)
        expect(cost).toBeCloseTo(1.75)
    })

    it("strips effort suffix -low", () => {
        const cost = calculateCostUsd("gpt-5.1-codex-low", 1_000_000, 0)
        expect(cost).toBeCloseTo(1.25)
    })

    it("resolves spark variant directly (not stripped)", () => {
        const cost = calculateCostUsd("gpt-5.3-codex-spark", 1_000_000, 1_000_000)
        expect(cost).toBeCloseTo(1.75 + 14.0)
    })

    it("resolves max variant directly", () => {
        const cost = calculateCostUsd("gpt-5.1-codex-max", 1_000_000, 0)
        expect(cost).toBeCloseTo(1.25)
    })

    it("includes cache read tokens in cost", () => {
        // gpt-5.3-codex: $0.175/M cache read
        const cost = calculateCostUsd("gpt-5.3-codex", 0, 0, 1_000_000)
        expect(cost).toBeCloseTo(0.175)
    })

    it("computes combined cost with all token types", () => {
        // gpt-5.3-codex: $1.75/M input, $14.00/M output, $0.175/M cache read
        const cost = calculateCostUsd("gpt-5.3-codex", 500_000, 200_000, 300_000)
        const expected = (500_000 / 1e6) * 1.75 + (200_000 / 1e6) * 14.0 + (300_000 / 1e6) * 0.175
        expect(cost).toBeCloseTo(expected)
    })

    it("returns 0 for zero tokens (not undefined)", () => {
        const cost = calculateCostUsd("gpt-5.3-codex", 0, 0, 0)
        expect(cost).toBe(0)
    })

    it("returns undefined for unknown model", () => {
        expect(calculateCostUsd("gpt-99-codex", 1000, 1000)).toBeUndefined()
    })

    it("returns undefined for undefined model", () => {
        expect(calculateCostUsd(undefined, 1000, 1000)).toBeUndefined()
    })

    it("is case insensitive", () => {
        const cost = calculateCostUsd("GPT-5.3-Codex", 1_000_000, 0)
        expect(cost).toBeCloseTo(1.75)
    })

    it("handles codex-mini-latest pricing", () => {
        // $1.50/M input, $6.00/M output
        const cost = calculateCostUsd("codex-mini-latest", 1_000_000, 1_000_000)
        expect(cost).toBeCloseTo(1.5 + 6.0)
    })

    it("handles gpt-5.1-codex-mini pricing", () => {
        // $0.25/M input, $2.00/M output
        const cost = calculateCostUsd("gpt-5.1-codex-mini", 1_000_000, 1_000_000)
        expect(cost).toBeCloseTo(0.25 + 2.0)
    })
})
