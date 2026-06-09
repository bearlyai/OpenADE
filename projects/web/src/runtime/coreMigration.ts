import type { OpenADELegacyResourcesImportResult } from "../../../openade-module/src"
import type { OpenADEProductLegacyYjsImportReport } from "../kernel/productStore"
import { localRuntimeClient } from "./localRuntimeClient"

export interface CoreLegacyYjsMigrationAcceptance {
    version: 1
    acceptedAt: string
    source: string
}

function isCoreLegacyYjsMigrationAcceptance(value: unknown): value is CoreLegacyYjsMigrationAcceptance {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false
    const record = value as Record<string, unknown>
    return (
        record.version === 1 &&
        typeof record.acceptedAt === "string" &&
        record.acceptedAt.length > 0 &&
        typeof record.source === "string" &&
        record.source.length > 0
    )
}

export function isCoreLegacyYjsImportClean(report: OpenADEProductLegacyYjsImportReport): boolean {
    return report.imported.errors.length === 0 && report.imported.skipped.length === 0 && report.parity.mismatches.length === 0
}

export function coreLegacyResourceImportIssueCount(result: OpenADELegacyResourcesImportResult): number {
    return (
        result.skipped.length +
        (result.images?.missingImages.length ?? 0) +
        (result.images?.conflictedImages.length ?? 0) +
        (result.images?.failedImages.length ?? 0) +
        (result.snapshots?.missingPatches.length ?? 0) +
        (result.snapshots?.conflictedPatches.length ?? 0) +
        (result.snapshots?.failedPatches.length ?? 0) +
        (result.sessions?.missingSessions.length ?? 0) +
        (result.sessions?.conflictedSessions.length ?? 0) +
        (result.sessions?.failedSessions.length ?? 0)
    )
}

export function isCoreLegacyResourceImportClean(result: OpenADELegacyResourcesImportResult): boolean {
    return coreLegacyResourceImportIssueCount(result) === 0
}

export function shouldAcceptCoreLegacyYjsMigration(report: OpenADEProductLegacyYjsImportReport, resources: OpenADELegacyResourcesImportResult): boolean {
    return isCoreLegacyYjsImportClean(report) && isCoreLegacyResourceImportClean(resources)
}

export async function markCoreLegacyYjsMigrationAccepted(): Promise<CoreLegacyYjsMigrationAcceptance> {
    const result = await localRuntimeClient.request<unknown>("host/core/legacyYjsMigration/accept", {})
    if (!isCoreLegacyYjsMigrationAcceptance(result)) throw new Error("Core legacy Yjs migration marker response is invalid.")
    return result
}
