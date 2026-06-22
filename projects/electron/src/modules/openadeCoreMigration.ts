import fs from "node:fs"
import { randomUUID } from "node:crypto"
import os from "node:os"
import path from "node:path"

const OPENADE_DIR = ".openade"
const DATA_DIR = "data"
const CORE_DIR = "core"
const LEGACY_YJS_ACCEPTANCE_FILE = "legacy-yjs-import-accepted.json"

export interface OpenADECoreLegacyYjsMigrationAcceptance {
    version: 1
    acceptedAt: string
    source: string
    data: OpenADECoreLegacyYjsMigrationDataSummary
    resources: OpenADECoreLegacyYjsMigrationResourceSummary
}

export interface OpenADECoreLegacyYjsMigrationDataSummary {
    scannedRepos: number
    importedRepos: number
    scannedTasks: number
    importedTasks: number
    skipped: number
    errors: number
    parityMismatches: number
}

export interface OpenADECoreLegacyYjsMigrationResourceKindSummary {
    scannedTasks: number
    referenced: number
    imported: number
    alreadyImported: number
    missing: number
    conflicted: number
    failed: number
}

export interface OpenADECoreLegacyYjsMigrationResourceSummary {
    skipped: number
    issues: number
    images?: OpenADECoreLegacyYjsMigrationResourceKindSummary
    snapshots?: OpenADECoreLegacyYjsMigrationResourceKindSummary
    sessions?: OpenADECoreLegacyYjsMigrationResourceKindSummary
}

export interface OpenADECoreLegacyYjsMigrationAcceptRequest {
    data: OpenADECoreLegacyYjsMigrationDataSummary
    resources: OpenADECoreLegacyYjsMigrationResourceSummary
}

export interface OpenADECoreLegacyYjsMigrationRevokeResult {
    revoked: boolean
    requiresRestart: true
}

export function legacyYjsMigrationAcceptanceFilePath(homeDir: string = os.homedir()): string {
    return path.join(homeDir, OPENADE_DIR, DATA_DIR, CORE_DIR, LEGACY_YJS_ACCEPTANCE_FILE)
}

function isLegacyYjsMigrationAcceptance(value: unknown): value is OpenADECoreLegacyYjsMigrationAcceptance {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false
    const record = value as Record<string, unknown>
    if (record.version !== 1 || typeof record.acceptedAt !== "string" || record.acceptedAt.length === 0) return false
    if (typeof record.source !== "string" || record.source.length === 0) return false
    try {
        migrationDataSummaryParam(record.data)
        migrationResourceSummaryParam(record.resources)
        return true
    } catch {
        return false
    }
}

function objectRecord(value: unknown, label: string): Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error(`${label} is invalid`)
    }
    return value as Record<string, unknown>
}

function nonNegativeIntegerParam(record: Record<string, unknown>, key: string, label: string = key): number {
    const value = record[key]
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
        throw new Error(`${label} is invalid`)
    }
    return value
}

function migrationDataSummaryParam(value: unknown): OpenADECoreLegacyYjsMigrationDataSummary {
    const record = objectRecord(value, "data")
    const summary = {
        scannedRepos: nonNegativeIntegerParam(record, "scannedRepos", "data.scannedRepos"),
        importedRepos: nonNegativeIntegerParam(record, "importedRepos", "data.importedRepos"),
        scannedTasks: nonNegativeIntegerParam(record, "scannedTasks", "data.scannedTasks"),
        importedTasks: nonNegativeIntegerParam(record, "importedTasks", "data.importedTasks"),
        skipped: nonNegativeIntegerParam(record, "skipped", "data.skipped"),
        errors: nonNegativeIntegerParam(record, "errors", "data.errors"),
        parityMismatches: nonNegativeIntegerParam(record, "parityMismatches", "data.parityMismatches"),
    }
    if (summary.skipped !== 0 || summary.errors !== 0 || summary.parityMismatches !== 0) {
        throw new Error("legacy Yjs import summary is not clean")
    }
    if (summary.importedRepos !== summary.scannedRepos || summary.importedTasks !== summary.scannedTasks) {
        throw new Error("legacy Yjs import summary is incomplete")
    }
    return summary
}

function optionalResourceKindSummaryParam(
    record: Record<string, unknown>,
    key: string
): OpenADECoreLegacyYjsMigrationResourceKindSummary | undefined {
    if (record[key] === undefined) return undefined
    const kind = objectRecord(record[key], `resources.${key}`)
    const summary = {
        scannedTasks: nonNegativeIntegerParam(kind, "scannedTasks", `resources.${key}.scannedTasks`),
        referenced: nonNegativeIntegerParam(kind, "referenced", `resources.${key}.referenced`),
        imported: nonNegativeIntegerParam(kind, "imported", `resources.${key}.imported`),
        alreadyImported: nonNegativeIntegerParam(kind, "alreadyImported", `resources.${key}.alreadyImported`),
        missing: nonNegativeIntegerParam(kind, "missing", `resources.${key}.missing`),
        conflicted: nonNegativeIntegerParam(kind, "conflicted", `resources.${key}.conflicted`),
        failed: nonNegativeIntegerParam(kind, "failed", `resources.${key}.failed`),
    }
    const accounted = summary.imported + summary.alreadyImported + summary.missing + summary.conflicted + summary.failed
    if (accounted !== summary.referenced) {
        throw new Error("legacy resource import summary is inconsistent")
    }
    return summary
}

function migrationResourceSummaryParam(value: unknown): OpenADECoreLegacyYjsMigrationResourceSummary {
    const record = objectRecord(value, "resources")
    const summary = {
        skipped: nonNegativeIntegerParam(record, "skipped", "resources.skipped"),
        issues: nonNegativeIntegerParam(record, "issues", "resources.issues"),
        images: optionalResourceKindSummaryParam(record, "images"),
        snapshots: optionalResourceKindSummaryParam(record, "snapshots"),
        sessions: optionalResourceKindSummaryParam(record, "sessions"),
    }
    if (!summary.images || !summary.snapshots || !summary.sessions) {
        throw new Error("legacy resource import summary is incomplete")
    }
    const kindIssueCount =
        (summary.images ? summary.images.missing + summary.images.conflicted + summary.images.failed : 0) +
        (summary.snapshots ? summary.snapshots.missing + summary.snapshots.conflicted + summary.snapshots.failed : 0) +
        (summary.sessions ? summary.sessions.missing + summary.sessions.conflicted + summary.sessions.failed : 0)
    if (summary.skipped !== 0 || summary.issues !== 0 || kindIssueCount !== 0) {
        throw new Error("legacy resource import summary is not clean")
    }
    return summary
}

function migrationAcceptRequestParam(value: unknown): OpenADECoreLegacyYjsMigrationAcceptRequest {
    const record = objectRecord(value, "params")
    return {
        data: migrationDataSummaryParam(record.data),
        resources: migrationResourceSummaryParam(record.resources),
    }
}

export function readOpenADECoreLegacyYjsMigrationAcceptance(homeDir: string = os.homedir()): OpenADECoreLegacyYjsMigrationAcceptance | null {
    try {
        const parsed: unknown = JSON.parse(fs.readFileSync(legacyYjsMigrationAcceptanceFilePath(homeDir), "utf8"))
        return isLegacyYjsMigrationAcceptance(parsed) ? parsed : null
    } catch {
        return null
    }
}

export function isOpenADECoreLegacyYjsMigrationAccepted(homeDir: string = os.homedir()): boolean {
    return readOpenADECoreLegacyYjsMigrationAcceptance(homeDir) !== null
}

export function markOpenADECoreLegacyYjsMigrationAccepted(
    params: OpenADECoreLegacyYjsMigrationAcceptRequest,
    options: { acceptedAt?: string; source?: string; homeDir?: string } = {}
): OpenADECoreLegacyYjsMigrationAcceptance {
    const evidence = migrationAcceptRequestParam(params)
    const accepted: OpenADECoreLegacyYjsMigrationAcceptance = {
        version: 1,
        acceptedAt: options.acceptedAt ?? new Date().toISOString(),
        source: options.source ?? "desktop-settings-legacy-yjs-import",
        data: evidence.data,
        resources: evidence.resources,
    }
    const filePath = legacyYjsMigrationAcceptanceFilePath(options.homeDir)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    const tempPath = `${filePath}.tmp-${process.pid}-${randomUUID()}`
    fs.writeFileSync(tempPath, `${JSON.stringify(accepted, null, 2)}\n`, "utf8")
    fs.renameSync(tempPath, filePath)
    return accepted
}

export function markOpenADECoreLegacyYjsMigrationAcceptedFromUnknown(
    params: unknown,
    options: { acceptedAt?: string; source?: string; homeDir?: string } = {}
): OpenADECoreLegacyYjsMigrationAcceptance {
    return markOpenADECoreLegacyYjsMigrationAccepted(migrationAcceptRequestParam(params), options)
}

export function revokeOpenADECoreLegacyYjsMigrationAcceptance(options: { homeDir?: string } = {}): OpenADECoreLegacyYjsMigrationRevokeResult {
    const filePath = legacyYjsMigrationAcceptanceFilePath(options.homeDir)
    const revoked = fs.existsSync(filePath)
    fs.rmSync(filePath, { force: true })
    return { revoked, requiresRestart: true }
}
