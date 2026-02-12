import { describe, it, expect, vi } from "vitest"
import { HarnessRegistry } from "./registry.js"
import { HarnessError } from "./errors.js"
import type { Harness } from "./harness.js"
import type { HarnessMeta, HarnessModel, HarnessCapabilities, HarnessInstallStatus, SlashCommand, HarnessQuery, HarnessEvent } from "./types.js"

function makeFakeHarness(id: string, installStatus?: Partial<HarnessInstallStatus>): Harness {
    return {
        id,
        meta(): HarnessMeta {
            return { id, name: id, vendor: "test", website: "https://test.com" }
        },
        models(): HarnessModel[] {
            return [{ id: "default", label: "Default", isDefault: true }]
        },
        capabilities(): HarnessCapabilities {
            return {
                supportsSystemPrompt: true,
                supportsAppendSystemPrompt: true,
                supportsReadOnly: true,
                supportsMcp: true,
                supportsResume: true,
                supportsFork: false,
                supportsClientTools: true,
                supportsStreamingTokens: false,
                supportsCostTracking: false,
                supportsNamedTools: false,
                supportsImages: false,
            }
        },
        async checkInstallStatus(): Promise<HarnessInstallStatus> {
            return {
                installed: true,
                version: "1.0.0",
                authType: "account",
                authenticated: true,
                ...installStatus,
            }
        },
        async discoverSlashCommands(): Promise<SlashCommand[]> {
            return []
        },
        async *query(_q: HarnessQuery): AsyncGenerator<HarnessEvent<unknown>> {
            yield { type: "complete" }
        },
    }
}

describe("HarnessRegistry", () => {
    it("registers and retrieves a harness", () => {
        const registry = new HarnessRegistry()
        const harness = makeFakeHarness("test-harness")
        registry.register(harness)

        expect(registry.get("test-harness")).toBe(harness)
    })

    it("returns undefined for unknown harness", () => {
        const registry = new HarnessRegistry()
        expect(registry.get("nonexistent")).toBeUndefined()
    })

    it("getOrThrow throws HarnessError for unknown ID", () => {
        const registry = new HarnessRegistry()
        expect(() => registry.getOrThrow("nonexistent")).toThrow(HarnessError)
        expect(() => registry.getOrThrow("nonexistent")).toThrow('Harness "nonexistent" is not registered')
    })

    it("getOrThrow returns harness for known ID", () => {
        const registry = new HarnessRegistry()
        const harness = makeFakeHarness("test")
        registry.register(harness)
        expect(registry.getOrThrow("test")).toBe(harness)
    })

    it("has() returns correct boolean", () => {
        const registry = new HarnessRegistry()
        const harness = makeFakeHarness("test")

        expect(registry.has("test")).toBe(false)
        registry.register(harness)
        expect(registry.has("test")).toBe(true)
    })

    it("getAll() returns all registered harnesses", () => {
        const registry = new HarnessRegistry()
        const h1 = makeFakeHarness("harness-a")
        const h2 = makeFakeHarness("harness-b")

        registry.register(h1)
        registry.register(h2)

        const all = registry.getAll()
        expect(all).toHaveLength(2)
        expect(all).toContain(h1)
        expect(all).toContain(h2)
    })

    it("throws on duplicate registration", () => {
        const registry = new HarnessRegistry()
        const h1 = makeFakeHarness("dupe")
        const h2 = makeFakeHarness("dupe")

        registry.register(h1)
        expect(() => registry.register(h2)).toThrow(HarnessError)
        expect(() => registry.register(h2)).toThrow('Harness "dupe" is already registered')
    })

    it("checkAllInstallStatus() calls all harnesses in parallel", async () => {
        const registry = new HarnessRegistry()

        const h1 = makeFakeHarness("a", { installed: true, version: "1.0.0", authenticated: true })
        const h2 = makeFakeHarness("b", { installed: false, authenticated: false })

        // Spy on checkInstallStatus to verify parallel execution
        const spy1 = vi.spyOn(h1, "checkInstallStatus")
        const spy2 = vi.spyOn(h2, "checkInstallStatus")

        registry.register(h1)
        registry.register(h2)

        const results = await registry.checkAllInstallStatus()

        expect(spy1).toHaveBeenCalledOnce()
        expect(spy2).toHaveBeenCalledOnce()

        expect(results.size).toBe(2)

        const statusA = results.get("a")!
        expect(statusA.installed).toBe(true)
        expect(statusA.version).toBe("1.0.0")
        expect(statusA.authenticated).toBe(true)

        const statusB = results.get("b")!
        expect(statusB.installed).toBe(false)
        expect(statusB.authenticated).toBe(false)
    })

    it("checkAllInstallStatus() returns empty map for empty registry", async () => {
        const registry = new HarnessRegistry()
        const results = await registry.checkAllInstallStatus()
        expect(results.size).toBe(0)
    })
})
