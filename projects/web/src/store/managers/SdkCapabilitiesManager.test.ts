import { afterEach, describe, expect, it, vi } from "vitest"
import type { SdkCapabilities } from "../../electronAPI/capabilities"
import { resetSdkCapabilitiesManagerCacheForTests, SdkCapabilitiesManager, type SdkCapabilitiesLoader } from "./SdkCapabilitiesManager"

interface Deferred<T> {
    promise: Promise<T>
    resolve(value: T): void
}

function createDeferred<T>(): Deferred<T> {
    let resolveValue: (value: T) => void = () => {
        throw new Error("Deferred resolve called before initialization")
    }
    const promise = new Promise<T>((resolve) => {
        resolveValue = resolve
    })
    return {
        promise,
        resolve: resolveValue,
    }
}

function capabilities(overrides: Partial<SdkCapabilities> = {}): SdkCapabilities {
    return {
        slash_commands: ["/run"],
        skills: ["review"],
        plugins: [{ name: "plugin-a", path: "/repo/plugin-a" }],
        cachedAt: 1_779_811_200_000,
        ...overrides,
    }
}

describe("SdkCapabilitiesManager", () => {
    afterEach(() => {
        resetSdkCapabilitiesManagerCacheForTests()
        vi.useRealTimers()
    })

    it("coalesces concurrent loads for the same loader and cwd across manager instances", async () => {
        const deferred = createDeferred<SdkCapabilities | null>()
        let calls = 0
        const loader: SdkCapabilitiesLoader = async () => {
            calls += 1
            return deferred.promise
        }
        const first = new SdkCapabilitiesManager(loader)
        const second = new SdkCapabilitiesManager(loader)

        const firstLoad = first.loadCapabilities("/repo")
        const secondLoad = second.loadCapabilities("/repo")

        expect(calls).toBe(1)

        deferred.resolve(capabilities())
        await Promise.all([firstLoad, secondLoad])

        expect(first.allCommands).toEqual([
            { name: "review", type: "skill" },
            { name: "/run", type: "slash_command" },
        ])
        expect(second.allCommands).toEqual(first.allCommands)
    })

    it("reuses fresh cached loads without sharing mutable result arrays", async () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date("2026-06-13T12:00:00.000Z"))
        let calls = 0
        const loader: SdkCapabilitiesLoader = async () => {
            calls += 1
            return capabilities()
        }
        const first = new SdkCapabilitiesManager(loader)
        await first.loadCapabilities("/repo")
        first.slashCommands.push("/local-only")

        const second = new SdkCapabilitiesManager(loader)
        await second.loadCapabilities("/repo")

        expect(calls).toBe(1)
        expect(second.slashCommands).toEqual(["/run"])

        await vi.advanceTimersByTimeAsync(60_001)
        const third = new SdkCapabilitiesManager(loader)
        await third.loadCapabilities("/repo")

        expect(calls).toBe(2)
    })

    it("keeps different loader functions isolated", async () => {
        const firstLoader = vi.fn<SdkCapabilitiesLoader>(async () => capabilities({ slash_commands: ["/first"] }))
        const secondLoader = vi.fn<SdkCapabilitiesLoader>(async () => capabilities({ slash_commands: ["/second"] }))
        const first = new SdkCapabilitiesManager(firstLoader)
        const second = new SdkCapabilitiesManager(secondLoader)

        await first.loadCapabilities("/repo")
        await second.loadCapabilities("/repo")

        expect(firstLoader).toHaveBeenCalledTimes(1)
        expect(secondLoader).toHaveBeenCalledTimes(1)
        expect(first.slashCommands).toEqual(["/first"])
        expect(second.slashCommands).toEqual(["/second"])
    })

    it("parses init-message capabilities without trusting malformed entries", () => {
        const manager = new SdkCapabilitiesManager()

        manager.updateFromInitMessage({
            slash_commands: ["/valid", 4, null, "/also-valid"],
            skills: ["review", { name: "invalid" }],
            plugins: [
                { name: "plugin-a", path: "/repo/plugin-a" },
                { name: "missing-path" },
                { name: 3, path: "/repo/plugin-b" },
                "plugin-c",
            ],
        })

        expect(manager.slashCommands).toEqual(["/valid", "/also-valid"])
        expect(manager.skills).toEqual(["review"])
        expect(manager.plugins).toEqual([{ name: "plugin-a", path: "/repo/plugin-a" }])
        expect(manager.allCommands).toEqual([
            { name: "review", type: "skill" },
            { name: "/valid", type: "slash_command" },
            { name: "/also-valid", type: "slash_command" },
        ])
    })
})
