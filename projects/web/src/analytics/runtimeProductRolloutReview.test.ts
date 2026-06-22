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
        runtimeProductStoreHasProjectProjection: true,
        runtimeProductStoreRepoCount: 1,
        runtimeProductStoreTaskPreviewCount: 1,
        runtimeProductStoreCachedTaskCount: 1,
        runtimeProductTransport: "core-websocket",
        coreRolloutStatus: "connected",
        coreRolloutSource: "managed",
        coreRolloutReason: "managed-core",
        coreRolloutAutomatic: true,
        coreLegacyYjsDocumentsPresent: false,
        coreLegacyYjsMigrationAccepted: false,
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

    it("passes project-list-only Core projection telemetry without requiring a full snapshot", () => {
        const result = reviewRuntimeProductRollout(
            parseTelemetryEvents(
                JSON.stringify([
                    {
                        event: "app_opened",
                        properties: {
                            ...readyAppOpened.event_properties,
                            runtimeProductStoreHasSnapshot: false,
                            runtimeProductStoreHasProjectProjection: true,
                            runtimeProductStoreRepoCount: 0,
                            runtimeProductStoreTaskPreviewCount: 0,
                            runtimeProductStoreCachedTaskCount: 0,
                        },
                    },
                ])
            )
        )

        expect(result.passed).toBe(true)
        expect(result.summary.readyDefaultOnAppOpenedEvents).toBe(1)
    })

    it("fails when project projection count telemetry is missing or malformed", () => {
        const result = reviewRuntimeProductRollout(
            parseTelemetryEvents(
                JSON.stringify([
                    {
                        event: "app_opened",
                        properties: {
                            ...readyAppOpened.event_properties,
                            runtimeProductStoreRepoCount: -1,
                            runtimeProductStoreTaskPreviewCount: 1.5,
                            runtimeProductStoreCachedTaskCount: "1",
                        },
                    },
                    {
                        event: "app_opened",
                        properties: {
                            ...readyAppOpened.event_properties,
                            runtimeProductStoreRepoCount: 1,
                            runtimeProductStoreTaskPreviewCount: 1,
                            runtimeProductStoreCachedTaskCount: undefined,
                        },
                    },
                ])
            )
        )

        expect(result.passed).toBe(false)
        expect(result.summary.readyDefaultOnAppOpenedEvents).toBe(0)
        expect(result.failures.map((failure) => failure.code)).toEqual([
            "runtime_product_projection_counts_invalid",
            "runtime_product_projection_counts_invalid",
            "missing_ready_default_on_app_opened",
        ])
        expect(result.failures[0]?.message).toContain("runtimeProductStoreRepoCount")
        expect(result.failures[0]?.message).toContain("runtimeProductStoreTaskPreviewCount")
        expect(result.failures[0]?.message).toContain("runtimeProductStoreCachedTaskCount")
        expect(result.failures[1]?.message).toContain("runtimeProductStoreCachedTaskCount")
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
                            runtimeProductStoreHasProjectProjection: false,
                        },
                    },
                ])
            )
        )

        expect(result.passed).toBe(false)
        expect(result.failures.map((failure) => failure.code)).toEqual([
            "runtime_product_store_not_ready",
            "runtime_product_store_missing_projection",
            "runtime_product_transport_not_core",
            "core_rollout_not_connected",
            "core_rollout_reason_not_product_core",
            "missing_ready_default_on_app_opened",
        ])
    })

    it("fails when app_opened is ready through the legacy Electron product runtime instead of Core", () => {
        const result = reviewRuntimeProductRollout(
            parseTelemetryEvents(
                JSON.stringify([
                    {
                        event: "app_opened",
                        properties: {
                            ...readyAppOpened.event_properties,
                            runtimeProductTransport: "electron-ipc",
                            coreRolloutStatus: "legacy-ipc",
                            coreRolloutSource: "legacy-ipc",
                            coreRolloutReason: "legacy-yjs-documents",
                            coreLegacyYjsDocumentsPresent: true,
                            coreLegacyYjsMigrationAccepted: false,
                        },
                    },
                ])
            )
        )

        expect(result.passed).toBe(false)
        expect(result.failures.map((failure) => failure.code)).toEqual([
            "runtime_product_transport_not_core",
            "core_rollout_not_connected",
            "core_rollout_reason_not_product_core",
            "missing_ready_default_on_app_opened",
        ])
    })

    it("fails when accepted-migration rollout telemetry has inconsistent legacy state", () => {
        const result = reviewRuntimeProductRollout(
            parseTelemetryEvents(
                JSON.stringify([
                    {
                        event: "app_opened",
                        properties: {
                            ...readyAppOpened.event_properties,
                            coreRolloutReason: "legacy-yjs-migration-accepted",
                            coreLegacyYjsDocumentsPresent: false,
                            coreLegacyYjsMigrationAccepted: false,
                        },
                    },
                ])
            )
        )

        expect(result.passed).toBe(false)
        expect(result.failures.map((failure) => failure.code)).toEqual([
            "core_rollout_legacy_state_mismatch",
            "missing_ready_default_on_app_opened",
        ])
    })

    it("passes accepted-migration rollout telemetry when Core is connected through managed source", () => {
        const result = reviewRuntimeProductRollout(
            parseTelemetryEvents(
                JSON.stringify([
                    {
                        event: "app_opened",
                        properties: {
                            ...readyAppOpened.event_properties,
                            coreRolloutReason: "legacy-yjs-migration-accepted",
                            coreLegacyYjsDocumentsPresent: true,
                            coreLegacyYjsMigrationAccepted: true,
                        },
                    },
                ])
            )
        )

        expect(result.passed).toBe(true)
        expect(result.summary.readyDefaultOnAppOpenedEvents).toBe(1)
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
        expect(formatRuntimeProductRolloutReview(reviewRuntimeProductRollout(parseTelemetryEvents(JSON.stringify([readyAppOpened]))))).toContain(
            "Ready Core-backed app_opened events: 1"
        )
    })
})
