import type { OpenADELegacyResourcesImportResult } from "../../../openade-module/src"
import type { OpenADEProductLegacyYjsImportReport } from "../kernel/productStore"
import { localRuntimeClient } from "./localRuntimeClient"

export interface CoreLegacyYjsMigrationAcceptance {
    version: 1
    acceptedAt: string
    source: string
    data: CoreLegacyYjsMigrationDataSummary
    resources: CoreLegacyYjsMigrationResourceSummary
}

export interface CoreLegacyYjsMigrationDataSummary {
    scannedRepos: number
    importedRepos: number
    scannedTasks: number
    importedTasks: number
    skipped: number
    errors: number
    parityMismatches: number
}

export interface CoreLegacyYjsMigrationResourceKindSummary {
    scannedTasks: number
    referenced: number
    imported: number
    alreadyImported: number
    missing: number
    conflicted: number
    failed: number
}

export interface CoreLegacyYjsMigrationResourceSummary {
    skipped: number
    issues: number
    images?: CoreLegacyYjsMigrationResourceKindSummary
    snapshots?: CoreLegacyYjsMigrationResourceKindSummary
    sessions?: CoreLegacyYjsMigrationResourceKindSummary
}

export interface CoreLegacyYjsMigrationAcceptRequest {
    data: CoreLegacyYjsMigrationDataSummary
    resources: CoreLegacyYjsMigrationResourceSummary
}

export interface CoreLegacyYjsMigrationRevokeResult {
    revoked: boolean
    requiresRestart: true
}

function isCoreLegacyYjsMigrationAcceptance(value: unknown): value is CoreLegacyYjsMigrationAcceptance {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false
    const record = value as Record<string, unknown>
    return (
        record.version === 1 &&
        typeof record.acceptedAt === "string" &&
        record.acceptedAt.length > 0 &&
        typeof record.source === "string" &&
        record.source.length > 0 &&
        isCoreLegacyYjsMigrationCleanDataSummary(record.data) &&
        isCoreLegacyYjsMigrationCleanResourceSummary(record.resources)
    )
}

function isCoreLegacyYjsMigrationRevokeResult(value: unknown): value is CoreLegacyYjsMigrationRevokeResult {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false
    const record = value as Record<string, unknown>
    return typeof record.revoked === "boolean" && record.requiresRestart === true
}

function isCoreLegacyYjsMigrationCleanDataSummary(value: unknown): value is CoreLegacyYjsMigrationDataSummary {
    if (!isCoreLegacyYjsMigrationDataSummary(value)) return false
    return (
        value.skipped === 0 &&
        value.errors === 0 &&
        value.parityMismatches === 0 &&
        value.importedRepos === value.scannedRepos &&
        value.importedTasks === value.scannedTasks
    )
}

function nonNegativeInteger(value: unknown): value is number {
    return typeof value === "number" && Number.isInteger(value) && value >= 0
}

function isCoreLegacyYjsMigrationDataSummary(value: unknown): value is CoreLegacyYjsMigrationDataSummary {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false
    const record = value as Record<string, unknown>
    return (
        nonNegativeInteger(record.scannedRepos) &&
        nonNegativeInteger(record.importedRepos) &&
        nonNegativeInteger(record.scannedTasks) &&
        nonNegativeInteger(record.importedTasks) &&
        nonNegativeInteger(record.skipped) &&
        nonNegativeInteger(record.errors) &&
        nonNegativeInteger(record.parityMismatches)
    )
}

function isCoreLegacyYjsMigrationResourceKindSummary(value: unknown): value is CoreLegacyYjsMigrationResourceKindSummary {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false
    const record = value as Record<string, unknown>
    return (
        nonNegativeInteger(record.scannedTasks) &&
        nonNegativeInteger(record.referenced) &&
        nonNegativeInteger(record.imported) &&
        nonNegativeInteger(record.alreadyImported) &&
        nonNegativeInteger(record.missing) &&
        nonNegativeInteger(record.conflicted) &&
        nonNegativeInteger(record.failed)
    )
}

function isCoreLegacyYjsMigrationResourceSummary(value: unknown): value is CoreLegacyYjsMigrationResourceSummary {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false
    const record = value as Record<string, unknown>
    return (
        nonNegativeInteger(record.skipped) &&
        nonNegativeInteger(record.issues) &&
        (record.images === undefined || isCoreLegacyYjsMigrationResourceKindSummary(record.images)) &&
        (record.snapshots === undefined || isCoreLegacyYjsMigrationResourceKindSummary(record.snapshots)) &&
        (record.sessions === undefined || isCoreLegacyYjsMigrationResourceKindSummary(record.sessions))
    )
}

function isCoreLegacyYjsMigrationResourceKindComplete(value: CoreLegacyYjsMigrationResourceKindSummary | undefined): boolean {
    if (value === undefined) return true
    return value.imported + value.alreadyImported + value.missing + value.conflicted + value.failed === value.referenced
}

function isCoreLegacyYjsMigrationCleanResourceSummary(value: unknown): value is CoreLegacyYjsMigrationResourceSummary {
    if (!isCoreLegacyYjsMigrationResourceSummary(value)) return false
    return (
        value.skipped === 0 &&
        value.issues === 0 &&
        value.images !== undefined &&
        value.snapshots !== undefined &&
        value.sessions !== undefined &&
        isCoreLegacyYjsMigrationResourceKindComplete(value.images) &&
        isCoreLegacyYjsMigrationResourceKindComplete(value.snapshots) &&
        isCoreLegacyYjsMigrationResourceKindComplete(value.sessions)
    )
}

export function isCoreLegacyYjsImportClean(report: OpenADEProductLegacyYjsImportReport): boolean {
    return (
        report.imported.errors.length === 0 &&
        report.imported.skipped.length === 0 &&
        report.parity.mismatches.length === 0 &&
        report.imported.importedRepos === report.imported.scannedRepos &&
        report.imported.importedTasks === report.imported.scannedTasks &&
        report.parity.scannedRepos === report.imported.scannedRepos &&
        report.parity.scannedTasks === report.imported.scannedTasks
    )
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
    return (
        coreLegacyResourceImportIssueCount(result) === 0 &&
        result.images !== null &&
        result.snapshots !== null &&
        result.sessions !== null &&
        isCoreLegacyResourceKindComplete(
            result.images?.referencedImages,
            result.images?.importedImages,
            result.images?.alreadyImportedImages,
            result.images?.missingImages.length,
            result.images?.conflictedImages.length,
            result.images?.failedImages.length
        ) &&
        isCoreLegacyResourceKindComplete(
            result.snapshots?.referencedPatches,
            result.snapshots?.importedPatches,
            result.snapshots?.alreadyImportedPatches,
            result.snapshots?.missingPatches.length,
            result.snapshots?.conflictedPatches.length,
            result.snapshots?.failedPatches.length
        ) &&
        isCoreLegacyResourceKindComplete(
            result.sessions?.referencedSessions,
            result.sessions?.importedSessions,
            result.sessions?.alreadyImportedSessions,
            result.sessions?.missingSessions.length,
            result.sessions?.conflictedSessions.length,
            result.sessions?.failedSessions.length
        )
    )
}

function isCoreLegacyResourceKindComplete(
    referenced: number | undefined,
    imported: number | undefined,
    alreadyImported: number | undefined,
    missing: number | undefined,
    conflicted: number | undefined,
    failed: number | undefined
): boolean {
    if (referenced === undefined) return true
    return (imported ?? 0) + (alreadyImported ?? 0) + (missing ?? 0) + (conflicted ?? 0) + (failed ?? 0) === referenced
}

export function shouldAcceptCoreLegacyYjsMigration(report: OpenADEProductLegacyYjsImportReport, resources: OpenADELegacyResourcesImportResult): boolean {
    return isCoreLegacyYjsImportClean(report) && isCoreLegacyResourceImportClean(resources)
}

export function coreLegacyYjsMigrationAcceptRequest(
    report: OpenADEProductLegacyYjsImportReport,
    resources: OpenADELegacyResourcesImportResult
): CoreLegacyYjsMigrationAcceptRequest {
    return {
        data: {
            scannedRepos: report.imported.scannedRepos,
            importedRepos: report.imported.importedRepos,
            scannedTasks: report.imported.scannedTasks,
            importedTasks: report.imported.importedTasks,
            skipped: report.imported.skipped.length,
            errors: report.imported.errors.length,
            parityMismatches: report.parity.mismatches.length,
        },
        resources: {
            skipped: resources.skipped.length,
            issues: coreLegacyResourceImportIssueCount(resources),
            images: resources.images
                ? {
                      scannedTasks: resources.images.scannedTasks,
                      referenced: resources.images.referencedImages,
                      imported: resources.images.importedImages,
                      alreadyImported: resources.images.alreadyImportedImages,
                      missing: resources.images.missingImages.length,
                      conflicted: resources.images.conflictedImages.length,
                      failed: resources.images.failedImages.length,
                  }
                : undefined,
            snapshots: resources.snapshots
                ? {
                      scannedTasks: resources.snapshots.scannedTasks,
                      referenced: resources.snapshots.referencedPatches,
                      imported: resources.snapshots.importedPatches,
                      alreadyImported: resources.snapshots.alreadyImportedPatches,
                      missing: resources.snapshots.missingPatches.length,
                      conflicted: resources.snapshots.conflictedPatches.length,
                      failed: resources.snapshots.failedPatches.length,
                  }
                : undefined,
            sessions: resources.sessions
                ? {
                      scannedTasks: resources.sessions.scannedTasks,
                      referenced: resources.sessions.referencedSessions,
                      imported: resources.sessions.importedSessions,
                      alreadyImported: resources.sessions.alreadyImportedSessions,
                      missing: resources.sessions.missingSessions.length,
                      conflicted: resources.sessions.conflictedSessions.length,
                      failed: resources.sessions.failedSessions.length,
                  }
                : undefined,
        },
    }
}

export async function markCoreLegacyYjsMigrationAccepted(
    report: OpenADEProductLegacyYjsImportReport,
    resources: OpenADELegacyResourcesImportResult
): Promise<CoreLegacyYjsMigrationAcceptance> {
    const result = await localRuntimeClient.request<unknown>("host/core/legacyYjsMigration/accept", coreLegacyYjsMigrationAcceptRequest(report, resources))
    if (!isCoreLegacyYjsMigrationAcceptance(result)) throw new Error("Core legacy Yjs migration marker response is invalid.")
    return result
}

export async function revokeCoreLegacyYjsMigrationAcceptance(): Promise<CoreLegacyYjsMigrationRevokeResult> {
    const result = await localRuntimeClient.request<unknown>("host/core/legacyYjsMigration/revoke")
    if (!isCoreLegacyYjsMigrationRevokeResult(result)) throw new Error("Core legacy Yjs migration rollback response is invalid.")
    return result
}
