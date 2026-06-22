import type { OpenADELegacyResourcesImportRequest, OpenADELegacyResourcesImportResult } from "../../../../openade-module/src"
import type { OpenADEProductLegacyYjsImportReport } from "../../kernel/productStore"
import { shouldAcceptCoreLegacyYjsMigration } from "../../runtime/coreMigration"

export interface CoreLegacyResourceImportStore {
    importProductLegacyResources(params: OpenADELegacyResourcesImportRequest): Promise<OpenADELegacyResourcesImportResult>
}

export interface CoreLegacyResourceImportRequestInput {
    dataDir?: string | null
    imageDir?: string | null
    snapshotDir?: string | null
    importSessions?: boolean
    claudeConfigDir?: string | null
    codexHome?: string | null
}

export interface CoreLegacyResourceImportSelection {
    store: CoreLegacyResourceImportStore
    selectDataDir: () => Promise<string | null>
    importSessions: boolean
}

export interface CoreLegacyAllImportStore extends CoreLegacyResourceImportStore {
    importProductLegacyYjsData(): Promise<OpenADEProductLegacyYjsImportReport>
    markProductLegacyYjsMigrationAccepted(report: OpenADEProductLegacyYjsImportReport, resources: OpenADELegacyResourcesImportResult): Promise<void>
}

export interface CoreLegacyAllImportSelection {
    store: CoreLegacyAllImportStore
    selectDataDir: () => Promise<string | null>
    importSessions: boolean
}

export interface CoreLegacyAllImportResult {
    data: OpenADEProductLegacyYjsImportReport
    resources: OpenADELegacyResourcesImportResult
    accepted: boolean
}

export function formatCoreLegacyMigrationAcceptedNotice(): string {
    return "Core launch accepted after clean data and resources import; restart OpenADE to use Core on next launch"
}

function nonEmptyOptional(value: string | null | undefined): string | undefined {
    const trimmed = value?.trim()
    return trimmed ? trimmed : undefined
}

export function coreLegacyResourceImportRequest(input: CoreLegacyResourceImportRequestInput): OpenADELegacyResourcesImportRequest {
    const request: OpenADELegacyResourcesImportRequest = {}
    const dataDir = nonEmptyOptional(input.dataDir)
    const imageDir = nonEmptyOptional(input.imageDir)
    const snapshotDir = nonEmptyOptional(input.snapshotDir)
    const claudeConfigDir = nonEmptyOptional(input.claudeConfigDir)
    const codexHome = nonEmptyOptional(input.codexHome)

    if (dataDir) request.dataDir = dataDir
    if (imageDir) request.imageDir = imageDir
    if (snapshotDir) request.snapshotDir = snapshotDir
    if (input.importSessions === true) request.importSessions = true
    if (claudeConfigDir) request.claudeConfigDir = claudeConfigDir
    if (codexHome) request.codexHome = codexHome

    if (!request.dataDir && !request.imageDir && !request.snapshotDir && request.importSessions !== true && !request.claudeConfigDir && !request.codexHome) {
        throw new Error("Choose legacy resources before importing.")
    }

    return request
}

export async function importCoreLegacyResourcesFromSelection({
    store,
    selectDataDir,
    importSessions,
}: CoreLegacyResourceImportSelection): Promise<OpenADELegacyResourcesImportResult | null> {
    const dataDir = await selectDataDir()
    if (!dataDir) return null
    return store.importProductLegacyResources(coreLegacyResourceImportRequest({ dataDir, importSessions }))
}

export async function importCoreLegacyDataAndResourcesFromSelection({
    store,
    selectDataDir,
    importSessions,
}: CoreLegacyAllImportSelection): Promise<CoreLegacyAllImportResult | null> {
    const dataDir = await selectDataDir()
    if (!dataDir) return null
    const selectedDataDir = nonEmptyOptional(dataDir)
    if (!selectedDataDir) throw new Error("Choose legacy resources before importing.")
    const resourcesRequest = coreLegacyResourceImportRequest({ dataDir: selectedDataDir, importSessions })

    const data = await store.importProductLegacyYjsData()
    const resources = await store.importProductLegacyResources(resourcesRequest)
    const accepted = shouldAcceptCoreLegacyYjsMigration(data, resources)
    if (accepted) await store.markProductLegacyYjsMigrationAccepted(data, resources)

    return { data, resources, accepted }
}

export function formatCoreLegacyResourceImportResult(result: OpenADELegacyResourcesImportResult): string {
    const parts: string[] = []
    if (result.images) {
        parts.push(`${result.images.importedImages} images imported, ${result.images.alreadyImportedImages} already present`)
        if (result.images.missingImages.length > 0)
            parts.push(`${result.images.missingImages.length} image${result.images.missingImages.length === 1 ? "" : "s"} missing`)
        if (result.images.conflictedImages.length > 0) {
            parts.push(`${result.images.conflictedImages.length} image conflict${result.images.conflictedImages.length === 1 ? "" : "s"}`)
        }
        if (result.images.failedImages.length > 0)
            parts.push(`${result.images.failedImages.length} image${result.images.failedImages.length === 1 ? "" : "s"} failed`)
    }
    if (result.snapshots) {
        parts.push(`${result.snapshots.importedPatches} snapshot patches imported, ${result.snapshots.alreadyImportedPatches} already present`)
        if (result.snapshots.missingPatches.length > 0) {
            parts.push(`${result.snapshots.missingPatches.length} snapshot patch${result.snapshots.missingPatches.length === 1 ? "" : "es"} missing`)
        }
        if (result.snapshots.conflictedPatches.length > 0) {
            parts.push(`${result.snapshots.conflictedPatches.length} snapshot patch conflict${result.snapshots.conflictedPatches.length === 1 ? "" : "s"}`)
        }
        if (result.snapshots.failedPatches.length > 0) {
            parts.push(`${result.snapshots.failedPatches.length} snapshot patch${result.snapshots.failedPatches.length === 1 ? "" : "es"} failed`)
        }
    }
    if (result.sessions) {
        parts.push(`${result.sessions.importedSessions} sessions imported, ${result.sessions.alreadyImportedSessions} already present`)
        if (result.sessions.missingSessions.length > 0)
            parts.push(`${result.sessions.missingSessions.length} session${result.sessions.missingSessions.length === 1 ? "" : "s"} missing`)
        if (result.sessions.conflictedSessions.length > 0) {
            parts.push(`${result.sessions.conflictedSessions.length} session conflict${result.sessions.conflictedSessions.length === 1 ? "" : "s"}`)
        }
        if (result.sessions.failedSessions.length > 0)
            parts.push(`${result.sessions.failedSessions.length} session${result.sessions.failedSessions.length === 1 ? "" : "s"} failed`)
    }
    if (result.skipped.length > 0) {
        parts.push(`${result.skipped.length} resource group${result.skipped.length === 1 ? "" : "s"} skipped`)
    }
    return parts.length > 0 ? parts.join("; ") : "No legacy resources found"
}
