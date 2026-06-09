import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import logger from "electron-log"
import { cleanupRuntimeIpc, loadRuntimeIpc } from "./companion/runtimeIpc"
import { isOpenADECoreLegacyYjsMigrationAccepted } from "./openadeCoreMigration"

const DEFAULT_MANAGED_CORE_PORT = "37376"
const DEFAULT_MANAGED_CORE_RUNTIME_PATH = "/v1/runtime"
const DEFAULT_MANAGED_CORE_HOST = "127.0.0.1"
const MANAGED_CORE_DEFAULT_COMMAND = ["go", "run", "../openade-core/cmd/openade-core"]
const PACKAGED_CORE_DIR = path.join("dist", "openade-core")
const OPENADE_DIR = ".openade"
const DATA_DIR = "data"
const YJS_DIR = "yjs"

export interface ManagedOpenADECoreLaunchPlan {
    command: string
    args: string[]
    cwd: string
    env: NodeJS.ProcessEnv
    runtimeEndpoint: {
        url: string
        token: string
    }
}

export interface ManagedOpenADECoreLaunchOptions {
    isDev?: boolean
    legacyYjsDocumentsExist?: () => boolean
    legacyYjsMigrationAccepted?: () => boolean
}

export type ManagedOpenADECoreRolloutReason =
    | "managed-core"
    | "legacy-yjs-migration-accepted"
    | "external-endpoint"
    | "disabled"
    | "legacy-yjs-documents"
    | "development-default-off"
    | "missing-core-binary"
    | "invalid-managed-command"

export interface ManagedOpenADECoreLaunchDecision {
    plan: ManagedOpenADECoreLaunchPlan | null
    reason: ManagedOpenADECoreRolloutReason
    automatic: boolean
    legacyYjsDocumentsPresent: boolean
    legacyYjsMigrationAccepted: boolean
}

let managedCoreProcess: ChildProcessWithoutNullStreams | null = null

function envFlag(value: string | undefined): boolean {
    const normalized = value?.trim().toLowerCase()
    return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on"
}

function normalizedRuntimePath(value: string | undefined): string {
    const trimmed = value?.trim()
    if (!trimmed) return DEFAULT_MANAGED_CORE_RUNTIME_PATH
    return trimmed.startsWith("/") ? trimmed : `/${trimmed}`
}

function normalizedRuntimePort(value: string | undefined): string {
    const trimmed = value?.trim()
    if (!trimmed) return DEFAULT_MANAGED_CORE_PORT
    const parsed = Number(trimmed)
    if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) return DEFAULT_MANAGED_CORE_PORT
    return String(parsed)
}

function parseManagedCoreCommand(value: string | undefined): string[] {
    const trimmed = value?.trim()
    if (!trimmed) return MANAGED_CORE_DEFAULT_COMMAND

    if (trimmed.startsWith("[")) {
        try {
            const parsed: unknown = JSON.parse(trimmed)
            if (!Array.isArray(parsed)) return []
            const command = parsed.map((part) => (typeof part === "string" ? part.trim() : "")).filter(Boolean)
            return command
        } catch {
            return []
        }
    }

    return [trimmed]
}

function openadeCoreBinaryName(platform: NodeJS.Platform = process.platform): string {
    return platform === "win32" ? "openade-core.exe" : "openade-core"
}

function packagedOpenADECoreCommand(
    resourcesPath: string = process.resourcesPath,
    platform: NodeJS.Platform = process.platform,
    pathExists: (targetPath: string) => boolean = fs.existsSync
): string | null {
    if (!resourcesPath) return null
    const command = path.join(resourcesPath, PACKAGED_CORE_DIR, openadeCoreBinaryName(platform))
    return pathExists(command) ? command : null
}

function builtOpenADECoreCommand(
    mainBundleDir: string = __dirname,
    platform: NodeJS.Platform = process.platform,
    pathExists: (targetPath: string) => boolean = fs.existsSync
): string | null {
    const command = path.join(mainBundleDir, "openade-core", openadeCoreBinaryName(platform))
    return pathExists(command) ? command : null
}

function defaultOpenADECoreCommand(): string | null {
    return packagedOpenADECoreCommand() ?? builtOpenADECoreCommand()
}

function managedCoreCommand(env: NodeJS.ProcessEnv, resolveBuiltCommand: () => string | null): string[] {
    if (env.OPENADE_CORE_COMMAND?.trim()) {
        return parseManagedCoreCommand(env.OPENADE_CORE_COMMAND)
    }

    const builtCommand = resolveBuiltCommand()
    if (builtCommand) return [builtCommand]

    return MANAGED_CORE_DEFAULT_COMMAND
}

function defaultYjsStorageDirs(env: NodeJS.ProcessEnv = process.env, homeDir: string = os.homedir()): string[] {
    const configuredDir = env.OPENADE_YJS_STORAGE_DIR?.trim()
    if (configuredDir) return [configuredDir]
    return [
        path.join(homeDir, OPENADE_DIR, DATA_DIR, YJS_DIR),
        path.join(homeDir, OPENADE_DIR, OPENADE_DIR, DATA_DIR, YJS_DIR),
    ]
}

function yjsStorageDirHasDocuments(storageDir: string): boolean {
    try {
        const entries = fs.readdirSync(storageDir, { withFileTypes: true })
        return entries.some((entry) => entry.isFile() && !entry.name.startsWith(".") && !entry.name.includes(".tmp."))
    } catch (error) {
        const code = error instanceof Error && "code" in error ? String(error.code) : ""
        if (code === "ENOENT") return false
        return true
    }
}

export function managedOpenADECoreLegacyYjsDocumentsExist(env: NodeJS.ProcessEnv = process.env, homeDir: string = os.homedir()): boolean {
    return defaultYjsStorageDirs(env, homeDir).some((storageDir) => yjsStorageDirHasDocuments(storageDir))
}

function runtimeEndpointURL(host: string, port: string, runtimePath: string): string {
    return `ws://${host}:${port}${runtimePath}`
}

function generateCoreToken(): string {
    return crypto.randomBytes(24).toString("base64url")
}

function buildManagedOpenADECoreLaunchPlan({
    env,
    cwd,
    createToken,
    commandParts,
}: {
    env: NodeJS.ProcessEnv
    cwd: string
    createToken: () => string
    commandParts: string[]
}): ManagedOpenADECoreLaunchPlan {
    const host = env.OPENADE_CORE_HOST?.trim() || DEFAULT_MANAGED_CORE_HOST
    const port = normalizedRuntimePort(env.OPENADE_CORE_PORT)
    const runtimePath = normalizedRuntimePath(env.OPENADE_CORE_RUNTIME_PATH)
    const token = env.OPENADE_CORE_TOKEN?.trim() || createToken()
    const url = runtimeEndpointURL(host, port, runtimePath)

    return {
        command: commandParts[0],
        args: commandParts.slice(1),
        cwd,
        env: {
            ...env,
            OPENADE_USE_OPENADE_CORE: "1",
            OPENADE_CORE_MANAGED: "1",
            OPENADE_CORE_TOKEN: token,
            OPENADE_CORE_HOST: host,
            OPENADE_CORE_PORT: port,
            OPENADE_CORE_RUNTIME_PATH: runtimePath,
            OPENADE_CORE_RUNTIME_URL: url,
        },
        runtimeEndpoint: { url, token },
    }
}

export function decideManagedOpenADECoreLaunch(
    env: NodeJS.ProcessEnv = process.env,
    cwd: string = process.cwd(),
    createToken: () => string = generateCoreToken,
    resolveBuiltCommand: () => string | null = defaultOpenADECoreCommand,
    options: ManagedOpenADECoreLaunchOptions = {}
): ManagedOpenADECoreLaunchDecision {
    if (envFlag(env.OPENADE_DISABLE_OPENADE_CORE)) {
        return { plan: null, reason: "disabled", automatic: false, legacyYjsDocumentsPresent: false, legacyYjsMigrationAccepted: false }
    }
    if (env.OPENADE_CORE_RUNTIME_URL?.trim()) {
        return { plan: null, reason: "external-endpoint", automatic: false, legacyYjsDocumentsPresent: false, legacyYjsMigrationAccepted: false }
    }

    const explicitManagedCore = envFlag(env.OPENADE_CORE_MANAGED) || envFlag(env.OPENADE_USE_OPENADE_CORE)
    let commandParts: string[]
    let automatic = false
    let legacyYjsDocumentsPresent = false
    let legacyYjsMigrationAccepted = false
    if (explicitManagedCore) {
        commandParts = managedCoreCommand(env, resolveBuiltCommand)
    } else {
        if (options.isDev) {
            return { plan: null, reason: "development-default-off", automatic: false, legacyYjsDocumentsPresent: false, legacyYjsMigrationAccepted: false }
        }
        const hasLegacyDocuments = options.legacyYjsDocumentsExist ?? (() => managedOpenADECoreLegacyYjsDocumentsExist(env))
        legacyYjsDocumentsPresent = hasLegacyDocuments()
        if (legacyYjsDocumentsPresent) {
            const hasAcceptedMigration = options.legacyYjsMigrationAccepted ?? (() => isOpenADECoreLegacyYjsMigrationAccepted())
            legacyYjsMigrationAccepted = hasAcceptedMigration()
        }
        if (legacyYjsDocumentsPresent && !legacyYjsMigrationAccepted) {
            return {
                plan: null,
                reason: "legacy-yjs-documents",
                automatic: false,
                legacyYjsDocumentsPresent: true,
                legacyYjsMigrationAccepted: false,
            }
        }
        const builtCommand = resolveBuiltCommand()
        if (!builtCommand) {
            return {
                plan: null,
                reason: "missing-core-binary",
                automatic: false,
                legacyYjsDocumentsPresent,
                legacyYjsMigrationAccepted,
            }
        }
        commandParts = [builtCommand]
        automatic = true
    }

    if (commandParts.length === 0) {
        return { plan: null, reason: "invalid-managed-command", automatic: false, legacyYjsDocumentsPresent, legacyYjsMigrationAccepted }
    }

    return {
        plan: buildManagedOpenADECoreLaunchPlan({ env, cwd, createToken, commandParts }),
        reason: legacyYjsDocumentsPresent && legacyYjsMigrationAccepted ? "legacy-yjs-migration-accepted" : "managed-core",
        automatic,
        legacyYjsDocumentsPresent,
        legacyYjsMigrationAccepted,
    }
}

export function planManagedOpenADECoreLaunch(
    env: NodeJS.ProcessEnv = process.env,
    cwd: string = process.cwd(),
    createToken: () => string = generateCoreToken,
    resolveBuiltCommand: () => string | null = defaultOpenADECoreCommand,
    options: ManagedOpenADECoreLaunchOptions = {}
): ManagedOpenADECoreLaunchPlan | null {
    return decideManagedOpenADECoreLaunch(env, cwd, createToken, resolveBuiltCommand, options).plan
}

function publishManagedCoreRolloutDecision(decision: ManagedOpenADECoreLaunchDecision): void {
    process.env.OPENADE_CORE_ROLLOUT_REASON = decision.reason
    process.env.OPENADE_CORE_ROLLOUT_AUTOMATIC = decision.automatic ? "1" : "0"
    process.env.OPENADE_CORE_ROLLOUT_LEGACY_YJS_DOCUMENTS = decision.legacyYjsDocumentsPresent ? "1" : "0"
    process.env.OPENADE_CORE_ROLLOUT_LEGACY_YJS_MIGRATION_ACCEPTED = decision.legacyYjsMigrationAccepted ? "1" : "0"
}

function publishManagedCoreEndpoint(plan: ManagedOpenADECoreLaunchPlan): void {
    process.env.OPENADE_USE_OPENADE_CORE = "1"
    process.env.OPENADE_CORE_MANAGED = "1"
    process.env.OPENADE_CORE_TOKEN = plan.runtimeEndpoint.token
    process.env.OPENADE_CORE_HOST = plan.env.OPENADE_CORE_HOST
    process.env.OPENADE_CORE_PORT = plan.env.OPENADE_CORE_PORT
    process.env.OPENADE_CORE_RUNTIME_PATH = plan.env.OPENADE_CORE_RUNTIME_PATH
    process.env.OPENADE_CORE_RUNTIME_URL = plan.runtimeEndpoint.url
}

function logManagedCoreOutput(streamName: "stdout" | "stderr", data: Buffer): void {
    const lines = data
        .toString("utf8")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
    for (const line of lines) {
        logger.info("[OpenADECore]", streamName, line)
    }
}

function startManagedOpenADECore(options: ManagedOpenADECoreLaunchOptions = {}): void {
    if (managedCoreProcess) return
    const decision = decideManagedOpenADECoreLaunch(process.env, process.cwd(), generateCoreToken, defaultOpenADECoreCommand, options)
    publishManagedCoreRolloutDecision(decision)
    const plan = decision.plan
    if (!plan) return

    publishManagedCoreEndpoint(plan)
    logger.info("[OpenADECore] starting managed Core process", {
        command: path.basename(plan.command),
        port: plan.env.OPENADE_CORE_PORT,
        runtimePath: plan.env.OPENADE_CORE_RUNTIME_PATH,
    })

    managedCoreProcess = spawn(plan.command, plan.args, {
        cwd: plan.cwd,
        env: plan.env,
        stdio: "pipe",
    })
    managedCoreProcess.stdout.on("data", (data: Buffer) => logManagedCoreOutput("stdout", data))
    managedCoreProcess.stderr.on("data", (data: Buffer) => logManagedCoreOutput("stderr", data))
    managedCoreProcess.on("error", (error) => {
        logger.error("[OpenADECore] managed Core process failed to start", { error: error.message })
    })
    managedCoreProcess.on("exit", (code, signal) => {
        logger.warn("[OpenADECore] managed Core process exited", { code, signal })
        managedCoreProcess = null
    })
}

export function load(options: ManagedOpenADECoreLaunchOptions = {}): void {
    loadRuntimeIpc()
    startManagedOpenADECore(options)
}

export function cleanup(): void {
    if (managedCoreProcess) {
        const child = managedCoreProcess
        managedCoreProcess = null
        child.kill("SIGTERM")
    }
    cleanupRuntimeIpc()
}
