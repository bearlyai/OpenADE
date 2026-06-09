import type { OpenADELegacyResourcesImportRequest, OpenADELegacyResourcesImportResult } from "../../../../openade-module/src"

export interface CoreLegacyResourceImportStore {
    importProductLegacyResources(params: OpenADELegacyResourcesImportRequest): Promise<OpenADELegacyResourcesImportResult>
}

export interface CoreLegacyResourceImportSelection {
    store: CoreLegacyResourceImportStore
    selectDataDir: () => Promise<string | null>
    importSessions: boolean
}

export async function importCoreLegacyResourcesFromSelection({
    store,
    selectDataDir,
    importSessions,
}: CoreLegacyResourceImportSelection): Promise<OpenADELegacyResourcesImportResult | null> {
    const dataDir = await selectDataDir()
    if (!dataDir) return null
    return store.importProductLegacyResources({ dataDir, importSessions })
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
