import os from "node:os"
import fs from "node:fs/promises"
import path from "node:path"
import { createHash, randomUUID } from "node:crypto"
import {
    buildOpenADEHyperPlanStepPrompt,
    buildOpenADEReconcileStepPrompt,
    buildOpenADEReviewHandoffPrompt,
    buildOpenADEPlanReviewPrompt,
    buildOpenADEReviewStepPrompt,
    buildOpenADEReviseStepPrompt,
    buildOpenADEWorkReviewPrompt,
    buildOpenADEPrompt,
    createOpenADEModule,
    createOpenADEYjsProjection,
    createOpenADEYjsWriter,
    extractOpenADEPlanText,
    groupOpenADEHyperPlanByDepth,
    isStandardOpenADEHyperPlanStrategy,
    publishOpenADECompanionEvent,
    resolveOpenADEHyperPlanStrategy,
    validateOpenADEHyperPlanStrategy,
    type OpenADEActionEventSource,
    type OpenADEHyperPlanStep,
    type OpenADEHyperPlanStrategy,
    type OpenADESnapshotChangedFile,
    type OpenADESetupEnvironmentEventCreateRequest,
    type OpenADETask,
    type OpenADETaskDeleteRequest,
    type OpenADETaskDeviceEnvironment,
    type OpenADETurnStartContext,
    type OpenADETurnStartRequest,
    type OpenADEReviewStartRequest,
} from "../../../../openade-module/src"
import type { CompanionEvent } from "../../../../shared/companion/src"
import type { AgentProviderSummary, RuntimeRecord } from "../../../../runtime-protocol/src"
import { createRuntimeNodeLivenessProbe } from "../../../../runtime-node/src"
import { RuntimeHandlerError, RuntimeServer } from "../../../../runtime/src"
import { getDefaultModelForHarness, getModelFullId, type HarnessId, type McpServerConfig } from "@openade/harness"
import {
    abortRuntimeHarnessQuery,
    clearRuntimeHarnessBuffer,
    deleteRuntimeHarnessSession,
    startRuntimeHarnessQuery,
} from "../code/harness"
import { deleteRuntimeDataFile, loadRuntimeDataFile, saveRuntimeDataFile } from "../code/dataFolder"
import {
    deleteRuntimeBranch,
    deleteRuntimeWorkTree,
    getRuntimeChangedFiles,
    getOrCreateRuntimeWorkTree,
    getRuntimeGitSummary,
    getRuntimeMergeBase,
    getRuntimeWorktreeFilePatch,
    isRuntimeGitDirectory,
    type ChangedFileInfo,
} from "../code/git"
import {
    deleteRuntimeSnapshotBundle,
    loadRuntimeSnapshotIndex,
    loadRuntimeSnapshotPatch,
    loadRuntimeSnapshotPatchSlice,
    saveRuntimeSnapshotBundle,
} from "../code/snapshots"
import type { SnapshotPatchFile, SnapshotPatchIndex } from "../code/snapshotsIndex"
import { killRuntimePty } from "../code/pty"
import { getDeviceConfig } from "../deviceConfig"
import { getRuntimeCodeCapabilities, getRuntimeSdkCapabilities, invalidateRuntimeSdkCapabilities } from "../code/capabilities"
import {
    ensureRuntimeBinary,
    getRuntimeBinaryStatuses,
    removeRuntimeBinary,
    resolve as resolveRuntimeBinary,
} from "../code/binaries"
import { checkRuntimeBinary, checkRuntimeVendoredRipgrep, getRuntimePlatformInfo } from "../code/platform"
import { setRuntimeGlobalEnvVars } from "../code/subprocess"
import {
    loadRuntimeEditableProcs,
    parseRuntimeEditableRaw,
    readRuntimeProcs,
    readRuntimeProcsFile,
    saveRuntimeEditableProcs,
    serializeRuntimeEditableProcs,
    writeRuntimeProcsFile,
    type CronInput,
    type ProcessInput,
} from "../code/procs"
import {
    cancelRuntimeMcpOAuth,
    initiateRuntimeMcpOAuth,
    refreshRuntimeMcpOAuth,
    testRuntimeMcpConnection,
    type McpServerConfig as RuntimeMcpServerConfig,
} from "../code/mcp"
import { createRuntimeDirectory } from "../code/shell"
import { registerRuntimeAgentModule, registerServerProtocolAgentBridge } from "./runtimeAgents"
import { createRuntimeCheckpointStore } from "./runtimeCheckpoint"
import { cleanupRuntimeHostModule, registerRuntimeHostModule } from "./runtimeHost"
import { createOpenADEYjsStorageAdapter } from "./runtimeYjsAdapter"
import { configurePowerKeeper } from "./powerKeeper"
import { createRuntimeNodeCodexAppServerBridge, notifyRuntimeNodeAgentBridgeEvent } from "../../../../runtime-node/src"

const agentProviders: AgentProviderSummary[] = [
    {
        providerId: "claude-code",
        label: "Claude Code",
        kind: "process",
        capabilities: {
            execution: true,
            streaming: true,
            sessions: true,
            steering: false,
            interrupt: true,
            goals: false,
            approvals: true,
            filesystem: true,
            processExec: true,
        },
    },
    {
        providerId: "codex-cli",
        label: "Codex CLI",
        kind: "process",
        capabilities: {
            execution: true,
            streaming: true,
            sessions: true,
            steering: false,
            interrupt: true,
            goals: false,
            approvals: true,
            filesystem: true,
            processExec: true,
        },
    },
    {
        providerId: "codex-server",
        label: "Codex Server Protocol",
        kind: "serverProtocol",
        capabilities: {
            execution: true,
            streaming: true,
            sessions: true,
            steering: true,
            interrupt: true,
            goals: true,
            approvals: true,
            filesystem: true,
            processExec: true,
        },
    },
]

let runtimeServer: RuntimeServer | null = null
const runtimeBridgeUnregisters: (() => void)[] = []
type ActiveTaskExecution = { executionId: string; runtimeId: string; repoId: string; eventId: string; childExecutionIds?: Set<string>; stopping?: boolean }
const activeTaskExecutions = new Map<string, ActiveTaskExecution>()
const quitBlockingRuntimeKinds = new Set(["agent", "process", "pty", "composite"])

export function hasActiveRuntimeWork(): boolean {
    return (
        runtimeServer?.supervisor
            .list()
            .some((runtime) => quitBlockingRuntimeKinds.has(runtime.kind) && (runtime.status === "starting" || runtime.status === "running")) ?? false
    )
}

type SnapshotBase = {
    referenceBranch: string
    mergeBaseCommit: string
    fromTreeish: string
}

type TaskExecutionEnvironment = {
    cwd: string
    rootPath: string
    snapshotBase?: SnapshotBase
}

type SnapshotPatchResult = {
    patch: string
    index: SnapshotPatchIndex
    stats: {
        filesChanged: number
        insertions: number
        deletions: number
    }
    files: OpenADESnapshotChangedFile[]
}

type HarnessContentBlock =
    | { type: "text"; text: string }
    | { type: "image"; source: { type: "base64"; media_type: string; data: string } }

interface RuntimeImageAttachment {
    id: string
    ext: string
    mediaType: string
}

type OpenADEYjsStorage = ReturnType<typeof createOpenADEYjsStorageAdapter>

function fallbackTitle(input: string): string {
    const cleaned = input.replace(/\s+/g, " ").trim()
    return cleaned.length <= 50 ? cleaned : `${cleaned.slice(0, 50).trim()}...`
}

function fallbackSlug(): string {
    return `task-${randomUUID().replace(/-/g, "").slice(0, 8)}`
}

function taskIdForClientRequest(repoId: string, clientRequestId: string | undefined): string | undefined {
    if (!clientRequestId) return undefined
    const hash = createHash("sha256").update(repoId).update("\0").update(clientRequestId).digest("hex").slice(0, 26)
    return `task-${hash}`
}

function canCreateTaskInRuntime(params: OpenADETurnStartRequest): boolean {
    return !params.inTaskId
}

function registerConfiguredServerProtocolBridges(server: RuntimeServer): void {
    const codexUrl = process.env.OPENADE_CODEX_APP_SERVER_URL ?? process.env.CODEX_APP_SERVER_URL
    if (!codexUrl) return

    const managedCommand = process.env.OPENADE_CODEX_APP_SERVER_COMMAND ?? process.env.CODEX_APP_SERVER_COMMAND
    const managedArgs = process.env.OPENADE_CODEX_APP_SERVER_ARGS_JSON ?? process.env.CODEX_APP_SERVER_ARGS_JSON
    const bridge = createRuntimeNodeCodexAppServerBridge({
        providerId: "codex-server",
        label: "Codex Server Protocol",
        websocketUrl: codexUrl,
        authToken: process.env.OPENADE_CODEX_APP_SERVER_TOKEN ?? process.env.CODEX_APP_SERVER_TOKEN,
        clientName: "openade",
        clientVersion: process.env.RELEASE ?? "unknown",
        managedProcess: managedCommand
            ? {
                  command: managedCommand,
                  args: parseStringArrayEnv(managedArgs) ?? ["app-server", "--listen", codexUrl],
                  cwd: process.env.OPENADE_CODEX_APP_SERVER_CWD ?? process.env.CODEX_APP_SERVER_CWD,
                  readyProbeUrl: process.env.OPENADE_CODEX_APP_SERVER_READY_URL ?? process.env.CODEX_APP_SERVER_READY_URL,
              }
            : undefined,
        onNotification(method, params) {
            notifyRuntimeNodeAgentBridgeEvent(server, method, params)
        },
    })
    runtimeBridgeUnregisters.push(() => {
        void bridge.disconnect()
    })
    runtimeBridgeUnregisters.push(registerServerProtocolAgentBridge(bridge))
}

function parseStringArrayEnv(value: string | undefined): string[] | undefined {
    if (!value) return undefined
    try {
        const parsed = JSON.parse(value) as unknown
        return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : undefined
    } catch {
        return undefined
    }
}

function canExecuteTaskInRuntime(task: OpenADETask): boolean {
    const isolationStrategy = task.isolationStrategy ?? { type: "head" }
    return isolationStrategy.type === "head" || isolationStrategy.type === "worktree"
}

function executionIdForTask(taskId: string): string {
    return `execution-${taskId}-${randomUUID()}`
}

function harnessIdForTurn(params: OpenADETurnStartRequest, task: OpenADETask): HarnessId {
    const lastHarnessId = lastActionSessionContext(task)?.harnessId
    return (params.harnessId ?? lastHarnessId ?? "claude-code") as HarnessId
}

function modelIdForTurn(params: OpenADETurnStartRequest, task: OpenADETask, harnessId: HarnessId): string | undefined {
    return params.modelId ?? lastActionSessionContext(task)?.modelId ?? getDefaultModelForHarness(harnessId)
}

function lastActionSessionContext(task: OpenADETask): { sessionId: string; harnessId?: string; modelId?: string } | null {
    for (let index = task.events.length - 1; index >= 0; index--) {
        const event = task.events[index]
        if (typeof event !== "object" || event === null || Array.isArray(event)) continue
        const record = event as Record<string, unknown>
        if (record.type !== "action") continue
        const source = typeof record.source === "object" && record.source !== null ? (record.source as Record<string, unknown>) : {}
        if (source.type === "review") continue
        const execution = typeof record.execution === "object" && record.execution !== null ? (record.execution as Record<string, unknown>) : {}
        if (typeof execution.sessionId === "string" && execution.sessionId) {
            return {
                sessionId: execution.sessionId,
                harnessId: typeof execution.harnessId === "string" ? execution.harnessId : undefined,
                modelId: typeof execution.modelId === "string" ? execution.modelId : undefined,
            }
        }
    }
    return null
}

async function getGitRefs(cwd: string): Promise<{ sha: string; branch?: string } | undefined> {
    try {
        const summary = await getRuntimeGitSummary({ repoDir: cwd })
        return {
            sha: summary.headCommit,
            branch: summary.branch ?? undefined,
        }
    } catch {
        return undefined
    }
}

function mergeAppendSystemPrompt(base?: string, extra?: string): string | undefined {
    if (base && extra) return `${base}\n\n${extra}`
    return base ?? extra
}

function imageAttachments(images?: unknown): RuntimeImageAttachment[] {
    if (!Array.isArray(images)) return []
    return images
        .map((image): RuntimeImageAttachment | null => {
            if (typeof image !== "object" || image === null || Array.isArray(image)) return null
            const record = image as Record<string, unknown>
            const id = typeof record.id === "string" && /^[a-zA-Z0-9_-]+$/.test(record.id) ? record.id : undefined
            const ext = typeof record.ext === "string" && /^[a-zA-Z0-9]+$/.test(record.ext) ? record.ext : undefined
            const mediaType = typeof record.mediaType === "string" && record.mediaType.startsWith("image/") ? record.mediaType : undefined
            if (!id || !ext || !mediaType) return null
            return { id, ext, mediaType }
        })
        .filter((image): image is RuntimeImageAttachment => image !== null)
}

function runtimeRecordParam(value: unknown): Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function runtimeStringParam(record: Record<string, unknown>, key: string): string {
    const value = record[key]
    if (typeof value !== "string" || value.length < 1) throw new Error(`${key} is invalid`)
    return value
}

function optionalRuntimeStringParam(record: Record<string, unknown>, key: string): string | undefined {
    const value = record[key]
    return typeof value === "string" && value.length > 0 ? value : undefined
}

function runtimeNumberParam(record: Record<string, unknown>, key: string): number {
    const value = record[key]
    if (!Number.isInteger(value)) throw new Error(`${key} is invalid`)
    return value as number
}

function runtimeStringRecordParam(record: Record<string, unknown>, key: string): Record<string, string> {
    const value = record[key]
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${key} is invalid`)
    const result: Record<string, string> = {}
    for (const [recordKey, recordValue] of Object.entries(value)) {
        if (typeof recordValue !== "string") throw new Error(`${key}.${recordKey} is invalid`)
        result[recordKey] = recordValue
    }
    return result
}

function base64Param(record: Record<string, unknown>, key: string): string {
    const value = runtimeStringParam(record, key)
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) {
        throw new Error(`${key} is invalid`)
    }
    return value
}

function snapshotPatchIndexParam(value: unknown): SnapshotPatchIndex {
    const record = runtimeRecordParam(value)
    if (record.version !== 1) throw new Error("index.version is invalid")
    const patchSize = runtimeNumberParam(record, "patchSize")
    const filesValue = record.files
    if (!Array.isArray(filesValue)) throw new Error("index.files is invalid")
    return {
        version: 1,
        patchSize,
        files: filesValue as SnapshotPatchFile[],
    }
}

function registerTrustedHostMethods(server: RuntimeServer): void {
    server.registerNotification("host/mcp/oauthComplete")
    server.register("host/binaries/statuses", () => getRuntimeBinaryStatuses())
    server.register("host/binaries/ensure", async (params) => {
        const record = runtimeRecordParam(params)
        const name = runtimeStringParam(record, "name")
        try {
            const binaryPath = await ensureRuntimeBinary(name)
            return { ok: true, path: binaryPath }
        } catch (error) {
            const message = error instanceof Error ? error.message : "Unknown error"
            console.error(`[RuntimeGateway] host/binaries/ensure(${name}) failed:`, message)
            return { ok: false, error: message }
        }
    })
    server.register("host/binaries/remove", (params) => {
        removeRuntimeBinary(runtimeStringParam(runtimeRecordParam(params), "name"))
        return { ok: true }
    })
    server.register("host/binaries/resolve", (params) => ({ path: resolveRuntimeBinary(runtimeStringParam(runtimeRecordParam(params), "name")) }))
    server.register("host/platform/info", () => getRuntimePlatformInfo())
    server.register("host/system/checkBinary", (params) => checkRuntimeBinary(runtimeStringParam(runtimeRecordParam(params), "binary")))
    server.register("host/system/checkVendoredRipgrep", () => checkRuntimeVendoredRipgrep())
    server.register("host/subprocess/setGlobalEnv", (params) => {
        const record = runtimeRecordParam(params)
        setRuntimeGlobalEnvVars(runtimeStringRecordParam(record, "env"))
        return { success: true }
    })
    server.register("host/shell/createDirectory", (params) => createRuntimeDirectory({ path: runtimeStringParam(runtimeRecordParam(params), "path") }))
    server.register("host/mcp/testConnection", (params) => {
        const record = runtimeRecordParam(params)
        const config = runtimeRecordParam(record.config) as unknown as RuntimeMcpServerConfig
        return testRuntimeMcpConnection(config)
    })
    server.register("host/mcp/initiateOAuth", (params) => {
        const record = runtimeRecordParam(params)
        return initiateRuntimeMcpOAuth(
            {
                serverId: runtimeStringParam(record, "serverId"),
                serverUrl: runtimeStringParam(record, "serverUrl"),
            },
            (result) => server.notify("host/mcp/oauthComplete", result)
        )
    })
    server.register("host/mcp/cancelOAuth", (params) => cancelRuntimeMcpOAuth({ serverId: runtimeStringParam(runtimeRecordParam(params), "serverId") }))
    server.register("host/mcp/refreshOAuth", (params) => {
        const record = runtimeRecordParam(params)
        return refreshRuntimeMcpOAuth({
            serverId: runtimeStringParam(record, "serverId"),
            serverUrl: runtimeStringParam(record, "serverUrl"),
            refreshToken: runtimeStringParam(record, "refreshToken"),
        })
    })
    server.register("host/procs/read", (params) => readRuntimeProcs({ path: runtimeStringParam(runtimeRecordParam(params), "path") }))
    server.register("host/procs/file/read", (params) => readRuntimeProcsFile({ filePath: runtimeStringParam(runtimeRecordParam(params), "filePath") }))
    server.register("host/procs/file/write", (params) => {
        const record = runtimeRecordParam(params)
        return writeRuntimeProcsFile({
            filePath: runtimeStringParam(record, "filePath"),
            content: runtimeStringParam(record, "content"),
        })
    })
    server.register("host/procs/editable/load", (params) => {
        const record = runtimeRecordParam(params)
        return loadRuntimeEditableProcs({
            filePath: runtimeStringParam(record, "filePath"),
            searchPath: optionalRuntimeStringParam(record, "searchPath"),
        })
    })
    server.register("host/procs/raw/parse", (params) => {
        const record = runtimeRecordParam(params)
        return parseRuntimeEditableRaw({
            content: runtimeStringParam(record, "content"),
            relativePath: runtimeStringParam(record, "relativePath"),
        })
    })
    server.register("host/procs/editable/serialize", (params) => {
        const record = runtimeRecordParam(params)
        const processes = record.processes
        const crons = record.crons
        if (!Array.isArray(processes)) throw new Error("processes is invalid")
        if (!Array.isArray(crons)) throw new Error("crons is invalid")
        return serializeRuntimeEditableProcs({
            processes: processes as ProcessInput[],
            crons: crons as CronInput[],
        })
    })
    server.register("host/procs/editable/save", (params) => {
        const record = runtimeRecordParam(params)
        const processes = record.processes
        const crons = record.crons
        if (!Array.isArray(processes)) throw new Error("processes is invalid")
        if (!Array.isArray(crons)) throw new Error("crons is invalid")
        return saveRuntimeEditableProcs({
            filePath: runtimeStringParam(record, "filePath"),
            relativePath: runtimeStringParam(record, "relativePath"),
            processes: processes as ProcessInput[],
            crons: crons as CronInput[],
            searchPath: optionalRuntimeStringParam(record, "searchPath"),
        })
    })
    server.register("host/capabilities/read", () => getRuntimeCodeCapabilities())
    server.register("agent/sdkCapabilities/read", (params) => {
        const record = runtimeRecordParam(params)
        return getRuntimeSdkCapabilities({
            cwd: runtimeStringParam(record, "cwd"),
            harnessId: optionalRuntimeStringParam(record, "harnessId") as HarnessId | undefined,
        })
    })
    server.register("agent/sdkCapabilities/invalidate", (params) => {
        const record = runtimeRecordParam(params)
        return invalidateRuntimeSdkCapabilities({
            cwd: runtimeStringParam(record, "cwd"),
            harnessId: optionalRuntimeStringParam(record, "harnessId") as HarnessId | undefined,
        })
    })
    server.register("data/file/save", async (params) => {
        const record = runtimeRecordParam(params)
        await saveRuntimeDataFile({
            folder: runtimeStringParam(record, "folder"),
            id: runtimeStringParam(record, "id"),
            ext: runtimeStringParam(record, "ext"),
            data: Buffer.from(base64Param(record, "data"), "base64"),
        })
    })
    server.register("data/file/load", async (params) => {
        const record = runtimeRecordParam(params)
        const data = await loadRuntimeDataFile({
            folder: runtimeStringParam(record, "folder"),
            id: runtimeStringParam(record, "id"),
            ext: runtimeStringParam(record, "ext"),
        })
        if (data === null) return null
        return { data: (Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8")).toString("base64") }
    })
    server.register("data/file/delete", async (params) => {
        const record = runtimeRecordParam(params)
        await deleteRuntimeDataFile({
            folder: runtimeStringParam(record, "folder"),
            id: runtimeStringParam(record, "id"),
            ext: runtimeStringParam(record, "ext"),
        })
    })
    server.register("snapshot/bundle/save", (params) => {
        const record = runtimeRecordParam(params)
        return saveRuntimeSnapshotBundle({
            id: runtimeStringParam(record, "id"),
            patch: runtimeStringParam(record, "patch"),
            index: snapshotPatchIndexParam(record.index),
        })
    })
    server.register("snapshot/patch/read", (params) => loadRuntimeSnapshotPatch({ id: runtimeStringParam(runtimeRecordParam(params), "id") }))
    server.register("snapshot/index/read", (params) => loadRuntimeSnapshotIndex({ id: runtimeStringParam(runtimeRecordParam(params), "id") }))
    server.register("snapshot/patch/readSlice", (params) => {
        const record = runtimeRecordParam(params)
        return loadRuntimeSnapshotPatchSlice({
            id: runtimeStringParam(record, "id"),
            start: runtimeNumberParam(record, "start"),
            end: runtimeNumberParam(record, "end"),
        })
    })
    server.register("snapshot/bundle/delete", (params) => deleteRuntimeSnapshotBundle({ id: runtimeStringParam(runtimeRecordParam(params), "id") }))
}

async function buildHarnessPrompt(text: string, images?: unknown[]): Promise<string | HarnessContentBlock[]> {
    const attachments = imageAttachments(images)
    if (attachments.length === 0) return text

    const blocks: HarnessContentBlock[] = []
    for (const image of attachments) {
        try {
            const data = await fs.readFile(path.join(os.homedir(), ".openade", "data", "images", `${image.id}.${image.ext}`), "base64")
            blocks.push({ type: "image", source: { type: "base64", media_type: image.mediaType, data } })
        } catch (error) {
            console.warn("[RuntimeGateway] Failed to attach image to prompt", { imageId: image.id, error })
        }
    }

    if (blocks.length === 0) return text
    blocks.push({ type: "text", text })
    return blocks
}

function eventRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function collectSnapshotPatchIds(task: OpenADETask): string[] {
    const ids = new Set<string>()
    for (const rawEvent of task.events) {
        const event = eventRecord(rawEvent)
        if (!event || event.type !== "snapshot" || typeof event.patchFileId !== "string") continue
        ids.add(event.patchFileId)
    }
    return [...ids]
}

function collectTaskImages(task: OpenADETask): Array<{ id: string; ext: string }> {
    const images = new Map<string, { id: string; ext: string }>()
    for (const rawEvent of task.events) {
        const event = eventRecord(rawEvent)
        if (!event || event.type !== "action") continue
        for (const image of imageAttachments(event.images)) {
            images.set(`${image.id}.${image.ext}`, { id: image.id, ext: image.ext })
        }
    }
    return [...images.values()]
}

function collectTaskSessions(task: OpenADETask): Array<{ sessionId: string; harnessId: string }> {
    const sessions = new Map<string, string>()
    for (const sessionId of Object.values(task.sessionIds ?? {})) {
        if (sessionId) sessions.set(sessionId, "claude-code")
    }

    for (const rawEvent of task.events) {
        const event = eventRecord(rawEvent)
        if (!event || event.type !== "action") continue
        const execution = eventRecord(event.execution)
        const harnessId = typeof execution?.harnessId === "string" ? execution.harnessId : "claude-code"
        if (typeof execution?.sessionId === "string" && execution.sessionId) sessions.set(execution.sessionId, harnessId)

        const subExecutions = Array.isArray(event.hyperplanSubExecutions) ? event.hyperplanSubExecutions : []
        for (const rawSubExecution of subExecutions) {
            const subExecution = eventRecord(rawSubExecution)
            if (!subExecution) continue
            const subHarnessId = typeof subExecution.harnessId === "string" ? subExecution.harnessId : harnessId
            if (typeof subExecution.sessionId === "string" && subExecution.sessionId) sessions.set(subExecution.sessionId, subHarnessId)
        }
    }

    return [...sessions.entries()].map(([sessionId, harnessId]) => ({ sessionId, harnessId }))
}

async function cleanupTaskResources(task: OpenADETask, repoPath: string, options: NonNullable<OpenADETaskDeleteRequest["options"]>): Promise<void> {
    const active = activeTaskExecutions.get(task.id)
    if (active) {
        active.stopping = true
        abortRuntimeHarnessQuery({ executionId: active.executionId })
        for (const executionId of active.childExecutionIds ?? []) {
            abortRuntimeHarnessQuery({ executionId })
        }
        activeTaskExecutions.delete(task.id)
    }
    await killRuntimePty({ ptyId: task.id }).catch(() => ({ ok: false }))

    if (options.deleteSnapshots) {
        await Promise.all(collectSnapshotPatchIds(task).map((id) => deleteRuntimeSnapshotBundle({ id }).catch(() => undefined)))
    }

    if (options.deleteImages) {
        await Promise.all(
            collectTaskImages(task).map((image) =>
                deleteRuntimeDataFile({ folder: "images", id: image.id, ext: image.ext }).catch(() => undefined)
            )
        )
    }

    if (options.deleteSessions) {
        await Promise.all(collectTaskSessions(task).map((session) => deleteRuntimeHarnessSession(session).catch(() => ({ ok: false }))))
    }

    if (options.deleteWorktrees && task.isolationStrategy?.type === "worktree") {
        const gitInfo = await isRuntimeGitDirectory({ directory: repoPath }).catch(() => null)
        if (gitInfo?.isGitDirectory) {
            await deleteRuntimeWorkTree({ repoDir: gitInfo.repoRoot, id: task.slug }).catch(() => undefined)
            await deleteRuntimeBranch({ repoDir: gitInfo.repoRoot, branchName: `openade/${task.slug}` }).catch(() => undefined)
        }
    }
}

function isMcpServerItem(value: Record<string, unknown>): boolean {
    return typeof value.id === "string" && typeof value.name === "string" && value.enabled === true
}

async function buildRuntimeMcpServerConfigs(storage: OpenADEYjsStorage, enabledServerIds?: string[]): Promise<Record<string, McpServerConfig> | undefined> {
    if (!enabledServerIds || enabledServerIds.length === 0) return undefined

    const enabled = new Set(enabledServerIds)
    const rows = (await storage.readOrderedArray<Record<string, unknown>>("code:mcp_servers", "mcp_servers")) ?? []
    const configs: Record<string, McpServerConfig> = {}

    for (const row of rows) {
        if (!isMcpServerItem(row) || !enabled.has(row.id as string)) continue
        const name = row.name as string
        if (row.transportType === "http" && typeof row.url === "string") {
            const headers = typeof row.headers === "object" && row.headers !== null && !Array.isArray(row.headers) ? { ...(row.headers as Record<string, string>) } : {}
            const oauthTokens = typeof row.oauthTokens === "object" && row.oauthTokens !== null ? (row.oauthTokens as Record<string, unknown>) : {}
            if (typeof oauthTokens.accessToken === "string" && oauthTokens.accessToken) {
                headers.Authorization = `Bearer ${oauthTokens.accessToken}`
            }
            configs[name] = Object.keys(headers).length > 0 ? { type: "http", url: row.url, headers } : { type: "http", url: row.url }
        } else if (row.transportType === "stdio" && typeof row.command === "string") {
            const config: Extract<McpServerConfig, { type: "stdio" }> = { type: "stdio", command: row.command }
            if (Array.isArray(row.args)) config.args = row.args.filter((arg): arg is string => typeof arg === "string")
            if (typeof row.envVars === "object" && row.envVars !== null && !Array.isArray(row.envVars)) {
                config.env = row.envVars as Record<string, string>
            }
            configs[name] = config
        }
    }

    return Object.keys(configs).length > 0 ? configs : undefined
}

function publishTaskChanged(server: RuntimeServer, repoId: string, taskId: string): void {
    publishOpenADECompanionEvent(server, {
        type: "task_changed",
        repoId,
        taskId,
        at: new Date().toISOString(),
    })
    publishOpenADECompanionEvent(server, { type: "snapshot_changed", at: new Date().toISOString() })
}

function publishWorkingTasks(server: RuntimeServer): void {
    configurePowerKeeper({ runningTaskCount: activeTaskExecutions.size })
    publishOpenADECompanionEvent(server, {
        type: "working_tasks",
        taskIds: [...activeTaskExecutions.keys()],
        at: new Date().toISOString(),
    })
}

async function reconcileCheckpointedOpenADEActionEvents(
    server: RuntimeServer,
    writer: ReturnType<typeof createOpenADEYjsWriter>
): Promise<void> {
    const terminalStatuses = new Set(["completed", "failed", "stopped"])
    for (const runtime of server.supervisor.list({ ownerType: "openade-task" })) {
        if (!terminalStatuses.has(runtime.status)) continue
        const taskId = runtime.scope.ownerId
        if (!taskId) continue
        const labels = runtime.scope.labels ?? {}
        const eventId = typeof labels.eventId === "string" ? labels.eventId : undefined
        const executionId = typeof labels.executionId === "string" ? labels.executionId : runtime.nativeId
        if (!eventId && !executionId) continue

        const result = await writer.reconcileActionEventRuntime({
            taskId,
            eventId,
            executionId,
            status: runtime.status === "failed" ? "failed" : runtime.status === "stopped" ? "stopped" : "completed",
            success: runtime.status === "completed" ? true : undefined,
        }).catch((error) => {
            console.warn("[RuntimeGateway] Failed to reconcile checkpointed OpenADE runtime", { runtimeId: runtime.runtimeId, error })
            return null
        })
        if (result?.changed && result.repoId) publishTaskChanged(server, result.repoId, taskId)
    }
}

async function stopActiveOpenADERuntime(
    server: RuntimeServer,
    writer: ReturnType<typeof createOpenADEYjsWriter>,
    runtime: RuntimeRecord
): Promise<boolean> {
    if (runtime.scope.ownerType !== "openade-task" && runtime.scope.ownerType !== "openade-turn" && runtime.scope.ownerType !== "openade-review") return false
    const activeEntry = [...activeTaskExecutions.entries()].find(([, active]) => active.runtimeId === runtime.runtimeId)
    if (!activeEntry) return false

    const [taskId, active] = activeEntry
    active.stopping = true
    const results = [abortRuntimeHarnessQuery({ executionId: active.executionId })]
    for (const executionId of active.childExecutionIds ?? []) {
        results.push(abortRuntimeHarnessQuery({ executionId }))
    }
    const failed = results.find((result) => result && typeof result === "object" && "ok" in result && result.ok === false)
    if (failed && typeof failed === "object" && "error" in failed) {
        throw new RuntimeHandlerError("stop_failed", typeof failed.error === "string" ? failed.error : "Failed to stop OpenADE runtime", {
            runtimeId: runtime.runtimeId,
        })
    }

    await writer.stoppedActionEvent({ taskId, eventId: active.eventId })
    activeTaskExecutions.delete(taskId)
    publishWorkingTasks(server)
    publishTaskChanged(server, active.repoId, taskId)
    return true
}

function worktreeSetupOutput(params: {
    worktreeDir: string
    workingDir: string
    sourceBranch: string
    mergeBaseCommit?: string
}): string {
    return [
        `Worktree: ${params.worktreeDir}`,
        `Working directory: ${params.workingDir}`,
        `Branch: ${params.sourceBranch}`,
        params.mergeBaseCommit ? `Merge base: ${params.mergeBaseCommit.slice(0, 8)}` : "",
    ]
        .filter(Boolean)
        .join("\n")
}

function snapshotBaseForTask(task: OpenADETask, deviceEnvironment?: OpenADETaskDeviceEnvironment): SnapshotBase | undefined {
    const isolationStrategy = task.isolationStrategy ?? { type: "head" }
    if (isolationStrategy.type === "head") {
        return {
            referenceBranch: "uncommitted",
            mergeBaseCommit: "HEAD",
            fromTreeish: "HEAD",
        }
    }

    const mergeBaseCommit = deviceEnvironment?.mergeBaseCommit
    if (!mergeBaseCommit) return undefined

    return {
        referenceBranch: isolationStrategy.sourceBranch,
        mergeBaseCommit,
        fromTreeish: mergeBaseCommit,
    }
}

function latestSnapshotEvent(task: OpenADETask): Record<string, unknown> | null {
    for (let index = task.events.length - 1; index >= 0; index--) {
        const event = task.events[index]
        if (typeof event !== "object" || event === null || Array.isArray(event)) continue
        const record = event as Record<string, unknown>
        if (record.type === "snapshot") return record
    }
    return null
}

function latestCompletedPlanEvent(task: OpenADETask): Record<string, unknown> | undefined {
    for (let index = task.events.length - 1; index >= 0; index--) {
        const event = task.events[index]
        if (typeof event !== "object" || event === null || Array.isArray(event)) continue
        const record = event as Record<string, unknown>
        if (record.type !== "action" || record.status !== "completed" || typeof record.id !== "string") continue
        const source = typeof record.source === "object" && record.source !== null ? (record.source as Record<string, unknown>) : {}
        if (source.type === "plan" || source.type === "revise" || source.type === "hyperplan") return record
    }
    return undefined
}

function latestCompletedPlanEventId(task: OpenADETask): string | undefined {
    return latestCompletedPlanEvent(task)?.id as string | undefined
}

function recentSnapshotFiles(task: OpenADETask, limit = 40): string[] {
    const summaries: string[] = []
    const seen = new Set<string>()

    for (let index = task.events.length - 1; index >= 0 && summaries.length < limit; index--) {
        const event = task.events[index]
        if (typeof event !== "object" || event === null || Array.isArray(event)) continue
        const record = event as Record<string, unknown>
        if (record.type !== "snapshot") continue
        const files = Array.isArray(record.files) ? record.files : []
        for (const fileValue of files) {
            if (typeof fileValue !== "object" || fileValue === null || Array.isArray(fileValue)) continue
            const file = fileValue as Record<string, unknown>
            const path = typeof file.path === "string" ? file.path : undefined
            const status = typeof file.status === "string" ? file.status : undefined
            if (!path || !status) continue
            const oldPath = typeof file.oldPath === "string" ? file.oldPath : undefined
            const summary = status === "renamed" && oldPath ? `renamed: ${oldPath} -> ${path}` : `${status}: ${path}`
            if (seen.has(summary)) continue
            seen.add(summary)
            summaries.push(summary)
            if (summaries.length >= limit) break
        }
    }

    return summaries
}

function taskReviewThreadXml(task: OpenADETask): string {
    const events = task.events.filter((event) => {
        const record = typeof event === "object" && event !== null && !Array.isArray(event) ? (event as Record<string, unknown>) : {}
        return record.type !== "snapshot"
    })
    const maxBytes = 240_000
    const included: unknown[] = []
    let byteLength = 0
    for (let index = events.length - 1; index >= 0; index--) {
        const eventText = JSON.stringify(events[index])
        const eventBytes = Buffer.byteLength(eventText, "utf8")
        if (included.length > 0 && byteLength + eventBytes > maxBytes) break
        included.unshift(events[index])
        byteLength += eventBytes
    }
    return JSON.stringify(included, null, 2)
}

async function latestSnapshotPatch(task: OpenADETask): Promise<string | undefined> {
    const snapshot = latestSnapshotEvent(task)
    if (!snapshot) return undefined
    if (typeof snapshot.fullPatch === "string" && snapshot.fullPatch.length > 0) return snapshot.fullPatch
    if (typeof snapshot.patchFileId === "string" && snapshot.patchFileId.length > 0) {
        return (await loadRuntimeSnapshotPatch({ id: snapshot.patchFileId })) ?? undefined
    }
    return undefined
}

async function buildSnapshotPatch(rootPath: string, fromTreeish: string): Promise<SnapshotPatchResult> {
    const changedFiles = await getRuntimeChangedFiles({
        workDir: rootPath,
        fromTreeish,
        toTreeish: "",
    })

    if (changedFiles.files.length === 0) {
        return {
            patch: "",
            index: { version: 1, patchSize: 0, files: [] },
            stats: { filesChanged: 0, insertions: 0, deletions: 0 },
            files: [],
        }
    }

    const patchParts: string[] = []
    const index: SnapshotPatchIndex = { version: 1, patchSize: 0, files: [] }
    let insertions = 0
    let deletions = 0

    for (const file of changedFiles.files) {
        const patchResult = await getRuntimeWorktreeFilePatch({
            workDir: rootPath,
            fromTreeish,
            filePath: file.path,
            oldPath: file.oldPath,
            contextLines: 3,
            allowTruncation: false,
        })
        if (!patchResult.patch) continue

        const normalizedPatch = patchResult.patch.endsWith("\n") ? patchResult.patch : `${patchResult.patch}\n`
        const patchStart = index.patchSize
        const patchSize = Buffer.byteLength(normalizedPatch, "utf8")
        const patchEnd = patchStart + patchSize

        patchParts.push(normalizedPatch)
        index.patchSize = patchEnd
        index.files.push(snapshotPatchFile(String(index.files.length), file, patchResult, normalizedPatch, patchStart, patchEnd))
        insertions += patchResult.stats.insertions
        deletions += patchResult.stats.deletions
    }

    return {
        patch: patchParts.join(""),
        index,
        stats: {
            filesChanged: index.files.length,
            insertions,
            deletions,
        },
        files: index.files.map((file) => ({
            path: file.path,
            status: file.status,
            ...(file.oldPath ? { oldPath: file.oldPath } : {}),
        })),
    }
}

function snapshotPatchFile(
    id: string,
    file: ChangedFileInfo,
    patchResult: Awaited<ReturnType<typeof getRuntimeWorktreeFilePatch>>,
    patch: string,
    patchStart: number,
    patchEnd: number
): SnapshotPatchFile {
    return {
        id,
        path: file.path,
        oldPath: file.oldPath,
        status: file.status,
        binary: patch.includes("Binary files ") || patch.includes("GIT binary patch"),
        insertions: patchResult.stats.insertions,
        deletions: patchResult.stats.deletions,
        changedLines: patchResult.stats.changedLines,
        hunkCount: patchResult.stats.hunkCount,
        patchStart,
        patchEnd,
    }
}

async function createSnapshotForCompletedTurn({
    writer,
    task,
    taskId,
    eventId,
    rootPath,
    snapshotBase,
    previousPatch,
}: {
    writer: ReturnType<typeof createOpenADEYjsWriter>
    task: OpenADETask
    taskId: string
    eventId: string
    rootPath: string
    snapshotBase?: SnapshotBase
    previousPatch?: string
}): Promise<boolean> {
    if (!snapshotBase) return false

    try {
        const patchResult = await buildSnapshotPatch(rootPath, snapshotBase.fromTreeish)
        if (patchResult.stats.filesChanged === 0 && patchResult.stats.insertions === 0 && patchResult.stats.deletions === 0) return false
        if (previousPatch === patchResult.patch) return false

        const snapshotEventId = `snapshot-${randomUUID()}`
        let fullPatch = patchResult.patch
        let patchFileId: string | undefined
        try {
            await saveRuntimeSnapshotBundle({ id: snapshotEventId, patch: patchResult.patch, index: patchResult.index })
            fullPatch = ""
            patchFileId = snapshotEventId
        } catch (error) {
            console.warn("[RuntimeGateway] Failed to save snapshot patch bundle; storing patch inline:", error)
        }

        await writer.createSnapshotEvent({
            taskId,
            actionEventId: eventId,
            referenceBranch: snapshotBase.referenceBranch,
            mergeBaseCommit: snapshotBase.mergeBaseCommit,
            fullPatch,
            patchFileId,
            stats: patchResult.stats,
            files: patchResult.files,
            eventId: snapshotEventId,
        })
        return true
    } catch (error) {
        console.warn("[RuntimeGateway] Failed to create snapshot for completed turn:", {
            taskId: task.id,
            eventId,
            error,
        })
        return false
    }
}

async function createTaskEnvironment({
    repoPath,
    slug,
    isolationStrategy,
    createdAt,
}: {
    repoPath: string
    slug: string
    isolationStrategy: NonNullable<OpenADETurnStartRequest["isolationStrategy"]>
    createdAt: string
}): Promise<{
    deviceEnvironment: OpenADETaskDeviceEnvironment
    setupEvent?: OpenADESetupEnvironmentEventCreateRequest
    cwd: string
    rootPath: string
}> {
    const deviceId = getDeviceConfig().deviceId
    if (isolationStrategy.type === "head") {
        return {
            deviceEnvironment: {
                id: deviceId,
                deviceId,
                setupComplete: true,
                createdAt,
                lastUsedAt: createdAt,
            },
            cwd: repoPath,
            rootPath: repoPath,
        }
    }

    const gitInfo = await isRuntimeGitDirectory({ directory: repoPath })
    if (!gitInfo.isGitDirectory) {
        throw new Error("Worktree mode requires a git repository")
    }

    const sourceBranch = isolationStrategy.sourceBranch || gitInfo.mainBranch || "main"
    const worktree = await getOrCreateRuntimeWorkTree({
        repoDir: gitInfo.repoRoot,
        id: slug,
        sourceTreeish: sourceBranch,
    })
    let mergeBaseCommit: string | undefined
    try {
        const mergeBase = await getRuntimeMergeBase({
            repoDir: gitInfo.repoRoot,
            workTreeId: slug,
            targetBranch: sourceBranch,
        })
        mergeBaseCommit = mergeBase.mergeBaseCommit
    } catch (error) {
        console.warn("[RuntimeGateway] Failed to resolve worktree merge base:", error)
    }

    const workingDir = gitInfo.relativePath ? `${worktree.worktreeDir}/${gitInfo.relativePath}` : worktree.worktreeDir
    return {
        deviceEnvironment: {
            id: deviceId,
            deviceId,
            worktreeDir: worktree.worktreeDir,
            setupComplete: true,
            mergeBaseCommit,
            createdAt,
            lastUsedAt: createdAt,
        },
        setupEvent: {
            eventId: `setup-${deviceId}`,
            worktreeId: slug,
            deviceId,
            workingDir,
            setupOutput: worktreeSetupOutput({
                worktreeDir: worktree.worktreeDir,
                workingDir,
                sourceBranch,
                mergeBaseCommit,
            }),
            createdAt,
            completedAt: createdAt,
        },
        cwd: workingDir,
        rootPath: worktree.worktreeDir,
    }
}

async function ensureTaskExecutionEnvironment({
    repoPath,
    task,
    writer,
}: {
    repoPath: string
    task: OpenADETask
    writer: ReturnType<typeof createOpenADEYjsWriter>
}): Promise<TaskExecutionEnvironment> {
    const isolationStrategy = task.isolationStrategy ?? { type: "head" }
    if (isolationStrategy.type === "head") {
        return {
            cwd: repoPath,
            rootPath: repoPath,
            snapshotBase: snapshotBaseForTask(task),
        }
    }

    const deviceId = getDeviceConfig().deviceId
    const existing = task.deviceEnvironments.find((environment) => environment.deviceId === deviceId && environment.setupComplete && environment.worktreeDir)
    if (existing?.worktreeDir) {
        const gitInfo = await isRuntimeGitDirectory({ directory: repoPath })
        const relativePath = gitInfo.isGitDirectory ? gitInfo.relativePath : ""
        return {
            cwd: relativePath ? `${existing.worktreeDir}/${relativePath}` : existing.worktreeDir,
            rootPath: existing.worktreeDir,
            snapshotBase: snapshotBaseForTask(task, existing),
        }
    }

    const createdAt = new Date().toISOString()
    const environment = await createTaskEnvironment({
        repoPath,
        slug: task.slug,
        isolationStrategy,
        createdAt,
    })
    await writer.setupTaskEnvironment({
        taskId: task.id,
        deviceEnvironment: environment.deviceEnvironment,
        setupEvent: environment.setupEvent,
    })
    return {
        cwd: environment.cwd,
        rootPath: environment.rootPath,
        snapshotBase: snapshotBaseForTask(task, environment.deviceEnvironment),
    }
}

function registerOpenADEProductModule(server: RuntimeServer): void {
    const yjsStorage = createOpenADEYjsStorageAdapter({ hostName: () => os.hostname() })
    const projection = createOpenADEYjsProjection(yjsStorage)
    const writer = createOpenADEYjsWriter(yjsStorage)
    const publishChangedTask = async (taskId: string) => {
        const projects = await projection.readProjects()
        const repo = projects.find((project) => project.tasks.some((task) => task.id === taskId))
        if (repo) publishTaskChanged(server, repo.id, taskId)
    }

    server.registerRuntimeStopHandler((runtime) => stopActiveOpenADERuntime(server, writer, runtime))

    server.registerModule(
        createOpenADEModule({
            ...projection,
            version: () => process.env.RELEASE ?? "local",
            saveDataDocumentBase64: (id, data) => yjsStorage.saveDocumentUpdate(id, Buffer.from(data, "base64")),
            deleteDataDocument: (id) => yjsStorage.deleteDocument(id),
            createRepo: async (params) => {
                const result = await writer.createRepo(params)
                publishOpenADECompanionEvent(server, { type: "repo_changed", repoId: result.repoId, at: result.createdAt })
                return result
            },
            updateRepo: async (params) => {
                const updatedAt = params.updatedAt ?? new Date().toISOString()
                await writer.updateRepo({ ...params, updatedAt })
                publishOpenADECompanionEvent(server, { type: "repo_changed", repoId: params.repoId, at: updatedAt })
            },
            deleteRepo: async (params) => {
                const at = new Date().toISOString()
                await writer.deleteRepo(params)
                publishOpenADECompanionEvent(server, { type: "repo_deleted", repoId: params.repoId, at })
            },
            startTurn: async (params, context) => {
                if (!canCreateTaskInRuntime(params)) {
                    if (!params.inTaskId) throw new Error("Task id is required for existing task execution")
                    const existingTask = await projection.readTask(params.repoId, params.inTaskId)
                    if (!canExecuteTaskInRuntime(existingTask)) {
                        throw new Error("Server-owned execution supports head and worktree tasks only")
                    }
                    const started = await startHeadModeTurn({
                        server,
                        writer,
                        projection,
                        yjsStorage,
                        params,
                        taskId: existingTask.id,
                        context,
                    })
                    return { taskId: existingTask.id, eventId: started.eventId }
                }

                const repo = (await projection.readProjects()).find((project) => project.id === params.repoId)
                if (!repo) throw new Error(`Repository ${params.repoId} not found`)
                const createdAt = new Date().toISOString()
                const isolationStrategy = params.isolationStrategy ?? { type: "head" }
                const taskId = taskIdForClientRequest(params.repoId, params.clientRequestId)
                const slug = taskId ?? fallbackSlug()
                const environment = await createTaskEnvironment({
                    repoPath: repo.path,
                    slug,
                    isolationStrategy,
                    createdAt,
                })

                const created = await writer.createTask({
                    repoId: params.repoId,
                    input: params.input,
                    taskId,
                    slug,
                    title: params.title ?? fallbackTitle(params.input),
                    createdBy: { id: "local-user", email: "local@openade.dev" },
                    deviceId: getDeviceConfig().deviceId,
                    createdAt,
                    isolationStrategy,
                    enabledMcpServerIds: params.enabledMcpServerIds,
                    deviceEnvironment: environment.deviceEnvironment,
                    setupEvent: environment.setupEvent,
                })

                const started = await startHeadModeTurn({
                    server,
                    writer,
                    projection,
                    yjsStorage,
                    params,
                    taskId: created.taskId,
                    context,
                })
                return { taskId: created.taskId, eventId: started.eventId }
            },
            startReview: async (params, context) =>
                startReviewTurn({
                    server,
                    writer,
                    projection,
                    yjsStorage,
                    params,
                    context,
                }),
            interruptTurn: async (params) => {
                const active = activeTaskExecutions.get(params.taskId)
                if (active) {
                    active.stopping = true
                    abortRuntimeHarnessQuery({ executionId: active.executionId })
                    for (const executionId of active.childExecutionIds ?? []) {
                        abortRuntimeHarnessQuery({ executionId })
                    }
                    return { ok: true }
                }
                return { ok: false, error: "No server-owned turn is running for this task" }
            },
            setupTaskEnvironment: async (params) => {
                await writer.setupTaskEnvironment(params)
                await publishChangedTask(params.taskId)
            },
            createActionEvent: async (params) => {
                const result = await writer.createActionEvent(params)
                await publishChangedTask(params.taskId)
                return result
            },
            appendActionStreamEvent: async (params) => {
                await writer.appendActionStreamEvent(params)
                await publishChangedTask(params.taskId)
            },
            completeActionEvent: async (params) => {
                await writer.completeActionEvent(params)
                await publishChangedTask(params.taskId)
            },
            errorActionEvent: async (params) => {
                await writer.errorActionEvent(params)
                await publishChangedTask(params.taskId)
            },
            stoppedActionEvent: async (params) => {
                await writer.stoppedActionEvent(params)
                await publishChangedTask(params.taskId)
            },
            reconcileActionEventRuntime: async (params) => {
                const result = await writer.reconcileActionEventRuntime(params)
                if (result.changed) await publishChangedTask(params.taskId)
                return result
            },
            updateActionExecution: async (params) => {
                await writer.updateActionExecution(params)
                await publishChangedTask(params.taskId)
            },
            addHyperPlanSubExecution: async (params) => {
                await writer.addHyperPlanSubExecution(params)
                await publishChangedTask(params.taskId)
            },
            appendHyperPlanSubExecutionStreamEvent: async (params) => {
                await writer.appendHyperPlanSubExecutionStreamEvent(params)
                await publishChangedTask(params.taskId)
            },
            updateHyperPlanSubExecution: async (params) => {
                await writer.updateHyperPlanSubExecution(params)
                await publishChangedTask(params.taskId)
            },
            setHyperPlanReconcileLabels: async (params) => {
                await writer.setHyperPlanReconcileLabels(params)
                await publishChangedTask(params.taskId)
            },
            createSnapshotEvent: async (params) => {
                const result = await writer.createSnapshotEvent(params)
                await publishChangedTask(params.taskId)
                return result
            },
            createComment: async (params) => {
                const result = await writer.createComment(params)
                await publishChangedTask(params.taskId)
                return result
            },
            editComment: async (params) => {
                await writer.editComment(params)
                await publishChangedTask(params.taskId)
            },
            deleteComment: async (params) => {
                await writer.deleteComment(params)
                await publishChangedTask(params.taskId)
            },
            updateTaskMetadata: async (params) => {
                const at = params.updatedAt ?? new Date().toISOString()
                if (params.closed) {
                    await killRuntimePty({ ptyId: params.taskId }).catch(() => ({ ok: false }))
                }
                await writer.updateTaskMetadata({ ...params, updatedAt: at })
                const projects = await projection.readProjects()
                const repo = projects.find((project) => project.tasks.some((task) => task.id === params.taskId))
                if (repo) publishOpenADECompanionEvent(server, { type: "task_changed", repoId: repo.id, taskId: params.taskId, at })
            },
            deleteTask: async (params) => {
                const repo = (await projection.readProjects()).find((project) => project.id === params.repoId)
                if (!repo) throw new Error(`Repository ${params.repoId} not found`)
                const task = await projection.readTask(params.repoId, params.taskId)
                await cleanupTaskResources(task, repo.path, params.options ?? {})
                const result = await writer.deleteTask(params)
                publishOpenADECompanionEvent(server, { type: "task_deleted", repoId: params.repoId, taskId: params.taskId, at: new Date().toISOString() })
                return result
            },
        })
    )

    void reconcileCheckpointedOpenADEActionEvents(server, writer)

}

async function startHeadModeTurn({
    server,
    writer,
    projection,
    yjsStorage,
    params,
    taskId,
    context,
}: {
    server: RuntimeServer
    writer: ReturnType<typeof createOpenADEYjsWriter>
    projection: ReturnType<typeof createOpenADEYjsProjection>
    yjsStorage: OpenADEYjsStorage
    params: OpenADETurnStartRequest
    taskId: string
    context?: OpenADETurnStartContext
}): Promise<{ eventId: string }> {
    const task = await projection.readTask(params.repoId, taskId)
    if (params.type === "hyperplan") {
        const fallbackHarnessId = harnessIdForTurn(params, task)
        const fallbackModelId = modelIdForTurn(params, task, fallbackHarnessId) ?? getDefaultModelForHarness(fallbackHarnessId)
        const strategy =
            params.hyperplanStrategy ??
            resolveOpenADEHyperPlanStrategy({
                settings: await projection.readPersonalSettings(),
                fallbackAgent: { harnessId: fallbackHarnessId, modelId: fallbackModelId },
            })

        if (isStandardOpenADEHyperPlanStrategy(strategy)) {
            const step = strategy.steps[0]
            return startHeadModeTurn({
                server,
                writer,
                projection,
                params: {
                    ...params,
                    type: "plan",
                    harnessId: step.agent.harnessId,
                    modelId: step.agent.modelId,
                },
                taskId,
                yjsStorage,
                context,
            })
        }

        return startHyperPlanTurn({
            server,
            writer,
            projection,
            yjsStorage,
            params,
            task,
            strategy,
            context,
        })
    }

    if (!canExecuteTaskInRuntime(task)) {
        throw new Error("Server-owned execution supports head and worktree tasks only")
    }

    const repo = (await projection.readProjects()).find((project) => project.id === params.repoId)
    if (!repo) throw new Error(`Repository ${params.repoId} not found`)
    const executionEnvironment = await ensureTaskExecutionEnvironment({
        repoPath: repo.path,
        task,
        writer,
    })

    let promptType = params.type
    let planEventId = latestCompletedPlanEventId(task)
    if (promptType === "revise" && !planEventId) {
        promptType = "plan"
        planEventId = undefined
    }
    if (promptType === "run_plan" && !planEventId) {
        throw new Error("Run Plan requires a completed plan event")
    }

    const prompt = buildOpenADEPrompt({
        type: promptType as "plan" | "do" | "ask" | "revise" | "run_plan",
        input: params.input,
        comments: task.comments as Parameters<typeof buildOpenADEPrompt>[0]["comments"],
        label: params.label,
        includeComments: params.includeComments,
        planEventId,
    })
    const previousSnapshotPatch = prompt.createSnapshot ? await latestSnapshotPatch(task) : undefined
    const mcpServerConfigs = await buildRuntimeMcpServerConfigs(yjsStorage, task.enabledMcpServerIds)
    const executionId = executionIdForTask(taskId)
    const harnessId = harnessIdForTurn(params, task)
    const sessionContext = lastActionSessionContext(task)
    const modelId = modelIdForTurn(params, task, harnessId)
    const gitRefsBefore = await getGitRefs(executionEnvironment.rootPath)
    const createdEvent = await writer.createActionEvent({
        taskId,
        userInput: params.input,
        executionId,
        harnessId,
        source: prompt.source as OpenADEActionEventSource,
        images: params.images && params.images.length > 0 ? params.images : undefined,
        includesCommentIds: prompt.consumedCommentIds,
        modelId,
        fastMode: params.fastMode,
        gitRefsBefore,
    })
    const runtimeId = context?.runtimeId ?? `openade-turn:${taskId}`
    const runtimePatch = {
        status: "running",
        scope: {
            ownerType: "openade-task",
            ownerId: taskId,
            repoPath: repo.path,
            rootPath: executionEnvironment.rootPath,
            labels: {
                eventId: createdEvent.eventId,
                executionId,
            },
        },
        nativeId: executionId,
    } as const
    const runtime =
        server.supervisor.update(runtimeId, runtimePatch) ??
        server.supervisor.create({
            runtimeId,
            kind: "agent",
            ...runtimePatch,
        })
    server.notify("runtime/updated", runtime)
    const activeExecution: ActiveTaskExecution = { executionId, runtimeId, repoId: params.repoId, eventId: createdEvent.eventId }
    activeTaskExecutions.set(taskId, activeExecution)
    publishWorkingTasks(server)
    publishTaskChanged(server, params.repoId, taskId)

    void runHeadModeTurnExecution({
        server,
        writer,
        repoId: params.repoId,
        task,
        taskId,
        eventId: createdEvent.eventId,
        executionId,
        harnessId,
        modelId,
        cwd: executionEnvironment.cwd,
        rootPath: executionEnvironment.rootPath,
        prompt: await buildHarnessPrompt(prompt.userMessage, params.images),
        appendSystemPrompt: mergeAppendSystemPrompt(prompt.systemPrompt, params.appendSystemPrompt),
        readOnly: prompt.readOnly,
        createSnapshot: prompt.createSnapshot,
        snapshotBase: executionEnvironment.snapshotBase,
        previousSnapshotPatch,
        mcpServerConfigs,
        thinking: params.thinking,
        fastMode: params.fastMode,
        resumeSessionId: sessionContext?.sessionId,
        runtimeId,
        isStopping: () => activeExecution.stopping === true,
    })

    return { eventId: createdEvent.eventId }
}

async function startReviewTurn({
    server,
    writer,
    projection,
    yjsStorage,
    params,
    context,
}: {
    server: RuntimeServer
    writer: ReturnType<typeof createOpenADEYjsWriter>
    projection: ReturnType<typeof createOpenADEYjsProjection>
    yjsStorage: OpenADEYjsStorage
    params: OpenADEReviewStartRequest
    context?: OpenADETurnStartContext
}): Promise<{ taskId: string; eventId: string }> {
    const task = await projection.readTask(params.repoId, params.taskId)
    if (!canExecuteTaskInRuntime(task)) throw new Error("Server-owned review supports head and worktree tasks only")
    const repo = (await projection.readProjects()).find((project) => project.id === params.repoId)
    if (!repo) throw new Error(`Repository ${params.repoId} not found`)

    const executionEnvironment = await ensureTaskExecutionEnvironment({
        repoPath: repo.path,
        task,
        writer,
    })
    const threadXml = taskReviewThreadXml(task)
    const changedFiles = recentSnapshotFiles(task)
    const latestPlan = latestCompletedPlanEvent(task)
    const latestPlanExecution =
        typeof latestPlan?.execution === "object" && latestPlan.execution !== null && !Array.isArray(latestPlan.execution)
            ? (latestPlan.execution as Record<string, unknown>)
            : undefined
    const latestPlanEvents = Array.isArray(latestPlanExecution?.events)
        ? latestPlanExecution.events.filter((event): event is Record<string, unknown> => typeof event === "object" && event !== null && !Array.isArray(event))
        : []
    const latestPlanHarnessId = typeof latestPlanExecution?.harnessId === "string" ? latestPlanExecution.harnessId : params.harnessId
    const planText = latestPlan ? (extractOpenADEPlanText(latestPlanEvents, latestPlanHarnessId) ?? "") : ""
    const reviewPrompt =
        params.reviewType === "plan"
            ? buildOpenADEPlanReviewPrompt({
                  threadXml,
                  planText,
                  changedFiles,
                  customInstructions: params.customInstructions,
              })
            : buildOpenADEWorkReviewPrompt({
                  threadXml,
                  changedFiles,
                  customInstructions: params.customInstructions,
              })

    const userLabel = params.reviewType === "plan" ? "Review Plan" : "Review"
    const reviewDisplayInput = params.customInstructions?.trim() ? `${userLabel}: ${params.customInstructions.trim()}` : userLabel
    const executionId = executionIdForTask(params.taskId)
    const runtimeId = context?.runtimeId ?? `openade-review:${params.taskId}`
    const gitRefsBefore = await getGitRefs(executionEnvironment.rootPath)
    const createdEvent = await writer.createActionEvent({
        taskId: params.taskId,
        userInput: reviewDisplayInput,
        executionId,
        harnessId: params.harnessId as HarnessId,
        source: { type: "review", userLabel, reviewType: params.reviewType, userInstructions: reviewPrompt.userMessage },
        includesCommentIds: [],
        modelId: params.modelId,
        gitRefsBefore,
    })

    const runtimePatch = {
        status: "running",
        scope: {
            ownerType: "openade-task",
            ownerId: params.taskId,
            repoPath: repo.path,
            rootPath: executionEnvironment.rootPath,
            labels: {
                eventId: createdEvent.eventId,
                executionId,
            },
        },
        nativeId: executionId,
    } as const
    const runtime =
        server.supervisor.update(runtimeId, runtimePatch) ??
        server.supervisor.create({
            runtimeId,
            kind: "composite",
            ...runtimePatch,
        })
    server.notify("runtime/updated", runtime)
    const activeExecution: ActiveTaskExecution = { executionId, runtimeId, repoId: params.repoId, eventId: createdEvent.eventId }
    activeTaskExecutions.set(params.taskId, activeExecution)
    publishWorkingTasks(server)
    publishTaskChanged(server, params.repoId, params.taskId)

    void runHeadModeTurnExecution({
        server,
        writer,
        repoId: params.repoId,
        task,
        taskId: params.taskId,
        eventId: createdEvent.eventId,
        executionId,
        harnessId: params.harnessId as HarnessId,
        modelId: params.modelId,
        cwd: executionEnvironment.cwd,
        rootPath: executionEnvironment.rootPath,
        prompt: reviewPrompt.userMessage,
        appendSystemPrompt: reviewPrompt.systemPrompt,
        readOnly: true,
        createSnapshot: false,
        snapshotBase: executionEnvironment.snapshotBase,
        mcpServerConfigs: await buildRuntimeMcpServerConfigs(yjsStorage, task.enabledMcpServerIds),
        runtimeId,
        isStopping: () => activeExecution.stopping === true,
        onCompleted: async ({ events }) => {
            const reviewText = extractOpenADEPlanText(events, params.harnessId)
            if (!reviewText) return
            const currentTask = await projection.readTask(params.repoId, params.taskId)
            const followUpLabel = `${userLabel} Follow-up`
            const handoffMessage = buildOpenADEReviewHandoffPrompt({ reviewType: params.reviewType, reviewText })
            const followUpPrompt = buildOpenADEPrompt({
                type: "ask",
                input: handoffMessage,
                comments: [],
                label: followUpLabel,
                includeComments: false,
            })
            const followUpEnvironment = await ensureTaskExecutionEnvironment({
                repoPath: repo.path,
                task: currentTask,
                writer,
            })
            const followUpExecutionId = executionIdForTask(params.taskId)
            const followUpHarnessId = harnessIdForTurn(
                { repoId: params.repoId, type: "ask", input: handoffMessage, inTaskId: params.taskId },
                currentTask
            )
            const followUpModelId = modelIdForTurn(
                { repoId: params.repoId, type: "ask", input: handoffMessage, inTaskId: params.taskId },
                currentTask,
                followUpHarnessId
            )
            const followUpGitRefsBefore = await getGitRefs(followUpEnvironment.rootPath)
            const followUpEvent = await writer.createActionEvent({
                taskId: params.taskId,
                userInput: followUpLabel,
                executionId: followUpExecutionId,
                harnessId: followUpHarnessId,
                source: { type: "ask", userLabel: followUpLabel, origin: "review_follow_up" },
                includesCommentIds: [],
                modelId: followUpModelId,
                gitRefsBefore: followUpGitRefsBefore,
            })
            const followUpRuntime = server.supervisor.update(runtimeId, {
                scope: {
                    ownerType: "openade-task",
                    ownerId: params.taskId,
                    repoPath: repo.path,
                    rootPath: followUpEnvironment.rootPath,
                    labels: {
                        eventId: followUpEvent.eventId,
                        executionId: followUpExecutionId,
                    },
                },
                nativeId: followUpExecutionId,
            })
            server.notify("runtime/updated", followUpRuntime)
            const followUpActiveExecution: ActiveTaskExecution = { executionId: followUpExecutionId, runtimeId, repoId: params.repoId, eventId: followUpEvent.eventId }
            activeTaskExecutions.set(params.taskId, followUpActiveExecution)
            publishWorkingTasks(server)
            publishTaskChanged(server, params.repoId, params.taskId)
            void runHeadModeTurnExecution({
                server,
                writer,
                repoId: params.repoId,
                task: currentTask,
                taskId: params.taskId,
                eventId: followUpEvent.eventId,
                executionId: followUpExecutionId,
                harnessId: followUpHarnessId,
                modelId: followUpModelId,
                cwd: followUpEnvironment.cwd,
                rootPath: followUpEnvironment.rootPath,
                prompt: followUpPrompt.userMessage,
                appendSystemPrompt: followUpPrompt.systemPrompt,
                readOnly: followUpPrompt.readOnly,
                createSnapshot: false,
                snapshotBase: followUpEnvironment.snapshotBase,
                mcpServerConfigs: await buildRuntimeMcpServerConfigs(yjsStorage, currentTask.enabledMcpServerIds),
                resumeSessionId: lastActionSessionContext(currentTask)?.sessionId,
                runtimeId,
                isStopping: () => followUpActiveExecution.stopping === true,
            })
        },
    })

    return { taskId: params.taskId, eventId: createdEvent.eventId }
}

async function runHeadModeTurnExecution({
    server,
    writer,
    repoId,
    task,
    taskId,
    eventId,
    executionId,
    harnessId,
    modelId,
    cwd,
    rootPath,
    prompt,
    appendSystemPrompt,
    readOnly,
    createSnapshot,
    snapshotBase,
    previousSnapshotPatch,
    mcpServerConfigs,
    thinking,
    fastMode,
    resumeSessionId,
    runtimeId,
    onCompleted,
    isStopping,
}: {
    server: RuntimeServer
    writer: ReturnType<typeof createOpenADEYjsWriter>
    repoId: string
    task: OpenADETask
    taskId: string
    eventId: string
    executionId: string
    harnessId: HarnessId
    modelId?: string
    cwd: string
    rootPath: string
    prompt: string | HarnessContentBlock[]
    appendSystemPrompt?: string
    readOnly: boolean
    createSnapshot: boolean
    snapshotBase?: SnapshotBase
    previousSnapshotPatch?: string
    mcpServerConfigs?: Record<string, McpServerConfig>
    thinking?: OpenADETurnStartRequest["thinking"]
    fastMode?: boolean
    resumeSessionId?: string
    runtimeId: string
    onCompleted?: (result: { events: Array<Record<string, unknown>>; sessionId?: string; parentSessionId?: string }) => Promise<void> | void
    isStopping?: () => boolean
}): Promise<void> {
    const pendingWrites: Array<Promise<unknown>> = []
    const observedEvents: Array<Record<string, unknown>> = []
    let savedSessionId: string | undefined
    const enqueue = (write: Promise<unknown>) => {
        pendingWrites.push(write.catch((error) => console.warn("[RuntimeGateway] Failed to persist stream event:", error)))
    }
    let finalized = false
    const finalize = async (status: "completed" | "failed" | "stopped", error?: string) => {
        if (finalized) return
        finalized = true
        await Promise.all(pendingWrites)
        const terminalStatus = isStopping?.() ? "stopped" : status

        if (terminalStatus === "completed") {
            const gitRefsAfter = await getGitRefs(rootPath)
            if (gitRefsAfter) await writer.updateActionExecution({ taskId, eventId, gitRefsAfter })
            await writer.completeActionEvent({ taskId, eventId, success: true })
            if (createSnapshot) {
                await createSnapshotForCompletedTurn({
                    writer,
                    task,
                    taskId,
                    eventId,
                    rootPath,
                    snapshotBase,
                    previousPatch: previousSnapshotPatch,
                })
            }
            const completed = server.supervisor.update(runtimeId, { status: "completed" })
            server.notify("runtime/completed", completed)
        } else if (terminalStatus === "stopped") {
            await writer.stoppedActionEvent({ taskId, eventId })
            const stopped = server.supervisor.update(runtimeId, { status: "stopped", error })
            server.notify("runtime/stopped", stopped)
        } else {
            await writer.errorActionEvent({ taskId, eventId })
            const failed = server.supervisor.update(runtimeId, { status: "failed", error })
            server.notify("runtime/failed", failed)
        }

        clearRuntimeHarnessBuffer({ executionId })
        activeTaskExecutions.delete(taskId)
        publishWorkingTasks(server)
        publishTaskChanged(server, repoId, taskId)

        if (terminalStatus === "completed" && onCompleted) {
            await onCompleted({ events: observedEvents, sessionId: savedSessionId, parentSessionId: resumeSessionId })
        }
    }

    try {
        const start = await startRuntimeHarnessQuery({
            executionId,
            prompt,
            options: {
                harnessId,
                cwd,
                model: modelId ? getModelFullId(modelId, harnessId) : undefined,
                mode: readOnly ? "read-only" : undefined,
                thinking,
                fastMode,
                resumeSessionId,
                processLabel: `OpenADE ${taskId}`,
                appendSystemPrompt,
                mcpServerConfigs,
            },
            onEvent(event) {
                observedEvents.push(event as Record<string, unknown>)
                server.supervisor.touchByOwner("openade-task", taskId)
                server.notify("agent/event", event)
                enqueue(writer.appendActionStreamEvent({ taskId, eventId, streamEvent: event as Record<string, unknown> & { id: string } }))
                if (event.direction === "execution" && event.type === "session_started") {
                    savedSessionId = event.sessionId
                    enqueue(writer.updateActionExecution({ taskId, eventId, sessionId: event.sessionId, parentSessionId: resumeSessionId }))
                }
                if (event.direction === "execution" && event.type === "complete") {
                    void finalize("completed")
                }
                if (event.direction === "execution" && event.type === "error") {
                    void finalize(event.code === "aborted" ? "stopped" : "failed", event.error)
                }
                publishTaskChanged(server, repoId, taskId)
            },
            onSettled(result) {
                if (result.status === "completed") void finalize("completed")
                else if (result.status === "aborted") void finalize("stopped")
                else if (result.status === "error") void finalize("failed")
            },
        })

        if (!start.ok) {
            await finalize("failed", start.error ?? "Agent execution failed")
            return
        }
    } catch (error) {
        await finalize("failed", error instanceof Error ? error.message : "Agent execution failed")
        return
    }
}

function taskThreadContext(task: OpenADETask): {
    mainThreadContextXml?: string
    mainThreadContextMeta?: { truncated: boolean; includedEvents: number; omittedEvents: number; byteLength: number }
} {
    const events = task.events.filter((event) => {
        const record = typeof event === "object" && event !== null && !Array.isArray(event) ? (event as Record<string, unknown>) : {}
        return record.type !== "snapshot"
    })
    if (events.length === 0) return {}

    const maxBytes = 240_000
    const included: unknown[] = []
    let byteLength = 0
    for (let index = events.length - 1; index >= 0; index--) {
        const eventText = JSON.stringify(events[index])
        const eventBytes = Buffer.byteLength(eventText, "utf8")
        if (included.length > 0 && byteLength + eventBytes > maxBytes) break
        included.unshift(events[index])
        byteLength += eventBytes
    }

    return {
        mainThreadContextXml: `<task_events_json>\n${JSON.stringify(included, null, 2)}\n</task_events_json>`,
        mainThreadContextMeta: {
            truncated: included.length < events.length,
            includedEvents: included.length,
            omittedEvents: events.length - included.length,
            byteLength,
        },
    }
}

async function startHyperPlanTurn({
    server,
    writer,
    projection,
    yjsStorage,
    params,
    task,
    strategy,
    context,
}: {
    server: RuntimeServer
    writer: ReturnType<typeof createOpenADEYjsWriter>
    projection: ReturnType<typeof createOpenADEYjsProjection>
    yjsStorage: OpenADEYjsStorage
    params: OpenADETurnStartRequest
    task: OpenADETask
    strategy: OpenADEHyperPlanStrategy
    context?: OpenADETurnStartContext
}): Promise<{ eventId: string }> {
    const errors = validateOpenADEHyperPlanStrategy(strategy)
    if (errors.length > 0) throw new Error(`Invalid HyperPlan strategy: ${errors.join(", ")}`)
    if (!canExecuteTaskInRuntime(task)) throw new Error("Server-owned HyperPlan supports head and worktree tasks only")

    const repo = (await projection.readProjects()).find((project) => project.id === params.repoId)
    if (!repo) throw new Error(`Repository ${params.repoId} not found`)
    const executionEnvironment = await ensureTaskExecutionEnvironment({
        repoPath: repo.path,
        task,
        writer,
    })
    const terminalStep = strategy.steps.find((step) => step.id === strategy.terminalStepId)
    if (!terminalStep) throw new Error(`Terminal HyperPlan step ${strategy.terminalStepId} not found`)
    const mcpServerConfigs = await buildRuntimeMcpServerConfigs(yjsStorage, task.enabledMcpServerIds)

    const executionId = executionIdForTask(task.id)
    const harnessId = terminalStep.agent.harnessId as HarnessId
    const gitRefsBefore = await getGitRefs(executionEnvironment.rootPath)
    const createdEvent = await writer.createActionEvent({
        taskId: task.id,
        userInput: params.input,
        executionId,
        harnessId,
        source: { type: "hyperplan", userLabel: "HyperPlan", strategyId: strategy.id },
        images: params.images && params.images.length > 0 ? params.images : undefined,
        includesCommentIds: [],
        modelId: terminalStep.agent.modelId,
        fastMode: params.fastMode,
        gitRefsBefore,
    })

    for (const step of strategy.steps) {
        if (step.id === strategy.terminalStepId) continue
        await writer.addHyperPlanSubExecution({
            taskId: task.id,
            eventId: createdEvent.eventId,
            subExecution: {
                stepId: step.id,
                primitive: step.primitive,
                harnessId: step.agent.harnessId,
                modelId: step.agent.modelId,
                executionId: "",
                status: "in_progress",
                events: [],
            },
        })
    }

    const runtimeId = context?.runtimeId ?? `openade-turn:${task.id}`
    const runtimePatch = {
        status: "running",
        scope: {
            ownerType: "openade-task",
            ownerId: task.id,
            repoPath: repo.path,
            rootPath: executionEnvironment.rootPath,
            labels: {
                eventId: createdEvent.eventId,
                executionId,
            },
        },
        nativeId: executionId,
    } as const
    const runtime =
        server.supervisor.update(runtimeId, runtimePatch) ??
        server.supervisor.create({
            runtimeId,
            kind: "composite",
            ...runtimePatch,
        })
    server.notify("runtime/updated", runtime)
    activeTaskExecutions.set(task.id, { executionId, runtimeId, repoId: params.repoId, eventId: createdEvent.eventId, childExecutionIds: new Set() })
    publishWorkingTasks(server)
    publishTaskChanged(server, params.repoId, task.id)

    void runHyperPlanTurnExecution({
        server,
        writer,
        repoId: params.repoId,
        task,
        taskId: task.id,
        eventId: createdEvent.eventId,
        strategy,
        images: params.images,
        cwd: executionEnvironment.cwd,
        rootPath: executionEnvironment.rootPath,
        taskDescription: params.input,
        appendSystemPrompt: params.appendSystemPrompt,
        mcpServerConfigs,
        thinking: params.thinking,
        fastMode: params.fastMode,
        runtimeId,
    })

    return { eventId: createdEvent.eventId }
}

type HyperPlanStepResult = {
    text?: string
    sessionId?: string
    status: "completed" | "error" | "stopped"
    error?: string
}

async function runHyperPlanTurnExecution({
    server,
    writer,
    repoId,
    task,
    taskId,
    eventId,
    strategy,
    images,
    cwd,
    rootPath,
    taskDescription,
    appendSystemPrompt,
    mcpServerConfigs,
    thinking,
    fastMode,
    runtimeId,
}: {
    server: RuntimeServer
    writer: ReturnType<typeof createOpenADEYjsWriter>
    repoId: string
    task: OpenADETask
    taskId: string
    eventId: string
    strategy: OpenADEHyperPlanStrategy
    images?: unknown[]
    cwd: string
    rootPath: string
    taskDescription: string
    appendSystemPrompt?: string
    mcpServerConfigs?: Record<string, McpServerConfig>
    thinking?: OpenADETurnStartRequest["thinking"]
    fastMode?: boolean
    runtimeId: string
}): Promise<void> {
    const stepResults = new Map<string, string>()
    const stepSessionIds = new Map<string, string>()
    const context = taskThreadContext(task)
    let terminalSuccess = false
    let finalized = false

    const finalize = async (status: "completed" | "failed" | "stopped", error?: string) => {
        if (finalized) return
        finalized = true

        if (status === "completed") {
            const gitRefsAfter = await getGitRefs(rootPath)
            if (gitRefsAfter) await writer.updateActionExecution({ taskId, eventId, gitRefsAfter })
            await writer.completeActionEvent({ taskId, eventId, success: terminalSuccess })
            const completed = server.supervisor.update(runtimeId, { status: "completed" })
            server.notify("runtime/completed", completed)
        } else if (status === "stopped") {
            await writer.stoppedActionEvent({ taskId, eventId })
            const stopped = server.supervisor.update(runtimeId, { status: "stopped", error })
            server.notify("runtime/stopped", stopped)
        } else {
            await writer.errorActionEvent({ taskId, eventId })
            const failed = server.supervisor.update(runtimeId, { status: "failed", error })
            server.notify("runtime/failed", failed)
        }

        const active = activeTaskExecutions.get(taskId)
        if (active) {
            clearRuntimeHarnessBuffer({ executionId: active.executionId })
            for (const executionId of active.childExecutionIds ?? []) clearRuntimeHarnessBuffer({ executionId })
        }
        activeTaskExecutions.delete(taskId)
        publishWorkingTasks(server)
        publishTaskChanged(server, repoId, taskId)
    }

    try {
        for (const layer of groupOpenADEHyperPlanByDepth(strategy)) {
            if (activeTaskExecutions.get(taskId)?.stopping) {
                await finalize("stopped")
                return
            }

            const settled = await Promise.allSettled(
                layer.map((step) =>
                    runHyperPlanStep({
                        server,
                        writer,
                        repoId,
                        taskId,
                        eventId,
                        strategy,
                        step,
                        images,
                        cwd,
                        taskDescription,
                        appendSystemPrompt,
                        mcpServerConfigs,
                        thinking,
                        fastMode,
                        stepResults,
                        stepSessionIds,
                        context,
                    })
                )
            )

            for (let index = 0; index < layer.length; index++) {
                const step = layer[index]
                const result = settled[index]
                const value: HyperPlanStepResult =
                    result.status === "fulfilled"
                        ? result.value
                        : { status: "error", error: result.reason instanceof Error ? result.reason.message : "HyperPlan step failed" }
                if (value.text) stepResults.set(step.id, value.text)
                if (value.sessionId) stepSessionIds.set(step.id, value.sessionId)
                if (value.status === "stopped") {
                    await finalize("stopped", value.error)
                    return
                }
                if (step.id === strategy.terminalStepId) terminalSuccess = value.status === "completed" && Boolean(value.text)
            }
        }

        if (activeTaskExecutions.get(taskId)?.stopping) {
            await finalize("stopped")
        } else {
            await finalize("completed")
        }
    } catch (error) {
        await finalize("failed", error instanceof Error ? error.message : "HyperPlan failed")
    }
}

async function runHyperPlanStep({
    server,
    writer,
    repoId,
    taskId,
    eventId,
    strategy,
    step,
    images,
    cwd,
    taskDescription,
    appendSystemPrompt,
    mcpServerConfigs,
    thinking,
    fastMode,
    stepResults,
    stepSessionIds,
    context,
}: {
    server: RuntimeServer
    writer: ReturnType<typeof createOpenADEYjsWriter>
    repoId: string
    taskId: string
    eventId: string
    strategy: OpenADEHyperPlanStrategy
    step: OpenADEHyperPlanStep
    images?: unknown[]
    cwd: string
    taskDescription: string
    appendSystemPrompt?: string
    mcpServerConfigs?: Record<string, McpServerConfig>
    thinking?: OpenADETurnStartRequest["thinking"]
    fastMode?: boolean
    stepResults: Map<string, string>
    stepSessionIds: Map<string, string>
    context: ReturnType<typeof taskThreadContext>
}): Promise<HyperPlanStepResult> {
    const isTerminal = step.id === strategy.terminalStepId
    let prompt: { systemPrompt: string; userMessage: string }
    let resumeSessionId: string | undefined

    if (step.primitive === "plan") {
        prompt = buildOpenADEHyperPlanStepPrompt(taskDescription, context)
    } else if (step.primitive === "review") {
        const inputStepId = step.inputs[0]
        const inputText = stepResults.get(inputStepId)
        if (!inputText) {
            const error = `Review step ${step.id} has no input text from ${inputStepId}`
            if (!isTerminal) await writer.updateHyperPlanSubExecution({ taskId, eventId, stepId: step.id, status: "error", error })
            return { status: "error", error }
        }
        prompt = buildOpenADEReviewStepPrompt(taskDescription, inputText, inputStepId)
    } else if (step.primitive === "reconcile") {
        const inputs = step.inputs
            .map((inputId) => {
                const text = stepResults.get(inputId)
                const inputStep = strategy.steps.find((candidate) => candidate.id === inputId)
                if (!text || !inputStep || (inputStep.primitive !== "plan" && inputStep.primitive !== "review")) return null
                return {
                    stepId: inputId,
                    primitive: inputStep.primitive,
                    text,
                    reviewsStepId: inputStep.primitive === "review" ? inputStep.inputs[0] : undefined,
                }
            })
            .filter((input): input is NonNullable<typeof input> => input !== null)
        if (inputs.length === 0) {
            const error = `Reconcile step ${step.id} has no successful inputs`
            if (!isTerminal) await writer.updateHyperPlanSubExecution({ taskId, eventId, stepId: step.id, status: "error", error })
            return { status: "error", error }
        }
        const reconciled = buildOpenADEReconcileStepPrompt(taskDescription, inputs)
        await writer.setHyperPlanReconcileLabels({ taskId, eventId, mapping: reconciled.labelMapping })
        prompt = reconciled
    } else {
        const reviewStepId = step.inputs[0]
        const reviewText = stepResults.get(reviewStepId)
        if (!reviewText || !step.resumeStepId) {
            const error = `Revise step ${step.id} is missing review input or resume target`
            if (!isTerminal) await writer.updateHyperPlanSubExecution({ taskId, eventId, stepId: step.id, status: "error", error })
            return { status: "error", error }
        }
        resumeSessionId = stepSessionIds.get(step.resumeStepId)
        if (!resumeSessionId) {
            const error = `Cannot resume session for step ${step.resumeStepId}`
            if (!isTerminal) await writer.updateHyperPlanSubExecution({ taskId, eventId, stepId: step.id, status: "error", error })
            return { status: "error", error }
        }
        prompt = buildOpenADEReviseStepPrompt(reviewText, reviewStepId)
    }

    const executionId = `hyperplan-${taskId}-${step.id}-${randomUUID()}`
    const active = activeTaskExecutions.get(taskId)
    active?.childExecutionIds?.add(executionId)
    if (!isTerminal) {
        await writer.updateHyperPlanSubExecution({ taskId, eventId, stepId: step.id, executionId, status: "in_progress" })
    }

    const persistedWrites: Array<Promise<unknown>> = []
    const persist = (write: Promise<unknown>) => {
        persistedWrites.push(write.catch((error) => console.warn("[RuntimeGateway] Failed to persist HyperPlan event:", error)))
    }
    const events: Array<Record<string, unknown> & { id: string }> = []
    let sessionId: string | undefined
    let settledResult: Parameters<NonNullable<Parameters<typeof startRuntimeHarnessQuery>[0]["onSettled"]>>[0] | undefined
    const harnessPrompt = step.primitive === "plan" ? await buildHarnessPrompt(prompt.userMessage, images) : prompt.userMessage

    const settled = new Promise<HyperPlanStepResult>((resolve) => {
        void startRuntimeHarnessQuery({
            executionId,
            prompt: harnessPrompt,
            options: {
                harnessId: step.agent.harnessId as HarnessId,
                cwd,
                model: getModelFullId(step.agent.modelId, step.agent.harnessId as HarnessId),
                mode: "read-only",
                thinking: thinking ?? "high",
                fastMode,
                mcpServerConfigs,
                appendSystemPrompt: mergeAppendSystemPrompt(prompt.systemPrompt, appendSystemPrompt),
                resumeSessionId,
                forkSession: resumeSessionId ? false : undefined,
                processLabel: `OpenADE HyperPlan ${taskId} ${step.id}`,
            },
            onEvent(event) {
                if (event.direction !== "execution") return
                server.supervisor.touchByOwner("openade-task", taskId)
                server.notify("agent/event", event)
                const streamEvent = event as Record<string, unknown> & { id: string }
                events.push(streamEvent)
                if (isTerminal) {
                    persist(writer.appendActionStreamEvent({ taskId, eventId, streamEvent }))
                } else {
                    persist(writer.appendHyperPlanSubExecutionStreamEvent({ taskId, eventId, stepId: step.id, streamEvent }))
                }
                if (event.type === "session_started") {
                    sessionId = event.sessionId
                    if (isTerminal) {
                        persist(writer.updateActionExecution({ taskId, eventId, sessionId: event.sessionId, parentSessionId: resumeSessionId }))
                    } else {
                        persist(
                            writer.updateHyperPlanSubExecution({
                                taskId,
                                eventId,
                                stepId: step.id,
                                sessionId: event.sessionId,
                                parentSessionId: resumeSessionId,
                            })
                        )
                    }
                }
                publishTaskChanged(server, repoId, taskId)
            },
            onSettled(result) {
                settledResult = result
                void (async () => {
                    await Promise.all(persistedWrites)
                    const status = result.status === "aborted" ? "stopped" : result.status === "error" ? "error" : "completed"
                    const text = extractOpenADEPlanText(events, step.agent.harnessId)
                    if (!isTerminal) {
                        await writer.updateHyperPlanSubExecution({
                            taskId,
                            eventId,
                            stepId: step.id,
                            status: status === "completed" ? "completed" : status === "stopped" ? "stopped" : "error",
                            resultText: text ?? undefined,
                            error: status === "error" ? "Execution failed" : undefined,
                        })
                    }
                    resolve({
                        status,
                        text: text ?? undefined,
                        sessionId,
                        error: status === "error" ? "Execution failed" : undefined,
                    })
                })()
            },
        })
            .then((start) => {
                if (!start.ok && !settledResult) {
                    resolve({ status: "error", error: start.error ?? "Failed to start HyperPlan step" })
                }
            })
            .catch((error) => {
                resolve({ status: "error", error: error instanceof Error ? error.message : "Failed to start HyperPlan step" })
            })
    })

    return settled
}

export function getRuntimeServer(): RuntimeServer {
    if (!runtimeServer) {
        runtimeServer = new RuntimeServer({
            serverName: "openade-runtime",
            serverVersion: process.env.RELEASE ?? "unknown",
            protocolVersion: 1,
            agentProviders,
            checkpointStore: createRuntimeCheckpointStore(),
            livenessProbe: createRuntimeNodeLivenessProbe(),
        })
        registerTrustedHostMethods(runtimeServer)
        registerOpenADEProductModule(runtimeServer)
        registerRuntimeAgentModule(runtimeServer)
        registerRuntimeHostModule(runtimeServer)
        registerConfiguredServerProtocolBridges(runtimeServer)
    }
    return runtimeServer
}

export function resetRuntimeServer(): void {
    runtimeServer = null
    for (const unregister of runtimeBridgeUnregisters.splice(0)) {
        unregister()
    }
    activeTaskExecutions.clear()
    cleanupRuntimeHostModule()
}

export function publishCompanionRuntimeEvent(event: CompanionEvent): void {
    const server = runtimeServer
    if (!server) return

    publishOpenADECompanionEvent(server, event)
}
