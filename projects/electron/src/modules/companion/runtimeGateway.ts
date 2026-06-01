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
    type OpenADEProject,
    type OpenADEProjectFileReadRequest,
    type OpenADEProjectFileReadResult,
    type OpenADEProjectFilesTreeEntry,
    type OpenADEProjectFilesTreeRequest,
    type OpenADEProjectFilesTreeResult,
    type OpenADEProjectFileWriteRequest,
    type OpenADEProjectFileWriteResult,
    type OpenADEProjectProcessConfigError,
    type OpenADEProjectProcessDefinition,
    type OpenADEProjectProcessInstance,
    type OpenADEProjectProcessListRequest,
    type OpenADEProjectProcessListResult,
    type OpenADEProjectProcessOutputChunk,
    type OpenADEProjectProcessReconnectRequest,
    type OpenADEProjectProcessReconnectResult,
    type OpenADEProjectProcessStartRequest,
    type OpenADEProjectProcessStartResult,
    type OpenADEProjectProcessStopRequest,
    type OpenADEProjectProcessStopResult,
    type OpenADEProjectSearchRequest,
    type OpenADEProjectSearchResult,
    type OpenADEQueuedTurn,
    type OpenADESnapshotEventRecord,
    type OpenADESnapshotChangedFile,
    type OpenADESetupEnvironmentEventCreateRequest,
    type OpenADETask,
    type OpenADETaskChangesReadRequest,
    type OpenADETaskChangesReadResult,
    type OpenADETaskDeleteRequest,
    type OpenADETaskDeviceEnvironment,
    type OpenADETaskDiffReadRequest,
    type OpenADETaskDiffReadResult,
    type OpenADETaskFilePairReadRequest,
    type OpenADETaskFilePairReadResult,
    type OpenADETaskGitCommitRequest,
    type OpenADETaskGitCommitResult,
    type OpenADETaskGitLogRequest,
    type OpenADETaskGitLogResult,
    type OpenADETaskImageReadRequest,
    type OpenADETaskImageReadResult,
    type OpenADETaskImageReference,
    type OpenADETaskTerminalMutationResult,
    type OpenADETaskTerminalOutputChunk,
    type OpenADETaskTerminalReconnectRequest,
    type OpenADETaskTerminalReconnectResult,
    type OpenADETaskTerminalResizeRequest,
    type OpenADETaskTerminalStartRequest,
    type OpenADETaskTerminalStartResult,
    type OpenADETaskTerminalStopRequest,
    type OpenADETaskTerminalWriteRequest,
    type OpenADETaskSnapshotIndexReadRequest,
    type OpenADETaskSnapshotIndexReadResult,
    type OpenADETaskSnapshotPatchReadRequest,
    type OpenADETaskSnapshotPatchReadResult,
    type OpenADETaskSnapshotPatchSliceReadRequest,
    type OpenADETaskSnapshotPatchSliceReadResult,
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
import { listOrphanHarnessProcesses, terminateOrphanHarness } from "../code/orphanHarness"
import { deleteRuntimeDataFile, loadRuntimeDataFile, saveRuntimeDataFile } from "../code/dataFolder"
import {
    deleteRuntimeBranch,
    deleteRuntimeWorkTree,
    getRuntimeChangedFiles,
    getRuntimeFilePair,
    getRuntimeGitLog,
    getOrCreateRuntimeWorkTree,
    getRuntimeGitSummary,
    getRuntimeMergeBase,
    getRuntimeWorktreeFilePatch,
    isRuntimeGitDirectory,
    type ChangedFileInfo,
    commitRuntimeWorkingTree,
} from "../code/git"
import {
    deleteRuntimeSnapshotBundle,
    loadRuntimeSnapshotIndex,
    loadRuntimeSnapshotPatch,
    loadRuntimeSnapshotPatchSlice,
    saveRuntimeSnapshotBundle,
} from "../code/snapshots"
import { buildSnapshotPatchIndex, type SnapshotPatchFile, type SnapshotPatchIndex } from "../code/snapshotsIndex"
import { killRuntimePty, reconnectRuntimePty, resizeRuntimePty, spawnRuntimePty, writeRuntimePty } from "../code/pty"
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
    type ProcessDef,
    type ProcessInput,
    type ProcsConfig,
    type ReadProcsResult,
} from "../code/procs"
import { killRuntimeProcess, listRuntimeProcesses, reconnectRuntimeProcess, startRuntimeScript } from "../code/process"
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
import { registerRemoteDeviceRuntimeMethods } from "./deviceRuntime"
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
type ScopedProjectProcessRegistration = {
    repoId: string
    taskId?: string
    definitionId: string
    cwd: string
}
const scopedProjectProcesses = new Map<string, ScopedProjectProcessRegistration>()
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

function queuedTurnIdForClientRequest(taskId: string, clientRequestId: string | undefined): string {
    if (!clientRequestId) return `queued-${randomUUID()}`
    const hash = createHash("sha256").update(taskId).update("\0").update(clientRequestId).digest("hex").slice(0, 26)
    return `queued-${hash}`
}

function canCreateTaskInRuntime(params: OpenADETurnStartRequest): boolean {
    return !params.inTaskId
}

function queuedTurnFromParams(taskId: string, params: OpenADETurnStartRequest): OpenADEQueuedTurn {
    const now = new Date().toISOString()
    return {
        id: queuedTurnIdForClientRequest(taskId, params.clientRequestId),
        clientRequestId: params.clientRequestId,
        type: params.type === "ask" ? "ask" : "do",
        input: params.input,
        status: "queued",
        createdAt: now,
        updatedAt: now,
        appendSystemPrompt: params.appendSystemPrompt,
        enabledMcpServerIds: params.enabledMcpServerIds,
        harnessId: params.harnessId,
        modelId: params.modelId,
        label: params.label,
        includeComments: params.includeComments,
        images: params.images,
        thinking: params.thinking,
        fastMode: params.fastMode,
    }
}

function queuedTurnParams(repoId: string, taskId: string, turn: OpenADEQueuedTurn): OpenADETurnStartRequest {
    return {
        repoId,
        inTaskId: taskId,
        type: turn.type,
        input: turn.input,
        appendSystemPrompt: turn.appendSystemPrompt,
        enabledMcpServerIds: turn.enabledMcpServerIds,
        harnessId: turn.harnessId,
        modelId: turn.modelId,
        label: turn.label,
        includeComments: turn.includeComments,
        images: turn.images,
        thinking: turn.thinking,
        fastMode: turn.fastMode,
        clientRequestId: turn.clientRequestId,
    }
}

function sessionBackedStreamEventId(executionId: string, index: number, event: unknown): string {
    const hash = createHash("sha256").update(executionId).update("\0").update(String(index)).update("\0").update(JSON.stringify(event)).digest("hex").slice(0, 24)
    return `session-${hash}`
}

function streamEventSemanticKey(event: unknown): string {
    if (typeof event !== "object" || event === null || Array.isArray(event)) return JSON.stringify(event)
    const { id: _id, ...rest } = event as Record<string, unknown>
    return JSON.stringify(rest)
}

function sessionHarnessEventToStreamEvent(params: { executionId: string; harnessId: string; index: number; event: unknown }): Record<string, unknown> | null {
    if (typeof params.event !== "object" || params.event === null || Array.isArray(params.event)) return null
    const event = params.event as Record<string, unknown>
    const type = typeof event.type === "string" ? event.type : undefined
    const base = {
        id: sessionBackedStreamEventId(params.executionId, params.index, event),
        direction: "execution",
        executionId: params.executionId,
        harnessId: params.harnessId,
    }

    if (type === "session_started" && typeof event.sessionId === "string") {
        return { ...base, type: "session_started", sessionId: event.sessionId }
    }
    if (type === "message") {
        return { ...base, type: "raw_message", message: event.message }
    }
    if (type === "stderr" && typeof event.data === "string") {
        return { ...base, type: "stderr", data: event.data }
    }
    if (type === "complete") {
        return { ...base, type: "complete", usage: event.usage }
    }
    if (type === "error") {
        return { ...base, type: "error", error: typeof event.error === "string" ? event.error : "Session error", code: event.code }
    }

    return {
        ...base,
        type: "raw_message",
        message: {
            type: "raw_json",
            original_type: type ?? "session_event",
            raw: event,
        },
    }
}

function mergeSessionBackedStreamEvents(storedEvents: unknown[], sessionEvents: Record<string, unknown>[]): unknown[] {
    if (sessionEvents.length === 0) return storedEvents
    const seen = new Set(sessionEvents.map(streamEventSemanticKey))
    const storedOnly = storedEvents.filter((event) => {
        const key = streamEventSemanticKey(event)
        if (seen.has(key)) return false
        seen.add(key)
        return true
    })
    return [...sessionEvents, ...storedOnly]
}

async function readHarnessSessionStreamEvents(params: {
    server: RuntimeServer
    harnessId: string
    executionId: string
    sessionId: string
    cwd?: string
}): Promise<Record<string, unknown>[]> {
    const response = await params.server.handleRequest(
        {
            id: `session-read-${params.executionId}`,
            method: "agent/session/read",
            params: {
                providerId: params.harnessId,
                sessionId: params.sessionId,
                cwd: params.cwd,
            },
        },
        {
            id: "openade-session-hydrator",
            send() {},
        }
    )
    if (response.error || !Array.isArray(response.result)) return []

    return response.result
        .map((event, index) =>
            sessionHarnessEventToStreamEvent({
                executionId: params.executionId,
                harnessId: params.harnessId,
                index,
                event,
            })
        )
        .filter((event): event is Record<string, unknown> => event !== null)
}

async function hydrateOpenADETaskSessionEvents(params: { server: RuntimeServer; task: OpenADETask; repoPath?: string }): Promise<OpenADETask> {
    const hydratedEvents: unknown[] = []

    for (const event of params.task.events) {
        if (typeof event !== "object" || event === null || Array.isArray(event)) {
            hydratedEvents.push(event)
            continue
        }

        const record = event as Record<string, unknown>
        if (record.type !== "action" || typeof record.execution !== "object" || record.execution === null || Array.isArray(record.execution)) {
            hydratedEvents.push(event)
            continue
        }

        const execution = record.execution as Record<string, unknown>
        const harnessId = typeof execution.harnessId === "string" ? execution.harnessId : undefined
        const executionId = typeof execution.executionId === "string" ? execution.executionId : undefined
        const sessionId = typeof execution.sessionId === "string" ? execution.sessionId : undefined

        let hydratedExecution = execution
        if (harnessId && executionId && sessionId) {
            const sessionEvents = await readHarnessSessionStreamEvents({
                server: params.server,
                harnessId,
                executionId,
                sessionId,
                cwd: params.repoPath,
            })
            const storedEvents = Array.isArray(execution.events) ? execution.events : []
            hydratedExecution = {
                ...execution,
                events: mergeSessionBackedStreamEvents(storedEvents, sessionEvents),
            }
        }

        const hydratedSubExecutions = Array.isArray(record.hyperplanSubExecutions)
            ? await Promise.all(
                  record.hyperplanSubExecutions.map(async (subExecution) => {
                      if (typeof subExecution !== "object" || subExecution === null || Array.isArray(subExecution)) return subExecution
                      const sub = subExecution as Record<string, unknown>
                      const subHarnessId = typeof sub.harnessId === "string" ? sub.harnessId : undefined
                      const subExecutionId = typeof sub.executionId === "string" ? sub.executionId : undefined
                      const subSessionId = typeof sub.sessionId === "string" ? sub.sessionId : undefined
                      if (!subHarnessId || !subExecutionId || !subSessionId) return subExecution
                      const sessionEvents = await readHarnessSessionStreamEvents({
                          server: params.server,
                          harnessId: subHarnessId,
                          executionId: subExecutionId,
                          sessionId: subSessionId,
                          cwd: params.repoPath,
                      })
                      const storedEvents = Array.isArray(sub.events) ? sub.events : []
                      return { ...sub, events: mergeSessionBackedStreamEvents(storedEvents, sessionEvents) }
                  })
              )
            : record.hyperplanSubExecutions

        hydratedEvents.push({
            ...record,
            execution: hydratedExecution,
            ...(hydratedSubExecutions ? { hyperplanSubExecutions: hydratedSubExecutions } : {}),
        })
    }

    return {
        ...params.task,
        events: hydratedEvents,
    }
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

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

function isTaskNotFoundError(error: unknown, taskId: string): boolean {
    return error instanceof Error && error.message === `Task ${taskId} not found`
}

async function readTaskForMutation(
    projection: ReturnType<typeof createOpenADEYjsProjection>,
    repoId: string,
    taskId: string
): Promise<OpenADETask> {
    let lastError: unknown
    for (let attempt = 0; attempt < 6; attempt++) {
        try {
            return await projection.readTask(repoId, taskId)
        } catch (error) {
            if (!isTaskNotFoundError(error, taskId)) throw error
            lastError = error
            await delay(50 * (attempt + 1))
        }
    }
    throw lastError instanceof Error ? lastError : new Error(`Task ${taskId} not found`)
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

const DEFAULT_SCOPED_FILE_MAX_BYTES = 256 * 1024
const DEFAULT_SCOPED_TREE_MAX_DEPTH = 4
const DEFAULT_SCOPED_TREE_MAX_ENTRIES = 1000
const DEFAULT_SCOPED_SEARCH_LIMIT = 100
const MAX_SCOPED_SEARCH_FILE_BYTES = 1024 * 1024
const SCOPED_SEARCH_SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", ".next"])

function resolveProjectRelativePath(repo: OpenADEProject, relativePath: string): string {
    const root = path.resolve(repo.path)
    const target = path.resolve(root, relativePath)
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
        throw new Error("path is outside the repository")
    }
    return target
}

function scopedRelativePath(root: string, fullPath: string): string {
    return path.relative(root, fullPath).split(path.sep).join("/")
}

function shouldSkipScopedEntry(name: string, includeHidden: boolean): boolean {
    if (!includeHidden && name.startsWith(".")) return true
    return SCOPED_SEARCH_SKIP_DIRS.has(name)
}

async function listScopedProjectFiles(params: OpenADEProjectFilesTreeRequest & { repo: OpenADEProject }): Promise<OpenADEProjectFilesTreeResult> {
    const root = path.resolve(params.repo.path)
    const start = resolveProjectRelativePath(params.repo, params.path ?? "")
    const maxDepth = params.maxDepth ?? DEFAULT_SCOPED_TREE_MAX_DEPTH
    const maxEntries = params.maxEntries ?? DEFAULT_SCOPED_TREE_MAX_ENTRIES
    const includeHidden = params.includeHidden === true
    const entries: OpenADEProjectFilesTreeEntry[] = []
    const queue: Array<{ dir: string; depth: number }> = [{ dir: start, depth: 0 }]

    while (queue.length > 0 && entries.length < maxEntries) {
        const current = queue.shift()
        if (!current) break
        const dirEntries = await fs.readdir(current.dir, { withFileTypes: true }).catch(() => [])
        for (const entry of dirEntries) {
            if (entries.length >= maxEntries) break
            if (shouldSkipScopedEntry(entry.name, includeHidden)) continue
            const fullPath = path.join(current.dir, entry.name)
            const relativePath = scopedRelativePath(root, fullPath)
            if (entry.isDirectory()) {
                entries.push({ path: relativePath, name: entry.name, type: "directory" })
                if (current.depth < maxDepth) queue.push({ dir: fullPath, depth: current.depth + 1 })
            } else if (entry.isFile()) {
                const stat = await fs.stat(fullPath).catch(() => null)
                entries.push({
                    path: relativePath,
                    name: entry.name,
                    type: "file",
                    size: stat?.size,
                    mtimeMs: stat?.mtimeMs,
                })
            }
        }
    }

    return { repoId: params.repoId, path: params.path ?? "", entries, truncated: entries.length >= maxEntries || queue.length > 0 }
}

async function readScopedProjectFile(params: OpenADEProjectFileReadRequest & { repo: OpenADEProject }): Promise<OpenADEProjectFileReadResult> {
    const target = resolveProjectRelativePath(params.repo, params.path)
    const encoding = params.encoding ?? "utf8"
    const maxBytes = params.maxBytes ?? DEFAULT_SCOPED_FILE_MAX_BYTES
    const stat = await fs.stat(target)
    if (!stat.isFile()) throw new Error("path is not a file")
    if (stat.size > maxBytes) {
        return { repoId: params.repoId, path: params.path, encoding, size: stat.size, tooLarge: true, content: null }
    }
    return {
        repoId: params.repoId,
        path: params.path,
        encoding,
        size: stat.size,
        tooLarge: false,
        content: await fs.readFile(target, encoding),
    }
}

async function writeScopedProjectFile(params: OpenADEProjectFileWriteRequest & { repo: OpenADEProject }): Promise<OpenADEProjectFileWriteResult> {
    const target = resolveProjectRelativePath(params.repo, params.path)
    if (target === path.resolve(params.repo.path)) throw new Error("path is not a file")
    if (params.createDirs) await fs.mkdir(path.dirname(target), { recursive: true })
    const data = params.encoding === "base64" ? Buffer.from(params.content, "base64") : Buffer.from(params.content, "utf8")
    await fs.writeFile(target, data)
    return { repoId: params.repoId, path: params.path, size: data.byteLength }
}

async function walkScopedProjectFiles(root: string): Promise<Array<{ fullPath: string; relativePath: string }>> {
    const files: Array<{ fullPath: string; relativePath: string }> = []
    const queue = [root]
    while (queue.length > 0 && files.length < 10_000) {
        const dir = queue.shift()
        if (!dir) break
        const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
        for (const entry of entries) {
            if (entry.name.startsWith(".") || SCOPED_SEARCH_SKIP_DIRS.has(entry.name)) continue
            const fullPath = path.join(dir, entry.name)
            if (entry.isDirectory()) {
                queue.push(fullPath)
            } else if (entry.isFile()) {
                files.push({ fullPath, relativePath: path.relative(root, fullPath) })
            }
        }
    }
    return files
}

async function searchScopedProject(params: OpenADEProjectSearchRequest & { repo: OpenADEProject }): Promise<OpenADEProjectSearchResult> {
    const root = path.resolve(params.repo.path)
    const limit = params.limit ?? DEFAULT_SCOPED_SEARCH_LIMIT
    const needle = params.caseSensitive ? params.query : params.query.toLowerCase()
    const matches: OpenADEProjectSearchResult["matches"] = []
    const files = await walkScopedProjectFiles(root)

    for (const file of files) {
        if (matches.length >= limit) break
        const stat = await fs.stat(file.fullPath).catch(() => null)
        if (!stat || stat.size > MAX_SCOPED_SEARCH_FILE_BYTES) continue
        const content = await fs.readFile(file.fullPath, "utf8").catch(() => null)
        if (content === null) continue
        const lines = content.split(/\r?\n/)
        for (let index = 0; index < lines.length && matches.length < limit; index++) {
            const line = lines[index]
            const haystack = params.caseSensitive ? line : line.toLowerCase()
            const matchStart = haystack.indexOf(needle)
            if (matchStart < 0) continue
            matches.push({
                path: file.relativePath,
                line: index + 1,
                content: line,
                matchStart,
                matchEnd: matchStart + params.query.length,
            })
        }
    }

    return { repoId: params.repoId, matches, truncated: matches.length >= limit }
}

function latestScopedTaskEnvironment(task: OpenADETask): OpenADETaskDeviceEnvironment | undefined {
    for (let index = task.deviceEnvironments.length - 1; index >= 0; index--) {
        const environment = task.deviceEnvironments[index]
        if (environment.setupComplete && environment.worktreeDir) return environment
    }
    return undefined
}

async function scopedTaskWorkDir(repo: OpenADEProject, task: OpenADETask): Promise<string> {
    const isolationStrategy = task.isolationStrategy ?? { type: "head" }
    if (isolationStrategy.type === "head") return path.resolve(repo.path)

    const environment = latestScopedTaskEnvironment(task)
    if (!environment?.worktreeDir) throw new Error("task worktree is not available")

    const gitInfo = await isRuntimeGitDirectory({ directory: repo.path }).catch(() => null)
    const relativePath = gitInfo?.isGitDirectory ? gitInfo.relativePath : ""
    const root = path.resolve(environment.worktreeDir)
    const workDir = path.resolve(root, relativePath)
    if (workDir !== root && !workDir.startsWith(`${root}${path.sep}`)) {
        throw new Error("task worktree path is invalid")
    }
    return workDir
}

function scopedTaskFromTreeish(task: OpenADETask, fromTreeish?: string): string {
    if (fromTreeish) return fromTreeish
    return snapshotBaseForTask(task, latestScopedTaskEnvironment(task))?.fromTreeish ?? "HEAD"
}

async function readScopedTaskChanges(
    params: OpenADETaskChangesReadRequest & { repo: OpenADEProject; task: OpenADETask }
): Promise<OpenADETaskChangesReadResult> {
    const workDir = await scopedTaskWorkDir(params.repo, params.task)
    const fromTreeish = scopedTaskFromTreeish(params.task, params.fromTreeish)
    const result = await getRuntimeChangedFiles({ workDir, fromTreeish, toTreeish: "" })
    return {
        repoId: params.repoId,
        taskId: params.taskId,
        files: result.files.map((file) => ({
            path: file.path,
            status: file.status,
            oldPath: file.oldPath,
        })),
        fromTreeish: result.fromTreeish,
        toTreeish: result.toTreeish,
    }
}

async function readScopedTaskDiff(params: OpenADETaskDiffReadRequest & { repo: OpenADEProject; task: OpenADETask }): Promise<OpenADETaskDiffReadResult> {
    const workDir = await scopedTaskWorkDir(params.repo, params.task)
    const fromTreeish = scopedTaskFromTreeish(params.task, params.fromTreeish)
    const contextLines = params.contextLines ?? 3
    const result = await getRuntimeWorktreeFilePatch({
        workDir,
        fromTreeish,
        filePath: params.filePath,
        oldPath: params.oldPath,
        contextLines,
        allowTruncation: params.allowTruncation,
    })
    return {
        repoId: params.repoId,
        taskId: params.taskId,
        filePath: params.filePath,
        oldPath: params.oldPath,
        fromTreeish,
        toTreeish: "",
        patch: result.patch,
        truncated: result.truncated,
        heavy: result.heavy,
        stats: result.stats,
    }
}

async function readScopedTaskFilePair(
    params: OpenADETaskFilePairReadRequest & { repo: OpenADEProject; task: OpenADETask }
): Promise<OpenADETaskFilePairReadResult> {
    const workDir = await scopedTaskWorkDir(params.repo, params.task)
    const fromTreeish = scopedTaskFromTreeish(params.task, params.fromTreeish)
    const result = await getRuntimeFilePair({
        workDir,
        fromTreeish,
        toTreeish: "",
        filePath: params.filePath,
        oldPath: params.oldPath,
    })
    return {
        repoId: params.repoId,
        taskId: params.taskId,
        filePath: params.filePath,
        oldPath: params.oldPath,
        fromTreeish,
        toTreeish: "",
        before: result.before,
        after: result.after,
        tooLarge: result.tooLarge,
    }
}

async function readScopedTaskGitLog(params: OpenADETaskGitLogRequest & { repo: OpenADEProject; task: OpenADETask }): Promise<OpenADETaskGitLogResult> {
    const workDir = await scopedTaskWorkDir(params.repo, params.task)
    const result = await getRuntimeGitLog({
        workDir,
        ref: params.ref,
        limit: params.limit,
        skip: params.skip,
    })
    return {
        repoId: params.repoId,
        taskId: params.taskId,
        commits: result.commits,
        hasMore: result.hasMore,
    }
}

async function commitScopedTaskGit(params: OpenADETaskGitCommitRequest & { repo: OpenADEProject; task: OpenADETask }): Promise<OpenADETaskGitCommitResult> {
    const workDir = await scopedTaskWorkDir(params.repo, params.task)
    const result = await commitRuntimeWorkingTree({ workDir, message: params.message })
    return {
        repoId: params.repoId,
        taskId: params.taskId,
        committed: result.committed,
        status: result.status,
        sha: result.sha,
        error: result.error,
    }
}

function scopedSnapshotPatchFileId(snapshotEvent: OpenADESnapshotEventRecord): string | undefined {
    const value = snapshotEvent.patchFileId
    if (typeof value !== "string" || value.length < 1) return undefined
    if (!/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error("snapshot patch file id is invalid")
    return value
}

function scopedSnapshotInlinePatch(snapshotEvent: OpenADESnapshotEventRecord): string | null {
    return typeof snapshotEvent.fullPatch === "string" && snapshotEvent.fullPatch.length > 0 ? snapshotEvent.fullPatch : null
}

function sliceInlineSnapshotPatch(patch: string, start: number, end: number): string {
    const buffer = Buffer.from(patch, "utf8")
    if (end > buffer.byteLength) throw new Error("Patch slice exceeds patch size")
    return buffer.subarray(start, end).toString("utf8")
}

async function readScopedTaskSnapshotPatch(
    params: OpenADETaskSnapshotPatchReadRequest & { repo: OpenADEProject; task: OpenADETask; snapshotEvent: OpenADESnapshotEventRecord }
): Promise<OpenADETaskSnapshotPatchReadResult> {
    const patchFileId = scopedSnapshotPatchFileId(params.snapshotEvent)
    const inlinePatch = scopedSnapshotInlinePatch(params.snapshotEvent)
    const patch = inlinePatch ?? (patchFileId ? await loadRuntimeSnapshotPatch({ id: patchFileId }) : null)
    return { repoId: params.repoId, taskId: params.taskId, eventId: params.eventId, patchFileId, patch }
}

async function readScopedTaskSnapshotIndex(
    params: OpenADETaskSnapshotIndexReadRequest & { repo: OpenADEProject; task: OpenADETask; snapshotEvent: OpenADESnapshotEventRecord }
): Promise<OpenADETaskSnapshotIndexReadResult> {
    const patchFileId = scopedSnapshotPatchFileId(params.snapshotEvent)
    const inlinePatch = scopedSnapshotInlinePatch(params.snapshotEvent)
    const index = inlinePatch !== null ? buildSnapshotPatchIndex(inlinePatch) : patchFileId ? await loadRuntimeSnapshotIndex({ id: patchFileId }) : null
    return { repoId: params.repoId, taskId: params.taskId, eventId: params.eventId, patchFileId, index }
}

async function readScopedTaskSnapshotPatchSlice(
    params: OpenADETaskSnapshotPatchSliceReadRequest & { repo: OpenADEProject; task: OpenADETask; snapshotEvent: OpenADESnapshotEventRecord }
): Promise<OpenADETaskSnapshotPatchSliceReadResult> {
    const patchFileId = scopedSnapshotPatchFileId(params.snapshotEvent)
    const inlinePatch = scopedSnapshotInlinePatch(params.snapshotEvent)
    const patch =
        inlinePatch !== null
            ? sliceInlineSnapshotPatch(inlinePatch, params.start, params.end)
            : patchFileId
              ? await loadRuntimeSnapshotPatchSlice({ id: patchFileId, start: params.start, end: params.end })
              : null
    return { repoId: params.repoId, taskId: params.taskId, eventId: params.eventId, patchFileId, patch }
}

async function readScopedTaskImage(
    params: OpenADETaskImageReadRequest & { repo: OpenADEProject; task: OpenADETask; image: OpenADETaskImageReference }
): Promise<OpenADETaskImageReadResult> {
    const data = await loadRuntimeDataFile({ folder: "images", id: params.imageId, ext: params.ext })
    return {
        repoId: params.repoId,
        taskId: params.taskId,
        imageId: params.imageId,
        ext: params.ext,
        mediaType: params.image.mediaType,
        data: data === null ? null : (Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8")).toString("base64"),
    }
}

const DEFAULT_SCOPED_PROJECT_PROCESS_TIMEOUT_MS = 10 * 60 * 1000
const DAEMON_SCOPED_PROJECT_PROCESS_TIMEOUT_MS = 24 * 60 * 60 * 1000
const MAX_SCOPED_PROJECT_PROCESS_TIMEOUT_MS = 24 * 60 * 60 * 1000

async function scopedProjectProcessSearchRoot(params: { repo: OpenADEProject; task?: OpenADETask }): Promise<string> {
    return params.task ? scopedTaskWorkDir(params.repo, params.task) : path.resolve(params.repo.path)
}

function scopedProjectProcessCwd(root: string, config: ProcsConfig, processDef: ProcessDef): string {
    const resolvedRoot = path.resolve(root)
    const configPath = path.resolve(resolvedRoot, config.relativePath)
    if (configPath !== resolvedRoot && !configPath.startsWith(`${resolvedRoot}${path.sep}`)) {
        throw new Error("process config path is outside the repository")
    }
    const cwd = path.resolve(path.dirname(configPath), processDef.workDir ?? "")
    if (cwd !== resolvedRoot && !cwd.startsWith(`${resolvedRoot}${path.sep}`)) {
        throw new Error("process cwd is outside the repository")
    }
    return cwd
}

function processDefinitionFromConfig(root: string, config: ProcsConfig, processDef: ProcessDef): OpenADEProjectProcessDefinition {
    return {
        id: processDef.id,
        name: processDef.name,
        command: processDef.command,
        workDir: processDef.workDir,
        url: processDef.url,
        type: processDef.type,
        configPath: config.relativePath,
        cwd: scopedProjectProcessCwd(root, config, processDef),
    }
}

function projectProcessDefinitionsFromProcs(result: ReadProcsResult): {
    processes: OpenADEProjectProcessDefinition[]
    errors: OpenADEProjectProcessConfigError[]
} {
    const root = result.isWorktree && result.worktreeRoot ? result.worktreeRoot : result.repoRoot
    const processes: OpenADEProjectProcessDefinition[] = []
    const errors: OpenADEProjectProcessConfigError[] = []
    for (const config of result.configs) {
        for (const processDef of config.processes) {
            try {
                processes.push(processDefinitionFromConfig(root, config, processDef))
            } catch (error) {
                errors.push({
                    relativePath: config.relativePath,
                    error: error instanceof Error ? error.message : "Process cwd is invalid",
                })
            }
        }
    }
    return { processes, errors }
}

function scopedProjectProcessScopeMatches(registration: ScopedProjectProcessRegistration, params: { repoId: string; taskId?: string }): boolean {
    return registration.repoId === params.repoId && (registration.taskId ?? "") === (params.taskId ?? "")
}

function scopedProjectProcessInstance(
    processInfo: {
        processId: string
        completed: boolean
        exitCode: number | null
        signal: string | null
        error?: string
        pid?: number
    },
    registration: ScopedProjectProcessRegistration
): OpenADEProjectProcessInstance {
    return {
        processId: processInfo.processId,
        definitionId: registration.definitionId,
        repoId: registration.repoId,
        taskId: registration.taskId,
        cwd: registration.cwd,
        completed: processInfo.completed,
        exitCode: processInfo.exitCode,
        signal: processInfo.signal,
        error: processInfo.error,
        pid: processInfo.pid,
    }
}

async function listScopedProjectProcesses(
    params: OpenADEProjectProcessListRequest & { repo: OpenADEProject; task?: OpenADETask }
): Promise<OpenADEProjectProcessListResult> {
    const searchRoot = await scopedProjectProcessSearchRoot(params)
    const procs = await readRuntimeProcs({ path: searchRoot })
    const definitions = projectProcessDefinitionsFromProcs(procs)
    const runtimeProcesses = await listRuntimeProcesses()
    const instances = runtimeProcesses.processes
        .map((processInfo) => {
            const registration = scopedProjectProcesses.get(processInfo.processId)
            return registration && scopedProjectProcessScopeMatches(registration, params) ? scopedProjectProcessInstance(processInfo, registration) : null
        })
        .filter((instance): instance is OpenADEProjectProcessInstance => instance !== null)

    return {
        repoId: params.repoId,
        taskId: params.taskId,
        searchRoot: procs.searchRoot,
        repoRoot: procs.repoRoot,
        isWorktree: procs.isWorktree,
        worktreeRoot: procs.worktreeRoot,
        processes: definitions.processes,
        errors: [...procs.errors, ...definitions.errors],
        instances,
    }
}

function scopedProjectProcessTimeout(processDef: OpenADEProjectProcessDefinition, timeoutMs?: number): number {
    const fallback = processDef.type === "daemon" ? DAEMON_SCOPED_PROJECT_PROCESS_TIMEOUT_MS : DEFAULT_SCOPED_PROJECT_PROCESS_TIMEOUT_MS
    return Math.min(timeoutMs ?? fallback, MAX_SCOPED_PROJECT_PROCESS_TIMEOUT_MS)
}

async function startScopedProjectProcess(
    params: OpenADEProjectProcessStartRequest & { repo: OpenADEProject; task?: OpenADETask }
): Promise<OpenADEProjectProcessStartResult> {
    const listed = await listScopedProjectProcesses(params)
    const processDef = listed.processes.find((candidate) => candidate.id === params.definitionId)
    if (!processDef) throw new Error(`Process definition ${params.definitionId} not found`)
    const stat = await fs.stat(processDef.cwd)
    if (!stat.isDirectory()) throw new Error("process cwd is not a directory")

    const started = await startRuntimeScript({
        script: processDef.command,
        cwd: processDef.cwd,
        timeoutMs: scopedProjectProcessTimeout(processDef, params.timeoutMs),
    })
    scopedProjectProcesses.set(started.processId, {
        repoId: params.repoId,
        taskId: params.taskId,
        definitionId: params.definitionId,
        cwd: processDef.cwd,
    })
    return {
        repoId: params.repoId,
        taskId: params.taskId,
        definitionId: params.definitionId,
        processId: started.processId,
        runtimeId: `process:${started.processId}`,
    }
}

function scopedProcessOutputChunk(chunk: { type: "stdout" | "stderr"; data: string; timestamp: number }): OpenADEProjectProcessOutputChunk {
    return {
        type: chunk.type,
        data: chunk.data,
        timestamp: chunk.timestamp,
    }
}

async function reconnectScopedProjectProcess(
    params: OpenADEProjectProcessReconnectRequest & { repo: OpenADEProject; task?: OpenADETask }
): Promise<OpenADEProjectProcessReconnectResult> {
    const registration = scopedProjectProcesses.get(params.processId)
    if (!registration || !scopedProjectProcessScopeMatches(registration, params)) {
        return { repoId: params.repoId, taskId: params.taskId, processId: params.processId, found: false, output: [] }
    }
    const result = await reconnectRuntimeProcess(params.processId)
    return {
        repoId: params.repoId,
        taskId: params.taskId,
        processId: params.processId,
        found: result.found,
        completed: result.completed,
        exitCode: result.exitCode,
        signal: result.signal,
        error: result.error,
        outputCount: result.outputCount,
        output: result.output.map(scopedProcessOutputChunk),
    }
}

async function stopScopedProjectProcess(
    params: OpenADEProjectProcessStopRequest & { repo: OpenADEProject; task?: OpenADETask }
): Promise<OpenADEProjectProcessStopResult> {
    const registration = scopedProjectProcesses.get(params.processId)
    if (!registration || !scopedProjectProcessScopeMatches(registration, params)) {
        return { repoId: params.repoId, taskId: params.taskId, processId: params.processId, ok: false, error: "Process not found" }
    }
    const result = await killRuntimeProcess(params.processId)
    if (result.ok) scopedProjectProcesses.delete(params.processId)
    return {
        repoId: params.repoId,
        taskId: params.taskId,
        processId: params.processId,
        ok: result.ok,
        error: result.error,
    }
}

function scopedTaskTerminalId(repoId: string, taskId: string): string {
    const hash = createHash("sha256").update(repoId).update("\0").update(taskId).digest("hex").slice(0, 24)
    return `openade-task-terminal-${hash}`
}

function assertScopedTaskTerminal(params: { repoId: string; taskId: string; terminalId: string }): void {
    if (params.terminalId !== scopedTaskTerminalId(params.repoId, params.taskId)) throw new Error("terminalId is invalid")
}

function terminalOutputChunk(chunk: { data: string; timestamp: number }): OpenADETaskTerminalOutputChunk {
    return {
        data: Buffer.from(chunk.data, "base64").toString("utf8"),
        timestamp: chunk.timestamp,
    }
}

async function startScopedTaskTerminal(
    params: OpenADETaskTerminalStartRequest & { repo: OpenADEProject; task: OpenADETask }
): Promise<OpenADETaskTerminalStartResult> {
    const cwd = await scopedTaskWorkDir(params.repo, params.task)
    const terminalId = scopedTaskTerminalId(params.repoId, params.taskId)
    const result = await spawnRuntimePty({
        ptyId: terminalId,
        cwd,
        cols: params.cols ?? 100,
        rows: params.rows ?? 30,
    })
    return {
        repoId: params.repoId,
        taskId: params.taskId,
        terminalId,
        runtimeId: `pty:${terminalId}`,
        ok: result.ok,
        error: result.error,
    }
}

async function reconnectScopedTaskTerminal(
    params: OpenADETaskTerminalReconnectRequest & { repo: OpenADEProject; task: OpenADETask }
): Promise<OpenADETaskTerminalReconnectResult> {
    assertScopedTaskTerminal(params)
    const result = await reconnectRuntimePty({ ptyId: params.terminalId })
    return {
        repoId: params.repoId,
        taskId: params.taskId,
        terminalId: params.terminalId,
        found: result.found,
        exited: result.exited,
        exitCode: result.exitCode ?? null,
        outputCount: result.output.length,
        output: result.output.map(terminalOutputChunk),
    }
}

async function writeScopedTaskTerminal(
    params: OpenADETaskTerminalWriteRequest & { repo: OpenADEProject; task: OpenADETask }
): Promise<OpenADETaskTerminalMutationResult> {
    assertScopedTaskTerminal(params)
    const result = await writeRuntimePty({ ptyId: params.terminalId, data: Buffer.from(params.data, "utf8").toString("base64") })
    return { repoId: params.repoId, taskId: params.taskId, terminalId: params.terminalId, ok: result.ok }
}

async function resizeScopedTaskTerminal(
    params: OpenADETaskTerminalResizeRequest & { repo: OpenADEProject; task: OpenADETask }
): Promise<OpenADETaskTerminalMutationResult> {
    assertScopedTaskTerminal(params)
    const result = await resizeRuntimePty({ ptyId: params.terminalId, cols: params.cols, rows: params.rows })
    return { repoId: params.repoId, taskId: params.taskId, terminalId: params.terminalId, ok: result.ok }
}

async function stopScopedTaskTerminal(
    params: OpenADETaskTerminalStopRequest & { repo: OpenADEProject; task: OpenADETask }
): Promise<OpenADETaskTerminalMutationResult> {
    assertScopedTaskTerminal(params)
    const result = await killRuntimePty({ ptyId: params.terminalId })
    return { repoId: params.repoId, taskId: params.taskId, terminalId: params.terminalId, ok: result.ok }
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

function publishTaskChanged(server: RuntimeServer, repoId: string, taskId: string, options: { previewChanged?: boolean } = {}): void {
    publishOpenADECompanionEvent(server, {
        type: "task_changed",
        repoId,
        taskId,
        previewChanged: options.previewChanged,
        at: new Date().toISOString(),
    })
}

function publishWorkingTasks(server: RuntimeServer): void {
    configurePowerKeeper({ runningTaskCount: activeTaskExecutions.size })
    publishOpenADECompanionEvent(server, {
        type: "working_tasks",
        taskIds: [...activeTaskExecutions.keys()],
        at: new Date().toISOString(),
    })
}

function publishQueuedTurnUpdated(server: RuntimeServer, repoId: string, taskId: string, turn: OpenADEQueuedTurn): void {
    server.notify("openade/queuedTurn/updated", {
        repoId,
        taskId,
        turn,
        at: new Date().toISOString(),
    })
}

async function saveQueuedTurns(params: {
    writer: ReturnType<typeof createOpenADEYjsWriter>
    server: RuntimeServer
    repoId: string
    taskId: string
    queuedTurns: OpenADEQueuedTurn[]
    changedTurn?: OpenADEQueuedTurn
}): Promise<void> {
    await params.writer.updateTaskMetadata({
        taskId: params.taskId,
        queuedTurns: params.queuedTurns,
        updatedAt: new Date().toISOString(),
    })
    publishTaskChanged(params.server, params.repoId, params.taskId)
    if (params.changedTurn) publishQueuedTurnUpdated(params.server, params.repoId, params.taskId, params.changedTurn)
}

async function updateQueuedTurn(params: {
    writer: ReturnType<typeof createOpenADEYjsWriter>
    projection: ReturnType<typeof createOpenADEYjsProjection>
    server: RuntimeServer
    repoId: string
    taskId: string
    queuedTurnId: string
    patch: Partial<OpenADEQueuedTurn>
}): Promise<void> {
    const task = await params.projection.readTask(params.repoId, params.taskId)
    let changedTurn: OpenADEQueuedTurn | undefined
    const queuedTurns = (task.queuedTurns ?? []).map((turn) => {
        if (turn.id !== params.queuedTurnId) return turn
        changedTurn = {
            ...turn,
            ...params.patch,
            updatedAt: new Date().toISOString(),
        }
        return changedTurn
    })
    await saveQueuedTurns({
        writer: params.writer,
        server: params.server,
        repoId: params.repoId,
        taskId: params.taskId,
        queuedTurns,
        changedTurn,
    })
}

async function enqueueDoTurn(params: {
    writer: ReturnType<typeof createOpenADEYjsWriter>
    server: RuntimeServer
    task: OpenADETask
    turn: OpenADETurnStartRequest
}): Promise<{ taskId: string; queued: true; queuedTurnId: string }> {
    if (params.turn.type !== "do" && params.turn.type !== "ask") throw new Error("Only Do and Ask turns can be queued while another turn is running")

    const queuedTurn = queuedTurnFromParams(params.task.id, params.turn)
    const existing = params.task.queuedTurns?.find(
        (turn) => turn.id === queuedTurn.id || (queuedTurn.clientRequestId && turn.clientRequestId === queuedTurn.clientRequestId)
    )
    if (existing) {
        publishQueuedTurnUpdated(params.server, params.turn.repoId, params.task.id, existing)
        return { taskId: params.task.id, queued: true, queuedTurnId: existing.id }
    }

    await saveQueuedTurns({
        writer: params.writer,
        server: params.server,
        repoId: params.turn.repoId,
        taskId: params.task.id,
        queuedTurns: [...(params.task.queuedTurns ?? []), queuedTurn],
        changedTurn: queuedTurn,
    })
    return { taskId: params.task.id, queued: true, queuedTurnId: queuedTurn.id }
}

async function cancelQueuedTurn(params: {
    writer: ReturnType<typeof createOpenADEYjsWriter>
    projection: ReturnType<typeof createOpenADEYjsProjection>
    server: RuntimeServer
    repoId: string
    taskId: string
    queuedTurnId: string
}): Promise<{ taskId: string; queuedTurnId: string; cancelled: boolean }> {
    const task = await params.projection.readTask(params.repoId, params.taskId)
    let cancelled = false
    let changedTurn: OpenADEQueuedTurn | undefined
    const queuedTurns = (task.queuedTurns ?? []).map((turn) => {
        if (turn.id !== params.queuedTurnId) return turn
        if (turn.status !== "queued") return turn
        cancelled = true
        changedTurn = { ...turn, status: "cancelled" as const, updatedAt: new Date().toISOString() }
        return changedTurn
    })

    if (cancelled) {
        await saveQueuedTurns({
            writer: params.writer,
            server: params.server,
            repoId: params.repoId,
            taskId: params.taskId,
            queuedTurns,
            changedTurn,
        })
    }

    return { taskId: params.taskId, queuedTurnId: params.queuedTurnId, cancelled }
}

async function drainNextQueuedTurn(params: {
    server: RuntimeServer
    writer: ReturnType<typeof createOpenADEYjsWriter>
    projection: ReturnType<typeof createOpenADEYjsProjection>
    yjsStorage: OpenADEYjsStorage
    repoId: string
    taskId: string
}): Promise<void> {
    let next: OpenADEQueuedTurn | undefined
    try {
        if (activeTaskExecutions.has(params.taskId)) return
        const task = await params.projection.readTask(params.repoId, params.taskId)
        next = (task.queuedTurns ?? []).find((turn) => turn.status === "queued")
        if (!next) return

        await updateQueuedTurn({
            writer: params.writer,
            projection: params.projection,
            server: params.server,
            repoId: params.repoId,
            taskId: params.taskId,
            queuedTurnId: next.id,
            patch: { status: "running" },
        })

        const started = await startHeadModeTurn({
            server: params.server,
            writer: params.writer,
            projection: params.projection,
            yjsStorage: params.yjsStorage,
            params: queuedTurnParams(params.repoId, params.taskId, next),
            taskId: params.taskId,
            queuedTurnId: next.id,
        })
        await updateQueuedTurn({
            writer: params.writer,
            projection: params.projection,
            server: params.server,
            repoId: params.repoId,
            taskId: params.taskId,
            queuedTurnId: next.id,
            patch: { status: "running", eventId: started.eventId },
        })
    } catch (error) {
        if (next) {
            await updateQueuedTurn({
                writer: params.writer,
                projection: params.projection,
                server: params.server,
                repoId: params.repoId,
                taskId: params.taskId,
                queuedTurnId: next.id,
                patch: { status: "error" },
            }).catch((updateError) => {
                console.warn("[RuntimeGateway] Failed to mark queued turn as errored", updateError)
            })
        }
        console.warn("[RuntimeGateway] Failed to drain queued turn", error)
    }
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

function inProgressActionEventIds(task: OpenADETask): string[] {
    const ids: string[] = []
    for (const rawEvent of task.events) {
        const event = eventRecord(rawEvent)
        if (!event || event.type !== "action" || event.status !== "in_progress") continue
        if (typeof event.id === "string") ids.push(event.id)
    }
    return ids
}

/**
 * Settle a task's dangling in-progress turn left behind by a previous main:
 * terminate any orphaned harness process (reparented to PID 1) for the task,
 * then mark its in-progress action event(s) as stopped. Never touches a turn
 * this main instance still owns (tracked in activeTaskExecutions), so a live
 * turn is always stopped through the in-memory abort path instead.
 */
async function reconcileStaleTaskExecution(params: {
    server: RuntimeServer
    writer: ReturnType<typeof createOpenADEYjsWriter>
    projection: ReturnType<typeof createOpenADEYjsProjection>
    taskId: string
    repoId?: string
}): Promise<{ killed: number; settled: number }> {
    if (activeTaskExecutions.has(params.taskId)) return { killed: 0, settled: 0 }

    const killed = terminateOrphanHarness(params.taskId).length

    let settled = 0
    try {
        let repoId = params.repoId
        if (!repoId) {
            const projects = await params.projection.readProjects()
            repoId = projects.find((project) => project.tasks.some((task) => task.id === params.taskId))?.id
        }
        if (repoId) {
            const task = await params.projection.readTask(repoId, params.taskId)
            for (const eventId of inProgressActionEventIds(task)) {
                const result = await params.writer.reconcileActionEventRuntime({ taskId: params.taskId, eventId, status: "stopped" })
                if (result.changed) settled++
            }
            if (settled > 0) publishTaskChanged(params.server, repoId, params.taskId)
        }
    } catch (error) {
        console.warn("[RuntimeGateway] Failed to reconcile stale task execution", { taskId: params.taskId, error })
    }

    return { killed, settled }
}

/**
 * On startup, reap harness processes orphaned by a previous main and settle the
 * action events they left in-progress. Only live orphans (reparented to PID 1)
 * are discoverable here; a buried dead in-progress event is settled lazily when
 * the user next stops or starts a turn on that task.
 */
async function reconcileDanglingOpenADETurns(params: {
    server: RuntimeServer
    writer: ReturnType<typeof createOpenADEYjsWriter>
    projection: ReturnType<typeof createOpenADEYjsProjection>
}): Promise<void> {
    for (const taskId of listOrphanHarnessProcesses().keys()) {
        await reconcileStaleTaskExecution({ ...params, taskId })
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
            readTask: async (repoId, taskId, options) => {
                const task = await projection.readTask(repoId, taskId)
                if (options?.hydrateSessionEvents === false) return task

                const projects = await projection.readProjects()
                const repoPath = projects.find((project) => project.id === repoId)?.path
                return hydrateOpenADETaskSessionEvents({ server, task, repoPath })
            },
            version: () => process.env.RELEASE ?? "local",
            scopedHost: {
                listProjectFiles: listScopedProjectFiles,
                readProjectFile: readScopedProjectFile,
                writeProjectFile: writeScopedProjectFile,
                searchProject: searchScopedProject,
                readTaskChanges: readScopedTaskChanges,
                readTaskDiff: readScopedTaskDiff,
                readTaskFilePair: readScopedTaskFilePair,
                readTaskGitLog: readScopedTaskGitLog,
                commitTaskGit: commitScopedTaskGit,
                listProjectProcesses: listScopedProjectProcesses,
                startProjectProcess: startScopedProjectProcess,
                reconnectProjectProcess: reconnectScopedProjectProcess,
                stopProjectProcess: stopScopedProjectProcess,
                startTaskTerminal: startScopedTaskTerminal,
                reconnectTaskTerminal: reconnectScopedTaskTerminal,
                writeTaskTerminal: writeScopedTaskTerminal,
                resizeTaskTerminal: resizeScopedTaskTerminal,
                stopTaskTerminal: stopScopedTaskTerminal,
                readTaskImage: readScopedTaskImage,
                readTaskSnapshotPatch: readScopedTaskSnapshotPatch,
                readTaskSnapshotIndex: readScopedTaskSnapshotIndex,
                readTaskSnapshotPatchSlice: readScopedTaskSnapshotPatchSlice,
            },
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
                    const existingTask = await readTaskForMutation(projection, params.repoId, params.inTaskId)
                    if (!canExecuteTaskInRuntime(existingTask)) {
                        throw new Error("Server-owned execution supports head and worktree tasks only")
                    }
                    if (activeTaskExecutions.has(existingTask.id)) {
                        return enqueueDoTurn({
                            writer,
                            server,
                            task: existingTask,
                            turn: params,
                        })
                    }
                    // Heal a dangling turn from a previous main (orphan process + stuck
                    // in-progress event) before starting a new one on this task.
                    await reconcileStaleTaskExecution({ server, writer, projection, taskId: existingTask.id, repoId: params.repoId })
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
                // No in-memory turn (e.g. main restarted): still kill any orphaned
                // harness process for this task and settle its in-progress event.
                const reconciled = await reconcileStaleTaskExecution({ server, writer, projection, taskId: params.taskId })
                if (reconciled.killed > 0 || reconciled.settled > 0) return { ok: true }
                return { ok: false, error: "No server-owned turn is running for this task" }
            },
            cancelQueuedTurn: async (params) =>
                cancelQueuedTurn({
                    writer,
                    projection,
                    server,
                    repoId: params.repoId,
                    taskId: params.taskId,
                    queuedTurnId: params.queuedTurnId,
                }),
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
    void reconcileDanglingOpenADETurns({ server, writer, projection })

}

async function startHeadModeTurn({
    server,
    writer,
    projection,
    yjsStorage,
    params,
    taskId,
    context,
    queuedTurnId,
}: {
    server: RuntimeServer
    writer: ReturnType<typeof createOpenADEYjsWriter>
    projection: ReturnType<typeof createOpenADEYjsProjection>
    yjsStorage: OpenADEYjsStorage
    params: OpenADETurnStartRequest
    taskId: string
    context?: OpenADETurnStartContext
    queuedTurnId?: string
}): Promise<{ eventId: string }> {
    const task = await readTaskForMutation(projection, params.repoId, taskId)
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
    if (queuedTurnId) {
        await updateQueuedTurn({
            writer,
            projection,
            server,
            repoId: params.repoId,
            taskId,
            queuedTurnId,
            patch: { status: "running", eventId: createdEvent.eventId },
        })
    }
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
        queuedTurnId,
        projection,
        yjsStorage,
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
    const task = await readTaskForMutation(projection, params.repoId, params.taskId)
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
        projection,
        yjsStorage,
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
            const currentTask = await readTaskForMutation(projection, params.repoId, params.taskId)
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
                projection,
                yjsStorage,
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
    projection,
    yjsStorage,
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
    queuedTurnId,
    onCompleted,
    isStopping,
}: {
    server: RuntimeServer
    writer: ReturnType<typeof createOpenADEYjsWriter>
    projection: ReturnType<typeof createOpenADEYjsProjection>
    yjsStorage: OpenADEYjsStorage
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
    queuedTurnId?: string
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
        if (queuedTurnId) {
            await updateQueuedTurn({
                writer,
                projection,
                server,
                repoId,
                taskId,
                queuedTurnId,
                patch: { status: terminalStatus === "completed" ? "completed" : terminalStatus === "stopped" ? "stopped" : "error", eventId },
            })
        }
        publishWorkingTasks(server)
        publishTaskChanged(server, repoId, taskId)

        if (terminalStatus === "completed" && onCompleted) {
            await onCompleted({ events: observedEvents, sessionId: savedSessionId, parentSessionId: resumeSessionId })
        }
        if (!activeTaskExecutions.has(taskId)) {
            void drainNextQueuedTurn({ server, writer, projection, yjsStorage, repoId, taskId })
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
                publishTaskChanged(server, repoId, taskId, { previewChanged: false })
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
                publishTaskChanged(server, repoId, taskId, { previewChanged: false })
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
        registerRemoteDeviceRuntimeMethods(runtimeServer)
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
