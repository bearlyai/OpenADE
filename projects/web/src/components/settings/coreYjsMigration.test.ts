import { describe, expect, it } from "vitest"
import type { OpenADELegacyYjsImportResult } from "../../../../openade-module/src"
import { type CoreLegacyYjsImportReport, formatCoreLegacyYjsImportResult, importCoreLegacyYjsDataFromLocalStore } from "./coreYjsMigration"

function importResult(overrides: Partial<OpenADELegacyYjsImportResult> = {}): OpenADELegacyYjsImportResult {
    return {
        scannedRepos: 2,
        importedRepos: 2,
        scannedTasks: 3,
        importedTasks: 3,
        importedSetupEvents: 1,
        importedActionEvents: 2,
        importedActionStreamEvents: 4,
        importedHyperPlanSubExecutions: 1,
        importedSnapshotEvents: 1,
        importedComments: 2,
        importedQueuedTurns: 1,
        skipped: [],
        errors: [],
        ...overrides,
    }
}

function importReport(overrides: Partial<CoreLegacyYjsImportReport> = {}): CoreLegacyYjsImportReport {
    return {
        imported: importResult(),
        parity: { scannedRepos: 2, scannedTasks: 3, mismatches: [] },
        ...overrides,
    }
}

describe("coreYjsMigration", () => {
    it("runs the store legacy Yjs import action", async () => {
        const report = importReport()
        await expect(importCoreLegacyYjsDataFromLocalStore({ importProductLegacyYjsData: async () => report })).resolves.toBe(report)
    })

    it("summarizes imported legacy Yjs data with successful parity", () => {
        expect(formatCoreLegacyYjsImportResult(importReport())).toBe(
            "2/2 repos imported; 3/3 tasks imported; 9 task records imported; 2 comments imported; 1 queued turns imported; parity verified for 3 tasks"
        )
    })

    it("includes next-launch acceptance after a clean Core-connected import", () => {
        expect(formatCoreLegacyYjsImportResult(importReport({ legacyYjsMigrationAccepted: true }))).toBe(
            "2/2 repos imported; 3/3 tasks imported; 9 task records imported; 2 comments imported; 1 queued turns imported; parity verified for 3 tasks; Core launch accepted for this legacy Yjs data"
        )
    })

    it("summarizes imported legacy Yjs data with skips, errors, and parity mismatches", () => {
        expect(
            formatCoreLegacyYjsImportResult(
                importReport({
                    imported: importResult({
                        skipped: [{ taskId: "task-1", code: "unsupported_event_type" }],
                        errors: [{ scope: "task", taskId: "task-2", code: "failed", message: "failed" }],
                    }),
                    parity: {
                        scannedRepos: 2,
                        scannedTasks: 3,
                        mismatches: [{ scope: "task", repoId: "repo-1", taskId: "task-1", field: "title", legacy: "Legacy", core: "Core" }],
                    },
                })
            )
        ).toBe(
            "2/2 repos imported; 3/3 tasks imported; 9 task records imported; 2 comments imported; 1 queued turns imported; 1 skipped; 1 errors; 1 parity mismatch"
        )
    })
})
