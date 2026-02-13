import { isCodeModuleAvailable } from "./capabilities"

export interface HarnessInstallStatus {
    installed: boolean
    version?: string
    authType: "api-key" | "account" | "none"
    authenticated: boolean
    authInstructions?: string
}

export type HarnessStatusMap = Record<string, HarnessInstallStatus>

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
    return isCodeModuleAvailable() && !!window.openadeAPI?.harness?.checkStatus
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

export async function getHarnessStatuses(): Promise<HarnessStatusResult> {
    if (!window.openadeAPI?.harness?.checkStatus) {
        return {
            statuses: {},
            error: "Harness status is only available in Electron.",
        }
    }

    try {
        const raw = await window.openadeAPI.harness.checkStatus()
        const statuses = normalizeHarnessStatuses(raw)

        if (!isRecord(raw)) {
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
