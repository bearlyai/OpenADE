import { createElement, useEffect } from "react"
import { flushSync } from "react-dom"
import { type Root, createRoot } from "react-dom/client"
import { MemoryRouter, Route, Routes, useLocation } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { OpenADECoreRolloutState } from "../../electron/src/preload-api"
import { OPENADE_METHOD, OPENADE_METHODS } from "../../openade-client/src"
import { createOpenADEModule, type OpenADEModuleAdapters } from "../../openade-module/src/module"
import type {
    OpenADECronInstallState,
    OpenADEMCPServer,
    OpenADEPersonalSettings,
    OpenADEProject,
    OpenADESnapshot,
    OpenADETask,
    OpenADETaskCreateRequest,
    OpenADETaskMetadataUpdateRequest,
    OpenADETaskReadOptions,
    OpenADETaskPreview,
    OpenADETurnStartRequest,
} from "../../openade-module/src/types"
import { type RuntimeMessage, type RuntimeRecord, validateRuntimeRequest } from "../../runtime-protocol/src"
import { RuntimeHandlerError, type RuntimeConnection, RuntimeServer } from "../../runtime/src"
import {
    CodeBaseRoute,
    CodeWorkspaceRoute,
    CodeWorkspaceSettingsRoute,
    CodeWorkspaceTaskCreateRoute,
    CodeWorkspaceTaskCreatingRoute,
    CodeWorkspaceTaskRoute,
} from "./Routes"
import { analytics } from "./analytics"
import { getDefaultModelForHarness } from "./constants"
import { resetCodeModuleCapabilitiesForTests } from "./electronAPI/capabilities"
import { resetPlatformInfoForTests } from "./electronAPI/platform"
import { OpenADEProductStore } from "./kernel/productStore"
import { localOpenADEClient } from "./runtime/localOpenADEClient"
import { localRuntimeClient } from "./runtime/localRuntimeClient"
import { CodeStoreProvider } from "./store/context"
import { CodeStore, type CodeStoreConfig } from "./store/store"

const now = "2026-05-31T00:00:00.000Z"
const routeModelId = getDefaultModelForHarness("codex")

const routeTask: OpenADETask = {
    id: "task-1",
    repoId: "repo-1",
    slug: "runtime-route-task",
    title: "Runtime route task",
    description: "Read through the desktop runtime route.",
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
            completedAt: "2026-05-31T00:01:00.000Z",
            userInput: "Do the runtime-backed work",
            source: { type: "do", userLabel: "Do" },
            execution: {
                harnessId: "codex",
                executionId: "exec-1",
                modelId: routeModelId,
                events: [],
            },
            includesCommentIds: [],
            result: { success: true },
        },
    ],
    comments: [
        {
            id: "comment-1",
            content: "Runtime pending comment",
            source: {
                type: "llm_output",
                eventId: "event-1",
                lineStart: 1,
                lineEnd: 1,
            },
            selectedText: { text: "runtime", linesBefore: "", linesAfter: "" },
            author: { id: "user-1", email: "user@example.com" },
            createdAt: now,
        },
    ],
}

function cloneTask(value: OpenADETask): OpenADETask {
    return structuredClone(value)
}

function routeTaskPreview(value: OpenADETask): OpenADETaskPreview {
    return {
        id: value.id,
        slug: value.slug,
        title: value.title,
        closed: value.closed,
        createdAt: value.createdAt ?? now,
        lastEventAt: "2026-05-31T00:01:00.000Z",
        lastEvent: {
            type: "action",
            status: "completed",
            sourceType: "do",
            sourceLabel: "Do",
            at: "2026-05-31T00:01:00.000Z",
        },
    }
}

function routeProject(task: OpenADETask = routeTask): OpenADEProject {
    return {
        id: "repo-1",
        name: "Runtime Route Repo",
        path: "/tmp/runtime-route-repo",
        tasks: [routeTaskPreview(task)],
    }
}

function routeTurnLabel(type: OpenADETurnStartRequest["type"]): string {
    if (type === "do") return "Do"
    if (type === "ask") return "Ask"
    if (type === "revise") return "Revise Plan"
    if (type === "run_plan") return "Run Plan"
    if (type === "hyperplan") return "HyperPlan"
    return "Plan"
}

function runtimeSnapshot(task: OpenADETask = routeTask): OpenADESnapshot {
    return {
        server: {
            version: "route-smoke-test",
            hostName: "route-smoke-host",
            theme: { setting: "system", className: "code-theme-light" },
        },
        workingTaskIds: [],
        repos: [routeProject(task)],
    }
}

function routeRuntimeRecord(status: RuntimeRecord["status"], updatedAt: string, runtimeId = "runtime-route-task-1"): RuntimeRecord {
    return {
        runtimeId,
        kind: "agent",
        status,
        scope: { ownerType: "openade-task", ownerId: "task-1" },
        startedAt: now,
        updatedAt,
        lastActivityAt: updatedAt,
    }
}

function unsupportedMutation(method: string): () => Promise<never> {
    return async () => {
        throw new Error(`${method} is not available in the route runtime test`)
    }
}

interface RouteRuntimeServerHooks {
    onReadSnapshot?: () => void
    onReadProjects?: () => void
    snapshotError?: Error
    projectListError?: Error
    onCreateTask?: (params: OpenADETaskCreateRequest) => void
    onStartTurn?: (params: OpenADETurnStartRequest) => void
    onUpdateTaskMetadata?: (params: OpenADETaskMetadataUpdateRequest) => void
    onReadTask?: (params: {
        repoId: string
        taskId: string
        options?: OpenADETaskReadOptions
    }) => void
    readTaskError?: Error | (() => Error | null)
    beforeReadTask?: () => Promise<void>
    onReadTaskGitSummary?: () => void
    onReadTaskChanges?: () => void
    onReadProjectGitInfo?: () => void
    onListProjectProcesses?: () => void
    onReadCronDefinitions?: () => void
    onFuzzySearchProjectFiles?: () => void
    onReadSdkCapabilities?: () => void
    onReadPersonalSettings?: () => void
}

function createRouteRuntimeServer(hooks: RouteRuntimeServerHooks = {}): RuntimeServer {
    const server = new RuntimeServer({
        serverName: "desktop-route-runtime",
        protocolVersion: 1,
    })
    const task = cloneTask(routeTask)
    const project = routeProject(task)
    let cronInstallStates: Record<string, OpenADECronInstallState> = {}
    let mcpServers: OpenADEMCPServer[] = []
    let personalSettings: OpenADEPersonalSettings = {
        envVars: {},
        theme: "system",
        renderMarkdownMessages: true,
        newTaskHarnessId: "codex",
        newTaskModelId: routeModelId,
    }
    let projectProcessId: string | null = null
    const adapters: OpenADEModuleAdapters = {
        version: () => "route-smoke-test",
        readSnapshot: async () => {
            hooks.onReadSnapshot?.()
            if (hooks.snapshotError) throw hooks.snapshotError
            return runtimeSnapshot(task)
        },
        readProjects: async () => {
            hooks.onReadProjects?.()
            if (hooks.projectListError) throw hooks.projectListError
            return [project]
        },
        readTaskList: async () => project.tasks,
        readTask: async (repoId, taskId, options) => {
            hooks.onReadTask?.({ repoId, taskId, options })
            await hooks.beforeReadTask?.()
            const readTaskError = typeof hooks.readTaskError === "function" ? hooks.readTaskError() : hooks.readTaskError
            if (readTaskError) throw readTaskError
            if (taskId !== task.id) throw new Error(`Task ${taskId} not found`)
            return cloneTask(task)
        },
        listDataDocuments: async () => [],
        readDataDocumentBase64: async () => null,
        saveDataDocumentBase64: unsupportedMutation("saveDataDocumentBase64"),
        deleteDataDocument: unsupportedMutation("deleteDataDocument"),
        createRepo: unsupportedMutation("createRepo"),
        updateRepo: unsupportedMutation("updateRepo"),
        deleteRepo: unsupportedMutation("deleteRepo"),
        createTask: async (params) => {
            if (params.repoId !== project.id) throw new Error(`Repo ${params.repoId} not found`)
            hooks.onCreateTask?.(structuredClone(params))
            const createdAt = params.createdAt ?? now
            task.id = params.taskId ?? task.id
            task.repoId = params.repoId
            task.slug = params.slug ?? task.slug
            task.title = params.title ?? params.input
            task.description = params.input
            task.createdBy = params.createdBy
            task.createdAt = createdAt
            task.updatedAt = createdAt
            task.isolationStrategy = params.isolationStrategy ?? { type: "head" }
            task.enabledMcpServerIds = params.enabledMcpServerIds
            task.deviceEnvironments = params.deviceEnvironment ? [params.deviceEnvironment] : []
            task.events = params.setupEvent
                ? [
                      {
                          id: params.setupEvent.eventId ?? "setup-event-1",
                          type: "setup_environment",
                          status: "completed",
                          createdAt,
                          completedAt: createdAt,
                          userInput: "Environment setup",
                          worktreeId: params.setupEvent.worktreeId,
                          deviceId: params.setupEvent.deviceId,
                          workingDir: params.setupEvent.workingDir,
                          setupOutput: params.setupEvent.setupOutput,
                      },
                  ]
                : []
            task.comments = []
            project.tasks = [routeTaskPreview(task)]
            return {
                taskId: task.id,
                slug: task.slug,
                title: task.title,
                createdAt,
            }
        },
        startTurn: async (params, context) => {
            if (params.repoId !== project.id) throw new Error(`Repo ${params.repoId} not found`)
            hooks.onStartTurn?.(structuredClone(params))
            const eventId = `event-${task.events.length + 1}`
            const completedAt = "2026-05-31T00:02:00.000Z"
            task.events = [
                ...task.events,
                {
                    id: eventId,
                    type: "action",
                    status: "completed",
                    createdAt: "2026-05-31T00:01:30.000Z",
                    completedAt,
                    userInput: params.input,
                    source: { type: params.type, userLabel: routeTurnLabel(params.type) },
                    execution: {
                        harnessId: params.harnessId ?? "codex",
                        executionId: "exec-shared-shell",
                        modelId: params.modelId ?? routeModelId,
                        events: [],
                    },
                    includesCommentIds: [],
                    result: { success: true },
                },
            ]
            task.updatedAt = completedAt
            task.lastEventAt = completedAt
            project.tasks = [routeTaskPreview(task)]
            server.notify("openade/task/updated", {
                repoId: project.id,
                taskId: task.id,
                at: completedAt,
            })
            if (context?.runtimeId) {
                const completedRuntime = server.supervisor.update(context.runtimeId, {
                    status: "completed",
                    scope: { ownerType: "openade-task", ownerId: task.id },
                    exitedAt: completedAt,
                    lastActivityAt: completedAt,
                })
                if (completedRuntime) server.notify("runtime/completed", completedRuntime)
            }
            return {
                taskId: task.id,
                eventId,
                executionId: "exec-shared-shell",
                createdAt: "2026-05-31T00:01:30.000Z",
                task: cloneTask(task),
                preview: routeTaskPreview(task),
            }
        },
        startReview: async (params, context) => {
            if (params.repoId !== project.id) throw new Error(`Repo ${params.repoId} not found`)
            if (params.taskId !== task.id) throw new Error(`Task ${params.taskId} not found`)
            const eventId = `event-${task.events.length + 1}`
            const completedAt = "2026-05-31T00:02:15.000Z"
            task.events = [
                ...task.events,
                {
                    id: eventId,
                    type: "action",
                    status: "completed",
                    createdAt: "2026-05-31T00:02:05.000Z",
                    completedAt,
                    userInput: params.customInstructions,
                    source: {
                        type: "review",
                        userLabel: params.reviewType === "plan" ? "Review Plan" : "Review Work",
                        reviewType: params.reviewType,
                        userInstructions: params.customInstructions,
                    },
                    execution: {
                        harnessId: params.harnessId,
                        executionId: "exec-shared-review",
                        modelId: params.modelId,
                        events: [],
                    },
                    includesCommentIds: [],
                    result: { success: true },
                },
            ]
            task.updatedAt = completedAt
            task.lastEventAt = completedAt
            project.tasks = [routeTaskPreview(task)]
            server.notify("openade/task/updated", {
                repoId: project.id,
                taskId: task.id,
                at: completedAt,
            })
            if (context?.runtimeId) {
                const completedRuntime = server.supervisor.update(context.runtimeId, {
                    status: "completed",
                    scope: { ownerType: "openade-task", ownerId: task.id },
                    exitedAt: completedAt,
                    lastActivityAt: completedAt,
                })
                if (completedRuntime) server.notify("runtime/completed", completedRuntime)
            }
            return {
                taskId: task.id,
                eventId,
                executionId: "exec-shared-review",
                createdAt: "2026-05-31T00:02:05.000Z",
            }
        },
        interruptTurn: unsupportedMutation("interruptTurn"),
        enqueueQueuedTurn: unsupportedMutation("enqueueQueuedTurn"),
        reorderQueuedTurns: unsupportedMutation("reorderQueuedTurns"),
        cancelQueuedTurn: unsupportedMutation("cancelQueuedTurn"),
        deleteTask: unsupportedMutation("deleteTask"),
        setupTaskEnvironment: unsupportedMutation("setupTaskEnvironment"),
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
            if (params.taskId !== task.id) throw new Error(`Task ${params.taskId} not found`)
            const commentId = params.commentId ?? `comment-${task.comments.length + 1}`
            const createdAt = "2026-05-31T00:01:45.000Z"
            task.comments = [
                ...task.comments,
                {
                    id: commentId,
                    content: params.content,
                    source: params.source,
                    selectedText: params.selectedText,
                    author: params.author,
                    createdAt,
                    updatedAt: createdAt,
                },
            ]
            task.updatedAt = createdAt
            return { commentId, createdAt }
        },
        editComment: async (params) => {
            if (params.taskId !== task.id) throw new Error(`Task ${params.taskId} not found`)
            task.comments = task.comments.map((comment) => {
                if (typeof comment !== "object" || comment === null || Array.isArray(comment)) return comment
                if (!("id" in comment) || comment.id !== params.commentId) return comment
                return {
                    ...comment,
                    content: params.content,
                    updatedAt: params.updatedAt ?? "2026-05-31T00:01:50.000Z",
                }
            })
        },
        deleteComment: async (params) => {
            if (params.taskId !== task.id) throw new Error(`Task ${params.taskId} not found`)
            task.comments = task.comments.filter((comment) => {
                if (typeof comment !== "object" || comment === null || Array.isArray(comment)) return true
                return !("id" in comment) || comment.id !== params.commentId
            })
        },
        readCronInstallState: async (params) => {
            if (params.repoId !== project.id) throw new Error(`Repo ${params.repoId} not found`)
            return {
                repoId: params.repoId,
                installations: structuredClone(cronInstallStates),
            }
        },
        replaceCronInstallState: async (params) => {
            if (params.repoId !== project.id) throw new Error(`Repo ${params.repoId} not found`)
            cronInstallStates = structuredClone(params.installations)
            return {
                repoId: params.repoId,
                installations: structuredClone(cronInstallStates),
                replacedInstallations: Object.keys(cronInstallStates).length,
            }
        },
        readMcpServers: async () => ({ servers: structuredClone(mcpServers) }),
        replaceMcpServers: async (params) => {
            mcpServers = structuredClone(params.servers)
            return {
                servers: structuredClone(mcpServers),
                replacedServers: mcpServers.length,
            }
        },
        upsertMcpServer: async (params) => {
            const created = !mcpServers.some((server) => server.id === params.server.id)
            const nextServer = structuredClone(params.server)
            mcpServers = [...mcpServers.filter((server) => server.id !== nextServer.id), nextServer]
            return { server: structuredClone(nextServer), created }
        },
        deleteMcpServer: async (params) => {
            const hadServer = mcpServers.some((server) => server.id === params.serverId)
            mcpServers = mcpServers.filter((server) => server.id !== params.serverId)
            return { serverId: params.serverId, deleted: hadServer }
        },
        readPersonalSettings: async () => {
            hooks.onReadPersonalSettings?.()
            return {
                settings: structuredClone(personalSettings),
            }
        },
        replacePersonalSettings: async (params) => {
            personalSettings = structuredClone(params.settings)
            return { settings: structuredClone(personalSettings) }
        },
        updateTaskMetadata: async (params) => {
            if (params.taskId !== task.id) throw new Error(`Task ${params.taskId} not found`)
            hooks.onUpdateTaskMetadata?.(structuredClone(params))
            if (params.title !== undefined) task.title = params.title
            if (params.closed !== undefined) task.closed = params.closed
            if (params.lastViewedAt !== undefined) task.lastViewedAt = params.lastViewedAt
            project.tasks = [routeTaskPreview(task)]
        },
        scopedHost: {
            listProjectFiles: async (params) => ({
                repoId: params.repoId,
                path: params.path ?? "",
                entries: [{ path: "README.md", name: "README.md", type: "file", size: 34 }],
                truncated: false,
            }),
            readProjectFile: async (params) => ({
                repoId: params.repoId,
                path: params.path,
                encoding: "utf8",
                size: 34,
                tooLarge: false,
                content: "Runtime route readme\nshared shell\n",
            }),
            writeProjectFile: unsupportedMutation("writeProjectFile"),
            fuzzySearchProjectFiles: async (params) => {
                hooks.onFuzzySearchProjectFiles?.()
                return {
                    repoId: params.repoId,
                    taskId: params.taskId,
                    results: params.query.toLowerCase().includes("readme") ? ["README.md"] : [],
                    truncated: false,
                    source: "filesystem",
                }
            },
            searchProject: async (params) => ({
                repoId: params.repoId,
                matches: params.query.toLowerCase().includes("readme")
                    ? [
                          {
                              path: "README.md",
                              line: 1,
                              content: "Runtime route readme",
                              matchStart: 14,
                              matchEnd: 20,
                          },
                      ]
                    : [],
                truncated: false,
            }),
            readProjectGitInfo: async (params) => {
                hooks.onReadProjectGitInfo?.()
                return {
                    repoId: params.repoId,
                    isGitRepo: true,
                    repoRoot: project.path,
                    relativePath: "",
                    mainBranch: "main",
                    hasGhCli: false,
                }
            },
            readProjectGitBranches: async (params) => ({
                repoId: params.repoId,
                defaultBranch: "main",
                branches: [{ name: "main", isDefault: true, isRemote: false }],
            }),
            readProjectGitSummary: async (params) => ({
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
            }),
            listProjectProcesses: async (params) => {
                hooks.onListProjectProcesses?.()
                return {
                    repoId: params.repoId,
                    searchRoot: project.path,
                    repoRoot: project.path,
                    isWorktree: false,
                    processes: [
                        {
                            id: "dev-server",
                            name: "Dev Server",
                            command: "npm run dev",
                            type: "daemon",
                            configPath: "openade.toml",
                            cwd: project.path,
                        },
                    ],
                    instances: projectProcessId
                        ? [
                              {
                                  processId: projectProcessId,
                                  definitionId: "dev-server",
                                  repoId: params.repoId,
                                  cwd: project.path,
                                  completed: false,
                                  exitCode: null,
                                  signal: null,
                              },
                          ]
                        : [],
                    errors: [],
                }
            },
            readCronDefinitions: async (params) => {
                hooks.onReadCronDefinitions?.()
                return {
                    repoId: params.repoId,
                    taskId: params.taskId,
                    searchRoot: project.path,
                    repoRoot: project.path,
                    isWorktree: false,
                    configs: [
                        {
                            relativePath: "openade.toml",
                            crons: [
                                {
                                    id: "openade.toml::Runtime Cron",
                                    name: "Runtime Cron",
                                    schedule: "* * * * *",
                                    type: "do",
                                    prompt: "Run runtime cron",
                                },
                            ],
                        },
                    ],
                    errors: [],
                }
            },
            startProjectProcess: async (params) => {
                projectProcessId = "process-1"
                return {
                    repoId: params.repoId,
                    definitionId: params.definitionId,
                    processId: projectProcessId,
                }
            },
            reconnectProjectProcess: async (params) => ({
                repoId: params.repoId,
                processId: params.processId,
                found: params.processId === projectProcessId,
                completed: false,
                output: [{ type: "stdout", data: "dev server ready\n", timestamp: 1 }],
            }),
            stopProjectProcess: async (params) => {
                if (params.processId === projectProcessId) projectProcessId = null
                return { repoId: params.repoId, processId: params.processId, ok: true }
            },
            startTaskTerminal: unsupportedMutation("startTaskTerminal"),
            reconnectTaskTerminal: unsupportedMutation("reconnectTaskTerminal"),
            writeTaskTerminal: unsupportedMutation("writeTaskTerminal"),
            resizeTaskTerminal: unsupportedMutation("resizeTaskTerminal"),
            stopTaskTerminal: unsupportedMutation("stopTaskTerminal"),
            readTaskImage: async (params) => ({
                repoId: params.repoId,
                taskId: params.taskId,
                imageId: params.imageId,
                ext: params.ext,
                data: null,
            }),
            readTaskGitSummary: async (params) => {
                hooks.onReadTaskGitSummary?.()
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
                        stats: { filesChanged: 1, insertions: 1, deletions: 0 },
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
                ],
            }),
            readTaskResourceInventory: async (params) => ({
                repoId: params.repoId,
                taskId: params.taskId,
                taskTitle: params.task.title,
                isRunning: params.isRunning,
                snapshotIds: [],
                images: [],
                sessions: [],
                worktree: null,
            }),
            generateTaskTitle: async (params) => ({
                repoId: params.repoId,
                taskId: params.taskId,
                title: "Runtime route title",
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
                cwd: "/tmp/runtime-route-repo",
                rootPath: "/tmp/runtime-route-repo",
            }),
            readTaskChanges: async (params) => {
                hooks.onReadTaskChanges?.()
                return {
                    repoId: params.repoId,
                    taskId: params.taskId,
                    files: [],
                    fromTreeish: "HEAD",
                    toTreeish: "HEAD",
                }
            },
            readTaskDiff: async (params) => ({
                repoId: params.repoId,
                taskId: params.taskId,
                filePath: params.filePath,
                oldPath: params.oldPath,
                fromTreeish: "HEAD",
                toTreeish: "HEAD",
                patch: "",
                truncated: false,
                heavy: false,
                stats: { insertions: 0, deletions: 0, changedLines: 0, hunkCount: 0 },
            }),
            readTaskFilePair: async (params) => ({
                repoId: params.repoId,
                taskId: params.taskId,
                filePath: params.filePath,
                oldPath: params.oldPath,
                fromTreeish: "HEAD",
                toTreeish: "",
                before: "",
                after: "",
            }),
            readTaskGitLog: async (params) => ({
                repoId: params.repoId,
                taskId: params.taskId,
                commits: [],
                hasMore: false,
            }),
            readTaskGitCommitFiles: unsupportedMutation("readTaskGitCommitFiles"),
            readTaskGitFileAtTreeish: unsupportedMutation("readTaskGitFileAtTreeish"),
            readTaskGitCommitFilePatch: unsupportedMutation("readTaskGitCommitFilePatch"),
            commitTaskGit: unsupportedMutation("commitTaskGit"),
            readTaskSnapshotPatch: unsupportedMutation("readTaskSnapshotPatch"),
            readTaskSnapshotIndex: unsupportedMutation("readTaskSnapshotIndex"),
            readTaskSnapshotPatchSlice: unsupportedMutation("readTaskSnapshotPatchSlice"),
        },
    }
    server.registerModule(createOpenADEModule(adapters))
    server.register("host/capabilities/read", () => ({
        enabled: true,
        version: "route-test",
    }))
    server.register("host/platform/info", () => ({
        platform: "darwin",
        pathSeparator: "/",
        homeDir: "/Users/test",
        isWindows: false,
        isMac: true,
        isLinux: false,
    }))
    server.register("git/directory/read", () => ({
        isGitDirectory: false,
        error: "not a git repo in route smoke test",
    }))
    server.register("agent/sdkCapabilities/read", () => {
        hooks.onReadSdkCapabilities?.()
        return null
    })
    return server
}

function cleanManagedCoreRolloutState(): OpenADECoreRolloutState {
    return {
        status: "connected",
        source: "managed",
        reason: "managed-core",
        automatic: true,
        legacyYjsDocumentsPresent: false,
        legacyYjsMigrationAccepted: false,
    }
}

function acceptedLegacyImportCoreRolloutState(): OpenADECoreRolloutState {
    return {
        status: "connected",
        source: "managed",
        reason: "legacy-yjs-migration-accepted",
        automatic: true,
        legacyYjsDocumentsPresent: true,
        legacyYjsMigrationAccepted: true,
    }
}

function createDeferred(): { promise: Promise<void>; resolve: () => void } {
    let resolvePromise: (() => void) | null = null
    const promise = new Promise<void>((resolve) => {
        resolvePromise = resolve
    })
    return {
        promise,
        resolve: () => {
            if (!resolvePromise) throw new Error("Deferred promise was not initialized")
            resolvePromise()
        },
    }
}

function createRouteCodeStore(overrides: Partial<CodeStoreConfig> = {}): CodeStore {
    return new CodeStore({
        ...overrides,
        getCurrentUser: overrides.getCurrentUser ?? (() => ({ id: "user-1", email: "user@example.com" })),
        navigateToTask: overrides.navigateToTask ?? (() => undefined),
        runtimeProductStoreFactory:
            overrides.runtimeProductStoreFactory ?? (() => new OpenADEProductStore(localOpenADEClient, localOpenADEClient)),
    })
}

function installOpenADEApiRuntimeBridge(
    server: RuntimeServer,
    options: {
        coreRolloutState?: OpenADECoreRolloutState
        cleanManagedCore?: boolean
        permissions?: string[]
        onRuntimeRequest?: (method: string) => void
    } = {}
): () => void {
    const previous = window.openadeAPI
    const listeners = new Set<(message: unknown) => void>()
    let disposeConnection: (() => void) | null = null
    const connection: RuntimeConnection = {
        id: "desktop-route-openade-api",
        ...(options.permissions ? { permissions: options.permissions } : {}),
        send(message: RuntimeMessage) {
            for (const listener of listeners) listener(message)
        },
    }
    const noopUnsubscribe = () => undefined
    window.openadeAPI = {
        app: {
            activeWorkUnloadBlockerDisabled: true,
            quit: async () => undefined,
            restart: async () => undefined,
            openUrl: async () => undefined,
            applyUpdate: async () => undefined,
            forceEnableDevTools: async () => undefined,
            isWindowedWithFrame: async () => false,
            setTerminalKeyboardCapture: async () => undefined,
            onUpdateAvailable: () => noopUnsubscribe,
            onUpdateError: () => noopUnsubscribe,
            onFocusInputShortcut: () => noopUnsubscribe,
            retryUpdateCheck: async () => undefined,
        },
        window: {
            isPinned: async () => false,
            isAutoHide: async () => false,
            action: async () => undefined,
            frameEnabled: async () => true,
            setFrameColors: async () => undefined,
            findInPage: async () => null,
        },
        settings: {
            getDeviceConfig: async () => null,
            setDeviceId: async () => null,
            setTelemetryDisabled: async () => undefined,
        },
        shell: {
            selectDirectory: async () => ({ canceled: true }),
            openUrl: async () => undefined,
            openPath: async () => undefined,
        },
        codeWindowFrame: {
            enabled: async () => true,
            setColors: async () => undefined,
        },
        notifications: {
            getState: async () => null,
            shouldShow: async () => false,
        },
        companion: {
            getState: async () => null,
            setEnabled: async () => null,
            setKeepAwakeMode: async () => null,
            startPairing: async () => null,
        },
        ...(options.coreRolloutState || options.cleanManagedCore
            ? {
                  core: {
                      ...previous?.core,
                      rolloutState: options.coreRolloutState ?? cleanManagedCoreRolloutState(),
                  },
              }
            : {}),
        runtime: {
            connect: async () => {
                disposeConnection?.()
                disposeConnection = server.connect(connection)
                return null
            },
            disconnect: async () => {
                disposeConnection?.()
                disposeConnection = null
                return null
            },
            request: async (rawRequest: unknown) => {
                const request = validateRuntimeRequest(rawRequest)
                if (!request.ok) throw new Error(request.error.message)
                options.onRuntimeRequest?.(request.value.method)
                return server.handleRequest(request.value, connection, {
                    requireInitialized: true,
                })
            },
            onMessage: (cb: (message: unknown) => void) => {
                listeners.add(cb)
                return () => listeners.delete(cb)
            },
        },
    }
    return () => {
        disposeConnection?.()
        disposeConnection = null
        listeners.clear()
        window.openadeAPI = previous
    }
}

function LocationProbe({ onPath }: { onPath: (path: string) => void }) {
    const location = useLocation()
    useEffect(() => {
        onPath(location.pathname)
    }, [location.pathname, onPath])
    return null
}

async function waitForPath(paths: string[], expected: string): Promise<void> {
    for (let attempt = 0; attempt < 40; attempt += 1) {
        if (paths.at(-1) === expected) return
        await new Promise((resolve) => window.setTimeout(resolve, 10))
    }
    expect(paths.at(-1)).toBe(expected)
}

async function waitForText(container: HTMLElement, expected: string): Promise<void> {
    await vi.waitFor(
        async () => {
            await new Promise((resolve) => window.setTimeout(resolve, 10))
            expect(container.textContent).toContain(expected)
        },
        { timeout: 1500, interval: 10 }
    )
}

function clickElement(element: HTMLElement): void {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
}

function findButtonByText(container: HTMLElement, text: string): HTMLButtonElement {
    const button = Array.from(container.querySelectorAll("button")).find((candidate) => candidate.textContent?.trim() === text)
    if (!(button instanceof HTMLButtonElement)) throw new Error(`Button "${text}" was not rendered`)
    return button
}

function findButtonByTitlePrefix(container: HTMLElement, titlePrefix: string): HTMLButtonElement {
    const button = Array.from(container.querySelectorAll("button")).find((candidate) => candidate.title.startsWith(titlePrefix))
    if (!(button instanceof HTMLButtonElement)) {
        const titles = Array.from(container.querySelectorAll("button"))
            .map((candidate) => candidate.title || candidate.textContent?.trim() || "<untitled>")
            .join(", ")
        throw new Error(`Button titled with "${titlePrefix}" was not rendered. Buttons: ${titles}`)
    }
    return button
}

describe("Code routes with runtime product API", () => {
    let container: HTMLDivElement
    let root: Root
    let cleanupOpenADEApi: (() => void) | null = null
    let previousActEnvironment: boolean | undefined

    beforeEach(() => {
        const testGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
        previousActEnvironment = testGlobal.IS_REACT_ACT_ENVIRONMENT
        // This file is a full browser smoke for app-shell routes; Base UI schedules
        // layout state outside React act, so assertions poll the rendered DOM directly.
        testGlobal.IS_REACT_ACT_ENVIRONMENT = false
        container = document.createElement("div")
        document.body.appendChild(container)
        root = createRoot(container)
    })

    afterEach(async () => {
        root.unmount()
        cleanupOpenADEApi?.()
        cleanupOpenADEApi = null
        await localRuntimeClient.close()
        resetCodeModuleCapabilitiesForTests()
        resetPlatformInfoForTests()
        container.remove()
        ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
    })

    it("redirects the desktop base route to the latest runtime-backed task preview from the default-on real local runtime path", async () => {
        cleanupOpenADEApi = installOpenADEApiRuntimeBridge(createRouteRuntimeServer())
        const codeStore = createRouteCodeStore()
        try {
            await codeStore.initializeRuntimeProductStore()
            const paths: string[] = []

            const router = createElement(
                MemoryRouter,
                { initialEntries: ["/dashboard/code"] },
                createElement(LocationProbe, { onPath: (path) => paths.push(path) }),
                createElement(
                    Routes,
                    null,
                    createElement(Route, {
                        path: "/dashboard/code",
                        element: createElement(CodeBaseRoute),
                    }),
                    createElement(Route, {
                        path: "/dashboard/code/workspace/:workspaceId/task/:taskId",
                        element: createElement("div"),
                    })
                )
            )
            root.render(createElement(CodeStoreProvider, { store: codeStore }, router))

            await waitForPath(paths, "/dashboard/code/workspace/repo-1/task/task-1")
        } finally {
            codeStore.disconnectAllStores()
        }
    })

    it("redirects the clean managed Core base route from direct project list when snapshot projection is unavailable", async () => {
        const trackSpy = vi.spyOn(analytics, "track").mockImplementation(() => undefined)
        const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined)
        let projectReadCount = 0
        cleanupOpenADEApi = installOpenADEApiRuntimeBridge(
            createRouteRuntimeServer({
                snapshotError: new Error("snapshot unavailable"),
                onReadProjects: () => {
                    projectReadCount += 1
                },
            }),
            { cleanManagedCore: true }
        )
        const codeStore = createRouteCodeStore()
        try {
            await codeStore.initializeRuntimeProductStore()
            expect(codeStore.runtimeProductSnapshot).toBeNull()
            expect(codeStore.getRuntimeProductProject("repo-1")).toEqual(expect.objectContaining({ id: "repo-1", name: "Runtime Route Repo" }))
            const paths: string[] = []

            const router = createElement(
                MemoryRouter,
                { initialEntries: ["/dashboard/code"] },
                createElement(LocationProbe, { onPath: (path) => paths.push(path) }),
                createElement(
                    Routes,
                    null,
                    createElement(Route, {
                        path: "/dashboard/code",
                        element: createElement(CodeBaseRoute),
                    }),
                    createElement(Route, {
                        path: "/dashboard/code/workspace/create",
                        element: createElement("div"),
                    }),
                    createElement(Route, {
                        path: "/dashboard/code/workspace/:workspaceId/task/:taskId",
                        element: createElement("div"),
                    })
                )
            )
            root.render(createElement(CodeStoreProvider, { store: codeStore }, router))

            await waitForPath(paths, "/dashboard/code/workspace/repo-1/task/task-1")
            expect(projectReadCount).toBe(1)
            expect(codeStore.runtimeProductSnapshot).toBeNull()
            expect(codeStore.getRuntimeProductProject("repo-1")).toEqual(expect.objectContaining({ id: "repo-1", name: "Runtime Route Repo" }))
            expect(paths).not.toContain("/dashboard/code/workspace/create")
            expect(trackSpy).not.toHaveBeenCalledWith("runtime_product_store_fallback", expect.anything())
        } finally {
            consoleWarnSpy.mockRestore()
            trackSpy.mockRestore()
            codeStore.disconnectAllStores()
        }
    })

    it("shows clean managed Core projection failures instead of onboarding or workspace creation", async () => {
        const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined)
        cleanupOpenADEApi = installOpenADEApiRuntimeBridge(
            createRouteRuntimeServer({
                snapshotError: new Error("snapshot unavailable"),
                projectListError: new Error("project list unavailable"),
            }),
            { cleanManagedCore: true }
        )
        const codeStore = createRouteCodeStore()
        try {
            await codeStore.initializeRuntimeProductStore()
            expect(codeStore.runtimeProductStoreStatus).toBe("error")
            expect(codeStore.runtimeProductStoreError).toBe("project list unavailable")
            const paths: string[] = []

            const router = createElement(
                MemoryRouter,
                { initialEntries: ["/dashboard/code"] },
                createElement(LocationProbe, { onPath: (path) => paths.push(path) }),
                createElement(
                    Routes,
                    null,
                    createElement(Route, {
                        path: "/dashboard/code",
                        element: createElement(CodeBaseRoute),
                    }),
                    createElement(Route, {
                        path: "/dashboard/code/workspace/create",
                        element: createElement("div"),
                    })
                )
            )
            root.render(createElement(CodeStoreProvider, { store: codeStore }, router))

            await waitForText(container, "OpenADE Core is unavailable")
            expect(container.textContent).toContain("project list unavailable")
            expect(container.textContent).not.toContain("Welcome")
            expect(paths).toEqual(["/dashboard/code"])
        } finally {
            consoleWarnSpy.mockRestore()
            codeStore.disconnectAllStores()
        }
    })

    it("redirects the clean managed Core base route from project list when snapshot is not advertised", async () => {
        const trackSpy = vi.spyOn(analytics, "track").mockImplementation(() => undefined)
        const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined)
        let snapshotReadCount = 0
        let projectReadCount = 0
        cleanupOpenADEApi = installOpenADEApiRuntimeBridge(
            createRouteRuntimeServer({
                onReadSnapshot: () => {
                    snapshotReadCount += 1
                },
                onReadProjects: () => {
                    projectReadCount += 1
                },
            }),
            {
                cleanManagedCore: true,
                permissions: ["initialize", "host/capabilities/read", "host/platform/info", OPENADE_METHOD.projectList],
            }
        )
        const codeStore = createRouteCodeStore()
        try {
            await codeStore.initializeRuntimeProductStore()
            expect(codeStore.runtimeProductSnapshot).toBeNull()
            expect(snapshotReadCount).toBe(0)
            expect(projectReadCount).toBe(1)
            const paths: string[] = []

            const router = createElement(
                MemoryRouter,
                { initialEntries: ["/dashboard/code"] },
                createElement(LocationProbe, { onPath: (path) => paths.push(path) }),
                createElement(
                    Routes,
                    null,
                    createElement(Route, {
                        path: "/dashboard/code",
                        element: createElement(CodeBaseRoute),
                    }),
                    createElement(Route, {
                        path: "/dashboard/code/workspace/create",
                        element: createElement("div"),
                    }),
                    createElement(Route, {
                        path: "/dashboard/code/workspace/:workspaceId/task/:taskId",
                        element: createElement("div"),
                    })
                )
            )
            root.render(createElement(CodeStoreProvider, { store: codeStore }, router))

            await waitForPath(paths, "/dashboard/code/workspace/repo-1/task/task-1")
            expect(snapshotReadCount).toBe(0)
            expect(projectReadCount).toBe(1)
            expect(codeStore.runtimeProductSnapshot).toBeNull()
            expect(codeStore.getRuntimeProductProject("repo-1")).toEqual(expect.objectContaining({ id: "repo-1", name: "Runtime Route Repo" }))
            expect(paths).not.toContain("/dashboard/code/workspace/create")
            expect(trackSpy).not.toHaveBeenCalledWith("runtime_product_store_error", expect.objectContaining({ source: "initialize_snapshot" }))
            expect(trackSpy).not.toHaveBeenCalledWith("runtime_product_store_fallback", expect.anything())
        } finally {
            consoleWarnSpy.mockRestore()
            trackSpy.mockRestore()
            codeStore.disconnectAllStores()
        }
    })

    it("redirects the accepted legacy-import Core base route from direct project list when snapshot projection is unavailable", async () => {
        const trackSpy = vi.spyOn(analytics, "track").mockImplementation(() => undefined)
        const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined)
        let projectReadCount = 0
        cleanupOpenADEApi = installOpenADEApiRuntimeBridge(
            createRouteRuntimeServer({
                snapshotError: new Error("snapshot unavailable"),
                onReadProjects: () => {
                    projectReadCount += 1
                },
            }),
            { coreRolloutState: acceptedLegacyImportCoreRolloutState() }
        )
        const codeStore = createRouteCodeStore()
        try {
            await codeStore.initializeRuntimeProductStore()
            expect(codeStore.usesCleanManagedCoreRuntime()).toBe(false)
            expect(codeStore.usesCoreOwnedProductRuntime()).toBe(true)
            expect(codeStore.runtimeProductSnapshot).toBeNull()
            expect(codeStore.getRuntimeProductProject("repo-1")).toEqual(expect.objectContaining({ id: "repo-1", name: "Runtime Route Repo" }))
            const paths: string[] = []

            const router = createElement(
                MemoryRouter,
                { initialEntries: ["/dashboard/code"] },
                createElement(LocationProbe, { onPath: (path) => paths.push(path) }),
                createElement(
                    Routes,
                    null,
                    createElement(Route, {
                        path: "/dashboard/code",
                        element: createElement(CodeBaseRoute),
                    }),
                    createElement(Route, {
                        path: "/dashboard/code/workspace/create",
                        element: createElement("div"),
                    }),
                    createElement(Route, {
                        path: "/dashboard/code/workspace/:workspaceId/task/:taskId",
                        element: createElement("div"),
                    })
                )
            )
            root.render(createElement(CodeStoreProvider, { store: codeStore }, router))

            await waitForPath(paths, "/dashboard/code/workspace/repo-1/task/task-1")
            expect(projectReadCount).toBe(1)
            expect(codeStore.runtimeProductSnapshot).toBeNull()
            expect(codeStore.getRuntimeProductProject("repo-1")).toEqual(expect.objectContaining({ id: "repo-1", name: "Runtime Route Repo" }))
            expect(paths).not.toContain("/dashboard/code/workspace/create")
            expect(trackSpy).not.toHaveBeenCalledWith("runtime_product_store_fallback", expect.anything())
        } finally {
            consoleWarnSpy.mockRestore()
            trackSpy.mockRestore()
            codeStore.disconnectAllStores()
        }
    })

    it("keeps the desktop workspace route on the classic task redirect while using runtime project DTOs", async () => {
        const trackSpy = vi.spyOn(analytics, "track").mockImplementation(() => undefined)
        cleanupOpenADEApi = installOpenADEApiRuntimeBridge(createRouteRuntimeServer())
        const codeStore = createRouteCodeStore()
        try {
            await codeStore.initializeRuntimeProductStore()
            codeStore.storeInitialized = true
            codeStore.tasks.ensureTasksLoaded("repo-1")
            const paths: string[] = []

            const router = createElement(
                MemoryRouter,
                { initialEntries: ["/dashboard/code/workspace/repo-1"] },
                createElement(LocationProbe, { onPath: (path) => paths.push(path) }),
                createElement(
                    Routes,
                    null,
                    createElement(Route, {
                        path: "/dashboard/code/workspace/:workspaceId",
                        element: createElement(CodeWorkspaceRoute),
                    }),
                    createElement(Route, {
                        path: "/dashboard/code/workspace/:workspaceId/task/:taskId",
                        element: createElement("div"),
                    })
                )
            )
            root.render(createElement(CodeStoreProvider, { store: codeStore }, router))

            await waitForPath(paths, "/dashboard/code/workspace/repo-1/task/task-1")
            expect(trackSpy).not.toHaveBeenCalledWith("runtime_product_store_fallback", expect.anything())
            expect(trackSpy).not.toHaveBeenCalledWith("runtime_product_store_error", expect.anything())
        } finally {
            trackSpy.mockRestore()
            codeStore.disconnectAllStores()
        }
    })

    it("redirects the clean managed Core workspace route from direct project list when snapshot projection is unavailable", async () => {
        const trackSpy = vi.spyOn(analytics, "track").mockImplementation(() => undefined)
        const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined)
        let projectReadCount = 0
        let projectListRequestCount = 0
        cleanupOpenADEApi = installOpenADEApiRuntimeBridge(
            createRouteRuntimeServer({
                snapshotError: new Error("snapshot unavailable"),
                onReadProjects: () => {
                    projectReadCount += 1
                },
            }),
            {
                cleanManagedCore: true,
                onRuntimeRequest: (method) => {
                    if (method === OPENADE_METHOD.projectList) projectListRequestCount += 1
                },
            }
        )
        const codeStore = createRouteCodeStore()
        try {
            await codeStore.initializeRuntimeProductStore()
            codeStore.storeInitialized = true
            expect(codeStore.runtimeProductSnapshot).toBeNull()
            expect(codeStore.getRuntimeProductProject("repo-1")).toEqual(expect.objectContaining({ id: "repo-1", name: "Runtime Route Repo" }))
            expect(projectReadCount).toBe(1)
            expect(projectListRequestCount).toBe(1)
            const paths: string[] = []

            const router = createElement(
                MemoryRouter,
                { initialEntries: ["/dashboard/code/workspace/repo-1"] },
                createElement(LocationProbe, { onPath: (path) => paths.push(path) }),
                createElement(
                    Routes,
                    null,
                    createElement(Route, {
                        path: "/dashboard/code/workspace/:workspaceId",
                        element: createElement(CodeWorkspaceRoute),
                    }),
                    createElement(Route, {
                        path: "/dashboard/code/workspace/:workspaceId/task/:taskId",
                        element: createElement("div"),
                    }),
                    createElement(Route, {
                        path: "/dashboard/code/workspace/:workspaceId/task/create",
                        element: createElement("div"),
                    })
                )
            )
            root.render(createElement(CodeStoreProvider, { store: codeStore }, router))

            await waitForPath(paths, "/dashboard/code/workspace/repo-1/task/task-1")
            expect(projectListRequestCount).toBe(1)
            expect(codeStore.runtimeProductSnapshot).toBeNull()
            expect(codeStore.getRuntimeProductProject("repo-1")).toEqual(expect.objectContaining({ id: "repo-1", name: "Runtime Route Repo" }))
            expect(paths).not.toContain("/dashboard/code/workspace/repo-1/task/create")
            expect(trackSpy).not.toHaveBeenCalledWith("runtime_product_store_fallback", expect.anything())
        } finally {
            consoleWarnSpy.mockRestore()
            trackSpy.mockRestore()
            codeStore.disconnectAllStores()
        }
    })

    it("renders the classic task-create route for clean managed Core without a snapshot-backed repo projection", async () => {
        const trackSpy = vi.spyOn(analytics, "track").mockImplementation(() => undefined)
        const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined)
        const createdTasks: OpenADETaskCreateRequest[] = []
        const startedTurns: OpenADETurnStartRequest[] = []
        let snapshotReadCount = 0
        let projectReadCount = 0
        let projectListRequestCount = 0
        cleanupOpenADEApi = installOpenADEApiRuntimeBridge(
            createRouteRuntimeServer({
                snapshotError: new Error("snapshot unavailable"),
                onReadSnapshot: () => {
                    snapshotReadCount += 1
                },
                onReadProjects: () => {
                    projectReadCount += 1
                },
                onCreateTask: (params) => createdTasks.push(params),
                onStartTurn: (params) => startedTurns.push(params),
            }),
            {
                cleanManagedCore: true,
                onRuntimeRequest: (method) => {
                    if (method === OPENADE_METHOD.projectList) projectListRequestCount += 1
                },
            }
        )
        const codeStore = createRouteCodeStore()
        try {
            await codeStore.initializeRuntimeProductStore()
            codeStore.storeInitialized = true
            codeStore.setDefaultHarnessId("codex")
            codeStore.setDefaultModel(routeModelId)
            expect(codeStore.runtimeProductSnapshot).toBeNull()
            expect(codeStore.getRuntimeProductProject("repo-1")).toEqual(expect.objectContaining({ id: "repo-1", name: "Runtime Route Repo" }))
            expect(snapshotReadCount).toBe(0)
            expect(projectReadCount).toBe(1)
            expect(projectListRequestCount).toBe(1)

            const router = createElement(
                MemoryRouter,
                { initialEntries: ["/dashboard/code/workspace/repo-1/task/create"] },
                createElement(
                    Routes,
                    null,
                    createElement(Route, {
                        path: "/dashboard/code/workspace/:workspaceId/task/create",
                        element: createElement(CodeWorkspaceTaskCreateRoute),
                    }),
                    createElement(Route, {
                        path: "/dashboard/code/workspace/:workspaceId/task/create/:creationId",
                        element: createElement(CodeWorkspaceTaskCreatingRoute),
                    })
                )
            )
            root.render(createElement(CodeStoreProvider, { store: codeStore }, router))

            await vi.waitFor(() => expect(findButtonByTitlePrefix(container, "Do")).toBeInstanceOf(HTMLButtonElement), { timeout: 1000, interval: 10 })
            expect(container.textContent).not.toContain("Workspace not found")
            expect(container.querySelector('[data-openade-surface="desktop-classic-task-create"]')).toBeInstanceOf(HTMLElement)
            expect(container.querySelector('[data-openade-surface="shared-new-task"]')).toBeNull()
            await vi.waitFor(() => expect(container.textContent).toContain("Worktree"), { timeout: 1000, interval: 10 })
            expect(projectListRequestCount).toBe(1)

            const editorManager = codeStore.smartEditors.getManager("task-create", "repo-1")
            editorManager.setValue("Create through the clean Core route")
            const doButton = findButtonByTitlePrefix(container, "Do")
            await vi.waitFor(() => expect(doButton.disabled).toBe(false), {
                timeout: 1000,
                interval: 10,
            })
            const snapshotReadsBeforeCreate = snapshotReadCount
            const projectListRequestsBeforeCreate = projectListRequestCount
            clickElement(doButton)

            await vi.waitFor(() => expect(startedTurns).toHaveLength(1), {
                timeout: 1000,
                interval: 10,
            })
            expect(createdTasks).toHaveLength(1)
            expect(createdTasks[0]).toMatchObject({
                repoId: "repo-1",
                input: "Create through the clean Core route",
                isolationStrategy: { type: "head" },
                createdBy: { id: "user-1", email: "user@example.com" },
            })
            expect(startedTurns[0]).toMatchObject({
                repoId: "repo-1",
                inTaskId: "task-1",
                type: "do",
                input: "Create through the clean Core route",
                harnessId: "codex",
                modelId: routeModelId,
                thinking: "max",
                fastMode: false,
            })
            expect(startedTurns[0]).not.toHaveProperty("isolationStrategy")
            expect(codeStore.getRuntimeProductProject("repo-1")).toEqual(expect.objectContaining({ id: "repo-1", name: "Runtime Route Repo" }))
            expect(snapshotReadCount).toBe(snapshotReadsBeforeCreate)
            expect(projectListRequestCount).toBe(projectListRequestsBeforeCreate)
            expect(trackSpy).not.toHaveBeenCalledWith("runtime_product_store_fallback", expect.anything())
        } finally {
            consoleWarnSpy.mockRestore()
            trackSpy.mockRestore()
            codeStore.disconnectAllStores()
        }
    })

    it("renders workspace settings for clean managed Core from the direct project list when snapshot projection is unavailable", async () => {
        const trackSpy = vi.spyOn(analytics, "track").mockImplementation(() => undefined)
        const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined)
        let projectReadCount = 0
        let projectListRequestCount = 0
        cleanupOpenADEApi = installOpenADEApiRuntimeBridge(
            createRouteRuntimeServer({
                snapshotError: new Error("snapshot unavailable"),
                onReadProjects: () => {
                    projectReadCount += 1
                },
            }),
            {
                cleanManagedCore: true,
                onRuntimeRequest: (method) => {
                    if (method === OPENADE_METHOD.projectList) projectListRequestCount += 1
                },
            }
        )
        const codeStore = createRouteCodeStore()
        try {
            await codeStore.initializeRuntimeProductStore()
            codeStore.storeInitialized = true
            expect(codeStore.runtimeProductSnapshot).toBeNull()
            expect(codeStore.getRuntimeProductProject("repo-1")).toEqual(expect.objectContaining({ id: "repo-1", name: "Runtime Route Repo" }))
            expect(projectReadCount).toBe(1)
            expect(projectListRequestCount).toBe(1)

            const router = createElement(
                MemoryRouter,
                { initialEntries: ["/dashboard/code/workspace/repo-1/settings"] },
                createElement(
                    Routes,
                    null,
                    createElement(Route, {
                        path: "/dashboard/code/workspace/:workspaceId/settings",
                        element: createElement(CodeWorkspaceSettingsRoute),
                    })
                )
            )
            root.render(createElement(CodeStoreProvider, { store: codeStore }, router))

            await waitForText(container, "Workspace Settings")
            await waitForText(container, "Runtime Route Repo")

            expect(projectListRequestCount).toBe(1)
            expect(codeStore.runtimeProductSnapshot).toBeNull()
            expect(codeStore.getRuntimeProductProject("repo-1")).toEqual(expect.objectContaining({ id: "repo-1", name: "Runtime Route Repo" }))
            expect(container.textContent).not.toContain("Workspace not found")
            expect(trackSpy).not.toHaveBeenCalledWith("runtime_product_store_fallback", expect.anything())
        } finally {
            consoleWarnSpy.mockRestore()
            trackSpy.mockRestore()
            codeStore.disconnectAllStores()
        }
    })

    it("loads the classic task route for clean managed Core without a snapshot-backed repo projection", async () => {
        const trackSpy = vi.spyOn(analytics, "track").mockImplementation(() => undefined)
        const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined)
        const taskReads: Array<{
            repoId: string
            taskId: string
            options?: OpenADETaskReadOptions
        }> = []
        const taskReadGate = createDeferred()
        cleanupOpenADEApi = installOpenADEApiRuntimeBridge(
            createRouteRuntimeServer({
                snapshotError: new Error("snapshot unavailable"),
                onReadTask: (params) => taskReads.push(params),
                beforeReadTask: () => taskReadGate.promise,
            }),
            { cleanManagedCore: true }
        )
        const codeStore = createRouteCodeStore()
        const legacyTaskStoreRead = vi.spyOn(codeStore, "getTaskStore")
        try {
            await codeStore.initializeRuntimeProductStore()
            codeStore.storeInitialized = true
            expect(codeStore.runtimeProductSnapshot).toBeNull()
            expect(codeStore.getRuntimeProductProject("repo-1")).toEqual(expect.objectContaining({ id: "repo-1", name: "Runtime Route Repo" }))

            const router = createElement(
                MemoryRouter,
                { initialEntries: ["/dashboard/code/workspace/repo-1/task/task-1"] },
                createElement(
                    Routes,
                    null,
                    createElement(Route, {
                        path: "/dashboard/code/workspace/:workspaceId/task/:taskId",
                        element: createElement(CodeWorkspaceTaskRoute),
                    })
                )
            )
            root.render(createElement(CodeStoreProvider, { store: codeStore }, router))

            await waitForText(container, "Runtime route task")
            expect(container.querySelector('[data-openade-surface="desktop-classic-task"]')).toBeInstanceOf(HTMLElement)
            expect(container.textContent).not.toContain("Loading task")
            expect(container.textContent).not.toContain("Environment setup")
            await vi.waitFor(() => expect(taskReads).toHaveLength(1), { timeout: 1000, interval: 10 })

            taskReadGate.resolve()
            await waitForText(container, "Runtime route task")
            await waitForText(container, "Do the runtime-backed work")

            expect(container.textContent).not.toContain("Workspace not found")
            expect(container.querySelector('[data-openade-surface="desktop-classic-task"]')).toBeInstanceOf(HTMLElement)
            expect(codeStore.getRuntimeProductProject("repo-1")).toEqual(expect.objectContaining({ id: "repo-1", name: "Runtime Route Repo" }))
            expect(codeStore.tasks.getTask("task-1")).toEqual(expect.objectContaining({ id: "task-1", repoId: "repo-1" }))
            expect(taskReads[0]).toEqual({
                repoId: "repo-1",
                taskId: "task-1",
                options: { hydrateSessionEvents: false, eventLimit: 12 },
            })
            expect(taskReads.every((read) => read.options?.hydrateSessionEvents === false && read.options?.eventLimit === 12)).toBe(true)
            expect(legacyTaskStoreRead).not.toHaveBeenCalled()
            expect(trackSpy).not.toHaveBeenCalledWith("runtime_product_store_fallback", expect.anything())
        } finally {
            legacyTaskStoreRead.mockRestore()
            consoleWarnSpy.mockRestore()
            trackSpy.mockRestore()
            codeStore.disconnectAllStores()
        }
    })

    it("derives classic task route title controls from runtime shell capabilities", async () => {
        const trackSpy = vi.spyOn(analytics, "track").mockImplementation(() => undefined)
        const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined)
        cleanupOpenADEApi = installOpenADEApiRuntimeBridge(createRouteRuntimeServer({ snapshotError: new Error("snapshot unavailable") }), {
            cleanManagedCore: true,
            permissions: [
                "initialize",
                "host/capabilities/read",
                "host/platform/info",
                ...OPENADE_METHODS.filter((method) => method !== OPENADE_METHOD.taskTitleGenerate),
            ],
        })
        const codeStore = createRouteCodeStore()

        try {
            const router = createElement(
                MemoryRouter,
                { initialEntries: ["/dashboard/code/workspace/repo-1/task/task-1"] },
                createElement(
                    Routes,
                    null,
                    createElement(Route, {
                        path: "/dashboard/code/workspace/:workspaceId/task/:taskId",
                        element: createElement(CodeWorkspaceTaskRoute),
                    })
                )
            )
            root.render(createElement(CodeStoreProvider, { store: codeStore }, router))

            await waitForText(container, "Runtime route task")
            const releaseDismiss = Array.from(container.querySelectorAll("button")).find((candidate) => candidate.textContent?.trim() === "Got it")
            if (releaseDismiss instanceof HTMLButtonElement) clickElement(releaseDismiss)
            const title = container.querySelector('[data-openade-task-route-title="true"]')
            expect(title).toBeInstanceOf(HTMLSpanElement)
            expect((title as HTMLSpanElement).className).toContain("cursor-text")
            expect((title as HTMLSpanElement).dataset.openadeTaskRouteCanUpdateMetadata).toBe("true")
            expect((title as HTMLSpanElement).dataset.openadeTaskRouteCanGenerateTitle).toBe("false")
            expect(container.textContent).not.toContain("Generate Title")
            expect(trackSpy).not.toHaveBeenCalledWith("runtime_product_store_fallback", expect.anything())
        } finally {
            consoleWarnSpy.mockRestore()
            trackSpy.mockRestore()
            codeStore.disconnectAllStores()
        }
    })

    it("starts direct clean Core task reads before broad project initialization on a cold task URL", async () => {
        const trackSpy = vi.spyOn(analytics, "track").mockImplementation(() => undefined)
        const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined)
        const runtimeRequests: string[] = []
        let personalSettingsReadCount = 0
        const taskReadGate = createDeferred()
        cleanupOpenADEApi = installOpenADEApiRuntimeBridge(
            createRouteRuntimeServer({
                snapshotError: new Error("snapshot unavailable"),
                beforeReadTask: () => taskReadGate.promise,
                onReadPersonalSettings: () => {
                    personalSettingsReadCount += 1
                },
            }),
            {
                cleanManagedCore: true,
                onRuntimeRequest: (method) => runtimeRequests.push(method),
            }
        )
        const codeStore = createRouteCodeStore()

        try {
            const router = createElement(
                MemoryRouter,
                { initialEntries: ["/dashboard/code/workspace/repo-1/task/task-1"] },
                createElement(
                    Routes,
                    null,
                    createElement(Route, {
                        path: "/dashboard/code/workspace/:workspaceId/task/:taskId",
                        element: createElement(CodeWorkspaceTaskRoute),
                    })
                )
            )
            root.render(createElement(CodeStoreProvider, { store: codeStore }, router))

            await vi.waitFor(() => expect(runtimeRequests).toContain(OPENADE_METHOD.taskRead), { timeout: 1000, interval: 10 })
            const taskReadIndex = runtimeRequests.indexOf(OPENADE_METHOD.taskRead)
            const projectListIndex = runtimeRequests.indexOf(OPENADE_METHOD.projectList)
            expect(taskReadIndex).toBeGreaterThanOrEqual(0)
            if (projectListIndex >= 0) expect(taskReadIndex).toBeLessThan(projectListIndex)
            expect(container.textContent).not.toContain("Loading task")
            const settledProjectListIndex = runtimeRequests.indexOf(OPENADE_METHOD.projectList)
            if (settledProjectListIndex >= 0) expect(taskReadIndex).toBeLessThan(settledProjectListIndex)

            taskReadGate.resolve()
            await waitForText(container, "Runtime route task")
            await waitForText(container, "Do the runtime-backed work")
            await vi.waitFor(() => expect(personalSettingsReadCount).toBe(1), { timeout: 1000, interval: 10 })

            expect(container.querySelector('[data-openade-surface="desktop-classic-task"]')).toBeInstanceOf(HTMLElement)
            expect(container.textContent).not.toContain("Workspace not found")
            expect(codeStore.personalSettingsStore?.settings.current.newTaskModelId).toBe(routeModelId)
            expect(runtimeRequests).not.toContain(OPENADE_METHOD.projectList)
            expect(runtimeRequests).not.toContain(OPENADE_METHOD.snapshotRead)
            expect(runtimeRequests).not.toContain(OPENADE_METHOD.settingsMcpServersRead)
            expect(trackSpy).not.toHaveBeenCalledWith("runtime_product_store_fallback", expect.anything())
        } finally {
            consoleWarnSpy.mockRestore()
            trackSpy.mockRestore()
            codeStore.disconnectAllStores()
        }
    })

    it("starts direct clean Core task reads even after store initialization when no repo projection exists", async () => {
        const trackSpy = vi.spyOn(analytics, "track").mockImplementation(() => undefined)
        const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined)
        const runtimeRequests: string[] = []
        const taskReads: Array<{
            repoId: string
            taskId: string
            options?: OpenADETaskReadOptions
        }> = []
        const taskReadGate = createDeferred()
        cleanupOpenADEApi = installOpenADEApiRuntimeBridge(
            createRouteRuntimeServer({
                snapshotError: new Error("snapshot unavailable"),
                onReadTask: (params) => taskReads.push(params),
                beforeReadTask: () => taskReadGate.promise,
            }),
            {
                cleanManagedCore: true,
                onRuntimeRequest: (method) => runtimeRequests.push(method),
            }
        )
        const codeStore = createRouteCodeStore()

        try {
            codeStore.storeInitialized = true
            expect(codeStore.repos.getRepo("repo-1")).toBeUndefined()
            expect(codeStore.shouldUseRuntimeProductAPI()).toBe(false)

            const router = createElement(
                MemoryRouter,
                { initialEntries: ["/dashboard/code/workspace/repo-1/task/task-1"] },
                createElement(
                    Routes,
                    null,
                    createElement(Route, {
                        path: "/dashboard/code/workspace/:workspaceId/task/:taskId",
                        element: createElement(CodeWorkspaceTaskRoute),
                    })
                )
            )
            root.render(createElement(CodeStoreProvider, { store: codeStore }, router))

            await vi.waitFor(() => expect(taskReads).toHaveLength(1), { timeout: 1000, interval: 10 })
            expect(container.textContent).not.toContain("Workspace not found")
            expect(taskReads[0]).toEqual({
                repoId: "repo-1",
                taskId: "task-1",
                options: { hydrateSessionEvents: false, eventLimit: 12 },
            })
            expect(runtimeRequests).toContain(OPENADE_METHOD.taskRead)
            expect(runtimeRequests).not.toContain(OPENADE_METHOD.projectList)
            expect(runtimeRequests).not.toContain(OPENADE_METHOD.snapshotRead)

            taskReadGate.resolve()
            await waitForText(container, "Runtime route task")
            await waitForText(container, "Do the runtime-backed work")
            expect(codeStore.repos.getRepo("repo-1")).toBeUndefined()
            expect(codeStore.getTaskPreviewsForRepo("repo-1").map((preview) => preview.id)).toEqual(["task-1"])
            expect(container.querySelector('[data-openade-surface="desktop-classic-task"]')).toBeInstanceOf(HTMLElement)
            expect(trackSpy).not.toHaveBeenCalledWith("runtime_product_store_fallback", expect.anything())
        } finally {
            consoleWarnSpy.mockRestore()
            trackSpy.mockRestore()
            codeStore.disconnectAllStores()
        }
    })

    it("shows not found for a missing direct clean Core task without broad project repair", async () => {
        const trackSpy = vi.spyOn(analytics, "track").mockImplementation(() => undefined)
        const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined)
        const runtimeRequests: string[] = []
        const taskReads: Array<{
            repoId: string
            taskId: string
            options?: OpenADETaskReadOptions
        }> = []
        cleanupOpenADEApi = installOpenADEApiRuntimeBridge(
            createRouteRuntimeServer({
                snapshotError: new Error("snapshot unavailable"),
                readTaskError: new RuntimeHandlerError("not_found", "Task not found"),
                onReadTask: (params) => taskReads.push(params),
            }),
            {
                cleanManagedCore: true,
                onRuntimeRequest: (method) => runtimeRequests.push(method),
            }
        )
        const codeStore = createRouteCodeStore()

        try {
            const router = createElement(
                MemoryRouter,
                { initialEntries: ["/dashboard/code/workspace/repo-1/task/task-missing"] },
                createElement(
                    Routes,
                    null,
                    createElement(Route, {
                        path: "/dashboard/code/workspace/:workspaceId/task/:taskId",
                        element: createElement(CodeWorkspaceTaskRoute),
                    })
                )
            )
            root.render(createElement(CodeStoreProvider, { store: codeStore }, router))

            await waitForText(container, "Task not found")

            expect(taskReads).toEqual([
                {
                    repoId: "repo-1",
                    taskId: "task-missing",
                    options: { hydrateSessionEvents: false, eventLimit: 12 },
                },
            ])
            expect(codeStore.hasRuntimeProductRouteTaskReadMiss("repo-1", "task-missing")).toBe(true)
            expect(runtimeRequests).not.toContain(OPENADE_METHOD.projectList)
            expect(runtimeRequests).not.toContain(OPENADE_METHOD.snapshotRead)
            expect(container.textContent).not.toContain("Loading task")
            expect(container.textContent).not.toContain("Workspace not found")
            expect(trackSpy).not.toHaveBeenCalledWith("runtime_product_store_fallback", expect.anything())
        } finally {
            consoleErrorSpy.mockRestore()
            trackSpy.mockRestore()
            codeStore.disconnectAllStores()
        }
    })

    it("retries failed direct clean Core task reads without broad project repair", async () => {
        const trackSpy = vi.spyOn(analytics, "track").mockImplementation(() => undefined)
        const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined)
        const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined)
        const runtimeRequests: string[] = []
        const taskReads: Array<{
            repoId: string
            taskId: string
            options?: OpenADETaskReadOptions
        }> = []
        let failNextTaskRead = true
        cleanupOpenADEApi = installOpenADEApiRuntimeBridge(
            createRouteRuntimeServer({
                snapshotError: new Error("snapshot unavailable"),
                readTaskError: () => {
                    if (!failNextTaskRead) return null
                    failNextTaskRead = false
                    return new RuntimeHandlerError("handler_error", "database busy")
                },
                onReadTask: (params) => taskReads.push(params),
            }),
            {
                cleanManagedCore: true,
                onRuntimeRequest: (method) => runtimeRequests.push(method),
            }
        )
        const codeStore = createRouteCodeStore()

        try {
            const router = createElement(
                MemoryRouter,
                { initialEntries: ["/dashboard/code/workspace/repo-1/task/task-1"] },
                createElement(
                    Routes,
                    null,
                    createElement(Route, {
                        path: "/dashboard/code/workspace/:workspaceId/task/:taskId",
                        element: createElement(CodeWorkspaceTaskRoute),
                    })
                )
            )
            root.render(createElement(CodeStoreProvider, { store: codeStore }, router))

            await waitForText(container, "Task failed to load")
            await waitForText(container, "database busy")

            expect(codeStore.hasRuntimeProductRouteTaskReadMiss("repo-1", "task-1")).toBe(false)
            expect(codeStore.getRuntimeProductRouteTaskReadError("repo-1", "task-1")).toBe("database busy")
            expect(runtimeRequests).not.toContain(OPENADE_METHOD.projectList)
            expect(runtimeRequests).not.toContain(OPENADE_METHOD.snapshotRead)
            expect(container.textContent).not.toContain("Task not found")
            expect(container.querySelector('[data-openade-surface="desktop-classic-task"]')).toBeNull()

            clickElement(findButtonByText(container, "Retry"))

            await waitForText(container, "Runtime route task")
            await waitForText(container, "Do the runtime-backed work")

            expect(taskReads).toEqual([
                {
                    repoId: "repo-1",
                    taskId: "task-1",
                    options: { hydrateSessionEvents: false, eventLimit: 12 },
                },
                {
                    repoId: "repo-1",
                    taskId: "task-1",
                    options: { hydrateSessionEvents: false, eventLimit: 12 },
                },
            ])
            expect(codeStore.getRuntimeProductRouteTaskReadError("repo-1", "task-1")).toBeNull()
            expect(runtimeRequests).not.toContain(OPENADE_METHOD.projectList)
            expect(runtimeRequests).not.toContain(OPENADE_METHOD.snapshotRead)
            expect(container.querySelector('[data-openade-surface="desktop-classic-task"]')).toBeInstanceOf(HTMLElement)
            expect(trackSpy).not.toHaveBeenCalledWith("runtime_product_store_fallback", expect.anything())
        } finally {
            consoleWarnSpy.mockRestore()
            consoleErrorSpy.mockRestore()
            trackSpy.mockRestore()
            codeStore.disconnectAllStores()
        }
    })

    it("loads the classic task route for accepted legacy-import Core without reopening a legacy task store", async () => {
        const trackSpy = vi.spyOn(analytics, "track").mockImplementation(() => undefined)
        const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined)
        const taskReads: Array<{
            repoId: string
            taskId: string
            options?: OpenADETaskReadOptions
        }> = []
        cleanupOpenADEApi = installOpenADEApiRuntimeBridge(
            createRouteRuntimeServer({
                snapshotError: new Error("snapshot unavailable"),
                onReadTask: (params) => taskReads.push(params),
            }),
            { coreRolloutState: acceptedLegacyImportCoreRolloutState() }
        )
        const codeStore = createRouteCodeStore()
        const legacyTaskStoreRead = vi.spyOn(codeStore, "getTaskStore")
        try {
            await codeStore.initializeRuntimeProductStore()
            codeStore.storeInitialized = true
            expect(codeStore.usesCleanManagedCoreRuntime()).toBe(false)
            expect(codeStore.usesCoreOwnedProductRuntime()).toBe(true)
            expect(codeStore.runtimeProductSnapshot).toBeNull()
            expect(codeStore.getRuntimeProductProject("repo-1")).toEqual(expect.objectContaining({ id: "repo-1", name: "Runtime Route Repo" }))

            const router = createElement(
                MemoryRouter,
                { initialEntries: ["/dashboard/code/workspace/repo-1/task/task-1"] },
                createElement(
                    Routes,
                    null,
                    createElement(Route, {
                        path: "/dashboard/code/workspace/:workspaceId/task/:taskId",
                        element: createElement(CodeWorkspaceTaskRoute),
                    })
                )
            )
            root.render(createElement(CodeStoreProvider, { store: codeStore }, router))

            await waitForText(container, "Runtime route task")
            await waitForText(container, "Do the runtime-backed work")

            expect(container.textContent).not.toContain("Workspace not found")
            expect(container.querySelector('[data-openade-surface="desktop-classic-task"]')).toBeInstanceOf(HTMLElement)
            expect(codeStore.getRuntimeProductProject("repo-1")).toEqual(expect.objectContaining({ id: "repo-1", name: "Runtime Route Repo" }))
            expect(codeStore.tasks.getTask("task-1")).toEqual(expect.objectContaining({ id: "task-1", repoId: "repo-1" }))
            expect(taskReads).toEqual([
                {
                    repoId: "repo-1",
                    taskId: "task-1",
                    options: { hydrateSessionEvents: false, eventLimit: 12 },
                },
            ])
            expect(legacyTaskStoreRead).not.toHaveBeenCalled()
            expect(trackSpy).not.toHaveBeenCalledWith("runtime_product_store_fallback", expect.anything())
        } finally {
            legacyTaskStoreRead.mockRestore()
            consoleWarnSpy.mockRestore()
            trackSpy.mockRestore()
            codeStore.disconnectAllStores()
        }
    })

    it("renders the classic desktop task route by default after loading task detail through the real local runtime product store", async () => {
        const trackSpy = vi.spyOn(analytics, "track").mockImplementation(() => undefined)
        const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined)
        const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout")
        const setIntervalSpy = vi.spyOn(globalThis, "setInterval")
        const startedTurns: OpenADETurnStartRequest[] = []
        const metadataUpdates: OpenADETaskMetadataUpdateRequest[] = []
        const taskReads: Array<{
            repoId: string
            taskId: string
            options?: OpenADETaskReadOptions
        }> = []
        let snapshotReadCount = 0
        let taskGitSummaryReadCount = 0
        let taskChangesReadCount = 0
        let projectGitInfoReadCount = 0
        let projectProcessListCount = 0
        let projectCronDefinitionsReadCount = 0
        let fuzzyProjectFileSearchCount = 0
        let sdkCapabilitiesReadCount = 0
        const routeServer = createRouteRuntimeServer({
            onReadSnapshot: () => {
                snapshotReadCount += 1
            },
            onStartTurn: (params) => startedTurns.push(params),
            onUpdateTaskMetadata: (params) => metadataUpdates.push(params),
            onReadTask: (params) => taskReads.push(params),
            onReadTaskGitSummary: () => {
                taskGitSummaryReadCount += 1
            },
            onReadTaskChanges: () => {
                taskChangesReadCount += 1
            },
            onReadProjectGitInfo: () => {
                projectGitInfoReadCount += 1
            },
            onListProjectProcesses: () => {
                projectProcessListCount += 1
            },
            onReadCronDefinitions: () => {
                projectCronDefinitionsReadCount += 1
            },
            onFuzzySearchProjectFiles: () => {
                fuzzyProjectFileSearchCount += 1
            },
            onReadSdkCapabilities: () => {
                sdkCapabilitiesReadCount += 1
            },
        })
        cleanupOpenADEApi = installOpenADEApiRuntimeBridge(routeServer)
        const codeStore = createRouteCodeStore()
        try {
            await codeStore.initializeRuntimeProductStore()
            codeStore.storeInitialized = true
            codeStore.tasks.ensureTasksLoaded("repo-1")

            const router = createElement(
                MemoryRouter,
                { initialEntries: ["/dashboard/code/workspace/repo-1/task/task-1"] },
                createElement(
                    Routes,
                    null,
                    createElement(Route, {
                        path: "/dashboard/code/workspace/:workspaceId/task/:taskId",
                        element: createElement(CodeWorkspaceTaskRoute),
                    })
                )
            )
            root.render(createElement(CodeStoreProvider, { store: codeStore }, router))
            await waitForText(container, "Runtime route task")
            await waitForText(container, "Do the runtime-backed work")

            expect(container.querySelector('[data-openade-surface="desktop-classic-task"]')).toBeInstanceOf(HTMLElement)
            expect(container.querySelector('[data-openade-surface="desktop-shared-task"]')).toBeNull()
            expect(taskGitSummaryReadCount).toBe(0)
            expect(taskChangesReadCount).toBe(0)
            expect(projectGitInfoReadCount).toBe(0)
            expect(projectProcessListCount).toBe(0)
            expect(projectCronDefinitionsReadCount).toBe(0)
            expect(fuzzyProjectFileSearchCount).toBe(0)
            expect(sdkCapabilitiesReadCount).toBe(0)
            expect(codeStore.tasks.getTaskModel("task-1")?.environment).toBeNull()

            const editorManager = codeStore.smartEditors.getManager("task-task-1", "repo-1")
            await expect(editorManager.searchFileMentions("/tmp/runtime-route-repo", "readme")).resolves.toMatchObject({ results: ["README.md"] })
            expect(fuzzyProjectFileSearchCount).toBe(1)
            expect(projectGitInfoReadCount).toBe(0)
            expect(projectProcessListCount).toBe(0)
            expect(projectCronDefinitionsReadCount).toBe(0)
            expect(sdkCapabilitiesReadCount).toBe(0)

            expect(taskReads[0]).toEqual({
                repoId: "repo-1",
                taskId: "task-1",
                options: { hydrateSessionEvents: false, eventLimit: 12 },
            })
            expect(metadataUpdates.some((update) => update.lastViewedAt)).toBe(false)
            expect(codeStore.getTaskPreviewsForRepo("repo-1")[0]?.lastViewedAt).toBeDefined()
            expect(taskReads.every((read) => read.options?.hydrateSessionEvents === false)).toBe(true)
            const taskReadCountAfterOpen = taskReads.length
            const snapshotReadCountAfterOpen = snapshotReadCount
            flushSync(() => {
                root.render(createElement(CodeStoreProvider, { store: codeStore }, router))
            })
            expect(container.textContent).toContain("Runtime route task")
            expect(container.textContent).not.toContain("Loading task")
            await new Promise((resolve) => window.setTimeout(resolve, 50))
            expect(taskReads).toHaveLength(taskReadCountAfterOpen)
            expect(snapshotReadCount).toBe(snapshotReadCountAfterOpen)
            const deferredViewedTimerIndex = setTimeoutSpy.mock.calls.findIndex(
                ([callback, delay]) => delay === 300_000 && typeof callback === "function" && callback.toString().includes("flushDeferredViewedWrite")
            )
            expect(deferredViewedTimerIndex).toBeGreaterThanOrEqual(0)
            const deferredViewedCallback = setTimeoutSpy.mock.calls[deferredViewedTimerIndex]?.[0]
            const deferredViewedTimer = setTimeoutSpy.mock.results[deferredViewedTimerIndex]?.value
            if (typeof deferredViewedCallback !== "function") throw new Error("Deferred viewed timer was not scheduled with a callback")
            globalThis.clearTimeout(deferredViewedTimer as ReturnType<typeof globalThis.setTimeout>)
            deferredViewedCallback()
            await vi.waitFor(() => expect(metadataUpdates.some((update) => update.lastViewedAt !== undefined)).toBe(true), {
                timeout: 1000,
                interval: 10,
            })
            await new Promise((resolve) => window.setTimeout(resolve, 250))
            expect(taskReads).toHaveLength(taskReadCountAfterOpen)
            expect(snapshotReadCount).toBe(snapshotReadCountAfterOpen)
            expect(taskGitSummaryReadCount).toBe(0)
            expect(taskChangesReadCount).toBe(0)
            expect(projectGitInfoReadCount).toBe(0)
            expect(projectProcessListCount).toBe(0)
            expect(projectCronDefinitionsReadCount).toBe(0)
            expect(fuzzyProjectFileSearchCount).toBe(1)
            expect(sdkCapabilitiesReadCount).toBe(0)
            expect(consoleErrorSpy.mock.calls.some((call) => String(call[0]).includes("[CronManager] Failed to load product install states"))).toBe(false)
            expect(setTimeoutSpy).not.toHaveBeenCalledWith(expect.any(Function), 2500)
            await waitForText(container, "1 comment")
            clickElement(findButtonByText(container, "1 comment"))
            await waitForText(container, "Runtime pending comment")
            expect(Array.from(container.querySelectorAll("button")).some((button) => button.title === "Attach image")).toBe(false)

            editorManager.setValue("Classic desktop runtime turn")
            const doButton = findButtonByTitlePrefix(container, "Do")
            await vi.waitFor(() => expect(doButton.disabled).toBe(false), {
                timeout: 1000,
                interval: 10,
            })
            clickElement(doButton)

            await vi.waitFor(() => expect(startedTurns).toHaveLength(1), {
                timeout: 1000,
                interval: 10,
            })
            expect(startedTurns[0]).toMatchObject({
                repoId: "repo-1",
                inTaskId: "task-1",
                type: "do",
                input: "Classic desktop runtime turn",
                harnessId: "codex",
                modelId: routeModelId,
                thinking: "max",
                fastMode: false,
            })
            await waitForText(container, "Classic desktop runtime turn")

            clickElement(findButtonByText(container, "Close"))
            await waitForText(container, "Reopen")
            clickElement(findButtonByText(container, "Reopen"))
            await vi.waitFor(() => expect(findButtonByText(container, "Close")).toBeInstanceOf(HTMLButtonElement), { timeout: 1000, interval: 10 })
            expect(metadataUpdates).toEqual(expect.arrayContaining([expect.objectContaining({ taskId: "task-1", closed: true })]))
            expect(metadataUpdates).toEqual(expect.arrayContaining([expect.objectContaining({ taskId: "task-1", closed: false })]))
            expect(taskReads.every((read) => read.options?.hydrateSessionEvents === false)).toBe(true)
            const intervalCallsBeforeRunningNotification = setIntervalSpy.mock.calls.length
            routeServer.notify("runtime/updated", routeRuntimeRecord("running", "2026-05-31T00:03:00.000Z"))
            await vi.waitFor(() => expect(codeStore.tasks.getTaskModel("task-1")?.isWorking).toBe(true), { timeout: 1000, interval: 10 })
            await new Promise((resolve) => window.setTimeout(resolve, 50))
            const intervalCallsAfterRunningNotification = setIntervalSpy.mock.calls.slice(intervalCallsBeforeRunningNotification)
            expect(intervalCallsAfterRunningNotification.some(([, delay]) => delay === 20_000)).toBe(false)
            expect(taskGitSummaryReadCount).toBe(0)
            expect(trackSpy).not.toHaveBeenCalledWith("runtime_product_store_fallback", expect.anything())
        } finally {
            consoleErrorSpy.mockRestore()
            setIntervalSpy.mockRestore()
            setTimeoutSpy.mockRestore()
            trackSpy.mockRestore()
            codeStore.disconnectAllStores()
        }
    })

    it("runs the classic desktop workflow through runtime commands and reloads the runtime-backed state", async () => {
        const trackSpy = vi.spyOn(analytics, "track").mockImplementation(() => undefined)
        const startedTurns: OpenADETurnStartRequest[] = []
        let snapshotReadCount = 0
        const server = createRouteRuntimeServer({
            onReadSnapshot: () => {
                snapshotReadCount += 1
            },
            onStartTurn: (params) => startedTurns.push(params),
        })
        cleanupOpenADEApi = installOpenADEApiRuntimeBridge(server)
        const stores: CodeStore[] = []

        const createStore = async () => {
            const codeStore = createRouteCodeStore({
                enableRuntimeProductStore: true,
            })
            stores.push(codeStore)
            await codeStore.initializeRuntimeProductStore()
            codeStore.storeInitialized = true
            codeStore.tasks.ensureTasksLoaded("repo-1")
            return codeStore
        }

        const renderTaskRoute = (codeStore: CodeStore) => {
            const router = createElement(
                MemoryRouter,
                { initialEntries: ["/dashboard/code/workspace/repo-1/task/task-1"] },
                createElement(
                    Routes,
                    null,
                    createElement(Route, {
                        path: "/dashboard/code/workspace/:workspaceId/task/:taskId",
                        element: createElement(CodeWorkspaceTaskRoute),
                    })
                )
            )
            root.render(createElement(CodeStoreProvider, { store: codeStore }, router))
        }

        const runRichCommand = async (codeStore: CodeStore, titlePrefix: string, value?: string) => {
            if (value !== undefined) codeStore.smartEditors.getManager("task-task-1", "repo-1").setValue(value)
            let button: HTMLButtonElement | null = null
            await vi.waitFor(
                () => {
                    button = findButtonByTitlePrefix(container, titlePrefix)
                    expect(button.disabled).toBe(false)
                },
                { timeout: 1000, interval: 10 }
            )
            if (!button) throw new Error(`Button titled with "${titlePrefix}" was not rendered`)
            clickElement(button)
        }

        try {
            const codeStore = await createStore()
            renderTaskRoute(codeStore)
            await new Promise((resolve) => window.setTimeout(resolve, 50))
            await waitForText(container, "Runtime route task")
            expect(container.querySelector('[data-openade-surface="desktop-classic-task"]')).toBeInstanceOf(HTMLElement)
            expect(container.querySelector('[data-openade-surface="desktop-shared-task"]')).toBeNull()

            await runRichCommand(codeStore, "Plan", "Classic workflow plan")
            await waitForText(container, "Classic workflow plan")
            await vi.waitFor(
                () => {
                    expect(codeStore.runtimeProductSnapshot?.repos.map((repo) => repo.id)).toEqual(["repo-1"])
                    expect(codeStore.getRuntimeProductProject("repo-1")).toBeDefined()
                    expect(codeStore.tasks.getTask("task-1")?.events.map((event) => (event.type === "action" ? event.source.type : event.type))).toContain("plan")
                    expect(findButtonByTitlePrefix(container, "Run Plan").disabled).toBe(false)
                },
                { timeout: 3000, interval: 10 }
            )

            await runRichCommand(codeStore, "Revise Plan", "Classic workflow revision")
            await waitForText(container, "Classic workflow revision")

            await runRichCommand(codeStore, "Run Plan")
            await vi.waitFor(() => expect(startedTurns.map((turn) => turn.type)).toContain("run_plan"), { timeout: 1000, interval: 10 })

            await runRichCommand(codeStore, "Ask", "Classic workflow question")
            await waitForText(container, "Classic workflow question")

            clickElement(findButtonByText(container, "Close"))
            await waitForText(container, "Reopen")
            clickElement(findButtonByText(container, "Reopen"))
            await vi.waitFor(() => expect(findButtonByText(container, "Close")).toBeInstanceOf(HTMLButtonElement), { timeout: 1000, interval: 10 })

            expect(startedTurns.map((turn) => turn.type)).toEqual(["plan", "revise", "run_plan", "ask"])

            root.unmount()
            root = createRoot(container)
            codeStore.disconnectAllStores()

            const reloadedStore = await createStore()
            renderTaskRoute(reloadedStore)
            await waitForText(container, "Classic workflow plan")
            await waitForText(container, "Classic workflow revision")
            await waitForText(container, "Classic workflow question")
            expect(reloadedStore.tasks.getTask("task-1")?.closed).toBe(false)
            expect(snapshotReadCount).toBeLessThanOrEqual(3)
            expect(trackSpy).not.toHaveBeenCalledWith("runtime_product_store_fallback", expect.anything())
            expect(trackSpy).not.toHaveBeenCalledWith("runtime_product_store_error", expect.anything())
        } finally {
            trackSpy.mockRestore()
            for (const store of stores) store.disconnectAllStores()
        }
    })
})
