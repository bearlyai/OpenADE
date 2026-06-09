import os from "node:os"
import fs from "node:fs/promises"
import path from "node:path"
import { createHash, randomUUID } from "node:crypto"
import logger from "electron-log"
import {
    buildOpenADEHyperPlanStepPrompt,
    buildOpenADEProjectProcessDefinitions,
    buildOpenADETaskEnvironmentSetupOutput,
    buildOpenADETaskTitlePrompt,
    buildOpenADETaskResourceInventory,
    buildOpenADEReconcileStepPrompt,
    buildOpenADEReviewHandoffPrompt,
    buildOpenADEPlanReviewPrompt,
    buildOpenADEReviewStepPrompt,
    buildOpenADEReviseStepPrompt,
    buildOpenADEWorkReviewPrompt,
    buildOpenADEPrompt,
    assertOpenADETaskTerminalId,
    createOpenADEModule,
    createOpenADEYjsProjection,
    createOpenADEYjsWriter,
    decodeOpenADETaskTerminalOutputChunk,
    encodeOpenADETaskTerminalInput,
    extractOpenADEPlanText,
    fallbackOpenADETaskTitle,
    fuzzySearchOpenADEProjectFiles,
    groupOpenADEHyperPlanByDepth,
    isStandardOpenADEHyperPlanStrategy,
    listOpenADEProjectFiles,
    openADEProjectProcessInstanceFromRuntimeInfo,
    openADEProjectProcessReconnectResultFromUnknown,
    openADEProjectProcessScopeMatches,
    openADEProjectProcessStopResultFromUnknown,
    openADEProjectProcessTimeout,
    openADEQueuedTurnIdForClientRequest,
    openADETaskIdForClientRequest,
    openADETaskTerminalId,
    OPENADE_TASK_TITLE_OUTPUT_SCHEMA,
    OPENADE_TASK_TITLE_SYSTEM_PROMPT,
    publishOpenADECompanionEvent,
    readYjsPersonalSettings,
    readOpenADEProjectFile,
    readOpenADETaskSnapshotIndex,
    readOpenADETaskSnapshotPatch,
    readOpenADETaskSnapshotPatchSlice,
    readYjsMcpServers,
    replaceYjsPersonalSettings,
    replaceYjsMcpServers,
    resolveOpenADETaskWorkDir,
    resolveOpenADEHyperPlanStrategy,
    searchOpenADEProject,
    titleFromStructuredOutput,
    upsertYjsMcpServer,
    validateOpenADEHyperPlanStrategy,
    writeOpenADEProjectFile,
    deleteYjsMcpServer,
    type OpenADEActionEventSource,
    type OpenADEHyperPlanStep,
    type OpenADEHyperPlanStrategy,
    type OpenADEProject,
    type OpenADEProjectGitBranchesReadRequest,
    type OpenADEProjectGitBranchesReadResult,
    type OpenADEProjectGitInfoRequest,
    type OpenADEProjectGitInfoResult,
    type OpenADEProjectGitSummaryReadRequest,
    type OpenADEProjectGitSummaryReadResult,
    type OpenADEProjectProcessConfigError,
    type OpenADEProjectProcessDefinition,
    type OpenADEProjectProcessInstance,
    type OpenADEProjectProcessListRequest,
    type OpenADEProjectProcessListResult,
    type OpenADEProjectProcessRegistration,
    type OpenADEProjectProcessReconnectRequest,
    type OpenADEProjectProcessReconnectResult,
    type OpenADEProjectProcessStartRequest,
    type OpenADEProjectProcessStartResult,
    type OpenADEProjectProcessStopRequest,
    type OpenADEProjectProcessStopResult,
    type OpenADEQueuedTurn,
    type OpenADECronInstallState,
    type OpenADECronInstallStateReadRequest,
    type OpenADECronInstallStateReadResult,
    type OpenADECronInstallStateReplaceRequest,
    type OpenADECronInstallStateReplaceResult,
    type OpenADESnapshotEventRecord,
    type OpenADESnapshotChangedFile,
    type OpenADESetupEnvironmentEventCreateRequest,
    type OpenADETask,
    type OpenADETaskChangesReadRequest,
    type OpenADETaskChangesReadResult,
    type OpenADETaskDeleteRequest,
    type OpenADETaskDeviceEnvironment,
    type OpenADETaskEnvironmentPrepareRequest,
    type OpenADETaskEnvironmentPrepareResult,
    type OpenADETaskDiffReadRequest,
    type OpenADETaskDiffReadResult,
    type OpenADETaskFilePairReadRequest,
    type OpenADETaskFilePairReadResult,
    type OpenADETaskGitChangedFile,
    type OpenADETaskGitCommitFilePatchRequest,
    type OpenADETaskGitCommitFilePatchResult,
    type OpenADETaskGitCommitFilesRequest,
    type OpenADETaskGitCommitFilesResult,
    type OpenADETaskGitCommitRequest,
    type OpenADETaskGitCommitResult,
    type OpenADETaskGitFileAtTreeishRequest,
    type OpenADETaskGitFileAtTreeishResult,
    type OpenADETaskGitLogRequest,
    type OpenADETaskGitLogResult,
    type OpenADETaskGitScope,
    type OpenADETaskGitScopesReadRequest,
    type OpenADETaskGitScopesReadResult,
    type OpenADETaskGitSummaryRequest,
    type OpenADETaskGitSummaryResult,
    type OpenADETaskImageReadRequest,
    type OpenADETaskImageReadResult,
    type OpenADETaskImageReference,
    type OpenADETaskImageWriteRequest,
    type OpenADETaskImageWriteResult,
    type OpenADETaskResourceInventoryReadRequest,
    type OpenADETaskResourceInventoryReadResult,
    type OpenADETaskTerminalMutationResult,
    type OpenADETaskTerminalReconnectRequest,
    type OpenADETaskTerminalReconnectResult,
    type OpenADETaskTerminalResizeRequest,
    type OpenADETaskTerminalStartRequest,
    type OpenADETaskTerminalStartResult,
    type OpenADETaskTerminalStopRequest,
    type OpenADETaskTerminalWriteRequest,
    type OpenADETaskTitleGenerateRequest,
    type OpenADETaskTitleGenerateResult,
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
    structuredRuntimeHarnessQuery,
} from "../code/harness"
import { listOrphanHarnessProcesses, terminateOrphanHarness } from "../code/orphanHarness"
import { deleteRuntimeDataFile, loadRuntimeDataFile, saveRuntimeDataFile } from "../code/dataFolder"
import {
    deleteRuntimeBranch,
    deleteRuntimeWorkTree,
    getRuntimeChangedFiles,
    getRuntimeCommitFilePatch,
    getRuntimeCommitFiles,
    getRuntimeFileAtTreeish,
    getRuntimeFilePair,
    getRuntimeGitLog,
    getOrCreateRuntimeWorkTree,
    getRuntimeGitSummary,
    listRuntimeBranches,
    listRuntimeWorkTrees,
    getRuntimeMergeBase,
    getRuntimeWorktreeFilePatch,
    isRuntimeGitDirectory,
    isRuntimeBranchMerged,
    commitRuntimeWorkingTree,
} from "../code/git"
import {
    deleteRuntimeSnapshotBundle,
    loadRuntimeSnapshotIndex,
    loadRuntimeSnapshotPatch,
    loadRuntimeSnapshotPatchSlice,
    saveRuntimeSnapshotBundle,
} from "../code/snapshots"
import { type SnapshotPatchFile, type SnapshotPatchIndex } from "../code/snapshotsIndex"
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
    type ProcessInput,
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
import { runWithYjsDocumentOperationContext } from "../code/yjsStorage"
import { registerRuntimeAgentModule, registerServerProtocolAgentBridge } from "./runtimeAgents"
import { createRuntimeCheckpointStore } from "./runtimeCheckpoint"
import { registerRemoteDeviceRuntimeMethods } from "./deviceRuntime"
import { cleanupRuntimeHostModule, registerRuntimeHostModule } from "./runtimeHost"
import { createOpenADEYjsStorageAdapter } from "./runtimeYjsAdapter"
import { configurePowerKeeper } from "./powerKeeper"
import { createRuntimeNodeCodexAppServerBridge, notifyRuntimeNodeAgentBridgeEvent } from "../../../../runtime-node/src"
import { markOpenADECoreLegacyYjsMigrationAcceptedFromUnknown } from "../openadeCoreMigration"

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

const SLOW_RUNTIME_REQUEST_THRESHOLD_MS = 750

let runtimeServer: RuntimeServer | null = null
const runtimeBridgeUnregisters: (() => void)[] = []
type ActiveTaskExecution = { executionId: string; runtimeId: string; repoId: string; eventId: string; childExecutionIds?: Set<string>; stopping?: boolean }
const activeTaskExecutions = new Map<string, ActiveTaskExecution>()
const scopedProjectProcesses = new Map<string, OpenADEProjectProcessRegistration>()
const SCOPED_PROJECT_PROCS_CACHE_TTL_MS = 10_000
const RUNTIME_PROCESS_LIST_CACHE_TTL_MS = 1_000

interface PromiseCacheEntry<T> {
    promise?: Promise<T>
    result?: T
    expiresAt?: number
}

const scopedProjectProcsCache = new Map<string, PromiseCacheEntry<ReadProcsResult>>()
let runtimeProcessListCache: PromiseCacheEntry<Awaited<ReturnType<typeof listRuntimeProcesses>>> | null = null
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

function fallbackSlug(): string {
    return `task-${randomUUID().replace(/-/g, "").slice(0, 8)}`
}

function queuedTurnIdForClientRequest(taskId: string, clientRequestId: string | undefined): string {
    return openADEQueuedTurnIdForClientRequest(taskId, clientRequestId) ?? `queued-${randomUUID()}`
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
        invalidateScopedProjectProcessCaches()
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
        invalidateScopedProjectProcessCaches(optionalRuntimeStringParam(record, "searchPath"))
        return saveRuntimeEditableProcs({
            filePath: runtimeStringParam(record, "filePath"),
            relativePath: runtimeStringParam(record, "relativePath"),
            processes: processes as ProcessInput[],
            crons: crons as CronInput[],
            searchPath: optionalRuntimeStringParam(record, "searchPath"),
        })
    })
    server.register("host/capabilities/read", () => getRuntimeCodeCapabilities())
    server.register("host/core/legacyYjsMigration/accept", (params) => markOpenADECoreLegacyYjsMigrationAcceptedFromUnknown(params))
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

async function cleanupTaskResources(task: OpenADETask, repoPath: string, options: NonNullable<OpenADETaskDeleteRequest["options"]>): Promise<void> {
    const active = activeTaskExecutions.get(task.id)
    const inventory = buildOpenADETaskResourceInventory({ task, isRunning: active !== undefined })
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
        await Promise.all(inventory.snapshotIds.map((id) => deleteRuntimeSnapshotBundle({ id }).catch(() => undefined)))
    }

    if (options.deleteImages) {
        await Promise.all(
            inventory.images.map((image) =>
                deleteRuntimeDataFile({ folder: "images", id: image.id, ext: image.ext }).catch(() => undefined)
            )
        )
    }

    if (options.deleteSessions) {
        await Promise.all(inventory.sessions.map((session) => deleteRuntimeHarnessSession(session).catch(() => ({ ok: false }))))
    }

    if (options.deleteWorktrees && task.isolationStrategy?.type === "worktree") {
        const gitInfo = await isRuntimeGitDirectory({ directory: repoPath }).catch(() => null)
        if (gitInfo?.isGitDirectory) {
            await deleteRuntimeWorkTree({ repoDir: gitInfo.repoRoot, id: task.slug }).catch(() => undefined)
            await deleteRuntimeBranch({ repoDir: gitInfo.repoRoot, branchName: `openade/${task.slug}` }).catch(() => undefined)
        }
    }
}

function latestScopedTaskEnvironment(task: OpenADETask): OpenADETaskDeviceEnvironment | undefined {
    for (let index = task.deviceEnvironments.length - 1; index >= 0; index--) {
        const environment = task.deviceEnvironments[index]
        if (environment.setupComplete && environment.worktreeDir) return environment
    }
    return undefined
}

async function scopedTaskWorkDir(repo: OpenADEProject, task: OpenADETask): Promise<string> {
    return resolveOpenADETaskWorkDir(repo, task)
}

function scopedTaskFromTreeish(task: OpenADETask, fromTreeish?: string): string {
    if (fromTreeish) return fromTreeish
    return snapshotBaseForTask(task, latestScopedTaskEnvironment(task))?.fromTreeish ?? "HEAD"
}

type RuntimeGitSummary = Awaited<ReturnType<typeof getRuntimeGitSummary>>

function scopedTaskSummaryFile(
    file: RuntimeGitSummary["staged"]["files"][number],
    fallbackStatus: OpenADETaskGitChangedFile["status"]
): OpenADETaskGitChangedFile {
    return {
        path: file.path,
        status: file.status ?? fallbackStatus,
        binary: file.binary,
    }
}

async function readScopedProjectGitInfo(
    params: OpenADEProjectGitInfoRequest & { repo: OpenADEProject }
): Promise<OpenADEProjectGitInfoResult> {
    const gitInfo = await isRuntimeGitDirectory({ directory: params.repo.path })
    if (!gitInfo.isGitDirectory) {
        return {
            repoId: params.repoId,
            isGitRepo: false,
            error: gitInfo.error,
        }
    }

    return {
        repoId: params.repoId,
        isGitRepo: true,
        repoRoot: gitInfo.repoRoot,
        relativePath: gitInfo.relativePath,
        mainBranch: gitInfo.mainBranch,
        hasGhCli: gitInfo.hasGhCli,
    }
}

async function readScopedProjectGitBranches(
    params: OpenADEProjectGitBranchesReadRequest & { repo: OpenADEProject }
): Promise<OpenADEProjectGitBranchesReadResult> {
    const gitInfo = await isRuntimeGitDirectory({ directory: params.repo.path })
    if (!gitInfo.isGitDirectory) {
        return {
            repoId: params.repoId,
            branches: [],
            defaultBranch: "main",
        }
    }

    const result = await listRuntimeBranches({ repoDir: gitInfo.repoRoot, includeRemote: params.includeRemote })
    return {
        repoId: params.repoId,
        branches: result.branches,
        defaultBranch: result.defaultBranch,
    }
}

async function readScopedProjectGitSummary(
    params: OpenADEProjectGitSummaryReadRequest & { repo: OpenADEProject }
): Promise<OpenADEProjectGitSummaryReadResult> {
    const gitInfo = await isRuntimeGitDirectory({ directory: params.repo.path })
    if (!gitInfo.isGitDirectory) {
        return {
            repoId: params.repoId,
            branch: null,
            headCommit: "",
            ahead: null,
            hasChanges: false,
            staged: { files: [], stats: { filesChanged: 0, insertions: 0, deletions: 0 } },
            unstaged: { files: [], stats: { filesChanged: 0, insertions: 0, deletions: 0 } },
            untracked: [],
        }
    }

    const summary = await getRuntimeGitSummary({ repoDir: gitInfo.repoRoot })
    const stagedFiles = summary.staged.files.map((file) => scopedTaskSummaryFile(file, "modified"))
    const unstagedFiles = summary.unstaged.files.map((file) => scopedTaskSummaryFile(file, "modified"))
    const untracked = summary.untracked.map((file) => scopedTaskSummaryFile(file, "added"))
    return {
        repoId: params.repoId,
        branch: summary.branch,
        headCommit: summary.headCommit,
        ahead: summary.ahead,
        hasChanges: summary.hasChanges,
        staged: {
            files: stagedFiles,
            stats: summary.staged.stats,
        },
        unstaged: {
            files: unstagedFiles,
            stats: summary.unstaged.stats,
        },
        untracked,
    }
}

async function readScopedTaskGitSummary(
    params: OpenADETaskGitSummaryRequest & { repo: OpenADEProject; task: OpenADETask }
): Promise<OpenADETaskGitSummaryResult> {
    const workDir = await scopedTaskWorkDir(params.repo, params.task)
    const summary = await getRuntimeGitSummary({ repoDir: workDir })
    const stagedFiles = summary.staged.files.map((file) => scopedTaskSummaryFile(file, "modified"))
    const unstagedFiles = summary.unstaged.files.map((file) => scopedTaskSummaryFile(file, "modified"))
    const untracked = summary.untracked.map((file) => scopedTaskSummaryFile(file, "added"))

    return {
        repoId: params.repoId,
        taskId: params.taskId,
        branch: summary.branch,
        headCommit: summary.headCommit,
        ahead: summary.ahead,
        hasChanges: summary.hasChanges,
        staged: {
            files: stagedFiles,
            stats: summary.staged.stats,
        },
        unstaged: {
            files: unstagedFiles,
            stats: summary.unstaged.stats,
        },
        untracked,
    }
}

function scopedRuntimeWorktreeBranch(branch: string): string {
    return branch.replace(/^refs\/heads\//, "")
}

async function readScopedTaskGitScopes(
    params: OpenADETaskGitScopesReadRequest & { repo: OpenADEProject; task: OpenADETask }
): Promise<OpenADETaskGitScopesReadResult> {
    const workDir = await scopedTaskWorkDir(params.repo, params.task)
    const branches = await listRuntimeBranches({ repoDir: workDir, includeRemote: params.includeRemote })
    const worktrees = await listRuntimeWorkTrees({ repoDir: workDir }).catch(() => ({ worktrees: [] }))
    const scopes: OpenADETaskGitScope[] = [
        {
            id: "branch:HEAD",
            type: "branch",
            name: "HEAD",
            ref: "HEAD",
            isDefault: false,
            isRemote: false,
        },
        ...branches.branches.map((branch) => ({
            id: `branch:${branch.name}`,
            type: "branch" as const,
            name: branch.name,
            ref: branch.name,
            isDefault: branch.isDefault,
            isRemote: branch.isRemote,
        })),
        ...worktrees.worktrees.map((worktree) => ({
            id: `worktree:${worktree.id}`,
            type: "worktree" as const,
            worktreeId: worktree.id,
            branch: scopedRuntimeWorktreeBranch(worktree.branch),
            head: worktree.head,
            label: path.basename(worktree.path),
        })),
    ]

    return {
        repoId: params.repoId,
        taskId: params.taskId,
        defaultBranch: branches.defaultBranch,
        scopes,
    }
}

async function scopedTaskGitWorkDirForLog(params: OpenADETaskGitLogRequest & { repo: OpenADEProject; task: OpenADETask }): Promise<string> {
    const defaultWorkDir = await scopedTaskWorkDir(params.repo, params.task)
    if (!params.scopeId?.startsWith("worktree:")) return defaultWorkDir

    const worktreeId = params.scopeId.slice("worktree:".length)
    if (!worktreeId) return defaultWorkDir

    const worktrees = await listRuntimeWorkTrees({ repoDir: defaultWorkDir }).catch(() => ({ worktrees: [] }))
    return worktrees.worktrees.find((worktree) => worktree.id === worktreeId)?.path ?? defaultWorkDir
}

async function readScopedTaskResourceInventory(
    params: OpenADETaskResourceInventoryReadRequest & { repo: OpenADEProject; task: OpenADETask; isRunning: boolean }
): Promise<OpenADETaskResourceInventoryReadResult> {
    let branchMerged: boolean | null = null
    if (params.task.isolationStrategy?.type === "worktree") {
        const gitInfo = await isRuntimeGitDirectory({ directory: params.repo.path }).catch(() => null)
        if (gitInfo?.isGitDirectory) {
            branchMerged = await isRuntimeBranchMerged({
                repoDir: gitInfo.repoRoot,
                branchName: `openade/${params.task.slug}`,
                targetBranch: params.task.isolationStrategy.sourceBranch,
            }).catch(() => null)
        }
    }

    return buildOpenADETaskResourceInventory({
        task: params.task,
        isRunning: params.isRunning,
        branchMerged,
    })
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
    const workDir = await scopedTaskGitWorkDirForLog(params)
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

async function readScopedTaskGitCommitFiles(
    params: OpenADETaskGitCommitFilesRequest & { repo: OpenADEProject; task: OpenADETask }
): Promise<OpenADETaskGitCommitFilesResult> {
    const workDir = await scopedTaskWorkDir(params.repo, params.task)
    const result = await getRuntimeCommitFiles({ workDir, commit: params.commit })
    return {
        repoId: params.repoId,
        taskId: params.taskId,
        commit: params.commit,
        files: result.files,
    }
}

async function readScopedTaskGitFileAtTreeish(
    params: OpenADETaskGitFileAtTreeishRequest & { repo: OpenADEProject; task: OpenADETask }
): Promise<OpenADETaskGitFileAtTreeishResult> {
    const workDir = await scopedTaskWorkDir(params.repo, params.task)
    const result = await getRuntimeFileAtTreeish({ workDir, treeish: params.treeish, filePath: params.filePath })
    return {
        repoId: params.repoId,
        taskId: params.taskId,
        treeish: params.treeish,
        filePath: params.filePath,
        content: result.content,
        exists: result.exists,
        tooLarge: result.tooLarge,
    }
}

async function readScopedTaskGitCommitFilePatch(
    params: OpenADETaskGitCommitFilePatchRequest & { repo: OpenADEProject; task: OpenADETask }
): Promise<OpenADETaskGitCommitFilePatchResult> {
    const workDir = await scopedTaskWorkDir(params.repo, params.task)
    const result = await getRuntimeCommitFilePatch({
        workDir,
        commit: params.commit,
        filePath: params.filePath,
        oldPath: params.oldPath,
        contextLines: params.contextLines ?? 3,
        allowTruncation: params.allowTruncation,
    })
    return {
        repoId: params.repoId,
        taskId: params.taskId,
        commit: params.commit,
        filePath: params.filePath,
        oldPath: params.oldPath,
        patch: result.patch,
        truncated: result.truncated,
        heavy: result.heavy,
        stats: result.stats,
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

function titleModelIdForHarness(harnessId: HarnessId): string {
    return getModelFullId(getDefaultModelForHarness(harnessId), harnessId)
}

async function generateScopedTaskTitle(
    params: OpenADETaskTitleGenerateRequest & { repo: OpenADEProject; task: OpenADETask }
): Promise<OpenADETaskTitleGenerateResult> {
    const description = params.task.description.trim()
    const fallback = fallbackOpenADETaskTitle(description || params.task.title || "Untitled task") || "Untitled task"
    if (!description) return { repoId: params.repoId, taskId: params.taskId, title: fallback }

    const cwd = await scopedTaskWorkDir(params.repo, params.task)
    const harnessId = (params.harnessId ?? lastActionSessionContext(params.task)?.harnessId ?? "claude-code") as HarnessId
    const prompt = buildOpenADETaskTitlePrompt({ description, events: params.task.events })
    const result = await structuredRuntimeHarnessQuery({
        prompt,
        options: {
            harnessId,
            cwd,
            model: titleModelIdForHarness(harnessId),
            mode: "read-only",
            disablePlanningTools: true,
            appendSystemPrompt: OPENADE_TASK_TITLE_SYSTEM_PROMPT,
            processLabel: `OpenADE title ${params.task.id}`,
        },
        outputSchema: OPENADE_TASK_TITLE_OUTPUT_SCHEMA,
    })
    const title = result.ok ? titleFromStructuredOutput(result.output) : null
    return { repoId: params.repoId, taskId: params.taskId, title: title ?? fallback }
}

const runtimeSnapshotPatchStore = {
    loadPatch: (patchFileId: string) => loadRuntimeSnapshotPatch({ id: patchFileId }),
    loadIndex: (patchFileId: string) => loadRuntimeSnapshotIndex({ id: patchFileId }),
    loadPatchSlice: (patchFileId: string, start: number, end: number) => loadRuntimeSnapshotPatchSlice({ id: patchFileId, start, end }),
}

async function readScopedTaskSnapshotPatch(
    params: OpenADETaskSnapshotPatchReadRequest & { repo: OpenADEProject; task: OpenADETask; snapshotEvent: OpenADESnapshotEventRecord }
): Promise<OpenADETaskSnapshotPatchReadResult> {
    return readOpenADETaskSnapshotPatch({ ...params, store: runtimeSnapshotPatchStore })
}

async function readScopedTaskSnapshotIndex(
    params: OpenADETaskSnapshotIndexReadRequest & { repo: OpenADEProject; task: OpenADETask; snapshotEvent: OpenADESnapshotEventRecord }
): Promise<OpenADETaskSnapshotIndexReadResult> {
    return readOpenADETaskSnapshotIndex({ ...params, store: runtimeSnapshotPatchStore })
}

async function readScopedTaskSnapshotPatchSlice(
    params: OpenADETaskSnapshotPatchSliceReadRequest & { repo: OpenADEProject; task: OpenADETask; snapshotEvent: OpenADESnapshotEventRecord }
): Promise<OpenADETaskSnapshotPatchSliceReadResult> {
    return readOpenADETaskSnapshotPatchSlice({ ...params, store: runtimeSnapshotPatchStore })
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

async function writeRuntimeTaskImage(params: OpenADETaskImageWriteRequest): Promise<OpenADETaskImageWriteResult> {
    const data = Buffer.from(params.data, "base64")
    await saveRuntimeDataFile({ folder: "images", id: params.imageId, ext: params.ext, data })
    return {
        imageId: params.imageId,
        ext: params.ext,
        mediaType: params.mediaType,
        size: data.byteLength,
        sha256: createHash("sha256").update(data).digest("hex"),
    }
}

async function scopedProjectProcessSearchRoot(params: { repo: OpenADEProject; task?: OpenADETask }): Promise<string> {
    return params.task ? scopedTaskWorkDir(params.repo, params.task) : path.resolve(params.repo.path)
}

function projectProcessDefinitionsFromProcs(result: ReadProcsResult): {
    processes: OpenADEProjectProcessDefinition[]
    errors: OpenADEProjectProcessConfigError[]
} {
    const root = result.isWorktree && result.worktreeRoot ? result.worktreeRoot : result.repoRoot
    return buildOpenADEProjectProcessDefinitions({ root, configs: result.configs })
}

function cachedScopedProjectProcs(searchRoot: string): Promise<ReadProcsResult> {
    const now = Date.now()
    const cached = scopedProjectProcsCache.get(searchRoot)
    if (cached?.promise) return cached.promise
    if (cached?.result && cached.expiresAt && cached.expiresAt > now) return Promise.resolve(cached.result)

    const promise = readRuntimeProcs({ path: searchRoot })
        .then((result) => {
            scopedProjectProcsCache.set(searchRoot, { result, expiresAt: Date.now() + SCOPED_PROJECT_PROCS_CACHE_TTL_MS })
            return result
        })
        .catch((error: unknown) => {
            if (scopedProjectProcsCache.get(searchRoot)?.promise === promise) scopedProjectProcsCache.delete(searchRoot)
            throw error
        })
    scopedProjectProcsCache.set(searchRoot, { promise })
    return promise
}

function cachedRuntimeProcessList(): Promise<Awaited<ReturnType<typeof listRuntimeProcesses>>> {
    const now = Date.now()
    if (runtimeProcessListCache?.promise) return runtimeProcessListCache.promise
    if (runtimeProcessListCache?.result && runtimeProcessListCache.expiresAt && runtimeProcessListCache.expiresAt > now) {
        return Promise.resolve(runtimeProcessListCache.result)
    }

    const promise = listRuntimeProcesses()
        .then((result) => {
            runtimeProcessListCache = { result, expiresAt: Date.now() + RUNTIME_PROCESS_LIST_CACHE_TTL_MS }
            return result
        })
        .catch((error: unknown) => {
            if (runtimeProcessListCache?.promise === promise) runtimeProcessListCache = null
            throw error
        })
    runtimeProcessListCache = { promise }
    return promise
}

function invalidateScopedProjectProcessCaches(searchRoot?: string): void {
    runtimeProcessListCache = null
    if (searchRoot) {
        scopedProjectProcsCache.delete(searchRoot)
    } else {
        scopedProjectProcsCache.clear()
    }
}

async function listScopedProjectProcesses(
    params: OpenADEProjectProcessListRequest & { repo: OpenADEProject; task?: OpenADETask }
): Promise<OpenADEProjectProcessListResult> {
    const searchRoot = await scopedProjectProcessSearchRoot(params)
    const procs = await cachedScopedProjectProcs(searchRoot)
    const definitions = projectProcessDefinitionsFromProcs(procs)
    const runtimeProcesses = await cachedRuntimeProcessList()
    const instances = runtimeProcesses.processes
        .map((processInfo) => {
            const registration = scopedProjectProcesses.get(processInfo.processId)
            return registration && openADEProjectProcessScopeMatches(registration, params) ? openADEProjectProcessInstanceFromRuntimeInfo(processInfo, registration) : null
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
        timeoutMs: openADEProjectProcessTimeout(processDef, params.timeoutMs),
    })
    scopedProjectProcesses.set(started.processId, {
        repoId: params.repoId,
        taskId: params.taskId,
        definitionId: params.definitionId,
        cwd: processDef.cwd,
    })
    invalidateScopedProjectProcessCaches(listed.searchRoot)
    return {
        repoId: params.repoId,
        taskId: params.taskId,
        definitionId: params.definitionId,
        processId: started.processId,
        runtimeId: `process:${started.processId}`,
    }
}

async function reconnectScopedProjectProcess(
    params: OpenADEProjectProcessReconnectRequest & { repo: OpenADEProject; task?: OpenADETask }
): Promise<OpenADEProjectProcessReconnectResult> {
    const registration = scopedProjectProcesses.get(params.processId)
    if (!registration || !openADEProjectProcessScopeMatches(registration, params)) {
        return { repoId: params.repoId, taskId: params.taskId, processId: params.processId, found: false, output: [] }
    }
    const result = await reconnectRuntimeProcess(params.processId)
    return openADEProjectProcessReconnectResultFromUnknown(result, params)
}

async function stopScopedProjectProcess(
    params: OpenADEProjectProcessStopRequest & { repo: OpenADEProject; task?: OpenADETask }
): Promise<OpenADEProjectProcessStopResult> {
    const registration = scopedProjectProcesses.get(params.processId)
    if (!registration || !openADEProjectProcessScopeMatches(registration, params)) {
        return { repoId: params.repoId, taskId: params.taskId, processId: params.processId, ok: false, error: "Process not found" }
    }
    const result = await killRuntimeProcess(params.processId)
    if (result.ok) scopedProjectProcesses.delete(params.processId)
    invalidateScopedProjectProcessCaches()
    return openADEProjectProcessStopResultFromUnknown(result, params)
}

async function startScopedTaskTerminal(
    params: OpenADETaskTerminalStartRequest & { repo: OpenADEProject; task: OpenADETask }
): Promise<OpenADETaskTerminalStartResult> {
    const cwd = await scopedTaskWorkDir(params.repo, params.task)
    const terminalId = openADETaskTerminalId(params.repoId, params.taskId)
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
    const terminalId = params.terminalId ?? openADETaskTerminalId(params.repoId, params.taskId)
    assertOpenADETaskTerminalId({ ...params, terminalId })
    const result = await reconnectRuntimePty({ ptyId: terminalId })
    return {
        repoId: params.repoId,
        taskId: params.taskId,
        terminalId,
        found: result.found,
        exited: result.exited,
        exitCode: result.exitCode ?? null,
        outputCount: result.output.length,
        output: result.output.map(decodeOpenADETaskTerminalOutputChunk),
    }
}

async function writeScopedTaskTerminal(
    params: OpenADETaskTerminalWriteRequest & { repo: OpenADEProject; task: OpenADETask }
): Promise<OpenADETaskTerminalMutationResult> {
    assertOpenADETaskTerminalId(params)
    const result = await writeRuntimePty({ ptyId: params.terminalId, data: encodeOpenADETaskTerminalInput(params.data) })
    return { repoId: params.repoId, taskId: params.taskId, terminalId: params.terminalId, ok: result.ok }
}

async function resizeScopedTaskTerminal(
    params: OpenADETaskTerminalResizeRequest & { repo: OpenADEProject; task: OpenADETask }
): Promise<OpenADETaskTerminalMutationResult> {
    assertOpenADETaskTerminalId(params)
    const result = await resizeRuntimePty({ ptyId: params.terminalId, cols: params.cols, rows: params.rows })
    return { repoId: params.repoId, taskId: params.taskId, terminalId: params.terminalId, ok: result.ok }
}

async function stopScopedTaskTerminal(
    params: OpenADETaskTerminalStopRequest & { repo: OpenADEProject; task: OpenADETask }
): Promise<OpenADETaskTerminalMutationResult> {
    assertOpenADETaskTerminalId(params)
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
            if (typeof row.cwd === "string" && row.cwd) config.cwd = row.cwd
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
    file: OpenADETaskGitChangedFile,
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
            setupOutput: buildOpenADETaskEnvironmentSetupOutput({
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

async function prepareScopedTaskEnvironment(
    params: OpenADETaskEnvironmentPrepareRequest & { repo: OpenADEProject; task: OpenADETask; createdAt: string }
): Promise<OpenADETaskEnvironmentPrepareResult> {
    const environment = await createTaskEnvironment({
        repoPath: params.repo.path,
        slug: params.task.slug,
        isolationStrategy: params.task.isolationStrategy ?? { type: "head" },
        createdAt: params.createdAt,
    })
    return {
        repoId: params.repoId,
        taskId: params.taskId,
        deviceEnvironment: environment.deviceEnvironment,
        setupEvent: environment.setupEvent,
        cwd: environment.cwd,
        rootPath: environment.rootPath,
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

interface RuntimeCronInstallStateDocument {
    installations: Record<string, OpenADECronInstallState>
}

function runtimeCronInstallStateFromUnknown(key: string, value: unknown): OpenADECronInstallState | null {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null
    const record = value as Record<string, unknown>
    const cronId = typeof record.cronId === "string" && record.cronId.trim() ? record.cronId.trim() : key
    const installedAt = typeof record.installedAt === "string" ? record.installedAt : ""
    if (!cronId || !installedAt) return null
    return {
        cronId,
        enabled: record.enabled === true,
        installedAt,
        lastRunAt: typeof record.lastRunAt === "string" && record.lastRunAt ? record.lastRunAt : undefined,
        lastTaskId: typeof record.lastTaskId === "string" && record.lastTaskId ? record.lastTaskId : undefined,
    }
}

function parseRuntimeCronInstallStateDocument(raw: string): RuntimeCronInstallStateDocument {
    let parsed: unknown
    try {
        parsed = JSON.parse(raw)
    } catch {
        return { installations: {} }
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return { installations: {} }
    const document = parsed as Record<string, unknown>
    const source = typeof document.installations === "object" && document.installations !== null && !Array.isArray(document.installations) ? document.installations : parsed
    const sourceRecord = source as Record<string, unknown>
    const installations: Record<string, OpenADECronInstallState> = {}
    for (const [key, value] of Object.entries(sourceRecord)) {
        const state = runtimeCronInstallStateFromUnknown(key, value)
        if (state) installations[state.cronId] = state
    }
    return { installations }
}

async function readRuntimeCronInstallState(params: OpenADECronInstallStateReadRequest): Promise<OpenADECronInstallStateReadResult> {
    const data = await loadRuntimeDataFile({ folder: "cron", id: params.repoId, ext: "json" })
    if (data === null) return { repoId: params.repoId, installations: {} }
    const raw = Buffer.isBuffer(data) ? data.toString("utf8") : data
    return { repoId: params.repoId, installations: parseRuntimeCronInstallStateDocument(raw).installations }
}

async function replaceRuntimeCronInstallState(params: OpenADECronInstallStateReplaceRequest): Promise<OpenADECronInstallStateReplaceResult> {
    const document: RuntimeCronInstallStateDocument = { installations: params.installations }
    await saveRuntimeDataFile({
        folder: "cron",
        id: params.repoId,
        ext: "json",
        data: JSON.stringify(document, null, 2),
    })
    return {
        repoId: params.repoId,
        installations: params.installations,
        replacedInstallations: Object.keys(params.installations).length,
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
                const task = await projection.readTask(repoId, taskId, options)
                if (options?.hydrateSessionEvents === false) return task

                const projects = await projection.readProjects()
                const repoPath = projects.find((project) => project.id === repoId)?.path
                return hydrateOpenADETaskSessionEvents({ server, task, repoPath })
            },
            readMcpServers: () => readYjsMcpServers(yjsStorage),
            replaceMcpServers: (params) => replaceYjsMcpServers(yjsStorage, params.servers),
            upsertMcpServer: (params) => upsertYjsMcpServer(yjsStorage, params.server),
            deleteMcpServer: (params) => deleteYjsMcpServer(yjsStorage, params.serverId),
            readPersonalSettings: () => readYjsPersonalSettings(yjsStorage),
            replacePersonalSettings: (params) => replaceYjsPersonalSettings(yjsStorage, params.settings),
            readCronInstallState: readRuntimeCronInstallState,
            replaceCronInstallState: replaceRuntimeCronInstallState,
            version: () => process.env.RELEASE ?? "local",
            scopedHost: {
                listProjectFiles: listOpenADEProjectFiles,
                readProjectFile: readOpenADEProjectFile,
                writeProjectFile: writeOpenADEProjectFile,
                fuzzySearchProjectFiles: fuzzySearchOpenADEProjectFiles,
                searchProject: searchOpenADEProject,
                readProjectGitInfo: readScopedProjectGitInfo,
                readProjectGitBranches: readScopedProjectGitBranches,
                readProjectGitSummary: readScopedProjectGitSummary,
                readTaskGitSummary: readScopedTaskGitSummary,
                readTaskGitScopes: readScopedTaskGitScopes,
                readTaskResourceInventory: readScopedTaskResourceInventory,
                readTaskChanges: readScopedTaskChanges,
                readTaskDiff: readScopedTaskDiff,
                readTaskFilePair: readScopedTaskFilePair,
                readTaskGitLog: readScopedTaskGitLog,
                readTaskGitCommitFiles: readScopedTaskGitCommitFiles,
                readTaskGitFileAtTreeish: readScopedTaskGitFileAtTreeish,
                readTaskGitCommitFilePatch: readScopedTaskGitCommitFilePatch,
                commitTaskGit: commitScopedTaskGit,
                prepareTaskEnvironment: prepareScopedTaskEnvironment,
                generateTaskTitle: generateScopedTaskTitle,
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
            writeTaskImage: writeRuntimeTaskImage,
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
                const taskId = openADETaskIdForClientRequest(params.repoId, params.clientRequestId)
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
                    title: params.title ?? fallbackOpenADETaskTitle(params.input),
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
            slowRequestThresholdMs: SLOW_RUNTIME_REQUEST_THRESHOLD_MS,
            onSlowRequest: (event) => {
                logger.warn("[Runtime] Slow request", JSON.stringify(event))
            },
            onNotificationBurst: (event) => {
                logger.warn("[Runtime] Notification burst", JSON.stringify(event))
            },
            runHandlerWithContext: (event, run) => runWithYjsDocumentOperationContext({ runtimeMethod: event.method }, run),
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
