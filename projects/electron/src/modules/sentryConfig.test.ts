import { describe, expect, it } from "vitest"
import { filterMainProcessSentryIntegrations, shouldDisableNativeCrashReporter } from "./sentryConfig"

describe("shouldDisableNativeCrashReporter", () => {
    it("disables Electron native crash reporting only on Linux", () => {
        expect(shouldDisableNativeCrashReporter("linux")).toBe(true)
        expect(shouldDisableNativeCrashReporter("darwin")).toBe(false)
        expect(shouldDisableNativeCrashReporter("win32")).toBe(false)
    })
})

describe("filterMainProcessSentryIntegrations", () => {
    const integrations = [
        { name: "SentryMinidump" },
        { name: "ElectronBreadcrumbs" },
        { name: "ElectronMinidump" },
        { name: "OnUncaughtException" },
    ]

    it("removes native minidump integrations on Linux", () => {
        expect(filterMainProcessSentryIntegrations(integrations, "linux")).toEqual([{ name: "ElectronBreadcrumbs" }, { name: "OnUncaughtException" }])
    })

    it("keeps default integrations on non-Linux platforms", () => {
        expect(filterMainProcessSentryIntegrations(integrations, "darwin")).toBe(integrations)
    })
})
