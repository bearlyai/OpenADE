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
}

export function legacyYjsMigrationAcceptanceFilePath(homeDir: string = os.homedir()): string {
    return path.join(homeDir, OPENADE_DIR, DATA_DIR, CORE_DIR, LEGACY_YJS_ACCEPTANCE_FILE)
}

function isLegacyYjsMigrationAcceptance(value: unknown): value is OpenADECoreLegacyYjsMigrationAcceptance {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false
    const record = value as Record<string, unknown>
    return record.version === 1 && typeof record.acceptedAt === "string" && record.acceptedAt.length > 0 && typeof record.source === "string" && record.source.length > 0
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
    options: { acceptedAt?: string; source?: string; homeDir?: string } = {}
): OpenADECoreLegacyYjsMigrationAcceptance {
    const accepted: OpenADECoreLegacyYjsMigrationAcceptance = {
        version: 1,
        acceptedAt: options.acceptedAt ?? new Date().toISOString(),
        source: options.source ?? "desktop-settings-legacy-yjs-import",
    }
    const filePath = legacyYjsMigrationAcceptanceFilePath(options.homeDir)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    const tempPath = `${filePath}.tmp-${process.pid}-${randomUUID()}`
    fs.writeFileSync(tempPath, `${JSON.stringify(accepted, null, 2)}\n`, "utf8")
    fs.renameSync(tempPath, filePath)
    return accepted
}
