import { describe, expect, it } from "vitest"
import { formatRuntimeProductRolloutReview, parseTelemetryEvents, reviewRuntimeProductRollout } from "./runtimeProductRolloutReview"

const readyAppOpened = {
    event_type: "app_opened",
    event_properties: {
        deviceIdSource: "device_config_existing",
        deviceConfigWasGenerated: false,
        deviceConfigReadFailed: false,
        runtimeProductStoreEnabled: true,
        runtimeProductStoreStatus: "ready",
        runtimeProductStoreHasSnapshot: true,
    },
}

describe("runtime product rollout review", () => {
    it("passes an Amplitude-style default-on telemetry export with no bridge fallbacks", () => {
        const raw = [readyAppOpened, { event_type: "command_run", event_properties: { commandType: "do" } }].map((event) => JSON.stringify(event)).join("\n")

        const result = reviewRuntimeProductRollout(parseTelemetryEvents(raw))

        expect(result).toEqual({
            passed: true,
            summary: {
                totalEvents: 2,
                appOpenedEvents: 1,
                readyDefaultOnAppOpenedEvents: 1,
                fallbackEvents: 0,
                errorEvents: 0,
                hygieneViolations: 0,
            },
            failures: [],
        })
    })

    it("fails when the cohort contains fallback or bridge error telemetry", () => {
        const result = reviewRuntimeProductRollout(
            parseTelemetryEvents(
                JSON.stringify({
                    events: [
                        readyAppOpened,
                        {
                            event_type: "runtime_product_store_fallback",
                            event_properties: {
                                source: "task_store",
                                reason: "direct_task_store_read",
                                enabled: true,
                                status: "ready",
                                hasSnapshot: true,
                                repoCount: 1,
                                taskPreviewCount: 1,
                                cachedTaskCount: 1,
                            },
                        },
                        {
                            event_type: "runtime_product_store_error",
                            event_properties: {
                                source: "notification",
                                enabled: true,
                                status: "error",
                                hasSnapshot: true,
                                repoCount: 1,
                                taskPreviewCount: 1,
                                cachedTaskCount: 1,
                                errorKind: "Error",
                            },
                        },
                    ],
                })
            )
        )

        expect(result.passed).toBe(false)
        expect(result.summary.fallbackEvents).toBe(1)
        expect(result.summary.errorEvents).toBe(1)
        expect(result.failures.map((failure) => failure.code)).toEqual(["runtime_product_store_fallback", "runtime_product_store_error"])
    })

    it("fails when app_opened does not prove the default runtime product path", () => {
        const result = reviewRuntimeProductRollout(
            parseTelemetryEvents(
                JSON.stringify([
                    {
                        event: "app_opened",
                        properties: {
                            deviceIdSource: "generated",
                            deviceConfigWasGenerated: true,
                            deviceConfigReadFailed: false,
                            runtimeProductStoreEnabled: true,
                            runtimeProductStoreStatus: "loading",
                            runtimeProductStoreHasSnapshot: false,
                        },
                    },
                ])
            )
        )

        expect(result.passed).toBe(false)
        expect(result.failures.map((failure) => failure.code)).toEqual([
            "runtime_product_store_not_ready",
            "runtime_product_store_missing_snapshot",
            "missing_ready_default_on_app_opened",
        ])
    })

    it("rejects stale desktop shared-screen rollout properties", () => {
        const result = reviewRuntimeProductRollout(
            parseTelemetryEvents(
                JSON.stringify([
                    {
                        event: "app_opened",
                        properties: {
                            ...readyAppOpened.event_properties,
                            desktopSharedTaskScreenEnabled: false,
                        },
                    },
                ])
            )
        )

        expect(result.passed).toBe(false)
        expect(result.summary.hygieneViolations).toBe(1)
        expect(result.failures[0]).toMatchObject({
            code: "event_property_hygiene",
            eventName: "app_opened",
        })
        expect(result.failures[0]?.message).toContain("desktopSharedTaskScreenEnabled")
    })

    it("fails rollout event property hygiene when sensitive or unreviewed fields are present", () => {
        const result = reviewRuntimeProductRollout(
            parseTelemetryEvents(
                JSON.stringify([
                    readyAppOpened,
                    {
                        event_type: "runtime_product_store_fallback",
                        event_properties: {
                            source: "task_store",
                            reason: "direct_task_store_read",
                            enabled: true,
                            status: "ready",
                            hasSnapshot: true,
                            repoCount: 1,
                            taskPreviewCount: 1,
                            cachedTaskCount: 1,
                            repoPath: "/Users/person/private-repo",
                            taskTitle: "Sensitive title",
                        },
                    },
                ])
            )
        )

        expect(result.passed).toBe(false)
        expect(result.summary.hygieneViolations).toBe(1)
        expect(result.failures[0]).toMatchObject({
            code: "event_property_hygiene",
            eventName: "runtime_product_store_fallback",
        })
        expect(result.failures[0]?.message).toContain("repoPath")
        expect(result.failures[0]?.message).toContain("taskTitle")
    })

    it("reports malformed telemetry exports with the source line", () => {
        expect(() => parseTelemetryEvents(`${JSON.stringify(readyAppOpened)}\nnot-json`)).toThrow("Invalid telemetry JSON on line 2")
    })

    it("formats a compact review report for the rollout runbook", () => {
        const result = reviewRuntimeProductRollout([])

        expect(formatRuntimeProductRolloutReview(result)).toContain("Runtime product rollout review: FAIL")
        expect(formatRuntimeProductRolloutReview(result)).toContain("[missing_app_opened]")
    })
})
