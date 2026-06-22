import NiceModal from "@ebay/nice-modal-react"
import { runInAction } from "mobx"
import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, it, vi } from "vitest"
import * as Y from "yjs"
import { OPENADE_METHOD, OPENADE_NOTIFICATION, OpenADEClient } from "../../../openade-client/src"
import type { OpenADECoreRolloutState, OpenADECoreRuntimeEndpoint } from "../../../electron/src/preload-api"
import { type OpenADEModuleAdapters, createOpenADEModule } from "../../../openade-module/src/module"
import { buildOpenADETaskResourceInventory } from "../../../openade-module/src/taskResourceInventory"
import type {
    OpenADECronInstallState,
    OpenADELegacyResourcesImportRequest,
    OpenADEMCPServer,
    OpenADEPersonalSettings,
    OpenADEProject,
    OpenADEProjectFileWriteRequest,
    OpenADEQueuedTurn,
    OpenADEReviewStartRequest,
    OpenADESnapshotPatchIndex,
    OpenADETask,
    OpenADETaskCreateRequest,
    OpenADETaskGitLogResult,
    OpenADETaskMetadataUpdateRequest,
    OpenADETaskPreview,
    OpenADETaskPreviewUsage,
    OpenADETurnStartRequest,
} from "../../../openade-module/src/types"
import { RuntimeLocalClient, type RuntimeLocalTransport } from "../../../runtime-client/src"
import type { RuntimeListParams, RuntimeMessage, RuntimeNotification, RuntimeRecord, RuntimeRequest, RuntimeResponse } from "../../../runtime-protocol/src"
import { type RuntimeConnection, RuntimeServer } from "../../../runtime/src"
import { analytics } from "../analytics"
import { EnvironmentSetupView } from "../components/EnvironmentSetupView"
import { GitLogTray } from "../components/GitLogTray"
import { ProcessesTray } from "../components/ProcessesTray"
import { ReviewPickerModal } from "../components/ReviewPickerModal"
import { ViewPatch } from "../components/ViewPatch"
import { ImageAttachments } from "../components/events/ImageAttachments"
import { SnapshotEventItem } from "../components/events/SnapshotEventItem"
import {
    loadProcsEditorFile,
    parseProcsEditorRaw,
    readProcsEditorConfigs,
    saveProcsEditorFile,
    serializeProcsEditorRaw,
} from "../components/procs/ProcsEditorModal"
import { importCoreLegacyResourcesFromSelection } from "../components/settings/coreResourceMigration"
import { CronsSidebarContent } from "../components/sidebar/CronList"
import { resolveTaskListCopyPath } from "../components/sidebar/TaskList"
import { dataFolderApi } from "../electronAPI/dataFolder"
import { filesApi } from "../electronAPI/files"
import { gitApi } from "../electronAPI/git"
import { ProcessHandle } from "../electronAPI/process"
import { snapshotsApi } from "../electronAPI/snapshots"
import { OpenADEProductStore } from "../kernel/productStore"
import { createMcpServerStore } from "../persistence/mcpServerStore"
import { createPersonalSettingsStore } from "../persistence/personalSettingsStore"
import { createRepoStore } from "../persistence/repoStore"
import { createTaskStore } from "../persistence/taskStore"
import { localOpenADEClient } from "../runtime/localOpenADEClient"
import { localRuntimeClient } from "../runtime/localRuntimeClient"
import type { ImageAttachment, Task } from "../types"
import type { SnapshotEventModel } from "./EventModel"
import { TaskEnvironment } from "./TaskEnvironment"
import { CodeStoreProvider } from "./context"
import type { ProductProjectProcessAccess } from "./managers/RepoProcessesManager"
import { readProcsResultFromProductProcesses } from "./projectProcessReadResult"
import { CodeStore, type CodeStoreLegacyStoreConnectors } from "./store"

const now = "2026-05-31T00:00:00.000Z"
function createReleaseGate(): { wait: Promise<void>; release: () => void } {
    let release = () => {}
    const wait = new Promise<void>((resolve) => {
        release = resolve
    })
    return { wait, release }
}

const subprocessMocks = vi.hoisted(() => ({
    setGlobalEnv: vi.fn(async () => ({ success: true })),
}))

vi.mock("../electronAPI/subprocess", () => ({
    setGlobalEnv: subprocessMocks.setGlobalEnv,
}))

const project: OpenADEProject = {
    id: "repo-1",
    name: "Runtime Repo",
    path: "/tmp/runtime-repo",
    tasks: [
        {
            id: "task-1",
            slug: "runtime-task",
            title: "Runtime task",
            createdAt: now,
        },
    ],
}

const task: OpenADETask = {
    id: "task-1",
    repoId: "repo-1",
    slug: "runtime-task",
    title: "Runtime task",
    description: "Read through the desktop runtime product bridge.",
    isolationStrategy: { type: "head" },
    createdBy: { id: "user-1", email: "user@example.com" },
    createdAt: now,
    updatedAt: now,
    deviceEnvironments: [],
    events: [
        {
            id: "event-1",
            type: "action",
            status: "completed",
            createdAt: now,
            completedAt: now,
            userInput: "Do the runtime-backed work",
            execution: {
                harnessId: "codex",
                executionId: "exec-1",
                modelId: "gpt-test",
                events: [],
            },
            source: { type: "do", userLabel: "Do" },
            includesCommentIds: ["comment-1"],
            result: { success: true },
        },
    ],
    comments: [
        {
            id: "comment-1",
            content: "Runtime-backed",
            source: {
                type: "llm_output",
                eventId: "event-1",
                lineStart: 1,
                lineEnd: 1,
            },
            selectedText: { text: "Runtime", linesBefore: "", linesAfter: "" },
            author: { id: "user-1", email: "user@example.com" },
            createdAt: now,
        },
    ],
}

const snapshotPatch = [
    "diff --git a/README.md b/README.md",
    "index 1111111..2222222 100644",
    "--- a/README.md",
    "+++ b/README.md",
    "@@ -1 +1,2 @@",
    "-old runtime",
    "+new runtime",
    "+snapshot product store",
    "",
].join("\n")

const snapshotPatchIndex: OpenADESnapshotPatchIndex = {
    version: 1,
    patchSize: snapshotPatch.length,
    files: [
        {
            id: "README.md",
            path: "README.md",
            status: "modified",
            binary: false,
            insertions: 2,
            deletions: 1,
            changedLines: 3,
            hunkCount: 1,
            patchStart: 0,
            patchEnd: snapshotPatch.length,
        },
    ],
}

const gitLogCommits = [
    {
        sha: "abc123456789",
        shortSha: "abc1234",
        message: "Runtime product store commit",
        author: "Runtime Author",
        date: now,
        relativeDate: "1 minute ago",
        parentCount: 1,
    },
    {
        sha: "def123456789",
        shortSha: "def1234",
        message: "Previous runtime commit",
        author: "Runtime Author",
        date: now,
        relativeDate: "2 minutes ago",
        parentCount: 1,
    },
]

function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
    let resolve!: (value: T) => void
    const promise = new Promise<T>((promiseResolve) => {
        resolve = promiseResolve
    })
    return { promise, resolve }
}

interface RuntimeBridgeState {
    project: OpenADEProject | null
    task: OpenADETask | null
    taskUsage?: OpenADETaskPreviewUsage
    usageBackfillRequests?: Array<{
        repoId?: string
        taskIds?: string[]
        force?: boolean
    }>
    usageRecalculateRequests?: Array<{ repoId: string; taskId: string }>
    resourceInventoryBranchMerged?: boolean | null
    taskReadRequests?: Array<{
        repoId: string
        taskId: string
        hydrateSessionEvents: boolean | undefined
        eventLimit?: number
    }>
    taskReadGate?: Promise<void>
    taskGitSummaryReadCount?: number
    projectFiles?: Map<string, { content: string; encoding: "utf8" | "base64" }>
    projectFileWrites?: OpenADEProjectFileWriteRequest[]
    writtenImages?: Map<string, { data: string; ext: string; mediaType: string }>
    terminal?: {
        terminalId: string
        output: string[]
        writes: string[]
        resizedTo?: { cols: number; rows: number }
        exited: boolean
    }
    projectProcess?: {
        processId: string
        running: boolean
        output: string[]
        stopped: boolean
    }
    personalSettings?: OpenADEPersonalSettings
    mcpServers?: OpenADEMCPServer[]
    mcpServerReadCount?: number
    personalSettingsReadCount?: number
    cronInstallStates?: Record<string, Record<string, OpenADECronInstallState>>
    legacyImportRequests?: OpenADELegacyResourcesImportRequest[]
    turnStartRequests?: OpenADETurnStartRequest[]
    taskCreateRequests?: OpenADETaskCreateRequest[]
    taskMetadataUpdateRequests?: OpenADETaskMetadataUpdateRequest[]
    reviewStartRequests?: OpenADEReviewStartRequest[]
    snapshotReadCount?: number
    projectReadCount?: number
    taskListReadCount?: number
    projectProcessListCount?: number
    projectGitInfoReadCount?: number
    projectGitBranchesReadCount?: number
    projectGitSummaryReadCount?: number
}

function cloneProject(value: OpenADEProject): OpenADEProject {
    return structuredClone(value)
}

function cloneTask(value: OpenADETask): OpenADETask {
    return structuredClone(value)
}

function taskPreviewFromTask(value: OpenADETask, usage?: OpenADETaskPreviewUsage): OpenADETaskPreview {
    return {
        id: value.id,
        slug: value.slug,
        title: value.title,
        closed: value.closed,
        createdAt: value.createdAt ?? now,
        lastEventAt: value.lastEventAt,
        lastViewedAt: value.lastViewedAt,
        usage,
    }
}

function projectFromState(state: RuntimeBridgeState): OpenADEProject | null {
    if (!state.project) return null
    return {
        ...cloneProject(state.project),
        tasks: state.task ? [taskPreviewFromTask(state.task, state.taskUsage)] : [],
    }
}

function projectsFromState(state: RuntimeBridgeState): OpenADEProject[] {
    const currentProject = projectFromState(state)
    return currentProject ? [currentProject] : []
}

function createBridgeState(): RuntimeBridgeState {
    return {
        project: cloneProject(project),
        task: cloneTask(task),
        personalSettings: {
            envVars: {},
            theme: "system",
            renderMarkdownMessages: true,
        },
        mcpServers: [],
        cronInstallStates: {},
    }
}

function unsupportedMutation(method: string): () => Promise<never> {
    return async () => {
        throw new Error(`${method} is not available in the read-only bridge test runtime`)
    }
}

function snapshotPatchForEvent(snapshotEvent: Record<string, unknown>): {
    patchFileId?: string
    patch: string | null
} {
    const patchFileId = typeof snapshotEvent.patchFileId === "string" ? snapshotEvent.patchFileId : undefined
    const inlinePatch = typeof snapshotEvent.fullPatch === "string" && snapshotEvent.fullPatch.length > 0 ? snapshotEvent.fullPatch : null
    if (inlinePatch) return { patchFileId, patch: inlinePatch }
    return {
        patchFileId,
        patch: patchFileId === "patch-1" ? snapshotPatch : null,
    }
}

function snapshotIndexForPatch(patch: string | null): OpenADESnapshotPatchIndex | null {
    if (patch === null) return null
    return {
        ...snapshotPatchIndex,
        patchSize: patch.length,
        files: snapshotPatchIndex.files.map((file) => ({
            ...file,
            patchEnd: patch.length,
        })),
    }
}

function requireStateTask(state: RuntimeBridgeState, taskId: string): OpenADETask {
    if (!state.task || state.task.id !== taskId) throw new Error(`Task ${taskId} not found`)
    return state.task
}

function taskEventRecord(value: unknown): value is Record<string, unknown> & { id: string } {
    return typeof value === "object" && value !== null && !Array.isArray(value) && "id" in value && typeof value.id === "string"
}

function requireStateProject(state: RuntimeBridgeState, repoId: string): OpenADEProject {
    if (!state.project || state.project.id !== repoId) throw new Error(`Repo ${repoId} not found`)
    return state.project
}

const runtimeSearchFixture = {
    path: "src/runtime-search.ts",
    content: "export const marker = 'runtime needle';\n",
}

function createReadOnlyAdapters(state: RuntimeBridgeState): OpenADEModuleAdapters {
    return {
        version: () => "bridge-test-version",
        readSnapshot: async () => {
            state.snapshotReadCount = (state.snapshotReadCount ?? 0) + 1
            return {
                server: {
                    version: "bridge-test-version",
                    hostName: "bridge-test-host",
                    theme: { setting: "system", className: "code-theme-light" },
                },
                repos: projectsFromState(state),
                workingTaskIds: [],
            }
        },
        readProjects: async () => {
            state.projectReadCount = (state.projectReadCount ?? 0) + 1
            return projectsFromState(state)
        },
        readTaskList: async () => {
            state.taskListReadCount = (state.taskListReadCount ?? 0) + 1
            return projectFromState(state)?.tasks ?? []
        },
        readTask: async (repoId, taskId, options) => {
            const request: NonNullable<RuntimeBridgeState["taskReadRequests"]>[number] = {
                repoId,
                taskId,
                hydrateSessionEvents: options?.hydrateSessionEvents,
            }
            if (options?.eventLimit !== undefined) request.eventLimit = options.eventLimit
            state.taskReadRequests?.push(request)
            await state.taskReadGate
            if (!state.task || taskId !== state.task.id) throw new Error(`Task ${taskId} not found`)
            return cloneTask(state.task)
        },
        listDataDocuments: async () => [],
        readDataDocumentBase64: async () => null,
        saveDataDocumentBase64: unsupportedMutation("saveDataDocumentBase64"),
        deleteDataDocument: unsupportedMutation("deleteDataDocument"),
        readMcpServers: async () => {
            state.mcpServerReadCount = (state.mcpServerReadCount ?? 0) + 1
            return {
                servers: (state.mcpServers ?? []).map((server) => structuredClone(server)),
            }
        },
        replaceMcpServers: async (params) => {
            state.mcpServers = params.servers.map((server) => structuredClone(server))
            return {
                servers: state.mcpServers.map((server) => structuredClone(server)),
                replacedServers: state.mcpServers.length,
            }
        },
        upsertMcpServer: async (params) => {
            const currentServers = state.mcpServers ?? []
            const index = currentServers.findIndex((server) => server.id === params.server.id)
            const created = index === -1
            if (created) {
                state.mcpServers = [...currentServers, structuredClone(params.server)]
            } else {
                state.mcpServers = currentServers.map((server) => (server.id === params.server.id ? structuredClone(params.server) : server))
            }
            return { server: structuredClone(params.server), created }
        },
        deleteMcpServer: async (params) => {
            const currentServers = state.mcpServers ?? []
            const deleted = currentServers.some((server) => server.id === params.serverId)
            state.mcpServers = currentServers.filter((server) => server.id !== params.serverId)
            return { serverId: params.serverId, deleted }
        },
        readPersonalSettings: async () => ({
            settings: (() => {
                state.personalSettingsReadCount = (state.personalSettingsReadCount ?? 0) + 1
                return structuredClone(
                    state.personalSettings ?? {
                        envVars: {},
                        theme: "system",
                        renderMarkdownMessages: true,
                    }
                )
            })(),
        }),
        replacePersonalSettings: async (params) => {
            state.personalSettings = structuredClone(params.settings)
            return { settings: structuredClone(params.settings) }
        },
        readCronInstallState: async (params) => ({
            repoId: params.repoId,
            installations: structuredClone(state.cronInstallStates?.[params.repoId] ?? {}),
        }),
        replaceCronInstallState: async (params) => {
            state.cronInstallStates = {
                ...(state.cronInstallStates ?? {}),
                [params.repoId]: structuredClone(params.installations),
            }
            return {
                repoId: params.repoId,
                installations: structuredClone(params.installations),
                replacedInstallations: Object.keys(params.installations).length,
            }
        },
        createRepo: async (params) => {
            const repoId = params.repoId ?? "repo-created"
            const createdAt = params.createdAt ?? now
            state.project = {
                id: repoId,
                name: params.name,
                path: params.path,
                tasks: [],
            }
            state.task = null
            state.taskUsage = undefined
            return { repoId, createdAt }
        },
        updateRepo: async (params) => {
            if (!state.project || state.project.id !== params.repoId) throw new Error(`Repo ${params.repoId} not found`)
            state.project = {
                ...state.project,
                name: params.name ?? state.project.name,
                path: params.path ?? state.project.path,
                archived: params.archived ?? state.project.archived,
            }
        },
        deleteRepo: async (params) => {
            if (!state.project || state.project.id !== params.repoId) throw new Error(`Repo ${params.repoId} not found`)
            state.project = null
            if (state.task?.repoId === params.repoId) state.task = null
            if (!state.task) state.taskUsage = undefined
        },
        createTask: async (params) => {
            state.taskCreateRequests = [...(state.taskCreateRequests ?? []), structuredClone(params)]
            requireStateProject(state, params.repoId)
            const taskId = params.taskId ?? "task-created"
            const slug = params.slug ?? taskId
            const title = params.title ?? "Created task"
            const createdAt = params.createdAt ?? now
            state.task = {
                id: taskId,
                repoId: params.repoId,
                slug,
                title,
                description: params.input,
                isolationStrategy: params.isolationStrategy ?? { type: "head" },
                deviceEnvironments: params.deviceEnvironment ? [structuredClone(params.deviceEnvironment)] : [],
                events: [],
                comments: [],
                createdAt,
            }
            state.taskUsage = undefined
            return { taskId, slug, title, createdAt }
        },
        startTurn: async (params) => {
            state.turnStartRequests = [...(state.turnStartRequests ?? []), structuredClone(params)]
            const existingTaskId = params.inTaskId ?? state.task?.id
            const taskId = existingTaskId ?? "task-started"
            const repoId = params.repoId
            const eventId = "event-started"
            let createdTask = false
            const actionEvent = {
                id: eventId,
                type: "action",
                status: "in_progress",
                createdAt: now,
                userInput: params.input,
                execution: {
                    harnessId: params.harnessId ?? "codex",
                    executionId: "exec-started",
                    modelId: params.modelId,
                    events: [],
                    thinking: params.thinking,
                    fastMode: params.fastMode,
                },
                source: { type: params.type, userLabel: params.label ?? params.type },
                includesCommentIds: [],
            }
            if (state.task && existingTaskId === state.task.id) {
                state.task = {
                    ...state.task,
                    events: [...state.task.events, actionEvent],
                    lastEventAt: now,
                    updatedAt: now,
                }
            } else {
                createdTask = true
                state.project = state.project ?? {
                    id: repoId,
                    name: "Runtime Repo",
                    path: "/tmp/runtime-repo",
                    tasks: [],
                }
                state.task = {
                    id: taskId,
                    repoId,
                    slug: "task-started",
                    title: params.title ?? "Started task",
                    description: params.input,
                    isolationStrategy: params.isolationStrategy,
                    enabledMcpServerIds: params.enabledMcpServerIds,
                    deviceEnvironments: [],
                    createdBy: { id: "user-1", email: "user@example.com" },
                    createdAt: now,
                    updatedAt: now,
                    events: [actionEvent],
                    comments: [],
                }
                state.taskUsage = undefined
            }
            return {
                taskId,
                eventId,
                executionId: "exec-started",
                createdAt: now,
                ...(createdTask && state.task
                    ? {
                          task: structuredClone(state.task),
                          preview: taskPreviewFromTask(state.task, state.taskUsage),
                      }
                    : {}),
            }
        },
        startReview: async (params) => {
            state.reviewStartRequests = [...(state.reviewStartRequests ?? []), structuredClone(params)]
            const current = requireStateTask(state, params.taskId)
            const eventId = "event-review"
            state.task = {
                ...current,
                events: [
                    ...current.events,
                    {
                        id: eventId,
                        type: "action",
                        status: "completed",
                        createdAt: now,
                        completedAt: now,
                        userInput: params.customInstructions ?? "",
                        execution: {
                            harnessId: params.harnessId,
                            executionId: "exec-review",
                            modelId: params.modelId,
                            events: [],
                        },
                        source: { type: "review", userLabel: params.reviewType },
                        includesCommentIds: [],
                        result: { success: true },
                    },
                ],
                lastEventAt: now,
                updatedAt: now,
            }
            return {
                taskId: params.taskId,
                eventId,
                executionId: "exec-review",
                createdAt: now,
            }
        },
        interruptTurn: async (params) => {
            requireStateTask(state, params.taskId)
        },
        enqueueQueuedTurn: async (params) => {
            const current = requireStateTask(state, params.taskId)
            const createdAt = params.createdAt ?? now
            const turn: OpenADEQueuedTurn = {
                id: params.queuedTurnId ?? `queued-${current.queuedTurns?.length ?? 0}`,
                clientRequestId: params.clientRequestId,
                type: params.type,
                input: params.input,
                status: "queued",
                createdAt,
                updatedAt: createdAt,
                eventId: params.eventId,
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
            state.task = {
                ...current,
                queuedTurns: [...(current.queuedTurns ?? []).filter((candidate) => candidate.id !== turn.id), turn],
                updatedAt: now,
            }
            return {
                taskId: params.taskId,
                queuedTurnId: turn.id,
                queued: true,
                turn,
            }
        },
        reorderQueuedTurns: async (params) => {
            const current = requireStateTask(state, params.taskId)
            const turnsById = new Map((current.queuedTurns ?? []).map((turn) => [turn.id, turn]))
            const updatedAt = params.updatedAt ?? now
            const turns = params.queuedTurnIds.map((queuedTurnId) => {
                const turn = turnsById.get(queuedTurnId)
                if (!turn) throw new Error(`Queued turn ${queuedTurnId} not found`)
                return { ...turn, updatedAt }
            })
            const requestedIds = new Set(params.queuedTurnIds)
            state.task = {
                ...current,
                queuedTurns: [...turns, ...(current.queuedTurns ?? []).filter((turn) => !requestedIds.has(turn.id))],
                updatedAt: now,
            }
            return { taskId: params.taskId, reordered: true, turns }
        },
        cancelQueuedTurn: async (params) => {
            const current = requireStateTask(state, params.taskId)
            state.task = {
                ...current,
                queuedTurns: (current.queuedTurns ?? []).map((turn) =>
                    turn.id === params.queuedTurnId ? { ...turn, status: "cancelled", updatedAt: now } : turn
                ),
                updatedAt: now,
            }
            return {
                taskId: params.taskId,
                queuedTurnId: params.queuedTurnId,
                cancelled: true,
            }
        },
        deleteTask: async (params) => {
            requireStateTask(state, params.taskId)
            state.task = null
            state.taskUsage = undefined
            return { repoId: params.repoId, taskId: params.taskId, deleted: true }
        },
        importLegacyResources: async (params) => {
            state.legacyImportRequests = [...(state.legacyImportRequests ?? []), structuredClone(params)]
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
                snapshots: null,
                sessions: {
                    scannedTasks: 1,
                    referencedSessions: 1,
                    importedSessions: 1,
                    alreadyImportedSessions: 0,
                    missingSessions: [],
                    conflictedSessions: [],
                    failedSessions: [],
                },
                skipped: [{ kind: "snapshots", code: "source_missing" }],
            }
        },
        writeTaskImage: async (params) => {
            const writtenImages = state.writtenImages ?? new Map<string, { data: string; ext: string; mediaType: string }>()
            state.writtenImages = writtenImages
            writtenImages.set(`${params.imageId}.${params.ext}`, {
                data: params.data,
                ext: params.ext,
                mediaType: params.mediaType,
            })
            return {
                imageId: params.imageId,
                ext: params.ext,
                mediaType: params.mediaType,
                size: 3,
                sha256: "runtime-code-store-image-sha256",
            }
        },
        readStagedTaskImage: async (params) => {
            const key = `${params.imageId}.${params.ext}`
            const image = state.writtenImages?.get(key)
            return {
                imageId: params.imageId,
                ext: params.ext,
                mediaType: image?.mediaType,
                data: image?.data ?? null,
            }
        },
        setupTaskEnvironment: async (params) => {
            const current = requireStateTask(state, params.taskId)
            state.task = {
                ...current,
                deviceEnvironments: [...current.deviceEnvironments.filter((env) => env.id !== params.deviceEnvironment.id), params.deviceEnvironment],
                updatedAt: now,
            }
        },
        createActionEvent: unsupportedMutation("createActionEvent"),
        appendActionStreamEvent: unsupportedMutation("appendActionStreamEvent"),
        completeActionEvent: unsupportedMutation("completeActionEvent"),
        errorActionEvent: unsupportedMutation("errorActionEvent"),
        stoppedActionEvent: unsupportedMutation("stoppedActionEvent"),
        reconcileActionEventRuntime: async (params) => ({
            taskId: params.taskId,
            changed: false,
        }),
        updateActionExecution: unsupportedMutation("updateActionExecution"),
        addHyperPlanSubExecution: unsupportedMutation("addHyperPlanSubExecution"),
        appendHyperPlanSubExecutionStreamEvent: unsupportedMutation("appendHyperPlanSubExecutionStreamEvent"),
        updateHyperPlanSubExecution: unsupportedMutation("updateHyperPlanSubExecution"),
        setHyperPlanReconcileLabels: unsupportedMutation("setHyperPlanReconcileLabels"),
        createSnapshotEvent: unsupportedMutation("createSnapshotEvent"),
        createComment: async (params) => {
            const current = requireStateTask(state, params.taskId)
            const commentId = params.commentId ?? "comment-created"
            const createdAt = params.createdAt ?? now
            state.task = {
                ...current,
                comments: [
                    ...current.comments,
                    {
                        id: commentId,
                        content: params.content,
                        source: params.source,
                        selectedText: params.selectedText,
                        author: params.author,
                        createdAt,
                    },
                ],
                updatedAt: createdAt,
            }
            return { commentId, createdAt }
        },
        editComment: async (params) => {
            const current = requireStateTask(state, params.taskId)
            state.task = {
                ...current,
                comments: current.comments.map((comment) => {
                    if (typeof comment !== "object" || comment === null || !("id" in comment) || comment.id !== params.commentId) return comment
                    return {
                        ...comment,
                        content: params.content,
                        updatedAt: params.updatedAt ?? now,
                    }
                }),
                updatedAt: params.updatedAt ?? now,
            }
        },
        deleteComment: async (params) => {
            const current = requireStateTask(state, params.taskId)
            state.task = {
                ...current,
                comments: current.comments.filter((comment) => {
                    if (typeof comment !== "object" || comment === null || !("id" in comment)) return true
                    return comment.id !== params.commentId
                }),
                updatedAt: params.updatedAt ?? now,
            }
        },
        updateTaskMetadata: async (params) => {
            const current = requireStateTask(state, params.taskId)
            state.taskMetadataUpdateRequests?.push(structuredClone(params))
            state.task = {
                ...current,
                title: params.title ?? current.title,
                closed: params.closed ?? current.closed,
                lastViewedAt: params.lastViewedAt ?? current.lastViewedAt,
                lastEventAt: params.lastEventAt ?? current.lastEventAt,
                cancelledPlanEventId: params.cancelledPlanEventId ?? current.cancelledPlanEventId,
                enabledMcpServerIds: params.enabledMcpServerIds ?? current.enabledMcpServerIds,
                sessionIds: params.sessionIds ? { ...(current.sessionIds ?? {}), ...params.sessionIds } : current.sessionIds,
                queuedTurns: params.queuedTurns ?? current.queuedTurns,
                updatedAt: params.updatedAt ?? now,
            }
            state.taskUsage = params.usage ?? state.taskUsage
        },
        backfillTaskUsage: async (params) => {
            state.usageBackfillRequests = [...(state.usageBackfillRequests ?? []), { repoId: params.repoId, taskIds: params.taskIds, force: params.force }]
            const requestedTaskIds = params.taskIds ?? (state.task ? [state.task.id] : [])
            const tasks = requestedTaskIds.map((taskId) => {
                const current = requireStateTask(state, taskId)
                const usage: OpenADETaskPreviewUsage = {
                    usageVersion: 2,
                    inputTokens: 34,
                    outputTokens: 21,
                    totalCostUsd: 0.002,
                    eventCount: current.events.length,
                    costByModel: { "gpt-bulk": 0.002 },
                    durationMs: 233,
                }
                state.taskUsage = usage
                return { repoId: params.repoId ?? current.repoId, taskId, usage }
            })
            return { updatedTasks: tasks.length, skippedTasks: 0, tasks }
        },
        recalculateTaskUsage: async (params) => {
            const current = requireStateTask(state, params.taskId)
            state.usageRecalculateRequests = [...(state.usageRecalculateRequests ?? []), { repoId: params.repoId, taskId: params.taskId }]
            const usage: OpenADETaskPreviewUsage = {
                usageVersion: 2,
                inputTokens: 21,
                outputTokens: 13,
                totalCostUsd: 0.001,
                eventCount: current.events.length,
                costByModel: { "gpt-test": 0.001 },
                durationMs: 144,
            }
            state.taskUsage = usage
            return { usage }
        },
        scopedHost: {
            listProjectFiles: async (params) => {
                requireStateProject(state, params.repoId)
                return {
                    repoId: params.repoId,
                    path: params.path ?? "",
                    entries: [
                        { path: "src", name: "src", type: "directory" },
                        {
                            path: runtimeSearchFixture.path,
                            name: "runtime-search.ts",
                            type: "file",
                            size: runtimeSearchFixture.content.length,
                        },
                    ],
                    truncated: false,
                }
            },
            readProjectFile: async (params) => {
                requireStateProject(state, params.repoId)
                const configuredFile = state.projectFiles?.get(params.path)
                const content =
                    configuredFile?.content ??
                    (params.path === runtimeSearchFixture.path
                        ? runtimeSearchFixture.content
                        : params.path === "openade.toml"
                          ? [
                                "[[process]]",
                                'name = "Runtime Process"',
                                'type = "task"',
                                'command = "printf runtime-process"',
                                "",
                                "[[cron]]",
                                'name = "Runtime Cron"',
                                'schedule = "0 9 * * *"',
                                'type = "do"',
                                'prompt = "Run runtime cron"',
                                "reuse_task = false",
                                "",
                            ].join("\n")
                          : null)
                if (content === null) throw new Error(`Project file ${params.path} not found`)
                const tooLarge = content.length > (params.maxBytes ?? Number.POSITIVE_INFINITY)
                return {
                    repoId: params.repoId,
                    path: params.path,
                    encoding: params.encoding ?? "utf8",
                    size: content.length,
                    tooLarge,
                    content: tooLarge ? null : content,
                }
            },
            writeProjectFile: async (params) => {
                requireStateProject(state, params.repoId)
                const encoding = params.encoding ?? "utf8"
                state.projectFiles ??= new Map()
                state.projectFileWrites ??= []
                state.projectFiles.set(params.path, {
                    content: params.content,
                    encoding,
                })
                state.projectFileWrites.push({ ...params, encoding })
                return {
                    repoId: params.repoId,
                    taskId: params.taskId,
                    path: params.path,
                    size: params.content.length,
                }
            },
            fuzzySearchProjectFiles: async (params) => {
                requireStateProject(state, params.repoId)
                return {
                    repoId: params.repoId,
                    taskId: params.taskId,
                    results: [runtimeSearchFixture.path],
                    truncated: false,
                    source: "filesystem",
                }
            },
            searchProject: async (params) => {
                requireStateProject(state, params.repoId)
                const line = runtimeSearchFixture.content.trimEnd()
                const haystack = params.caseSensitive ? line : line.toLowerCase()
                const needle = params.caseSensitive ? params.query : params.query.toLowerCase()
                const matchStart = haystack.indexOf(needle)
                return {
                    repoId: params.repoId,
                    matches:
                        matchStart >= 0
                            ? [
                                  {
                                      path: runtimeSearchFixture.path,
                                      line: 1,
                                      content: line,
                                      matchStart,
                                      matchEnd: matchStart + params.query.length,
                                  },
                              ]
                            : [],
                    truncated: false,
                }
            },
            readProjectGitInfo: async (params) => {
                state.projectGitInfoReadCount = (state.projectGitInfoReadCount ?? 0) + 1
                return {
                    repoId: params.repoId,
                    isGitRepo: true,
                    repoRoot: requireStateProject(state, params.repoId).path,
                    relativePath: "",
                    mainBranch: "main",
                    hasGhCli: false,
                }
            },
            readProjectGitBranches: async (params) => {
                state.projectGitBranchesReadCount = (state.projectGitBranchesReadCount ?? 0) + 1
                return {
                    repoId: params.repoId,
                    defaultBranch: "main",
                    branches: [{ name: "main", isDefault: true, isRemote: false }],
                }
            },
            readProjectGitSummary: async (params) => {
                state.projectGitSummaryReadCount = (state.projectGitSummaryReadCount ?? 0) + 1
                return {
                    repoId: params.repoId,
                    branch: "main",
                    headCommit: "abc123",
                    ahead: 0,
                    hasChanges: false,
                    staged: {
                        files: [],
                        stats: { filesChanged: 0, insertions: 0, deletions: 0 },
                    },
                    unstaged: {
                        files: [],
                        stats: { filesChanged: 0, insertions: 0, deletions: 0 },
                    },
                    untracked: [],
                }
            },
            listProjectProcesses: async (params) => {
                state.projectProcessListCount = (state.projectProcessListCount ?? 0) + 1
                requireStateProject(state, params.repoId)
                return {
                    repoId: params.repoId,
                    taskId: params.taskId,
                    searchRoot: "/tmp/runtime-repo",
                    repoRoot: "/tmp/runtime-repo",
                    isWorktree: false,
                    configs: [
                        {
                            relativePath: "openade.toml",
                            processes: [
                                {
                                    id: "openade.toml::Runtime Process",
                                    name: "Runtime Process",
                                    command: "printf runtime-process",
                                    type: "task",
                                },
                            ],
                            crons: [
                                {
                                    id: "openade.toml::Runtime Cron",
                                    name: "Runtime Cron",
                                    schedule: "0 9 * * *",
                                    type: "do",
                                    prompt: "Run runtime cron",
                                    reuseTask: false,
                                },
                            ],
                        },
                    ],
                    processes: [
                        {
                            id: "openade.toml::Runtime Process",
                            name: "Runtime Process",
                            command: "printf runtime-process",
                            type: "task",
                            configPath: "openade.toml",
                            cwd: "/tmp/runtime-repo",
                        },
                    ],
                    errors: [],
                    instances:
                        state.projectProcess?.running === true
                            ? [
                                  {
                                      processId: state.projectProcess.processId,
                                      definitionId: "openade.toml::Runtime Process",
                                      repoId: params.repoId,
                                      taskId: params.taskId,
                                      cwd: "/tmp/runtime-repo",
                                      completed: false,
                                      exitCode: null,
                                      signal: null,
                                  },
                              ]
                            : [],
                }
            },
            startProjectProcess: async (params) => {
                requireStateProject(state, params.repoId)
                state.projectProcess = {
                    processId: "process-runtime-test",
                    running: true,
                    output: ["runtime process output\n"],
                    stopped: false,
                }
                return {
                    repoId: params.repoId,
                    taskId: params.taskId,
                    definitionId: params.definitionId,
                    processId: state.projectProcess.processId,
                }
            },
            reconnectProjectProcess: async (params) => {
                requireStateProject(state, params.repoId)
                if (!state.projectProcess || params.processId !== state.projectProcess.processId) {
                    return {
                        repoId: params.repoId,
                        taskId: params.taskId,
                        processId: params.processId,
                        found: false,
                        output: [],
                    }
                }
                return {
                    repoId: params.repoId,
                    taskId: params.taskId,
                    processId: params.processId,
                    found: true,
                    completed: !state.projectProcess.running,
                    exitCode: state.projectProcess.running ? null : 0,
                    signal: null,
                    outputCount: state.projectProcess.output.length,
                    output: state.projectProcess.output.map((data, index) => ({
                        type: "stdout",
                        data,
                        timestamp: index + 1,
                    })),
                }
            },
            stopProjectProcess: async (params) => {
                requireStateProject(state, params.repoId)
                if (state.projectProcess && params.processId === state.projectProcess.processId) {
                    state.projectProcess.running = false
                    state.projectProcess.stopped = true
                }
                return {
                    repoId: params.repoId,
                    taskId: params.taskId,
                    processId: params.processId,
                    ok: true,
                }
            },
            startTaskTerminal: async (params) => {
                requireStateTask(state, params.taskId)
                state.terminal = {
                    terminalId: "openade-task-terminal-runtime-test",
                    output: [],
                    writes: [],
                    exited: false,
                }
                return {
                    repoId: params.repoId,
                    taskId: params.taskId,
                    terminalId: state.terminal.terminalId,
                    runtimeId: `pty:${state.terminal.terminalId}`,
                    ok: true,
                }
            },
            reconnectTaskTerminal: async (params) => {
                requireStateTask(state, params.taskId)
                const terminalId = params.terminalId ?? state.terminal?.terminalId ?? "openade-task-terminal-runtime-test"
                if (!state.terminal || terminalId !== state.terminal.terminalId) {
                    return {
                        repoId: params.repoId,
                        taskId: params.taskId,
                        terminalId,
                        found: false,
                        output: [],
                    }
                }
                return {
                    repoId: params.repoId,
                    taskId: params.taskId,
                    terminalId,
                    found: true,
                    exited: state.terminal.exited,
                    outputCount: state.terminal.output.length,
                    output: state.terminal.output.map((data, index) => ({
                        data,
                        timestamp: index + 1,
                    })),
                }
            },
            writeTaskTerminal: async (params) => {
                requireStateTask(state, params.taskId)
                if (!state.terminal || params.terminalId !== state.terminal.terminalId)
                    return {
                        repoId: params.repoId,
                        taskId: params.taskId,
                        terminalId: params.terminalId,
                        ok: false,
                    }
                state.terminal.writes.push(params.data)
                state.terminal.output.push(`runtime terminal wrote: ${params.data}`)
                return {
                    repoId: params.repoId,
                    taskId: params.taskId,
                    terminalId: params.terminalId,
                    ok: true,
                }
            },
            resizeTaskTerminal: async (params) => {
                requireStateTask(state, params.taskId)
                if (!state.terminal || params.terminalId !== state.terminal.terminalId)
                    return {
                        repoId: params.repoId,
                        taskId: params.taskId,
                        terminalId: params.terminalId,
                        ok: false,
                    }
                state.terminal.resizedTo = { cols: params.cols, rows: params.rows }
                return {
                    repoId: params.repoId,
                    taskId: params.taskId,
                    terminalId: params.terminalId,
                    ok: true,
                }
            },
            stopTaskTerminal: async (params) => {
                requireStateTask(state, params.taskId)
                if (!state.terminal || params.terminalId !== state.terminal.terminalId)
                    return {
                        repoId: params.repoId,
                        taskId: params.taskId,
                        terminalId: params.terminalId,
                        ok: false,
                    }
                state.terminal.exited = true
                return {
                    repoId: params.repoId,
                    taskId: params.taskId,
                    terminalId: params.terminalId,
                    ok: true,
                }
            },
            readTaskImage: async (params) => {
                requireStateTask(state, params.taskId)
                const key = `${params.imageId}.${params.ext}`
                const image = state.writtenImages?.get(key)
                return {
                    repoId: params.repoId,
                    taskId: params.taskId,
                    imageId: params.imageId,
                    ext: params.ext,
                    mediaType: image?.mediaType,
                    data: image?.data ?? null,
                }
            },
            readTaskGitSummary: async (params) => {
                state.taskGitSummaryReadCount = (state.taskGitSummaryReadCount ?? 0) + 1
                return {
                    repoId: params.repoId,
                    taskId: params.taskId,
                    branch: "main",
                    headCommit: "abc123",
                    ahead: 0,
                    hasChanges: true,
                    staged: {
                        files: [],
                        stats: { filesChanged: 0, insertions: 0, deletions: 0 },
                    },
                    unstaged: {
                        files: [{ path: "README.md", status: "modified" }],
                        stats: { filesChanged: 1, insertions: 1, deletions: 1 },
                    },
                    untracked: [],
                }
            },
            readTaskGitScopes: async (params) => ({
                repoId: params.repoId,
                taskId: params.taskId,
                defaultBranch: "main",
                scopes: [
                    {
                        id: "branch:HEAD",
                        type: "branch",
                        name: "HEAD",
                        ref: "HEAD",
                        isDefault: false,
                        isRemote: false,
                    },
                    {
                        id: "branch:main",
                        type: "branch",
                        name: "main",
                        ref: "main",
                        isDefault: true,
                        isRemote: false,
                    },
                    {
                        id: "worktree:task-1",
                        type: "worktree",
                        worktreeId: "task-1",
                        branch: "openade/task-1",
                        head: "abc123456789",
                        label: "task-1",
                    },
                ],
            }),
            readTaskResourceInventory: async (params) =>
                buildOpenADETaskResourceInventory({
                    task: params.task,
                    isRunning: params.isRunning,
                    branchMerged: state.resourceInventoryBranchMerged ?? null,
                }),
            generateTaskTitle: async (params) => ({
                repoId: params.repoId,
                taskId: params.taskId,
                title: "Runtime generated title",
            }),
            prepareTaskEnvironment: async (params) => ({
                repoId: params.repoId,
                taskId: params.taskId,
                deviceEnvironment: {
                    id: "runtime-device",
                    deviceId: "runtime-device",
                    setupComplete: true,
                    createdAt: now,
                    lastUsedAt: now,
                },
                setupEvent: {
                    eventId: "setup-runtime-device",
                    worktreeId: "runtime-worktree",
                    deviceId: "runtime-device",
                    workingDir: "/tmp/runtime-repo",
                    createdAt: now,
                    completedAt: now,
                    setupOutput: "Runtime environment ready",
                },
                cwd: "/tmp/runtime-repo",
                rootPath: "/tmp/runtime-repo",
            }),
            readTaskChanges: unsupportedMutation("readTaskChanges"),
            readTaskDiff: unsupportedMutation("readTaskDiff"),
            readTaskFilePair: unsupportedMutation("readTaskFilePair"),
            readTaskGitLog: async (params) => {
                const skip = params.skip ?? 0
                const limit = params.limit ?? gitLogCommits.length
                return {
                    repoId: params.repoId,
                    taskId: params.taskId,
                    commits: gitLogCommits.slice(skip, skip + limit),
                    hasMore: gitLogCommits.length > skip + limit,
                }
            },
            readTaskGitCommitFiles: async (params) => ({
                repoId: params.repoId,
                taskId: params.taskId,
                commit: params.commit,
                files: [{ path: "README.md", status: "modified" }],
            }),
            readTaskGitFileAtTreeish: async (params) => ({
                repoId: params.repoId,
                taskId: params.taskId,
                treeish: params.treeish,
                filePath: params.filePath,
                content: params.treeish.endsWith("^") ? "before runtime commit\n" : "after runtime commit\n",
                exists: true,
            }),
            readTaskGitCommitFilePatch: async (params) => ({
                repoId: params.repoId,
                taskId: params.taskId,
                commit: params.commit,
                filePath: params.filePath,
                oldPath: params.oldPath,
                patch: "diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-before runtime commit\n+after runtime commit\n",
                truncated: false,
                heavy: false,
                stats: { insertions: 1, deletions: 1, changedLines: 2, hunkCount: 1 },
            }),
            commitTaskGit: unsupportedMutation("commitTaskGit"),
            readTaskSnapshotPatch: async (params) => {
                const { patchFileId, patch } = snapshotPatchForEvent(params.snapshotEvent)
                return {
                    repoId: params.repoId,
                    taskId: params.taskId,
                    eventId: params.eventId,
                    patchFileId,
                    patch,
                }
            },
            readTaskSnapshotIndex: async (params) => {
                const { patchFileId, patch } = snapshotPatchForEvent(params.snapshotEvent)
                return {
                    repoId: params.repoId,
                    taskId: params.taskId,
                    eventId: params.eventId,
                    patchFileId,
                    index: snapshotIndexForPatch(patch),
                }
            },
            readTaskSnapshotPatchSlice: async (params) => {
                const { patchFileId, patch } = snapshotPatchForEvent(params.snapshotEvent)
                return {
                    repoId: params.repoId,
                    taskId: params.taskId,
                    eventId: params.eventId,
                    patchFileId,
                    patch: patch === null ? null : patch.slice(params.start, params.end),
                }
            },
        },
    }
}

function createLocalRuntimeClient(server: RuntimeServer, permissions?: string[]): RuntimeLocalClient {
    const listeners = new Set<(message: RuntimeMessage) => void>()
    let dispose: (() => void) | null = null
    const connection: RuntimeConnection = {
        id: "desktop-product-store-test",
        ...(permissions ? { permissions } : {}),
        send(message) {
            for (const listener of listeners) listener(message)
        },
    }
    const transport: RuntimeLocalTransport = {
        connect() {
            dispose = server.connect(connection)
        },
        disconnect() {
            dispose?.()
            dispose = null
        },
        request(request: RuntimeRequest) {
            return server.handleRequest(request, connection, {
                requireInitialized: true,
            })
        },
        onMessage(listener) {
            listeners.add(listener)
            return () => listeners.delete(listener)
        },
    }
    return new RuntimeLocalClient(transport, {
        clientName: "desktop-product-store-test",
        clientPlatform: "desktop",
    })
}

function createRuntimeBackedClient(): {
    client: OpenADEClient
    runtime: RuntimeLocalClient
    server: RuntimeServer
    state: RuntimeBridgeState
}
function createRuntimeBackedClient(state: RuntimeBridgeState): {
    client: OpenADEClient
    runtime: RuntimeLocalClient
    server: RuntimeServer
    state: RuntimeBridgeState
}
function createRuntimeBackedClient(
    state: RuntimeBridgeState,
    permissions: string[]
): {
    client: OpenADEClient
    runtime: RuntimeLocalClient
    server: RuntimeServer
    state: RuntimeBridgeState
}
function createRuntimeBackedClient(
    state: RuntimeBridgeState = createBridgeState(),
    permissions?: string[]
): {
    client: OpenADEClient
    runtime: RuntimeLocalClient
    server: RuntimeServer
    state: RuntimeBridgeState
} {
    const server = new RuntimeServer({
        serverName: "desktop-product-store-runtime",
        protocolVersion: 1,
    })
    server.registerModule(createOpenADEModule(createReadOnlyAdapters(state)))
    const runtime = createLocalRuntimeClient(server, permissions)
    return {
        server,
        state,
        runtime,
        client: new OpenADEClient({
            runtime,
            clientName: "desktop-product-store-test",
            clientPlatform: "desktop",
        }),
    }
}

function allOpenADEMethodPermissionsExcept(excludedMethods: readonly string[]): string[] {
    const excluded = new Set(excludedMethods)
    return ["initialize", "runtime/list", ...Object.values(OPENADE_METHOD).filter((method) => !excluded.has(method))]
}

function runtimeRecord(status: RuntimeRecord["status"], updatedAt: string, ownerId = "task-1", runtimeId = "runtime-1"): RuntimeRecord {
    return {
        runtimeId,
        kind: "agent",
        status,
        scope: { ownerType: "openade-task", ownerId },
        startedAt: now,
        updatedAt,
        lastActivityAt: updatedAt,
    }
}

function runtimeRequestFromUnknown(value: unknown): RuntimeRequest {
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Invalid runtime request")
    const record = value as Record<string, unknown>
    const id = record.id
    if ((typeof id !== "string" && typeof id !== "number") || typeof record.method !== "string") throw new Error("Invalid runtime request")
    return { id, method: record.method, params: record.params }
}

async function waitForRuntimeBridge(assertion: () => void, timeout = 1000): Promise<void> {
    await vi.waitFor(assertion, { timeout, interval: 10 })
}

async function waitForRuntimeNotificationsToSettle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 250))
}

async function waitForRuntimeDeferredTaskRefresh(assertion: () => void): Promise<void> {
    await waitForRuntimeBridge(assertion, 4000)
}

function createInMemoryLegacyStoreConnectors(
    onRepoConnect?: () => void,
    onMcpConnect?: () => void,
    onPersonalSettingsConnect?: () => void
): CodeStoreLegacyStoreConnectors {
    return {
        async connectRepoStore() {
            onRepoConnect?.()
            const store = createRepoStore(new Y.Doc())
            return {
                store,
                sync: async () => undefined,
                refresh: async () => true,
                disconnect: () => undefined,
            }
        },
        async connectMcpServerStore() {
            onMcpConnect?.()
            const store = createMcpServerStore(new Y.Doc())
            return {
                store,
                sync: async () => undefined,
                disconnect: () => undefined,
            }
        },
        async connectPersonalSettingsStore() {
            onPersonalSettingsConnect?.()
            const store = createPersonalSettingsStore(new Y.Doc())
            return {
                store,
                sync: async () => undefined,
                disconnect: () => undefined,
            }
        },
    }
}

function installCoreRolloutState(overrides: Partial<OpenADECoreRolloutState> = {}): () => void {
    const previous = window.openadeAPI
    Object.defineProperty(window, "openadeAPI", {
        configurable: true,
        writable: true,
        value: {
            ...previous,
            app: {
                ...previous?.app,
                smokeTest: false,
            },
            core: {
                ...previous?.core,
                runtimeEndpoint: {
                    url: "ws://127.0.0.1:37376/v1/runtime",
                    token: "trusted-test-token",
                },
                rolloutState: {
                    status: "connected",
                    source: "managed",
                    reason: "managed-core",
                    automatic: true,
                    legacyYjsDocumentsPresent: false,
                    legacyYjsMigrationAccepted: false,
                    ...overrides,
                },
            },
        },
    })

    return () => {
        window.openadeAPI = previous
    }
}

function installCleanCoreRolloutState(): () => void {
    return installCoreRolloutState()
}

function installAcceptedLegacyImportCoreRolloutState(): () => void {
    return installCoreRolloutState({
        reason: "legacy-yjs-migration-accepted",
        legacyYjsDocumentsPresent: true,
        legacyYjsMigrationAccepted: true,
    })
}

function installCoreMigrationRuntimeEndpoint(endpoint: OpenADECoreRuntimeEndpoint): () => void {
    const previous = window.openadeAPI
    Object.defineProperty(window, "openadeAPI", {
        configurable: true,
        writable: true,
        value: {
            ...previous,
            core: {
                ...previous?.core,
                migrationRuntimeEndpoint: endpoint,
                rolloutState: {
                    status: "legacy-ipc",
                    source: "legacy-ipc",
                    reason: "legacy-yjs-documents",
                    automatic: true,
                    legacyYjsDocumentsPresent: true,
                    legacyYjsMigrationAccepted: false,
                },
            },
        },
    })

    return () => {
        window.openadeAPI = previous
    }
}

describe("CodeStore runtime product store bridge", () => {
    it("does not treat a connected Core rollout without a runtime endpoint as Core-owned", () => {
        const previousOpenADEAPI = window.openadeAPI
        Object.defineProperty(window, "openadeAPI", {
            configurable: true,
            writable: true,
            value: {
                ...previousOpenADEAPI,
                core: {
                    rolloutState: {
                        status: "connected",
                        source: "managed",
                        reason: "managed-core",
                        automatic: true,
                        legacyYjsDocumentsPresent: false,
                        legacyYjsMigrationAccepted: false,
                    },
                },
            },
        })
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
        })

        try {
            expect(codeStore.usesCoreOwnedProductRuntime()).toBe(false)
            expect(codeStore.shouldUseCoreOwnedCronScheduler()).toBe(false)
        } finally {
            window.openadeAPI = previousOpenADEAPI
            codeStore.disconnectAllStores()
        }
    })

    it("ignores malformed Core endpoints when selecting the default runtime notification source", () => {
        const previousOpenADEAPI = window.openadeAPI
        Object.defineProperty(window, "openadeAPI", {
            configurable: true,
            writable: true,
            value: {
                core: {
                    runtimeEndpoint: {
                        url: "https://127.0.0.1:37376/v1/runtime",
                        token: "trusted-token",
                    },
                },
            },
        })
        const subscribeSpy = vi.spyOn(localRuntimeClient, "subscribe")
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
        })

        try {
            const source = (codeStore as unknown as { runtimeNotificationSource(): unknown }).runtimeNotificationSource()

            expect(source).toBeNull()
            expect(subscribeSpy).not.toHaveBeenCalled()
        } finally {
            window.openadeAPI = previousOpenADEAPI
            codeStore.disconnectAllStores()
            subscribeSpy.mockRestore()
        }
    })

    it("initializes runtime-backed product sessions without opening legacy Yjs stores or renderer cron scheduling", async () => {
        const { client, runtime, state } = createRuntimeBackedClient({
            ...createBridgeState(),
            snapshotReadCount: 0,
            mcpServerReadCount: 0,
            personalSettings: {
                envVars: {},
                theme: "code-theme-clean",
                renderMarkdownMessages: false,
            },
        })
        let repoConnectCount = 0
        let mcpConnectCount = 0
        let personalSettingsConnectCount = 0
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
            legacyStoreConnectors: createInMemoryLegacyStoreConnectors(
                () => {
                    repoConnectCount += 1
                },
                () => {
                    mcpConnectCount += 1
                },
                () => {
                    personalSettingsConnectCount += 1
                }
            ),
        })

        try {
            await codeStore.initializeStores()

            expect(codeStore.shouldUseRuntimeProductAPI()).toBe(true)
            expect(codeStore.usesCoreOwnedProductRuntime()).toBe(false)
            expect(repoConnectCount).toBe(0)
            expect(mcpConnectCount).toBe(0)
            expect(personalSettingsConnectCount).toBe(0)
            expect(codeStore.repoStore).toBeNull()
            expect(codeStore.personalSettingsStore?.settings.current.theme).toBe("code-theme-clean")
            expect(codeStore.personalSettingsStore?.settings.current.renderMarkdownMessages).toBe(false)
            expect(state.personalSettingsReadCount ?? 0).toBe(1)
            expect(state.mcpServerReadCount ?? 0).toBe(0)
            expect(codeStore.crons.started).toBe(false)
            expect(state.projectProcessListCount ?? 0).toBe(0)

            await codeStore.mcpServers.initializeProductSettingsProjection()
            expect(state.mcpServerReadCount ?? 0).toBe(1)
        } finally {
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("does not start renderer cron scheduling when runtime product initialization fails", async () => {
        const { client, runtime, state } = createRuntimeBackedClient(
            {
                ...createBridgeState(),
                snapshotReadCount: 0,
                projectProcessListCount: 0,
                personalSettingsReadCount: 0,
            },
            allOpenADEMethodPermissionsExcept([OPENADE_METHOD.projectList, OPENADE_METHOD.snapshotRead])
        )
        let repoConnectCount = 0
        let mcpConnectCount = 0
        let personalSettingsConnectCount = 0
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
            legacyStoreConnectors: createInMemoryLegacyStoreConnectors(
                () => {
                    repoConnectCount += 1
                },
                () => {
                    mcpConnectCount += 1
                },
                () => {
                    personalSettingsConnectCount += 1
                }
            ),
        })
        const cronStart = vi.spyOn(codeStore.crons, "startAll")
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
        const legacyGitInfoRead = vi.spyOn(localOpenADEClient, "readProjectGitInfo").mockRejectedValue(new Error("legacy git info should not be used"))

        try {
            await codeStore.initializeStores()

            expect(codeStore.shouldUseRuntimeProductAPI()).toBe(false)
            expect(codeStore.runtimeProductStoreStatus).toBe("error")
            expect(repoConnectCount).toBe(0)
            expect(mcpConnectCount).toBe(0)
            expect(personalSettingsConnectCount).toBe(0)
            expect(codeStore.repoStore).toBeNull()
            expect(codeStore.personalSettingsStore?.settings.current.theme).toBe("system")
            expect(state.personalSettingsReadCount ?? 0).toBe(1)
            expect(codeStore.canUseProductMethod(OPENADE_METHOD.projectGitInfoRead)).toBe(false)
            expect(codeStore.canUseProductMethod(OPENADE_METHOD.taskMetadataUpdate)).toBe(false)
            await expect(codeStore.readProductProjectGitInfo({ repoId: "repo-1" })).rejects.toThrow(
                `Runtime product store is not initialized for ${OPENADE_METHOD.projectGitInfoRead}`
            )
            expect(legacyGitInfoRead).not.toHaveBeenCalled()
            expect(cronStart).not.toHaveBeenCalled()
            expect(state.projectProcessListCount ?? 0).toBe(0)
        } finally {
            legacyGitInfoRead.mockRestore()
            warn.mockRestore()
            cronStart.mockRestore()
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("loads and refreshes runtime task routes before broad product projection is initialized", async () => {
        const { client, runtime, server, state } = createRuntimeBackedClient({
            ...createBridgeState(),
            projectReadCount: 0,
            snapshotReadCount: 0,
            taskReadRequests: [],
        })
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })

        try {
            expect(codeStore.shouldUseRuntimeProductAPI()).toBe(false)
            expect(codeStore.shouldUseRuntimeProductTaskRoute()).toBe(true)

            await expect(codeStore.loadRuntimeProductTaskForRoute("repo-1", "task-1")).resolves.toMatchObject({ id: "task-1", repoId: "repo-1" })

            expect(state.taskReadRequests).toEqual([{ repoId: "repo-1", taskId: "task-1", hydrateSessionEvents: false, eventLimit: 12 }])
            expect(state.projectReadCount ?? 0).toBe(0)
            expect(state.snapshotReadCount ?? 0).toBe(0)
            expect(state.projectProcessListCount ?? 0).toBe(0)
            expect(codeStore.shouldUseRuntimeProductAPI()).toBe(false)
            expect(codeStore.hasProductTaskModelSource("task-1")).toBe(true)

            const legacyTaskRefresh = vi.spyOn(codeStore, "refreshTaskStoreFromStorage")
            const legacyRepoRefresh = vi.spyOn(codeStore, "refreshRepoStoreFromStorage")
            state.task = {
                ...requireStateTask(state, "task-1"),
                title: "Route notification refresh",
                updatedAt: "2026-05-31T00:03:00.000Z",
            }
            state.taskReadRequests = []
            server.notify("openade/task/updated", {
                repoId: "repo-1",
                taskId: "task-1",
            })

            await waitForRuntimeDeferredTaskRefresh(() => {
                expect(codeStore.tasks.getTask("task-1")?.title).toBe("Route notification refresh")
            })

            expect(state.taskReadRequests).toEqual([{ repoId: "repo-1", taskId: "task-1", hydrateSessionEvents: false, eventLimit: 12 }])
            expect(state.projectReadCount ?? 0).toBe(0)
            expect(state.snapshotReadCount ?? 0).toBe(0)
            expect(state.projectProcessListCount ?? 0).toBe(0)
            expect(legacyTaskRefresh).not.toHaveBeenCalled()
            expect(legacyRepoRefresh).not.toHaveBeenCalled()
        } finally {
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("initializes direct Core task-route shell capabilities without broad project projection", async () => {
        const restoreOpenADEAPI = installCleanCoreRolloutState()
        const { client, runtime, state } = createRuntimeBackedClient({
            ...createBridgeState(),
            personalSettingsReadCount: 0,
            projectReadCount: 0,
            snapshotReadCount: 0,
            taskReadRequests: [],
            personalSettings: {
                envVars: {},
                theme: "code-theme-clean",
                renderMarkdownMessages: true,
                newTaskHarnessId: "claude-code",
                newTaskModelId: "opus",
            },
        })
        let repoConnectCount = 0
        let mcpConnectCount = 0
        let personalSettingsConnectCount = 0
        let runtimeSubscribeCount = 0
        let runtimeUnsubscribeCount = 0
        const runtimeNotificationSource = {
            subscribe(listener: (notification: RuntimeNotification) => void): () => void {
                runtimeSubscribeCount += 1
                const unsubscribe = runtime.subscribe(listener)
                return () => {
                    runtimeUnsubscribeCount += 1
                    unsubscribe()
                }
            },
        }
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource,
            legacyStoreConnectors: createInMemoryLegacyStoreConnectors(
                () => {
                    repoConnectCount += 1
                },
                () => {
                    mcpConnectCount += 1
                },
                () => {
                    personalSettingsConnectCount += 1
                }
            ),
        })

        try {
            await expect(codeStore.loadRuntimeProductTaskForRoute("repo-1", "task-1")).resolves.toMatchObject({ id: "task-1" })
            expect(runtimeSubscribeCount).toBe(1)
            await codeStore.initializeRuntimeTaskRouteShell()
            expect(runtimeSubscribeCount).toBe(1)
            expect(runtimeUnsubscribeCount).toBe(0)
            await codeStore.initializeRuntimeTaskRouteShell()
            expect(runtimeSubscribeCount).toBe(1)
            expect(runtimeUnsubscribeCount).toBe(0)

            expect(state.taskReadRequests).toEqual([{ repoId: "repo-1", taskId: "task-1", hydrateSessionEvents: false, eventLimit: 12 }])
            expect(codeStore.canUseProductMethod(OPENADE_METHOD.taskRead)).toBe(true)
            expect(codeStore.canUseProductMethod(OPENADE_METHOD.turnStart)).toBe(true)
            expect(codeStore.canUseProductMethod(OPENADE_METHOD.taskMetadataUpdate)).toBe(true)
            expect(codeStore.canUseProductMethod(OPENADE_METHOD.queuedTurnCancel)).toBe(true)
            expect(codeStore.canUseProductMethod(OPENADE_METHOD.taskDelete)).toBe(true)
            expect(codeStore.canUseProductMethod(OPENADE_METHOD.taskGitSummaryRead)).toBe(true)
            expect(codeStore.canUseProductMethod(OPENADE_METHOD.taskTerminalStart)).toBe(true)
            expect(codeStore.canUseProductMethod(OPENADE_METHOD.projectFilesFuzzySearch)).toBe(true)
            expect(codeStore.canUseProductMethod(OPENADE_METHOD.projectProcessList)).toBe(true)
            expect(codeStore.canUseProductMethod(OPENADE_METHOD.projectSdkCapabilitiesRead)).toBe(false)
            expect(state.personalSettingsReadCount ?? 0).toBe(0)
            expect(personalSettingsConnectCount).toBe(0)
            expect(mcpConnectCount).toBe(0)
            expect(repoConnectCount).toBe(0)
            expect(state.mcpServerReadCount ?? 0).toBe(0)
            expect(state.projectReadCount ?? 0).toBe(0)
            expect(state.snapshotReadCount ?? 0).toBe(0)
            expect(state.projectProcessListCount ?? 0).toBe(0)
            expect(codeStore.personalSettingsStore).toBeNull()
            expect(codeStore.mcpServerStore).toBeNull()

            await codeStore.mcpServers.initializeProductSettingsProjection()
            expect(state.mcpServerReadCount ?? 0).toBe(1)
            expect(codeStore.mcpServerStore).not.toBeNull()

            await codeStore.initializeStores()

            expect(state.personalSettingsReadCount ?? 0).toBe(1)
            expect(state.mcpServerReadCount ?? 0).toBe(1)
            expect(state.projectReadCount ?? 0).toBe(1)
            expect(state.snapshotReadCount ?? 0).toBe(0)
            expect(codeStore.personalSettingsStore?.settings.current.theme).toBe("code-theme-clean")
            expect(codeStore.defaultHarnessId).toBe("claude-code")
            expect(codeStore.defaultModel).toBe("opus")
            expect(codeStore.mcpServerStore).not.toBeNull()
            expect(repoConnectCount).toBe(0)
            expect(mcpConnectCount).toBe(0)
            expect(personalSettingsConnectCount).toBe(0)
        } finally {
            codeStore.disconnectAllStores()
            await runtime.close()
            restoreOpenADEAPI()
        }
    })

    it("starts clean managed Core product reads without opening the legacy repo Yjs document", async () => {
        subprocessMocks.setGlobalEnv.mockClear()
        const restoreOpenADEAPI = installCleanCoreRolloutState()
        const { client, runtime, server, state } = createRuntimeBackedClient({
            ...createBridgeState(),
            snapshotReadCount: 0,
            projectReadCount: 0,
            mcpServerReadCount: 0,
            mcpServers: [
                {
                    id: "core-mcp-1",
                    name: "Core MCP",
                    transportType: "stdio",
                    enabled: true,
                    command: "node",
                    args: ["core-mcp.js"],
                    healthStatus: "unknown",
                    createdAt: now,
                    updatedAt: now,
                },
            ],
            personalSettings: {
                envVars: { OPENADE_TEST_ENV: "core" },
                theme: "code-theme-clean",
                renderMarkdownMessages: false,
                newTaskHarnessId: "codex",
                newTaskModelId: "gpt-5.3-codex",
            },
        })
        server.supervisor.register(runtimeRecord("running", "2026-05-31T00:01:00.000Z"))
        const runtimeListDeferred = createDeferred<RuntimeRecord[]>()
        let runtimeListResolved = false
        const runtimeListRequests: RuntimeListParams[] = []
        const listRuntimesSpy = vi.spyOn(client, "listRuntimes").mockImplementation(async (params = {}) => {
            runtimeListRequests.push(params)
            return runtimeListDeferred.promise
        })
        const legacyRuntimeRequests: RuntimeRequest[] = []
        const legacyRuntimeRequest = vi.fn(async (rawRequest: unknown): Promise<RuntimeResponse> => {
            const runtimeRequest = runtimeRequestFromUnknown(rawRequest)
            legacyRuntimeRequests.push(runtimeRequest)
            if (runtimeRequest.method === "runtime/list") throw new Error("legacy local runtime should not hydrate clean managed Core tasks")
            if (runtimeRequest.method === "initialize") {
                return {
                    id: runtimeRequest.id,
                    result: {
                        protocolVersion: 1,
                        serverName: "legacy-ipc-test-runtime",
                        capabilities: {
                            methods: ["runtime/list"],
                            notifications: [],
                            agentProviders: [],
                        },
                    },
                }
            }
            return { id: runtimeRequest.id, result: null }
        })
        Object.defineProperty(window, "openadeAPI", {
            configurable: true,
            writable: true,
            value: {
                ...window.openadeAPI,
                runtime: {
                    connect: vi.fn(),
                    disconnect: vi.fn(),
                    request: legacyRuntimeRequest,
                    onMessage: vi.fn(() => vi.fn()),
                },
            },
        })
        const trackSpy = vi.spyOn(analytics, "track").mockImplementation(() => undefined)
        let repoConnectCount = 0
        let mcpConnectCount = 0
        let personalSettingsConnectCount = 0
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
            legacyStoreConnectors: createInMemoryLegacyStoreConnectors(
                () => {
                    repoConnectCount += 1
                },
                () => {
                    mcpConnectCount += 1
                },
                () => {
                    personalSettingsConnectCount += 1
                }
            ),
        })

        try {
            await codeStore.initializeStores()

            expect(repoConnectCount).toBe(0)
            expect(mcpConnectCount).toBe(0)
            expect(personalSettingsConnectCount).toBe(0)
            expect(codeStore.repoStore).toBeNull()
            expect(codeStore.personalSettingsStore?.settings.current.theme).toBe("code-theme-clean")
            expect(codeStore.personalSettingsStore?.settings.current.renderMarkdownMessages).toBe(false)
            expect(codeStore.defaultHarnessId).toBe("codex")
            expect(codeStore.defaultModel).toBe("gpt-5.3-codex")
            codeStore.personalSettingsStore?.settings.set({
                theme: "code-theme-black",
            })
            await vi.waitFor(() => expect(state.personalSettings?.theme).toBe("code-theme-black"))
            expect(codeStore.mcpServerStore).not.toBeNull()
            expect(codeStore.mcpServers.servers).toEqual([])
            expect(state.mcpServerReadCount ?? 0).toBe(0)
            expect(codeStore.crons.started).toBe(false)
            expect(state.projectProcessListCount ?? 0).toBe(0)
            expect(subprocessMocks.setGlobalEnv).not.toHaveBeenCalled()
            expect(state.snapshotReadCount ?? 0).toBe(0)
            expect(state.projectReadCount ?? 0).toBe(1)
            expect(codeStore.runtimeProductSnapshot).toBeNull()
            expect(codeStore.repos.repos.map((repo) => repo.id)).toEqual(["repo-1"])
            expect(codeStore.runtimes.isTaskRunning("task-1")).toBe(false)
            await waitForRuntimeBridge(() => {
                expect(runtimeListRequests).toEqual([{ ownerType: "openade-task", statuses: ["starting", "running"] }])
            })
            expect(trackSpy).toHaveBeenCalledWith(
                "app_opened",
                expect.objectContaining({
                    runtimeProductStoreStatus: "ready",
                    runtimeProductStoreHasSnapshot: false,
                    runtimeProductStoreHasProjectProjection: true,
                    runtimeProductStoreRepoCount: 1,
                    runtimeProductStoreTaskPreviewCount: 1,
                    runtimeProductStoreCachedTaskCount: 0,
                    runtimeProductTransport: "core-websocket",
                    coreRolloutStatus: "connected",
                    coreRolloutReason: "managed-core",
                })
            )
            expect(legacyRuntimeRequests.filter((request) => request.method === "runtime/list")).toHaveLength(0)

            runtimeListResolved = true
            runtimeListDeferred.resolve([runtimeRecord("running", "2026-05-31T00:01:00.000Z")])
            await waitForRuntimeBridge(() => {
                expect(codeStore.runtimes.isTaskRunning("task-1")).toBe(true)
            })
            await codeStore.mcpServers.initializeProductSettingsProjection()
            await codeStore.mcpServers.initializeProductSettingsProjection()
            expect(state.mcpServerReadCount ?? 0).toBe(1)
            expect(codeStore.mcpServers.servers).toEqual([expect.objectContaining({ id: "core-mcp-1", command: "node" })])
        } finally {
            if (!runtimeListResolved) runtimeListDeferred.resolve([])
            listRuntimesSpy.mockRestore()
            trackSpy.mockRestore()
            codeStore.disconnectAllStores()
            await runtime.close()
            restoreOpenADEAPI()
        }
    })

    it("forces the runtime product bridge on when rollout says Core owns product state", async () => {
        subprocessMocks.setGlobalEnv.mockClear()
        const restoreOpenADEAPI = installCleanCoreRolloutState()
        const { client, runtime, state } = createRuntimeBackedClient({ ...createBridgeState(), snapshotReadCount: 0, projectReadCount: 0 })
        let repoConnectCount = 0
        let mcpConnectCount = 0
        let personalSettingsConnectCount = 0
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: false,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
            legacyStoreConnectors: createInMemoryLegacyStoreConnectors(
                () => {
                    repoConnectCount += 1
                },
                () => {
                    mcpConnectCount += 1
                },
                () => {
                    personalSettingsConnectCount += 1
                }
            ),
        })

        try {
            await codeStore.initializeStores()

            expect(codeStore.usesCoreOwnedProductRuntime()).toBe(true)
            expect(codeStore.shouldUseRuntimeProductAPI()).toBe(true)
            expect(codeStore.runtimeProductStoreStatus).toBe("ready")
            expect(state.snapshotReadCount ?? 0).toBe(0)
            expect(state.projectReadCount ?? 0).toBe(1)
            expect(codeStore.runtimeProductSnapshot).toBeNull()
            expect(codeStore.repos.repos.map((repo) => repo.id)).toEqual(["repo-1"])
            expect(codeStore.repoStore).toBeNull()
            expect(repoConnectCount).toBe(0)
            expect(mcpConnectCount).toBe(0)
            expect(personalSettingsConnectCount).toBe(0)
            expect(subprocessMocks.setGlobalEnv).not.toHaveBeenCalled()

            await codeStore.repos.loadRepos()
            expect(state.projectReadCount ?? 0).toBe(1)
        } finally {
            codeStore.disconnectAllStores()
            await runtime.close()
            restoreOpenADEAPI()
        }
    })

    it("initializes desktop server-mode product state from project list instead of full snapshot when available", async () => {
        const { client, runtime, state } = createRuntimeBackedClient({ ...createBridgeState(), snapshotReadCount: 0, projectReadCount: 0 })
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })

        try {
            await codeStore.initializeRuntimeProductStore()

            expect(codeStore.usesCoreOwnedProductRuntime()).toBe(false)
            expect(codeStore.shouldUseRuntimeProductAPI()).toBe(true)
            expect(codeStore.runtimeProductStoreStatus).toBe("ready")
            expect(state.snapshotReadCount ?? 0).toBe(0)
            expect(state.projectReadCount ?? 0).toBe(1)
            expect(codeStore.runtimeProductSnapshot).toBeNull()
            expect(codeStore.getTaskPreviewsForRepo("repo-1")).toEqual([expect.objectContaining({ id: "task-1", title: "Runtime task" })])
        } finally {
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("starts clean managed Core from scoped project list when snapshot is not advertised", async () => {
        const restoreOpenADEAPI = installCleanCoreRolloutState()
        const { client, runtime, state } = createRuntimeBackedClient(
            {
                ...createBridgeState(),
                projectReadCount: 0,
                snapshotReadCount: 0,
            },
            ["initialize", OPENADE_METHOD.projectList]
        )
        const productStore = new OpenADEProductStore(client)
        const refreshSnapshot = vi.spyOn(productStore, "refreshSnapshot")
        const trackSpy = vi.spyOn(analytics, "track").mockImplementation(() => undefined)
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => productStore,
            runtimeNotificationSource: runtime,
            legacyStoreConnectors: createInMemoryLegacyStoreConnectors(),
        })

        try {
            await codeStore.initializeRuntimeProductStore()

            expect(refreshSnapshot).not.toHaveBeenCalled()
            expect(state.snapshotReadCount ?? 0).toBe(0)
            expect(state.projectReadCount ?? 0).toBe(1)
            expect(codeStore.runtimeProductStoreStatus).toBe("ready")
            expect(codeStore.runtimeProductStoreError).toBeNull()
            expect(codeStore.runtimeProductSnapshot).toBeNull()
            expect(codeStore.repos.repos.map((repo) => repo.id)).toEqual(["repo-1"])
            expect(codeStore.getTaskPreviewsForRepo("repo-1")).toEqual([expect.objectContaining({ id: "task-1", title: "Runtime task" })])
            expect(trackSpy).not.toHaveBeenCalledWith("runtime_product_store_error", expect.objectContaining({ source: "initialize_snapshot" }))
            expect(trackSpy).not.toHaveBeenCalledWith("runtime_product_store_fallback", expect.anything())
        } finally {
            refreshSnapshot.mockRestore()
            trackSpy.mockRestore()
            codeStore.disconnectAllStores()
            await runtime.close()
            restoreOpenADEAPI()
        }
    })

    it("coalesces runtime product initialization and does not reread after it is ready", async () => {
        const restoreOpenADEAPI = installCleanCoreRolloutState()
        const { client, runtime, state } = createRuntimeBackedClient(
            {
                ...createBridgeState(),
                projectReadCount: 0,
                snapshotReadCount: 0,
            },
            ["initialize", OPENADE_METHOD.projectList]
        )
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
            legacyStoreConnectors: createInMemoryLegacyStoreConnectors(),
        })

        try {
            await Promise.all([codeStore.initializeRuntimeProductStore(), codeStore.initializeRuntimeProductStore()])

            expect(codeStore.runtimeProductStoreStatus).toBe("ready")
            expect(state.projectReadCount ?? 0).toBe(1)
            expect(state.snapshotReadCount ?? 0).toBe(0)

            await codeStore.initializeRuntimeProductStore()
            expect(state.projectReadCount ?? 0).toBe(1)
        } finally {
            codeStore.disconnectAllStores()
            await runtime.close()
            restoreOpenADEAPI()
        }
    })

    it("refreshes a project-list-only Core projection after the runtime capability cache is cleared", async () => {
        const restoreOpenADEAPI = installCleanCoreRolloutState()
        const { client, runtime, state } = createRuntimeBackedClient(
            {
                ...createBridgeState(),
                projectReadCount: 0,
                snapshotReadCount: 0,
            },
            ["initialize", OPENADE_METHOD.projectList]
        )
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
            legacyStoreConnectors: createInMemoryLegacyStoreConnectors(),
        })

        try {
            await codeStore.initializeRuntimeProductStore()

            expect(state.snapshotReadCount ?? 0).toBe(0)
            expect(state.projectReadCount ?? 0).toBe(1)
            expect(codeStore.runtimeProductSnapshot).toBeNull()
            expect(codeStore.repos.repos).toEqual([expect.objectContaining({ id: "repo-1", name: "Runtime Repo" })])

            await runtime.close()
            expect(client.hasMethod(OPENADE_METHOD.projectList)).toBe(false)
            if (!state.project) throw new Error("Expected bridge project")
            state.project = {
                ...state.project,
                name: "Reconnected Core project list refresh",
            }

            await codeStore.refreshRepoStoreFromStorage()

            expect(state.snapshotReadCount ?? 0).toBe(0)
            expect(state.projectReadCount ?? 0).toBe(2)
            expect(codeStore.runtimeProductSnapshot).toBeNull()
            expect(codeStore.repos.repos).toEqual([expect.objectContaining({ id: "repo-1", name: "Reconnected Core project list refresh" })])
        } finally {
            codeStore.disconnectAllStores()
            await runtime.close()
            restoreOpenADEAPI()
        }
    })

    it("does not persist Core-owned personal settings when personal settings replace is unavailable", async () => {
        const restoreOpenADEAPI = installCleanCoreRolloutState()
        const { client, runtime, state } = createRuntimeBackedClient(createBridgeState(), [
            "initialize",
            OPENADE_METHOD.snapshotRead,
            OPENADE_METHOD.settingsPersonalRead,
        ])
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })

        try {
            await codeStore.initializeStores()

            expect(codeStore.canUseProductMethod(OPENADE_METHOD.settingsPersonalReplace)).toBe(false)
            expect(codeStore.personalSettingsStore?.settings.current.theme).toBe("system")

            codeStore.personalSettingsStore?.settings.set({ theme: "code-theme-black" })
            await Promise.resolve()
            await Promise.resolve()

            expect(codeStore.personalSettingsStore?.settings.current.theme).toBe("code-theme-black")
            expect(state.personalSettings?.theme).toBe("system")
        } finally {
            codeStore.disconnectAllStores()
            await runtime.close()
            restoreOpenADEAPI()
        }
    })

    it("uses default Core-owned personal settings when personal settings read is unavailable", async () => {
        const restoreOpenADEAPI = installCleanCoreRolloutState()
        const { client, runtime, state } = createRuntimeBackedClient(createBridgeState(), ["initialize", OPENADE_METHOD.snapshotRead])
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })

        try {
            state.personalSettings = {
                envVars: {},
                theme: "code-theme-black",
                renderMarkdownMessages: true,
            }

            await codeStore.initializeStores()

            expect(codeStore.canUseProductMethod(OPENADE_METHOD.settingsPersonalRead)).toBe(false)
            expect(codeStore.canUseProductMethod(OPENADE_METHOD.settingsPersonalReplace)).toBe(false)
            expect(codeStore.personalSettingsStore?.settings.current).toMatchObject({
                theme: "system",
                envVars: {},
                renderMarkdownMessages: true,
            })
            codeStore.personalSettingsStore?.settings.set({ theme: "code-theme-clean" })
            await Promise.resolve()
            await Promise.resolve()
            expect(state.personalSettings?.theme).toBe("code-theme-black")
        } finally {
            codeStore.disconnectAllStores()
            await runtime.close()
            restoreOpenADEAPI()
        }
    })

    it("uses Core-owned product reads after accepted legacy import without reopening legacy Yjs stores", async () => {
        subprocessMocks.setGlobalEnv.mockClear()
        const restoreOpenADEAPI = installAcceptedLegacyImportCoreRolloutState()
        const { client, runtime } = createRuntimeBackedClient({
            ...createBridgeState(),
            personalSettings: {
                envVars: { OPENADE_TEST_ENV: "accepted-core" },
                theme: "code-theme-black",
                renderMarkdownMessages: true,
                newTaskHarnessId: "codex",
                newTaskModelId: "gpt-5.3-codex",
            },
        })
        let repoConnectCount = 0
        let mcpConnectCount = 0
        let personalSettingsConnectCount = 0
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
            legacyStoreConnectors: createInMemoryLegacyStoreConnectors(
                () => {
                    repoConnectCount += 1
                },
                () => {
                    mcpConnectCount += 1
                },
                () => {
                    personalSettingsConnectCount += 1
                }
            ),
        })

        try {
            await codeStore.initializeStores()

            expect(codeStore.usesCleanManagedCoreRuntime()).toBe(false)
            expect(codeStore.usesCoreOwnedProductRuntime()).toBe(true)
            expect(codeStore.shouldUseRuntimeProductAPI()).toBe(true)
            expect(codeStore.shouldUseCoreOwnedCronScheduler()).toBe(true)
            expect(repoConnectCount).toBe(0)
            expect(mcpConnectCount).toBe(0)
            expect(personalSettingsConnectCount).toBe(0)
            expect(codeStore.repoStore).toBeNull()
            expect(codeStore.personalSettingsStore?.settings.current.envVars).toEqual({ OPENADE_TEST_ENV: "accepted-core" })
            expect(codeStore.crons.started).toBe(false)
            expect(subprocessMocks.setGlobalEnv).not.toHaveBeenCalled()
        } finally {
            codeStore.disconnectAllStores()
            await runtime.close()
            restoreOpenADEAPI()
        }
    })

    it("refreshes Core-owned repo projections through scoped project reads after startup", async () => {
        const restoreOpenADEAPI = installCleanCoreRolloutState()
        const { client, runtime, state } = createRuntimeBackedClient({
            ...createBridgeState(),
            projectReadCount: 0,
            snapshotReadCount: 0,
        })
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })

        try {
            await codeStore.initializeRuntimeProductStore()

            expect(codeStore.usesCoreOwnedProductRuntime()).toBe(true)
            expect(codeStore.runtimeProductSnapshot).toBeNull()
            expect(state.snapshotReadCount ?? 0).toBe(0)
            expect(state.projectReadCount ?? 0).toBe(1)
            expect(codeStore.repos.repos[0]?.id).toBe("repo-1")
            const snapshotReadsAfterStartup = state.snapshotReadCount ?? 0
            const projectReadsAfterStartup = state.projectReadCount ?? 0
            if (!state.project) throw new Error("Expected bridge project")
            state.project = {
                ...state.project,
                name: "Scoped Core project refresh",
            }

            await codeStore.refreshRepoStoreFromStorage()

            expect(state.snapshotReadCount ?? 0).toBe(snapshotReadsAfterStartup)
            expect(state.projectReadCount ?? 0).toBe(projectReadsAfterStartup + 1)
            expect(codeStore.repos.repos).toEqual([expect.objectContaining({ id: "repo-1", name: "Scoped Core project refresh" })])

            state.project = {
                ...state.project,
                name: "Scoped Core repo mutation refresh",
            }

            await codeStore.refreshProductStateAfterRepoMutation()

            expect(state.snapshotReadCount ?? 0).toBe(snapshotReadsAfterStartup)
            expect(state.projectReadCount ?? 0).toBe(projectReadsAfterStartup + 2)
            expect(codeStore.repos.repos).toEqual([expect.objectContaining({ id: "repo-1", name: "Scoped Core repo mutation refresh" })])
        } finally {
            codeStore.disconnectAllStores()
            await runtime.close()
            restoreOpenADEAPI()
        }
    })

    it("refreshes Core-owned repo projections through snapshot reads when project-list is unavailable", async () => {
        const restoreOpenADEAPI = installCleanCoreRolloutState()
        const { client, runtime, state } = createRuntimeBackedClient(
            {
                ...createBridgeState(),
                projectReadCount: 0,
                snapshotReadCount: 0,
            },
            allOpenADEMethodPermissionsExcept([OPENADE_METHOD.projectList])
        )
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })

        try {
            await codeStore.initializeRuntimeProductStore()

            expect(codeStore.usesCoreOwnedProductRuntime()).toBe(true)
            expect(codeStore.canUseProductMethod(OPENADE_METHOD.projectList)).toBe(false)
            expect(codeStore.canUseProductMethod(OPENADE_METHOD.snapshotRead)).toBe(true)
            const snapshotReadsAfterStartup = state.snapshotReadCount ?? 0
            const projectReadsAfterStartup = state.projectReadCount ?? 0
            if (!state.project) throw new Error("Expected bridge project")
            state.project = {
                ...state.project,
                name: "Snapshot Core project refresh",
            }

            await codeStore.refreshRepoStoreFromStorage()

            expect(state.projectReadCount ?? 0).toBe(projectReadsAfterStartup)
            expect(state.snapshotReadCount ?? 0).toBe(snapshotReadsAfterStartup + 1)
            expect(codeStore.runtimeProductSnapshot?.repos).toEqual([expect.objectContaining({ id: "repo-1", name: "Snapshot Core project refresh" })])
            expect(codeStore.repos.repos).toEqual([expect.objectContaining({ id: "repo-1", name: "Snapshot Core project refresh" })])
        } finally {
            codeStore.disconnectAllStores()
            await runtime.close()
            restoreOpenADEAPI()
        }
    })

    it("keeps accepted legacy-import Core sessions on scoped project-list fallback when the initial snapshot refresh fails", async () => {
        subprocessMocks.setGlobalEnv.mockClear()
        const restoreOpenADEAPI = installAcceptedLegacyImportCoreRolloutState()
        const { client, runtime, state } = createRuntimeBackedClient({
            ...createBridgeState(),
            personalSettings: {
                envVars: { OPENADE_TEST_ENV: "accepted-core" },
                theme: "code-theme-black",
                renderMarkdownMessages: true,
                newTaskHarnessId: "codex",
                newTaskModelId: "gpt-5.3-codex",
            },
            taskReadRequests: [],
        })
        const productStore = new OpenADEProductStore(client)
        vi.spyOn(productStore, "refreshSnapshot").mockImplementationOnce(async () => {
            await runtime.connect()
            throw new Error("accepted snapshot unavailable")
        })
        let repoConnectCount = 0
        let mcpConnectCount = 0
        let personalSettingsConnectCount = 0
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => productStore,
            runtimeNotificationSource: runtime,
            legacyStoreConnectors: createInMemoryLegacyStoreConnectors(
                () => {
                    repoConnectCount += 1
                },
                () => {
                    mcpConnectCount += 1
                },
                () => {
                    personalSettingsConnectCount += 1
                }
            ),
        })

        try {
            await codeStore.initializeStores()

            expect(codeStore.usesCleanManagedCoreRuntime()).toBe(false)
            expect(codeStore.usesCoreOwnedProductRuntime()).toBe(true)
            expect(codeStore.shouldUseRuntimeProductAPI()).toBe(true)
            expect(codeStore.runtimeProductStoreStatus).toBe("ready")
            expect(codeStore.runtimeProductStoreError).toBeNull()
            expect(codeStore.runtimeProductSnapshot).toBeNull()
            expect(codeStore.repos.repos).toEqual([expect.objectContaining({ id: "repo-1", path: "/tmp/runtime-repo" })])
            expect(repoConnectCount).toBe(0)
            expect(mcpConnectCount).toBe(0)
            expect(personalSettingsConnectCount).toBe(0)
            expect(codeStore.repoStore).toBeNull()
            expect(codeStore.personalSettingsStore?.settings.current.theme).toBe("code-theme-black")
            expect(codeStore.personalSettingsStore?.settings.current.envVars).toEqual({ OPENADE_TEST_ENV: "accepted-core" })
            expect(codeStore.crons.started).toBe(false)
            expect(subprocessMocks.setGlobalEnv).not.toHaveBeenCalled()

            const snapshotReadsBeforeScopedRecovery = state.snapshotReadCount ?? 0
            const projects = await codeStore.loadRuntimeProductProjects()
            expect(projects.map((project) => project.id)).toEqual(["repo-1"])
            expect(codeStore.repos.repos.map((project) => project.id)).toEqual(["repo-1"])
            expect(state.projectReadCount).toBe(1)
            expect(state.snapshotReadCount ?? 0).toBe(snapshotReadsBeforeScopedRecovery)

            const loadedTask = await codeStore.loadRuntimeProductTask("repo-1", "task-1")
            expect(loadedTask?.id).toBe("task-1")
            expect(state.taskReadRequests).toEqual([{ repoId: "repo-1", taskId: "task-1", hydrateSessionEvents: false }])
        } finally {
            codeStore.disconnectAllStores()
            await runtime.close()
            restoreOpenADEAPI()
        }
    })

    it("attaches the Core product store for task refreshes before app-store initialization without broad projection repair", async () => {
        const restoreOpenADEAPI = installCleanCoreRolloutState()
        const { client, runtime, state } = createRuntimeBackedClient({
            ...createBridgeState(),
            projectReadCount: 0,
            snapshotReadCount: 0,
            taskReadRequests: [],
        })
        let repoConnectCount = 0
        let mcpConnectCount = 0
        let personalSettingsConnectCount = 0
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
            legacyStoreConnectors: createInMemoryLegacyStoreConnectors(
                () => {
                    repoConnectCount += 1
                },
                () => {
                    mcpConnectCount += 1
                },
                () => {
                    personalSettingsConnectCount += 1
                }
            ),
        })

        try {
            expect(codeStore.storeInitialized).toBe(false)
            expect(codeStore.usesCoreOwnedProductRuntime()).toBe(true)
            expect(codeStore.shouldUseRuntimeProductAPI()).toBe(false)

            await codeStore.refreshTaskStoreFromStorage("task-1")

            expect(codeStore.shouldUseRuntimeProductAPI()).toBe(true)
            expect(codeStore.canUseProductMethod(OPENADE_METHOD.taskRead)).toBe(true)
            expect(codeStore.runtimeProductStoreStatus).toBe("disabled")
            expect(state.projectReadCount ?? 0).toBe(0)
            expect(state.snapshotReadCount ?? 0).toBe(0)
            expect(state.taskReadRequests).toEqual([])
            expect(codeStore.tasks.getTask("task-1")).toBeNull()
            expect(repoConnectCount).toBe(0)
            expect(mcpConnectCount).toBe(0)
            expect(personalSettingsConnectCount).toBe(0)
            expect(codeStore.repoStore).toBeNull()
        } finally {
            codeStore.disconnectAllStores()
            await runtime.close()
            restoreOpenADEAPI()
        }
    })

    it("attaches the Core product store for repo refreshes before app-store initialization", async () => {
        const restoreOpenADEAPI = installCleanCoreRolloutState()
        const { client, runtime, state } = createRuntimeBackedClient({
            ...createBridgeState(),
            projectReadCount: 0,
        })
        let repoConnectCount = 0
        let mcpConnectCount = 0
        let personalSettingsConnectCount = 0
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
            legacyStoreConnectors: createInMemoryLegacyStoreConnectors(
                () => {
                    repoConnectCount += 1
                },
                () => {
                    mcpConnectCount += 1
                },
                () => {
                    personalSettingsConnectCount += 1
                }
            ),
        })

        try {
            expect(codeStore.storeInitialized).toBe(false)
            expect(codeStore.usesCoreOwnedProductRuntime()).toBe(true)
            expect(codeStore.shouldUseRuntimeProductAPI()).toBe(false)

            await codeStore.refreshRepoStoreFromStorage()

            expect(codeStore.shouldUseRuntimeProductAPI()).toBe(true)
            expect(codeStore.runtimeProductStoreStatus).toBe("ready")
            expect(state.projectReadCount ?? 0).toBe(1)
            expect(codeStore.repos.repos).toEqual([expect.objectContaining({ id: "repo-1", name: "Runtime Repo" })])
            expect(repoConnectCount).toBe(0)
            expect(mcpConnectCount).toBe(0)
            expect(personalSettingsConnectCount).toBe(0)
            expect(codeStore.repoStore).toBeNull()
        } finally {
            codeStore.disconnectAllStores()
            await runtime.close()
            restoreOpenADEAPI()
        }
    })

    it("attaches the Core product store for SmartEditor file search before app-store initialization", async () => {
        const restoreOpenADEAPI = installCleanCoreRolloutState()
        const { client, runtime, state } = createRuntimeBackedClient(createBridgeState())
        const productStore = new OpenADEProductStore(client)
        const runtimeFuzzySearch = vi.spyOn(productStore, "fuzzySearchProjectFiles")
        const legacyFuzzySearch = vi.spyOn(filesApi, "fuzzySearch").mockRejectedValue(new Error("legacy fuzzy search should not be used"))
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => productStore,
            runtimeNotificationSource: runtime,
            legacyStoreConnectors: createInMemoryLegacyStoreConnectors(),
        })

        try {
            const projectedRepo = projectFromState(state)
            if (!projectedRepo) throw new Error("Expected projected repo")
            runInAction(() => {
                ;(
                    codeStore as unknown as {
                        runtimeProductProjects: Map<string, OpenADEProject>
                    }
                ).runtimeProductProjects.set(projectedRepo.id, projectedRepo)
            })

            expect(codeStore.storeInitialized).toBe(false)
            expect(codeStore.usesCoreOwnedProductRuntime()).toBe(true)
            expect(codeStore.shouldUseRuntimeProductAPI()).toBe(false)

            const manager = codeStore.smartEditors.getManager("task-create", "repo-1")
            expect(manager.canSearchFileMentions("/tmp/runtime-repo")).toBe(true)
            expect(codeStore.shouldUseRuntimeProductAPI()).toBe(false)
            expect(runtimeFuzzySearch).not.toHaveBeenCalled()

            await expect(manager.searchFileMentions("/tmp/runtime-repo", "runtime")).resolves.toEqual(
                expect.objectContaining({ results: [runtimeSearchFixture.path] })
            )

            expect(codeStore.shouldUseRuntimeProductAPI()).toBe(true)
            expect(runtimeFuzzySearch).toHaveBeenCalledWith({
                repoId: "repo-1",
                query: "runtime",
                matchDirs: false,
                limit: 20,
                includeHidden: true,
            })
            expect(legacyFuzzySearch).not.toHaveBeenCalled()
        } finally {
            legacyFuzzySearch.mockRestore()
            runtimeFuzzySearch.mockRestore()
            codeStore.disconnectAllStores()
            await runtime.close()
            restoreOpenADEAPI()
        }
    })

    it("uses route-owned SmartEditor file search before broad product projection is active", async () => {
        const { client, runtime } = createRuntimeBackedClient(createBridgeState())
        const productStore = new OpenADEProductStore(client)
        const runtimeFuzzySearch = vi.spyOn(productStore, "fuzzySearchProjectFiles")
        const legacyFuzzySearch = vi.spyOn(filesApi, "fuzzySearch").mockRejectedValue(new Error("legacy fuzzy search should not be used"))
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => productStore,
            runtimeNotificationSource: runtime,
            legacyStoreConnectors: createInMemoryLegacyStoreConnectors(),
        })

        try {
            expect(codeStore.shouldUseRuntimeProductTaskRoute()).toBe(true)
            expect(codeStore.shouldUseRuntimeProductAPI()).toBe(false)

            await expect(codeStore.loadRuntimeProductTaskForRoute("repo-1", "task-1")).resolves.toMatchObject({ id: "task-1" })
            expect(codeStore.shouldUseRuntimeProductAPI()).toBe(false)

            const manager = codeStore.smartEditors.getManager("task-task-1", "repo-1")
            expect(manager.canSearchFileMentions("/tmp/runtime-repo")).toBe(true)

            await expect(manager.searchFileMentions("/tmp/runtime-repo", "runtime", 20)).resolves.toEqual(
                expect.objectContaining({ results: [runtimeSearchFixture.path] })
            )

            expect(runtimeFuzzySearch).toHaveBeenCalledWith({
                repoId: "repo-1",
                taskId: "task-1",
                query: "runtime",
                matchDirs: false,
                limit: 20,
                includeHidden: true,
            })
            expect(legacyFuzzySearch).not.toHaveBeenCalled()
        } finally {
            legacyFuzzySearch.mockRestore()
            runtimeFuzzySearch.mockRestore()
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("coalesces concurrent SmartEditor fuzzy searches across managers", async () => {
        const { client, runtime } = createRuntimeBackedClient({
            project: { ...project, path: "/tmp/runtime-repo" },
            task: { ...task, isolationStrategy: { type: "head" } },
        })
        const productStore = new OpenADEProductStore(client)
        const originalFuzzySearch = productStore.fuzzySearchProjectFiles.bind(productStore)
        const releaseSearch = createReleaseGate()
        const runtimeFuzzySearch = vi.spyOn(productStore, "fuzzySearchProjectFiles").mockImplementation(async (params) => {
            await releaseSearch.wait
            return originalFuzzySearch(params)
        })
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => productStore,
            runtimeNotificationSource: runtime,
        })

        try {
            await codeStore.initializeRuntimeProductStore()

            const taskEditorManager = codeStore.smartEditors.getManager("task-create", "repo-1")
            const scratchpadManager = codeStore.smartEditors.getManager("scratchpad-pad-1", "repo-1")
            const firstSearch = taskEditorManager.searchFileMentions("/tmp/runtime-repo", "runtime", 20)
            const secondSearch = scratchpadManager.searchFileMentions("/tmp/runtime-repo", "runtime", 20)

            await vi.waitFor(() => {
                expect(runtimeFuzzySearch).toHaveBeenCalledTimes(1)
            })
            releaseSearch.release()

            await expect(Promise.all([firstSearch, secondSearch])).resolves.toEqual([
                expect.objectContaining({ results: [runtimeSearchFixture.path] }),
                expect.objectContaining({ results: [runtimeSearchFixture.path] }),
            ])
        } finally {
            releaseSearch.release()
            runtimeFuzzySearch.mockRestore()
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("normalizes runtime fuzzy search in-flight defaults without merging generated-file searches", async () => {
        const { client, runtime } = createRuntimeBackedClient({
            project: { ...project, path: "/tmp/runtime-repo" },
            task: { ...task, isolationStrategy: { type: "head" } },
        })
        const productStore = new OpenADEProductStore(client)
        const originalFuzzySearch = productStore.fuzzySearchProjectFiles.bind(productStore)
        const releaseSearch = createReleaseGate()
        const runtimeFuzzySearch = vi.spyOn(productStore, "fuzzySearchProjectFiles").mockImplementation(async (params) => {
            await releaseSearch.wait
            return originalFuzzySearch(params)
        })
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => productStore,
            runtimeNotificationSource: runtime,
        })

        try {
            await codeStore.initializeRuntimeProductStore()

            const defaultSearch = codeStore.fuzzySearchProductProjectFiles({
                repoId: "repo-1",
                taskId: "task-1",
                query: "runtime",
                limit: 20,
            })
            const explicitFalseSearch = codeStore.fuzzySearchProductProjectFiles({
                repoId: "repo-1",
                taskId: "task-1",
                query: "runtime",
                matchDirs: false,
                limit: 20,
                includeHidden: false,
                includeGenerated: false,
            })
            const generatedSearch = codeStore.fuzzySearchProductProjectFiles({
                repoId: "repo-1",
                taskId: "task-1",
                query: "runtime",
                matchDirs: false,
                limit: 20,
                includeHidden: false,
                includeGenerated: true,
            })

            await vi.waitFor(() => {
                expect(runtimeFuzzySearch).toHaveBeenCalledTimes(2)
            })
            expect(runtimeFuzzySearch).toHaveBeenNthCalledWith(
                2,
                expect.objectContaining({
                    includeGenerated: true,
                })
            )
            releaseSearch.release()

            await expect(Promise.all([defaultSearch, explicitFalseSearch, generatedSearch])).resolves.toEqual([
                expect.objectContaining({ results: [runtimeSearchFixture.path] }),
                expect.objectContaining({ results: [runtimeSearchFixture.path] }),
                expect.objectContaining({ results: [runtimeSearchFixture.path] }),
            ])
        } finally {
            releaseSearch.release()
            runtimeFuzzySearch.mockRestore()
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("treats an active runtime snapshot as authoritative over stale legacy repo previews", async () => {
        const { client, runtime } = createRuntimeBackedClient()
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })

        try {
            await codeStore.initializeRuntimeProductStore()
            expect(codeStore.shouldUseRuntimeProductAPI()).toBe(true)

            const staleLegacyRepoStore = createRepoStore(new Y.Doc())
            staleLegacyRepoStore.repos.push({
                id: "legacy-repo",
                name: "Legacy Repo",
                path: "/tmp/legacy-repo",
                createdBy: { id: "legacy-user", email: "legacy@example.com" },
                createdAt: now,
                updatedAt: now,
                tasks: [
                    {
                        id: "legacy-task",
                        slug: "legacy-task",
                        title: "Stale legacy task",
                        createdAt: now,
                    },
                ],
            })
            runInAction(() => {
                codeStore.repoStore = staleLegacyRepoStore
            })

            expect(codeStore.getTaskPreviewsForRepo("repo-1")).toEqual([expect.objectContaining({ id: "task-1", title: "Runtime task" })])
            expect(codeStore.getTaskPreviewsForRepo("legacy-repo")).toEqual([])
            expect(codeStore.findProductRepoIdForTask("legacy-task")).toBeNull()
            expect(codeStore.getTaskPreviewReposForStats()).toEqual([
                expect.objectContaining({
                    id: "repo-1",
                    tasks: [expect.objectContaining({ id: "task-1" })],
                }),
            ])
        } finally {
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("falls back to scoped Core project list instead of opening legacy stores when snapshot refresh fails", async () => {
        subprocessMocks.setGlobalEnv.mockClear()
        const restoreOpenADEAPI = installCleanCoreRolloutState()
        const { client, runtime, server, state } = createRuntimeBackedClient({
            ...createBridgeState(),
            personalSettings: {
                envVars: {},
                theme: "code-theme-clean",
                renderMarkdownMessages: false,
                newTaskHarnessId: "codex",
                newTaskModelId: "gpt-5.3-codex",
            },
        })
        server.supervisor.register(runtimeRecord("running", "2026-05-31T00:01:00.000Z"))
        if (!state.task) throw new Error("Expected bridge task")
        state.task = {
            ...state.task,
            events: [
                ...state.task.events,
                {
                    id: "snapshot-clean-core",
                    type: "snapshot",
                    status: "completed",
                    createdAt: now,
                    completedAt: now,
                    userInput: "",
                    actionEventId: "event-1",
                    referenceBranch: "main",
                    mergeBaseCommit: "merge-base",
                    fullPatch: "",
                    patchFileId: "patch-1",
                    stats: { filesChanged: 1, insertions: 2, deletions: 1 },
                    files: [],
                },
            ],
        }
        const productStore = new OpenADEProductStore(client)
        vi.spyOn(productStore, "refreshSnapshot").mockImplementationOnce(async () => {
            await runtime.connect()
            throw new Error("snapshot unavailable")
        })
        let repoConnectCount = 0
        let mcpConnectCount = 0
        let personalSettingsConnectCount = 0
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => productStore,
            runtimeNotificationSource: runtime,
            legacyStoreConnectors: createInMemoryLegacyStoreConnectors(
                () => {
                    repoConnectCount += 1
                },
                () => {
                    mcpConnectCount += 1
                },
                () => {
                    personalSettingsConnectCount += 1
                }
            ),
        })

        try {
            await codeStore.initializeStores()

            expect(codeStore.runtimeProductStoreStatus).toBe("ready")
            expect(codeStore.runtimeProductStoreError).toBeNull()
            expect(repoConnectCount).toBe(0)
            expect(mcpConnectCount).toBe(0)
            expect(personalSettingsConnectCount).toBe(0)
            expect(codeStore.repoStore).toBeNull()
            expect(codeStore.runtimeProductSnapshot).toBeNull()
            expect(codeStore.repos.repos.map((repo) => repo.id)).toEqual(["repo-1"])
            const staleLegacyRepoStore = createRepoStore(new Y.Doc())
            staleLegacyRepoStore.repos.push({
                id: "legacy-repo",
                name: "Legacy Repo",
                path: "/tmp/legacy-repo",
                createdBy: { id: "legacy-user", email: "legacy@example.com" },
                createdAt: now,
                updatedAt: now,
                tasks: [
                    {
                        id: "legacy-task",
                        slug: "legacy-task",
                        title: "Legacy task",
                        createdAt: now,
                    },
                ],
            })
            runInAction(() => {
                codeStore.repoStore = staleLegacyRepoStore
            })
            const staleLegacyTask: Task = {
                id: "legacy-task",
                repoId: "legacy-repo",
                slug: "legacy-task",
                title: "Stale legacy task",
                description: "This Yjs task should not leak into active Core product state.",
                isolationStrategy: { type: "head" },
                deviceEnvironments: [],
                createdBy: { id: "legacy-user", email: "legacy@example.com" },
                events: [],
                comments: [],
                sessionIds: {},
                createdAt: now,
                updatedAt: now,
            }
            const staleLegacyTaskStore = createTaskStore(new Y.Doc(), staleLegacyTask)
            const staleLegacyTaskConnection = {
                store: staleLegacyTaskStore,
                sync: async () => undefined,
                refresh: async () => true,
                disconnect: vi.fn(),
            }
            ;(
                codeStore as unknown as {
                    taskStoreConnections: Map<string, typeof staleLegacyTaskConnection>
                }
            ).taskStoreConnections = new Map([["legacy-task", staleLegacyTaskConnection]])

            expect(codeStore.repos.repos.map((repo) => repo.id)).toEqual(["repo-1"])
            expect(codeStore.getTaskPreviewsForRepo("legacy-repo")).toEqual([])
            expect(codeStore.getTaskPreviewsForRepo("repo-1").map((task) => task.id)).toEqual(["task-1"])
            expect(codeStore.getTaskPreviewReposForStats().map((repo) => repo.id)).toEqual(["repo-1"])
            expect(codeStore.tasks.getTask("legacy-task")).toBeNull()
            expect(codeStore.tasks.getTaskModel("legacy-task")).toBeNull()
            expect(codeStore.findProductRepoIdForTask("legacy-task")).toBeNull()
            expect(codeStore.personalSettingsStore?.settings.current.theme).toBe("code-theme-clean")
            expect(codeStore.personalSettingsStore?.settings.current.renderMarkdownMessages).toBe(false)
            expect(codeStore.defaultHarnessId).toBe("codex")
            expect(codeStore.defaultModel).toBe("gpt-5.3-codex")
            codeStore.personalSettingsStore?.settings.set({
                theme: "code-theme-black",
            })
            await vi.waitFor(() => expect(state.personalSettings?.theme).toBe("code-theme-black"))
            expect(codeStore.mcpServerStore).not.toBeNull()
            expect(codeStore.shouldUseCoreOwnedCronScheduler()).toBe(true)
            expect(codeStore.crons.started).toBe(false)
            await codeStore.crons.startAll()
            expect(codeStore.crons.started).toBe(false)
            expect(codeStore.runtimes.isTaskRunning("task-1")).toBe(true)
            expect(subprocessMocks.setGlobalEnv).not.toHaveBeenCalled()

            const snapshotReadsBeforeBackgroundRuntime = state.snapshotReadCount ?? 0
            state.taskReadRequests = []
            server.notify("runtime/updated", runtimeRecord("running", "2026-05-31T00:01:30.000Z", "task-background", "runtime-background"))
            await waitForRuntimeBridge(() => {
                expect(codeStore.runtimes.isTaskRunning("task-background")).toBe(true)
            })
            server.notify("runtime/completed", runtimeRecord("completed", "2026-05-31T00:01:45.000Z", "task-background", "runtime-background"))
            await waitForRuntimeBridge(() => {
                expect(codeStore.runtimes.isTaskRunning("task-background")).toBe(false)
            })
            expect(state.taskReadRequests).toEqual([])
            expect(state.snapshotReadCount ?? 0).toBe(snapshotReadsBeforeBackgroundRuntime)

            state.taskReadRequests = []
            const loadedTask = await codeStore.loadRuntimeProductTask("repo-1", "task-1")
            expect(loadedTask?.id).toBe("task-1")
            expect(codeStore.runtimeProductSnapshot).toBeNull()
            expect(state.taskReadRequests).toEqual([{ repoId: "repo-1", taskId: "task-1", hydrateSessionEvents: false }])

            const legacyTaskRefresh = vi.spyOn(codeStore, "refreshTaskStoreFromStorage")
            const taskMutationRefresh = vi.spyOn(codeStore, "refreshProductStateAfterTaskMutation")
            const taskModel = codeStore.tasks.getTaskModel("task-1")
            if (!taskModel) throw new Error("Expected runtime task model")
            state.taskGitSummaryReadCount = 0
            await taskModel.refreshGitState({ force: true })
            expect(state.taskGitSummaryReadCount).toBe(1)
            expect(taskModel.gitStatus?.hasChanges).toBe(true)

            const runtimeSnapshotPatchRead = vi.spyOn(codeStore, "readProductTaskSnapshotPatch")
            const legacySnapshotPatchRead = vi.spyOn(snapshotsApi, "loadPatch")
            const snapshotModel = taskModel.events.find((event) => event.id === "snapshot-clean-core") as SnapshotEventModel | undefined
            if (!snapshotModel) throw new Error("Expected runtime snapshot model")
            await snapshotModel.loadPatch()
            expect(snapshotModel.fullPatch).toContain("+snapshot product store")
            expect(runtimeSnapshotPatchRead).toHaveBeenCalledWith({
                repoId: "repo-1",
                taskId: "task-1",
                eventId: "snapshot-clean-core",
            })
            expect(legacySnapshotPatchRead).not.toHaveBeenCalled()

            const runtimeFileSearch = vi.spyOn(codeStore, "fuzzySearchProductProjectFiles")
            const smartEditorManager = codeStore.smartEditors.getManager("task-task-1", "repo-1")
            await expect(smartEditorManager.searchFileMentions("/tmp/runtime-repo", "README")).resolves.toEqual(
                expect.objectContaining({ results: [runtimeSearchFixture.path] })
            )
            expect(runtimeFileSearch).toHaveBeenCalledWith({
                repoId: "repo-1",
                taskId: "task-1",
                query: "README",
                matchDirs: false,
                limit: 20,
                includeHidden: true,
            })

            const runtimeGitInfoRead = vi.spyOn(codeStore, "readProductProjectGitInfo")
            const runtimeFileList = vi.spyOn(codeStore, "listProductProjectFiles")
            const runtimeFileRead = vi.spyOn(codeStore, "readProductProjectFile")
            const runtimeContentSearch = vi.spyOn(codeStore, "searchProductProject")
            const legacyDescribePath = vi.spyOn(filesApi, "describePath").mockRejectedValue(new Error("legacy file read should not be used"))
            const legacyContentSearch = vi.spyOn(filesApi, "contentSearch").mockRejectedValue(new Error("legacy content search should not be used"))
            const legacyFuzzySearch = vi.spyOn(filesApi, "fuzzySearch").mockRejectedValue(new Error("legacy fuzzy search should not be used"))
            try {
                await expect(taskModel.ensureTaskWorkingDirHint()).resolves.toBe("/tmp/runtime-repo")
                const scratchpadManager = codeStore.smartEditors.getManager("scratchpad-pad-1", "repo-1")
                await expect(scratchpadManager.searchFileMentions("/tmp/runtime-repo", "scratch")).resolves.toEqual(
                    expect.objectContaining({ results: [runtimeSearchFixture.path] })
                )
                taskModel.fileBrowser.setWorkingDir("/tmp/runtime-repo")
                taskModel.contentSearch.setWorkingDir("/tmp/runtime-repo")
                await taskModel.fileBrowser.openFileReference("runtime-search.ts", {
                    line: 2,
                })
                taskModel.contentSearch.setQuery("needle")

                await vi.waitFor(() => {
                    expect(taskModel.fileBrowser.activeFileData?.content).toBe(runtimeSearchFixture.content)
                    expect(taskModel.contentSearch.previewData?.content).toBe(runtimeSearchFixture.content)
                })
                expect(runtimeFileSearch).toHaveBeenCalledWith({
                    repoId: "repo-1",
                    query: "scratch",
                    matchDirs: false,
                    limit: 20,
                    includeHidden: true,
                })
                expect(runtimeGitInfoRead).not.toHaveBeenCalled()
                expect(runtimeFileList).toHaveBeenCalledWith({
                    repoId: "repo-1",
                    taskId: "task-1",
                    path: "",
                    maxDepth: 0,
                    maxEntries: 1000,
                    includeHidden: true,
                    includeGenerated: true,
                })
                expect(runtimeFileRead).toHaveBeenCalledWith({
                    repoId: "repo-1",
                    taskId: "task-1",
                    path: runtimeSearchFixture.path,
                    maxBytes: 5 * 1024 * 1024,
                })
                expect(runtimeContentSearch).toHaveBeenCalledWith({
                    repoId: "repo-1",
                    taskId: "task-1",
                    query: "needle",
                    limit: 100,
                    caseSensitive: false,
                })
                expect(legacyDescribePath).not.toHaveBeenCalled()
                expect(legacyContentSearch).not.toHaveBeenCalled()
                expect(legacyFuzzySearch).not.toHaveBeenCalled()
            } finally {
                runtimeGitInfoRead.mockRestore()
                runtimeFileList.mockRestore()
                runtimeFileRead.mockRestore()
                runtimeContentSearch.mockRestore()
                legacyDescribePath.mockRestore()
                legacyContentSearch.mockRestore()
                legacyFuzzySearch.mockRestore()
            }

            const setupContainer = document.createElement("div")
            document.body.appendChild(setupContainer)
            const setupRoot = createRoot(setupContainer)
            const rawSetup = vi.spyOn(TaskEnvironment, "setup").mockRejectedValue(new Error("legacy environment setup should not be used"))
            const setupComplete = vi.fn()
            ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
            const snapshotReadsBeforeSetup = state.snapshotReadCount ?? 0
            state.taskReadRequests = []
            try {
                await act(async () => {
                    setupRoot.render(
                        createElement(
                            CodeStoreProvider,
                            { store: codeStore },
                            createElement(EnvironmentSetupView, {
                                taskModel,
                                onComplete: setupComplete,
                            })
                        )
                    )
                })

                await waitForRuntimeBridge(() => {
                    expect(codeStore.tasks.getTask("task-1")?.deviceEnvironments).toEqual([expect.objectContaining({ id: "runtime-device" })])
                    expect(codeStore.tasks.getTask("task-1")?.events).toEqual(
                        expect.arrayContaining([
                            expect.objectContaining({
                                id: "setup-runtime-device",
                                type: "setup_environment",
                            }),
                        ])
                    )
                    expect(setupComplete).toHaveBeenCalled()
                    expect(setupContainer.textContent).toContain("Complete")
                })
                expect(rawSetup).not.toHaveBeenCalled()
                expect(codeStore.repos.getRepo("repo-1")).toEqual(expect.objectContaining({ id: "repo-1", path: "/tmp/runtime-repo" }))
                expect(codeStore.runtimeProductSnapshot).toBeNull()
                expect(state.taskReadRequests).toEqual([])
                expect(state.snapshotReadCount ?? 0).toBe(snapshotReadsBeforeSetup)
            } finally {
                await act(async () => setupRoot.unmount())
                setupContainer.remove()
                rawSetup.mockRestore()
            }

            const snapshotReadsBeforeComment = state.snapshotReadCount ?? 0
            state.taskReadRequests = []
            const commentId = await codeStore.comments.addComment(
                "task-1",
                { type: "llm_output", eventId: "event-1", lineStart: 1, lineEnd: 1 },
                "Clean Core comment",
                { text: "Clean Core", linesBefore: "", linesAfter: "" }
            )
            expect(commentId).toBe("comment-created")
            expect(codeStore.tasks.getTask("task-1")?.comments).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        id: "comment-created",
                        content: "Clean Core comment",
                    }),
                ])
            )
            expect(state.taskReadRequests).toEqual([])
            expect(state.snapshotReadCount ?? 0).toBe(snapshotReadsBeforeComment)
            expect(legacyTaskRefresh).not.toHaveBeenCalled()
            expect(taskMutationRefresh).not.toHaveBeenCalled()
            expect(codeStore.runtimeProductSnapshot).toBeNull()

            const createdRepo = await codeStore.repos.createRepo({
                name: "Recovered Core Repo",
                path: "/tmp/recovered-core-repo",
            })
            expect(createdRepo).toEqual(
                expect.objectContaining({
                    id: "repo-created",
                    name: "Recovered Core Repo",
                    path: "/tmp/recovered-core-repo",
                })
            )
            expect(state.project).toEqual(
                expect.objectContaining({
                    id: "repo-created",
                    name: "Recovered Core Repo",
                    path: "/tmp/recovered-core-repo",
                })
            )
            expect(codeStore.runtimeProductStoreStatus).toBe("ready")
            expect(codeStore.runtimeProductSnapshot).toBeNull()
            expect(codeStore.getRuntimeProductProject("repo-created")).toEqual(
                expect.objectContaining({
                    id: "repo-created",
                    name: "Recovered Core Repo",
                    path: "/tmp/recovered-core-repo",
                })
            )
        } finally {
            codeStore.disconnectAllStores()
            await runtime.close()
            restoreOpenADEAPI()
        }
    })

    it("creates clean managed Core tasks without requiring a snapshot-backed repo projection", async () => {
        const restoreOpenADEAPI = installCleanCoreRolloutState()
        const { client, runtime, state } = createRuntimeBackedClient({
            ...createBridgeState(),
            project: { ...project, tasks: [] },
            task: null,
            taskReadRequests: [],
        })
        const productStore = new OpenADEProductStore(client)
        vi.spyOn(productStore, "refreshSnapshot").mockImplementationOnce(async () => {
            await runtime.connect()
            throw new Error("snapshot unavailable")
        })
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => productStore,
            runtimeNotificationSource: runtime,
            legacyStoreConnectors: createInMemoryLegacyStoreConnectors(),
        })
        let refreshAfterCreation: { mockRestore(): void } | null = null

        try {
            await codeStore.initializeStores()
            expect(codeStore.runtimeProductSnapshot).toBeNull()
            expect(codeStore.repos.getRepo("repo-1")).toEqual(expect.objectContaining({ id: "repo-1", path: "/tmp/runtime-repo" }))

            refreshAfterCreation = vi.spyOn(codeStore, "refreshProductStateAfterTaskCreation")
            const creationId = codeStore.creation.newTask({
                repoId: "repo-1",
                description: "create a task with Core only",
                mode: "do",
                isolationStrategy: { type: "head" },
                harnessId: "codex",
                modelId: "gpt-test",
            })

            await waitForRuntimeBridge(() => {
                expect(codeStore.creation.getCreation(creationId)?.completedTaskId).toBe("task-created")
                expect(codeStore.tasks.getTask("task-created")).toEqual(expect.objectContaining({ id: "task-created", repoId: "repo-1" }))
            })
            expect(refreshAfterCreation).not.toHaveBeenCalled()
            expect(state.taskCreateRequests?.[0]).toMatchObject({
                repoId: "repo-1",
                input: "create a task with Core only",
                createdBy: { id: "user-1", email: "user@example.com" },
                deviceId: expect.any(String),
                isolationStrategy: { type: "head" },
            })
            expect(state.turnStartRequests?.[0]).toMatchObject({
                repoId: "repo-1",
                inTaskId: "task-created",
                type: "do",
                input: "create a task with Core only",
                harnessId: "codex",
                modelId: "gpt-test",
            })
            expect(state.turnStartRequests?.[0]).not.toHaveProperty("isolationStrategy")
            expect(state.task?.id).toBe("task-created")
            await waitForRuntimeBridge(() => {
                expect(state.task?.title).toBe("Runtime generated title")
            })
            expect(state.taskReadRequests).toEqual([
                {
                    repoId: "repo-1",
                    taskId: "task-created",
                    hydrateSessionEvents: false,
                },
            ])
            expect(codeStore.runtimeProductSnapshot).toBeNull()
            expect(codeStore.repos.getRepo("repo-1")).toEqual(expect.objectContaining({ id: "repo-1", path: "/tmp/runtime-repo" }))
        } finally {
            refreshAfterCreation?.mockRestore()
            codeStore.disconnectAllStores()
            await runtime.close()
            restoreOpenADEAPI()
        }
    })

    it("refreshes clean managed Core task mutations through scoped task-list reads when snapshot projection is unavailable", async () => {
        const restoreOpenADEAPI = installCleanCoreRolloutState()
        const { client, runtime, state } = createRuntimeBackedClient({
            ...createBridgeState(),
            taskReadRequests: [],
            projectReadCount: 0,
            snapshotReadCount: 0,
            taskListReadCount: 0,
        })
        const productStore = new OpenADEProductStore(client)
        const refreshSnapshot = vi.spyOn(productStore, "refreshSnapshot").mockRejectedValue(new Error("snapshot unavailable"))
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => productStore,
            runtimeNotificationSource: runtime,
            legacyStoreConnectors: createInMemoryLegacyStoreConnectors(),
        })

        try {
            await codeStore.initializeStores()
            expect(codeStore.runtimeProductSnapshot).toBeNull()
            expect(codeStore.runtimeProductStoreStatus).toBe("ready")
            expect(refreshSnapshot).not.toHaveBeenCalled()

            await codeStore.loadRuntimeProductProjects()
            expect(codeStore.runtimeProductSnapshot).toBeNull()
            expect(codeStore.findProductRepoIdForTask("task-1")).toBe("repo-1")
            expect(codeStore.hasProductTaskModelSource("task-1")).toBe(true)
            expect(codeStore.getTaskPreviewsForRepo("repo-1")).toEqual([expect.objectContaining({ id: "task-1", title: "Runtime task" })])

            const projectReadsBeforeMutation = state.projectReadCount ?? 0
            const snapshotReadsBeforeMutation = state.snapshotReadCount ?? 0
            const taskListReadsBeforeMutation = state.taskListReadCount ?? 0
            state.taskReadRequests = []
            if (!state.task) throw new Error("Expected bridge task")
            state.task = {
                ...state.task,
                title: "Clean Core mutation title",
                updatedAt: "2026-05-31T00:02:00.000Z",
            }

            await codeStore.refreshProductStateAfterTaskMutation("task-1")

            expect(refreshSnapshot).not.toHaveBeenCalled()
            expect(state.snapshotReadCount ?? 0).toBe(snapshotReadsBeforeMutation)
            expect(state.projectReadCount ?? 0).toBe(projectReadsBeforeMutation)
            expect(state.taskListReadCount ?? 0).toBe(taskListReadsBeforeMutation + 1)
            expect(state.taskReadRequests).toEqual([{ repoId: "repo-1", taskId: "task-1", hydrateSessionEvents: false }])
            expect(codeStore.runtimeProductSnapshot).toBeNull()
            expect(codeStore.getTaskPreviewsForRepo("repo-1")).toEqual([
                expect.objectContaining({
                    id: "task-1",
                    title: "Clean Core mutation title",
                }),
            ])
            expect(codeStore.tasks.getTask("task-1")).toEqual(
                expect.objectContaining({
                    id: "task-1",
                    title: "Clean Core mutation title",
                })
            )
        } finally {
            refreshSnapshot.mockRestore()
            codeStore.disconnectAllStores()
            await runtime.close()
            restoreOpenADEAPI()
        }
    })

    it("refreshes direct clean managed Core task mutations without creating a task-list projection", async () => {
        const restoreOpenADEAPI = installCleanCoreRolloutState()
        const { client, runtime, state } = createRuntimeBackedClient({
            ...createBridgeState(),
            taskReadRequests: [],
            projectReadCount: 0,
            snapshotReadCount: 0,
            taskListReadCount: 0,
        })
        const productStore = new OpenADEProductStore(client)
        const refreshSnapshot = vi.spyOn(productStore, "refreshSnapshot").mockRejectedValue(new Error("snapshot unavailable"))
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: false,
            runtimeProductStoreFactory: () => productStore,
            runtimeNotificationSource: runtime,
            legacyStoreConnectors: createInMemoryLegacyStoreConnectors(),
        })

        try {
            await codeStore.loadRuntimeProductTaskForRoute("repo-1", "task-1")
            expect(codeStore.runtimeProductSnapshot).toBeNull()
            expect(state.projectReadCount ?? 0).toBe(0)
            expect(state.taskListReadCount ?? 0).toBe(0)

            const snapshotReadsBeforeMutation = state.snapshotReadCount ?? 0
            state.taskReadRequests = []
            if (!state.task) throw new Error("Expected bridge task")
            state.task = {
                ...state.task,
                title: "Direct Core mutation title",
                updatedAt: "2026-05-31T00:02:00.000Z",
            }

            await codeStore.refreshProductStateAfterTaskMutation("task-1")

            expect(refreshSnapshot).not.toHaveBeenCalled()
            expect(state.snapshotReadCount ?? 0).toBe(snapshotReadsBeforeMutation)
            expect(state.projectReadCount ?? 0).toBe(0)
            expect(state.taskListReadCount ?? 0).toBe(0)
            expect(state.taskReadRequests).toEqual([{ repoId: "repo-1", taskId: "task-1", hydrateSessionEvents: false }])
            expect(codeStore.tasks.getTask("task-1")).toEqual(
                expect.objectContaining({
                    id: "task-1",
                    title: "Direct Core mutation title",
                })
            )
        } finally {
            refreshSnapshot.mockRestore()
            codeStore.disconnectAllStores()
            await runtime.close()
            restoreOpenADEAPI()
        }
    })

    it("keeps unknown direct clean managed Core task mutations from repairing through broad projection reads", async () => {
        const restoreOpenADEAPI = installCleanCoreRolloutState()
        const { client, runtime, state } = createRuntimeBackedClient({
            ...createBridgeState(),
            taskReadRequests: [],
            projectReadCount: 0,
            snapshotReadCount: 0,
            taskListReadCount: 0,
        })
        const productStore = new OpenADEProductStore(client)
        const refreshSnapshot = vi.spyOn(productStore, "refreshSnapshot").mockRejectedValue(new Error("snapshot unavailable"))
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: false,
            runtimeProductStoreFactory: () => productStore,
            runtimeNotificationSource: runtime,
            legacyStoreConnectors: createInMemoryLegacyStoreConnectors(),
        })

        try {
            expect(codeStore.usesCoreOwnedProductRuntime()).toBe(true)
            expect(codeStore.runtimeProductSnapshot).toBeNull()

            await codeStore.refreshProductStateAfterTaskMutation("task-unknown")

            expect(refreshSnapshot).not.toHaveBeenCalled()
            expect(state.snapshotReadCount ?? 0).toBe(0)
            expect(state.projectReadCount ?? 0).toBe(0)
            expect(state.taskListReadCount ?? 0).toBe(0)
            expect(state.taskReadRequests).toEqual([])
            expect(codeStore.runtimeProductSnapshot).toBeNull()
        } finally {
            refreshSnapshot.mockRestore()
            codeStore.disconnectAllStores()
            await runtime.close()
            restoreOpenADEAPI()
        }
    })

    it("keeps direct clean managed Core notification fallback scoped when product notification handling fails", async () => {
        const restoreOpenADEAPI = installCleanCoreRolloutState()
        const { client, runtime, server, state } = createRuntimeBackedClient({
            ...createBridgeState(),
            taskReadRequests: [],
            projectReadCount: 0,
            snapshotReadCount: 0,
            taskListReadCount: 0,
        })
        const productStore = new OpenADEProductStore(client)
        const refreshSnapshot = vi.spyOn(productStore, "refreshSnapshot").mockRejectedValue(new Error("snapshot unavailable"))
        const handleNotification = vi.spyOn(productStore, "handleNotification").mockRejectedValueOnce(new Error("notification cache failed"))
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: false,
            runtimeProductStoreFactory: () => productStore,
            runtimeNotificationSource: runtime,
            legacyStoreConnectors: createInMemoryLegacyStoreConnectors(),
        })

        try {
            await codeStore.loadRuntimeProductTaskForRoute("repo-1", "task-1")
            expect(codeStore.runtimeProductSnapshot).toBeNull()
            expect(state.projectReadCount ?? 0).toBe(0)
            expect(state.taskListReadCount ?? 0).toBe(0)

            const snapshotReadsBeforeNotification = state.snapshotReadCount ?? 0
            state.taskReadRequests = []
            state.task = {
                ...requireStateTask(state, "task-1"),
                title: "Direct Core fallback notification title",
                updatedAt: "2026-05-31T00:02:45.000Z",
            }

            server.notify(OPENADE_NOTIFICATION.taskUpdated, {
                repoId: "repo-1",
                taskId: "task-1",
            })

            await waitForRuntimeDeferredTaskRefresh(() => {
                expect(codeStore.tasks.getTask("task-1")?.title).toBe("Direct Core fallback notification title")
            })

            expect(handleNotification).toHaveBeenCalled()
            expect(refreshSnapshot).not.toHaveBeenCalled()
            expect(state.snapshotReadCount ?? 0).toBe(snapshotReadsBeforeNotification)
            expect(state.projectReadCount ?? 0).toBe(0)
            expect(state.taskListReadCount ?? 0).toBe(0)
            expect(state.taskReadRequests).toEqual([{ repoId: "repo-1", taskId: "task-1", hydrateSessionEvents: false, eventLimit: 12 }])
            expect(codeStore.runtimeProductSnapshot).toBeNull()
        } finally {
            handleNotification.mockRestore()
            refreshSnapshot.mockRestore()
            codeStore.disconnectAllStores()
            await runtime.close()
            restoreOpenADEAPI()
        }
    })

    it("refreshes clean managed Core task mutations without probing task-list when task-list is unavailable", async () => {
        const restoreOpenADEAPI = installCleanCoreRolloutState()
        const { client, runtime, state } = createRuntimeBackedClient(
            {
                ...createBridgeState(),
                taskReadRequests: [],
                projectReadCount: 0,
                snapshotReadCount: 0,
                taskListReadCount: 0,
            },
            allOpenADEMethodPermissionsExcept([OPENADE_METHOD.taskList])
        )
        const productStore = new OpenADEProductStore(client)
        const refreshSnapshot = vi.spyOn(productStore, "refreshSnapshot").mockRejectedValue(new Error("snapshot unavailable"))
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => productStore,
            runtimeNotificationSource: runtime,
            legacyStoreConnectors: createInMemoryLegacyStoreConnectors(),
        })

        try {
            await codeStore.initializeStores()
            await codeStore.loadRuntimeProductProjects()
            expect(codeStore.canUseProductMethod(OPENADE_METHOD.taskList)).toBe(false)
            expect(codeStore.findProductRepoIdForTask("task-1")).toBe("repo-1")

            const projectReadsBeforeMutation = state.projectReadCount ?? 0
            const snapshotReadsBeforeMutation = state.snapshotReadCount ?? 0
            const taskListReadsBeforeMutation = state.taskListReadCount ?? 0
            state.taskReadRequests = []
            if (!state.task) throw new Error("Expected bridge task")
            state.task = {
                ...state.task,
                title: "Task-list denied mutation title",
                updatedAt: "2026-05-31T00:02:30.000Z",
            }

            await codeStore.refreshProductStateAfterTaskMutation("task-1")

            expect(refreshSnapshot).not.toHaveBeenCalled()
            expect(state.snapshotReadCount ?? 0).toBe(snapshotReadsBeforeMutation)
            expect(state.projectReadCount ?? 0).toBe(projectReadsBeforeMutation)
            expect(state.taskListReadCount ?? 0).toBe(taskListReadsBeforeMutation)
            expect(state.taskReadRequests).toEqual([{ repoId: "repo-1", taskId: "task-1", hydrateSessionEvents: false, eventLimit: 12 }])
            expect(codeStore.tasks.getTask("task-1")).toEqual(
                expect.objectContaining({
                    id: "task-1",
                    title: "Task-list denied mutation title",
                })
            )
        } finally {
            refreshSnapshot.mockRestore()
            codeStore.disconnectAllStores()
            await runtime.close()
            restoreOpenADEAPI()
        }
    })

    it("refreshes clean managed Core task creation repairs through scoped task-list reads", async () => {
        const restoreOpenADEAPI = installCleanCoreRolloutState()
        const { client, runtime, state } = createRuntimeBackedClient({
            ...createBridgeState(),
            taskReadRequests: [],
            projectReadCount: 0,
            snapshotReadCount: 0,
            taskListReadCount: 0,
        })
        const productStore = new OpenADEProductStore(client)
        const refreshSnapshot = vi.spyOn(productStore, "refreshSnapshot").mockRejectedValue(new Error("snapshot unavailable"))
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => productStore,
            runtimeNotificationSource: runtime,
            legacyStoreConnectors: createInMemoryLegacyStoreConnectors(),
        })

        try {
            await codeStore.initializeStores()
            await codeStore.loadRuntimeProductProjects()

            const projectReadsBeforeCreation = state.projectReadCount ?? 0
            const snapshotReadsBeforeCreation = state.snapshotReadCount ?? 0
            const taskListReadsBeforeCreation = state.taskListReadCount ?? 0
            state.taskReadRequests = []
            if (!state.task) throw new Error("Expected bridge task")
            state.task = {
                ...state.task,
                id: "task-created",
                slug: "task-created",
                title: "Clean Core created task",
                createdAt: "2026-05-31T00:04:00.000Z",
                updatedAt: "2026-05-31T00:04:00.000Z",
            }

            await codeStore.refreshProductStateAfterTaskCreation("repo-1", "task-created")

            expect(refreshSnapshot).not.toHaveBeenCalled()
            expect(state.snapshotReadCount ?? 0).toBe(snapshotReadsBeforeCreation)
            expect(state.projectReadCount ?? 0).toBe(projectReadsBeforeCreation)
            expect(state.taskListReadCount ?? 0).toBe(taskListReadsBeforeCreation + 1)
            expect(state.taskReadRequests).toEqual([{ repoId: "repo-1", taskId: "task-created", hydrateSessionEvents: false }])
            expect(codeStore.runtimeProductSnapshot).toBeNull()
            expect(codeStore.getTaskPreviewsForRepo("repo-1")).toEqual([
                expect.objectContaining({
                    id: "task-created",
                    title: "Clean Core created task",
                }),
            ])
            expect(codeStore.tasks.getTask("task-created")).toEqual(
                expect.objectContaining({
                    id: "task-created",
                    title: "Clean Core created task",
                })
            )
        } finally {
            refreshSnapshot.mockRestore()
            codeStore.disconnectAllStores()
            await runtime.close()
            restoreOpenADEAPI()
        }
    })

    it("refreshes repo-less clean managed Core preview notifications through scoped task lists when snapshot projection is unavailable", async () => {
        const restoreOpenADEAPI = installCleanCoreRolloutState()
        const { client, runtime, server, state } = createRuntimeBackedClient({
            ...createBridgeState(),
            taskReadRequests: [],
            projectReadCount: 0,
            taskListReadCount: 0,
            snapshotReadCount: 0,
        })
        const productStore = new OpenADEProductStore(client)
        const refreshSnapshot = vi.spyOn(productStore, "refreshSnapshot").mockRejectedValue(new Error("snapshot unavailable"))
        const legacyTaskRefresh = vi.fn()
        const legacyRepoRefresh = vi.fn()
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => productStore,
            runtimeNotificationSource: runtime,
            legacyStoreConnectors: createInMemoryLegacyStoreConnectors(legacyRepoRefresh),
        })
        vi.spyOn(codeStore, "refreshTaskStoreFromStorage").mockImplementation(async (taskId: string) => {
            legacyTaskRefresh(taskId)
        })
        vi.spyOn(codeStore, "refreshRepoStoreFromStorage").mockImplementation(async () => {
            legacyRepoRefresh()
        })

        try {
            await codeStore.initializeStores()
            expect(codeStore.runtimeProductSnapshot).toBeNull()
            expect(refreshSnapshot).not.toHaveBeenCalled()

            await codeStore.loadRuntimeProductProjects()
            expect(codeStore.getTaskPreviewsForRepo("repo-1")).toEqual([expect.objectContaining({ id: "task-1", title: "Runtime task" })])

            const projectReadsBeforeNotification = state.projectReadCount ?? 0
            const taskListReadsBeforeNotification = state.taskListReadCount ?? 0
            const snapshotReadsBeforeNotification = state.snapshotReadCount ?? 0
            state.taskReadRequests = []
            if (!state.task) throw new Error("Expected bridge task")
            state.task = {
                ...state.task,
                title: "Notification task-list title",
                updatedAt: "2026-05-31T00:03:00.000Z",
            }

            server.notify("openade/task/previewChanged", {
                taskId: "task-1",
            })

            await waitForRuntimeBridge(() => {
                expect(codeStore.getTaskPreviewsForRepo("repo-1")).toEqual([
                    expect.objectContaining({
                        id: "task-1",
                        title: "Notification task-list title",
                    }),
                ])
            })

            expect(refreshSnapshot).not.toHaveBeenCalled()
            expect(state.snapshotReadCount ?? 0).toBe(snapshotReadsBeforeNotification)
            expect(state.projectReadCount ?? 0).toBe(projectReadsBeforeNotification)
            expect(state.taskListReadCount ?? 0).toBe(taskListReadsBeforeNotification + 1)
            expect(state.taskReadRequests).toEqual([])
            expect(codeStore.runtimeProductSnapshot).toBeNull()
            expect(legacyTaskRefresh).not.toHaveBeenCalled()
            expect(legacyRepoRefresh).not.toHaveBeenCalled()
        } finally {
            refreshSnapshot.mockRestore()
            vi.mocked(codeStore.refreshTaskStoreFromStorage).mockRestore()
            vi.mocked(codeStore.refreshRepoStoreFromStorage).mockRestore()
            codeStore.disconnectAllStores()
            await runtime.close()
            restoreOpenADEAPI()
        }
    })

    it("syncs repo-less clean managed Core task updates into cached desktop task detail without projection reads", async () => {
        const restoreOpenADEAPI = installCleanCoreRolloutState()
        const { client, runtime, server, state } = createRuntimeBackedClient({
            ...createBridgeState(),
            taskReadRequests: [],
            projectReadCount: 0,
            taskListReadCount: 0,
            snapshotReadCount: 0,
        })
        const productStore = new OpenADEProductStore(client)
        const refreshSnapshot = vi.spyOn(productStore, "refreshSnapshot").mockRejectedValue(new Error("snapshot unavailable"))
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => productStore,
            runtimeNotificationSource: runtime,
            legacyStoreConnectors: createInMemoryLegacyStoreConnectors(),
        })

        try {
            await codeStore.initializeStores()
            await codeStore.loadRuntimeProductProjects()
            await codeStore.loadRuntimeProductTask("repo-1", "task-1")

            const projectReadsBeforeNotification = state.projectReadCount ?? 0
            const taskListReadsBeforeNotification = state.taskListReadCount ?? 0
            const snapshotReadsBeforeNotification = state.snapshotReadCount ?? 0
            state.taskReadRequests = []
            state.task = {
                ...requireStateTask(state, "task-1"),
                title: "Repo-less task detail update",
                updatedAt: "2026-05-31T00:04:00.000Z",
            }

            server.notify("openade/task/updated", {
                taskId: "task-1",
            })

            await waitForRuntimeDeferredTaskRefresh(() => {
                expect(codeStore.tasks.getTask("task-1")?.title).toBe("Repo-less task detail update")
            })

            expect(refreshSnapshot).not.toHaveBeenCalled()
            expect(state.snapshotReadCount ?? 0).toBe(snapshotReadsBeforeNotification)
            expect(state.projectReadCount ?? 0).toBe(projectReadsBeforeNotification)
            expect(state.taskListReadCount ?? 0).toBe(taskListReadsBeforeNotification)
            expect(state.taskReadRequests).toEqual([{ repoId: "repo-1", taskId: "task-1", hydrateSessionEvents: false, eventLimit: 12 }])
        } finally {
            refreshSnapshot.mockRestore()
            codeStore.disconnectAllStores()
            await runtime.close()
            restoreOpenADEAPI()
        }
    })

    it("resolves clean managed Core sidebar task copy paths without a snapshot-backed repo projection", async () => {
        const restoreOpenADEAPI = installCleanCoreRolloutState()
        const { client, runtime, state } = createRuntimeBackedClient({
            ...createBridgeState(),
            taskReadRequests: [],
            projectReadCount: 0,
            projectGitInfoReadCount: 0,
            snapshotReadCount: 0,
        })
        const productStore = new OpenADEProductStore(client)
        const refreshSnapshot = vi.spyOn(productStore, "refreshSnapshot").mockRejectedValue(new Error("snapshot unavailable"))
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => productStore,
            runtimeNotificationSource: runtime,
            legacyStoreConnectors: createInMemoryLegacyStoreConnectors(),
        })

        try {
            await codeStore.initializeStores()
            expect(codeStore.runtimeProductSnapshot).toBeNull()
            expect(codeStore.repos.getRepo("repo-1")).toEqual(expect.objectContaining({ id: "repo-1", path: "/tmp/runtime-repo" }))

            await expect(
                resolveTaskListCopyPath({
                    codeStore,
                    workspaceId: "repo-1",
                    selectedTaskId: "task-1",
                })
            ).resolves.toBe("/tmp/runtime-repo")

            expect(refreshSnapshot).not.toHaveBeenCalled()
            expect(state.snapshotReadCount ?? 0).toBe(0)
            expect(state.projectReadCount ?? 0).toBeLessThanOrEqual(1)
            expect(state.projectGitInfoReadCount).toBe(0)
            expect(state.taskReadRequests).toEqual([{ repoId: "repo-1", taskId: "task-1", hydrateSessionEvents: false, eventLimit: 12 }])
            expect(codeStore.runtimeProductSnapshot).toBeNull()
            expect(codeStore.tasks.getTask("task-1")).toEqual(expect.objectContaining({ id: "task-1", repoId: "repo-1" }))
        } finally {
            refreshSnapshot.mockRestore()
            codeStore.disconnectAllStores()
            await runtime.close()
            restoreOpenADEAPI()
        }
    })

    it("routes clean managed Core repo git reads through product APIs without a snapshot-backed repo projection", async () => {
        const restoreOpenADEAPI = installCleanCoreRolloutState()
        const { client, runtime, state } = createRuntimeBackedClient({
            ...createBridgeState(),
            projectGitInfoReadCount: 0,
            projectGitBranchesReadCount: 0,
            projectGitSummaryReadCount: 0,
            snapshotReadCount: 0,
        })
        const productStore = new OpenADEProductStore(client)
        const refreshSnapshot = vi.spyOn(productStore, "refreshSnapshot").mockRejectedValue(new Error("snapshot unavailable"))
        const rawGitInfoRead = vi.spyOn(gitApi, "isGitDirectory").mockRejectedValue(new Error("legacy git info should not be used"))
        const rawBranchRead = vi.spyOn(gitApi, "listBranches").mockRejectedValue(new Error("legacy branch read should not be used"))
        const rawSummaryRead = vi.spyOn(gitApi, "getGitSummary").mockRejectedValue(new Error("legacy summary read should not be used"))
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => productStore,
            runtimeNotificationSource: runtime,
            legacyStoreConnectors: createInMemoryLegacyStoreConnectors(),
        })

        try {
            await codeStore.initializeStores()
            expect(codeStore.runtimeProductSnapshot).toBeNull()
            expect(codeStore.repos.getRepo("repo-1")).toEqual(expect.objectContaining({ id: "repo-1", path: "/tmp/runtime-repo" }))

            await expect(codeStore.repos.getGitInfo("repo-1")).resolves.toMatchObject({
                repoRoot: "/tmp/runtime-repo",
                relativePath: "",
                mainBranch: "main",
                hasGhCli: false,
            })
            await expect(codeStore.repos.listBranches("repo-1", { includeRemote: true })).resolves.toMatchObject({
                defaultBranch: "main",
                branches: [expect.objectContaining({ name: "main", isDefault: true })],
            })
            await expect(codeStore.repos.getGitSummary("repo-1")).resolves.toMatchObject({
                branch: "main",
                headCommit: "abc123",
                hasChanges: false,
            })

            expect(refreshSnapshot).not.toHaveBeenCalled()
            expect(state.snapshotReadCount ?? 0).toBe(0)
            expect(state.projectGitInfoReadCount).toBe(1)
            expect(state.projectGitBranchesReadCount).toBe(1)
            expect(state.projectGitSummaryReadCount).toBe(1)
            expect(rawGitInfoRead).not.toHaveBeenCalled()
            expect(rawBranchRead).not.toHaveBeenCalled()
            expect(rawSummaryRead).not.toHaveBeenCalled()
        } finally {
            refreshSnapshot.mockRestore()
            rawGitInfoRead.mockRestore()
            rawBranchRead.mockRestore()
            rawSummaryRead.mockRestore()
            codeStore.disconnectAllStores()
            await runtime.close()
            restoreOpenADEAPI()
        }
    })

    it("syncs clean managed Core task deletion without a snapshot-backed repo projection", async () => {
        const restoreOpenADEAPI = installCleanCoreRolloutState()
        const { client, runtime, state } = createRuntimeBackedClient({
            ...createBridgeState(),
            taskReadRequests: [],
            projectReadCount: 0,
            snapshotReadCount: 0,
        })
        const productStore = new OpenADEProductStore(client)
        const refreshSnapshot = vi.spyOn(productStore, "refreshSnapshot").mockRejectedValue(new Error("snapshot unavailable"))
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => productStore,
            runtimeNotificationSource: runtime,
            legacyStoreConnectors: createInMemoryLegacyStoreConnectors(),
        })

        try {
            await codeStore.initializeStores()
            expect(codeStore.runtimeProductSnapshot).toBeNull()
            expect(codeStore.repos.getRepo("repo-1")).toEqual(expect.objectContaining({ id: "repo-1", path: "/tmp/runtime-repo" }))

            await expect(codeStore.loadRuntimeProductTask("repo-1", "task-1")).resolves.toMatchObject({ id: "task-1", repoId: "repo-1" })
            expect(codeStore.tasks.getTask("task-1")).toEqual(expect.objectContaining({ id: "task-1" }))
            const taskModel = codeStore.tasks.getTaskModel("task-1")
            if (!taskModel) throw new Error("Expected loaded Core task to create a TaskModel")
            const disposeTaskModel = vi.spyOn(taskModel, "dispose")
            codeStore.runtimes.applyOpenADETaskRuntimeState("task-1", {
                isRunning: true,
                runtimeIds: ["runtime-task-1"],
            })
            expect(codeStore.runtimes.isTaskRunning("task-1")).toBe(true)

            const taskReadsBeforeDeletion = [...(state.taskReadRequests ?? [])]
            const projectReadsBeforeDeletion = state.projectReadCount ?? 0
            const snapshotReadsBeforeDeletion = state.snapshotReadCount ?? 0

            await codeStore.deleteProductTask({
                repoId: "repo-1",
                taskId: "task-1",
                options: {
                    deleteSnapshots: false,
                    deleteImages: false,
                    deleteSessions: false,
                    deleteWorktrees: false,
                },
            })

            expect(codeStore.tasks.getTask("task-1")).toBeNull()
            expect(codeStore.tasks.getTaskModel("task-1")).toBeNull()
            expect(codeStore.runtimes.isTaskRunning("task-1")).toBe(false)
            expect(disposeTaskModel).toHaveBeenCalledTimes(1)
            expect(codeStore.getCachedProductTask("task-1")).toBeNull()
            expect(productStore.getCachedTask("repo-1", "task-1")).toBeNull()
            expect(codeStore.runtimeProductSnapshot).toBeNull()
            expect(state.task).toBeNull()
            expect(state.taskReadRequests).toEqual(taskReadsBeforeDeletion)
            expect(state.projectReadCount ?? 0).toBe(projectReadsBeforeDeletion)
            expect(state.snapshotReadCount ?? 0).toBe(snapshotReadsBeforeDeletion)
            expect(refreshSnapshot).not.toHaveBeenCalled()
        } finally {
            refreshSnapshot.mockRestore()
            codeStore.disconnectAllStores()
            await runtime.close()
            restoreOpenADEAPI()
        }
    })

    it("syncs clean managed Core repo deletion without a snapshot-backed repo projection", async () => {
        const restoreOpenADEAPI = installCleanCoreRolloutState()
        const { client, runtime, state } = createRuntimeBackedClient({
            ...createBridgeState(),
            taskReadRequests: [],
            projectReadCount: 0,
            snapshotReadCount: 0,
        })
        const productStore = new OpenADEProductStore(client)
        const refreshSnapshot = vi.spyOn(productStore, "refreshSnapshot").mockRejectedValue(new Error("snapshot unavailable"))
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => productStore,
            runtimeNotificationSource: runtime,
            legacyStoreConnectors: createInMemoryLegacyStoreConnectors(),
        })

        try {
            await codeStore.initializeStores()
            expect(codeStore.runtimeProductSnapshot).toBeNull()
            expect(codeStore.repos.getRepo("repo-1")).toEqual(expect.objectContaining({ id: "repo-1", path: "/tmp/runtime-repo" }))

            await expect(codeStore.loadRuntimeProductTask("repo-1", "task-1")).resolves.toMatchObject({ id: "task-1", repoId: "repo-1" })
            expect(codeStore.tasks.getTask("task-1")).toEqual(expect.objectContaining({ id: "task-1" }))
            expect(codeStore.tasks.getTaskModel("task-1")).not.toBeNull()

            const taskReadsBeforeDeletion = [...(state.taskReadRequests ?? [])]
            const projectReadsBeforeDeletion = state.projectReadCount ?? 0
            const snapshotReadsBeforeDeletion = state.snapshotReadCount ?? 0

            await expect(codeStore.repos.deleteRepo("repo-1")).resolves.toBe(true)

            expect(codeStore.runtimeProductSnapshot).toBeNull()
            expect(codeStore.repos.getRepo("repo-1")).toBeUndefined()
            expect(codeStore.tasks.getTask("task-1")).toBeNull()
            expect(codeStore.tasks.getTaskModel("task-1")).toBeNull()
            expect(codeStore.getCachedProductTask("task-1")).toBeNull()
            expect(productStore.getCachedTask("repo-1", "task-1")).toBeNull()
            expect(codeStore.getTaskPreviewsForRepo("repo-1")).toEqual([])
            expect(state.project).toBeNull()
            expect(state.task).toBeNull()
            expect(state.taskReadRequests).toEqual(taskReadsBeforeDeletion)
            expect(state.projectReadCount ?? 0).toBe(projectReadsBeforeDeletion)
            expect(state.snapshotReadCount ?? 0).toBe(snapshotReadsBeforeDeletion)
            expect(refreshSnapshot).not.toHaveBeenCalled()
        } finally {
            refreshSnapshot.mockRestore()
            codeStore.disconnectAllStores()
            await runtime.close()
            restoreOpenADEAPI()
        }
    })

    it("keeps clean managed Core file and search managers from falling back to raw files when product context is unresolved", async () => {
        const restoreOpenADEAPI = installCleanCoreRolloutState()
        const { client, runtime } = createRuntimeBackedClient(createBridgeState())
        const productStore = new OpenADEProductStore(client)
        const refreshSnapshot = vi.spyOn(productStore, "refreshSnapshot").mockRejectedValue(new Error("snapshot unavailable"))
        const legacyDescribePath = vi.spyOn(filesApi, "describePath").mockRejectedValue(new Error("legacy describe should not be used"))
        const legacyContentSearch = vi.spyOn(filesApi, "contentSearch").mockRejectedValue(new Error("legacy content search should not be used"))
        const legacyFuzzySearch = vi.spyOn(filesApi, "fuzzySearch").mockRejectedValue(new Error("legacy fuzzy search should not be used"))
        const runtimeFuzzySearch = vi.spyOn(productStore, "fuzzySearchProjectFiles")
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => productStore,
            runtimeNotificationSource: runtime,
            legacyStoreConnectors: createInMemoryLegacyStoreConnectors(),
        })

        try {
            await codeStore.initializeStores()
            await codeStore.loadRuntimeProductTask("repo-1", "task-1")

            const taskModel = codeStore.tasks.getTaskModel("task-1")
            if (!taskModel) throw new Error("Expected runtime task model")
            await expect(taskModel.ensureTaskWorkingDirHint()).resolves.toBe("/tmp/runtime-repo")
            localStorage.setItem(
                "code:fileUsageStats",
                JSON.stringify({
                    "repo-1": {
                        "src/runtime-search.ts": { count: 2, lastUsed: Date.parse(now) },
                    },
                })
            )

            const wrongDir = "/tmp/not-the-runtime-repo"
            taskModel.fileBrowser.setWorkingDir(wrongDir)
            taskModel.contentSearch.setWorkingDir(wrongDir)
            const editorManager = codeStore.smartEditors.getManager("task-task-1", "repo-1")
            const validMentionSearch = await editorManager.searchFileMentions("/tmp/runtime-repo", "runtime", 20)
            const invalidMentionSearch = await editorManager.searchFileMentions(wrongDir, "runtime", 20)
            await editorManager.validateFiles(wrongDir)

            await taskModel.fileBrowser.openPathReference("runtime-search.ts")
            taskModel.contentSearch.setQuery("needle")

            await new Promise((resolve) => setTimeout(resolve, 150))
            await vi.waitFor(() => {
                expect(taskModel.contentSearch.loading).toBe(false)
            })

            expect(taskModel.fileBrowser.activeFileData).toBeNull()
            expect(taskModel.contentSearch.contentResults).toEqual([])
            expect(taskModel.contentSearch.previewData).toBeNull()
            expect(validMentionSearch.results).toEqual(["src/runtime-search.ts"])
            expect(invalidMentionSearch).toEqual({ results: [], treeMatch: null })
            expect(editorManager.canSearchFileMentions(wrongDir)).toBe(false)
            expect(editorManager.favorites.map((item) => item.path)).toEqual(["src/runtime-search.ts"])
            expect(runtimeFuzzySearch).toHaveBeenCalledWith({
                repoId: "repo-1",
                taskId: "task-1",
                query: "runtime",
                matchDirs: false,
                limit: 20,
                includeHidden: true,
            })
            expect(legacyDescribePath).not.toHaveBeenCalled()
            expect(legacyContentSearch).not.toHaveBeenCalled()
            expect(legacyFuzzySearch).not.toHaveBeenCalled()
            expect(refreshSnapshot).not.toHaveBeenCalled()
        } finally {
            localStorage.removeItem("code:fileUsageStats")
            refreshSnapshot.mockRestore()
            runtimeFuzzySearch.mockRestore()
            legacyDescribePath.mockRestore()
            legacyContentSearch.mockRestore()
            legacyFuzzySearch.mockRestore()
            codeStore.disconnectAllStores()
            await runtime.close()
            restoreOpenADEAPI()
        }
    })

    it("projects runtime MCP settings into the classic manager and persists mutations", async () => {
        const { client, runtime, state } = createRuntimeBackedClient({
            ...createBridgeState(),
            mcpServers: [
                {
                    id: "mcp-http-1",
                    name: "Runtime HTTP",
                    transportType: "http",
                    enabled: true,
                    url: "https://mcp.example.test/mcp",
                    headers: { "X-Test": "runtime" },
                    oauthTokens: { accessToken: "token-1", tokenType: "Bearer" },
                    healthStatus: "healthy",
                    createdAt: now,
                    updatedAt: now,
                },
                {
                    id: "mcp-stdio-1",
                    name: "Runtime Stdio",
                    transportType: "stdio",
                    enabled: true,
                    command: "node",
                    args: ["server.js"],
                    envVars: { NODE_ENV: "test" },
                    cwd: "/tmp/runtime-mcp",
                    healthStatus: "unknown",
                    createdAt: now,
                    updatedAt: now,
                },
            ],
        })
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })
        runInAction(() => {
            codeStore.mcpServerStore = createMcpServerStore(new Y.Doc())
        })

        try {
            await codeStore.initializeRuntimeProductStore()
            await codeStore.mcpServers.initializeProductSettingsProjection()

            expect(codeStore.mcpServers.servers).toEqual([
                expect.objectContaining({
                    id: "mcp-http-1",
                    name: "Runtime HTTP",
                    transportType: "http",
                }),
                expect.objectContaining({ id: "mcp-stdio-1", cwd: "/tmp/runtime-mcp" }),
            ])

            await codeStore.mcpServers.updateServer("mcp-stdio-1", {
                enabled: false,
                cwd: "/tmp/updated-mcp",
            })
            expect((state.mcpServers ?? []).find((server) => server.id === "mcp-stdio-1")).toMatchObject({
                enabled: false,
                cwd: "/tmp/updated-mcp",
            })

            await codeStore.mcpServers.deleteServer("mcp-http-1")
            expect((state.mcpServers ?? []).map((server) => server.id)).toEqual(["mcp-stdio-1"])
        } finally {
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("imports legacy MCP rows when runtime settings are empty", async () => {
        const { client, runtime, state } = createRuntimeBackedClient()
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })
        const legacyMcpStore = createMcpServerStore(new Y.Doc())
        legacyMcpStore.servers.push({
            id: "legacy-mcp-1",
            name: "Legacy MCP",
            transportType: "stdio",
            enabled: true,
            command: "node",
            args: ["legacy.js"],
            envVars: { LEGACY: "1" },
            cwd: "/tmp/legacy-mcp",
            healthStatus: "unknown",
            createdAt: now,
            updatedAt: now,
        })
        runInAction(() => {
            codeStore.mcpServerStore = legacyMcpStore
        })

        try {
            await codeStore.initializeRuntimeProductStore()
            await codeStore.mcpServers.initializeProductSettingsProjection()

            expect(state.mcpServers).toEqual([expect.objectContaining({ id: "legacy-mcp-1", cwd: "/tmp/legacy-mcp" })])
            expect(codeStore.mcpServers.servers).toEqual([expect.objectContaining({ id: "legacy-mcp-1", cwd: "/tmp/legacy-mcp" })])
        } finally {
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("routes legacy resource imports through the runtime product API and refreshes cached snapshot state", async () => {
        const { client, runtime, state } = createRuntimeBackedClient()
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })

        try {
            await codeStore.initializeRuntimeProductStore()
            const initialSnapshotReads = state.snapshotReadCount ?? 0
            const legacyTaskRefresh = vi.spyOn(codeStore, "refreshTaskStoreFromStorage")
            const legacyRepoRefresh = vi.spyOn(codeStore, "refreshRepoStoreFromStorage")

            const result = await importCoreLegacyResourcesFromSelection({
                store: codeStore,
                selectDataDir: async () => "/tmp/legacy-openade-data",
                importSessions: true,
            })

            if (!result) throw new Error("expected selected legacy resource import to run")
            expect(state.legacyImportRequests).toHaveLength(1)
            expect(state.legacyImportRequests?.[0]).toMatchObject({
                dataDir: "/tmp/legacy-openade-data",
                importSessions: true,
            })
            expect(state.legacyImportRequests?.[0]?.clientRequestId).toEqual(expect.any(String))
            expect(result.images?.importedImages).toBe(1)
            expect(result.sessions?.importedSessions).toBe(1)
            expect(result.skipped).toEqual([{ kind: "snapshots", code: "source_missing" }])
            expect(state.snapshotReadCount ?? 0).toBeGreaterThan(initialSnapshotReads)
            expect(legacyTaskRefresh).not.toHaveBeenCalled()
            expect(legacyRepoRefresh).not.toHaveBeenCalled()

            legacyTaskRefresh.mockRestore()
            legacyRepoRefresh.mockRestore()
        } finally {
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("bootstraps the Core product store for legacy resource imports before normal runtime initialization", async () => {
        const { client, runtime, state } = createRuntimeBackedClient()
        const legacyImport = vi.spyOn(localOpenADEClient, "importLegacyResources").mockRejectedValue(new Error("legacy import should not be used"))
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })

        try {
            expect(codeStore.shouldUseRuntimeProductAPI()).toBe(false)
            expect(codeStore.runtimeProductStoreStatus).toBe("disabled")

            const result = await codeStore.importProductLegacyResources({
                dataDir: "/tmp/legacy-openade-data",
                importSessions: true,
            })

            expect(legacyImport).not.toHaveBeenCalled()
            expect(state.legacyImportRequests).toHaveLength(1)
            expect(state.legacyImportRequests?.[0]).toMatchObject({
                dataDir: "/tmp/legacy-openade-data",
                importSessions: true,
            })
            expect(result.images?.importedImages).toBe(1)
            expect(result.sessions?.importedSessions).toBe(1)
            expect(codeStore.runtimeProductStoreStatus).toBe("ready")
            expect(codeStore.runtimeProductStoreError).toBeNull()
            expect(codeStore.shouldUseRuntimeProductAPI()).toBe(true)
            expect(codeStore.repos.getRepo("repo-1")).toEqual(expect.objectContaining({ id: "repo-1", name: "Runtime Repo" }))
            expect(state.snapshotReadCount ?? 0).toBeGreaterThan(0)
        } finally {
            legacyImport.mockRestore()
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("imports legacy resources through a migration-only Core endpoint without selecting Core for normal product state", async () => {
        const { client, runtime, state } = createRuntimeBackedClient()
        const restoreOpenADEAPI = installCoreMigrationRuntimeEndpoint({
            url: "ws://127.0.0.1:37376/v1/runtime",
            token: "migration-token",
        })
        let migrationEndpointSeen: OpenADECoreRuntimeEndpoint | null = null
        const legacyImport = vi.spyOn(localOpenADEClient, "importLegacyResources").mockRejectedValue(new Error("legacy import should not be used"))
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            coreMigrationProductStoreFactory: (endpoint) => {
                migrationEndpointSeen = endpoint
                return new OpenADEProductStore(client)
            },
        })

        try {
            expect(codeStore.shouldUseRuntimeProductAPI()).toBe(false)
            expect(codeStore.runtimeProductStoreStatus).toBe("disabled")

            const result = await codeStore.importProductLegacyResources({
                dataDir: "/tmp/legacy-openade-data",
                importSessions: true,
            })

            expect(migrationEndpointSeen).toEqual({
                url: "ws://127.0.0.1:37376/v1/runtime",
                token: "migration-token",
            })
            expect(legacyImport).not.toHaveBeenCalled()
            expect(state.legacyImportRequests).toHaveLength(1)
            expect(state.legacyImportRequests?.[0]).toMatchObject({
                dataDir: "/tmp/legacy-openade-data",
                importSessions: true,
            })
            expect(result.images?.importedImages).toBe(1)
            expect(result.sessions?.importedSessions).toBe(1)
            expect(codeStore.runtimeProductStoreStatus).toBe("disabled")
            expect(codeStore.runtimeProductStoreError).toBeNull()
            expect(codeStore.runtimeProductSnapshot).toBeNull()
            expect(codeStore.shouldUseRuntimeProductAPI()).toBe(false)
        } finally {
            legacyImport.mockRestore()
            restoreOpenADEAPI()
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("hydrates a desktop runtime-backed snapshot and task through a real local runtime client", async () => {
        const { client, runtime } = createRuntimeBackedClient()
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })

        try {
            await codeStore.initializeRuntimeProductStore()

            expect(codeStore.runtimeProductStoreStatus).toBe("ready")
            expect(codeStore.runtimeProductStoreError).toBeNull()
            expect(codeStore.runtimeProductSnapshot?.server.hostName).toBe("bridge-test-host")
            expect(codeStore.runtimeProductSnapshot?.repos[0]?.tasks[0]?.title).toBe("Runtime task")
            expect(codeStore.repos.repos).toEqual([
                expect.objectContaining({
                    id: "repo-1",
                    name: "Runtime Repo",
                    path: "/tmp/runtime-repo",
                }),
            ])
            expect(codeStore.getTaskPreviewsForRepo("repo-1")).toEqual([
                expect.objectContaining({
                    id: "task-1",
                    title: "Runtime task",
                }),
            ])

            await expect(codeStore.getRuntimeProductTask("repo-1", "task-1")).resolves.toMatchObject({
                id: "task-1",
                title: "Runtime task",
                comments: [{ id: "comment-1" }],
            })

            await expect(codeStore.loadRuntimeProductTask("repo-1", "task-1")).resolves.toMatchObject({
                id: "task-1",
                title: "Runtime task",
                events: [{ id: "event-1" }],
                comments: [{ id: "comment-1" }],
            })
            expect(codeStore.tasks.getTask("task-1")).toMatchObject({
                id: "task-1",
                createdBy: { id: "user-1", email: "user@example.com" },
                events: [{ id: "event-1", type: "action" }],
                comments: [{ source: { type: "llm_output", eventId: "event-1" } }],
            })
            const taskModel = codeStore.tasks.getTaskModel("task-1")
            expect(taskModel?.exists).toBe(true)
            expect(taskModel?.title).toBe("Runtime task")
            expect(taskModel?.events.map((event) => event.id)).toEqual(["event-1"])
        } finally {
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("coalesces duplicate runtime task reads while preserving explicit full-history hydration", async () => {
        const { client, runtime, state } = createRuntimeBackedClient({
            ...createBridgeState(),
            taskReadRequests: [],
        })
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })

        try {
            await codeStore.initializeRuntimeProductStore()

            state.taskReadRequests = []
            const [first, second, third] = await Promise.all([
                codeStore.loadRuntimeProductTask("repo-1", "task-1"),
                codeStore.loadRuntimeProductTask("repo-1", "task-1"),
                codeStore.getRuntimeProductTask("repo-1", "task-1"),
            ])

            expect(first?.id).toBe("task-1")
            expect(second?.id).toBe("task-1")
            expect(third?.id).toBe("task-1")
            expect(state.taskReadRequests).toEqual([{ repoId: "repo-1", taskId: "task-1", hydrateSessionEvents: false }])

            state.taskReadRequests = []
            await expect(
                codeStore.loadRuntimeProductTask("repo-1", "task-1", {
                    hydrateSessionEvents: false,
                })
            ).resolves.toMatchObject({ id: "task-1" })
            expect(state.taskReadRequests).toEqual([])

            await expect(
                codeStore.loadRuntimeProductTask("repo-1", "task-1", {
                    hydrateSessionEvents: true,
                })
            ).resolves.toMatchObject({ id: "task-1" })
            expect(state.taskReadRequests).toEqual([{ repoId: "repo-1", taskId: "task-1", hydrateSessionEvents: true }])

            state.taskReadRequests = []
            await expect(
                codeStore.loadRuntimeProductTask("repo-1", "task-1", {
                    hydrateSessionEvents: false,
                })
            ).resolves.toMatchObject({ id: "task-1" })
            expect(state.taskReadRequests).toEqual([{ repoId: "repo-1", taskId: "task-1", hydrateSessionEvents: false }])
        } finally {
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("uses a smaller bounded route task read without seeding the broad lightweight cache", async () => {
        const { client, runtime, server, state } = createRuntimeBackedClient({
            ...createBridgeState(),
            task: {
                ...cloneTask(task),
                runtimeState: {
                    isRunning: true,
                    runtimeIds: ["runtime-route-task"],
                    updatedAt: now,
                },
            },
            taskReadRequests: [],
        })
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })

        try {
            await codeStore.initializeRuntimeProductStore()

            state.taskReadRequests = []
            await expect(codeStore.loadRuntimeProductTaskForRoute("repo-1", "task-1")).resolves.toMatchObject({ id: "task-1" })
            expect(state.taskReadRequests).toEqual([{ repoId: "repo-1", taskId: "task-1", hydrateSessionEvents: false, eventLimit: 12 }])
            expect(codeStore.runtimes.isTaskRunning("task-1")).toBe(true)

            state.taskReadRequests = []
            await expect(codeStore.loadRuntimeProductTaskForRoute("repo-1", "task-1")).resolves.toMatchObject({ id: "task-1" })
            expect(state.taskReadRequests).toEqual([])

            state.taskReadRequests = []
            await codeStore.tasks.markTaskViewed("task-1")
            await waitForRuntimeNotificationsToSettle()
            await expect(codeStore.loadRuntimeProductTaskForRoute("repo-1", "task-1")).resolves.toMatchObject({ id: "task-1" })
            expect(state.taskReadRequests).toEqual([])

            state.taskReadRequests = []
            state.task = {
                ...requireStateTask(state, "task-1"),
                title: "External route invalidation",
                updatedAt: "2026-05-31T00:10:00.000Z",
            }
            server.notify(OPENADE_NOTIFICATION.taskUpdated, { repoId: "repo-1", taskId: "task-1" })
            await waitForRuntimeNotificationsToSettle()
            await expect(codeStore.loadRuntimeProductTaskForRoute("repo-1", "task-1")).resolves.toMatchObject({
                id: "task-1",
                title: "External route invalidation",
            })
            expect(state.taskReadRequests).toEqual([{ repoId: "repo-1", taskId: "task-1", hydrateSessionEvents: false, eventLimit: 12 }])

            state.taskReadRequests = []
            await expect(codeStore.loadRuntimeProductTask("repo-1", "task-1")).resolves.toMatchObject({ id: "task-1" })
            expect(state.taskReadRequests).toEqual([{ repoId: "repo-1", taskId: "task-1", hydrateSessionEvents: false }])
        } finally {
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("scopes route task-read in-flight checks by repo, task, and read options", async () => {
        const taskReadGate = createDeferred<void>()
        const { client, runtime, state } = createRuntimeBackedClient({
            ...createBridgeState(),
            taskReadRequests: [],
            taskReadGate: taskReadGate.promise,
        })
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })

        try {
            await codeStore.initializeRuntimeProductStore()

            const routeRead = codeStore.loadRuntimeProductTaskForRoute("repo-1", "task-1")
            await vi.waitFor(() => {
                expect(state.taskReadRequests).toEqual([{ repoId: "repo-1", taskId: "task-1", hydrateSessionEvents: false, eventLimit: 12 }])
            })

            expect(codeStore.hasProductTaskReadInFlight("repo-1", "task-1")).toBe(true)
            expect(codeStore.hasProductTaskReadInFlight("repo-2", "task-1")).toBe(false)
            expect(codeStore.hasProductTaskReadInFlight("repo-1", "task-1", { hydrateSessionEvents: false })).toBe(false)

            taskReadGate.resolve(undefined)
            await expect(routeRead).resolves.toMatchObject({ id: "task-1" })
            expect(codeStore.hasProductTaskReadInFlight("repo-1", "task-1")).toBe(false)
        } finally {
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("clears stale route task-read problems when later Core task refreshes succeed", async () => {
        const { client, runtime, server, state } = createRuntimeBackedClient({
            ...createBridgeState(),
            task: null,
            taskReadRequests: [],
        })
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })

        try {
            await codeStore.initializeRuntimeProductStore()

            await expect(codeStore.loadRuntimeProductTaskForRoute("repo-1", "task-1")).rejects.toThrow()
            expect(codeStore.hasRuntimeProductRouteTaskReadMiss("repo-1", "task-1") || codeStore.getRuntimeProductRouteTaskReadError("repo-1", "task-1") !== null).toBe(
                true
            )

            state.task = cloneTask(task)
            state.taskReadRequests = []
            await expect(codeStore.loadRuntimeProductTask("repo-1", "task-1")).resolves.toMatchObject({ id: "task-1" })

            expect(state.taskReadRequests).toEqual([{ repoId: "repo-1", taskId: "task-1", hydrateSessionEvents: false }])
            expect(codeStore.hasRuntimeProductRouteTaskReadMiss("repo-1", "task-1")).toBe(false)
            expect(codeStore.getRuntimeProductRouteTaskReadError("repo-1", "task-1")).toBeNull()

            state.task = null
            await expect(codeStore.loadRuntimeProductTaskForRoute("repo-1", "task-1")).rejects.toThrow()
            expect(codeStore.hasRuntimeProductRouteTaskReadMiss("repo-1", "task-1") || codeStore.getRuntimeProductRouteTaskReadError("repo-1", "task-1") !== null).toBe(
                true
            )

            state.task = {
                ...cloneTask(task),
                title: "Deferred refresh repaired task",
                updatedAt: "2026-05-31T00:09:00.000Z",
            }
            state.taskReadRequests = []
            server.notify(OPENADE_NOTIFICATION.taskUpdated, { repoId: "repo-1", taskId: "task-1" })

            await waitForRuntimeDeferredTaskRefresh(() => {
                expect(codeStore.tasks.getTask("task-1")?.title).toBe("Deferred refresh repaired task")
            })
            expect(state.taskReadRequests).toEqual([{ repoId: "repo-1", taskId: "task-1", hydrateSessionEvents: false, eventLimit: 12 }])
            expect(codeStore.hasRuntimeProductRouteTaskReadMiss("repo-1", "task-1")).toBe(false)
            expect(codeStore.getRuntimeProductRouteTaskReadError("repo-1", "task-1")).toBeNull()
        } finally {
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("attaches clean managed Core for generic task reads without initializing project projections first", async () => {
        const restoreOpenADEAPI = installCleanCoreRolloutState()
        const { client, runtime, state } = createRuntimeBackedClient({
            ...createBridgeState(),
            taskReadRequests: [],
            projectReadCount: 0,
            snapshotReadCount: 0,
        })
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: false,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })

        try {
            expect(codeStore.usesCoreOwnedProductRuntime()).toBe(true)
            expect(codeStore.shouldUseRuntimeProductAPI()).toBe(false)

            await expect(codeStore.loadProductTaskForRead("repo-1", "task-1")).resolves.toMatchObject({
                id: "task-1",
                title: "Runtime task",
            })

            expect(codeStore.shouldUseRuntimeProductAPI()).toBe(true)
            expect(state.taskReadRequests).toEqual([{ repoId: "repo-1", taskId: "task-1", hydrateSessionEvents: false }])
            expect(state.snapshotReadCount ?? 0).toBe(0)
            expect(state.projectReadCount ?? 0).toBe(0)
        } finally {
            codeStore.disconnectAllStores()
            await runtime.close()
            restoreOpenADEAPI()
        }
    })

    it("attaches clean managed Core for direct product helper reads without app-shell initialization", async () => {
        const restoreOpenADEAPI = installCleanCoreRolloutState()
        const { client, runtime, state } = createRuntimeBackedClient({
            ...createBridgeState(),
            projectReadCount: 0,
            snapshotReadCount: 0,
        })
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: false,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })

        try {
            expect(codeStore.usesCoreOwnedProductRuntime()).toBe(true)
            expect(codeStore.shouldUseRuntimeProductAPI()).toBe(false)

            await expect(
                codeStore.readProductProjectFile({
                    repoId: "repo-1",
                    taskId: "task-1",
                    path: runtimeSearchFixture.path,
                    maxBytes: 1024,
                })
            ).resolves.toMatchObject({
                repoId: "repo-1",
                path: runtimeSearchFixture.path,
                content: runtimeSearchFixture.content,
            })

            expect(codeStore.shouldUseRuntimeProductAPI()).toBe(true)
            expect(state.snapshotReadCount ?? 0).toBe(0)
            expect(state.projectReadCount ?? 0).toBeLessThanOrEqual(1)
        } finally {
            codeStore.disconnectAllStores()
            await runtime.close()
            restoreOpenADEAPI()
        }
    })

    it("fails closed before cached task detail or runtime reads when task read is not advertised", async () => {
        const { client, runtime, state } = createRuntimeBackedClient(
            {
                ...createBridgeState(),
                taskReadRequests: [],
            },
            ["initialize", OPENADE_METHOD.snapshotRead]
        )
        const runtimeRequest = vi.spyOn(runtime, "requestWithOptions")
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })

        try {
            await codeStore.initializeRuntimeProductStore()
            expect(codeStore.canUseProductMethod(OPENADE_METHOD.taskRead)).toBe(false)
            expect(codeStore.getTaskPreviewsForRepo("repo-1")).toEqual([expect.objectContaining({ id: "task-1" })])
            runtimeRequest.mockClear()

            await expect(codeStore.getRuntimeProductTask("repo-1", "task-1")).resolves.toBeNull()
            await expect(codeStore.loadRuntimeProductTask("repo-1", "task-1")).resolves.toBeNull()
            await expect(codeStore.loadProductTaskForRead("repo-1", "task-1")).resolves.toBeNull()

            expect(codeStore.tasks.getTask("task-1")).toBeNull()
            expect(codeStore.tasks.getTaskModel("task-1")).toBeNull()
            expect(state.taskReadRequests).toEqual([])
            expect(runtimeRequest).not.toHaveBeenCalled()
        } finally {
            runtimeRequest.mockRestore()
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("does not touch legacy Yjs connections from runtime-backed explicit repo/task refresh helpers", async () => {
        const { client, runtime, state } = createRuntimeBackedClient({
            ...createBridgeState(),
            taskReadRequests: [],
        })
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })
        const legacyRepoRefresh = vi.fn(async () => true)
        const legacyTaskRefresh = vi.fn(async () => true)
        const legacyRepoConnection = {
            store: createRepoStore(new Y.Doc()),
            sync: vi.fn(async () => undefined),
            refresh: legacyRepoRefresh,
            disconnect: vi.fn(),
        }
        const legacyTaskConnection = {
            store: {},
            sync: async () => undefined,
            refresh: legacyTaskRefresh,
            disconnect: vi.fn(),
        }

        try {
            await codeStore.initializeRuntimeProductStore()
            await codeStore.loadRuntimeProductTask("repo-1", "task-1")
            ;(
                codeStore as unknown as {
                    repoStoreConnection: typeof legacyRepoConnection
                }
            ).repoStoreConnection = legacyRepoConnection
            ;(
                codeStore as unknown as {
                    taskStoreConnections: Map<string, typeof legacyTaskConnection>
                }
            ).taskStoreConnections = new Map([["task-1", legacyTaskConnection]])

            const initialSnapshotReads = state.snapshotReadCount ?? 0
            const initialProjectReads = state.projectReadCount ?? 0
            state.taskReadRequests = []

            await codeStore.refreshRepoStoreFromStorage()
            expect(state.snapshotReadCount ?? 0).toBe(initialSnapshotReads)
            expect(state.projectReadCount ?? 0).toBe(initialProjectReads)

            await codeStore.refreshTaskStoreFromStorage("task-1")
            await codeStore.syncRepoStore()
            await codeStore.reloadRepoStoreFromStorage()

            expect(legacyRepoRefresh).not.toHaveBeenCalled()
            expect(legacyRepoConnection.sync).not.toHaveBeenCalled()
            expect(legacyRepoConnection.disconnect).not.toHaveBeenCalled()
            expect(legacyTaskRefresh).not.toHaveBeenCalled()
            expect(state.snapshotReadCount ?? 0).toBe(initialSnapshotReads)
            expect(state.projectReadCount ?? 0).toBeGreaterThan(initialProjectReads)
            expect(state.taskReadRequests).toEqual([{ repoId: "repo-1", taskId: "task-1", hydrateSessionEvents: false, eventLimit: 12 }])
        } finally {
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("keeps route-owned runtime task refreshes off legacy Yjs before product projection initializes", async () => {
        const { client, runtime, state } = createRuntimeBackedClient({
            ...createBridgeState(),
            taskReadRequests: [],
        })
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })
        const legacyRepoRefresh = vi.fn(async () => true)
        const legacyTaskRefresh = vi.fn(async () => true)
        const legacyRepoConnection = {
            store: createRepoStore(new Y.Doc()),
            sync: vi.fn(async () => undefined),
            refresh: legacyRepoRefresh,
            disconnect: vi.fn(),
        }
        const legacyTaskConnection = {
            store: {},
            sync: async () => undefined,
            refresh: legacyTaskRefresh,
            disconnect: vi.fn(),
        }

        try {
            await codeStore.loadRuntimeProductTaskForRoute("repo-1", "task-1")
            expect(codeStore.shouldUseRuntimeProductAPI()).toBe(false)
            expect(codeStore.shouldUseRuntimeProductTaskRoute()).toBe(true)
            expect(codeStore.canUseProductMethod(OPENADE_METHOD.taskMetadataUpdate)).toBe(true)
            ;(
                codeStore as unknown as {
                    repoStoreConnection: typeof legacyRepoConnection
                }
            ).repoStoreConnection = legacyRepoConnection
            ;(
                codeStore as unknown as {
                    taskStoreConnections: Map<string, typeof legacyTaskConnection>
                }
            ).taskStoreConnections = new Map([["task-1", legacyTaskConnection]])

            const initialSnapshotReads = state.snapshotReadCount ?? 0
            const initialProjectReads = state.projectReadCount ?? 0
            state.taskReadRequests = []
            state.taskMetadataUpdateRequests = []

            await codeStore.updateProductTaskMetadata({
                taskId: "task-1",
                title: "Route-owned metadata update",
            })

            expect(codeStore.shouldUseRuntimeProductAPI()).toBe(false)
            expect(state.task?.title).toBe("Route-owned metadata update")
            expect(state.taskMetadataUpdateRequests).toEqual([
                expect.objectContaining({
                    repoId: "repo-1",
                    taskId: "task-1",
                    title: "Route-owned metadata update",
                }),
            ])
            expect(codeStore.shouldUseRuntimeProductAPI()).toBe(false)
            await codeStore.createProductComment({
                taskId: "task-1",
                source: { type: "llm_output", eventId: "event-1", lineStart: 1, lineEnd: 1 },
                content: "Route-owned comment",
                selectedText: { text: "Runtime", linesBefore: "", linesAfter: "" },
                author: { id: "user-1", email: "user@example.com" },
            })
            expect(codeStore.shouldUseRuntimeProductAPI()).toBe(false)
            await codeStore.startProductReview({
                repoId: "repo-1",
                taskId: "task-1",
                reviewType: "plan",
                harnessId: "codex",
                modelId: "gpt-test",
            })
            expect(codeStore.shouldUseRuntimeProductAPI()).toBe(false)
            await codeStore.startProductTurn({
                repoId: "repo-1",
                type: "do",
                input: "Route-owned turn",
                inTaskId: "task-1",
                harnessId: "codex",
                modelId: "gpt-test",
            })

            expect(codeStore.shouldUseRuntimeProductAPI()).toBe(false)
            expect(codeStore.tasks.getTask("task-1")).toEqual(
                expect.objectContaining({
                    title: "Route-owned metadata update",
                    comments: expect.arrayContaining([expect.objectContaining({ content: "Route-owned comment" })]),
                    events: expect.arrayContaining([
                        expect.objectContaining({ id: "event-review", status: "in_progress" }),
                        expect.objectContaining({ id: "event-started", status: "in_progress" }),
                    ]),
                })
            )

            await codeStore.refreshRepoStoreFromStorage()
            await codeStore.refreshTaskStoreFromStorage("task-1")
            await codeStore.refreshProductStateAfterTaskMutation("task-1")
            await codeStore.refreshProductStateAfterTaskCreation("repo-1", "task-1")
            await codeStore.refreshProductStateAfterRepoMutation()
            await codeStore.syncRepoStore()
            await codeStore.reloadRepoStoreFromStorage()

            expect(legacyRepoRefresh).not.toHaveBeenCalled()
            expect(legacyRepoConnection.sync).not.toHaveBeenCalled()
            expect(legacyTaskRefresh).not.toHaveBeenCalled()
            expect(state.snapshotReadCount ?? 0).toBe(initialSnapshotReads)
            expect(state.projectReadCount ?? 0).toBe(initialProjectReads)
            expect(state.taskReadRequests.length).toBeGreaterThan(0)
            expect(state.taskReadRequests.every((request) => request.repoId === "repo-1" && request.taskId === "task-1")).toBe(true)
        } finally {
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("renders classic action images through the runtime product API without reading legacy image files", async () => {
        const image = {
            id: "runtime-image-1",
            mediaType: "image/png",
            ext: "png",
            originalWidth: 2,
            originalHeight: 1,
            resizedWidth: 2,
            resizedHeight: 1,
        }
        const imageData = "cnVudGltZS1pbWFnZQ=="
        const taskWithImage: OpenADETask = {
            ...cloneTask(task),
            events: task.events.map((event) => (taskEventRecord(event) && event.id === "event-1" ? { ...event, images: [image] } : event)),
        }
        const { client, runtime } = createRuntimeBackedClient({
            ...createBridgeState(),
            task: taskWithImage,
            writtenImages: new Map([[`${image.id}.${image.ext}`, { data: imageData, ext: image.ext, mediaType: image.mediaType }]]),
        })
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })
        const legacyImageLoad = vi.spyOn(dataFolderApi, "load").mockRejectedValue(new Error("legacy image data folder should not be used"))
        const createObjectURL = vi.fn(() => "blob:runtime-image")
        const revokeObjectURL = vi.fn()
        const originalCreateObjectURL = URL.createObjectURL
        const originalRevokeObjectURL = URL.revokeObjectURL
        const originalIntersectionObserver = globalThis.IntersectionObserver
        let triggerIntersection: (() => void) | null = null
        Object.defineProperty(URL, "createObjectURL", {
            configurable: true,
            value: createObjectURL,
        })
        Object.defineProperty(URL, "revokeObjectURL", {
            configurable: true,
            value: revokeObjectURL,
        })
        class TestIntersectionObserver {
            readonly root = null
            readonly rootMargin = "200px"
            readonly thresholds = []
            private observed: Element | null = null

            constructor(private readonly callback: IntersectionObserverCallback) {
                triggerIntersection = () => {
                    if (!this.observed) return
                    const rect = this.observed.getBoundingClientRect()
                    this.callback(
                        [
                            {
                                boundingClientRect: rect,
                                intersectionRatio: 1,
                                intersectionRect: rect,
                                isIntersecting: true,
                                rootBounds: null,
                                target: this.observed,
                                time: performance.now(),
                            },
                        ],
                        this as unknown as IntersectionObserver
                    )
                }
            }

            observe(target: Element): void {
                this.observed = target
            }

            unobserve(target: Element): void {
                if (this.observed === target) this.observed = null
            }

            disconnect(): void {
                this.observed = null
            }

            takeRecords(): IntersectionObserverEntry[] {
                return []
            }
        }
        Object.defineProperty(globalThis, "IntersectionObserver", {
            configurable: true,
            value: TestIntersectionObserver as unknown as typeof IntersectionObserver,
        })
        ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
        const container = document.createElement("div")
        document.body.appendChild(container)
        const root = createRoot(container)

        try {
            await codeStore.initializeRuntimeProductStore()

            await expect(
                codeStore.readProductTaskImage({
                    repoId: "repo-1",
                    taskId: "task-1",
                    imageId: image.id,
                    ext: image.ext,
                })
            ).resolves.toMatchObject({
                repoId: "repo-1",
                taskId: "task-1",
                imageId: image.id,
                ext: image.ext,
                mediaType: image.mediaType,
                data: imageData,
            })

            await act(async () => {
                root.render(
                    createElement(
                        CodeStoreProvider,
                        { store: codeStore },
                        createElement(ImageAttachments, {
                            images: [image],
                            taskId: "task-1",
                        })
                    )
                )
                await Promise.resolve()
            })
            await act(async () => {
                triggerIntersection?.()
                await new Promise((resolve) => setTimeout(resolve, 20))
            })
            expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:runtime-image")
            expect(createObjectURL).toHaveBeenCalledTimes(1)
            expect(legacyImageLoad).not.toHaveBeenCalled()

            await act(async () => {
                await runtime.close()
                root.render(
                    createElement(
                        CodeStoreProvider,
                        { store: codeStore },
                        createElement(ImageAttachments, {
                            images: [image],
                            taskId: "task-1",
                        })
                    )
                )
                await Promise.resolve()
            })

            await vi.waitFor(() => {
                expect(container.querySelector("img")).toBeNull()
            })
            expect(revokeObjectURL).toHaveBeenCalledWith("blob:runtime-image")
            expect(createObjectURL).toHaveBeenCalledTimes(1)
        } finally {
            act(() => root.unmount())
            container.remove()
            legacyImageLoad.mockRestore()
            Object.defineProperty(URL, "createObjectURL", {
                configurable: true,
                value: originalCreateObjectURL,
            })
            Object.defineProperty(URL, "revokeObjectURL", {
                configurable: true,
                value: originalRevokeObjectURL,
            })
            Object.defineProperty(globalThis, "IntersectionObserver", {
                configurable: true,
                value: originalIntersectionObserver,
            })
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("does not read classic action images when runtime image read is unavailable", async () => {
        const image = {
            id: "runtime-image-denied",
            mediaType: "image/png",
            ext: "png",
            originalWidth: 2,
            originalHeight: 1,
            resizedWidth: 2,
            resizedHeight: 1,
        }
        const taskWithImage: OpenADETask = {
            ...cloneTask(task),
            events: task.events.map((event) => (taskEventRecord(event) && event.id === "event-1" ? { ...event, images: [image] } : event)),
        }
        const { client, runtime } = createRuntimeBackedClient(
            {
                ...createBridgeState(),
                task: taskWithImage,
            },
            ["initialize", OPENADE_METHOD.snapshotRead]
        )
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })
        const runtimeImageRead = vi.spyOn(codeStore, "readProductTaskImage")
        const legacyImageLoad = vi.spyOn(dataFolderApi, "load").mockRejectedValue(new Error("legacy image data folder should not be used"))
        const createObjectURL = vi.fn(() => "blob:runtime-image-denied")
        const originalCreateObjectURL = URL.createObjectURL
        Object.defineProperty(URL, "createObjectURL", {
            configurable: true,
            value: createObjectURL,
        })
        ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
        const container = document.createElement("div")
        document.body.appendChild(container)
        const root = createRoot(container)

        try {
            await codeStore.initializeRuntimeProductStore()
            expect(codeStore.canUseProductMethod(OPENADE_METHOD.taskImageRead)).toBe(false)

            await act(async () => {
                root.render(
                    createElement(
                        CodeStoreProvider,
                        { store: codeStore },
                        createElement(ImageAttachments, {
                            images: [image],
                            taskId: "task-1",
                        })
                    )
                )
                await new Promise((resolve) => setTimeout(resolve, 20))
            })

            expect(container.querySelector("img")).toBeNull()
            expect(runtimeImageRead).not.toHaveBeenCalled()
            expect(legacyImageLoad).not.toHaveBeenCalled()
            expect(createObjectURL).not.toHaveBeenCalled()
        } finally {
            act(() => root.unmount())
            container.remove()
            legacyImageLoad.mockRestore()
            runtimeImageRead.mockRestore()
            Object.defineProperty(URL, "createObjectURL", {
                configurable: true,
                value: originalCreateObjectURL,
            })
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("restores SmartEditor stashed image previews through runtime staged image reads", async () => {
        const stashKey = "code:stashedDrafts:repo-1:task-create"
        localStorage.removeItem(stashKey)
        const { client, runtime, state } = createRuntimeBackedClient()
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })
        const image: ImageAttachment = {
            id: "staged-preview",
            mediaType: "image/png",
            ext: "png",
            originalWidth: 2,
            originalHeight: 1,
            resizedWidth: 2,
            resizedHeight: 1,
        }
        const legacyImageLoad = vi.spyOn(dataFolderApi, "load").mockRejectedValue(new Error("legacy staged image data folder should not be used"))
        const createObjectURL = vi.fn(() => "blob:runtime-staged-image")
        const originalCreateObjectURL = URL.createObjectURL
        Object.defineProperty(URL, "createObjectURL", {
            configurable: true,
            value: createObjectURL,
        })

        try {
            await codeStore.initializeRuntimeProductStore()
            await codeStore.persistProductTaskImage({
                id: image.id,
                ext: image.ext,
                mediaType: image.mediaType,
                data: new Uint8Array([4, 5, 6]).buffer,
            })
            expect(state.writtenImages?.get("staged-preview.png")).toEqual({
                data: "BAUG",
                ext: "png",
                mediaType: "image/png",
            })

            const manager = codeStore.smartEditors.getManager("task-create", "repo-1")
            manager.addImage(image, "blob:pending-staged-preview")
            expect(manager.stashCurrentDraft()).not.toBeNull()

            codeStore.smartEditors.disposeManager("task-create", "repo-1")
            const restoredManager = codeStore.smartEditors.getManager("task-create", "repo-1")
            await vi.waitFor(() => {
                expect(restoredManager.stashedDrafts[0]?.snapshot.pendingImageDataUrls.get(image.id)).toBe("blob:runtime-staged-image")
            })

            expect(createObjectURL).toHaveBeenCalledTimes(1)
            expect(legacyImageLoad).not.toHaveBeenCalled()
        } finally {
            localStorage.removeItem(stashKey)
            legacyImageLoad.mockRestore()
            Object.defineProperty(URL, "createObjectURL", {
                configurable: true,
                value: originalCreateObjectURL,
            })
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("refreshes runtime task state after a mutation without using legacy store refreshes", async () => {
        const { client, runtime, state } = createRuntimeBackedClient()
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })

        try {
            await codeStore.initializeRuntimeProductStore()
            await codeStore.loadRuntimeProductTask("repo-1", "task-1")

            const legacyTaskRefresh = vi.spyOn(codeStore, "refreshTaskStoreFromStorage")
            const legacyRepoRefresh = vi.spyOn(codeStore, "refreshRepoStoreFromStorage")

            if (!state.task) throw new Error("Expected runtime task fixture")
            state.task.title = "Runtime mutation title"

            await codeStore.refreshProductStateAfterTaskMutation("task-1")

            expect(legacyTaskRefresh).not.toHaveBeenCalled()
            expect(legacyRepoRefresh).not.toHaveBeenCalled()
            expect(codeStore.tasks.getTask("task-1")?.title).toBe("Runtime mutation title")
            expect(codeStore.getTaskPreviewsForRepo("repo-1")[0]?.title).toBe("Runtime mutation title")
        } finally {
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("marks runtime tasks viewed without hydrating session history", async () => {
        const { client, runtime, state } = createRuntimeBackedClient()
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })

        try {
            await codeStore.initializeRuntimeProductStore()
            await codeStore.loadRuntimeProductTask("repo-1", "task-1")
            const legacyTaskRefresh = vi.spyOn(codeStore, "refreshTaskStoreFromStorage")
            const legacyRepoRefresh = vi.spyOn(codeStore, "refreshRepoStoreFromStorage")

            state.taskReadRequests = []
            state.taskMetadataUpdateRequests = []
            await codeStore.tasks.markTaskViewed("task-1")

            expect(codeStore.getTaskPreviewsForRepo("repo-1")[0]?.lastViewedAt).toBeDefined()
            expect(state.taskMetadataUpdateRequests).toEqual([
                expect.objectContaining({
                    repoId: "repo-1",
                    taskId: "task-1",
                    lastViewedAt: expect.any(String),
                }),
            ])
            expect(state.taskReadRequests).toEqual([])
            expect(legacyTaskRefresh).not.toHaveBeenCalled()
            expect(legacyRepoRefresh).not.toHaveBeenCalled()
        } finally {
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("regenerates runtime task titles through the scoped product API without hydrating session history", async () => {
        const { client, runtime, state } = createRuntimeBackedClient()
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })

        try {
            await codeStore.initializeRuntimeProductStore()
            await codeStore.loadRuntimeProductTask("repo-1", "task-1")
            const legacyTaskRefresh = vi.spyOn(codeStore, "refreshTaskStoreFromStorage")
            const legacyRepoRefresh = vi.spyOn(codeStore, "refreshRepoStoreFromStorage")

            state.taskReadRequests = []
            await codeStore.tasks.regenerateTitle("task-1")

            expect(codeStore.tasks.getTask("task-1")?.title).toBe("Runtime generated title")
            expect(codeStore.getTaskPreviewsForRepo("repo-1")[0]?.title).toBe("Runtime generated title")
            expect(state.taskReadRequests).not.toHaveLength(0)
            expect(state.taskReadRequests.every((request) => request.hydrateSessionEvents === false)).toBe(true)
            expect(legacyTaskRefresh).not.toHaveBeenCalled()
            expect(legacyRepoRefresh).not.toHaveBeenCalled()
        } finally {
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("backs stats previews with runtime snapshot and backfills usage without legacy task stores", async () => {
        const { client, runtime, state } = createRuntimeBackedClient()
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })

        try {
            await codeStore.initializeRuntimeProductStore()
            const legacyTaskRead = vi.spyOn(codeStore, "getTaskStore")
            const legacyRepoRefresh = vi.spyOn(codeStore, "refreshRepoStoreFromStorage")

            expect(codeStore.getTaskPreviewReposForStats()).toEqual([
                expect.objectContaining({
                    id: "repo-1",
                    name: "Runtime Repo",
                    tasks: [
                        expect.objectContaining({
                            id: "task-1",
                            title: "Runtime task",
                            usage: undefined,
                        }),
                    ],
                }),
            ])

            state.taskReadRequests = []
            const snapshotReadsAfterInitialize = state.snapshotReadCount ?? 0
            await codeStore.backfillTaskUsagePreview("repo-1", "task-1")

            expect(legacyTaskRead).not.toHaveBeenCalled()
            expect(legacyRepoRefresh).not.toHaveBeenCalled()
            expect(state.taskReadRequests).toEqual([{ repoId: "repo-1", taskId: "task-1", hydrateSessionEvents: false }])
            expect(state.snapshotReadCount ?? 0).toBe(snapshotReadsAfterInitialize)
            expect(codeStore.runtimeProductSnapshot?.repos[0]?.tasks[0]?.usage).toMatchObject({
                usageVersion: 2,
                eventCount: 1,
            })
            expect(codeStore.getTaskPreviewReposForStats()[0]?.tasks[0]?.usage).toMatchObject({
                usageVersion: 2,
                eventCount: 1,
            })
        } finally {
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("does not backfill runtime stats through metadata when task metadata update is unavailable", async () => {
        const { client, runtime, state } = createRuntimeBackedClient(createBridgeState(), [OPENADE_METHOD.snapshotRead, OPENADE_METHOD.taskRead, "initialize"])
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })

        try {
            await codeStore.initializeRuntimeProductStore()

            state.taskReadRequests = []
            await codeStore.backfillTaskUsagePreview("repo-1", "task-1")

            expect(codeStore.canUseProductMethod(OPENADE_METHOD.taskMetadataUpdate)).toBe(false)
            expect(state.taskReadRequests).toEqual([])
            expect(codeStore.runtimeProductSnapshot?.repos[0]?.tasks[0]?.usage).toBeUndefined()
            expect(codeStore.getTaskPreviewReposForStats()[0]?.tasks[0]?.usage).toBeUndefined()
        } finally {
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("uses the Core bulk usage backfill method for clean managed-Core stats backfill", async () => {
        const restoreOpenADEAPI = installCleanCoreRolloutState()
        const { client, runtime, state } = createRuntimeBackedClient()
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })

        try {
            await codeStore.initializeRuntimeProductStore()
            const legacyTaskRead = vi.spyOn(codeStore, "getTaskStore")
            const legacyRepoRefresh = vi.spyOn(codeStore, "refreshRepoStoreFromStorage")

            state.taskReadRequests = []
            state.usageBackfillRequests = []
            state.usageRecalculateRequests = []
            const snapshotReadsAfterInitialize = state.snapshotReadCount ?? 0
            await codeStore.backfillTaskUsagePreviews([{ repoId: "repo-1", taskId: "task-1" }])

            expect(state.usageBackfillRequests).toEqual([{ repoId: "repo-1", taskIds: ["task-1"], force: undefined }])
            expect(state.usageRecalculateRequests).toEqual([])
            expect(state.taskReadRequests).toEqual([])
            expect(state.snapshotReadCount ?? 0).toBe(snapshotReadsAfterInitialize)
            expect(legacyTaskRead).not.toHaveBeenCalled()
            expect(legacyRepoRefresh).not.toHaveBeenCalled()
            expect(codeStore.getTaskPreviewReposForStats()[0]?.tasks[0]?.usage).toMatchObject({
                usageVersion: 2,
                inputTokens: 34,
                eventCount: 1,
            })
        } finally {
            codeStore.disconnectAllStores()
            await runtime.close()
            restoreOpenADEAPI()
        }
    })

    it("does not backfill Core-owned stats when task usage backfill is unavailable", async () => {
        const restoreOpenADEAPI = installCleanCoreRolloutState()
        const { client, runtime, state } = createRuntimeBackedClient(createBridgeState(), [OPENADE_METHOD.snapshotRead, "initialize"])
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })

        try {
            await codeStore.initializeRuntimeProductStore()

            state.usageBackfillRequests = []
            await codeStore.backfillTaskUsagePreviews([{ repoId: "repo-1", taskId: "task-1" }])
            await codeStore.backfillTaskUsagePreview("repo-1", "task-1")

            expect(codeStore.canUseProductMethod(OPENADE_METHOD.taskUsageBackfill)).toBe(false)
            expect(state.usageBackfillRequests).toEqual([])
            expect(codeStore.getTaskPreviewReposForStats()[0]?.tasks[0]?.usage).toBeUndefined()
        } finally {
            codeStore.disconnectAllStores()
            await runtime.close()
            restoreOpenADEAPI()
        }
    })

    it("syncs accepted runtime repo mutations without broad snapshot or legacy refreshes", async () => {
        const { client, runtime, state } = createRuntimeBackedClient({
            project: null,
            task: null,
        })
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })

        try {
            await codeStore.initializeRuntimeProductStore()
            const legacyRepoRefresh = vi.spyOn(codeStore, "refreshRepoStoreFromStorage")
            const runtimeSnapshotRefresh = vi.spyOn(codeStore, "refreshRuntimeProductSnapshot")
            const snapshotReadsAfterInitialize = state.snapshotReadCount ?? 0

            const created = await codeStore.repos.createRepo({
                name: "New Runtime Repo",
                path: "/tmp/new-runtime-repo",
            })
            expect(created).toEqual(
                expect.objectContaining({
                    id: "repo-created",
                    name: "New Runtime Repo",
                    path: "/tmp/new-runtime-repo",
                })
            )
            expect(codeStore.runtimeProductSnapshot?.repos).toEqual([
                expect.objectContaining({
                    id: "repo-created",
                    name: "New Runtime Repo",
                    path: "/tmp/new-runtime-repo",
                }),
            ])

            const updated = await codeStore.repos.updateRepo("repo-created", {
                name: "Renamed Runtime Repo",
                path: "/tmp/renamed-runtime-repo",
            })
            expect(updated).toEqual(
                expect.objectContaining({
                    id: "repo-created",
                    name: "Renamed Runtime Repo",
                    path: "/tmp/renamed-runtime-repo",
                })
            )

            await codeStore.repos.setRepoArchived("repo-created", true)
            expect(codeStore.repos.getRepo("repo-created")).toEqual(expect.objectContaining({ archived: true }))

            await expect(codeStore.repos.deleteRepo("repo-created")).resolves.toBe(true)
            expect(codeStore.runtimeProductSnapshot?.repos).toEqual([])
            expect(codeStore.repos.repos).toEqual([])
            expect(legacyRepoRefresh).not.toHaveBeenCalled()
            expect(runtimeSnapshotRefresh).not.toHaveBeenCalled()
            expect(state.snapshotReadCount).toBe(snapshotReadsAfterInitialize)
        } finally {
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("routes classic task, comment, review, and turn mutations through the runtime product store", async () => {
        const { client, runtime, state } = createRuntimeBackedClient()
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })

        try {
            await codeStore.initializeRuntimeProductStore()
            await codeStore.loadRuntimeProductTask("repo-1", "task-1")
            const legacyTaskRead = vi.spyOn(codeStore, "getTaskStore")
            const legacyTaskRefresh = vi.spyOn(codeStore, "refreshTaskStoreFromStorage")
            const legacyRepoRefresh = vi.spyOn(codeStore, "refreshRepoStoreFromStorage")

            state.taskReadRequests = []
            const commentId = await codeStore.comments.addComment(
                "task-1",
                { type: "llm_output", eventId: "event-1", lineStart: 1, lineEnd: 1 },
                "Runtime comment",
                { text: "Runtime", linesBefore: "", linesAfter: "" }
            )
            expect(commentId).toBe("comment-created")
            expect(codeStore.tasks.getTask("task-1")?.comments).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        id: "comment-created",
                        content: "Runtime comment",
                    }),
                ])
            )

            await codeStore.comments.editComment("task-1", commentId, "Edited runtime comment")
            expect(codeStore.tasks.getTask("task-1")?.comments).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        id: "comment-created",
                        content: "Edited runtime comment",
                    }),
                ])
            )

            await codeStore.comments.removeComment("task-1", commentId)
            expect(codeStore.tasks.getTask("task-1")?.comments).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: "comment-created" })]))
            expect(state.taskReadRequests).toEqual([])

            await codeStore.tasks.markTaskViewed("task-1")
            expect(codeStore.getTaskPreviewsForRepo("repo-1")[0]?.lastViewedAt).toBeDefined()

            await codeStore.tasks.setSessionId({
                taskId: "task-1",
                key: "review",
                sessionId: "session-runtime",
            })
            expect(codeStore.tasks.getTask("task-1")?.sessionIds).toEqual(expect.objectContaining({ review: "session-runtime" }))

            await codeStore.persistProductTaskImage({
                id: "runtime-upload",
                ext: "png",
                mediaType: "image/png",
                data: new Uint8Array([1, 2, 3]).buffer,
            })
            expect(state.writtenImages?.get("runtime-upload.png")).toEqual({
                data: "AQID",
                ext: "png",
                mediaType: "image/png",
            })

            await codeStore.tasks.addDeviceEnvironment("task-1", {
                id: "device-1",
                deviceId: "device-1",
                setupComplete: true,
                createdAt: now,
                lastUsedAt: now,
            })
            expect(codeStore.tasks.getTask("task-1")?.deviceEnvironments).toEqual([expect.objectContaining({ id: "device-1" })])

            state.taskReadRequests = []
            const snapshotReadsBeforeActions = state.snapshotReadCount ?? 0
            await codeStore.startProductReview({
                repoId: "repo-1",
                taskId: "task-1",
                reviewType: "plan",
                harnessId: "codex",
                modelId: "gpt-test",
            })
            expect(codeStore.tasks.getTask("task-1")?.events).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        id: "event-review",
                        status: "in_progress",
                    }),
                ])
            )

            await codeStore.startProductTurn({
                repoId: "repo-1",
                type: "do",
                input: "Run through runtime product store",
                inTaskId: "task-1",
                harnessId: "codex",
                modelId: "gpt-test",
            })
            expect(codeStore.tasks.getTask("task-1")?.events).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        id: "event-started",
                        status: "in_progress",
                    }),
                ])
            )
            expect(state.taskReadRequests).toEqual([])
            expect(state.snapshotReadCount).toBe(snapshotReadsBeforeActions)

            const snapshotReadsBeforeDelete = state.snapshotReadCount ?? 0
            await codeStore.tasks.deepRemoveTask("task-1", {
                deleteSnapshots: false,
                deleteImages: false,
                deleteSessions: false,
                deleteWorktrees: false,
            })
            expect(codeStore.tasks.getTask("task-1")).toBeNull()
            expect(codeStore.getTaskPreviewsForRepo("repo-1")).toEqual([])
            expect(state.snapshotReadCount).toBe(snapshotReadsBeforeDelete)

            expect(legacyTaskRead).not.toHaveBeenCalled()
            expect(legacyTaskRefresh).not.toHaveBeenCalled()
            expect(legacyRepoRefresh).not.toHaveBeenCalled()
        } finally {
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("starts review from the picker modal without broad post-accept refresh", async () => {
        const { client, runtime, state } = createRuntimeBackedClient()
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })
        const container = document.createElement("div")
        document.body.appendChild(container)
        const root = createRoot(container)

        try {
            await codeStore.initializeRuntimeProductStore()
            await codeStore.loadRuntimeProductTask("repo-1", "task-1")
            const taskModel = codeStore.tasks.getTaskModel("task-1")
            if (!taskModel) throw new Error("Task model was not loaded")
            taskModel.setThinking("high")
            taskModel.setFastMode(true)
            const refreshAfterMutation = vi.spyOn(codeStore, "refreshProductStateAfterTaskMutation")
            state.taskReadRequests = []
            const snapshotReadsBeforeReview = state.snapshotReadCount ?? 0

            await act(async () => {
                root.render(createElement(CodeStoreProvider, { store: codeStore }, createElement(NiceModal.Provider)))
            })
            await act(async () => {
                void NiceModal.show(ReviewPickerModal, {
                    taskId: "task-1",
                    reviewType: "plan",
                    customInstructions: "Check the cached review path",
                })
            })

            await waitForRuntimeBridge(() => {
                expect(document.body.textContent).toContain("Review Plan")
            })
            const reviewButton = Array.from(document.body.querySelectorAll("button")).find((button) => {
                const text = button.textContent?.trim()
                return text !== undefined && text.length > 0 && text !== "Cancel" && button.getAttribute("title") !== "Close"
            })
            if (!reviewButton) throw new Error("Review option button was not rendered")

            await act(async () => {
                reviewButton.click()
            })

            await waitForRuntimeBridge(() => {
                expect(codeStore.tasks.getTask("task-1")?.events).toEqual(
                    expect.arrayContaining([
                        expect.objectContaining({
                            id: "event-review",
                            status: "in_progress",
                        }),
                    ])
                )
            })
            expect(refreshAfterMutation).not.toHaveBeenCalled()
            expect(state.reviewStartRequests?.[0]).toMatchObject({
                repoId: "repo-1",
                taskId: "task-1",
                reviewType: "plan",
                thinking: "high",
                fastMode: true,
            })
            expect(state.taskReadRequests).toEqual([])
            expect(state.snapshotReadCount ?? 0).toBe(snapshotReadsBeforeReview)
        } finally {
            await act(async () => root.unmount())
            container.remove()
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("keeps the review picker fail-closed when review start is not advertised", async () => {
        const { client, runtime, state } = createRuntimeBackedClient()
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })
        const container = document.createElement("div")
        document.body.appendChild(container)
        const root = createRoot(container)

        try {
            await codeStore.initializeRuntimeProductStore()
            await codeStore.loadRuntimeProductTask("repo-1", "task-1")
            vi.spyOn(codeStore, "canUseProductMethod").mockImplementation((method) => method !== OPENADE_METHOD.reviewStart)

            await act(async () => {
                root.render(createElement(CodeStoreProvider, { store: codeStore }, createElement(NiceModal.Provider)))
            })
            await act(async () => {
                void NiceModal.show(ReviewPickerModal, {
                    taskId: "task-1",
                    reviewType: "work",
                    customInstructions: "Do not submit when denied",
                })
            })

            await waitForRuntimeBridge(() => {
                expect(document.body.textContent).toContain("Review is not available from this runtime.")
            })
            const reviewButton = Array.from(document.body.querySelectorAll("button")).find((button) => {
                const text = button.textContent?.trim()
                return text !== undefined && text.length > 0 && text !== "Cancel" && button.getAttribute("title") !== "Close"
            })
            if (!reviewButton) throw new Error("Review option button was not rendered")

            expect(reviewButton.disabled).toBe(true)
            await act(async () => {
                reviewButton.click()
            })

            expect(state.reviewStartRequests ?? []).toEqual([])
        } finally {
            await act(async () => root.unmount())
            container.remove()
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("runs classic repeat turns through the runtime product store without legacy task reads", async () => {
        const { client, runtime, state } = createRuntimeBackedClient()
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })

        try {
            await codeStore.initializeRuntimeProductStore()
            await codeStore.loadRuntimeProductTask("repo-1", "task-1")
            const taskModel = codeStore.tasks.getTaskModel("task-1")
            expect(taskModel).not.toBeNull()
            taskModel?.input.setValue("Repeat through runtime product store")

            const legacyTaskRead = vi.spyOn(codeStore, "getTaskStore")
            const legacyTaskRefresh = vi.spyOn(codeStore, "refreshTaskStoreFromStorage")
            const legacyRepoRefresh = vi.spyOn(codeStore, "refreshRepoStoreFromStorage")

            codeStore.repeat.setMaxRuns(2)
            codeStore.repeat.start("task-1")

            await waitForRuntimeBridge(() => {
                expect(state.turnStartRequests).toHaveLength(1)
            })
            expect(state.turnStartRequests?.[0]).toMatchObject({
                repoId: "repo-1",
                type: "do",
                input: "Repeat through runtime product store",
                inTaskId: "task-1",
                label: "Repeat",
                includeComments: false,
            })
            expect(codeStore.repeat.iterationCount).toBe(1)

            codeStore.execution.notifyAfterEvent("task-1", "do", true)
            await waitForRuntimeBridge(() => {
                expect(state.turnStartRequests).toHaveLength(2)
            })
            expect(state.turnStartRequests?.[1]).toMatchObject({
                repoId: "repo-1",
                type: "do",
                input: "Repeat through runtime product store",
                inTaskId: "task-1",
                label: "Repeat",
                includeComments: false,
            })
            expect(codeStore.repeat.iterationCount).toBe(2)

            codeStore.execution.notifyAfterEvent("task-1", "do", true)
            expect(codeStore.repeat.isActive).toBe(false)
            expect(state.turnStartRequests).toHaveLength(2)
            expect(codeStore.tasks.getTask("task-1")?.events).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        userInput: "Repeat through runtime product store",
                    }),
                ])
            )
            expect(legacyTaskRead).not.toHaveBeenCalled()
            expect(legacyTaskRefresh).not.toHaveBeenCalled()
            expect(legacyRepoRefresh).not.toHaveBeenCalled()
        } finally {
            codeStore.repeat.stop()
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("does not start classic repeat turns when turn start is not advertised", async () => {
        const state = createBridgeState()
        const { client, runtime } = createRuntimeBackedClient(state, [OPENADE_METHOD.snapshotRead, OPENADE_METHOD.taskRead, "initialize"])
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })

        try {
            await codeStore.initializeRuntimeProductStore()
            await codeStore.loadRuntimeProductTask("repo-1", "task-1")
            const taskModel = codeStore.tasks.getTaskModel("task-1")
            expect(taskModel).not.toBeNull()
            taskModel?.input.setValue("Repeat should not run")

            codeStore.repeat.start("task-1")

            expect(codeStore.canUseProductMethod(OPENADE_METHOD.turnStart)).toBe(false)
            expect(codeStore.repeat.isActive).toBe(false)
            expect(codeStore.repeat.iterationCount).toBe(0)
            expect(state.turnStartRequests ?? []).toEqual([])
        } finally {
            codeStore.repeat.stop()
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("cleans up cancelled server-accepted task creation through runtime product APIs", async () => {
        const { client, runtime, state } = createRuntimeBackedClient({
            project: { ...project, tasks: [] },
            task: null,
        })
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })
        const interruptTurn = vi.spyOn(codeStore, "interruptProductTurn")
        const deleteTask = vi.spyOn(codeStore, "deleteProductTask")
        const originalStartProductTurn = codeStore.startProductTurn.bind(codeStore)
        let creationId = ""
        const startProductTurn = vi.spyOn(codeStore, "startProductTurn").mockImplementation(async (params) => {
            const result = await originalStartProductTurn(params)
            codeStore.creation.getCreation(creationId)?.abortController.abort()
            return result
        })
        const refreshAfterCreation = vi.spyOn(codeStore, "refreshProductStateAfterTaskCreation")

        try {
            await codeStore.initializeRuntimeProductStore()
            creationId = codeStore.creation.newTask({
                repoId: "repo-1",
                description: "cancel accepted task",
                mode: "do",
                isolationStrategy: { type: "worktree", sourceBranch: "main" },
                harnessId: "codex",
                modelId: "gpt-test",
            })

            await vi.waitFor(() => {
                expect(deleteTask).toHaveBeenCalled()
                expect(codeStore.creation.getCreation(creationId)).toBeNull()
                expect(state.task).toBeNull()
            })
            expect(interruptTurn).toHaveBeenCalledWith("task-created")
            expect(deleteTask).toHaveBeenCalledWith({
                repoId: "repo-1",
                taskId: "task-created",
                options: {
                    deleteSnapshots: true,
                    deleteImages: true,
                    deleteSessions: true,
                    deleteWorktrees: true,
                },
            })
            expect(startProductTurn).toHaveBeenCalled()
            expect(refreshAfterCreation).not.toHaveBeenCalled()
            expect(codeStore.getTaskPreviewsForRepo("repo-1")).toEqual([])
        } finally {
            interruptTurn.mockRestore()
            deleteTask.mockRestore()
            startProductTurn.mockRestore()
            refreshAfterCreation.mockRestore()
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("prepares classic environment setup through the runtime product store without renderer worktree creation", async () => {
        const { client, runtime, state } = createRuntimeBackedClient()
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })
        const rawSetup = vi.spyOn(TaskEnvironment, "setup").mockRejectedValue(new Error("legacy environment setup should not be used"))
        const container = document.createElement("div")
        document.body.appendChild(container)
        const root = createRoot(container)

        try {
            await codeStore.initializeRuntimeProductStore()
            await codeStore.loadRuntimeProductTask("repo-1", "task-1")
            const taskModel = codeStore.tasks.getTaskModel("task-1")
            if (!taskModel) throw new Error("Task model was not created")
            const refreshAfterMutation = vi.spyOn(codeStore, "refreshProductStateAfterTaskMutation")
            state.taskReadRequests = []
            const snapshotReadsBeforeSetup = state.snapshotReadCount ?? 0

            await act(async () => {
                root.render(
                    createElement(
                        CodeStoreProvider,
                        { store: codeStore },
                        createElement(EnvironmentSetupView, {
                            taskModel,
                            onComplete: () => undefined,
                        })
                    )
                )
            })

            await waitForRuntimeBridge(() => {
                expect(codeStore.tasks.getTask("task-1")?.deviceEnvironments).toEqual([expect.objectContaining({ id: "runtime-device" })])
                expect(codeStore.tasks.getTask("task-1")?.events).toEqual(
                    expect.arrayContaining([
                        expect.objectContaining({
                            id: "setup-runtime-device",
                            type: "setup_environment",
                        }),
                    ])
                )
                expect(codeStore.getTaskPreviewsForRepo("repo-1")[0]?.lastEvent).toEqual(
                    expect.objectContaining({
                        type: "setup_environment",
                        status: "completed",
                        sourceLabel: "Setup",
                    })
                )
                expect(container.textContent).toContain("Complete")
            })
            expect(rawSetup).not.toHaveBeenCalled()
            expect(refreshAfterMutation).not.toHaveBeenCalled()
            expect(state.taskReadRequests).toEqual([{ repoId: "repo-1", taskId: "task-1", hydrateSessionEvents: false, eventLimit: 12 }])
            expect(state.snapshotReadCount).toBe(snapshotReadsBeforeSetup)
        } finally {
            await act(async () => root.unmount())
            container.remove()
            rawSetup.mockRestore()
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("does not auto-run classic environment setup when the runtime omits prepare capability", async () => {
        const state = createBridgeState()
        const { client, runtime } = createRuntimeBackedClient(state, [OPENADE_METHOD.snapshotRead, OPENADE_METHOD.taskRead, "initialize"])
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })
        const rawSetup = vi.spyOn(TaskEnvironment, "setup").mockRejectedValue(new Error("legacy environment setup should not be used"))
        const container = document.createElement("div")
        document.body.appendChild(container)
        const root = createRoot(container)

        try {
            await codeStore.initializeRuntimeProductStore()
            await codeStore.loadRuntimeProductTask("repo-1", "task-1")
            const taskModel = codeStore.tasks.getTaskModel("task-1")
            if (!taskModel) throw new Error("Task model was not created")
            state.taskReadRequests = []

            await act(async () => {
                root.render(
                    createElement(
                        CodeStoreProvider,
                        { store: codeStore },
                        createElement(EnvironmentSetupView, {
                            taskModel,
                            onComplete: () => undefined,
                        })
                    )
                )
            })

            await waitForRuntimeBridge(() => {
                expect(container.textContent).toContain("Environment setup is not available from this runtime")
            })
            expect(codeStore.canUseProductMethod(OPENADE_METHOD.taskEnvironmentPrepare)).toBe(false)
            expect(rawSetup).not.toHaveBeenCalled()
            expect(state.task?.deviceEnvironments).toEqual([])
            expect(state.taskReadRequests).toEqual([])
        } finally {
            await act(async () => root.unmount())
            container.remove()
            rawSetup.mockRestore()
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("builds desktop task resource inventory from runtime DTOs without opening a legacy task store", async () => {
        const { client, runtime, state } = createRuntimeBackedClient()
        if (!state.task) throw new Error("Expected runtime task fixture")
        const firstEvent = state.task.events[0]
        if (!firstEvent) throw new Error("Expected runtime task event fixture")
        state.task = {
            ...state.task,
            isolationStrategy: { type: "worktree", sourceBranch: "main" },
            sessionIds: { last: "session-from-metadata" },
            events: [
                {
                    ...firstEvent,
                    execution: {
                        harnessId: "codex",
                        executionId: "exec-1",
                        modelId: "gpt-test",
                        events: [],
                        sessionId: "session-from-event",
                    },
                    images: [
                        {
                            id: "image-1",
                            mediaType: "image/png",
                            ext: "png",
                            originalWidth: 320,
                            originalHeight: 200,
                            resizedWidth: 320,
                            resizedHeight: 200,
                        },
                    ],
                },
                {
                    id: "snapshot-1",
                    type: "snapshot",
                    status: "completed",
                    createdAt: now,
                    completedAt: now,
                    userInput: "",
                    actionEventId: "event-1",
                    referenceBranch: "main",
                    mergeBaseCommit: "merge-base",
                    fullPatch: snapshotPatch,
                    patchFileId: "patch-1",
                    stats: { filesChanged: 1, insertions: 2, deletions: 1 },
                    files: [],
                },
            ],
        }
        state.resourceInventoryBranchMerged = false
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })

        try {
            await codeStore.initializeRuntimeProductStore()
            const legacyTaskStoreRead = vi.spyOn(codeStore, "getTaskStore")
            const legacyBranchMergedRead = vi.spyOn(gitApi, "isBranchMerged").mockRejectedValue(new Error("legacy branch merge read should not be used"))
            const runtimeInventoryRead = vi.spyOn(codeStore, "readProductTaskResourceInventory")

            await expect(codeStore.tasks.getResourceInventory(["task-1"])).resolves.toEqual([
                expect.objectContaining({
                    repoId: "repo-1",
                    taskId: "task-1",
                    taskTitle: "Runtime task",
                    snapshotIds: ["patch-1"],
                    images: [{ id: "image-1", ext: "png" }],
                    sessions: expect.arrayContaining([
                        { sessionId: "session-from-event", harnessId: "codex" },
                        { sessionId: "session-from-metadata", harnessId: "claude-code" },
                    ]),
                    worktree: {
                        slug: "runtime-task",
                        branchName: "openade/runtime-task",
                        sourceBranch: "main",
                        branchMerged: false,
                    },
                }),
            ])
            expect(runtimeInventoryRead).toHaveBeenCalledWith({
                repoId: "repo-1",
                taskId: "task-1",
            })
            expect(legacyTaskStoreRead).not.toHaveBeenCalled()
            expect(legacyBranchMergedRead).not.toHaveBeenCalled()
        } finally {
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("routes classic file browsing, content search, and previews through task-scoped runtime project methods", async () => {
        const { client, runtime } = createRuntimeBackedClient({
            project: { ...project, path: "/tmp/runtime-repo" },
            task: { ...task, isolationStrategy: { type: "head" } },
        })
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })
        const legacyContentSearch = vi.spyOn(filesApi, "contentSearch").mockRejectedValue(new Error("legacy content search should not be used"))
        const legacyDescribePath = vi.spyOn(filesApi, "describePath").mockRejectedValue(new Error("legacy file preview should not be used"))
        const legacyFuzzySearch = vi.spyOn(filesApi, "fuzzySearch").mockRejectedValue(new Error("legacy fuzzy search should not be used"))
        const runtimeSearch = vi.spyOn(codeStore, "searchProductProject")
        const runtimeFileRead = vi.spyOn(codeStore, "readProductProjectFile")
        const runtimeFileList = vi.spyOn(codeStore, "listProductProjectFiles")
        const runtimeFuzzySearch = vi.spyOn(codeStore, "fuzzySearchProductProjectFiles")

        try {
            await codeStore.initializeRuntimeProductStore()
            await codeStore.loadRuntimeProductTask("repo-1", "task-1")

            const taskModel = codeStore.tasks.getTaskModel("task-1")
            if (!taskModel) throw new Error("Expected runtime task model")
            taskModel.contentSearch.setWorkingDir("/tmp/runtime-repo")
            taskModel.contentSearch.setQuery("needle")
            taskModel.fileBrowser.setWorkingDir("/tmp/runtime-repo")
            await taskModel.fileBrowser.openFileReference("runtime-search.ts", {
                line: 2,
            })
            localStorage.setItem(
                "code:fileUsageStats",
                JSON.stringify({
                    "repo-1": {
                        "src/runtime-search.ts": { count: 2, lastUsed: Date.parse(now) },
                        "src/deleted.ts": { count: 1, lastUsed: Date.parse(now) },
                    },
                })
            )
            const editorManager = codeStore.smartEditors.getManager("task-task-1", "repo-1")
            const mentionSearch = await editorManager.searchFileMentions("/tmp/runtime-repo", "runtime", 20)
            await editorManager.validateFiles("/tmp/runtime-repo")

            await vi.waitFor(() => {
                expect(taskModel.contentSearch.contentResults).toEqual([
                    expect.objectContaining({
                        path: "src/runtime-search.ts",
                        line: 1,
                        content: expect.stringContaining("runtime needle"),
                    }),
                ])
            })
            await vi.waitFor(() => {
                expect(taskModel.contentSearch.previewData?.content).toBe(runtimeSearchFixture.content)
            })
            await vi.waitFor(() => {
                expect(taskModel.fileBrowser.activeFileData?.content).toBe(runtimeSearchFixture.content)
            })
            expect(mentionSearch.results).toEqual(["src/runtime-search.ts"])
            expect(editorManager.favorites.map((item) => item.path)).toEqual(["src/runtime-search.ts"])

            expect(runtimeSearch).toHaveBeenCalledWith({
                repoId: "repo-1",
                taskId: "task-1",
                query: "needle",
                limit: 100,
                caseSensitive: false,
            })
            expect(runtimeFileRead).toHaveBeenCalledWith({
                repoId: "repo-1",
                taskId: "task-1",
                path: "src/runtime-search.ts",
                maxBytes: 5 * 1024 * 1024,
            })
            expect(runtimeFileList).toHaveBeenCalledWith({
                repoId: "repo-1",
                taskId: "task-1",
                path: "",
                maxDepth: 0,
                maxEntries: 1000,
                includeHidden: true,
                includeGenerated: true,
            })
            expect(runtimeFuzzySearch).toHaveBeenCalledWith({
                repoId: "repo-1",
                taskId: "task-1",
                query: "runtime-search.ts",
                matchDirs: false,
                limit: 12,
                includeHidden: true,
                includeGenerated: true,
            })
            expect(runtimeFuzzySearch).toHaveBeenCalledWith({
                repoId: "repo-1",
                taskId: "task-1",
                query: "runtime",
                matchDirs: false,
                limit: 20,
                includeHidden: true,
            })
            expect(runtimeFuzzySearch).toHaveBeenCalledWith({
                repoId: "repo-1",
                taskId: "task-1",
                query: "src/runtime-search.ts",
                matchDirs: false,
                limit: 5,
                includeHidden: true,
            })
            expect(legacyContentSearch).not.toHaveBeenCalled()
            expect(legacyDescribePath).not.toHaveBeenCalled()
            expect(legacyFuzzySearch).not.toHaveBeenCalled()
        } finally {
            localStorage.removeItem("code:fileUsageStats")
            runtimeSearch.mockRestore()
            runtimeFileRead.mockRestore()
            runtimeFileList.mockRestore()
            runtimeFuzzySearch.mockRestore()
            legacyContentSearch.mockRestore()
            legacyDescribePath.mockRestore()
            legacyFuzzySearch.mockRestore()
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("uses the prepared runtime worktree directory for classic shell working-dir hints", async () => {
        const previousDeviceId = localStorage.getItem("openade-device-id")
        localStorage.setItem("openade-device-id", "runtime-device")
        const { client, runtime } = createRuntimeBackedClient({
            project: { ...project, path: "/tmp/runtime-repo" },
            task: {
                ...task,
                isolationStrategy: { type: "worktree", sourceBranch: "main" },
                deviceEnvironments: [
                    {
                        id: "runtime-device",
                        deviceId: "runtime-device",
                        worktreeDir: "/tmp/runtime-worktree",
                        setupComplete: true,
                        createdAt: now,
                        lastUsedAt: now,
                    },
                ],
                events: [
                    {
                        id: "setup-runtime-device",
                        type: "setup_environment",
                        status: "completed",
                        createdAt: now,
                        completedAt: now,
                        worktreeId: "runtime-task",
                        deviceId: "runtime-device",
                        workingDir: "/tmp/runtime-worktree/packages/web",
                        setupOutput: "Runtime worktree ready",
                    },
                ],
            },
        })
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })
        const legacyDescribePath = vi.spyOn(filesApi, "describePath").mockRejectedValue(new Error("legacy file browse should not be used"))
        const runtimeGitInfoRead = vi.spyOn(codeStore, "readProductProjectGitInfo")
        const runtimeFileRead = vi.spyOn(codeStore, "readProductProjectFile")
        const runtimeFuzzySearch = vi.spyOn(codeStore, "fuzzySearchProductProjectFiles")

        try {
            await codeStore.initializeRuntimeProductStore()
            await codeStore.loadRuntimeProductTask("repo-1", "task-1")

            const taskModel = codeStore.tasks.getTaskModel("task-1")
            if (!taskModel) throw new Error("Expected runtime task model")
            const loadEnvironment = vi.spyOn(taskModel, "loadEnvironment")

            expect(taskModel.taskWorkingDirHint).toBe("/tmp/runtime-worktree/packages/web")
            await expect(taskModel.ensureTaskWorkingDirHint()).resolves.toBe("/tmp/runtime-worktree/packages/web")
            expect(runtimeGitInfoRead).not.toHaveBeenCalled()
            await expect(resolveTaskListCopyPath({ codeStore, workspaceId: "repo-1", selectedTaskId: "task-1" })).resolves.toBe(
                "/tmp/runtime-worktree/packages/web"
            )
            expect(loadEnvironment).not.toHaveBeenCalled()
            expect(runtimeGitInfoRead).not.toHaveBeenCalled()
            expect(taskModel.fileBrowser.workingDir).toBe("/tmp/runtime-worktree/packages/web")
            expect(taskModel.contentSearch.workingDir).toBe("/tmp/runtime-worktree/packages/web")

            const editorManager = codeStore.smartEditors.getManager("task-task-1", "repo-1")
            await expect(editorManager.searchFileMentions("/tmp/runtime-worktree/packages/web", "runtime", 20)).resolves.toEqual({
                results: ["src/runtime-search.ts"],
                treeMatch: null,
            })
            await expect(editorManager.searchFileMentions("/tmp/runtime-repo", "runtime", 20)).resolves.toEqual({ results: [], treeMatch: null })
            expect(editorManager.canSearchFileMentions("/tmp/runtime-repo")).toBe(false)

            await taskModel.fileBrowser.openFileReference("runtime-search.ts", {
                line: 2,
            })

            await vi.waitFor(() => {
                expect(taskModel.fileBrowser.activeFileData?.content).toBe(runtimeSearchFixture.content)
            })
            expect(runtimeFuzzySearch).toHaveBeenCalledWith({
                repoId: "repo-1",
                taskId: "task-1",
                query: "runtime-search.ts",
                matchDirs: false,
                limit: 12,
                includeHidden: true,
                includeGenerated: true,
            })
            expect(runtimeFileRead).toHaveBeenCalledWith({
                repoId: "repo-1",
                taskId: "task-1",
                path: "src/runtime-search.ts",
                maxBytes: 5 * 1024 * 1024,
            })
            expect(legacyDescribePath).not.toHaveBeenCalled()
        } finally {
            if (previousDeviceId === null) localStorage.removeItem("openade-device-id")
            else localStorage.setItem("openade-device-id", previousDeviceId)
            runtimeFileRead.mockRestore()
            runtimeFuzzySearch.mockRestore()
            legacyDescribePath.mockRestore()
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("loads classic cron definitions through runtime cron definition reads", async () => {
        const { client, runtime } = createRuntimeBackedClient({
            project: { ...project, path: "/tmp/runtime-repo" },
            task: { ...task, isolationStrategy: { type: "head" } },
        })
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })

        try {
            await codeStore.initializeRuntimeProductStore()
            const runtimeProcessList = vi.spyOn(codeStore, "listProductProjectProcesses")
            const runtimeCronDefinitions = vi.spyOn(codeStore, "readProductCronDefinitions")

            await codeStore.crons.startAll()
            await codeStore.crons.ensureRepoConfigLoaded("repo-1")

            expect(runtimeCronDefinitions).toHaveBeenCalledWith({ repoId: "repo-1" })
            expect(runtimeProcessList).not.toHaveBeenCalled()
            expect(codeStore.crons.getCronsForRepo("repo-1")).toEqual([
                expect.objectContaining({
                    repoId: "repo-1",
                    configFilePath: "/tmp/runtime-repo/openade.toml",
                    def: expect.objectContaining({
                        id: "openade.toml::Runtime Cron",
                        name: "Runtime Cron",
                        prompt: "Run runtime cron",
                    }),
                }),
            ])
            runtimeCronDefinitions.mockRestore()
            runtimeProcessList.mockRestore()
        } finally {
            codeStore.crons.stop()
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("skips runtime cron definition and install-state reads when cron read capabilities are absent", async () => {
        const { client, runtime } = createRuntimeBackedClient(
            {
                ...createBridgeState(),
                project: { ...project, path: "/tmp/runtime-repo" },
                task: { ...task, isolationStrategy: { type: "head" } },
            },
            allOpenADEMethodPermissionsExcept([OPENADE_METHOD.cronDefinitionsRead, OPENADE_METHOD.cronInstallStateRead])
        )
        const runtimeRequest = vi.spyOn(runtime, "requestWithOptions")
        const legacyLoad = vi.spyOn(dataFolderApi, "load").mockRejectedValue(new Error("legacy cron data folder should not be used"))
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })

        try {
            await codeStore.initializeRuntimeProductStore()
            expect(codeStore.canUseProductMethod(OPENADE_METHOD.cronDefinitionsRead)).toBe(false)
            expect(codeStore.canUseProductMethod(OPENADE_METHOD.cronInstallStateRead)).toBe(false)
            runtimeRequest.mockClear()

            await codeStore.crons.ensureRepoConfigLoaded("repo-1")

            const requestedMethods = runtimeRequest.mock.calls.map((call) => call[0])
            expect(requestedMethods).not.toContain(OPENADE_METHOD.cronDefinitionsRead)
            expect(requestedMethods).not.toContain(OPENADE_METHOD.cronInstallStateRead)
            expect(legacyLoad).not.toHaveBeenCalled()
            expect(codeStore.crons.getCronsForRepo("repo-1")).toEqual([])
        } finally {
            runtimeRequest.mockRestore()
            legacyLoad.mockRestore()
            codeStore.crons.stop()
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("persists classic cron install state through runtime product APIs without data-folder reads", async () => {
        const { client, runtime, state } = createRuntimeBackedClient({
            project: { ...project, path: "/tmp/runtime-repo" },
            task: { ...task, isolationStrategy: { type: "head" } },
            cronInstallStates: {
                "repo-1": {
                    "openade.toml::Runtime Cron": {
                        cronId: "openade.toml::Runtime Cron",
                        enabled: false,
                        installedAt: "2026-05-30T00:00:00.000Z",
                    },
                },
            },
        })
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })
        const legacyLoad = vi.spyOn(dataFolderApi, "load").mockRejectedValue(new Error("legacy cron data folder should not be used"))
        const legacySave = vi.spyOn(dataFolderApi, "save").mockRejectedValue(new Error("legacy cron data folder should not be used"))
        const runtimeProcessList = vi.spyOn(codeStore, "listProductProjectProcesses")
        const runtimeCronDefinitions = vi.spyOn(codeStore, "readProductCronDefinitions")

        try {
            await codeStore.initializeRuntimeProductStore()

            await codeStore.crons.ensureRepoConfigLoaded("repo-1")
            expect(runtimeCronDefinitions).toHaveBeenCalledWith({ repoId: "repo-1" })
            expect(runtimeProcessList).not.toHaveBeenCalled()
            expect(codeStore.crons.getCronsForRepo("repo-1")).toEqual([
                expect.objectContaining({
                    def: expect.objectContaining({ id: "openade.toml::Runtime Cron" }),
                    installed: true,
                    enabled: false,
                }),
            ])

            await codeStore.crons.toggleCron("repo-1", "openade.toml::Runtime Cron", true)
            expect(state.cronInstallStates?.["repo-1"]?.["openade.toml::Runtime Cron"]).toEqual(
                expect.objectContaining({
                    cronId: "openade.toml::Runtime Cron",
                    enabled: true,
                    installedAt: "2026-05-30T00:00:00.000Z",
                })
            )
            expect(legacyLoad).not.toHaveBeenCalled()
            expect(legacySave).not.toHaveBeenCalled()
        } finally {
            runtimeCronDefinitions.mockRestore()
            runtimeProcessList.mockRestore()
            legacyLoad.mockRestore()
            legacySave.mockRestore()
            codeStore.crons.stop()
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("opens the classic cron editor with repo-scoped runtime process config access", async () => {
        const { client, runtime, state } = createRuntimeBackedClient({
            project: { ...project, path: "/tmp/runtime-repo" },
            task: { ...task, isolationStrategy: { type: "head" } },
        })
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })
        const runtimeProcessList = vi.spyOn(codeStore, "listProductProjectProcesses")
        const runtimeCronDefinitions = vi.spyOn(codeStore, "readProductCronDefinitions")
        const runtimeProcessStop = vi.spyOn(codeStore, "stopProductProjectProcess")
        const modalShow = vi.spyOn(NiceModal, "show").mockResolvedValue(undefined)
        ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
        const container = document.createElement("div")
        document.body.appendChild(container)
        const root = createRoot(container)

        try {
            await codeStore.initializeRuntimeProductStore()

            await act(async () => {
                root.render(createElement(CodeStoreProvider, { store: codeStore }, createElement(CronsSidebarContent, { workspaceId: "repo-1" })))
            })

            expect(container.textContent).toContain("Add a cron job")
            expect(container.textContent).not.toContain("Runtime Cron")
            expect(runtimeCronDefinitions).not.toHaveBeenCalled()
            expect(runtimeProcessList).not.toHaveBeenCalled()

            const addCronButton = Array.from(container.querySelectorAll("button")).find((candidate) => candidate.textContent === "Add a cron job")
            if (!(addCronButton instanceof HTMLButtonElement)) throw new Error("Add cron button was not rendered")
            await act(async () => {
                addCronButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
            })
            await vi.waitFor(() => {
                expect(runtimeCronDefinitions).toHaveBeenCalledWith({
                    repoId: "repo-1",
                })
                expect(modalShow).toHaveBeenCalled()
                expect(runtimeProcessList).not.toHaveBeenCalled()
            })

            type CronEditorModalProps = {
                initialTab?: string
                initialFilePath?: string
                productScope?: { repoId: string; taskId?: string } | null
                productAccess?: ProductProjectProcessAccess | null
            }
            const shownProps = modalShow.mock.calls.at(-1)?.[1] as CronEditorModalProps | undefined
            expect(shownProps).toEqual(
                expect.objectContaining({
                    initialTab: "crons",
                    initialFilePath: undefined,
                    productScope: { repoId: "repo-1" },
                    productAccess: expect.any(Object),
                })
            )

            state.projectProcess = {
                processId: "process-runtime-test",
                running: true,
                output: [],
                stopped: false,
            }
            await shownProps?.productAccess?.stopProjectProcess({
                processId: "process-runtime-test",
            })

            expect(runtimeProcessStop).toHaveBeenCalledWith({
                repoId: "repo-1",
                taskId: undefined,
                processId: "process-runtime-test",
            })
            expect(state.projectProcess.stopped).toBe(true)
        } finally {
            act(() => root.unmount())
            container.remove()
            runtimeCronDefinitions.mockRestore()
            runtimeProcessList.mockRestore()
            runtimeProcessStop.mockRestore()
            modalShow.mockRestore()
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("loads classic process editor files through scoped runtime project reads", async () => {
        const { client, runtime } = createRuntimeBackedClient({
            project: { ...project, path: "/tmp/runtime-repo" },
            task: { ...task, isolationStrategy: { type: "head" } },
        })
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })
        const runtimeProcessList = vi.spyOn(codeStore, "listProductProjectProcesses")
        const runtimeFileRead = vi.spyOn(codeStore, "readProductProjectFile")
        const productScope = { repoId: "repo-1" }

        try {
            await codeStore.initializeRuntimeProductStore()

            const configs = await readProcsEditorConfigs({
                codeStore,
                searchPath: "/tmp/runtime-repo",
                productScope,
            })
            expect(runtimeProcessList).toHaveBeenCalledWith({
                repoId: "repo-1",
                taskId: undefined,
            })
            expect(configs.configs[0]?.relativePath).toBe("openade.toml")

            const editable = await loadProcsEditorFile({
                codeStore,
                filePath: "/tmp/runtime-repo/openade.toml",
                repoRoot: configs.repoRoot,
                searchPath: "/tmp/runtime-repo",
                productScope,
            })

            expect(runtimeFileRead).toHaveBeenCalledWith({
                repoId: "repo-1",
                taskId: undefined,
                path: "openade.toml",
                encoding: "utf8",
            })
            expect(editable).toEqual(
                expect.objectContaining({
                    filePath: "/tmp/runtime-repo/openade.toml",
                    relativePath: "openade.toml",
                    processes: [
                        expect.objectContaining({
                            name: "Runtime Process",
                            command: "printf runtime-process",
                            type: "task",
                        }),
                    ],
                    crons: [
                        expect.objectContaining({
                            name: "Runtime Cron",
                            prompt: "Run runtime cron",
                            reuseTask: false,
                        }),
                    ],
                    rawContent: expect.stringContaining("[[cron]]"),
                })
            )

            await expect(
                parseProcsEditorRaw({
                    rawContent: editable.rawContent,
                    relativePath: editable.relativePath,
                    productScope,
                })
            ).resolves.toEqual(
                expect.objectContaining({
                    processes: [expect.objectContaining({ name: "Runtime Process" })],
                    crons: [expect.objectContaining({ name: "Runtime Cron" })],
                })
            )

            await expect(
                serializeProcsEditorRaw({
                    processes: editable.processes,
                    crons: editable.crons,
                    productScope,
                })
            ).resolves.toContain('command = "printf runtime-process"')
        } finally {
            runtimeProcessList.mockRestore()
            runtimeFileRead.mockRestore()
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("does not issue stale classic process editor discovery reads when project process list is unavailable", async () => {
        const state = createBridgeState()
        state.project = { ...project, path: "/tmp/runtime-repo" }
        state.task = { ...task, isolationStrategy: { type: "head" } }
        const { client, runtime } = createRuntimeBackedClient(state, [OPENADE_METHOD.snapshotRead, OPENADE_METHOD.taskRead, "initialize"])
        const runtimeRequest = vi.spyOn(runtime, "requestWithOptions")
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })
        const runtimeProcessList = vi.spyOn(codeStore, "listProductProjectProcesses")

        try {
            await codeStore.initializeRuntimeProductStore()
            expect(codeStore.canUseProductMethod(OPENADE_METHOD.projectProcessList)).toBe(false)
            runtimeRequest.mockClear()

            const configs = await readProcsEditorConfigs({
                codeStore,
                searchPath: "/tmp/runtime-repo",
                productScope: { repoId: "repo-1" },
            })

            expect(configs).toEqual({
                repoRoot: "/tmp/runtime-repo",
                searchRoot: "/tmp/runtime-repo",
                isWorktree: false,
                configs: [],
                errors: [],
            })
            expect(runtimeProcessList).not.toHaveBeenCalled()
            expect(runtimeRequest.mock.calls.map((call) => call[0])).not.toContain(OPENADE_METHOD.projectProcessList)
        } finally {
            runtimeRequest.mockRestore()
            runtimeProcessList.mockRestore()
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("does not issue stale classic process editor file reads when project file read is unavailable", async () => {
        const state = createBridgeState()
        state.project = { ...project, path: "/tmp/runtime-repo" }
        state.task = { ...task, isolationStrategy: { type: "head" } }
        const { client, runtime } = createRuntimeBackedClient(state, allOpenADEMethodPermissionsExcept([OPENADE_METHOD.projectFileRead]))
        const runtimeRequest = vi.spyOn(runtime, "requestWithOptions")
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })
        const runtimeFileRead = vi.spyOn(codeStore, "readProductProjectFile")

        try {
            await codeStore.initializeRuntimeProductStore()
            expect(codeStore.canUseProductMethod(OPENADE_METHOD.projectFileRead)).toBe(false)
            runtimeRequest.mockClear()

            await expect(
                loadProcsEditorFile({
                    codeStore,
                    filePath: "/tmp/runtime-repo/openade.toml",
                    repoRoot: "/tmp/runtime-repo",
                    searchPath: "/tmp/runtime-repo",
                    productScope: { repoId: "repo-1" },
                })
            ).rejects.toThrow("Project file reads are not available from this runtime")

            expect(runtimeFileRead).not.toHaveBeenCalled()
            expect(runtimeRequest.mock.calls.map((call) => call[0])).not.toContain(OPENADE_METHOD.projectFileRead)
        } finally {
            runtimeRequest.mockRestore()
            runtimeFileRead.mockRestore()
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("saves classic process config edits through scoped runtime project file writes", async () => {
        const { client, runtime, state } = createRuntimeBackedClient({
            project: { ...project, path: "/tmp/runtime-repo" },
            task: { ...task, isolationStrategy: { type: "head" } },
        })
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })
        const runtimeFileWrite = vi.spyOn(codeStore, "writeProductProjectFile")
        const runtimeProcessList = vi.spyOn(codeStore, "listProductProjectProcesses")

        try {
            await codeStore.initializeRuntimeProductStore()
            const result = await saveProcsEditorFile({
                codeStore,
                selectedFilePath: "/tmp/runtime-repo/openade.toml",
                relativePath: "openade.toml",
                processes: [{ name: "Runtime Process", type: "task", command: "npm test" }],
                crons: [
                    {
                        name: "Runtime Cron",
                        schedule: "0 9 * * *",
                        type: "do",
                        prompt: "Run runtime cron",
                        reuseTask: false,
                    },
                ],
                searchPath: "/tmp/runtime-repo",
                productScope: { repoId: "repo-1", taskId: "task-1" },
            })

            expect(runtimeFileWrite).toHaveBeenCalledWith({
                repoId: "repo-1",
                taskId: "task-1",
                path: "openade.toml",
                encoding: "utf8",
                content: expect.stringContaining("[[process]]"),
                createDirs: true,
            })
            expect(runtimeProcessList).toHaveBeenCalledWith({
                repoId: "repo-1",
                taskId: "task-1",
            })
            expect(state.projectFileWrites).toEqual([
                expect.objectContaining({
                    repoId: "repo-1",
                    taskId: "task-1",
                    path: "openade.toml",
                    encoding: "utf8",
                    createDirs: true,
                }),
            ])
            expect(state.projectFiles?.get("openade.toml")?.content).toContain('command = "npm test"')
            expect(result?.configs[0]?.relativePath).toBe("openade.toml")
        } finally {
            runtimeFileWrite.mockRestore()
            runtimeProcessList.mockRestore()
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("saves classic process config edits without post-save process reads when project process list is unavailable", async () => {
        const state = createBridgeState()
        state.project = { ...project, path: "/tmp/runtime-repo" }
        state.task = { ...task, isolationStrategy: { type: "head" } }
        const { client, runtime } = createRuntimeBackedClient(state, allOpenADEMethodPermissionsExcept([OPENADE_METHOD.projectProcessList]))
        const runtimeRequest = vi.spyOn(runtime, "requestWithOptions")
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })
        const runtimeFileWrite = vi.spyOn(codeStore, "writeProductProjectFile")
        const runtimeProcessList = vi.spyOn(codeStore, "listProductProjectProcesses")

        try {
            await codeStore.initializeRuntimeProductStore()
            expect(codeStore.canUseProductMethod(OPENADE_METHOD.projectFileWrite)).toBe(true)
            expect(codeStore.canUseProductMethod(OPENADE_METHOD.projectProcessList)).toBe(false)
            runtimeRequest.mockClear()

            const result = await saveProcsEditorFile({
                codeStore,
                selectedFilePath: "/tmp/runtime-repo/openade.toml",
                relativePath: "openade.toml",
                processes: [{ name: "Runtime Process", type: "task", command: "npm test" }],
                crons: [],
                searchPath: "/tmp/runtime-repo",
                productScope: { repoId: "repo-1", taskId: "task-1" },
            })

            expect(result).toBeNull()
            expect(runtimeFileWrite).toHaveBeenCalledWith({
                repoId: "repo-1",
                taskId: "task-1",
                path: "openade.toml",
                encoding: "utf8",
                content: expect.stringContaining("[[process]]"),
                createDirs: true,
            })
            expect(runtimeProcessList).not.toHaveBeenCalled()
            expect(runtimeRequest.mock.calls.map((call) => call[0])).toContain(OPENADE_METHOD.projectFileWrite)
            expect(runtimeRequest.mock.calls.map((call) => call[0])).not.toContain(OPENADE_METHOD.projectProcessList)
            expect(state.projectFiles?.get("openade.toml")?.content).toContain('command = "npm test"')
        } finally {
            runtimeRequest.mockRestore()
            runtimeFileWrite.mockRestore()
            runtimeProcessList.mockRestore()
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("refuses classic process config saves when project file write is unavailable", async () => {
        const state = createBridgeState()
        state.project = { ...project, path: "/tmp/runtime-repo" }
        state.task = { ...task, isolationStrategy: { type: "head" } }
        const { client, runtime } = createRuntimeBackedClient(state, [OPENADE_METHOD.snapshotRead, "initialize"])
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })
        const runtimeFileWrite = vi.spyOn(codeStore, "writeProductProjectFile")
        const runtimeProcessList = vi.spyOn(codeStore, "listProductProjectProcesses")

        try {
            await codeStore.initializeRuntimeProductStore()

            await expect(
                saveProcsEditorFile({
                    codeStore,
                    selectedFilePath: "/tmp/runtime-repo/openade.toml",
                    relativePath: "openade.toml",
                    processes: [{ name: "Runtime Process", type: "task", command: "npm test" }],
                    crons: [],
                    searchPath: "/tmp/runtime-repo",
                    productScope: { repoId: "repo-1", taskId: "task-1" },
                })
            ).rejects.toThrow("Project file writes are not available from this runtime")

            expect(codeStore.canUseProductMethod(OPENADE_METHOD.projectFileWrite)).toBe(false)
            expect(runtimeFileWrite).not.toHaveBeenCalled()
            expect(runtimeProcessList).not.toHaveBeenCalled()
            expect(state.projectFileWrites ?? []).toEqual([])
        } finally {
            runtimeFileWrite.mockRestore()
            runtimeProcessList.mockRestore()
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("does not issue stale classic process tray reads when project process list is unavailable", async () => {
        const state = createBridgeState()
        state.project = { ...project, path: "/tmp/runtime-repo" }
        state.task = { ...task, isolationStrategy: { type: "head" } }
        const { client, runtime } = createRuntimeBackedClient(state, [OPENADE_METHOD.snapshotRead, OPENADE_METHOD.taskRead, "initialize"])
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })
        const runtimeProcessList = vi.spyOn(codeStore, "listProductProjectProcesses")
        ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
        const container = document.createElement("div")
        document.body.appendChild(container)
        const root = createRoot(container)

        try {
            await codeStore.initializeRuntimeProductStore()
            await codeStore.loadRuntimeProductTask("repo-1", "task-1")
            expect(codeStore.canUseProductMethod(OPENADE_METHOD.projectProcessList)).toBe(false)

            await act(async () => {
                root.render(
                    createElement(
                        CodeStoreProvider,
                        { store: codeStore },
                        createElement(ProcessesTray, {
                            searchPath: "/tmp/runtime-repo",
                            context: { type: "repo", root: "/tmp/runtime-repo" },
                            workspaceId: "repo-1",
                            isOpen: true,
                            productScope: { repoId: "repo-1", taskId: "task-1" },
                        })
                    )
                )
                await new Promise((resolve) => setTimeout(resolve, 20))
            })

            expect(runtimeProcessList).not.toHaveBeenCalled()
            expect(container.textContent).not.toContain("Runtime Process")
        } finally {
            act(() => root.unmount())
            container.remove()
            runtimeProcessList.mockRestore()
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("does not reload the open classic process tray when equivalent context props are recreated", async () => {
        const { client, runtime } = createRuntimeBackedClient({
            project: { ...project, path: "/tmp/runtime-repo" },
            task: { ...task, isolationStrategy: { type: "head" } },
        })
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })
        const runtimeProcessList = vi.spyOn(codeStore, "listProductProjectProcesses")
        ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
        const container = document.createElement("div")
        document.body.appendChild(container)
        const root = createRoot(container)

        const renderTray = () => {
            root.render(
                createElement(
                    CodeStoreProvider,
                    { store: codeStore },
                    createElement(ProcessesTray, {
                        searchPath: "/tmp/runtime-repo",
                        context: { type: "repo", root: "/tmp/runtime-repo" },
                        workspaceId: "repo-1",
                        isOpen: true,
                        productScope: { repoId: "repo-1", taskId: "task-1" },
                    })
                )
            )
        }

        try {
            await codeStore.initializeRuntimeProductStore()
            await codeStore.loadRuntimeProductTask("repo-1", "task-1")

            await act(async () => {
                renderTray()
            })
            await vi.waitFor(() => {
                expect(container.textContent).toContain("Runtime Process")
                expect(runtimeProcessList).toHaveBeenCalledTimes(1)
            })

            runtimeProcessList.mockClear()
            await act(async () => {
                renderTray()
                await new Promise((resolve) => setTimeout(resolve, 20))
            })

            expect(runtimeProcessList).not.toHaveBeenCalled()
        } finally {
            act(() => root.unmount())
            container.remove()
            runtimeProcessList.mockRestore()
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("routes classic processes tray actions through task-scoped runtime project methods", async () => {
        const { client, runtime, state } = createRuntimeBackedClient({
            project: { ...project, path: "/tmp/runtime-repo" },
            task: { ...task, isolationStrategy: { type: "head" } },
        })
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })
        const rawProcessStart = vi.spyOn(ProcessHandle, "startScript").mockRejectedValue(new Error("legacy process start should not be used"))
        const runtimeProcessList = vi.spyOn(codeStore, "listProductProjectProcesses")
        const runtimeProcessStart = vi.spyOn(codeStore, "startProductProjectProcess")
        const runtimeProcessReconnect = vi.spyOn(codeStore, "reconnectProductProjectProcess")
        const runtimeProcessStop = vi.spyOn(codeStore, "stopProductProjectProcess")
        ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
        const container = document.createElement("div")
        document.body.appendChild(container)
        const root = createRoot(container)

        const clickButtonByTitle = (title: string) => {
            const button = Array.from(container.querySelectorAll("button")).find((candidate) => candidate.title === title)
            if (!(button instanceof HTMLButtonElement)) throw new Error(`Button titled "${title}" was not rendered`)
            button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
        }

        try {
            await codeStore.initializeRuntimeProductStore()
            await codeStore.loadRuntimeProductTask("repo-1", "task-1")

            await act(async () => {
                root.render(
                    createElement(
                        CodeStoreProvider,
                        { store: codeStore },
                        createElement(ProcessesTray, {
                            searchPath: "/tmp/runtime-repo",
                            context: { type: "repo", root: "/tmp/runtime-repo" },
                            workspaceId: "repo-1",
                            isOpen: true,
                            productScope: { repoId: "repo-1", taskId: "task-1" },
                        })
                    )
                )
            })

            await vi.waitFor(() => {
                expect(container.textContent).toContain("Runtime Process")
                expect(runtimeProcessList).toHaveBeenCalledWith({
                    repoId: "repo-1",
                    taskId: "task-1",
                })
            })

            await act(async () => {
                clickButtonByTitle("Start")
            })

            await vi.waitFor(() => {
                expect(container.textContent).toContain("runtime process output")
                expect(runtimeProcessStart).toHaveBeenCalledWith({
                    repoId: "repo-1",
                    taskId: "task-1",
                    definitionId: "openade.toml::Runtime Process",
                })
                expect(runtimeProcessReconnect).toHaveBeenCalledWith({
                    repoId: "repo-1",
                    taskId: "task-1",
                    processId: "process-runtime-test",
                })
            })

            await act(async () => {
                clickButtonByTitle("Stop")
            })

            await vi.waitFor(() => {
                expect(runtimeProcessStop).toHaveBeenCalledWith({
                    repoId: "repo-1",
                    taskId: "task-1",
                    processId: "process-runtime-test",
                })
                expect(state.projectProcess?.stopped).toBe(true)
            })
            expect(rawProcessStart).not.toHaveBeenCalled()
        } finally {
            act(() => root.unmount())
            container.remove()
            rawProcessStart.mockRestore()
            runtimeProcessList.mockRestore()
            runtimeProcessStart.mockRestore()
            runtimeProcessReconnect.mockRestore()
            runtimeProcessStop.mockRestore()
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("reconnects existing runtime project process output from the classic processes tray", async () => {
        const { client, runtime, state } = createRuntimeBackedClient({
            project: { ...project, path: "/tmp/runtime-repo" },
            task: { ...task, isolationStrategy: { type: "head" } },
        })
        state.projectProcess = {
            processId: "process-runtime-test",
            running: true,
            output: ["existing runtime process output\n"],
            stopped: false,
        }
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })
        const rawProcessStart = vi.spyOn(ProcessHandle, "startScript").mockRejectedValue(new Error("legacy process start should not be used"))
        const runtimeProcessReconnect = vi.spyOn(codeStore, "reconnectProductProjectProcess")
        ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
        const container = document.createElement("div")
        document.body.appendChild(container)
        const root = createRoot(container)

        try {
            await codeStore.initializeRuntimeProductStore()
            await codeStore.loadRuntimeProductTask("repo-1", "task-1")

            await act(async () => {
                root.render(
                    createElement(
                        CodeStoreProvider,
                        { store: codeStore },
                        createElement(ProcessesTray, {
                            searchPath: "/tmp/runtime-repo",
                            context: { type: "repo", root: "/tmp/runtime-repo" },
                            workspaceId: "repo-1",
                            isOpen: true,
                            productScope: { repoId: "repo-1", taskId: "task-1" },
                        })
                    )
                )
            })

            await vi.waitFor(() => {
                expect(container.textContent).toContain("Runtime Process")
            })

            const label = Array.from(container.querySelectorAll("span")).find((candidate) => candidate.textContent === "Runtime Process")
            if (!label) throw new Error("Runtime process row label was not rendered")

            await act(async () => {
                label.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
            })

            await vi.waitFor(() => {
                expect(container.textContent).toContain("existing runtime process output")
                expect(runtimeProcessReconnect).toHaveBeenCalledWith({
                    repoId: "repo-1",
                    taskId: "task-1",
                    processId: "process-runtime-test",
                })
            })
            expect(rawProcessStart).not.toHaveBeenCalled()
        } finally {
            act(() => root.unmount())
            container.remove()
            rawProcessStart.mockRestore()
            runtimeProcessReconnect.mockRestore()
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("stops stale runtime-owned processes through scoped runtime methods after config edits", async () => {
        const { client, runtime, state } = createRuntimeBackedClient({
            project: { ...project, path: "/tmp/runtime-repo" },
            task: { ...task, isolationStrategy: { type: "head" } },
        })
        state.projectProcess = {
            processId: "process-runtime-test",
            running: true,
            output: ["existing runtime process output\n"],
            stopped: false,
        }
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })
        const runtimeProcessStop = vi.spyOn(codeStore, "stopProductProjectProcess")
        const context = { type: "repo" as const, root: "/tmp/runtime-repo" }
        const productAccess = {
            canStartProjectProcess: true,
            canReconnectProjectProcess: true,
            canStopProjectProcess: true,
            startProjectProcess: (args: { definitionId: string }) =>
                codeStore.startProductProjectProcess({
                    repoId: "repo-1",
                    taskId: "task-1",
                    definitionId: args.definitionId,
                }),
            reconnectProjectProcess: (args: { processId: string }) =>
                codeStore.reconnectProductProjectProcess({
                    repoId: "repo-1",
                    taskId: "task-1",
                    processId: args.processId,
                }),
            stopProjectProcess: (args: { processId: string }) =>
                codeStore.stopProductProjectProcess({
                    repoId: "repo-1",
                    taskId: "task-1",
                    processId: args.processId,
                }),
        }

        try {
            await codeStore.initializeRuntimeProductStore()
            const result = await codeStore.listProductProjectProcesses({
                repoId: "repo-1",
                taskId: "task-1",
            })
            codeStore.repoProcesses.syncProductProcesses(context, readProcsResultFromProductProcesses(result), result)

            expect(codeStore.repoProcesses.getProcessesForContext(context).map((instance) => instance.id)).toEqual(["openade.toml::Runtime Process"])

            await codeStore.repoProcesses.stopProcessesMissingFromConfig({
                context,
                validProcessIds: new Set(),
                productAccess,
            })

            expect(runtimeProcessStop).toHaveBeenCalledWith({
                repoId: "repo-1",
                taskId: "task-1",
                processId: "process-runtime-test",
            })
            expect(state.projectProcess.stopped).toBe(true)
            expect(codeStore.repoProcesses.getProcessesForContext(context)).toEqual([])
        } finally {
            runtimeProcessStop.mockRestore()
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("does not call unavailable runtime changes methods from a stale classic changes manager", async () => {
        const { client, runtime } = createRuntimeBackedClient(
            createBridgeState(),
            allOpenADEMethodPermissionsExcept([OPENADE_METHOD.taskChangesRead, OPENADE_METHOD.taskDiffRead, OPENADE_METHOD.taskFilePairRead])
        )
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })
        const runtimeChangesRead = vi.spyOn(codeStore, "readProductTaskChanges")
        const runtimeDiffRead = vi.spyOn(codeStore, "readProductTaskDiff")
        const runtimeFilePairRead = vi.spyOn(codeStore, "readProductTaskFilePair")
        const legacyChangedFiles = vi.spyOn(gitApi, "getChangedFiles").mockRejectedValue(new Error("legacy changed-files read should not be used"))
        const legacyDiffRead = vi.spyOn(gitApi, "getWorktreeFilePatch").mockRejectedValue(new Error("legacy diff read should not be used"))
        const legacyFilePairRead = vi.spyOn(gitApi, "getFilePair").mockRejectedValue(new Error("legacy file-pair read should not be used"))

        try {
            await codeStore.initializeRuntimeProductStore()
            await codeStore.loadRuntimeProductTask("repo-1", "task-1")
            expect(codeStore.canUseProductMethod(OPENADE_METHOD.taskChangesRead)).toBe(false)
            expect(codeStore.canUseProductMethod(OPENADE_METHOD.taskDiffRead)).toBe(false)
            expect(codeStore.canUseProductMethod(OPENADE_METHOD.taskFilePairRead)).toBe(false)

            const taskModel = codeStore.tasks.getTaskModel("task-1")
            if (!taskModel) throw new Error("Expected runtime task model")
            await taskModel.refreshGitState({ force: true })
            expect(taskModel.gitStatus?.hasChanges).toBe(true)

            const changes = taskModel.changes
            changes.initializeForTray()
            changes.ensureSelectedFileLoaded("current")
            changes.ensureSelectedFileLoaded("unified", 3)
            changes.setDiffSource("from-base")

            await new Promise((resolve) => setTimeout(resolve, 0))

            expect(runtimeChangesRead).not.toHaveBeenCalled()
            expect(runtimeDiffRead).not.toHaveBeenCalled()
            expect(runtimeFilePairRead).not.toHaveBeenCalled()
            expect(legacyChangedFiles).not.toHaveBeenCalled()
            expect(legacyDiffRead).not.toHaveBeenCalled()
            expect(legacyFilePairRead).not.toHaveBeenCalled()
            expect(changes.filePair).toBeNull()
            expect(changes.filePatch).toBeNull()
            expect(changes.fromBaseFiles).toBeNull()
        } finally {
            runtimeChangesRead.mockRestore()
            runtimeDiffRead.mockRestore()
            runtimeFilePairRead.mockRestore()
            legacyChangedFiles.mockRestore()
            legacyDiffRead.mockRestore()
            legacyFilePairRead.mockRestore()
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("routes classic git log reads through the runtime product store", async () => {
        const { client, runtime } = createRuntimeBackedClient()
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })
        const branchRead = vi.spyOn(gitApi, "listBranches").mockRejectedValue(new Error("legacy branch list should not be used"))
        const worktreeRead = vi.spyOn(gitApi, "listWorkTrees").mockRejectedValue(new Error("legacy worktree list should not be used"))
        const legacyLogRead = vi.spyOn(gitApi, "getLog").mockRejectedValue(new Error("legacy git log read should not be used"))
        const legacyCommitFilesRead = vi.spyOn(gitApi, "getCommitFiles").mockRejectedValue(new Error("legacy commit-file read should not be used"))
        const legacyCommitPatchRead = vi.spyOn(gitApi, "getCommitFilePatch").mockRejectedValue(new Error("legacy commit patch read should not be used"))
        const runtimeScopeRead = vi.spyOn(codeStore, "readProductTaskGitScopes")
        const runtimeGitLogRead = vi.spyOn(codeStore, "readProductTaskGitLog")
        const runtimeCommitFilesRead = vi.spyOn(codeStore, "readProductTaskGitCommitFiles")
        const runtimeCommitPatchRead = vi.spyOn(codeStore, "readProductTaskGitCommitFilePatch")
        ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
        const container = document.createElement("div")
        document.body.appendChild(container)
        const root = createRoot(container)

        try {
            await codeStore.initializeRuntimeProductStore()
            await codeStore.loadRuntimeProductTask("repo-1", "task-1")

            await act(async () => {
                root.render(
                    createElement(
                        CodeStoreProvider,
                        { store: codeStore },
                        createElement(GitLogTray, {
                            taskId: "task-1",
                            workDir: "/tmp/runtime-repo",
                            currentBranch: "main",
                            className: "h-full",
                        })
                    )
                )
            })

            await vi.waitFor(() => {
                expect(container.textContent).toContain("Runtime product store commit")
                expect(runtimeScopeRead).toHaveBeenCalledWith({
                    repoId: "repo-1",
                    taskId: "task-1",
                    includeRemote: true,
                })
                expect(runtimeGitLogRead).toHaveBeenCalledWith({
                    repoId: "repo-1",
                    taskId: "task-1",
                    ref: "HEAD",
                    scopeId: undefined,
                    limit: 50,
                    skip: 0,
                })
                expect(runtimeCommitFilesRead).toHaveBeenCalledWith({
                    repoId: "repo-1",
                    taskId: "task-1",
                    commit: "abc123456789",
                })
                expect(runtimeCommitPatchRead).toHaveBeenCalledWith({
                    repoId: "repo-1",
                    taskId: "task-1",
                    commit: "abc123456789",
                    filePath: "README.md",
                    oldPath: undefined,
                    contextLines: 3,
                })
            })
            expect(branchRead).not.toHaveBeenCalled()
            expect(worktreeRead).not.toHaveBeenCalled()
            expect(legacyLogRead).not.toHaveBeenCalled()
            expect(legacyCommitFilesRead).not.toHaveBeenCalled()
            expect(legacyCommitPatchRead).not.toHaveBeenCalled()
        } finally {
            act(() => root.unmount())
            container.remove()
            runtimeScopeRead.mockRestore()
            runtimeGitLogRead.mockRestore()
            runtimeCommitFilesRead.mockRestore()
            runtimeCommitPatchRead.mockRestore()
            branchRead.mockRestore()
            worktreeRead.mockRestore()
            legacyLogRead.mockRestore()
            legacyCommitFilesRead.mockRestore()
            legacyCommitPatchRead.mockRestore()
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("does not append delayed git log pagination after the tray switches task scope", async () => {
        const { client, runtime } = createRuntimeBackedClient()
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })
        const branchRead = vi.spyOn(gitApi, "listBranches").mockRejectedValue(new Error("legacy branch list should not be used"))
        const worktreeRead = vi.spyOn(gitApi, "listWorkTrees").mockRejectedValue(new Error("legacy worktree list should not be used"))
        const legacyLogRead = vi.spyOn(gitApi, "getLog").mockRejectedValue(new Error("legacy git log read should not be used"))
        const delayedPage = createDeferred<OpenADETaskGitLogResult>()
        const runtimeGitLogRead = vi.spyOn(codeStore, "readProductTaskGitLog")
        runtimeGitLogRead.mockImplementation(async (args) => {
            if ((args.skip ?? 0) > 0) return delayedPage.promise
            return {
                repoId: args.repoId,
                taskId: args.taskId,
                commits: [gitLogCommits[0]],
                hasMore: true,
            }
        })
        ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
        const container = document.createElement("div")
        document.body.appendChild(container)
        const root = createRoot(container)

        try {
            await codeStore.initializeRuntimeProductStore()
            await codeStore.loadRuntimeProductTask("repo-1", "task-1")

            await act(async () => {
                root.render(
                    createElement(
                        CodeStoreProvider,
                        { store: codeStore },
                        createElement(GitLogTray, {
                            taskId: "task-1",
                            workDir: "/tmp/runtime-repo",
                            currentBranch: "main",
                            className: "h-full",
                        })
                    )
                )
            })

            await vi.waitFor(() => {
                expect(container.textContent).toContain("Runtime product store commit")
                expect(container.textContent).not.toContain("Stale paged commit")
            })
            const loadMoreButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Load more")
            expect(loadMoreButton).toBeTruthy()

            await act(async () => {
                loadMoreButton?.click()
            })
            await vi.waitFor(() => {
                expect(runtimeGitLogRead).toHaveBeenCalledWith({
                    repoId: "repo-1",
                    taskId: "task-1",
                    ref: "HEAD",
                    scopeId: undefined,
                    limit: 50,
                    skip: 1,
                })
            })

            await act(async () => {
                root.render(
                    createElement(
                        CodeStoreProvider,
                        { store: codeStore },
                        createElement(GitLogTray, {
                            taskId: "task-missing-from-runtime-projection",
                            workDir: "/tmp/runtime-repo",
                            currentBranch: "main",
                            className: "h-full",
                        })
                    )
                )
            })
            await vi.waitFor(() => {
                expect(container.textContent).toContain("Task git context unavailable")
            })

            await act(async () => {
                delayedPage.resolve({
                    repoId: "repo-1",
                    taskId: "task-1",
                    commits: [
                        {
                            ...gitLogCommits[1],
                            message: "Stale paged commit",
                        },
                    ],
                    hasMore: false,
                })
                await Promise.resolve()
            })

            expect(container.textContent).toContain("Task git context unavailable")
            expect(container.textContent).not.toContain("Stale paged commit")
            expect(branchRead).not.toHaveBeenCalled()
            expect(worktreeRead).not.toHaveBeenCalled()
            expect(legacyLogRead).not.toHaveBeenCalled()
        } finally {
            act(() => root.unmount())
            container.remove()
            runtimeGitLogRead.mockRestore()
            branchRead.mockRestore()
            worktreeRead.mockRestore()
            legacyLogRead.mockRestore()
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("does not fall back to raw git log APIs when runtime task git context is unavailable", async () => {
        const { client, runtime } = createRuntimeBackedClient({ ...createBridgeState(), task: null })
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })
        const branchRead = vi.spyOn(gitApi, "listBranches").mockRejectedValue(new Error("legacy branch list should not be used"))
        const worktreeRead = vi.spyOn(gitApi, "listWorkTrees").mockRejectedValue(new Error("legacy worktree list should not be used"))
        const legacyLogRead = vi.spyOn(gitApi, "getLog").mockRejectedValue(new Error("legacy git log read should not be used"))
        const legacyCommitFilesRead = vi.spyOn(gitApi, "getCommitFiles").mockRejectedValue(new Error("legacy commit-file read should not be used"))
        const legacyCommitPatchRead = vi.spyOn(gitApi, "getCommitFilePatch").mockRejectedValue(new Error("legacy commit patch read should not be used"))
        const legacyFileRead = vi.spyOn(gitApi, "getFileAtTreeish").mockRejectedValue(new Error("legacy commit file read should not be used"))
        const runtimeScopeRead = vi.spyOn(codeStore, "readProductTaskGitScopes")
        ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
        const container = document.createElement("div")
        document.body.appendChild(container)
        const root = createRoot(container)

        try {
            await codeStore.initializeRuntimeProductStore()
            expect(codeStore.shouldUseRuntimeProductAPI()).toBe(true)

            await act(async () => {
                root.render(
                    createElement(
                        CodeStoreProvider,
                        { store: codeStore },
                        createElement(GitLogTray, {
                            taskId: "task-missing-from-runtime-projection",
                            workDir: "/tmp/runtime-repo",
                            currentBranch: "main",
                            className: "h-full",
                        })
                    )
                )
            })

            await vi.waitFor(() => {
                expect(container.textContent).toContain("Task git context unavailable")
            })
            expect(runtimeScopeRead).not.toHaveBeenCalled()
            expect(branchRead).not.toHaveBeenCalled()
            expect(worktreeRead).not.toHaveBeenCalled()
            expect(legacyLogRead).not.toHaveBeenCalled()
            expect(legacyCommitFilesRead).not.toHaveBeenCalled()
            expect(legacyCommitPatchRead).not.toHaveBeenCalled()
            expect(legacyFileRead).not.toHaveBeenCalled()
        } finally {
            act(() => root.unmount())
            container.remove()
            runtimeScopeRead.mockRestore()
            branchRead.mockRestore()
            worktreeRead.mockRestore()
            legacyLogRead.mockRestore()
            legacyCommitFilesRead.mockRestore()
            legacyCommitPatchRead.mockRestore()
            legacyFileRead.mockRestore()
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it.each([
        [OPENADE_METHOD.taskGitScopesRead, "Task git scopes unavailable"],
        [OPENADE_METHOD.taskGitLog, "Failed to load commit history"],
        [OPENADE_METHOD.taskGitCommitFilesRead, "Failed to load changed files for commit"],
        [OPENADE_METHOD.taskGitCommitFilePatchRead, "Failed to load diff"],
        [OPENADE_METHOD.taskGitFileAtTreeishRead, "Failed to load file content for diff"],
    ])("does not call unavailable runtime git method %s from a stale-mounted git log tray", async (deniedMethod, expectedMessage) => {
        const { client, runtime } = createRuntimeBackedClient(createBridgeState(), allOpenADEMethodPermissionsExcept([deniedMethod]))
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })
        const branchRead = vi.spyOn(gitApi, "listBranches").mockRejectedValue(new Error("legacy branch list should not be used"))
        const worktreeRead = vi.spyOn(gitApi, "listWorkTrees").mockRejectedValue(new Error("legacy worktree list should not be used"))
        const legacyLogRead = vi.spyOn(gitApi, "getLog").mockRejectedValue(new Error("legacy git log read should not be used"))
        const legacyCommitFilesRead = vi.spyOn(gitApi, "getCommitFiles").mockRejectedValue(new Error("legacy commit-file read should not be used"))
        const legacyCommitPatchRead = vi.spyOn(gitApi, "getCommitFilePatch").mockRejectedValue(new Error("legacy commit patch read should not be used"))
        const legacyFileRead = vi.spyOn(gitApi, "getFileAtTreeish").mockRejectedValue(new Error("legacy commit file read should not be used"))
        const runtimeScopeRead = vi.spyOn(codeStore, "readProductTaskGitScopes")
        const runtimeGitLogRead = vi.spyOn(codeStore, "readProductTaskGitLog")
        const runtimeCommitFilesRead = vi.spyOn(codeStore, "readProductTaskGitCommitFiles")
        const runtimeCommitPatchRead = vi.spyOn(codeStore, "readProductTaskGitCommitFilePatch")
        const runtimeFileRead = vi.spyOn(codeStore, "readProductTaskGitFileAtTreeish")
        ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
        const container = document.createElement("div")
        document.body.appendChild(container)
        const root = createRoot(container)

        try {
            await codeStore.initializeRuntimeProductStore()
            await codeStore.loadRuntimeProductTask("repo-1", "task-1")
            expect(codeStore.canUseProductMethod(deniedMethod)).toBe(false)
            if (deniedMethod === OPENADE_METHOD.taskGitFileAtTreeishRead) {
                codeStore.ui.setViewMode("current")
            }

            await act(async () => {
                root.render(
                    createElement(
                        CodeStoreProvider,
                        { store: codeStore },
                        createElement(GitLogTray, {
                            taskId: "task-1",
                            workDir: "/tmp/runtime-repo",
                            currentBranch: "main",
                            className: "h-full",
                        })
                    )
                )
            })

            await vi.waitFor(() => {
                expect(container.textContent).toContain(expectedMessage)
            })
            if (deniedMethod === OPENADE_METHOD.taskGitScopesRead) {
                expect(runtimeScopeRead).not.toHaveBeenCalled()
            }
            if (deniedMethod === OPENADE_METHOD.taskGitLog) {
                expect(runtimeGitLogRead).not.toHaveBeenCalled()
            }
            if (deniedMethod === OPENADE_METHOD.taskGitCommitFilesRead) {
                expect(runtimeCommitFilesRead).not.toHaveBeenCalled()
            }
            if (deniedMethod === OPENADE_METHOD.taskGitCommitFilePatchRead) {
                expect(runtimeCommitPatchRead).not.toHaveBeenCalled()
            }
            if (deniedMethod === OPENADE_METHOD.taskGitFileAtTreeishRead) {
                expect(runtimeFileRead).not.toHaveBeenCalled()
            }
            expect(branchRead).not.toHaveBeenCalled()
            expect(worktreeRead).not.toHaveBeenCalled()
            expect(legacyLogRead).not.toHaveBeenCalled()
            expect(legacyCommitFilesRead).not.toHaveBeenCalled()
            expect(legacyCommitPatchRead).not.toHaveBeenCalled()
            expect(legacyFileRead).not.toHaveBeenCalled()
        } finally {
            act(() => root.unmount())
            container.remove()
            runtimeScopeRead.mockRestore()
            runtimeGitLogRead.mockRestore()
            runtimeCommitFilesRead.mockRestore()
            runtimeCommitPatchRead.mockRestore()
            runtimeFileRead.mockRestore()
            branchRead.mockRestore()
            worktreeRead.mockRestore()
            legacyLogRead.mockRestore()
            legacyCommitFilesRead.mockRestore()
            legacyCommitPatchRead.mockRestore()
            legacyFileRead.mockRestore()
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("routes classic repo git info, branches, and summary through product project git reads", async () => {
        const { client, runtime } = createRuntimeBackedClient()
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })
        const rawGitInfoRead = vi.spyOn(gitApi, "isGitDirectory").mockRejectedValue(new Error("legacy git info should not be used"))
        const rawBranchRead = vi.spyOn(gitApi, "listBranches").mockRejectedValue(new Error("legacy branch read should not be used"))
        const rawSummaryRead = vi.spyOn(gitApi, "getGitSummary").mockRejectedValue(new Error("legacy summary read should not be used"))
        const rawGhRead = vi.spyOn(gitApi, "checkGhCli").mockRejectedValue(new Error("legacy gh read should not be used"))
        const productInfoRead = vi.spyOn(codeStore, "readProductProjectGitInfo")
        const productBranchRead = vi.spyOn(codeStore, "readProductProjectGitBranches")
        const productSummaryRead = vi.spyOn(codeStore, "readProductProjectGitSummary")

        try {
            await codeStore.initializeRuntimeProductStore()

            const [firstGitInfo, secondGitInfo] = await Promise.all([codeStore.repos.getGitInfo("repo-1"), codeStore.repos.getGitInfo("repo-1")])
            expect(firstGitInfo).toMatchObject({
                repoRoot: "/tmp/runtime-repo",
                relativePath: "",
                mainBranch: "main",
                hasGhCli: false,
            })
            expect(secondGitInfo).toEqual(firstGitInfo)
            expect(productInfoRead).toHaveBeenCalledTimes(1)
            await expect(codeStore.repos.listBranches("repo-1", { includeRemote: true })).resolves.toMatchObject({
                defaultBranch: "main",
                branches: [expect.objectContaining({ name: "main", isDefault: true })],
            })
            await expect(codeStore.repos.getGitSummary("repo-1")).resolves.toMatchObject({
                branch: "main",
                headCommit: "abc123",
                hasChanges: false,
            })
            await expect(codeStore.repos.refreshGhCliStatus("repo-1")).resolves.toBe(false)

            expect(productInfoRead).toHaveBeenCalledWith({ repoId: "repo-1" })
            expect(productBranchRead).toHaveBeenCalledWith({
                repoId: "repo-1",
                includeRemote: true,
            })
            expect(productSummaryRead).toHaveBeenCalledWith({ repoId: "repo-1" })
            expect(rawGitInfoRead).not.toHaveBeenCalled()
            expect(rawBranchRead).not.toHaveBeenCalled()
            expect(rawSummaryRead).not.toHaveBeenCalled()
            expect(rawGhRead).not.toHaveBeenCalled()
        } finally {
            productInfoRead.mockRestore()
            productBranchRead.mockRestore()
            productSummaryRead.mockRestore()
            rawGitInfoRead.mockRestore()
            rawBranchRead.mockRestore()
            rawSummaryRead.mockRestore()
            rawGhRead.mockRestore()
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("does not preflight runtime branch or summary reads through project git info", async () => {
        const { client, runtime, state } = createRuntimeBackedClient({
            ...createBridgeState(),
            projectGitInfoReadCount: 0,
            projectGitBranchesReadCount: 0,
            projectGitSummaryReadCount: 0,
        })
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })
        const rawGitInfoRead = vi.spyOn(gitApi, "isGitDirectory").mockRejectedValue(new Error("legacy git info should not be used"))
        const productInfoRead = vi.spyOn(codeStore, "readProductProjectGitInfo")

        try {
            await codeStore.initializeRuntimeProductStore()

            await expect(codeStore.repos.listBranches("repo-1", { includeRemote: true })).resolves.toMatchObject({
                defaultBranch: "main",
                branches: [expect.objectContaining({ name: "main", isDefault: true })],
            })
            await expect(codeStore.repos.getGitSummary("repo-1")).resolves.toMatchObject({
                branch: "main",
                headCommit: "abc123",
                hasChanges: false,
            })

            expect(state.projectGitInfoReadCount).toBe(0)
            expect(state.projectGitBranchesReadCount).toBe(1)
            expect(state.projectGitSummaryReadCount).toBe(1)
            expect(productInfoRead).not.toHaveBeenCalled()
            expect(rawGitInfoRead).not.toHaveBeenCalled()
        } finally {
            productInfoRead.mockRestore()
            rawGitInfoRead.mockRestore()
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("routes classic task terminal operations through the runtime product store", async () => {
        const { client, runtime, state } = createRuntimeBackedClient()
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })

        try {
            await codeStore.initializeRuntimeProductStore()
            await codeStore.loadRuntimeProductTask("repo-1", "task-1")

            const started = await codeStore.startProductTaskTerminal({
                repoId: "repo-1",
                taskId: "task-1",
                cols: 80,
                rows: 24,
            })
            expect(started).toMatchObject({
                repoId: "repo-1",
                taskId: "task-1",
                terminalId: "openade-task-terminal-runtime-test",
                ok: true,
            })
            await expect(
                codeStore.reconnectProductTaskTerminal({
                    repoId: "repo-1",
                    taskId: "task-1",
                })
            ).resolves.toMatchObject({
                repoId: "repo-1",
                taskId: "task-1",
                terminalId: started.terminalId,
                found: true,
            })

            await expect(
                codeStore.writeProductTaskTerminal({
                    repoId: "repo-1",
                    taskId: "task-1",
                    terminalId: started.terminalId,
                    data: "pwd\n",
                })
            ).resolves.toMatchObject({ ok: true })
            await expect(
                codeStore.reconnectProductTaskTerminal({
                    repoId: "repo-1",
                    taskId: "task-1",
                    terminalId: started.terminalId,
                })
            ).resolves.toMatchObject({
                output: [expect.objectContaining({ data: "runtime terminal wrote: pwd\n" })],
                outputCount: 1,
            })
            await expect(
                codeStore.resizeProductTaskTerminal({
                    repoId: "repo-1",
                    taskId: "task-1",
                    terminalId: started.terminalId,
                    cols: 100,
                    rows: 30,
                })
            ).resolves.toMatchObject({ ok: true })
            await expect(
                codeStore.stopProductTaskTerminal({
                    repoId: "repo-1",
                    taskId: "task-1",
                    terminalId: started.terminalId,
                })
            ).resolves.toMatchObject({
                ok: true,
            })

            expect(state.terminal?.writes).toEqual(["pwd\n"])
            expect(state.terminal?.resizedTo).toEqual({ cols: 100, rows: 30 })
            expect(state.terminal?.exited).toBe(true)
        } finally {
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("routes classic snapshot patch reads through the runtime product store", async () => {
        const { client, runtime, state } = createRuntimeBackedClient()
        if (!state.task) throw new Error("Expected runtime task fixture")
        state.task = {
            ...state.task,
            events: [
                ...state.task.events,
                {
                    id: "snapshot-1",
                    type: "snapshot",
                    status: "completed",
                    createdAt: now,
                    completedAt: now,
                    userInput: "",
                    actionEventId: "event-1",
                    referenceBranch: "main",
                    mergeBaseCommit: "merge-base",
                    fullPatch: "",
                    patchFileId: "patch-1",
                    stats: { filesChanged: 1, insertions: 2, deletions: 1 },
                    files: [],
                },
            ],
        }
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })
        const legacyPatchRead = vi.spyOn(snapshotsApi, "loadPatch").mockRejectedValue(new Error("legacy snapshot patch read should not be used"))
        const legacyIndexRead = vi.spyOn(snapshotsApi, "loadIndex").mockRejectedValue(new Error("legacy snapshot index read should not be used"))
        const legacySliceRead = vi.spyOn(snapshotsApi, "loadPatchSlice").mockRejectedValue(new Error("legacy snapshot slice read should not be used"))
        const runtimeSliceRead = vi.spyOn(codeStore, "readProductTaskSnapshotPatchSlice")
        ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
        const container = document.createElement("div")
        document.body.appendChild(container)
        const root = createRoot(container)

        try {
            await codeStore.initializeRuntimeProductStore()
            await codeStore.loadRuntimeProductTask("repo-1", "task-1")

            const snapshotModel = codeStore.tasks.getTaskModel("task-1")?.events.find((event) => event.id === "snapshot-1") as SnapshotEventModel | undefined
            if (!snapshotModel) throw new Error("Expected snapshot event model")

            await snapshotModel.loadIndex()
            expect(snapshotModel.patchIndex).toEqual(
                expect.objectContaining({
                    files: [
                        expect.objectContaining({
                            path: "README.md",
                            insertions: 2,
                            deletions: 1,
                        }),
                    ],
                })
            )

            await snapshotModel.loadPatch()
            expect(snapshotModel.fullPatch).toContain("+snapshot product store")

            await expect(
                codeStore.readProductTaskSnapshotPatchSlice({
                    repoId: "repo-1",
                    taskId: "task-1",
                    eventId: "snapshot-1",
                    start: 0,
                    end: snapshotPatch.length,
                })
            ).resolves.toMatchObject({
                patch: expect.stringContaining("+snapshot product store"),
            })
            runtimeSliceRead.mockClear()

            await act(async () => {
                root.render(
                    createElement(
                        CodeStoreProvider,
                        { store: codeStore },
                        createElement(ViewPatch, {
                            patchFileId: "patch-1",
                            patchIndex: snapshotModel.patchIndex,
                            taskId: "task-1",
                            snapshotEventId: "snapshot-1",
                        })
                    )
                )
            })

            await vi.waitFor(() => {
                expect(container.textContent).toContain("README.md")
                expect(runtimeSliceRead).toHaveBeenCalledWith({
                    repoId: "repo-1",
                    taskId: "task-1",
                    eventId: "snapshot-1",
                    start: 0,
                    end: snapshotPatch.length,
                })
                expect(container.textContent).not.toContain("Could not load patch preview")
                expect(container.textContent).not.toContain("Loading file diff")
            })
            expect(legacyPatchRead).not.toHaveBeenCalled()
            expect(legacyIndexRead).not.toHaveBeenCalled()
            expect(legacySliceRead).not.toHaveBeenCalled()
        } finally {
            act(() => root.unmount())
            container.remove()
            legacyPatchRead.mockRestore()
            legacyIndexRead.mockRestore()
            legacySliceRead.mockRestore()
            runtimeSliceRead.mockRestore()
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("copies classic snapshot event patches through runtime reads even before the full task model is loaded", async () => {
        const { client, runtime, state } = createRuntimeBackedClient()
        if (!state.task) throw new Error("Expected runtime task fixture")
        state.task = {
            ...state.task,
            events: [
                ...state.task.events,
                {
                    id: "snapshot-1",
                    type: "snapshot",
                    status: "completed",
                    createdAt: now,
                    completedAt: now,
                    userInput: "",
                    actionEventId: "event-1",
                    referenceBranch: "main",
                    mergeBaseCommit: "merge-base",
                    fullPatch: "",
                    patchFileId: "patch-1",
                    stats: { filesChanged: 1, insertions: 2, deletions: 1 },
                    files: [],
                },
            ],
        }
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })
        const legacyPatchRead = vi.spyOn(snapshotsApi, "loadPatch").mockRejectedValue(new Error("legacy snapshot patch read should not be used"))
        const runtimePatchRead = vi.spyOn(codeStore, "readProductTaskSnapshotPatch")
        const writeText = vi.fn<Clipboard["writeText"]>().mockResolvedValue(undefined)
        const previousClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard")
        Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: { writeText },
        })
        const container = document.createElement("div")
        document.body.appendChild(container)
        const root = createRoot(container)

        try {
            await codeStore.initializeRuntimeProductStore()

            await act(async () => {
                root.render(
                    createElement(
                        CodeStoreProvider,
                        { store: codeStore },
                        createElement(SnapshotEventItem, {
                            event: {
                                id: "snapshot-1",
                                type: "snapshot",
                                status: "completed",
                                createdAt: now,
                                completedAt: now,
                                userInput: "",
                                actionEventId: "event-1",
                                referenceBranch: "main",
                                mergeBaseCommit: "merge-base",
                                fullPatch: "",
                                patchFileId: "patch-1",
                                stats: { filesChanged: 1, insertions: 2, deletions: 1 },
                                files: [],
                            },
                            expanded: true,
                            onToggle: () => undefined,
                            taskId: "task-1",
                        })
                    )
                )
            })

            const copyButton = container.querySelector<HTMLButtonElement>('button[title="Copy patch to clipboard"]')
            if (!copyButton) throw new Error("Expected snapshot copy button")

            await act(async () => {
                copyButton.click()
            })

            await vi.waitFor(() => {
                expect(writeText).toHaveBeenCalledWith(expect.stringContaining("+snapshot product store"))
            })
            expect(runtimePatchRead).toHaveBeenCalledWith({
                repoId: "repo-1",
                taskId: "task-1",
                eventId: "snapshot-1",
            })
            expect(legacyPatchRead).not.toHaveBeenCalled()
        } finally {
            act(() => root.unmount())
            container.remove()
            legacyPatchRead.mockRestore()
            runtimePatchRead.mockRestore()
            if (previousClipboard) {
                Object.defineProperty(navigator, "clipboard", previousClipboard)
            } else {
                Reflect.deleteProperty(navigator, "clipboard")
            }
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("does not fall back to raw snapshot APIs when runtime snapshot context is unavailable", async () => {
        const { client, runtime } = createRuntimeBackedClient({ ...createBridgeState(), task: null })
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })
        const legacyPatchRead = vi.spyOn(snapshotsApi, "loadPatch").mockRejectedValue(new Error("legacy snapshot patch read should not be used"))
        const legacyIndexRead = vi.spyOn(snapshotsApi, "loadIndex").mockRejectedValue(new Error("legacy snapshot index read should not be used"))
        const legacySliceRead = vi.spyOn(snapshotsApi, "loadPatchSlice").mockRejectedValue(new Error("legacy snapshot slice read should not be used"))
        const writeText = vi.fn<Clipboard["writeText"]>().mockResolvedValue(undefined)
        const previousClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard")
        Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: { writeText },
        })
        ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
        const container = document.createElement("div")
        document.body.appendChild(container)
        const root = createRoot(container)

        try {
            await codeStore.initializeRuntimeProductStore()
            expect(codeStore.shouldUseRuntimeProductAPI()).toBe(true)

            await act(async () => {
                root.render(
                    createElement(
                        CodeStoreProvider,
                        { store: codeStore },
                        createElement(ViewPatch, {
                            patchFileId: "patch-1",
                            patchIndex: snapshotPatchIndex,
                            taskId: "task-missing-from-runtime-projection",
                            snapshotEventId: "snapshot-1",
                        })
                    )
                )
            })

            await vi.waitFor(() => {
                expect(container.textContent).toContain("Could not load patch preview")
            })

            await act(async () => {
                root.render(
                    createElement(
                        CodeStoreProvider,
                        { store: codeStore },
                        createElement(SnapshotEventItem, {
                            event: {
                                id: "snapshot-1",
                                type: "snapshot",
                                status: "completed",
                                createdAt: now,
                                completedAt: now,
                                userInput: "",
                                actionEventId: "event-1",
                                referenceBranch: "main",
                                mergeBaseCommit: "merge-base",
                                fullPatch: "",
                                patchFileId: "patch-1",
                                stats: { filesChanged: 1, insertions: 2, deletions: 1 },
                                files: [],
                            },
                            expanded: true,
                            onToggle: () => undefined,
                            taskId: "task-missing-from-runtime-projection",
                        })
                    )
                )
            })

            const copyButton = container.querySelector<HTMLButtonElement>('button[title="Copy patch to clipboard"]')
            if (!copyButton) throw new Error("Expected snapshot copy button")

            await act(async () => {
                copyButton.click()
            })

            expect(writeText).not.toHaveBeenCalled()
            expect(legacyPatchRead).not.toHaveBeenCalled()
            expect(legacyIndexRead).not.toHaveBeenCalled()
            expect(legacySliceRead).not.toHaveBeenCalled()
        } finally {
            act(() => root.unmount())
            container.remove()
            legacyPatchRead.mockRestore()
            legacyIndexRead.mockRestore()
            legacySliceRead.mockRestore()
            if (previousClipboard) {
                Object.defineProperty(navigator, "clipboard", previousClipboard)
            } else {
                Reflect.deleteProperty(navigator, "clipboard")
            }
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("does not issue runtime snapshot artifact reads when snapshot read methods are unavailable", async () => {
        const state = createBridgeState()
        if (!state.task) throw new Error("Expected runtime task fixture")
        state.task = {
            ...state.task,
            events: [
                ...state.task.events,
                {
                    id: "snapshot-1",
                    type: "snapshot",
                    status: "completed",
                    createdAt: now,
                    completedAt: now,
                    userInput: "",
                    actionEventId: "event-1",
                    referenceBranch: "main",
                    mergeBaseCommit: "merge-base",
                    fullPatch: "",
                    patchFileId: "patch-1",
                    stats: { filesChanged: 1, insertions: 2, deletions: 1 },
                    files: [],
                },
            ],
        }
        const { client, runtime } = createRuntimeBackedClient(state, ["initialize", OPENADE_METHOD.snapshotRead, OPENADE_METHOD.taskRead])
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })
        const runtimePatchRead = vi.spyOn(codeStore, "readProductTaskSnapshotPatch")
        const runtimeIndexRead = vi.spyOn(codeStore, "readProductTaskSnapshotIndex")
        const runtimeSliceRead = vi.spyOn(codeStore, "readProductTaskSnapshotPatchSlice")
        const legacyPatchRead = vi.spyOn(snapshotsApi, "loadPatch").mockRejectedValue(new Error("legacy snapshot patch read should not be used"))
        const legacyIndexRead = vi.spyOn(snapshotsApi, "loadIndex").mockRejectedValue(new Error("legacy snapshot index read should not be used"))
        const legacySliceRead = vi.spyOn(snapshotsApi, "loadPatchSlice").mockRejectedValue(new Error("legacy snapshot slice read should not be used"))
        const writeText = vi.fn<Clipboard["writeText"]>().mockResolvedValue(undefined)
        const previousClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard")
        Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: { writeText },
        })
        ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
        const container = document.createElement("div")
        document.body.appendChild(container)
        const root = createRoot(container)

        try {
            await codeStore.initializeRuntimeProductStore()
            await codeStore.loadRuntimeProductTask("repo-1", "task-1")
            expect(codeStore.canUseProductMethod(OPENADE_METHOD.taskSnapshotPatchRead)).toBe(false)
            expect(codeStore.canUseProductMethod(OPENADE_METHOD.taskSnapshotIndexRead)).toBe(false)
            expect(codeStore.canUseProductMethod(OPENADE_METHOD.taskSnapshotPatchReadSlice)).toBe(false)

            const snapshotModel = codeStore.tasks.getTaskModel("task-1")?.events.find((event) => event.id === "snapshot-1") as SnapshotEventModel | undefined
            if (!snapshotModel) throw new Error("Expected snapshot event model")

            await snapshotModel.loadIndex()
            await snapshotModel.loadPatch()
            expect(snapshotModel.fullPatch).toBe("")

            await act(async () => {
                root.render(
                    createElement(
                        CodeStoreProvider,
                        { store: codeStore },
                        createElement(ViewPatch, {
                            patchFileId: "patch-1",
                            patchIndex: snapshotPatchIndex,
                            taskId: "task-1",
                            snapshotEventId: "snapshot-1",
                        })
                    )
                )
            })
            await vi.waitFor(() => {
                expect(container.textContent).toContain("Could not load patch preview")
            })

            await act(async () => {
                root.render(
                    createElement(
                        CodeStoreProvider,
                        { store: codeStore },
                        createElement(SnapshotEventItem, {
                            event: {
                                id: "snapshot-1",
                                type: "snapshot",
                                status: "completed",
                                createdAt: now,
                                completedAt: now,
                                userInput: "",
                                actionEventId: "event-1",
                                referenceBranch: "main",
                                mergeBaseCommit: "merge-base",
                                fullPatch: snapshotPatch,
                                patchFileId: "patch-1",
                                stats: { filesChanged: 1, insertions: 2, deletions: 1 },
                                files: [],
                            },
                            expanded: true,
                            onToggle: () => undefined,
                            taskId: "task-1",
                        })
                    )
                )
            })

            expect(container.querySelector<HTMLButtonElement>('button[title="Copy patch to clipboard"]')).toBeNull()
            expect(container.querySelector<HTMLButtonElement>('button[title="Download patch file"]')).toBeNull()
            expect(container.textContent).not.toContain("+snapshot product store")
            expect(writeText).not.toHaveBeenCalled()
            expect(runtimePatchRead).not.toHaveBeenCalled()
            expect(runtimeIndexRead).not.toHaveBeenCalled()
            expect(runtimeSliceRead).not.toHaveBeenCalled()
            expect(legacyPatchRead).not.toHaveBeenCalled()
            expect(legacyIndexRead).not.toHaveBeenCalled()
            expect(legacySliceRead).not.toHaveBeenCalled()
        } finally {
            act(() => root.unmount())
            container.remove()
            runtimePatchRead.mockRestore()
            runtimeIndexRead.mockRestore()
            runtimeSliceRead.mockRestore()
            legacyPatchRead.mockRestore()
            legacyIndexRead.mockRestore()
            legacySliceRead.mockRestore()
            if (previousClipboard) {
                Object.defineProperty(navigator, "clipboard", previousClipboard)
            } else {
                Reflect.deleteProperty(navigator, "clipboard")
            }
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("keeps a cached runtime snapshot as the read source during transient bridge errors", async () => {
        const { client, runtime } = createRuntimeBackedClient()
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })

        try {
            await codeStore.initializeRuntimeProductStore()
            await codeStore.loadRuntimeProductTask("repo-1", "task-1")

            codeStore.runtimeProductStoreStatus = "error"
            codeStore.runtimeProductStoreError = "transient refresh failure"

            expect(codeStore.shouldUseRuntimeProductAPI()).toBe(true)
            expect(codeStore.repos.getRepo("repo-1")).toEqual(expect.objectContaining({ id: "repo-1", name: "Runtime Repo" }))
            expect(codeStore.tasks.getTaskModel("task-1")?.exists).toBe(true)
            expect(codeStore.getTaskPreviewsForRepo("repo-1")).toEqual([expect.objectContaining({ id: "task-1", title: "Runtime task" })])
        } finally {
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("fails closed and emits rollout telemetry when active runtime reads request a legacy task store", async () => {
        const { client, runtime } = createRuntimeBackedClient()
        const trackSpy = vi.spyOn(analytics, "track").mockImplementation(() => undefined)
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined)
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })

        try {
            await codeStore.initializeRuntimeProductStore()

            await expect(codeStore.getTaskStore("repo-1", "task-1")).rejects.toThrow("Legacy task stores are disabled")

            expect(trackSpy).toHaveBeenCalledWith(
                "runtime_product_store_fallback",
                expect.objectContaining({
                    source: "task_store",
                    reason: "direct_task_store_read",
                    enabled: true,
                    status: "ready",
                    hasSnapshot: true,
                    repoCount: 1,
                    taskPreviewCount: 1,
                })
            )
        } finally {
            trackSpy.mockRestore()
            warnSpy.mockRestore()
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("emits rollout telemetry when enabled product methods fall back to the legacy local client", async () => {
        const trackSpy = vi.spyOn(analytics, "track").mockImplementation(() => undefined)
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined)
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => {
                throw new Error("Core product store unavailable")
            },
        })

        try {
            await expect(
                codeStore.createProductRepo({
                    repoId: "repo-fallback",
                    name: "Fallback Repo",
                    path: "/tmp/fallback",
                    createdBy: { id: "user-1", email: "user@example.com" },
                    clientRequestId: "fallback-repo-create",
                })
            ).rejects.toThrow()

            expect(trackSpy).toHaveBeenCalledWith(
                "runtime_product_store_fallback",
                expect.objectContaining({
                    source: "legacy_product_client",
                    reason: "openade/repo/create",
                    enabled: true,
                })
            )
        } finally {
            trackSpy.mockRestore()
            warnSpy.mockRestore()
            codeStore.disconnectAllStores()
        }
    })

    it("fails closed instead of falling back to the legacy product client in clean managed Core sessions", async () => {
        const restoreOpenADEAPI = installCleanCoreRolloutState()
        const dataFolderSave = vi.spyOn(dataFolderApi, "save").mockRejectedValue(new Error("legacy image data folder should not be used"))
        const trackSpy = vi.spyOn(analytics, "track").mockImplementation(() => undefined)
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => {
                throw new Error("Core product store unavailable")
            },
        })

        try {
            await expect(
                codeStore.createProductRepo({
                    repoId: "repo-clean-core-fallback",
                    name: "Clean Core Fallback Repo",
                    path: "/tmp/clean-core-fallback",
                    createdBy: { id: "user-1", email: "user@example.com" },
                    clientRequestId: "clean-core-fallback-repo-create",
                })
            ).rejects.toThrow("Core product store unavailable")

            await expect(
                codeStore.persistProductTaskImage({
                    id: "clean-core-image",
                    ext: "png",
                    mediaType: "image/png",
                    data: new Uint8Array([1, 2, 3]).buffer,
                })
            ).rejects.toThrow("Core product store unavailable")
            expect(dataFolderSave).not.toHaveBeenCalled()
            expect(trackSpy).not.toHaveBeenCalledWith("runtime_product_store_fallback", expect.objectContaining({ source: "legacy_product_client" }))
        } finally {
            dataFolderSave.mockRestore()
            trackSpy.mockRestore()
            restoreOpenADEAPI()
            codeStore.disconnectAllStores()
        }
    })

    it("keeps stale legacy repo and task stores closed when Core owns product state but the product store is missing", async () => {
        const restoreOpenADEAPI = installCleanCoreRolloutState()
        const trackSpy = vi.spyOn(analytics, "track").mockImplementation(() => undefined)
        const staleLegacyRepoStore = createRepoStore(new Y.Doc())
        staleLegacyRepoStore.repos.push({
            id: "legacy-repo",
            name: "Legacy Repo",
            path: "/tmp/legacy-repo",
            createdBy: { id: "legacy-user", email: "legacy@example.com" },
            createdAt: now,
            updatedAt: now,
            tasks: [
                {
                    id: "legacy-task",
                    slug: "legacy-task",
                    title: "Stale legacy task",
                    createdAt: now,
                },
            ],
        })
        const staleLegacyTask: Task = {
            id: "legacy-task",
            repoId: "legacy-repo",
            slug: "legacy-task",
            title: "Stale legacy task",
            description: "This Yjs task should not leak while Core owns product state.",
            isolationStrategy: { type: "head" },
            deviceEnvironments: [],
            createdBy: { id: "legacy-user", email: "legacy@example.com" },
            events: [],
            comments: [],
            sessionIds: {},
            createdAt: now,
            updatedAt: now,
        }
        const staleLegacyTaskConnection = {
            store: createTaskStore(new Y.Doc(), staleLegacyTask),
            sync: vi.fn(async () => undefined),
            refresh: vi.fn(async () => true),
            disconnect: vi.fn(),
        }
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
        })

        try {
            runInAction(() => {
                codeStore.repoStore = staleLegacyRepoStore
            })
            ;(
                codeStore as unknown as {
                    taskStoreConnections: Map<string, typeof staleLegacyTaskConnection>
                }
            ).taskStoreConnections = new Map([["legacy-task", staleLegacyTaskConnection]])

            expect(codeStore.usesCoreOwnedProductRuntime()).toBe(true)
            expect(codeStore.shouldUseRuntimeProductAPI()).toBe(false)
            expect(codeStore.canUseProductMethod(OPENADE_METHOD.repoCreate)).toBe(false)
            expect(codeStore.repos.repos).toEqual([])
            expect(codeStore.getTaskPreviewsForRepo("legacy-repo")).toEqual([])
            expect(codeStore.getTaskPreviewReposForStats()).toEqual([])
            expect(codeStore.findProductRepoIdForTask("legacy-task")).toBeNull()
            expect(codeStore.tasks.getTask("legacy-task")).toBeNull()
            expect(codeStore.tasks.getTaskModel("legacy-task")).toBeNull()
            await expect(codeStore.loadProductTaskForRead("legacy-repo", "legacy-task")).resolves.toBeNull()
            await expect(codeStore.getTaskStore("legacy-repo", "legacy-task")).rejects.toThrow("Legacy task stores are disabled while Core owns product state")

            await expect(codeStore.refreshRepoStoreFromStorage()).resolves.toBeUndefined()
            await expect(codeStore.refreshTaskStoreFromStorage("legacy-task")).resolves.toBeUndefined()
            await expect(
                (
                    codeStore as unknown as {
                        refreshProductTaskAfterRuntimeNotification(taskId: string): Promise<boolean>
                    }
                ).refreshProductTaskAfterRuntimeNotification("legacy-task")
            ).resolves.toBe(false)
            expect(staleLegacyTaskConnection.refresh).not.toHaveBeenCalled()
            expect(trackSpy).not.toHaveBeenCalledWith("runtime_product_store_fallback", expect.anything())
        } finally {
            trackSpy.mockRestore()
            restoreOpenADEAPI()
            codeStore.disconnectAllStores()
        }
    })

    it("fails closed before runtime requests or legacy product fallback when a product method is not advertised", async () => {
        const state = createBridgeState()
        const { client, runtime } = createRuntimeBackedClient(state, ["initialize", OPENADE_METHOD.snapshotRead])
        const runtimeRequest = vi.spyOn(runtime, "requestWithOptions")
        const legacyFileRead = vi.spyOn(localOpenADEClient, "readProjectFile").mockRejectedValue(new Error("legacy project file read should not be used"))
        const legacyMetadataUpdate = vi
            .spyOn(localOpenADEClient, "updateTaskMetadata")
            .mockRejectedValue(new Error("legacy metadata update should not be used"))
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })

        try {
            await codeStore.initializeRuntimeProductStore()
            expect(codeStore.canUseProductMethod(OPENADE_METHOD.projectFileRead)).toBe(false)
            expect(codeStore.canUseProductMethod(OPENADE_METHOD.taskMetadataUpdate)).toBe(false)
            runtimeRequest.mockClear()

            await expect(
                codeStore.readProductProjectFile({
                    repoId: "repo-1",
                    taskId: "task-1",
                    path: "README.md",
                    maxBytes: 1024,
                })
            ).rejects.toThrow(`Runtime product method unavailable: ${OPENADE_METHOD.projectFileRead}`)
            await expect(
                codeStore.updateProductTaskMetadata({
                    taskId: "task-1",
                    title: "Denied metadata update",
                })
            ).rejects.toThrow(`Runtime product method unavailable: ${OPENADE_METHOD.taskMetadataUpdate}`)
            expect(state.task?.title).toBe("Runtime task")
            expect(runtimeRequest).not.toHaveBeenCalled()
            expect(legacyFileRead).not.toHaveBeenCalled()
            expect(legacyMetadataUpdate).not.toHaveBeenCalled()
        } finally {
            runtimeRequest.mockRestore()
            legacyFileRead.mockRestore()
            legacyMetadataUpdate.mockRestore()
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("prunes repo-scoped desktop bridge state from real repo deletion notifications", async () => {
        const state = createBridgeState()
        state.task = {
            ...cloneTask(task),
            runtimeState: {
                isRunning: true,
                runtimeIds: ["runtime-delete-task"],
            },
        }
        const { client, runtime, server } = createRuntimeBackedClient(state)
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })

        try {
            await codeStore.initializeRuntimeProductStore()
            await codeStore.loadRuntimeProductTask("repo-1", "task-1")

            expect(codeStore.repos.repos).toEqual([expect.objectContaining({ id: "repo-1" })])
            expect(codeStore.tasks.getTask("task-1")).toMatchObject({ id: "task-1" })
            expect(codeStore.runtimes.isTaskRunning("task-1")).toBe(true)
            const taskModel = codeStore.tasks.getTaskModel("task-1")
            if (!taskModel) throw new Error("Expected cached task model before repo deletion")
            const taskModelDispose = vi.spyOn(taskModel, "dispose")

            state.project = null
            state.task = null
            server.notify("openade/repo/deleted", { repoId: "repo-1" })

            await waitForRuntimeBridge(() => {
                expect(codeStore.runtimeProductSnapshot?.repos ?? []).toEqual([])
                expect(codeStore.repos.repos).toEqual([])
                expect(codeStore.getTaskPreviewsForRepo("repo-1")).toEqual([])
                expect(codeStore.tasks.getTask("task-1")).toBeNull()
                expect(codeStore.tasks.getTaskModel("task-1")).toBeNull()
                expect(codeStore.runtimes.isTaskRunning("task-1")).toBe(false)
                expect(taskModelDispose).toHaveBeenCalled()
            })
        } finally {
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("does not read uncached task detail when a background runtime settles", async () => {
        const state = createBridgeState()
        state.task = {
            ...cloneTask(task),
            id: "task-background",
            slug: "task-background",
            title: "Background runtime task",
            events: [],
            comments: [],
        }
        state.taskReadRequests = []
        const { client, runtime, server } = createRuntimeBackedClient(state)
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })
        const afterEvents: Array<{ taskId: string; eventType: string }> = []
        const unsubscribe = codeStore.execution.onAfterEvent((taskId, eventType) => {
            afterEvents.push({ taskId, eventType })
        })

        try {
            await codeStore.initializeRuntimeProductStore()
            expect(codeStore.getTaskPreviewsForRepo("repo-1")).toEqual([expect.objectContaining({ id: "task-background" })])
            state.taskReadRequests = []

            server.notify("runtime/updated", runtimeRecord("running", "2026-05-31T00:01:00.000Z", "task-background", "runtime-background"))
            await waitForRuntimeBridge(() => {
                expect(codeStore.runtimes.isTaskRunning("task-background")).toBe(true)
            })

            server.notify("runtime/completed", runtimeRecord("completed", "2026-05-31T00:02:00.000Z", "task-background", "runtime-background"))
            await waitForRuntimeBridge(() => {
                expect(codeStore.runtimes.isTaskRunning("task-background")).toBe(false)
            })

            expect(state.taskReadRequests).toEqual([])
            expect(afterEvents).toEqual([])
        } finally {
            unsubscribe()
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("runs after-event callbacks from runtime DTO task events when a task runtime settles", async () => {
        const { client, runtime, server, state } = createRuntimeBackedClient()
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })
        const afterEvents: Array<{ taskId: string; eventType: string }> = []
        const unsubscribe = codeStore.execution.onAfterEvent((taskId, eventType) => {
            afterEvents.push({ taskId, eventType })
        })

        try {
            await codeStore.initializeRuntimeProductStore()
            await codeStore.loadRuntimeProductTask("repo-1", "task-1")
            state.taskGitSummaryReadCount = 0

            const legacyTaskRefresh = vi.spyOn(codeStore, "refreshTaskStoreFromStorage")
            const legacyRepoRefresh = vi.spyOn(codeStore, "refreshRepoStoreFromStorage")

            server.notify("runtime/updated", runtimeRecord("running", "2026-05-31T00:01:00.000Z"))
            await waitForRuntimeBridge(() => {
                expect(codeStore.runtimes.isTaskRunning("task-1")).toBe(true)
            })

            state.task = {
                ...cloneTask(task),
                updatedAt: "2026-05-31T00:02:00.000Z",
                events: [
                    ...task.events,
                    {
                        id: "event-run-plan",
                        type: "action",
                        status: "completed",
                        createdAt: "2026-05-31T00:02:00.000Z",
                        completedAt: "2026-05-31T00:02:01.000Z",
                        userInput: "Run the accepted plan",
                        execution: {
                            harnessId: "codex",
                            executionId: "exec-run-plan",
                            modelId: "gpt-test",
                            events: [],
                        },
                        source: {
                            type: "run_plan",
                            userLabel: "Run Plan",
                            planEventId: "event-1",
                        },
                        includesCommentIds: [],
                        result: { success: true },
                    },
                ],
            }
            server.notify("runtime/completed", runtimeRecord("completed", "2026-05-31T00:02:02.000Z"))

            await waitForRuntimeBridge(() => {
                expect(afterEvents).toEqual([{ taskId: "task-1", eventType: "run_plan" }])
                expect(codeStore.runtimes.isTaskRunning("task-1")).toBe(false)
                expect(codeStore.tasks.getTask("task-1")?.events.map((event) => event.id)).toEqual(["event-1", "event-run-plan"])
            })
            expect(legacyTaskRefresh).not.toHaveBeenCalled()
            expect(legacyRepoRefresh).not.toHaveBeenCalled()
            expect(state.taskGitSummaryReadCount).toBe(0)
        } finally {
            unsubscribe()
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("uses already-refreshed runtime DTO task events when a task runtime settles", async () => {
        const { client, runtime, server, state } = createRuntimeBackedClient()
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })
        const afterEvents: Array<{ taskId: string; eventType: string }> = []
        const unsubscribe = codeStore.execution.onAfterEvent((taskId, eventType) => {
            afterEvents.push({ taskId, eventType })
        })

        try {
            await codeStore.initializeRuntimeProductStore()
            await codeStore.loadRuntimeProductTask("repo-1", "task-1")

            server.notify("runtime/updated", runtimeRecord("running", "2026-05-31T00:01:00.000Z"))
            await waitForRuntimeBridge(() => {
                expect(codeStore.runtimes.isTaskRunning("task-1")).toBe(true)
            })

            state.task = {
                ...cloneTask(task),
                updatedAt: "2026-05-31T00:02:00.000Z",
                events: [
                    ...task.events,
                    {
                        id: "event-run-plan",
                        type: "action",
                        status: "completed",
                        createdAt: "2026-05-31T00:02:00.000Z",
                        completedAt: "2026-05-31T00:02:01.000Z",
                        userInput: "Run the accepted plan",
                        execution: {
                            harnessId: "codex",
                            executionId: "exec-run-plan",
                            modelId: "gpt-test",
                            events: [],
                        },
                        source: {
                            type: "run_plan",
                            userLabel: "Run Plan",
                            planEventId: "event-1",
                        },
                        includesCommentIds: [],
                        result: { success: true },
                    },
                ],
            }
            state.taskReadRequests = []
            server.notify("openade/task/updated", {
                repoId: "repo-1",
                taskId: "task-1",
            })
            await waitForRuntimeDeferredTaskRefresh(() => {
                expect(codeStore.tasks.getTask("task-1")?.events.map((event) => event.id)).toEqual(["event-1", "event-run-plan"])
            })
            expect(state.taskReadRequests).toEqual([{ repoId: "repo-1", taskId: "task-1", hydrateSessionEvents: false, eventLimit: 12 }])

            state.taskReadRequests = []
            server.notify("runtime/completed", runtimeRecord("completed", "2026-05-31T00:02:02.000Z"))
            await waitForRuntimeBridge(() => {
                expect(afterEvents).toEqual([{ taskId: "task-1", eventType: "run_plan" }])
                expect(codeStore.runtimes.isTaskRunning("task-1")).toBe(false)
            })
            expect(state.taskReadRequests).toEqual([])
        } finally {
            unsubscribe()
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("lets a pending task-update notification satisfy runtime settlement before forcing another task read", async () => {
        const { client, runtime, server, state } = createRuntimeBackedClient()
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })
        const afterEvents: Array<{ taskId: string; eventType: string }> = []
        const unsubscribe = codeStore.execution.onAfterEvent((taskId, eventType) => {
            afterEvents.push({ taskId, eventType })
        })

        try {
            await codeStore.initializeRuntimeProductStore()
            await codeStore.loadRuntimeProductTask("repo-1", "task-1")
            server.notify("runtime/updated", runtimeRecord("running", "2026-05-31T00:01:00.000Z"))
            await waitForRuntimeBridge(() => {
                expect(codeStore.runtimes.isTaskRunning("task-1")).toBe(true)
            })

            state.task = {
                ...cloneTask(task),
                updatedAt: "2026-05-31T00:02:00.000Z",
                events: [
                    ...task.events,
                    {
                        id: "event-run-plan",
                        type: "action",
                        status: "completed",
                        createdAt: "2026-05-31T00:02:00.000Z",
                        completedAt: "2026-05-31T00:02:01.000Z",
                        userInput: "Run the accepted plan",
                        execution: {
                            harnessId: "codex",
                            executionId: "exec-run-plan",
                            modelId: "gpt-test",
                            events: [],
                        },
                        source: {
                            type: "run_plan",
                            userLabel: "Run Plan",
                            planEventId: "event-1",
                        },
                        includesCommentIds: [],
                        result: { success: true },
                    },
                ],
            }
            state.taskReadRequests = []
            server.notify("openade/task/updated", {
                repoId: "repo-1",
                taskId: "task-1",
            })
            server.notify("runtime/completed", runtimeRecord("completed", "2026-05-31T00:02:02.000Z"))

            await waitForRuntimeNotificationsToSettle()
            expect(state.taskReadRequests).toEqual([])
            expect(afterEvents).toEqual([])

            await waitForRuntimeDeferredTaskRefresh(() => {
                expect(afterEvents).toEqual([{ taskId: "task-1", eventType: "run_plan" }])
                expect(codeStore.runtimes.isTaskRunning("task-1")).toBe(false)
                expect(codeStore.tasks.getTask("task-1")?.events.map((event) => event.id)).toEqual(["event-1", "event-run-plan"])
            })
            expect(state.taskReadRequests).toEqual([{ repoId: "repo-1", taskId: "task-1", hydrateSessionEvents: false, eventLimit: 12 }])
        } finally {
            unsubscribe()
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("refreshes cached desktop bridge state from real runtime notifications", async () => {
        const { client, runtime, server, state } = createRuntimeBackedClient()
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })

        try {
            await codeStore.initializeRuntimeProductStore()
            await codeStore.loadRuntimeProductTask("repo-1", "task-1")

            const legacyTaskRefresh = vi.spyOn(codeStore, "refreshTaskStoreFromStorage")
            const legacyRepoRefresh = vi.spyOn(codeStore, "refreshRepoStoreFromStorage")

            state.task = {
                ...cloneTask(task),
                title: "Runtime notification task",
                updatedAt: "2026-05-31T00:01:00.000Z",
                events: [
                    ...task.events,
                    {
                        id: "event-2",
                        type: "action",
                        status: "completed",
                        createdAt: "2026-05-31T00:01:00.000Z",
                        completedAt: "2026-05-31T00:01:01.000Z",
                        userInput: "Refresh from runtime notification",
                        execution: {
                            harnessId: "codex",
                            executionId: "exec-2",
                            modelId: "gpt-test",
                            events: [],
                        },
                        source: { type: "ask", userLabel: "Ask" },
                        includesCommentIds: [],
                        result: { success: true },
                    },
                ],
                comments: [
                    ...task.comments,
                    {
                        id: "comment-2",
                        content: "Runtime notification refreshed",
                        source: {
                            type: "llm_output",
                            eventId: "event-2",
                            lineStart: 1,
                            lineEnd: 1,
                        },
                        selectedText: {
                            text: "notification",
                            linesBefore: "",
                            linesAfter: "",
                        },
                        author: { id: "user-1", email: "user@example.com" },
                        createdAt: "2026-05-31T00:01:00.000Z",
                    },
                ],
            }
            state.taskReadRequests = []
            server.notify("openade/task/updated", {
                repoId: "repo-1",
                taskId: "task-1",
            })
            server.notify("openade/task/updated", {
                repoId: "repo-1",
                taskId: "task-1",
            })
            server.notify("openade/task/updated", {
                repoId: "repo-1",
                taskId: "task-1",
            })

            await waitForRuntimeDeferredTaskRefresh(() => {
                expect(codeStore.tasks.getTask("task-1")).toMatchObject({
                    title: "Runtime notification task",
                    events: [
                        expect.objectContaining({ id: "event-1" }),
                        expect.objectContaining({
                            id: "event-2",
                            source: expect.objectContaining({ type: "ask" }),
                        }),
                    ],
                    comments: [expect.objectContaining({ id: "comment-1" }), expect.objectContaining({ id: "comment-2" })],
                })
            })
            expect(state.taskReadRequests).toEqual([{ repoId: "repo-1", taskId: "task-1", hydrateSessionEvents: false, eventLimit: 12 }])

            const queuedTurn: NonNullable<OpenADETask["queuedTurns"]>[number] = {
                id: "queued-1",
                type: "do",
                input: "Follow up after current turn",
                status: "running",
                createdAt: "2026-05-31T00:02:00.000Z",
                updatedAt: "2026-05-31T00:02:01.000Z",
                eventId: "event-queued-1",
            }
            state.task = {
                ...state.task,
                queuedTurns: [queuedTurn],
                updatedAt: "2026-05-31T00:02:01.000Z",
            }
            state.taskReadRequests = []
            server.notify("openade/queuedTurn/updated", {
                repoId: "repo-1",
                taskId: "task-1",
                turn: queuedTurn,
            })
            server.notify("openade/queuedTurn/updated", {
                repoId: "repo-1",
                taskId: "task-1",
                turn: queuedTurn,
            })
            server.notify("openade/queuedTurn/updated", {
                repoId: "repo-1",
                taskId: "task-1",
                turn: queuedTurn,
            })

            await waitForRuntimeDeferredTaskRefresh(() => {
                expect(codeStore.tasks.getTask("task-1")?.queuedTurns).toEqual([expect.objectContaining({ id: "queued-1", status: "running" })])
            })
            expect(state.taskReadRequests).toEqual([{ repoId: "repo-1", taskId: "task-1", hydrateSessionEvents: false, eventLimit: 12 }])

            state.task = {
                ...state.task,
                title: "Runtime preview notification task",
                closed: true,
                lastEventAt: "2026-05-31T00:02:00.000Z",
            }
            state.taskReadRequests = []
            const projectReadsBeforePreviewNotification = state.projectReadCount ?? 0
            const taskListReadsBeforePreviewNotification = state.taskListReadCount ?? 0
            server.notify("openade/task/previewChanged", {
                repoId: "repo-1",
                taskId: "task-1",
            })

            await waitForRuntimeBridge(() => {
                expect(codeStore.getTaskPreviewsForRepo("repo-1")).toEqual([
                    expect.objectContaining({
                        id: "task-1",
                        title: "Runtime preview notification task",
                        closed: true,
                    }),
                ])
            })
            expect(state.projectReadCount ?? 0).toBe(projectReadsBeforePreviewNotification)
            expect(state.taskListReadCount ?? 0).toBe(taskListReadsBeforePreviewNotification + 1)
            expect(state.taskReadRequests).toEqual([])

            state.task = {
                ...state.task,
                title: "Runtime preview burst task",
                closed: false,
                lastEventAt: "2026-05-31T00:02:30.000Z",
            }
            state.taskReadRequests = []
            const projectReadsBeforePreviewBurst = state.projectReadCount ?? 0
            const taskListReadsBeforePreviewBurst = state.taskListReadCount ?? 0
            server.notify("openade/task/previewChanged", {
                repoId: "repo-1",
                taskId: "task-1",
            })
            server.notify("openade/task/previewChanged", {
                repoId: "repo-1",
                taskId: "task-1",
            })
            server.notify("openade/task/previewChanged", {
                repoId: "repo-1",
                taskId: "task-1",
            })

            await waitForRuntimeBridge(() => {
                expect(codeStore.getTaskPreviewsForRepo("repo-1")).toEqual([
                    expect.objectContaining({
                        id: "task-1",
                        title: "Runtime preview burst task",
                        closed: false,
                    }),
                ])
            })
            await waitForRuntimeNotificationsToSettle()
            expect(state.projectReadCount ?? 0).toBe(projectReadsBeforePreviewBurst)
            expect(state.taskListReadCount ?? 0).toBe(taskListReadsBeforePreviewBurst + 1)
            expect(state.taskReadRequests).toEqual([])

            state.task = null
            state.taskReadRequests = []
            const projectReadsBeforeDeletion = state.projectReadCount ?? 0
            const taskListReadsBeforeDeletion = state.taskListReadCount ?? 0
            server.notify("openade/task/deleted", {
                repoId: "repo-1",
                taskId: "task-1",
            })

            await waitForRuntimeBridge(() => {
                expect(codeStore.getTaskPreviewsForRepo("repo-1")).toEqual([])
                expect(codeStore.tasks.getTask("task-1")).toBeNull()
                expect(codeStore.tasks.getTaskModel("task-1")).toBeNull()
            })
            expect(state.projectReadCount ?? 0).toBe(projectReadsBeforeDeletion)
            expect(state.taskListReadCount ?? 0).toBe(taskListReadsBeforeDeletion + 1)
            expect(state.taskReadRequests).toEqual([])
            expect(legacyTaskRefresh).not.toHaveBeenCalled()
            expect(legacyRepoRefresh).not.toHaveBeenCalled()
        } finally {
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("does not run delayed task reads after a repo refresh supersedes task update notifications", async () => {
        const { client, runtime, server, state } = createRuntimeBackedClient()
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })

        try {
            await codeStore.initializeRuntimeProductStore()
            await codeStore.loadRuntimeProductTask("repo-1", "task-1")

            state.task = {
                ...requireStateTask(state, "task-1"),
                title: "Repo refresh superseded task update",
                updatedAt: "2026-05-31T00:04:00.000Z",
            }
            state.taskReadRequests = []
            server.notify("openade/task/updated", {
                repoId: "repo-1",
                taskId: "task-1",
            })
            server.notify("openade/repo/updated", {
                repoId: "repo-1",
            })

            await waitForRuntimeNotificationsToSettle()

            expect(codeStore.runtimeProductSnapshot?.repos[0]?.id).toBe("repo-1")
            expect(state.taskReadRequests).toEqual([])
        } finally {
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("coalesces global runtime task-preview notifications into one project refresh", async () => {
        const { client, runtime, server, state } = createRuntimeBackedClient()
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })

        try {
            await codeStore.initializeRuntimeProductStore()
            const projectReadsBeforePreviewBurst = state.projectReadCount ?? 0
            const taskListReadsBeforePreviewBurst = state.taskListReadCount ?? 0

            state.task = {
                ...requireStateTask(state, "task-1"),
                title: "Global preview burst task",
                closed: true,
                lastEventAt: "2026-05-31T00:07:00.000Z",
            }
            server.notify("openade/task/previewChanged", { taskId: "task-1" })
            server.notify("openade/task/previewChanged", { taskId: "task-1" })
            server.notify("openade/task/previewChanged", { taskId: "task-1" })

            await waitForRuntimeBridge(() => {
                expect(codeStore.getTaskPreviewsForRepo("repo-1")).toEqual([
                    expect.objectContaining({
                        id: "task-1",
                        title: "Global preview burst task",
                        closed: true,
                    }),
                ])
            })
            await waitForRuntimeNotificationsToSettle()

            expect(state.projectReadCount ?? 0).toBe(projectReadsBeforePreviewBurst + 1)
            expect(state.taskListReadCount ?? 0).toBe(taskListReadsBeforePreviewBurst)
        } finally {
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("does not reread desktop bridge state for self-accepted runtime notification echoes", async () => {
        const { client, runtime, server, state } = createRuntimeBackedClient({
            ...createBridgeState(),
            taskReadRequests: [],
            snapshotReadCount: 0,
        })
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })

        try {
            await codeStore.initializeRuntimeProductStore()
            await codeStore.loadRuntimeProductTask("repo-1", "task-1")

            state.taskReadRequests = []
            const snapshotReadsAfterLoad = state.snapshotReadCount ?? 0

            await codeStore.updateProductTaskMetadata({
                taskId: "task-1",
                title: "Accepted bridge metadata",
                lastViewedAt: "2026-05-31T00:03:00.000Z",
            })
            await waitForRuntimeNotificationsToSettle()

            expect(codeStore.runtimeProductSnapshot?.repos[0]?.tasks[0]).toMatchObject({
                id: "task-1",
                title: "Accepted bridge metadata",
                lastViewedAt: "2026-05-31T00:03:00.000Z",
            })
            expect(codeStore.tasks.getTask("task-1")).toMatchObject({
                title: "Accepted bridge metadata",
            })
            expect(state.taskReadRequests).toEqual([])
            expect(state.snapshotReadCount).toBe(snapshotReadsAfterLoad)

            state.taskReadRequests = []
            await codeStore.startProductTurn({
                repoId: "repo-1",
                inTaskId: "task-1",
                type: "do",
                input: "Run accepted bridge turn",
            })
            await waitForRuntimeNotificationsToSettle()

            expect(codeStore.tasks.getTask("task-1")?.events).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        id: "event-started",
                        status: "in_progress",
                    }),
                ])
            )
            expect(state.taskReadRequests).toEqual([])
            expect(state.snapshotReadCount).toBe(snapshotReadsAfterLoad)

            state.task = {
                ...requireStateTask(state, "task-1"),
                events: requireStateTask(state, "task-1").events.map((event) =>
                    taskEventRecord(event) && event.id === "event-started"
                        ? {
                              ...event,
                              status: "completed",
                              completedAt: "2026-05-31T00:03:02.000Z",
                          }
                        : event
                ),
                updatedAt: "2026-05-31T00:03:02.000Z",
            }
            state.taskReadRequests = []
            server.notify("openade/task/updated", {
                repoId: "repo-1",
                taskId: "task-1",
                eventId: "event-started",
                eventStatus: "completed",
                at: "2026-05-31T00:03:02.000Z",
            })

            await waitForRuntimeDeferredTaskRefresh(() => {
                expect(codeStore.tasks.getTask("task-1")?.events).toEqual(
                    expect.arrayContaining([
                        expect.objectContaining({
                            id: "event-started",
                            status: "completed",
                        }),
                    ])
                )
            })
            expect(state.taskReadRequests).toEqual([{ repoId: "repo-1", taskId: "task-1", hydrateSessionEvents: false, eventLimit: 12 }])
        } finally {
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })
})
