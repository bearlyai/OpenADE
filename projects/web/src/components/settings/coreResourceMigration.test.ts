import { describe, expect, it } from "vitest"
import type {
    OpenADELegacyResourcesImportRequest,
    OpenADELegacyResourcesImportResult,
    OpenADELegacyYjsImportResult,
    OpenADETaskHarnessSessionsImportLegacyResult,
    OpenADETaskImagesImportLegacyResult,
    OpenADETaskSnapshotsImportLegacyResult,
} from "../../../../openade-module/src"
import type { OpenADEProductLegacyYjsImportReport } from "../../kernel/productStore"
import {
    coreLegacyResourceImportRequest,
    formatCoreLegacyMigrationAcceptedNotice,
    formatCoreLegacyResourceImportResult,
    importCoreLegacyDataAndResourcesFromSelection,
    importCoreLegacyResourcesFromSelection,
} from "./coreResourceMigration"

function legacyYjsImport(overrides: Partial<OpenADELegacyYjsImportResult> = {}): OpenADELegacyYjsImportResult {
    return {
        scannedRepos: 1,
        importedRepos: 1,
        scannedTasks: 1,
        importedTasks: 1,
        importedSetupEvents: 0,
        importedActionEvents: 0,
        importedActionStreamEvents: 0,
        importedHyperPlanSubExecutions: 0,
        importedSnapshotEvents: 0,
        importedComments: 0,
        importedQueuedTurns: 0,
        skipped: [],
        errors: [],
        ...overrides,
    }
}

function legacyYjsReport(overrides: Partial<OpenADEProductLegacyYjsImportReport> = {}): OpenADEProductLegacyYjsImportReport {
    return {
        imported: legacyYjsImport(),
        parity: { scannedRepos: 1, scannedTasks: 1, mismatches: [] },
        ...overrides,
    }
}

function imagesResult(overrides: Partial<OpenADETaskImagesImportLegacyResult> = {}): OpenADETaskImagesImportLegacyResult {
    return {
        scannedTasks: 3,
        referencedImages: 2,
        importedImages: 1,
        alreadyImportedImages: 1,
        missingImages: [],
        conflictedImages: [],
        failedImages: [],
        ...overrides,
    }
}

function snapshotsResult(overrides: Partial<OpenADETaskSnapshotsImportLegacyResult> = {}): OpenADETaskSnapshotsImportLegacyResult {
    return {
        scannedTasks: 3,
        referencedPatches: 2,
        importedPatches: 1,
        alreadyImportedPatches: 1,
        missingPatches: [],
        conflictedPatches: [],
        failedPatches: [],
        ...overrides,
    }
}

function sessionsResult(overrides: Partial<OpenADETaskHarnessSessionsImportLegacyResult> = {}): OpenADETaskHarnessSessionsImportLegacyResult {
    return {
        scannedTasks: 3,
        referencedSessions: 2,
        importedSessions: 1,
        alreadyImportedSessions: 1,
        missingSessions: [],
        conflictedSessions: [],
        failedSessions: [],
        ...overrides,
    }
}

function resourceResult(overrides: Partial<OpenADELegacyResourcesImportResult> = {}): OpenADELegacyResourcesImportResult {
    return {
        images: imagesResult(),
        snapshots: snapshotsResult(),
        sessions: sessionsResult(),
        skipped: [],
        ...overrides,
    }
}

describe("coreResourceMigration", () => {
    it("formats the accepted migration notice with the required restart handoff", () => {
        expect(formatCoreLegacyMigrationAcceptedNotice()).toBe(
            "Core launch accepted after clean data and resources import; restart OpenADE to use Core on next launch"
        )
    })

    it("builds trimmed legacy resource import requests without empty optional fields", () => {
        expect(
            coreLegacyResourceImportRequest({
                dataDir: " /Users/test/.openade/data ",
                imageDir: " ",
                snapshotDir: null,
                importSessions: false,
                claudeConfigDir: " /Users/test/.claude ",
                codexHome: " /Users/test/.codex ",
            })
        ).toEqual({
            dataDir: "/Users/test/.openade/data",
            claudeConfigDir: "/Users/test/.claude",
            codexHome: "/Users/test/.codex",
        })
    })

    it("rejects no-op legacy resource imports before calling Core", () => {
        expect(() => coreLegacyResourceImportRequest({ dataDir: " ", importSessions: false })).toThrow("Choose legacy resources before importing.")
    })

    it("returns null when the resource directory picker is cancelled", async () => {
        const requests: OpenADELegacyResourcesImportRequest[] = []
        const result = await importCoreLegacyResourcesFromSelection({
            store: {
                importProductLegacyResources: async (request) => {
                    requests.push(request)
                    return resourceResult()
                },
            },
            selectDataDir: async () => null,
            importSessions: true,
        })

        expect(result).toBeNull()
        expect(requests).toEqual([])
    })

    it("imports the selected legacy data directory through the typed product store request", async () => {
        const requests: OpenADELegacyResourcesImportRequest[] = []
        const expected = resourceResult()
        const result = await importCoreLegacyResourcesFromSelection({
            store: {
                importProductLegacyResources: async (request) => {
                    requests.push(request)
                    return expected
                },
            },
            selectDataDir: async () => " /Users/test/.openade/data ",
            importSessions: true,
        })

        expect(result).toBe(expected)
        expect(requests).toEqual([{ dataDir: "/Users/test/.openade/data", importSessions: true }])
    })

    it("imports legacy data and resources in one Core-backed workflow before accepting clean migration evidence", async () => {
        const resourceRequests: OpenADELegacyResourcesImportRequest[] = []
        const accepted: Array<{ data: OpenADEProductLegacyYjsImportReport; resources: OpenADELegacyResourcesImportResult }> = []
        const data = legacyYjsReport()
        const resources = resourceResult()

        const result = await importCoreLegacyDataAndResourcesFromSelection({
            store: {
                importProductLegacyYjsData: async () => data,
                importProductLegacyResources: async (request) => {
                    resourceRequests.push(request)
                    return resources
                },
                markProductLegacyYjsMigrationAccepted: async (acceptedData, acceptedResources) => {
                    accepted.push({ data: acceptedData, resources: acceptedResources })
                },
            },
            selectDataDir: async () => " /Users/test/.openade/data ",
            importSessions: true,
        })

        expect(result).toEqual({ data, resources, accepted: true })
        expect(resourceRequests).toEqual([{ dataDir: "/Users/test/.openade/data", importSessions: true }])
        expect(accepted).toEqual([{ data, resources }])
    })

    it("does not accept the combined migration when either data or resources have issues", async () => {
        const accepted: Array<{ data: OpenADEProductLegacyYjsImportReport; resources: OpenADELegacyResourcesImportResult }> = []
        const data = legacyYjsReport({
            imported: legacyYjsImport({ scannedTasks: 2, importedTasks: 1 }),
        })
        const resources = resourceResult()

        const result = await importCoreLegacyDataAndResourcesFromSelection({
            store: {
                importProductLegacyYjsData: async () => data,
                importProductLegacyResources: async () => resources,
                markProductLegacyYjsMigrationAccepted: async (acceptedData, acceptedResources) => {
                    accepted.push({ data: acceptedData, resources: acceptedResources })
                },
            },
            selectDataDir: async () => "/Users/test/.openade/data",
            importSessions: false,
        })

        expect(result).toEqual({ data, resources, accepted: false })
        expect(accepted).toEqual([])
    })

    it("does not mutate Core when the combined migration resource picker is cancelled or empty", async () => {
        const calls: string[] = []

        await expect(
            importCoreLegacyDataAndResourcesFromSelection({
                store: {
                    importProductLegacyYjsData: async () => {
                        calls.push("data")
                        return legacyYjsReport()
                    },
                    importProductLegacyResources: async () => {
                        calls.push("resources")
                        return resourceResult()
                    },
                    markProductLegacyYjsMigrationAccepted: async () => {
                        calls.push("accept")
                    },
                },
                selectDataDir: async () => null,
                importSessions: true,
            })
        ).resolves.toBeNull()
        expect(calls).toEqual([])

        await expect(
            importCoreLegacyDataAndResourcesFromSelection({
                store: {
                    importProductLegacyYjsData: async () => {
                        calls.push("data")
                        return legacyYjsReport()
                    },
                    importProductLegacyResources: async () => {
                        calls.push("resources")
                        return resourceResult()
                    },
                    markProductLegacyYjsMigrationAccepted: async () => {
                        calls.push("accept")
                    },
                },
                selectDataDir: async () => " ",
                importSessions: true,
            })
        ).rejects.toThrow("Choose legacy resources before importing.")
        expect(calls).toEqual([])
    })

    it("summarizes imported resources and import issues", () => {
        expect(
            formatCoreLegacyResourceImportResult(
                resourceResult({
                    images: imagesResult({
                        missingImages: [{ imageId: "image-missing", ext: "png", code: "source_missing" }],
                        conflictedImages: [{ imageId: "image-conflict", ext: "jpg", code: "content_conflict" }],
                        failedImages: [{ imageId: "image-failed", ext: "png", code: "read_failed" }],
                    }),
                    snapshots: snapshotsResult({
                        missingPatches: [{ patchFileId: "patch-missing", code: "source_missing" }],
                        conflictedPatches: [{ patchFileId: "patch-conflict", code: "content_conflict" }],
                        failedPatches: [{ patchFileId: "patch-failed", code: "read_failed" }],
                    }),
                    sessions: sessionsResult({
                        missingSessions: [{ sessionId: "session-missing", harnessId: "claude-code", code: "source_missing" }],
                        conflictedSessions: [{ sessionId: "session-conflict", harnessId: "codex", code: "content_conflict" }],
                        failedSessions: [{ sessionId: "session-failed", harnessId: "codex", code: "read_failed" }],
                    }),
                    skipped: [{ kind: "images", code: "source_missing" }],
                })
            )
        ).toBe(
            "1 images imported, 1 already present; 1 image missing; 1 image conflict; 1 image failed; 1 snapshot patches imported, 1 already present; 1 snapshot patch missing; 1 snapshot patch conflict; 1 snapshot patch failed; 1 sessions imported, 1 already present; 1 session missing; 1 session conflict; 1 session failed; 1 resource group skipped"
        )
    })
})
