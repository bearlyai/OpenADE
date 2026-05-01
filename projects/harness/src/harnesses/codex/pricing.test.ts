import { describe, it, expect } from "vitest"
import { calculateCodexCostUsd } from "./pricing.js"

describe("calculateCodexCostUsd", () => {
    it("returns correct cost for exact model match", () => {
        // gpt-5.5: $5.00/M input, $30.00/M output
        const cost = calculateCodexCostUsd("gpt-5.5", 1_000_000, 1_000_000)
        expect(cost).toBeCloseTo(5.0 + 30.0)
    })

    it("strips effort suffix -xhigh", () => {
        const cost = calculateCodexCostUsd("gpt-5.5-xhigh", 1_000_000, 0)
        expect(cost).toBeCloseTo(5.0)
    })

    it("strips effort suffix -high", () => {
        const cost = calculateCodexCostUsd("gpt-5.3-codex-high", 0, 1_000_000)
        expect(cost).toBeCloseTo(14.0)
    })

    it("strips effort suffix -medium", () => {
        const cost = calculateCodexCostUsd("gpt-5.2-codex-medium", 1_000_000, 0)
        expect(cost).toBeCloseTo(1.75)
    })

    it("strips effort suffix -low", () => {
        const cost = calculateCodexCostUsd("gpt-5.1-codex-low", 1_000_000, 0)
        expect(cost).toBeCloseTo(1.25)
    })

    it("returns undefined for Spark until public pricing is available", () => {
        const cost = calculateCodexCostUsd("gpt-5.3-codex-spark", 1_000_000, 1_000_000)
        expect(cost).toBeUndefined()
    })

    it("resolves max variant directly", () => {
        const cost = calculateCodexCostUsd("gpt-5.1-codex-max", 1_000_000, 0)
        expect(cost).toBeCloseTo(1.25)
    })

    it("charges cached input as a discounted subset of input tokens", () => {
        // gpt-5.5: $0.50/M cache read
        const cost = calculateCodexCostUsd("gpt-5.5", 1_000_000, 0, 1_000_000)
        expect(cost).toBeCloseTo(0.5)
    })

    it("uses the current gpt-5.4 cached input rate", () => {
        const cost = calculateCodexCostUsd("gpt-5.4", 1_000_000, 0, 1_000_000)
        expect(cost).toBeCloseTo(0.25)
    })

    it("computes combined cost with all token types", () => {
        // gpt-5.5: $5.00/M input, $30.00/M output, $0.50/M cache read
        const cost = calculateCodexCostUsd("gpt-5.5", 500_000, 200_000, 300_000)
        const expected = (200_000 / 1e6) * 5.0 + (200_000 / 1e6) * 30.0 + (300_000 / 1e6) * 0.5
        expect(cost).toBeCloseTo(expected)
    })

    it("clamps cached input tokens to total input tokens", () => {
        const cost = calculateCodexCostUsd("gpt-5.5", 100_000, 0, 500_000)
        const expected = (100_000 / 1e6) * 0.5
        expect(cost).toBeCloseTo(expected)
    })

    it("returns 0 for zero tokens (not undefined)", () => {
        const cost = calculateCodexCostUsd("gpt-5.5", 0, 0, 0)
        expect(cost).toBe(0)
    })

    it("returns undefined for unknown model", () => {
        expect(calculateCodexCostUsd("gpt-99-codex", 1000, 1000)).toBeUndefined()
    })

    it("returns undefined for undefined model", () => {
        expect(calculateCodexCostUsd(undefined, 1000, 1000)).toBeUndefined()
    })

    it("is case insensitive", () => {
        const cost = calculateCodexCostUsd("GPT-5.3-Codex", 1_000_000, 0)
        expect(cost).toBeCloseTo(1.75)
    })

    it("handles codex-mini-latest pricing", () => {
        // $1.50/M input, $6.00/M output
        const cost = calculateCodexCostUsd("codex-mini-latest", 1_000_000, 1_000_000)
        expect(cost).toBeCloseTo(1.5 + 6.0)
    })

    it("handles gpt-5.1-codex-mini pricing", () => {
        // $0.25/M input, $2.00/M output
        const cost = calculateCodexCostUsd("gpt-5.1-codex-mini", 1_000_000, 1_000_000)
        expect(cost).toBeCloseTo(0.25 + 2.0)
    })
})
