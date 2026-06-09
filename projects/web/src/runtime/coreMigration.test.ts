import { afterEach, describe, expect, it } from "vitest"
import type { OpenADELegacyResourcesImportResult, OpenADELegacyYjsImportResult } from "../../../openade-module/src"
import type { OpenADEProductLegacyYjsImportReport } from "../kernel/productStore"
import {
    coreLegacyYjsMigrationAcceptRequest,
    coreLegacyResourceImportIssueCount,
    isCoreLegacyResourceImportClean,
    isCoreLegacyYjsImportClean,
    markCoreLegacyYjsMigrationAccepted,
    shouldAcceptCoreLegacyYjsMigration,
} from "./coreMigration"
import { localRuntimeClient } from "./localRuntimeClient"

function stubOpenADEAPI(openadeAPI: unknown): void {
    Object.defineProperty(window, "openadeAPI", {
        value: openadeAPI,
        configurable: true,
        writable: true,
    })
}

function importResult(overrides: Partial<OpenADELegacyYjsImportResult> = {}): OpenADELegacyYjsImportResult {
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

function importReport(overrides: Partial<OpenADEProductLegacyYjsImportReport> = {}): OpenADEProductLegacyYjsImportReport {
    return {
        imported: importResult(),
        parity: { scannedRepos: 1, scannedTasks: 1, mismatches: [] },
        ...overrides,
    }
}

function resourceResult(overrides: Partial<OpenADELegacyResourcesImportResult> = {}): OpenADELegacyResourcesImportResult {
    return {
        images: {
            scannedTasks: 1,
            referencedImages: 1,
            importedImages: 1,
            alreadyImportedImages: 0,
            missingImages: [],
            conflictedImages: [],
            failedImages: [],
        },
        snapshots: {
            scannedTasks: 1,
            referencedPatches: 1,
            importedPatches: 1,
            alreadyImportedPatches: 0,
            missingPatches: [],
            conflictedPatches: [],
            failedPatches: [],
        },
        sessions: {
            scannedTasks: 1,
            referencedSessions: 1,
            importedSessions: 1,
            alreadyImportedSessions: 0,
            missingSessions: [],
            conflictedSessions: [],
            failedSessions: [],
        },
        skipped: [],
        ...overrides,
    }
}

describe("Core migration runtime helpers", () => {
    afterEach(async () => {
        await localRuntimeClient.close().catch(() => undefined)
        window.openadeAPI = undefined
    })

    it("marks legacy Yjs import reports clean only when import and parity have no issues", () => {
        expect(isCoreLegacyYjsImportClean(importReport())).toBe(true)
        expect(
            isCoreLegacyYjsImportClean(
                importReport({
                    imported: importResult({ skipped: [{ code: "unsupported_event_type", taskId: "task-1" }] }),
                })
            )
        ).toBe(false)
        expect(
            isCoreLegacyYjsImportClean(
                importReport({
                    imported: importResult({ errors: [{ scope: "task", taskId: "task-1", code: "failed", message: "failed" }] }),
                })
            )
        ).toBe(false)
        expect(
            isCoreLegacyYjsImportClean(
                importReport({
                    parity: {
                        scannedRepos: 1,
                        scannedTasks: 1,
                        mismatches: [{ scope: "task", repoId: "repo-1", taskId: "task-1", field: "title", legacy: "Old", core: "New" }],
                    },
                })
            )
        ).toBe(false)
    })

    it("counts legacy resource import issues across every imported resource kind", () => {
        expect(coreLegacyResourceImportIssueCount(resourceResult())).toBe(0)
        expect(isCoreLegacyResourceImportClean(resourceResult())).toBe(true)
        const issues = resourceResult({
            images: {
                scannedTasks: 1,
                referencedImages: 3,
                importedImages: 0,
                alreadyImportedImages: 0,
                missingImages: [{ imageId: "image-1", ext: "png", code: "missing" }],
                conflictedImages: [{ imageId: "image-2", ext: "png", code: "conflict" }],
                failedImages: [{ imageId: "image-3", ext: "png", code: "read_failed" }],
            },
            snapshots: {
                scannedTasks: 1,
                referencedPatches: 2,
                importedPatches: 0,
                alreadyImportedPatches: 0,
                missingPatches: [{ patchFileId: "patch-1", code: "missing" }],
                conflictedPatches: [],
                failedPatches: [{ patchFileId: "patch-2", code: "read_failed" }],
            },
            sessions: {
                scannedTasks: 1,
                referencedSessions: 1,
                importedSessions: 0,
                alreadyImportedSessions: 0,
                missingSessions: [{ sessionId: "session-1", harnessId: "claude-code", code: "missing" }],
                conflictedSessions: [],
                failedSessions: [],
            },
            skipped: [{ kind: "images", code: "source_missing" }],
        })
        expect(coreLegacyResourceImportIssueCount(issues)).toBe(7)
        expect(isCoreLegacyResourceImportClean(issues)).toBe(false)
    })

    it("accepts Core launch only after clean Yjs and resource imports", () => {
        expect(shouldAcceptCoreLegacyYjsMigration(importReport(), resourceResult())).toBe(true)
        expect(
            shouldAcceptCoreLegacyYjsMigration(
                importReport({
                    imported: importResult({ errors: [{ scope: "repo", repoId: "repo-1", code: "failed", message: "failed" }] }),
                }),
                resourceResult()
            )
        ).toBe(false)
        expect(shouldAcceptCoreLegacyYjsMigration(importReport(), resourceResult({ skipped: [{ kind: "snapshots", code: "source_missing" }] }))).toBe(false)
    })

    it("builds a sanitized acceptance summary from clean import reports", () => {
        expect(coreLegacyYjsMigrationAcceptRequest(importReport(), resourceResult())).toEqual({
            data: {
                scannedRepos: 1,
                importedRepos: 1,
                scannedTasks: 1,
                importedTasks: 1,
                skipped: 0,
                errors: 0,
                parityMismatches: 0,
            },
            resources: {
                skipped: 0,
                issues: 0,
                images: {
                    scannedTasks: 1,
                    referenced: 1,
                    imported: 1,
                    alreadyImported: 0,
                    missing: 0,
                    conflicted: 0,
                    failed: 0,
                },
                snapshots: {
                    scannedTasks: 1,
                    referenced: 1,
                    imported: 1,
                    alreadyImported: 0,
                    missing: 0,
                    conflicted: 0,
                    failed: 0,
                },
                sessions: {
                    scannedTasks: 1,
                    referenced: 1,
                    imported: 1,
                    alreadyImported: 0,
                    missing: 0,
                    conflicted: 0,
                    failed: 0,
                },
            },
        })
    })

    it("marks legacy Yjs migration acceptance through the trusted local runtime", async () => {
        const calls: Array<{ method: string; params: unknown }> = []
        stubOpenADEAPI({
            runtime: {
                connect: () => Promise.resolve({ ok: true }),
                disconnect: () => Promise.resolve({ ok: true }),
                onMessage: () => () => undefined,
                request(request: unknown) {
                    const record = request as { method: string; params?: unknown }
                    calls.push({ method: record.method, params: record.params })
                    if (record.method === "initialize") {
                        return Promise.resolve({ id: record.method, result: { protocolVersion: 1, serverName: "test-runtime" } })
                    }
                    return Promise.resolve({
                        id: record.method,
                        result: {
                            version: 1,
                            acceptedAt: "2026-06-09T12:00:00.000Z",
                            source: "desktop-settings-legacy-yjs-import",
                            data: coreLegacyYjsMigrationAcceptRequest(importReport(), resourceResult()).data,
                            resources: coreLegacyYjsMigrationAcceptRequest(importReport(), resourceResult()).resources,
                        },
                    })
                },
            },
        })

        await expect(markCoreLegacyYjsMigrationAccepted(importReport(), resourceResult())).resolves.toEqual({
            version: 1,
            acceptedAt: "2026-06-09T12:00:00.000Z",
            source: "desktop-settings-legacy-yjs-import",
            data: coreLegacyYjsMigrationAcceptRequest(importReport(), resourceResult()).data,
            resources: coreLegacyYjsMigrationAcceptRequest(importReport(), resourceResult()).resources,
        })
        expect(calls).toEqual([
            {
                method: "initialize",
                params: {
                    clientName: "OpenADE Desktop",
                    clientPlatform: "desktop",
                    protocolVersion: 1,
                },
            },
            { method: "host/core/legacyYjsMigration/accept", params: coreLegacyYjsMigrationAcceptRequest(importReport(), resourceResult()) },
        ])
    })

    it("rejects malformed marker responses from the trusted local runtime", async () => {
        stubOpenADEAPI({
            runtime: {
                connect: () => Promise.resolve({ ok: true }),
                disconnect: () => Promise.resolve({ ok: true }),
                onMessage: () => () => undefined,
                request: (request: unknown) => {
                    const record = request as { method: string }
                    if (record.method === "initialize") {
                        return Promise.resolve({ id: record.method, result: { protocolVersion: 1, serverName: "test-runtime" } })
                    }
                    return Promise.resolve({ id: record.method, result: { ok: true } })
                },
            },
        })

        await expect(markCoreLegacyYjsMigrationAccepted(importReport(), resourceResult())).rejects.toThrow(
            "Core legacy Yjs migration marker response is invalid."
        )
    })
})
