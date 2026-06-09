import type { OpenADELegacyYjsCoreParityReport, OpenADELegacyYjsImportResult } from "../../../../openade-module/src"

export interface CoreLegacyYjsImportReport {
    imported: OpenADELegacyYjsImportResult
    parity: OpenADELegacyYjsCoreParityReport
    legacyYjsMigrationAccepted?: boolean
}

export interface CoreLegacyYjsImportStore {
    importProductLegacyYjsData(): Promise<CoreLegacyYjsImportReport>
}

export async function importCoreLegacyYjsDataFromLocalStore(store: CoreLegacyYjsImportStore): Promise<CoreLegacyYjsImportReport> {
    return store.importProductLegacyYjsData()
}

export function formatCoreLegacyYjsImportResult(report: CoreLegacyYjsImportReport): string {
    const { imported, parity } = report
    const parts = [`${imported.importedRepos}/${imported.scannedRepos} repos imported`, `${imported.importedTasks}/${imported.scannedTasks} tasks imported`]

    const eventCount =
        imported.importedSetupEvents +
        imported.importedActionEvents +
        imported.importedActionStreamEvents +
        imported.importedHyperPlanSubExecutions +
        imported.importedSnapshotEvents
    if (eventCount > 0) parts.push(`${eventCount} task records imported`)
    if (imported.importedComments > 0) parts.push(`${imported.importedComments} comments imported`)
    if (imported.importedQueuedTurns > 0) parts.push(`${imported.importedQueuedTurns} queued turns imported`)
    if (imported.skipped.length > 0) parts.push(`${imported.skipped.length} skipped`)
    if (imported.errors.length > 0) parts.push(`${imported.errors.length} errors`)
    if (parity.mismatches.length === 0) {
        parts.push(`parity verified for ${parity.scannedTasks} tasks`)
    } else {
        parts.push(`${parity.mismatches.length} parity mismatch${parity.mismatches.length === 1 ? "" : "es"}`)
    }
    if (report.legacyYjsMigrationAccepted) parts.push("Core launch accepted for this legacy Yjs data")

    return parts.join("; ")
}
