import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { OpenADEClient } from "../../openade-client/src/index"
import { RuntimeClient } from "../../runtime-client/src/client"
import { createOpenADENodeYjsStorage } from "./nodeYjsStorage"
import type { OpenADELegacyResourcesImportResult } from "./types"
import { importOpenADELegacyYjsData, type OpenADELegacyYjsImportResult } from "./yjsImport"
import { compareOpenADELegacyYjsToCore, type OpenADELegacyYjsCoreParityReport } from "./yjsImportParity"
import { createOpenADEYjsProjection } from "./yjsProjection"

interface CliOptions {
    dataDir: string
    coreUrl: string
    token: string
    repoIds?: string[]
    taskIds?: string[]
    importResources: boolean
    resourcesDir?: string
    importSessions: boolean
    claudeConfigDir?: string
    codexHome?: string
    skipImport: boolean
    pretty: boolean
}

interface CliReport {
    ok: boolean
    dataDir: string
    coreUrl: string
    imported?: OpenADELegacyYjsImportResult
    importedResources?: OpenADELegacyResourcesImportResult
    parity: OpenADELegacyYjsCoreParityReport
}

interface CliStreams {
    stdout: { write(chunk: string): unknown }
    stderr: { write(chunk: string): unknown }
}

class CliUsageError extends Error {
    constructor(message: string) {
        super(message)
        this.name = "CliUsageError"
    }
}

class CliHelpRequested extends Error {
    constructor() {
        super("help")
        this.name = "CliHelpRequested"
    }
}

const helpText = `Usage: npm run import:yjs:core -- --core-url ws://127.0.0.1:PORT/v1/runtime --token TOKEN [options]

Import legacy OpenADE Yjs documents into a running OpenADE Core, then compare old Yjs DTOs with Core DTOs.

Options:
  --data-dir DIR       Legacy Yjs directory. Defaults to OPENADE_YJS_STORAGE_DIR or ~/.openade/data/yjs.
  --core-url URL       Core WebSocket URL. Defaults to OPENADE_CORE_URL.
  --token TOKEN        Core bearer token. Defaults to OPENADE_CORE_TOKEN.
  --repo-id ID         Limit import/parity to one repo id. May be repeated or comma-separated.
  --task-id ID         Limit import/parity to one task id. May be repeated or comma-separated.
  --import-resources   Import referenced legacy images and snapshot patches into Core blob storage.
  --resources-dir DIR  Directory containing legacy images/ and snapshots/. Defaults to parent of a yjs data dir, otherwise --data-dir.
  --import-sessions    Also import referenced Claude Code/Codex transcript files.
  --claude-config-dir DIR  Claude config directory for session import. Implies --import-sessions.
  --codex-home DIR     Codex home directory for session import. Implies --import-sessions.
  --skip-import        Only run parity against existing Core data.
  --pretty             Pretty-print JSON output.
  --help               Show this help.
`

export async function runOpenADELegacyYjsImportCoreCli(
    argv: string[] = process.argv.slice(2),
    streams: CliStreams = { stdout: process.stdout, stderr: process.stderr }
): Promise<number> {
    try {
        const options = parseCliOptions(argv)
        const storage = createOpenADENodeYjsStorage(options.dataDir)
        const projection = createOpenADEYjsProjection(storage)
        const runtime = new RuntimeClient({
            url: options.coreUrl,
            token: options.token,
            clientName: "OpenADE Legacy Yjs Import CLI",
            clientPlatform: "cli",
            reconnect: false,
        })
        const client = new OpenADEClient({
            runtime,
            clientName: "OpenADE Legacy Yjs Import CLI",
            clientPlatform: "cli",
        })

        try {
            const importOptions = {
                repoIds: options.repoIds,
                taskIds: options.taskIds,
            }
            const imported = options.skipImport ? undefined : await importOpenADELegacyYjsData(projection, client, importOptions)
            const importedResources =
                !options.skipImport && options.importResources
                    ? await client.importLegacyResources(
                          {
                              dataDir: legacyResourceDataDir(options),
                              importSessions: options.importSessions,
                              claudeConfigDir: options.claudeConfigDir,
                              codexHome: options.codexHome,
                          },
                          { clientRequestId: "legacy-yjs-import-core-resources" }
                      )
                    : undefined
            const parity = await compareOpenADELegacyYjsToCore(projection, client, importOptions)
            const resourceIssues = countLegacyResourceImportIssues(importedResources)
            const ok =
                (imported?.errors.length ?? 0) === 0 &&
                (imported?.skipped.length ?? 0) === 0 &&
                resourceIssues === 0 &&
                parity.mismatches.length === 0
            const report: CliReport = {
                ok,
                dataDir: options.dataDir,
                coreUrl: options.coreUrl,
                imported,
                importedResources,
                parity,
            }
            streams.stdout.write(`${JSON.stringify(report, null, options.pretty ? 2 : 0)}\n`)
            return ok ? 0 : 1
        } finally {
            client.close()
        }
    } catch (error) {
        if (error instanceof CliHelpRequested) {
            streams.stdout.write(helpText)
            return 0
        }
        if (error instanceof CliUsageError) {
            streams.stderr.write(`${error.message}\n\n${helpText}`)
            return 2
        }
        const message = error instanceof Error ? error.message : "Unknown import failure"
        streams.stderr.write(`${message}\n`)
        return 1
    }
}

function parseCliOptions(argv: string[]): CliOptions {
    const dataDir = { value: process.env.OPENADE_YJS_STORAGE_DIR ?? path.join(os.homedir(), ".openade", "data", "yjs") }
    const coreUrl = { value: process.env.OPENADE_CORE_URL ?? "" }
    const token = { value: process.env.OPENADE_CORE_TOKEN ?? "" }
    const repoIds: string[] = []
    const taskIds: string[] = []
    const resourcesDir = { value: "" }
    const claudeConfigDir = { value: "" }
    const codexHome = { value: "" }
    let importResources = false
    let importSessions = false
    let skipImport = false
    let pretty = false

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index]
        if (arg === "--help" || arg === "-h") throw new CliHelpRequested()
        if (arg === "--skip-import") {
            skipImport = true
            continue
        }
        if (arg === "--pretty") {
            pretty = true
            continue
        }
        if (arg === "--import-resources") {
            importResources = true
            continue
        }
        if (arg === "--import-sessions") {
            importResources = true
            importSessions = true
            continue
        }
        if (arg === "--data-dir") {
            dataDir.value = requiredArgValue(argv, index, arg)
            index += 1
            continue
        }
        if (arg === "--resources-dir") {
            importResources = true
            resourcesDir.value = requiredArgValue(argv, index, arg)
            index += 1
            continue
        }
        if (arg === "--core-url") {
            coreUrl.value = requiredArgValue(argv, index, arg)
            index += 1
            continue
        }
        if (arg === "--token") {
            token.value = requiredArgValue(argv, index, arg)
            index += 1
            continue
        }
        if (arg === "--repo-id") {
            repoIds.push(...splitListArg(requiredArgValue(argv, index, arg)))
            index += 1
            continue
        }
        if (arg === "--task-id") {
            taskIds.push(...splitListArg(requiredArgValue(argv, index, arg)))
            index += 1
            continue
        }
        if (arg === "--claude-config-dir") {
            importResources = true
            importSessions = true
            claudeConfigDir.value = requiredArgValue(argv, index, arg)
            index += 1
            continue
        }
        if (arg === "--codex-home") {
            importResources = true
            importSessions = true
            codexHome.value = requiredArgValue(argv, index, arg)
            index += 1
            continue
        }
        throw new CliUsageError(`Unknown option: ${arg}`)
    }

    if (coreUrl.value.trim() === "") throw new CliUsageError("--core-url or OPENADE_CORE_URL is required")
    if (token.value.trim() === "") throw new CliUsageError("--token or OPENADE_CORE_TOKEN is required")

    return {
        dataDir: path.resolve(dataDir.value),
        coreUrl: coreUrl.value.trim(),
        token: token.value.trim(),
        repoIds: repoIds.length > 0 ? uniqueStrings(repoIds) : undefined,
        taskIds: taskIds.length > 0 ? uniqueStrings(taskIds) : undefined,
        importResources,
        resourcesDir: resourcesDir.value.trim() ? path.resolve(resourcesDir.value) : undefined,
        importSessions,
        claudeConfigDir: claudeConfigDir.value.trim() ? path.resolve(claudeConfigDir.value) : undefined,
        codexHome: codexHome.value.trim() ? path.resolve(codexHome.value) : undefined,
        skipImport,
        pretty,
    }
}

function countLegacyResourceImportIssues(importedResources: OpenADELegacyResourcesImportResult | undefined): number {
    if (!importedResources) return 0
    return (
        importedResources.skipped.length +
        (importedResources.images?.missingImages.length ?? 0) +
        (importedResources.images?.conflictedImages.length ?? 0) +
        (importedResources.images?.failedImages.length ?? 0) +
        (importedResources.snapshots?.missingPatches.length ?? 0) +
        (importedResources.snapshots?.conflictedPatches.length ?? 0) +
        (importedResources.snapshots?.failedPatches.length ?? 0) +
        (importedResources.sessions?.missingSessions.length ?? 0) +
        (importedResources.sessions?.conflictedSessions.length ?? 0) +
        (importedResources.sessions?.failedSessions.length ?? 0)
    )
}

function legacyResourceDataDir(options: CliOptions): string {
    if (options.resourcesDir) return options.resourcesDir
    return path.basename(options.dataDir) === "yjs" ? path.dirname(options.dataDir) : options.dataDir
}

function requiredArgValue(argv: string[], index: number, option: string): string {
    const value = argv[index + 1]
    if (!value || value.startsWith("--")) throw new CliUsageError(`${option} requires a value`)
    return value
}

function splitListArg(value: string): string[] {
    return value
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
}

function uniqueStrings(values: string[]): string[] {
    return [...new Set(values)]
}

if (isCliEntrypoint()) {
    process.exitCode = await runOpenADELegacyYjsImportCoreCli()
}

function isCliEntrypoint(): boolean {
    if (!process.argv[1]) return false
    return fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(process.argv[1])
}
