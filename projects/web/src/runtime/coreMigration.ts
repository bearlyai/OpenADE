import type { OpenADELegacyResourcesImportResult } from "../../../openade-module/src"
import type { OpenADEProductLegacyYjsImportReport } from "../kernel/productStore"
import { localRuntimeClient } from "./localRuntimeClient"

export interface CoreLegacyYjsMigrationAcceptance {
    version: 1
    acceptedAt: string
    source: string
    data?: CoreLegacyYjsMigrationDataSummary
    resources?: CoreLegacyYjsMigrationResourceSummary
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
