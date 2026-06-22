import type { HarnessInstallStatus as SharedHarnessInstallStatus } from "@openade/harness/browser"
import type { RuntimeClientLike } from "../../../openade-client/src"
import { isCodeModuleAvailable } from "./capabilities"
import { localRuntimeClient } from "../runtime/localRuntimeClient"
import { resolveCoreRolloutState, resolveCoreRuntimeEndpoint, selectedLocalProductRuntimeClient } from "../runtime/localProductRuntimeClient"

export type HarnessInstallStatus = SharedHarnessInstallStatus

export type HarnessStatusMap = Record<string, HarnessInstallStatus>
const HARNESS_PROVIDER_STATUS_METHOD = "agent/provider/status"

export interface HarnessStatusResult {
    statuses: HarnessStatusMap
    error: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

function normalizeHarnessStatus(value: unknown): HarnessInstallStatus | null {
    if (!isRecord(value)) return null

    const { installed, version, authType, authenticated, authInstructions } = value

    if (typeof installed !== "boolean") return null
    if (typeof authenticated !== "boolean") return null
    if (authType !== "api-key" && authType !== "account" && authType !== "none") return null
    if (version !== undefined && typeof version !== "string") return null
    if (authInstructions !== undefined && typeof authInstructions !== "string") return null

    return {
        installed,
        version,
        authType,
        authenticated,
        authInstructions,
    }
}

export function isHarnessStatusApiAvailable(): boolean {
    if (resolveCoreRuntimeEndpoint()) return true
    if (coreRolloutRequiresCoreProductRuntime()) return false
    return isCodeModuleAvailable() && !!window.openadeAPI?.runtime
}

export function normalizeHarnessStatuses(raw: unknown): HarnessStatusMap {
    if (!isRecord(raw)) return {}

    const result: HarnessStatusMap = {}
    for (const [harnessId, value] of Object.entries(raw)) {
        const normalized = normalizeHarnessStatus(value)
        if (normalized) {
            result[harnessId] = normalized
        }
    }
    return result
}

function harnessStatusRuntimeClient(): RuntimeClientLike {
    return resolveCoreRuntimeEndpoint() ? selectedLocalProductRuntimeClient() : localRuntimeClient
}

function coreRolloutRequiresCoreProductRuntime(): boolean {
    const rolloutState = resolveCoreRolloutState()
    if (!rolloutState || rolloutState.status !== "connected" || rolloutState.source === "legacy-ipc") return false
    return rolloutState.legacyYjsDocumentsPresent === false || rolloutState.legacyYjsMigrationAccepted === true
}

function unavailableHarnessStatusError(): string {
    if (coreRolloutRequiresCoreProductRuntime()) return "Harness status is unavailable until OpenADE Core is connected."
    return "Harness status is only available in Electron."
}

export async function getHarnessStatuses(runtimeClient: RuntimeClientLike = harnessStatusRuntimeClient()): Promise<HarnessStatusResult> {
    const usesCoreRuntime = resolveCoreRuntimeEndpoint() !== null
    if (!usesCoreRuntime && !isHarnessStatusApiAvailable()) {
        return {
            statuses: {},
            error: unavailableHarnessStatusError(),
        }
    }

    try {
        if (usesCoreRuntime) {
            await runtimeClient.connect()
            if (!runtimeClient.hasMethod(HARNESS_PROVIDER_STATUS_METHOD)) {
                return {
                    statuses: {},
                    error: "Harness status is not advertised by the selected runtime.",
                }
            }
        }

        const raw = await runtimeClient.request(HARNESS_PROVIDER_STATUS_METHOD)
        const rawRecord = isRecord(raw) ? raw : null
        const statusPayload = rawRecord && "status" in rawRecord ? rawRecord.status : raw
        const statuses = normalizeHarnessStatuses(statusPayload)

        if (!isRecord(raw) && !isRecord(statusPayload)) {
            return {
                statuses,
                error: "Received an invalid harness status response.",
            }
        }

        return { statuses, error: null }
    } catch (error) {
        console.error("[HarnessStatusAPI] Failed to get harness statuses:", error)
        return {
            statuses: {},
            error: error instanceof Error ? error.message : "Failed to load harness statuses.",
        }
    }
}
