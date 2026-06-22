import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import logger from "electron-log"
import { WebSocket, type RawData } from "ws"
import { cleanupRuntimeIpc, loadRuntimeIpc } from "./companion/runtimeIpc"
import { envFlag } from "./envFlag"
import { isOpenADECoreLegacyYjsMigrationAccepted } from "./openadeCoreMigration"

const DEFAULT_MANAGED_CORE_PORT = "37376"
const DEFAULT_MANAGED_CORE_RUNTIME_PATH = "/v1/runtime"
const DEFAULT_MANAGED_CORE_HOST = "127.0.0.1"
const MANAGED_CORE_DEFAULT_COMMAND = ["go", "run", "../openade-core/cmd/openade-core"]
const PACKAGED_CORE_DIR = path.join("dist", "openade-core")
const PACKAGED_HARNESS_WORKER_DIR = path.join("dist", "harness-worker")
const HARNESS_WORKER_ENTRY = "worker.js"
const OPENADE_DIR = ".openade"
const DATA_DIR = "data"
const YJS_DIR = "yjs"
const ACTIVE_WORK_PROBE_TIMEOUT_MS = 1_000
const ACTIVE_WORK_PROBE_INITIALIZE_ID = "openade-core-active-work:init"
const ACTIVE_WORK_PROBE_LIST_ID = "openade-core-active-work:list"
const ACTIVE_WORK_STATUSES = ["starting", "running"] as const

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
    agentWorkerCommand?: () => string[] | null
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
    | "invalid-external-endpoint"

export interface ManagedOpenADECoreLaunchDecision {
    plan: ManagedOpenADECoreLaunchPlan | null
    reason: ManagedOpenADECoreRolloutReason
    automatic: boolean
    productRuntime: boolean
    legacyYjsDocumentsPresent: boolean
    legacyYjsMigrationAccepted: boolean
}

let managedCoreProcess: ChildProcessWithoutNullStreams | null = null

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

function packagedHarnessWorkerPath(
    resourcesPath: string = process.resourcesPath,
    pathExists: (targetPath: string) => boolean = fs.existsSync
): string | null {
    if (!resourcesPath) return null
    const workerPath = path.join(resourcesPath, PACKAGED_HARNESS_WORKER_DIR, HARNESS_WORKER_ENTRY)
    return pathExists(workerPath) ? workerPath : null
}

function builtHarnessWorkerPath(mainBundleDir: string = __dirname, pathExists: (targetPath: string) => boolean = fs.existsSync): string | null {
    const workerPath = path.join(mainBundleDir, "harness-worker", HARNESS_WORKER_ENTRY)
    return pathExists(workerPath) ? workerPath : null
}

function defaultHarnessWorkerPath(): string | null {
    return packagedHarnessWorkerPath() ?? builtHarnessWorkerPath()
}

function defaultAgentWorkerCommand(): string[] | null {
    const workerPath = defaultHarnessWorkerPath()
    return workerPath ? [process.execPath, workerPath] : null
}

function normalizedOptionalCommandParts(parts: string[] | null | undefined): string[] | null {
    if (!parts) return null
    const command = parts.map((part) => part.trim()).filter(Boolean)
    return command.length > 0 ? command : null
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

function isValidRuntimeEndpointURL(value: string): boolean {
    try {
        const url = new URL(value)
        return url.protocol === "ws:" || url.protocol === "wss:"
    } catch {
        return false
    }
}

function generateCoreToken(): string {
    return crypto.randomBytes(24).toString("base64url")
}

function configuredOpenADECoreRuntimeURL(env: NodeJS.ProcessEnv): string | null {
    if (envFlag(env.OPENADE_DISABLE_OPENADE_CORE)) return null
    const endpoint = env.OPENADE_CORE_RUNTIME_URL?.trim()
    if (!endpoint || !isValidRuntimeEndpointURL(endpoint)) return null
    return endpoint
}

export function hasOpenADECoreRuntimeEndpoint(env: NodeJS.ProcessEnv = process.env): boolean {
    return configuredOpenADECoreRuntimeURL(env) !== null
}

function rawDataToString(data: RawData): string {
    if (typeof data === "string") return data
    if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8")
    if (Array.isArray(data)) return Buffer.concat(data).toString("utf8")
    return data.toString("utf8")
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isActiveOpenADETaskRuntimeRecord(value: unknown): boolean {
    if (!isObjectRecord(value)) return false
    const scope = value.scope
    if (!isObjectRecord(scope)) return false
    return scope.ownerType === "openade-task" && (value.status === "starting" || value.status === "running")
}

function runtimeListResultHasActiveWork(value: unknown): boolean {
    return Array.isArray(value) && value.some((record) => isActiveOpenADETaskRuntimeRecord(record))
}

function parseRuntimeResponse(data: RawData): Record<string, unknown> | null {
    try {
        const parsed: unknown = JSON.parse(rawDataToString(data))
        return isObjectRecord(parsed) ? parsed : null
    } catch {
        return null
    }
}

export function hasActiveOpenADECoreRuntimeWork(
    env: NodeJS.ProcessEnv = process.env,
    timeoutMs: number = ACTIVE_WORK_PROBE_TIMEOUT_MS
): Promise<boolean> {
    const endpoint = configuredOpenADECoreRuntimeURL(env)
    if (!endpoint) return Promise.resolve(false)

    return new Promise((resolve) => {
        let settled = false
        let socket: WebSocket | null = null
        const settle = (hasActiveWork: boolean) => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
                socket.close()
            }
            resolve(hasActiveWork)
        }
        const timer = setTimeout(() => settle(false), timeoutMs)

        try {
            const token = env.OPENADE_CORE_TOKEN?.trim()
            socket = token ? new WebSocket(endpoint, [`bearer.${token}`]) : new WebSocket(endpoint)
        } catch {
            clearTimeout(timer)
            resolve(false)
            return
        }

        const activeSocket = socket
        activeSocket.on("open", () => {
            activeSocket.send(
                JSON.stringify({
                    id: ACTIVE_WORK_PROBE_INITIALIZE_ID,
                    method: "initialize",
                    params: {
                        protocolVersion: 1,
                        clientName: "OpenADE Desktop",
                        clientPlatform: "desktop",
                    },
                })
            )
        })
        activeSocket.on("message", (data) => {
            const message = parseRuntimeResponse(data)
            if (!message) return
            if (message.id === ACTIVE_WORK_PROBE_INITIALIZE_ID) {
                if ("error" in message) {
                    settle(false)
                    return
                }
                activeSocket.send(
                    JSON.stringify({
                        id: ACTIVE_WORK_PROBE_LIST_ID,
                        method: "runtime/list",
                        params: {
                            ownerType: "openade-task",
                            statuses: ACTIVE_WORK_STATUSES,
                        },
                    })
                )
                return
            }
            if (message.id === ACTIVE_WORK_PROBE_LIST_ID) {
                settle(!("error" in message) && runtimeListResultHasActiveWork(message.result))
            }
        })
        activeSocket.on("close", () => settle(false))
        activeSocket.on("error", () => settle(false))
    })
}

function buildManagedOpenADECoreLaunchPlan({
    env,
    cwd,
    createToken,
    commandParts,
    resolveAgentWorkerCommand,
}: {
    env: NodeJS.ProcessEnv
    cwd: string
    createToken: () => string
    commandParts: string[]
    resolveAgentWorkerCommand: () => string[] | null
}): ManagedOpenADECoreLaunchPlan {
    const host = env.OPENADE_CORE_HOST?.trim() || DEFAULT_MANAGED_CORE_HOST
    const port = normalizedRuntimePort(env.OPENADE_CORE_PORT)
    const runtimePath = normalizedRuntimePath(env.OPENADE_CORE_RUNTIME_PATH)
    const token = env.OPENADE_CORE_TOKEN?.trim() || createToken()
    const url = runtimeEndpointURL(host, port, runtimePath)
    const inheritedAgentWorkerCommand = env.OPENADE_CORE_AGENT_WORKER_COMMAND?.trim()
    const managedAgentWorkerCommand = inheritedAgentWorkerCommand ? null : normalizedOptionalCommandParts(resolveAgentWorkerCommand())
    const agentWorkerEnv: NodeJS.ProcessEnv = inheritedAgentWorkerCommand
        ? {}
        : managedAgentWorkerCommand
          ? {
                OPENADE_CORE_AGENT_WORKER_COMMAND: JSON.stringify(managedAgentWorkerCommand),
                ELECTRON_RUN_AS_NODE: "1",
            }
          : {}

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
            ...agentWorkerEnv,
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
        return { plan: null, reason: "disabled", automatic: false, productRuntime: false, legacyYjsDocumentsPresent: false, legacyYjsMigrationAccepted: false }
    }
    const externalRuntimeEndpoint = env.OPENADE_CORE_RUNTIME_URL?.trim()
    if (externalRuntimeEndpoint) {
        if (!isValidRuntimeEndpointURL(externalRuntimeEndpoint)) {
            return {
                plan: null,
                reason: "invalid-external-endpoint",
                automatic: false,
                productRuntime: false,
                legacyYjsDocumentsPresent: false,
                legacyYjsMigrationAccepted: false,
            }
        }
        return { plan: null, reason: "external-endpoint", automatic: false, productRuntime: true, legacyYjsDocumentsPresent: false, legacyYjsMigrationAccepted: false }
    }

    const explicitManagedCore = envFlag(env.OPENADE_CORE_MANAGED) || envFlag(env.OPENADE_USE_OPENADE_CORE)
    let commandParts: string[]
    let automatic = false
    let productRuntime = explicitManagedCore
    let legacyYjsDocumentsPresent = false
    let legacyYjsMigrationAccepted = false
    if (explicitManagedCore) {
        commandParts = managedCoreCommand(env, resolveBuiltCommand)
    } else {
        if (options.isDev) {
            return {
                plan: null,
                reason: "development-default-off",
                automatic: false,
                productRuntime: false,
                legacyYjsDocumentsPresent: false,
                legacyYjsMigrationAccepted: false,
            }
        }
        const hasLegacyDocuments = options.legacyYjsDocumentsExist ?? (() => managedOpenADECoreLegacyYjsDocumentsExist(env))
        legacyYjsDocumentsPresent = hasLegacyDocuments()
        if (legacyYjsDocumentsPresent) {
            const hasAcceptedMigration = options.legacyYjsMigrationAccepted ?? (() => isOpenADECoreLegacyYjsMigrationAccepted())
            legacyYjsMigrationAccepted = hasAcceptedMigration()
        }
        const builtCommand = resolveBuiltCommand()
        if (!builtCommand) {
            return {
                plan: null,
                reason: legacyYjsDocumentsPresent && !legacyYjsMigrationAccepted ? "legacy-yjs-documents" : "missing-core-binary",
                automatic: false,
                productRuntime: false,
                legacyYjsDocumentsPresent,
                legacyYjsMigrationAccepted,
            }
        }
        commandParts = [builtCommand]
        automatic = true
        productRuntime = !legacyYjsDocumentsPresent || legacyYjsMigrationAccepted
    }

    if (commandParts.length === 0) {
        return { plan: null, reason: "invalid-managed-command", automatic: false, productRuntime: false, legacyYjsDocumentsPresent, legacyYjsMigrationAccepted }
    }

    const resolveAgentWorkerCommand = options.agentWorkerCommand ?? defaultAgentWorkerCommand
    return {
        plan: buildManagedOpenADECoreLaunchPlan({ env, cwd, createToken, commandParts, resolveAgentWorkerCommand }),
        reason: legacyYjsDocumentsPresent && !legacyYjsMigrationAccepted ? "legacy-yjs-documents" : legacyYjsMigrationAccepted ? "legacy-yjs-migration-accepted" : "managed-core",
        automatic,
        productRuntime,
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

function publishManagedCoreEndpoint(plan: ManagedOpenADECoreLaunchPlan, productRuntime: boolean): void {
    process.env.OPENADE_CORE_MIGRATION_TOKEN = plan.runtimeEndpoint.token
    process.env.OPENADE_CORE_MIGRATION_RUNTIME_URL = plan.runtimeEndpoint.url
    if (!productRuntime) return

    process.env.OPENADE_USE_OPENADE_CORE = "1"
    process.env.OPENADE_CORE_MANAGED = "1"
    process.env.OPENADE_CORE_TOKEN = plan.runtimeEndpoint.token
    process.env.OPENADE_CORE_HOST = plan.env.OPENADE_CORE_HOST
    process.env.OPENADE_CORE_PORT = plan.env.OPENADE_CORE_PORT
    process.env.OPENADE_CORE_RUNTIME_PATH = plan.env.OPENADE_CORE_RUNTIME_PATH
    process.env.OPENADE_CORE_RUNTIME_URL = plan.runtimeEndpoint.url
}

function managedCoreRolloutLogDetails(decision: ManagedOpenADECoreLaunchDecision): {
    reason: ManagedOpenADECoreRolloutReason
    automatic: boolean
    productRuntime: boolean
    legacyYjsDocumentsPresent: boolean
    legacyYjsMigrationAccepted: boolean
    willStartManagedCore: boolean
} {
    return {
        reason: decision.reason,
        automatic: decision.automatic,
        productRuntime: decision.productRuntime,
        legacyYjsDocumentsPresent: decision.legacyYjsDocumentsPresent,
        legacyYjsMigrationAccepted: decision.legacyYjsMigrationAccepted,
        willStartManagedCore: decision.plan !== null,
    }
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
    if (!plan) {
        logger.info("[OpenADECore] managed Core not started", managedCoreRolloutLogDetails(decision))
        return
    }

    publishManagedCoreEndpoint(plan, decision.productRuntime)
    logger.info("[OpenADECore] starting managed Core process", {
        command: path.basename(plan.command),
        port: plan.env.OPENADE_CORE_PORT,
        runtimePath: plan.env.OPENADE_CORE_RUNTIME_PATH,
        ...managedCoreRolloutLogDetails(decision),
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
