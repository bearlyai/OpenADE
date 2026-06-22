import { act, createElement } from "react"
import { type Root, createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { OpenADEClient } from "../../../openade-client/src"
import {
    createOpenADEModule,
    publishOpenADECompanionEvent,
    type OpenADEModuleAdapters,
    type OpenADEScopedHostAdapter,
} from "../../../openade-module/src/module"
import type {
    OpenADECommentCreateRequest,
    OpenADECommentDeleteRequest,
    OpenADECommentEditRequest,
    OpenADECronInstallState,
    OpenADECronRunRequest,
    OpenADEMCPServer,
    OpenADEMCPServersReadResult,
    OpenADEPersonalSettings,
    OpenADEProject,
    OpenADEProjectProcessInstance,
    OpenADEQueuedTurn,
    OpenADEReviewStartRequest,
    OpenADESnapshot,
    OpenADETask,
    OpenADETaskDeleteRequest,
    OpenADETaskImageWriteRequest,
    OpenADETaskMetadataUpdateRequest,
    OpenADETaskPreview,
    OpenADETaskReadRequest,
    OpenADETurnStartRequest,
} from "../../../openade-module/src/types"
import { type RuntimeClientOptions, RuntimeLocalClient, type RuntimeLocalTransport } from "../../../runtime-client/src"
import type { RuntimeMessage, RuntimeRecord, RuntimeRequest } from "../../../runtime-protocol/src"
import type { RuntimeConnection } from "../../../runtime/src"
import { RuntimeServer } from "../../../runtime/src"
import { DEFAULT_HARNESS_ID, getDefaultModelForHarness } from "../constants"
import { type KernelRuntimeClientLike, runtimeSocketUrl } from "../kernel/session"
import { getVisibleModelId } from "../modelVisibility"
import { ACTION_PROMPTS } from "../prompts/actionPrompts"
import { REMOTE_THEME_STORAGE_KEY, RemoteApp } from "./RemoteApp"
import { REMOTE_CONFIG_STORAGE_KEY, __setRemoteClientConstructorsForTest, loadRemoteConfig, loadRemoteConfigs } from "./client"

const now = "2026-05-31T00:00:00.000Z"

let restoreClientConstructors: (() => void) | undefined

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isMcpServersReadResult(value: unknown): value is OpenADEMCPServersReadResult {
    return isRecord(value) && Array.isArray(value.servers)
}

function openADETaskReadRequestFromRuntimeParams(params: unknown): OpenADETaskReadRequest | null {
    if (!isRecord(params)) return null
    const { repoId, taskId, hydrateSessionEvents, eventLimit } = params
    if (typeof repoId !== "string" || typeof taskId !== "string") return null
    if (hydrateSessionEvents !== undefined && typeof hydrateSessionEvents !== "boolean") return null
    if (eventLimit !== undefined && (typeof eventLimit !== "number" || !Number.isInteger(eventLimit))) return null
    return {
        repoId,
        taskId,
        ...(hydrateSessionEvents !== undefined ? { hydrateSessionEvents } : {}),
        ...(eventLimit !== undefined ? { eventLimit } : {}),
    }
}

function createRuntimeLocalTransport(server: RuntimeServer, permissions?: string[]): RuntimeLocalTransport {
    const listeners = new Set<(message: RuntimeMessage) => void>()
    let dispose: (() => void) | null = null
    const connection: RuntimeConnection = {
        id: `remote-app-test-${Math.random().toString(36).slice(2)}`,
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
        onMessage(listener: (message: RuntimeMessage) => void) {
            listeners.add(listener)
            return () => listeners.delete(listener)
        },
    }
    return transport
}

interface DeferredValue<T> {
    promise: Promise<T>
    resolve(value: T): void
    reject(error: unknown): void
}

function createDeferredValue<T>(): DeferredValue<T> {
    let resolveValue: (value: T) => void = () => {}
    let rejectValue: (reason?: unknown) => void = () => {}
    const promise = new Promise<T>((resolve, reject) => {
        resolveValue = resolve
        rejectValue = reject
    })
    return { promise, resolve: resolveValue, reject: rejectValue }
}

type RuntimeClientConstructor = new (options: RuntimeClientOptions) => KernelRuntimeClientLike

function createSnapshotRuntimeServer(
    snapshot: OpenADESnapshot,
    onSnapshotRead?: () => void,
    readSnapshot?: () => OpenADESnapshot | Promise<OpenADESnapshot>
): RuntimeServer {
    const server = new RuntimeServer({
        serverName: `${snapshot.server.hostName}-runtime`,
        protocolVersion: 1,
    })
    server.register("openade/snapshot/read", () => {
        onSnapshotRead?.()
        return readSnapshot ? readSnapshot() : snapshot
    })
    server.registerNotification("openade/snapshotChanged")
    return server
}

function createSnapshotRuntimeConstructors(
    sessions: Array<{
        baseUrl: string
        snapshot: OpenADESnapshot
        onSnapshotRead?: () => void
        readSnapshot?: () => OpenADESnapshot | Promise<OpenADESnapshot>
    }>
): {
    RuntimeClient: RuntimeClientConstructor
    OpenADEClient: typeof OpenADEClient
    publishSnapshotChanged(baseUrl: string): void
} {
    const servers = new Map<string, RuntimeServer>()
    for (const session of sessions) {
        servers.set(runtimeSocketUrl({ baseUrl: session.baseUrl }), createSnapshotRuntimeServer(session.snapshot, session.onSnapshotRead, session.readSnapshot))
    }

    class MultiSessionRuntimeClient extends RuntimeLocalClient {
        private readonly onStatus?: RuntimeClientOptions["onStatus"]
        private didReportConnected = false

        constructor(options: RuntimeClientOptions) {
            const server = servers.get(options.url)
            if (!server) throw new Error(`Missing test runtime server for ${options.url}`)
            super(createRuntimeLocalTransport(server), {
                clientName: options.clientName,
                clientVersion: options.clientVersion,
                clientPlatform: options.clientPlatform,
                protocolVersion: options.protocolVersion,
            })
            this.onStatus = options.onStatus
        }

        override async connect(): Promise<void> {
            await super.connect()
            if (this.didReportConnected) return
            this.didReportConnected = true
            this.onStatus?.("connected")
        }

        override async close(): Promise<void> {
            this.didReportConnected = false
            await super.close()
            this.onStatus?.("disconnected")
        }
    }

    return {
        RuntimeClient: MultiSessionRuntimeClient,
        OpenADEClient,
        publishSnapshotChanged(baseUrl: string) {
            const server = servers.get(runtimeSocketUrl({ baseUrl }))
            if (!server) throw new Error(`Missing test runtime server for ${baseUrl}`)
            server.notify("openade/snapshotChanged")
        },
    }
}

function createRuntimeBackedConstructors(
    state: {
        taskDeleted: boolean
        processRunning: boolean
        selfRevoked: boolean
        repoPathInspectRuntimeRequests: number
        repoCreateRuntimeRequests: number
        repoUpdateRuntimeRequests: number
        repoDeleteRuntimeRequests: number
        mcpServersReadRuntimeRequests: number
        mcpServersUpsertRuntimeRequests: number
        mcpServersDeleteRuntimeRequests: number
        lastMcpServersReadResult: OpenADEMCPServersReadResult | null
        lastMcpServerUpsert: OpenADEMCPServer | null
        personalSettingsReadRuntimeRequests: number
        personalSettingsReplaceRuntimeRequests: number
        taskCreateRuntimeRequests: number
        queuedTurnEnqueueRuntimeRequests: number
        turnStartRuntimeRequests: number
        turnInterruptRuntimeRequests: number
        turnStarts: OpenADETurnStartRequest[]
        reviewStarts: OpenADEReviewStartRequest[]
        workingTaskIds: string[]
        snapshotReads: number
        taskReads: number
        runtimeListRuntimeReads: number
        snapshotRuntimeReads: number
        projectListRuntimeReads: number
        taskListRuntimeReads: number
        taskRuntimeReads: number
        taskReadRequests: OpenADETaskReadRequest[]
        projectGitInfoRuntimeReads: number
        projectGitBranchesRuntimeReads: number
        projectGitSummaryRuntimeReads: number
        projectSdkCapabilitiesRuntimeReads: number
        projectCronDefinitionsRuntimeReads: number
        projectCronInstallStateRuntimeReads: number
        projectCronInstallStateReplaceRuntimeRequests: number
        projectCronRunRuntimeRequests: number
        cronRuns: OpenADECronRunRequest[]
        projectCronInstallations: Record<string, OpenADECronInstallState>
        projectFileTreeRuntimeReads: number
        projectFileFuzzySearchRuntimeReads: number
        projectFileContent: string
        projectFileWriteRuntimeRequests: number
        projectFileWriteContents: string[]
        processListRuntimeReads: number
        processStartRuntimeRequests: number
        processReconnectRuntimeRequests: number
        processStopRuntimeRequests: number
        taskChangesRuntimeReads: number
        taskGitLogRuntimeReads: number
        taskGitSummaryRuntimeReads: number
        taskGitScopesRuntimeReads: number
        taskFilePairRuntimeReads: number
        taskDiffRuntimeReads: number
        taskGitCommitFilesRuntimeReads: number
        taskGitCommitRuntimeRequests: number
        taskGitCommitMessages: string[]
        taskGitFileAtTreeishRuntimeReads: number
        taskGitCommitFilePatchRuntimeReads: number
        taskTerminalStartRuntimeRequests: number
        taskTerminalReconnectRuntimeRequests: number
        taskTerminalWriteRuntimeRequests: number
        taskTerminalResizeRuntimeRequests: number
        taskTerminalStopRuntimeRequests: number
        taskSnapshotPatchRuntimeReads: number
        taskSnapshotIndexRuntimeReads: number
        taskSnapshotPatchSliceRuntimeReads: number
        taskResourceInventoryRuntimeReads: number
        taskImageWriteRuntimeRequests: number
        taskImageWrites: OpenADETaskImageWriteRequest[]
        taskMetadataUpdateRuntimeRequests: number
        taskTitleGenerateRuntimeRequests: number
        taskEnvironmentPrepareRuntimeRequests: number
        task: OpenADETask
        personalSettings: OpenADEPersonalSettings
        queuedTurn: OpenADEQueuedTurn
    },
    runtimeOptions: {
        permissions?: string[]
        readTaskDelay?: Promise<void>
        readTaskError?: string
        createTaskDelay?: Promise<void>
        createTaskError?: string
        startTurnDelay?: Promise<void>
        interruptTurnDelay?: Promise<void>
        commitTaskGitDelay?: Promise<void>
        readTaskChangesDelay?: Promise<void>
        readTaskDiffDelay?: Promise<void>
        readTaskResourceInventoryDelay?: Promise<void>
        readProjectFileDelay?: Promise<void>
        createRepoDelay?: Promise<void>
        updateRepoDelay?: Promise<void>
        updateRepoError?: string
        replacePersonalSettingsDelay?: Promise<void>
        replacePersonalSettingsError?: string
        upsertMcpServerDelay?: Promise<void>
        upsertMcpServerError?: string
        writeTaskImageDelay?: Promise<void>
        updateTaskMetadataDelay?: Promise<void>
        updateTaskMetadataError?: string
        startProjectProcessDelay?: Promise<void>
    } = {}
): {
    RuntimeClient: RuntimeClientConstructor
    OpenADEClient: typeof OpenADEClient
    publishQueuedTurnUpdated(turn: OpenADEQueuedTurn): void
    publishTaskPreviewChanged(title: string): void
    publishTaskDeleted(): void
    publishRepoUpdated(name: string): void
    publishWorkingTasks(taskIds: string[]): void
} {
    const server = new RuntimeServer({
        serverName: "remote-app-test-runtime",
        protocolVersion: 1,
    })
    function previewForTask(task: OpenADETask): OpenADETaskPreview {
        return {
            id: task.id,
            slug: task.slug,
            title: task.title,
            createdAt: now,
            closed: task.closed,
        }
    }

    const preview = previewForTask(state.task)
    const project: OpenADEProject = {
        id: "repo-1",
        name: "Runtime Repo",
        path: "/tmp/openade-runtime-repo",
        tasks: [preview],
    }
    const projects: OpenADEProject[] = [project]
    let mcpServers: OpenADEMCPServer[] = [
        {
            id: "mcp-runtime",
            name: "Runtime MCP",
            transportType: "stdio",
            command: "echo",
            envVars: { RUNTIME_MCP_SECRET: "configured" },
            enabled: true,
            healthStatus: "healthy",
            createdAt: now,
            updatedAt: now,
        },
    ]

    function snapshot(options?: {
        version?: string
        hostName?: string
        workingTaskIds?: string[]
    }): OpenADESnapshot {
        const workingTaskIds = options?.workingTaskIds && options.workingTaskIds.length > 0 ? options.workingTaskIds : state.workingTaskIds
        return {
            server: {
                version: options?.version ?? "test",
                hostName: options?.hostName ?? "test-host",
                theme: {
                    setting: "system",
                    className: "code-theme-light",
                    label: "Light",
                },
            },
            repos: [...projects],
            workingTaskIds,
        }
    }

    function publishTaskChanged(
        options: {
            previewChanged?: boolean
            eventId?: string
            eventStatus?: "in_progress" | "completed" | "error" | "stopped"
            clientRequestId?: string
        } = {}
    ): void {
        publishOpenADECompanionEvent(server, {
            type: "task_changed",
            repoId: "repo-1",
            taskId: state.task.id,
            ...options,
            at: now,
        })
    }

    function publishQueuedTurnUpdated(turn: OpenADEQueuedTurn): void {
        state.queuedTurn = { ...turn }
        state.task.queuedTurns = [{ ...turn }]
        server.notify("openade/queuedTurn/updated", {
            repoId: "repo-1",
            taskId: state.task.id,
            turn,
        })
    }

    function publishTaskPreviewChanged(title: string): void {
        state.task.title = title
        preview.title = title
        project.tasks = [...project.tasks.filter((candidate) => candidate.id !== state.task.id), preview]
        publishTaskChanged({ previewChanged: true })
    }

    function publishTaskDeleted(): void {
        state.taskDeleted = true
        project.tasks = project.tasks.filter((candidate) => candidate.id !== state.task.id)
        publishOpenADECompanionEvent(server, {
            type: "task_deleted",
            repoId: project.id,
            taskId: state.task.id,
            at: now,
        })
    }

    function publishRepoUpdated(name: string): void {
        project.name = name
        server.notify("openade/repo/updated", {
            repoId: project.id,
        })
        server.notify("openade/snapshotChanged", {
            repoId: project.id,
        })
    }

    function publishWorkingTasks(taskIds: string[]): void {
        state.workingTaskIds = [...taskIds]
        server.notify("openade/workingTasks", {
            type: "working_tasks",
            taskIds,
            at: now,
        })
    }

    function readTaskDto(): OpenADETask {
        return {
            ...state.task,
            deviceEnvironments: [...state.task.deviceEnvironments],
            queuedTurns: state.task.queuedTurns?.map((turn) => ({ ...turn })),
            events: [...state.task.events],
            comments: [...state.task.comments],
        }
    }

    function processInstance(): OpenADEProjectProcessInstance {
        return {
            processId: "proc-test",
            definitionId: "openade.toml::Phone Echo",
            repoId: "repo-1",
            cwd: "/tmp/openade-runtime-repo",
            completed: false,
            exitCode: null,
            signal: null,
            pid: 123,
        }
    }

    const scopedHost: OpenADEScopedHostAdapter = {
        listProjectFiles: async (params) => ({
            repoId: params.repoId,
            path: params.path ?? "",
            entries: [
                {
                    path: "README.md",
                    name: "README.md",
                    type: "file",
                    size: state.projectFileContent.length,
                },
                { path: "src", name: "src", type: "directory" },
            ],
            truncated: false,
        }),
        readProjectFile: async (params) => {
            await runtimeOptions.readProjectFileDelay
            return {
                repoId: params.repoId,
                path: params.path,
                encoding: params.encoding ?? "utf8",
                size: state.projectFileContent.length,
                tooLarge: false,
                content: params.path === "README.md" ? state.projectFileContent : "",
            }
        },
        writeProjectFile: async (params) => {
            state.projectFileContent = params.content
            state.projectFileWriteContents.push(params.content)
            return {
                repoId: params.repoId,
                path: params.path,
                size: params.content.length,
            }
        },
        inspectRepoPath: async (params) => ({
            path: params.path,
            resolvedPath: params.path,
            exists: params.path !== "/tmp/missing-runtime-project",
            isDirectory: params.path !== "/tmp/file-runtime-project",
            isGitRepo: true,
            repoRoot: params.path,
            relativePath: "",
            mainBranch: "main",
            hasGhCli: false,
        }),
        fuzzySearchProjectFiles: async (params) => ({
            repoId: params.repoId,
            taskId: params.taskId,
            results: params.query === "remote" ? ["README.md"] : [],
            truncated: false,
            source: "filesystem",
        }),
        searchProject: async (params) => ({
            repoId: params.repoId,
            matches:
                params.query === "remote"
                    ? [
                          {
                              path: "README.md",
                              line: 1,
                              content: "remote project file search hit",
                              matchStart: 0,
                              matchEnd: 6,
                          },
                      ]
                    : [],
            truncated: false,
        }),
        readProjectSdkCapabilities: async () => ({
            slash_commands: ["/review"],
            skills: ["test-skill"],
            plugins: [],
            cachedAt: Date.now(),
        }),
        readProjectGitInfo: async (params) => ({
            repoId: params.repoId,
            isGitRepo: true,
            repoRoot: "/tmp/openade-runtime-repo",
            relativePath: "",
            mainBranch: "main",
            hasGhCli: false,
        }),
        readProjectGitBranches: async (params) => ({
            repoId: params.repoId,
            defaultBranch: "main",
            branches: [
                { name: "main", isDefault: true, isRemote: false },
                { name: "feature/shared-shell", isDefault: false, isRemote: false },
            ],
        }),
        readProjectGitSummary: async (params) => ({
            repoId: params.repoId,
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
        }),
        listProjectProcesses: async (params) => ({
            repoId: params.repoId,
            taskId: params.taskId,
            searchRoot: "/tmp/openade-runtime-repo",
            repoRoot: "/tmp/openade-runtime-repo",
            isWorktree: false,
            configs: [
                {
                    relativePath: "openade.toml",
                    processes: [
                        {
                            id: "openade.toml::Phone Echo",
                            name: "Phone Echo",
                            command: "printf phone",
                            type: "task",
                        },
                    ],
                    crons: [
                        {
                            id: "openade.toml::Nightly",
                            name: "Nightly",
                            schedule: "0 1 * * *",
                            type: "do",
                            prompt: "Run nightly checks",
                            harness: "codex",
                            isolation: "head",
                        },
                    ],
                },
            ],
            processes: [
                {
                    id: "openade.toml::Phone Echo",
                    name: "Phone Echo",
                    command: "printf phone",
                    type: "task",
                    configPath: "openade.toml",
                    cwd: "/tmp/openade-runtime-repo",
                },
            ],
            errors: [],
            instances: state.processRunning ? [processInstance()] : [],
        }),
        startProjectProcess: async (params) => {
            await runtimeOptions.startProjectProcessDelay
            state.processRunning = true
            return {
                repoId: params.repoId,
                taskId: params.taskId,
                definitionId: params.definitionId,
                processId: "proc-test",
            }
        },
        reconnectProjectProcess: async (params) => ({
            repoId: params.repoId,
            taskId: params.taskId,
            processId: params.processId,
            found: state.processRunning,
            completed: false,
            output: state.processRunning ? [{ type: "stdout", data: "phone process output\n", timestamp: 1 }] : [],
        }),
        stopProjectProcess: async (params) => {
            state.processRunning = false
            return {
                repoId: params.repoId,
                taskId: params.taskId,
                processId: params.processId,
                ok: true,
            }
        },
        startTaskTerminal: async (params) => ({
            repoId: params.repoId,
            taskId: params.taskId,
            terminalId: "terminal-test",
            ok: true,
        }),
        reconnectTaskTerminal: async (params) => ({
            repoId: params.repoId,
            taskId: params.taskId,
            terminalId: params.terminalId ?? "terminal-test",
            found: false,
            output: [],
        }),
        writeTaskTerminal: async (params) => ({
            repoId: params.repoId,
            taskId: params.taskId,
            terminalId: params.terminalId,
            ok: true,
        }),
        resizeTaskTerminal: async (params) => ({
            repoId: params.repoId,
            taskId: params.taskId,
            terminalId: params.terminalId,
            ok: true,
        }),
        stopTaskTerminal: async (params) => ({
            repoId: params.repoId,
            taskId: params.taskId,
            terminalId: params.terminalId,
            ok: true,
        }),
        readTaskGitSummary: async (params) => ({
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
                files: [{ path: "src/app.ts", status: "modified" }],
                stats: { filesChanged: 1, insertions: 1, deletions: 0 },
            },
            untracked: [],
        }),
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
        readTaskResourceInventory: async (params) => {
            await runtimeOptions.readTaskResourceInventoryDelay
            return {
                repoId: params.repoId,
                taskId: params.taskId,
                taskTitle: params.task.title,
                isRunning: params.isRunning,
                snapshotIds: ["snapshot-patch-1"],
                images: [{ id: "image-1", ext: "png" }],
                sessions: [{ sessionId: "session-1", harnessId: DEFAULT_HARNESS_ID }],
                worktree: {
                    slug: params.task.slug,
                    branchName: `openade/${params.task.slug}`,
                    sourceBranch: "main",
                    branchMerged: false,
                },
            }
        },
        generateTaskTitle: async (params) => {
            const title = "Remote generated title"
            state.task.title = title
            preview.title = title
            publishTaskChanged({ clientRequestId: params.clientRequestId })
            return {
                repoId: params.repoId,
                taskId: params.taskId,
                title,
            }
        },
        prepareTaskEnvironment: async (params) => {
            const deviceEnvironment = {
                id: "runtime-device",
                deviceId: "runtime-device",
                worktreeDir: "/tmp/remote-repo",
                setupComplete: true,
                createdAt: now,
                lastUsedAt: now,
            }
            const setupEvent = {
                taskId: params.taskId,
                eventId: "setup-runtime-device",
                worktreeId: "runtime-worktree",
                deviceId: "runtime-device",
                workingDir: "/tmp/remote-repo",
                createdAt: now,
                completedAt: now,
            }
            state.task.deviceEnvironments = [
                ...state.task.deviceEnvironments.filter((environment) => environment.id !== deviceEnvironment.id),
                deviceEnvironment,
            ]
            state.task.events = [
                ...state.task.events,
                {
                    id: setupEvent.eventId,
                    type: "setup_environment",
                    status: "completed",
                    ...setupEvent,
                },
            ]
            publishTaskChanged({ clientRequestId: params.clientRequestId })
            return {
                repoId: params.repoId,
                taskId: params.taskId,
                deviceEnvironment,
                setupEvent,
                cwd: "/tmp/remote-repo",
                rootPath: "/tmp/remote-repo",
            }
        },
        readTaskChanges: async (params) => {
            await runtimeOptions.readTaskChangesDelay
            return {
                repoId: params.repoId,
                taskId: params.taskId,
                files: [{ path: "src/app.ts", status: "modified" }],
                fromTreeish: "HEAD",
                toTreeish: "",
            }
        },
        readTaskDiff: async (params) => {
            await runtimeOptions.readTaskDiffDelay
            return {
                repoId: params.repoId,
                taskId: params.taskId,
                filePath: params.filePath,
                oldPath: params.oldPath,
                fromTreeish: "HEAD",
                toTreeish: "",
                patch: "diff --git a/src/app.ts b/src/app.ts\n+remote task changes\n",
                truncated: false,
                heavy: false,
                stats: { insertions: 1, deletions: 0, changedLines: 1, hunkCount: 1 },
            }
        },
        readTaskFilePair: async (params) => ({
            repoId: params.repoId,
            taskId: params.taskId,
            filePath: params.filePath,
            oldPath: params.oldPath,
            fromTreeish: "HEAD",
            toTreeish: "",
            before: "before\n",
            after: "after\n",
        }),
        readTaskGitLog: async (params) => ({
            repoId: params.repoId,
            taskId: params.taskId,
            commits: [
                {
                    sha: "0123456789abcdef",
                    shortSha: "0123456",
                    message: "Initial remote commit",
                    author: "OpenADE",
                    date: now,
                    relativeDate: "today",
                    parentCount: 1,
                },
            ],
            hasMore: false,
        }),
        readTaskGitCommitFiles: async (params) => ({
            repoId: params.repoId,
            taskId: params.taskId,
            commit: params.commit,
            files: [{ path: "src/app.ts", status: "modified" }],
        }),
        readTaskGitFileAtTreeish: async (params) => ({
            repoId: params.repoId,
            taskId: params.taskId,
            treeish: params.treeish,
            filePath: params.filePath,
            content: "remote task file\n",
            exists: true,
        }),
        readTaskGitCommitFilePatch: async (params) => ({
            repoId: params.repoId,
            taskId: params.taskId,
            commit: params.commit,
            filePath: params.filePath,
            oldPath: params.oldPath,
            patch: "diff --git a/src/app.ts b/src/app.ts\n+remote task changes\n",
            truncated: false,
            heavy: false,
            stats: { insertions: 1, deletions: 0, changedLines: 1, hunkCount: 1 },
        }),
        commitTaskGit: async (params) => {
            await runtimeOptions.commitTaskGitDelay
            state.taskGitCommitMessages.push(params.message)
            return {
                repoId: params.repoId,
                taskId: params.taskId,
                committed: true,
                status: "committed",
                sha: "fedcba9876543210",
            }
        },
        readTaskImage: async (params) => ({
            repoId: params.repoId,
            taskId: params.taskId,
            imageId: params.imageId,
            ext: params.ext,
            mediaType: params.image.mediaType,
            data: btoa("remote image"),
        }),
        readTaskSnapshotPatch: async (params) => ({
            repoId: params.repoId,
            taskId: params.taskId,
            eventId: params.eventId,
            patchFileId: "snapshot-patch-1",
            patch: "diff --git a/snapshot.txt b/snapshot.txt\n+snapshot patch content\n",
        }),
        readTaskSnapshotIndex: async (params) => {
            const patch = "diff --git a/snapshot.txt b/snapshot.txt\n+snapshot patch content\n"
            return {
                repoId: params.repoId,
                taskId: params.taskId,
                eventId: params.eventId,
                patchFileId: "snapshot-patch-1",
                index: {
                    version: 1 as const,
                    patchSize: patch.length,
                    files: [
                        {
                            id: "snapshot.txt",
                            path: "snapshot.txt",
                            status: "modified" as const,
                            binary: false,
                            insertions: 1,
                            deletions: 0,
                            changedLines: 1,
                            hunkCount: 1,
                            patchStart: 0,
                            patchEnd: patch.length,
                        },
                    ],
                },
            }
        },
        readTaskSnapshotPatchSlice: async (params) => ({
            repoId: params.repoId,
            taskId: params.taskId,
            eventId: params.eventId,
            patchFileId: "snapshot-patch-1",
            patch: params.start === 0 ? "diff --git a/snapshot.txt b/snapshot.txt\n+snapshot patch content\n" : null,
        }),
    }

    const adapters: OpenADEModuleAdapters = {
        version: () => "test",
        readSnapshot: async (options) => {
            state.snapshotReads += 1
            return snapshot(options)
        },
        readProjects: async () => [...projects],
        readTaskList: async () => project.tasks,
        readTask: async () => {
            await runtimeOptions.readTaskDelay
            if (runtimeOptions.readTaskError) throw new Error(runtimeOptions.readTaskError)
            state.taskReads += 1
            return readTaskDto()
        },
        listDataDocuments: async () => [],
        readDataDocumentBase64: async () => null,
        saveDataDocumentBase64: async () => undefined,
        deleteDataDocument: async () => undefined,
        readMcpServers: async () => ({
            servers: mcpServers.map((server) => structuredClone(server)),
        }),
        readPersonalSettings: async () => ({
            settings: structuredClone(state.personalSettings),
        }),
        replacePersonalSettings: async (params) => {
            await runtimeOptions.replacePersonalSettingsDelay
            if (runtimeOptions.replacePersonalSettingsError) throw new Error(runtimeOptions.replacePersonalSettingsError)
            state.personalSettings = structuredClone(params.settings)
            return { settings: structuredClone(state.personalSettings) }
        },
        replaceMcpServers: async (params) => {
            mcpServers = params.servers.map((server) => structuredClone(server))
            return {
                servers: mcpServers.map((server) => structuredClone(server)),
                replacedServers: mcpServers.length,
            }
        },
        upsertMcpServer: async (params) => {
            await runtimeOptions.upsertMcpServerDelay
            if (runtimeOptions.upsertMcpServerError) throw new Error(runtimeOptions.upsertMcpServerError)
            const created = !mcpServers.some((server) => server.id === params.server.id)
            state.lastMcpServerUpsert = structuredClone(params.server)
            mcpServers = [...mcpServers.filter((server) => server.id !== params.server.id), structuredClone(params.server)]
            return {
                server: structuredClone(params.server),
                created,
            }
        },
        deleteMcpServer: async (params) => {
            const deleted = mcpServers.some((server) => server.id === params.serverId)
            mcpServers = mcpServers.filter((server) => server.id !== params.serverId)
            return { serverId: params.serverId, deleted }
        },
        scopedHost,
        readCronInstallState: async (params) => ({
            repoId: params.repoId,
            installations: structuredClone(state.projectCronInstallations),
        }),
        replaceCronInstallState: async (params) => {
            state.projectCronInstallations = structuredClone(params.installations)
            return {
                repoId: params.repoId,
                installations: structuredClone(state.projectCronInstallations),
                replacedInstallations: Object.keys(state.projectCronInstallations).length,
            }
        },
        runCron: async (params) => {
            state.cronRuns.push({ ...params })
            const installation: OpenADECronInstallState = {
                cronId: params.cronId,
                enabled: state.projectCronInstallations[params.cronId]?.enabled ?? false,
                installedAt: state.projectCronInstallations[params.cronId]?.installedAt ?? now,
                lastRunAt: now,
                lastTaskId: "task-cron-run",
            }
            state.projectCronInstallations = {
                ...state.projectCronInstallations,
                [params.cronId]: installation,
            }
            return {
                repoId: params.repoId,
                cronId: params.cronId,
                taskId: "task-cron-run",
                installation,
            }
        },
        createRepo: async (params) => {
            await runtimeOptions.createRepoDelay
            const repoId = params.repoId ?? "repo-created"
            const createdAt = params.createdAt ?? now
            const createdProject: OpenADEProject = {
                id: repoId,
                name: params.name,
                path: params.path,
                tasks: [],
            }
            const existingIndex = projects.findIndex((repo) => repo.id === repoId)
            if (existingIndex >= 0) {
                projects[existingIndex] = createdProject
            } else {
                projects.push(createdProject)
            }
            server.notify("openade/repo/updated", { repoId })
            server.notify("openade/snapshotChanged", { repoId })
            return { repoId, createdAt }
        },
        updateRepo: async (params) => {
            await runtimeOptions.updateRepoDelay
            if (runtimeOptions.updateRepoError) throw new Error(runtimeOptions.updateRepoError)
            const repo = projects.find((candidate) => candidate.id === params.repoId)
            if (!repo) return
            if (params.name !== undefined) repo.name = params.name
            if (params.path !== undefined) repo.path = params.path
            if (params.archived !== undefined) repo.archived = params.archived
            server.notify("openade/repo/updated", { repoId: params.repoId })
            server.notify("openade/snapshotChanged", { repoId: params.repoId })
        },
        deleteRepo: async (params) => {
            const index = projects.findIndex((candidate) => candidate.id === params.repoId)
            if (index >= 0) projects.splice(index, 1)
            server.notify("openade/repo/deleted", { repoId: params.repoId })
            server.notify("openade/snapshotChanged", { repoId: params.repoId })
        },
        createTask: async (params) => {
            await runtimeOptions.createTaskDelay
            if (runtimeOptions.createTaskError) throw new Error(runtimeOptions.createTaskError)
            const taskId = params.taskId ?? "task-created"
            const slug = params.slug ?? "task-created"
            const title = params.title ?? "Created task"
            const createdAt = params.createdAt ?? now
            state.task = {
                id: taskId,
                repoId: params.repoId,
                slug,
                title,
                description: params.input,
                isolationStrategy: params.isolationStrategy,
                enabledMcpServerIds: params.enabledMcpServerIds,
                createdBy: params.createdBy,
                createdAt,
                updatedAt: createdAt,
                deviceEnvironments: params.deviceEnvironment ? [params.deviceEnvironment] : [],
                queuedTurns: [],
                events: [],
                comments: [],
            }
            project.tasks = [...project.tasks.filter((candidate) => candidate.id !== taskId), previewForTask(state.task)]
            publishTaskChanged({
                previewChanged: true,
                clientRequestId: params.clientRequestId,
            })
            return {
                taskId,
                slug,
                title,
                createdAt,
            }
        },
        startTurn: async (params) => {
            await runtimeOptions.startTurnDelay
            state.turnStarts.push({ ...params })
            const eventId = "event-turn"
            const actionEvent = {
                id: eventId,
                type: "action" as const,
                status: "in_progress" as const,
                createdAt: now,
                userInput: params.input,
                source: { type: params.type, userLabel: params.label ?? params.type },
            }
            if (params.inTaskId) {
                state.task.events = [...state.task.events, actionEvent]
                publishTaskChanged({
                    previewChanged: false,
                    eventId,
                    eventStatus: "in_progress",
                })
                return {
                    taskId: state.task.id,
                    eventId,
                    executionId: "exec-turn",
                    createdAt: now,
                }
            }

            state.task = {
                id: "task-created",
                repoId: params.repoId,
                slug: "task-created",
                title: params.title ?? "Created task",
                description: params.input,
                isolationStrategy: { type: "head" },
                deviceEnvironments: [],
                queuedTurns: [],
                events: [actionEvent],
                comments: [],
            }
            publishTaskChanged({
                previewChanged: false,
                eventId,
                eventStatus: "in_progress",
            })
            return {
                taskId: state.task.id,
                eventId,
                executionId: "exec-turn",
                createdAt: now,
                task: readTaskDto(),
                preview: previewForTask(state.task),
            }
        },
        startReview: async (params) => {
            state.reviewStarts.push({ ...params })
            const eventId = "event-review"
            state.task.events = [
                ...state.task.events,
                {
                    id: eventId,
                    type: "action",
                    status: "in_progress",
                    createdAt: now,
                    userInput: params.customInstructions ?? "",
                    source: {
                        type: "review",
                        userLabel: "Review",
                        reviewType: params.reviewType,
                    },
                },
            ]
            publishTaskChanged({
                previewChanged: false,
                eventId,
                eventStatus: "in_progress",
            })
            return {
                taskId: params.taskId,
                eventId,
                executionId: "exec-review",
                createdAt: now,
            }
        },
        interruptTurn: async () => {
            await runtimeOptions.interruptTurnDelay
            state.workingTaskIds = state.workingTaskIds.filter((taskId) => taskId !== state.task.id)
        },
        enqueueQueuedTurn: async (params) => {
            const createdAt = params.createdAt ?? now
            const turn: OpenADEQueuedTurn = {
                id: params.queuedTurnId ?? `queued-${state.task.queuedTurns?.length ?? 0}`,
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
                hyperplanStrategy: params.hyperplanStrategy,
                thinking: params.thinking,
                fastMode: params.fastMode,
            }
            state.queuedTurn = turn
            state.task.queuedTurns = [...(state.task.queuedTurns ?? []).filter((candidate) => candidate.id !== turn.id), turn]
            publishTaskChanged({
                previewChanged: false,
                clientRequestId: params.clientRequestId,
            })
            server.notify("openade/queuedTurn/updated", {
                repoId: params.repoId,
                taskId: params.taskId,
                turn,
                at: now,
                clientRequestId: params.clientRequestId,
            })
            return {
                taskId: params.taskId,
                queuedTurnId: turn.id,
                queued: true,
                turn,
            }
        },
        reorderQueuedTurns: async (params) => {
            const turnsById = new Map((state.task.queuedTurns ?? []).map((turn) => [turn.id, turn]))
            const updatedAt = params.updatedAt ?? now
            const turns = params.queuedTurnIds.map((queuedTurnId) => {
                const turn = turnsById.get(queuedTurnId)
                if (!turn) throw new Error(`Queued turn ${queuedTurnId} not found`)
                return { ...turn, updatedAt }
            })
            const requestedIds = new Set(params.queuedTurnIds)
            state.task.queuedTurns = [...turns, ...(state.task.queuedTurns ?? []).filter((turn) => !requestedIds.has(turn.id))]
            state.queuedTurn = state.task.queuedTurns[0] ?? state.queuedTurn
            publishTaskChanged({
                previewChanged: false,
                clientRequestId: params.clientRequestId,
            })
            for (const turn of turns) {
                server.notify("openade/queuedTurn/updated", {
                    repoId: params.repoId,
                    taskId: params.taskId,
                    turn,
                    at: now,
                    clientRequestId: params.clientRequestId,
                })
            }
            return { taskId: params.taskId, reordered: true, turns }
        },
        cancelQueuedTurn: async (params) => {
            state.queuedTurn = {
                ...state.queuedTurn,
                status: "cancelled",
                updatedAt: now,
            }
            state.task.queuedTurns = [state.queuedTurn]
            publishTaskChanged({
                previewChanged: false,
                clientRequestId: params.clientRequestId,
            })
            return {
                taskId: params.taskId,
                queuedTurnId: params.queuedTurnId,
                cancelled: true,
            }
        },
        deleteTask: async (params: OpenADETaskDeleteRequest) => {
            state.taskDeleted = true
            project.tasks = project.tasks.filter((task) => task.id !== params.taskId)
            publishOpenADECompanionEvent(server, {
                type: "task_deleted",
                repoId: params.repoId,
                taskId: params.taskId,
                at: now,
            })
            return { repoId: params.repoId, taskId: params.taskId, deleted: true }
        },
        setupTaskEnvironment: async () => undefined,
        createActionEvent: async () => ({
            eventId: "event-created",
            createdAt: now,
        }),
        appendActionStreamEvent: async () => undefined,
        completeActionEvent: async () => undefined,
        errorActionEvent: async () => undefined,
        stoppedActionEvent: async () => undefined,
        reconcileActionEventRuntime: async (params) => ({
            taskId: params.taskId,
            changed: false,
        }),
        updateActionExecution: async () => undefined,
        addHyperPlanSubExecution: async () => undefined,
        appendHyperPlanSubExecutionStreamEvent: async () => undefined,
        updateHyperPlanSubExecution: async () => undefined,
        setHyperPlanReconcileLabels: async () => undefined,
        createSnapshotEvent: async () => ({
            eventId: "snapshot-created",
            createdAt: now,
        }),
        createComment: async (params: OpenADECommentCreateRequest) => {
            const commentId = params.commentId ?? "comment-1"
            state.task.comments = [
                ...state.task.comments,
                {
                    id: commentId,
                    content: params.content,
                    source: params.source,
                    selectedText: params.selectedText,
                    author: params.author,
                    createdAt: params.createdAt ?? now,
                },
            ]
            publishTaskChanged({
                previewChanged: false,
                clientRequestId: params.clientRequestId,
            })
            return { commentId, createdAt: params.createdAt ?? now }
        },
        editComment: async (params: OpenADECommentEditRequest) => {
            state.task.comments = state.task.comments.map((comment) => {
                const record = typeof comment === "object" && comment !== null && !Array.isArray(comment) ? (comment as Record<string, unknown>) : null
                return record?.id === params.commentId
                    ? {
                          ...record,
                          content: params.content,
                          updatedAt: params.updatedAt ?? now,
                      }
                    : comment
            })
            publishTaskChanged({
                previewChanged: false,
                clientRequestId: params.clientRequestId,
            })
        },
        deleteComment: async (params: OpenADECommentDeleteRequest) => {
            state.task.comments = state.task.comments.filter((comment) => {
                const record = typeof comment === "object" && comment !== null && !Array.isArray(comment) ? (comment as Record<string, unknown>) : null
                return record?.id !== params.commentId
            })
            publishTaskChanged({
                previewChanged: false,
                clientRequestId: params.clientRequestId,
            })
        },
        updateTaskMetadata: async (params: OpenADETaskMetadataUpdateRequest) => {
            await runtimeOptions.updateTaskMetadataDelay
            if (runtimeOptions.updateTaskMetadataError) throw new Error(runtimeOptions.updateTaskMetadataError)
            if (params.title) {
                state.task.title = params.title
                preview.title = params.title
            }
            if (params.closed !== undefined) {
                state.task.closed = params.closed
                preview.closed = params.closed
            }
            if (params.cancelledPlanEventId !== undefined) {
                state.task.cancelledPlanEventId = params.cancelledPlanEventId
            }
            if (params.enabledMcpServerIds !== undefined) {
                state.task.enabledMcpServerIds = [...params.enabledMcpServerIds]
            }
            publishTaskChanged({ clientRequestId: params.clientRequestId })
        },
        writeTaskImage: async (params) => {
            await runtimeOptions.writeTaskImageDelay
            state.taskImageWrites.push({ ...params })
            return {
                imageId: params.imageId,
                ext: params.ext,
                mediaType: params.mediaType,
                size: atob(params.data).length,
                sha256: "test-image-sha256",
            }
        },
    }
    server.registerModule(createOpenADEModule(adapters))
    state.workingTaskIds.forEach((taskId, index) => {
        server.supervisor.register(taskRuntimeRecord(taskId, index))
    })
    server.register("remote/device/selfRevoke", () => {
        state.selfRevoked = true
        return { ok: true, revoked: true }
    })

    class TestRuntimeClient extends RuntimeLocalClient {
        private readonly onStatus?: RuntimeClientOptions["onStatus"]
        private didReportConnected = false

        constructor(options: RuntimeClientOptions) {
            const transport = createRuntimeLocalTransport(server, runtimeOptions.permissions)
            const request = transport.request.bind(transport)
            transport.request = async (runtimeRequest) => {
                if (runtimeRequest.method === "openade/snapshot/read") state.snapshotRuntimeReads += 1
                if (runtimeRequest.method === "runtime/list") state.runtimeListRuntimeReads += 1
                if (runtimeRequest.method === "openade/project/list") state.projectListRuntimeReads += 1
                if (runtimeRequest.method === "openade/task/list") state.taskListRuntimeReads += 1
                if (runtimeRequest.method === "openade/task/read") {
                    state.taskRuntimeReads += 1
                    const taskReadRequest = openADETaskReadRequestFromRuntimeParams(runtimeRequest.params)
                    if (taskReadRequest) state.taskReadRequests.push(taskReadRequest)
                }
                if (runtimeRequest.method === "openade/repo/path/inspect") state.repoPathInspectRuntimeRequests += 1
                if (runtimeRequest.method === "openade/repo/create") state.repoCreateRuntimeRequests += 1
                if (runtimeRequest.method === "openade/repo/update") state.repoUpdateRuntimeRequests += 1
                if (runtimeRequest.method === "openade/repo/delete") state.repoDeleteRuntimeRequests += 1
                if (runtimeRequest.method === "openade/settings/mcpServers/read") state.mcpServersReadRuntimeRequests += 1
                if (runtimeRequest.method === "openade/settings/mcpServers/upsert") state.mcpServersUpsertRuntimeRequests += 1
                if (runtimeRequest.method === "openade/settings/mcpServers/delete") state.mcpServersDeleteRuntimeRequests += 1
                if (runtimeRequest.method === "openade/settings/personal/read") state.personalSettingsReadRuntimeRequests += 1
                if (runtimeRequest.method === "openade/settings/personal/replace") state.personalSettingsReplaceRuntimeRequests += 1
                if (runtimeRequest.method === "openade/task/create") state.taskCreateRuntimeRequests += 1
                if (runtimeRequest.method === "openade/queued-turn/enqueue") state.queuedTurnEnqueueRuntimeRequests += 1
                if (runtimeRequest.method === "openade/turn/start") state.turnStartRuntimeRequests += 1
                if (runtimeRequest.method === "openade/turn/interrupt") state.turnInterruptRuntimeRequests += 1
                if (runtimeRequest.method === "openade/project/git/info/read") state.projectGitInfoRuntimeReads += 1
                if (runtimeRequest.method === "openade/project/git/branches/read") state.projectGitBranchesRuntimeReads += 1
                if (runtimeRequest.method === "openade/project/git/summary/read") state.projectGitSummaryRuntimeReads += 1
                if (runtimeRequest.method === "openade/project/sdkCapabilities/read") state.projectSdkCapabilitiesRuntimeReads += 1
                if (runtimeRequest.method === "openade/cron/definitions/read") state.projectCronDefinitionsRuntimeReads += 1
                if (runtimeRequest.method === "openade/cron/installState/read") state.projectCronInstallStateRuntimeReads += 1
                if (runtimeRequest.method === "openade/cron/installState/replace") state.projectCronInstallStateReplaceRuntimeRequests += 1
                if (runtimeRequest.method === "openade/cron/run") state.projectCronRunRuntimeRequests += 1
                if (runtimeRequest.method === "openade/project/files/tree") state.projectFileTreeRuntimeReads += 1
                if (runtimeRequest.method === "openade/project/files/fuzzySearch") state.projectFileFuzzySearchRuntimeReads += 1
                if (runtimeRequest.method === "openade/project/file/write") state.projectFileWriteRuntimeRequests += 1
                if (runtimeRequest.method === "openade/project/process/list") state.processListRuntimeReads += 1
                if (runtimeRequest.method === "openade/project/process/start") state.processStartRuntimeRequests += 1
                if (runtimeRequest.method === "openade/project/process/reconnect") state.processReconnectRuntimeRequests += 1
                if (runtimeRequest.method === "openade/project/process/stop") state.processStopRuntimeRequests += 1
                if (runtimeRequest.method === "openade/task/changes/read") state.taskChangesRuntimeReads += 1
                if (runtimeRequest.method === "openade/task/git/log") state.taskGitLogRuntimeReads += 1
                if (runtimeRequest.method === "openade/task/git/summary/read") state.taskGitSummaryRuntimeReads += 1
                if (runtimeRequest.method === "openade/task/git/scopes/read") state.taskGitScopesRuntimeReads += 1
                if (runtimeRequest.method === "openade/task/filePair/read") state.taskFilePairRuntimeReads += 1
                if (runtimeRequest.method === "openade/task/diff/read") state.taskDiffRuntimeReads += 1
                if (runtimeRequest.method === "openade/task/git/commit/files/read") state.taskGitCommitFilesRuntimeReads += 1
                if (runtimeRequest.method === "openade/task/git/commit") state.taskGitCommitRuntimeRequests += 1
                if (runtimeRequest.method === "openade/task/git/fileAtTreeish/read") state.taskGitFileAtTreeishRuntimeReads += 1
                if (runtimeRequest.method === "openade/task/git/commit/filePatch/read") state.taskGitCommitFilePatchRuntimeReads += 1
                if (runtimeRequest.method === "openade/task/terminal/start") state.taskTerminalStartRuntimeRequests += 1
                if (runtimeRequest.method === "openade/task/terminal/reconnect") state.taskTerminalReconnectRuntimeRequests += 1
                if (runtimeRequest.method === "openade/task/terminal/write") state.taskTerminalWriteRuntimeRequests += 1
                if (runtimeRequest.method === "openade/task/terminal/resize") state.taskTerminalResizeRuntimeRequests += 1
                if (runtimeRequest.method === "openade/task/terminal/stop") state.taskTerminalStopRuntimeRequests += 1
                if (runtimeRequest.method === "openade/task/snapshot/patch/read") state.taskSnapshotPatchRuntimeReads += 1
                if (runtimeRequest.method === "openade/task/snapshot/index/read") state.taskSnapshotIndexRuntimeReads += 1
                if (runtimeRequest.method === "openade/task/snapshot/patch/readSlice") state.taskSnapshotPatchSliceRuntimeReads += 1
                if (runtimeRequest.method === "openade/task/resourceInventory/read") state.taskResourceInventoryRuntimeReads += 1
                if (runtimeRequest.method === "openade/task/image/write") state.taskImageWriteRuntimeRequests += 1
                if (runtimeRequest.method === "openade/task/metadata/update") state.taskMetadataUpdateRuntimeRequests += 1
                if (runtimeRequest.method === "openade/task/title/generate") state.taskTitleGenerateRuntimeRequests += 1
                if (runtimeRequest.method === "openade/task/environment/prepare") state.taskEnvironmentPrepareRuntimeRequests += 1
                const response = await request(runtimeRequest)
                if (runtimeRequest.method === "openade/settings/mcpServers/read" && isRecord(response) && isMcpServersReadResult(response.result)) {
                    state.lastMcpServersReadResult = response.result
                }
                return response
            }
            super(transport, {
                clientName: options.clientName,
                clientVersion: options.clientVersion,
                clientPlatform: options.clientPlatform,
                protocolVersion: options.protocolVersion,
            })
            this.onStatus = options.onStatus
        }

        override async connect(): Promise<void> {
            await super.connect()
            if (this.didReportConnected) return
            this.didReportConnected = true
            this.onStatus?.("connected")
        }

        override async close(): Promise<void> {
            this.didReportConnected = false
            await super.close()
            this.onStatus?.("disconnected")
        }
    }

    return {
        RuntimeClient: TestRuntimeClient,
        OpenADEClient,
        publishQueuedTurnUpdated,
        publishTaskPreviewChanged,
        publishTaskDeleted,
        publishRepoUpdated,
        publishWorkingTasks,
    }
}

function seededTask(): {
    taskDeleted: boolean
    processRunning: boolean
    selfRevoked: boolean
    repoPathInspectRuntimeRequests: number
    repoCreateRuntimeRequests: number
    repoUpdateRuntimeRequests: number
    repoDeleteRuntimeRequests: number
    mcpServersReadRuntimeRequests: number
    mcpServersUpsertRuntimeRequests: number
    mcpServersDeleteRuntimeRequests: number
    lastMcpServersReadResult: OpenADEMCPServersReadResult | null
    lastMcpServerUpsert: OpenADEMCPServer | null
    personalSettingsReadRuntimeRequests: number
    personalSettingsReplaceRuntimeRequests: number
    taskCreateRuntimeRequests: number
    queuedTurnEnqueueRuntimeRequests: number
    turnStartRuntimeRequests: number
    turnInterruptRuntimeRequests: number
    turnStarts: OpenADETurnStartRequest[]
    reviewStarts: OpenADEReviewStartRequest[]
    workingTaskIds: string[]
    snapshotReads: number
    taskReads: number
    runtimeListRuntimeReads: number
    snapshotRuntimeReads: number
    projectListRuntimeReads: number
    taskListRuntimeReads: number
    taskRuntimeReads: number
    taskReadRequests: OpenADETaskReadRequest[]
    projectGitInfoRuntimeReads: number
    projectGitBranchesRuntimeReads: number
    projectGitSummaryRuntimeReads: number
    projectSdkCapabilitiesRuntimeReads: number
    projectCronDefinitionsRuntimeReads: number
    projectCronInstallStateRuntimeReads: number
    projectCronInstallStateReplaceRuntimeRequests: number
    projectCronRunRuntimeRequests: number
    cronRuns: OpenADECronRunRequest[]
    projectCronInstallations: Record<string, OpenADECronInstallState>
    projectFileTreeRuntimeReads: number
    projectFileFuzzySearchRuntimeReads: number
    projectFileContent: string
    projectFileWriteRuntimeRequests: number
    projectFileWriteContents: string[]
    processListRuntimeReads: number
    processStartRuntimeRequests: number
    processReconnectRuntimeRequests: number
    processStopRuntimeRequests: number
    taskChangesRuntimeReads: number
    taskGitLogRuntimeReads: number
    taskGitSummaryRuntimeReads: number
    taskGitScopesRuntimeReads: number
    taskFilePairRuntimeReads: number
    taskDiffRuntimeReads: number
    taskGitCommitFilesRuntimeReads: number
    taskGitCommitRuntimeRequests: number
    taskGitCommitMessages: string[]
    taskGitFileAtTreeishRuntimeReads: number
    taskGitCommitFilePatchRuntimeReads: number
    taskTerminalStartRuntimeRequests: number
    taskTerminalReconnectRuntimeRequests: number
    taskTerminalWriteRuntimeRequests: number
    taskTerminalResizeRuntimeRequests: number
    taskTerminalStopRuntimeRequests: number
    taskSnapshotPatchRuntimeReads: number
    taskSnapshotIndexRuntimeReads: number
    taskSnapshotPatchSliceRuntimeReads: number
    taskResourceInventoryRuntimeReads: number
    taskImageWriteRuntimeRequests: number
    taskImageWrites: OpenADETaskImageWriteRequest[]
    taskMetadataUpdateRuntimeRequests: number
    taskTitleGenerateRuntimeRequests: number
    taskEnvironmentPrepareRuntimeRequests: number
    task: OpenADETask
    personalSettings: OpenADEPersonalSettings
    queuedTurn: OpenADEQueuedTurn
} {
    const queuedTurn: OpenADEQueuedTurn = {
        id: "queued-1",
        type: "do",
        input: "Run this after the current turn",
        status: "queued",
        createdAt: now,
        updatedAt: now,
    }
    const secondQueuedTurn: OpenADEQueuedTurn = {
        id: "queued-2",
        type: "ask",
        input: "Ask this after the next turn",
        status: "queued",
        createdAt: now,
        updatedAt: now,
    }
    return {
        taskDeleted: false,
        processRunning: false,
        selfRevoked: false,
        repoPathInspectRuntimeRequests: 0,
        repoCreateRuntimeRequests: 0,
        repoUpdateRuntimeRequests: 0,
        repoDeleteRuntimeRequests: 0,
        mcpServersReadRuntimeRequests: 0,
        mcpServersUpsertRuntimeRequests: 0,
        mcpServersDeleteRuntimeRequests: 0,
        lastMcpServersReadResult: null,
        lastMcpServerUpsert: null,
        personalSettingsReadRuntimeRequests: 0,
        personalSettingsReplaceRuntimeRequests: 0,
        taskCreateRuntimeRequests: 0,
        queuedTurnEnqueueRuntimeRequests: 0,
        turnStartRuntimeRequests: 0,
        turnInterruptRuntimeRequests: 0,
        turnStarts: [],
        reviewStarts: [],
        workingTaskIds: [],
        snapshotReads: 0,
        taskReads: 0,
        runtimeListRuntimeReads: 0,
        snapshotRuntimeReads: 0,
        projectListRuntimeReads: 0,
        taskListRuntimeReads: 0,
        taskRuntimeReads: 0,
        taskReadRequests: [],
        projectGitInfoRuntimeReads: 0,
        projectGitBranchesRuntimeReads: 0,
        projectGitSummaryRuntimeReads: 0,
        projectSdkCapabilitiesRuntimeReads: 0,
        projectCronDefinitionsRuntimeReads: 0,
        projectCronInstallStateRuntimeReads: 0,
        projectCronInstallStateReplaceRuntimeRequests: 0,
        projectCronRunRuntimeRequests: 0,
        cronRuns: [],
        projectCronInstallations: {
            "openade.toml::Nightly": {
                cronId: "openade.toml::Nightly",
                enabled: true,
                installedAt: "2026-05-31T00:00:00.000Z",
                lastTaskId: "task-1",
            },
        },
        projectFileTreeRuntimeReads: 0,
        projectFileFuzzySearchRuntimeReads: 0,
        projectFileContent: "remote project file",
        projectFileWriteRuntimeRequests: 0,
        projectFileWriteContents: [],
        processListRuntimeReads: 0,
        processStartRuntimeRequests: 0,
        processReconnectRuntimeRequests: 0,
        processStopRuntimeRequests: 0,
        taskChangesRuntimeReads: 0,
        taskGitLogRuntimeReads: 0,
        taskGitSummaryRuntimeReads: 0,
        taskGitScopesRuntimeReads: 0,
        taskFilePairRuntimeReads: 0,
        taskDiffRuntimeReads: 0,
        taskGitCommitFilesRuntimeReads: 0,
        taskGitCommitRuntimeRequests: 0,
        taskGitCommitMessages: [],
        taskGitFileAtTreeishRuntimeReads: 0,
        taskGitCommitFilePatchRuntimeReads: 0,
        taskTerminalStartRuntimeRequests: 0,
        taskTerminalReconnectRuntimeRequests: 0,
        taskTerminalWriteRuntimeRequests: 0,
        taskTerminalResizeRuntimeRequests: 0,
        taskTerminalStopRuntimeRequests: 0,
        taskSnapshotPatchRuntimeReads: 0,
        taskSnapshotIndexRuntimeReads: 0,
        taskSnapshotPatchSliceRuntimeReads: 0,
        taskResourceInventoryRuntimeReads: 0,
        taskImageWriteRuntimeRequests: 0,
        taskImageWrites: [],
        taskMetadataUpdateRuntimeRequests: 0,
        taskTitleGenerateRuntimeRequests: 0,
        taskEnvironmentPrepareRuntimeRequests: 0,
        queuedTurn,
        personalSettings: {
            envVars: { OPENADE_ENV: "configured" },
            theme: "code-theme-clean",
            renderMarkdownMessages: false,
            telemetryDisabled: true,
            newTaskHarnessId: DEFAULT_HARNESS_ID,
            newTaskModelId: getDefaultModelForHarness(DEFAULT_HARNESS_ID),
            pinnedTaskIds: ["task-1"],
        },
        task: {
            id: "task-1",
            repoId: "repo-1",
            slug: "task-1",
            title: "Original task",
            description: "A task rendered by the shared remote shell.",
            isolationStrategy: { type: "head" },
            deviceEnvironments: [],
            queuedTurns: [queuedTurn, secondQueuedTurn],
            events: [
                {
                    id: "event-image",
                    type: "action",
                    status: "completed",
                    createdAt: now,
                    userInput: "Describe this image",
                    source: { type: "do", userLabel: "Do" },
                    images: [
                        {
                            id: "remote-image",
                            ext: "png",
                            mediaType: "image/png",
                            originalWidth: 1,
                            originalHeight: 1,
                            resizedWidth: 1,
                            resizedHeight: 1,
                        },
                    ],
                },
                {
                    id: "snapshot-1",
                    type: "snapshot",
                    status: "completed",
                    createdAt: now,
                    referenceBranch: "main",
                    stats: {
                        filesChanged: 1,
                        insertions: 1,
                        deletions: 0,
                    },
                },
            ],
            comments: [],
        },
    }
}

interface SavedRemoteSessionConfig {
    id: string
    baseUrl: string
    token: string
    host: string
    savedAt: string
    lastUsedAt: string
}

function saveRemoteSessions(activeId: string, configs: SavedRemoteSessionConfig[]): void {
    localStorage.setItem(
        REMOTE_CONFIG_STORAGE_KEY,
        JSON.stringify({
            version: 2,
            activeId,
            configs,
        })
    )
}

function saveRemoteSession(): void {
    saveRemoteSessions("session-1", [
        {
            id: "session-1",
            baseUrl: "http://100.64.1.10:7823",
            token: "token-1",
            host: "100.64.1.10:7823",
            savedAt: now,
            lastUsedAt: now,
        },
    ])
}

async function waitForElement<T extends Element>(find: () => T | null, label: string): Promise<T> {
    for (let attempt = 0; attempt < 80; attempt += 1) {
        const found = find()
        if (found) return found
        await act(async () => {
            await new Promise((resolve) => window.setTimeout(resolve, 25))
        })
    }
    throw new Error(`Timed out waiting for ${label}`)
}

async function drainAsyncReactWork(): Promise<void> {
    await Promise.resolve()
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    await Promise.resolve()
}

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement | null {
    return Array.from(container.querySelectorAll("button")).find((button): button is HTMLButtonElement => button.textContent?.includes(text) === true) ?? null
}

function lastButtonByExactText(container: HTMLElement, text: string): HTMLButtonElement | null {
    return (
        Array.from(container.querySelectorAll("button"))
            .filter((button): button is HTMLButtonElement => button.textContent?.trim() === text)
            .at(-1) ?? null
    )
}

function hasButtonExactText(container: HTMLElement, text: string): boolean {
    return Array.from(container.querySelectorAll("button")).some((button) => button.textContent?.trim() === text)
}

function buttonByTitle(container: HTMLElement, title: string): HTMLButtonElement | null {
    return Array.from(container.querySelectorAll("button")).find((button): button is HTMLButtonElement => button.title === title) ?? null
}

function buttonByLabel(container: HTMLElement, label: string): HTMLButtonElement | null {
    return Array.from(container.querySelectorAll("button")).find((button): button is HTMLButtonElement => button.getAttribute("aria-label") === label) ?? null
}

function summaryByText(container: HTMLElement, text: string): HTMLElement | null {
    return Array.from(container.querySelectorAll("summary")).find((summary): summary is HTMLElement => summary.textContent?.includes(text) === true) ?? null
}

function inputByValue(container: HTMLElement, value: string): HTMLInputElement | null {
    return Array.from(container.querySelectorAll("input")).find((input): input is HTMLInputElement => input.value === value) ?? null
}

function inputByPlaceholder(container: HTMLElement, value: string): HTMLInputElement | null {
    return Array.from(container.querySelectorAll("input")).find((input): input is HTMLInputElement => input.placeholder === value) ?? null
}

function taskInputElement(container: HTMLElement): HTMLElement | null {
    const textarea = container.querySelector('textarea[aria-label="Task input"]')
    if (textarea instanceof HTMLTextAreaElement) return textarea
    const editor = container.querySelector('[contenteditable="true"][aria-label="Task input"]')
    return editor instanceof HTMLElement ? editor : null
}

function taskInputValue(element: HTMLElement): string {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return element.value
    return element.textContent ?? ""
}

function sendButtonForTaskInput(input: HTMLElement): HTMLButtonElement | null {
    const button = input.closest("footer")?.querySelector('button[aria-label="Send task input"]')
    return button instanceof HTMLButtonElement ? button : null
}

async function click(element: HTMLElement): Promise<void> {
    await act(async () => {
        element.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
}

async function typeInto(element: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<void> {
    await act(async () => {
        const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value")
        descriptor?.set?.call(element, value)
        element.dispatchEvent(new Event("input", { bubbles: true }))
        element.dispatchEvent(new Event("change", { bubbles: true }))
    })
}

async function typeIntoTaskInput(element: HTMLElement, value: string): Promise<void> {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        await typeInto(element, value)
        return
    }

    await act(async () => {
        element.focus()
        document.execCommand("selectAll")
        document.execCommand("insertText", false, value)
        element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }))
        await Promise.resolve()
    })
}

function tinyPngFile(name = "remote-image.png"): File {
    const binary = atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lZZVhgAAAABJRU5ErkJggg==")
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
    return new File([bytes], name, { type: "image/png" })
}

async function attachImage(container: HTMLElement, file: File): Promise<void> {
    const input = container.querySelector("input[type='file']")
    if (!(input instanceof HTMLInputElement)) throw new Error("Missing image input")
    Object.defineProperty(input, "files", {
        value: [file],
        configurable: true,
    })
    await act(async () => {
        input.dispatchEvent(new Event("change", { bubbles: true }))
    })
}

async function selectValue(element: HTMLSelectElement, value: string): Promise<void> {
    await act(async () => {
        element.value = value
        element.dispatchEvent(new Event("change", { bubbles: true }))
    })
}

function snapshotWithProject(hostName: string, repoId: string, repoName: string, themeClass: string, themeLabel: string): OpenADESnapshot {
    const project: OpenADEProject = {
        id: repoId,
        name: repoName,
        path: `/tmp/${repoId}`,
        tasks: [],
    }
    return {
        server: {
            version: "test",
            hostName,
            theme: { setting: "system", className: themeClass, label: themeLabel },
        },
        repos: [project],
        workingTaskIds: [],
    }
}

function shellRootClassName(container: HTMLElement): string {
    const element = container.firstElementChild
    return element instanceof HTMLElement ? element.className : ""
}

function taskRuntimeRecord(taskId: string, index: number): RuntimeRecord {
    return {
        runtimeId: `runtime-${taskId}-${index}`,
        kind: "agent",
        status: "running",
        scope: {
            ownerType: "openade-task",
            ownerId: taskId,
        },
        startedAt: now,
        updatedAt: now,
        lastActivityAt: now,
    }
}

function localStorageDump(): string {
    const values: string[] = []
    for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index)
        if (!key) continue
        values.push(`${key}=${localStorage.getItem(key) ?? ""}`)
    }
    return values.join("\n")
}

describe("RemoteApp runtime-backed product controls", () => {
    let container: HTMLDivElement
    let root: Root

    beforeEach(() => {
        ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
        localStorage.clear()
        saveRemoteSession()
        container = document.createElement("div")
        document.body.appendChild(container)
        root = createRoot(container)
    })

    afterEach(async () => {
        restoreClientConstructors?.()
        restoreClientConstructors = undefined
        await act(async () => {
            await drainAsyncReactWork()
            root.unmount()
            await drainAsyncReactWork()
        })
        container.remove()
        localStorage.clear()
        vi.restoreAllMocks()
    })

    it("pairs a manual link and loads the saved runtime session", async () => {
        localStorage.clear()
        const pairedBaseUrl = "http://100.64.1.30:7823"
        const pairedSnapshot = snapshotWithProject("Paired Desktop", "paired-repo", "Paired Repo", "code-theme-light", "Light")
        let snapshotReads = 0
        const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
            new Response(JSON.stringify({ deviceToken: "paired-device-token" }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            })
        )
        restoreClientConstructors = __setRemoteClientConstructorsForTest(
            createSnapshotRuntimeConstructors([
                {
                    baseUrl: pairedBaseUrl,
                    snapshot: pairedSnapshot,
                    onSnapshotRead: () => {
                        snapshotReads += 1
                    },
                },
            ])
        )

        await act(async () => {
            root.render(createElement(RemoteApp))
        })

        const pairingInput = await waitForElement(() => inputByPlaceholder(container, "Paste pairing link"), "manual pairing input")
        await typeInto(pairingInput, `${pairedBaseUrl}/pair?token=pair-token&hostId=paired-host`)
        await waitForElement(() => (container.textContent?.includes("Connect to 100.64.1.30:7823") ? container : null), "pending pairing confirmation")
        await click(await waitForElement(() => buttonByText(container, "Connect"), "confirm pairing button"))
        await waitForElement(() => buttonByText(container, "Paired Repo"), "paired runtime project")

        expect(fetchSpy).toHaveBeenCalledWith(
            `${pairedBaseUrl}/v1/pair`,
            expect.objectContaining({
                method: "POST",
                headers: { "Content-Type": "application/json" },
            })
        )
        const requestBody = fetchSpy.mock.calls[0]?.[1]?.body
        if (typeof requestBody !== "string") throw new Error("Expected pairing request body")
        expect(JSON.parse(requestBody)).toMatchObject({
            token: "pair-token",
            deviceName: expect.any(String),
            platform: expect.any(String),
        })
        expect(loadRemoteConfig()).toMatchObject({
            id: "paired-host",
            baseUrl: pairedBaseUrl,
            token: "paired-device-token",
            host: "100.64.1.30:7823",
            hostId: "paired-host",
        })
        expect(loadRemoteConfigs()).toHaveLength(1)
        expect(snapshotReads).toBe(1)
        expect(shellRootClassName(container)).toContain("code-theme-light")
    })

    it("loads project-list-only runtime sessions without probing snapshot or heavy project data", async () => {
        const state = seededTask()
        restoreClientConstructors = __setRemoteClientConstructorsForTest(
            createRuntimeBackedConstructors(state, {
                permissions: ["initialize", "subscription/update", "openade/project/list"],
            })
        )

        await act(async () => {
            root.render(createElement(RemoteApp))
        })

        await waitForElement(() => buttonByText(container, "Runtime Repo"), "project-list-only runtime project")

        expect(state.projectListRuntimeReads).toBe(1)
        expect(state.runtimeListRuntimeReads).toBe(0)
        expect(state.snapshotRuntimeReads).toBe(0)
        expect(state.taskListRuntimeReads).toBe(0)
        expect(state.taskRuntimeReads).toBe(0)
        expect(state.projectFileTreeRuntimeReads).toBe(0)
        expect(state.processListRuntimeReads).toBe(0)
    })

    it("prefers project-list projection over a broad snapshot when both runtime methods are advertised", async () => {
        const state = seededTask()
        restoreClientConstructors = __setRemoteClientConstructorsForTest(createRuntimeBackedConstructors(state))

        await act(async () => {
            root.render(createElement(RemoteApp))
        })

        await waitForElement(() => buttonByText(container, "Runtime Repo"), "project-list-first runtime project")

        expect(state.projectListRuntimeReads).toBe(1)
        expect(state.snapshotRuntimeReads).toBe(0)
        expect(state.taskListRuntimeReads).toBe(0)
        expect(state.taskRuntimeReads).toBe(0)
        expect(state.projectFileTreeRuntimeReads).toBe(0)
        expect(state.processListRuntimeReads).toBe(0)
    })

    it("switches saved sessions, removes stale hosts, and persists shell theme through real runtime clients", async () => {
        const laptopBaseUrl = "http://100.64.1.10:7823"
        const studioBaseUrl = "http://100.64.1.11:7823"
        const laptopSnapshot = snapshotWithProject("Laptop Desktop", "laptop-repo", "Laptop Repo", "code-theme-light", "Light")
        const studioSnapshot = snapshotWithProject("Studio Desktop", "studio-repo", "Studio Repo", "code-theme-bright", "Bright")
        const snapshotReads = {
            laptop: 0,
            studio: 0,
        }
        saveRemoteSessions("session-1", [
            {
                id: "session-1",
                baseUrl: laptopBaseUrl,
                token: "token-1",
                host: "Laptop Desktop",
                savedAt: now,
                lastUsedAt: now,
            },
            {
                id: "session-2",
                baseUrl: studioBaseUrl,
                token: "token-2",
                host: "Studio Desktop",
                savedAt: now,
                lastUsedAt: now,
            },
        ])
        restoreClientConstructors = __setRemoteClientConstructorsForTest(
            createSnapshotRuntimeConstructors([
                {
                    baseUrl: laptopBaseUrl,
                    snapshot: laptopSnapshot,
                    onSnapshotRead: () => {
                        snapshotReads.laptop += 1
                    },
                },
                {
                    baseUrl: studioBaseUrl,
                    snapshot: studioSnapshot,
                    onSnapshotRead: () => {
                        snapshotReads.studio += 1
                    },
                },
            ])
        )

        await act(async () => {
            root.render(createElement(RemoteApp))
        })

        await waitForElement(() => buttonByText(container, "Laptop Repo"), "active laptop project")
        expect(loadRemoteConfig()?.id).toBe("session-1")
        expect(shellRootClassName(container)).toContain("code-theme-light")
        expect(snapshotReads).toEqual({ laptop: 1, studio: 0 })
        expect(container.textContent).toContain("Open this session to load projects.")

        await click(await waitForElement(() => buttonByText(container, "Settings"), "settings tab"))
        const themeSelect = await waitForElement(() => {
            const element = container.querySelector("select")
            return element instanceof HTMLSelectElement ? element : null
        }, "shell theme select")
        await selectValue(themeSelect, "code-theme-dracula")
        expect(localStorage.getItem(REMOTE_THEME_STORAGE_KEY)).toBe("code-theme-dracula")
        expect(shellRootClassName(container)).toContain("code-theme-dracula")
        expect(snapshotReads.studio).toBe(0)

        await click(await waitForElement(() => buttonByText(container, "Manage Sessions"), "manage sessions button"))
        expect(snapshotReads.studio).toBe(0)
        await click(await waitForElement(() => buttonByText(container, "Studio Desktop"), "studio session row"))
        await waitForElement(() => buttonByText(container, "Studio Repo"), "active studio project")
        expect(loadRemoteConfig()?.id).toBe("session-2")
        expect(shellRootClassName(container)).toContain("code-theme-dracula")
        expect(snapshotReads.studio).toBe(1)

        await click(await waitForElement(() => buttonByText(container, "Sessions"), "sessions tab"))
        await click(await waitForElement(() => buttonByTitle(container, "Remove Laptop Desktop"), "remove stale laptop session"))
        await waitForElement(
            () =>
                loadRemoteConfigs()
                    .map((item) => item.id)
                    .join(",") === "session-2"
                    ? container
                    : null,
            "stale session removed from storage"
        )
        expect(container.textContent).not.toContain("Laptop Desktop")

        await act(async () => {
            await drainAsyncReactWork()
            root.unmount()
            await drainAsyncReactWork()
        })
        root = createRoot(container)
        await act(async () => {
            root.render(createElement(RemoteApp))
            await drainAsyncReactWork()
        })

        await waitForElement(() => buttonByText(container, "Studio Repo"), "persisted active studio project")
        expect(loadRemoteConfig()?.id).toBe("session-2")
        expect(localStorage.getItem(REMOTE_THEME_STORAGE_KEY)).toBe("code-theme-dracula")
        expect(shellRootClassName(container)).toContain("code-theme-dracula")
    })

    it("keeps delayed reads from old saved sessions from repainting the active shell", async () => {
        const laptopBaseUrl = "http://100.64.1.10:7823"
        const studioBaseUrl = "http://100.64.1.11:7823"
        const laptopSnapshot = snapshotWithProject("Laptop Desktop", "laptop-repo", "Laptop Repo", "code-theme-light", "Light")
        const staleLaptopSnapshot = snapshotWithProject("Laptop Desktop", "laptop-repo", "Delayed Laptop Repo", "code-theme-light", "Light")
        const studioSnapshot = snapshotWithProject("Studio Desktop", "studio-repo", "Studio Repo", "code-theme-bright", "Bright")
        let delayLaptopReads = false
        const delayedLaptopReadRef: { current: DeferredValue<OpenADESnapshot> | null } = { current: null }

        saveRemoteSessions("session-1", [
            {
                id: "session-1",
                baseUrl: laptopBaseUrl,
                token: "token-1",
                host: "Laptop Desktop",
                savedAt: now,
                lastUsedAt: now,
            },
            {
                id: "session-2",
                baseUrl: studioBaseUrl,
                token: "token-2",
                host: "Studio Desktop",
                savedAt: now,
                lastUsedAt: now,
            },
        ])
        const runtimeHarness = createSnapshotRuntimeConstructors([
            {
                baseUrl: laptopBaseUrl,
                snapshot: laptopSnapshot,
                readSnapshot: () => {
                    if (!delayLaptopReads) return laptopSnapshot
                    delayedLaptopReadRef.current = createDeferredValue<OpenADESnapshot>()
                    return delayedLaptopReadRef.current.promise
                },
            },
            {
                baseUrl: studioBaseUrl,
                snapshot: studioSnapshot,
            },
        ])
        restoreClientConstructors = __setRemoteClientConstructorsForTest(runtimeHarness)

        await act(async () => {
            root.render(createElement(RemoteApp))
        })

        await waitForElement(() => buttonByText(container, "Laptop Repo"), "active laptop project")
        delayLaptopReads = true
        runtimeHarness.publishSnapshotChanged(laptopBaseUrl)
        await waitForElement(() => (delayedLaptopReadRef.current ? container : null), "delayed laptop snapshot read")

        await click(await waitForElement(() => buttonByText(container, "Settings"), "settings tab"))
        await click(await waitForElement(() => buttonByText(container, "Manage Sessions"), "manage sessions button"))
        await click(await waitForElement(() => buttonByText(container, "Studio Desktop"), "studio session row"))
        await waitForElement(() => buttonByText(container, "Studio Repo"), "active studio project")
        expect(loadRemoteConfig()?.id).toBe("session-2")

        const pendingRead = delayedLaptopReadRef.current
        if (!pendingRead) throw new Error("Expected delayed laptop read")
        await act(async () => {
            pendingRead.resolve(staleLaptopSnapshot)
            await new Promise((resolve) => window.setTimeout(resolve, 25))
        })

        expect(container.textContent).toContain("Studio Repo")
        expect(container.textContent).toContain("Studio DesktopOnline")
        expect(loadRemoteConfig()?.id).toBe("session-2")
    })

    it("does not show stale refresh failures after switching saved sessions", async () => {
        const laptopBaseUrl = "http://100.64.1.10:7823"
        const studioBaseUrl = "http://100.64.1.11:7823"
        const laptopSnapshot = snapshotWithProject("Laptop Desktop", "laptop-repo", "Laptop Repo", "code-theme-light", "Light")
        const studioSnapshot = snapshotWithProject("Studio Desktop", "studio-repo", "Studio Repo", "code-theme-bright", "Bright")
        let delayLaptopReads = false
        const delayedLaptopReadRef: { current: DeferredValue<OpenADESnapshot> | null } = { current: null }

        saveRemoteSessions("session-1", [
            {
                id: "session-1",
                baseUrl: laptopBaseUrl,
                token: "token-1",
                host: "Laptop Desktop",
                savedAt: now,
                lastUsedAt: now,
            },
            {
                id: "session-2",
                baseUrl: studioBaseUrl,
                token: "token-2",
                host: "Studio Desktop",
                savedAt: now,
                lastUsedAt: now,
            },
        ])
        restoreClientConstructors = __setRemoteClientConstructorsForTest(
            createSnapshotRuntimeConstructors([
                {
                    baseUrl: laptopBaseUrl,
                    snapshot: laptopSnapshot,
                    readSnapshot: () => {
                        if (!delayLaptopReads) return laptopSnapshot
                        delayedLaptopReadRef.current = createDeferredValue<OpenADESnapshot>()
                        return delayedLaptopReadRef.current.promise
                    },
                },
                {
                    baseUrl: studioBaseUrl,
                    snapshot: studioSnapshot,
                },
            ])
        )

        await act(async () => {
            root.render(createElement(RemoteApp))
        })

        await waitForElement(() => buttonByText(container, "Laptop Repo"), "active laptop project")
        delayLaptopReads = true
        await click(await waitForElement(() => buttonByLabel(container, "Refresh"), "top-level refresh button"))
        await waitForElement(() => (delayedLaptopReadRef.current ? container : null), "delayed laptop refresh")

        await click(await waitForElement(() => buttonByText(container, "Settings"), "settings tab"))
        await click(await waitForElement(() => buttonByText(container, "Manage Sessions"), "manage sessions button"))
        await click(await waitForElement(() => buttonByText(container, "Studio Desktop"), "studio session row"))
        await waitForElement(() => buttonByText(container, "Studio Repo"), "active studio project")
        expect(loadRemoteConfig()?.id).toBe("session-2")

        const pendingRead = delayedLaptopReadRef.current
        if (!pendingRead) throw new Error("Expected delayed laptop refresh")
        await act(async () => {
            pendingRead.reject(new Error("stale laptop refresh failed"))
            await new Promise((resolve) => window.setTimeout(resolve, 25))
        })

        expect(container.textContent).toContain("Studio Repo")
        expect(container.textContent).toContain("Studio DesktopOnline")
        expect(container.textContent).not.toContain("Unable to refresh")
        expect(container.textContent).not.toContain("stale laptop refresh failed")
        expect(loadRemoteConfig()?.id).toBe("session-2")
    })

    it("boots from project-list capability without falling back to denied snapshot reads", async () => {
        const state = seededTask()
        restoreClientConstructors = __setRemoteClientConstructorsForTest(
            createRuntimeBackedConstructors(state, {
                permissions: ["initialize", "subscription/update", "openade/project/list"],
            })
        )

        await act(async () => {
            root.render(createElement(RemoteApp))
        })

        await waitForElement(() => buttonByText(container, "Runtime Repo"), "project-list-only runtime project")
        expect(state.projectListRuntimeReads).toBe(1)
        expect(state.runtimeListRuntimeReads).toBe(0)
        expect(state.snapshotRuntimeReads).toBe(0)
        expect(state.taskListRuntimeReads).toBe(0)
        expect(state.taskRuntimeReads).toBe(0)
        expect(buttonByText(container, "New")).toBeNull()
    })

    it("loads and updates shared product settings lazily through the runtime client", async () => {
        const state = seededTask()
        restoreClientConstructors = __setRemoteClientConstructorsForTest(createRuntimeBackedConstructors(state))

        await act(async () => {
            root.render(createElement(RemoteApp))
        })

        await waitForElement(() => buttonByText(container, "Runtime Repo"), "runtime project")
        expect(state.personalSettingsReadRuntimeRequests).toBe(0)
        expect(state.mcpServersReadRuntimeRequests).toBe(0)

        await click(await waitForElement(() => buttonByText(container, "Settings"), "settings tab"))
        await waitForElement(() => (container.textContent?.includes("Product Preferences") ? container : null), "product preferences section")
        await waitForElement(() => (container.textContent?.includes("Runtime MCP") ? container : null), "connector summary")

        const productThemeSelect = await waitForElement(() => {
            const element = Array.from(container.querySelectorAll("select")).find((select) => select.getAttribute("aria-label") === "Product theme")
            return element instanceof HTMLSelectElement ? element : null
        }, "product theme select")
        const markdownCheckbox = await waitForElement(() => {
            const element = container.querySelector('input[aria-label="Render markdown messages"]')
            return element instanceof HTMLInputElement ? element : null
        }, "markdown preference")
        const telemetryCheckbox = await waitForElement(() => {
            const element = container.querySelector('input[aria-label="Share telemetry"]')
            return element instanceof HTMLInputElement ? element : null
        }, "telemetry preference")
        const connectorToggle = await waitForElement(() => {
            const element = container.querySelector('input[aria-label="Enable connector Runtime MCP"]')
            return element instanceof HTMLInputElement ? element : null
        }, "connector toggle")
        const defaultAgentHarnessSelect = await waitForElement(() => {
            const element = container.querySelector('select[aria-label="Default agent harness"]')
            return element instanceof HTMLSelectElement ? element : null
        }, "default agent harness")
        const defaultAgentModelSelect = await waitForElement(() => {
            const element = container.querySelector('select[aria-label="Default agent model"]')
            return element instanceof HTMLSelectElement ? element : null
        }, "default agent model")
        expect(productThemeSelect.value).toBe("code-theme-clean")
        expect(markdownCheckbox.checked).toBe(false)
        expect(telemetryCheckbox.checked).toBe(false)
        expect(connectorToggle.checked).toBe(true)
        expect(defaultAgentHarnessSelect.value).toBe(DEFAULT_HARNESS_ID)
        expect(defaultAgentModelSelect.value).toBe(getVisibleModelId(getDefaultModelForHarness(DEFAULT_HARNESS_ID), DEFAULT_HARNESS_ID))
        expect(container.textContent).toContain("1/1 enabled")
        expect(state.personalSettingsReadRuntimeRequests).toBe(1)
        expect(state.mcpServersReadRuntimeRequests).toBe(1)
        expect(state.mcpServersUpsertRuntimeRequests).toBe(0)
        expect(state.mcpServersDeleteRuntimeRequests).toBe(0)
        expect(state.projectListRuntimeReads).toBe(1)
        expect(state.snapshotRuntimeReads).toBe(0)
        expect(state.taskRuntimeReads).toBe(0)

        await selectValue(defaultAgentHarnessSelect, "codex")
        await waitForElement(() => (state.personalSettingsReplaceRuntimeRequests === 1 ? container : null), "default agent settings replace")
        expect(state.personalSettings.newTaskHarnessId).toBe("codex")
        expect(state.personalSettings.newTaskModelId).toBe(getVisibleModelId(getDefaultModelForHarness("codex"), "codex"))

        await selectValue(productThemeSelect, "code-theme-black")
        await waitForElement(() => (state.personalSettingsReplaceRuntimeRequests === 2 ? container : null), "theme settings replace")
        expect(state.personalSettings.theme).toBe("code-theme-black")

        await click(
            await waitForElement(() => {
                const element = container.querySelector('input[aria-label="Render markdown messages"]')
                return element instanceof HTMLInputElement && !element.disabled ? element : null
            }, "enabled markdown preference")
        )
        await waitForElement(() => (state.personalSettingsReplaceRuntimeRequests === 3 ? container : null), "markdown settings replace")
        expect(state.personalSettings.renderMarkdownMessages).toBe(true)

        await click(
            await waitForElement(() => {
                const element = container.querySelector('input[aria-label="Share telemetry"]')
                return element instanceof HTMLInputElement && !element.disabled ? element : null
            }, "enabled telemetry preference")
        )
        await waitForElement(() => (state.personalSettingsReplaceRuntimeRequests === 4 ? container : null), "telemetry settings replace")
        expect(state.personalSettings.telemetryDisabled).toBe(false)
        expect(container.textContent).toContain("Preferences updated.")
        expect(state.personalSettingsReadRuntimeRequests).toBe(1)
        expect(state.taskRuntimeReads).toBe(0)

        expect(container.textContent).not.toContain("configured")
        await click(await waitForElement(() => buttonByTitle(container, "Edit environment vars"), "environment vars edit button"))
        const envVarsTextarea = await waitForElement(() => {
            const element = container.querySelector('textarea[aria-label="Environment variables JSON"]')
            return element instanceof HTMLTextAreaElement ? element : null
        }, "environment vars JSON editor")
        expect(envVarsTextarea.value).toContain('"OPENADE_ENV": "configured"')
        await typeInto(envVarsTextarea, JSON.stringify({ OPENADE_ENV: "runtime-updated", MULTILINE_SECRET: "line\nnext" }, null, 2))
        await click(await waitForElement(() => buttonByText(container, "Save Environment Vars"), "save environment vars"))
        await waitForElement(() => (state.personalSettingsReplaceRuntimeRequests === 5 ? container : null), "environment settings replace")
        expect(state.personalSettings.envVars).toEqual({ OPENADE_ENV: "runtime-updated", MULTILINE_SECRET: "line\nnext" })
        expect(state.personalSettingsReadRuntimeRequests).toBe(1)
        expect(state.taskRuntimeReads).toBe(0)

        await click(
            await waitForElement(() => {
                const element = container.querySelector('input[aria-label="Enable connector Runtime MCP"]')
                return element instanceof HTMLInputElement && !element.disabled ? element : null
            }, "enabled connector toggle")
        )
        await waitForElement(() => (state.mcpServersUpsertRuntimeRequests === 1 ? container : null), "connector upsert request")
        expect(container.textContent).toContain("Connector updated.")
        expect(state.mcpServersReadRuntimeRequests).toBe(1)
        expect(state.taskRuntimeReads).toBe(0)

        vi.spyOn(window, "confirm").mockReturnValue(true)
        await click(await waitForElement(() => buttonByTitle(container, "Delete connector Runtime MCP"), "connector delete button"))
        await waitForElement(() => (state.mcpServersDeleteRuntimeRequests === 1 ? container : null), "connector delete request")
        await waitForElement(() => (container.textContent?.includes("No connectors configured.") ? container : null), "connector removed")
        expect(container.textContent).toContain("Connector deleted.")
        expect(state.mcpServersReadRuntimeRequests).toBe(1)
        expect(state.taskRuntimeReads).toBe(0)
    })

    it("does not show delayed preference update failures after leaving Settings", async () => {
        const state = seededTask()
        const settingsGate = createDeferredValue<void>()
        restoreClientConstructors = __setRemoteClientConstructorsForTest(
            createRuntimeBackedConstructors(state, {
                replacePersonalSettingsDelay: settingsGate.promise,
                replacePersonalSettingsError: "delayed preferences failed",
            })
        )

        await act(async () => {
            root.render(createElement(RemoteApp))
        })

        await click(await waitForElement(() => buttonByText(container, "Settings"), "settings tab"))
        await waitForElement(() => (container.textContent?.includes("Product Preferences") ? container : null), "product preferences section")
        await click(
            await waitForElement(() => {
                const element = container.querySelector('input[aria-label="Render markdown messages"]')
                return element instanceof HTMLInputElement && !element.disabled ? element : null
            }, "enabled markdown preference")
        )
        await waitForElement(() => (state.personalSettingsReplaceRuntimeRequests === 1 ? container : null), "delayed preferences replace")
        await click(await waitForElement(() => buttonByText(container, "Projects"), "projects tab during delayed preferences replace"))
        await waitForElement(() => buttonByText(container, "Runtime Repo"), "projects screen after leaving settings")

        await act(async () => {
            settingsGate.resolve(undefined)
            await new Promise((resolve) => window.setTimeout(resolve, 50))
        })

        expect(container.textContent).toContain("Runtime Repo")
        expect(container.textContent).not.toContain("Unable to update preferences")
        expect(container.textContent).not.toContain("delayed preferences failed")
    })

    it("creates and edits shared connectors through the runtime client", async () => {
        const state = seededTask()
        restoreClientConstructors = __setRemoteClientConstructorsForTest(createRuntimeBackedConstructors(state))

        await act(async () => {
            root.render(createElement(RemoteApp))
        })

        await waitForElement(() => buttonByText(container, "Runtime Repo"), "runtime project")
        await click(await waitForElement(() => buttonByText(container, "Settings"), "settings tab"))
        await waitForElement(() => (container.textContent?.includes("Runtime MCP") ? container : null), "connector summary")

        await click(await waitForElement(() => buttonByTitle(container, "Add connector"), "add connector button"))
        await typeInto(
            await waitForElement(() => {
                const element = container.querySelector('input[aria-label="Connector name"]')
                return element instanceof HTMLInputElement ? element : null
            }, "new connector name"),
            "Docs MCP"
        )
        await typeInto(
            await waitForElement(() => {
                const element = container.querySelector('input[aria-label="Connector URL"]')
                return element instanceof HTMLInputElement ? element : null
            }, "new connector url"),
            "https://mcp.example.test/mcp"
        )
        await click(await waitForElement(() => buttonByText(container, "Advanced"), "new connector advanced button"))
        await typeInto(
            await waitForElement(() => {
                const element = container.querySelector('textarea[aria-label="Connector headers JSON"]')
                return element instanceof HTMLTextAreaElement ? element : null
            }, "new connector headers"),
            JSON.stringify({ Authorization: "Bearer docs-token" }, null, 2)
        )
        await click(await waitForElement(() => buttonByText(container, "Save Connector"), "save new connector"))
        await waitForElement(() => (state.mcpServersUpsertRuntimeRequests === 1 ? container : null), "connector create upsert")
        await waitForElement(() => (container.textContent?.includes("Docs MCP") ? container : null), "created connector visible")
        expect(container.textContent).toContain("Connector updated.")
        expect(state.lastMcpServerUpsert).toMatchObject({
            name: "Docs MCP",
            transportType: "http",
            headers: { Authorization: "Bearer docs-token" },
        })

        await click(await waitForElement(() => buttonByTitle(container, "Edit connector Docs MCP"), "edit created connector"))
        await typeInto(
            await waitForElement(() => {
                const element = container.querySelector('input[aria-label="Connector name"]')
                return element instanceof HTMLInputElement ? element : null
            }, "edit connector name"),
            "Docs MCP Edited"
        )
        await click(await waitForElement(() => buttonByText(container, "Save Connector"), "save edited connector"))
        await waitForElement(() => (state.mcpServersUpsertRuntimeRequests === 2 ? container : null), "connector edit upsert")
        await waitForElement(() => (container.textContent?.includes("Docs MCP Edited") ? container : null), "edited connector visible")

        await click(await waitForElement(() => buttonByTitle(container, "Edit connector Runtime MCP"), "edit runtime connector"))
        await click(await waitForElement(() => buttonByText(container, "Advanced"), "runtime connector advanced button"))
        const runtimeEnvTextarea = await waitForElement(() => {
            const element = container.querySelector('textarea[aria-label="Connector environment variables JSON"]')
            return element instanceof HTMLTextAreaElement ? element : null
        }, "runtime connector env vars")
        expect(runtimeEnvTextarea.value).toContain('"RUNTIME_MCP_SECRET": "configured"')
        await typeInto(runtimeEnvTextarea, JSON.stringify({ RUNTIME_MCP_SECRET: "updated", MCP_MODE: "remote" }, null, 2))
        await click(await waitForElement(() => buttonByText(container, "Save Connector"), "save runtime connector"))
        await waitForElement(() => (state.mcpServersUpsertRuntimeRequests === 3 ? container : null), "runtime connector env upsert")
        expect(state.lastMcpServerUpsert).toMatchObject({
            id: "mcp-runtime",
            transportType: "stdio",
            envVars: { RUNTIME_MCP_SECRET: "updated", MCP_MODE: "remote" },
        })

        expect(state.mcpServersReadRuntimeRequests).toBe(1)
        expect(state.mcpServersDeleteRuntimeRequests).toBe(0)
        expect(state.taskRuntimeReads).toBe(0)
    })

    it("does not show delayed connector update failures after leaving Settings", async () => {
        const state = seededTask()
        const connectorGate = createDeferredValue<void>()
        restoreClientConstructors = __setRemoteClientConstructorsForTest(
            createRuntimeBackedConstructors(state, {
                upsertMcpServerDelay: connectorGate.promise,
                upsertMcpServerError: "delayed connector failed",
            })
        )

        await act(async () => {
            root.render(createElement(RemoteApp))
        })

        await click(await waitForElement(() => buttonByText(container, "Settings"), "settings tab"))
        await waitForElement(() => (container.textContent?.includes("Runtime MCP") ? container : null), "connector summary")
        await click(
            await waitForElement(() => {
                const element = container.querySelector('input[aria-label="Enable connector Runtime MCP"]')
                return element instanceof HTMLInputElement && !element.disabled ? element : null
            }, "enabled connector toggle")
        )
        await waitForElement(() => (state.mcpServersUpsertRuntimeRequests === 1 ? container : null), "delayed connector upsert")
        await click(await waitForElement(() => buttonByText(container, "Projects"), "projects tab during delayed connector upsert"))
        await waitForElement(() => buttonByText(container, "Runtime Repo"), "projects screen after leaving settings")

        await act(async () => {
            connectorGate.resolve(undefined)
            await new Promise((resolve) => window.setTimeout(resolve, 50))
        })

        expect(container.textContent).toContain("Runtime Repo")
        expect(container.textContent).not.toContain("Unable to update connector")
        expect(container.textContent).not.toContain("delayed connector failed")
    })

    it("keeps shared product settings read-only without the replace capability", async () => {
        const state = seededTask()
        restoreClientConstructors = __setRemoteClientConstructorsForTest(
            createRuntimeBackedConstructors(state, {
                permissions: [
                    "initialize",
                    "subscription/update",
                    "openade/snapshot/read",
                    "openade/settings/personal/read",
                    "openade/settings/mcpServers/read",
                ],
            })
        )

        await act(async () => {
            root.render(createElement(RemoteApp))
        })

        await waitForElement(() => buttonByText(container, "Runtime Repo"), "runtime project")
        await click(await waitForElement(() => buttonByText(container, "Settings"), "settings tab"))
        await waitForElement(() => (container.textContent?.includes("Product Preferences") ? container : null), "product preferences section")

        expect(container.textContent).toContain("Plain text")
        expect(container.querySelector('select[aria-label="Product theme"]')).toBeNull()
        expect(container.querySelector('input[aria-label="Render markdown messages"]')).toBeNull()
        expect(container.querySelector('input[aria-label="Share telemetry"]')).toBeNull()
        expect(buttonByTitle(container, "Edit environment vars")).toBeNull()
        expect(container.querySelector('textarea[aria-label="Environment variables JSON"]')).toBeNull()
        expect(container.querySelector('input[aria-label="Enable connector Runtime MCP"]')).toBeNull()
        expect(container.querySelector('textarea[aria-label="Connector headers JSON"]')).toBeNull()
        expect(container.querySelector('textarea[aria-label="Connector environment variables JSON"]')).toBeNull()
        expect(buttonByTitle(container, "Delete connector Runtime MCP")).toBeNull()
        expect(container.textContent).toContain("Enabled")
        expect(state.personalSettingsReadRuntimeRequests).toBe(1)
        expect(state.personalSettingsReplaceRuntimeRequests).toBe(0)
        expect(state.mcpServersReadRuntimeRequests).toBe(1)
        expect(state.lastMcpServersReadResult?.servers).toEqual([
            expect.objectContaining({
                id: "mcp-runtime",
                name: "Runtime MCP",
                transportType: "stdio",
                enabled: true,
                healthStatus: "healthy",
            }),
        ])
        expect(state.lastMcpServersReadResult?.servers[0]).toHaveProperty("command", "")
        expect(state.lastMcpServersReadResult?.servers[0]).not.toHaveProperty("envVars")
        expect(state.mcpServersUpsertRuntimeRequests).toBe(0)
        expect(state.mcpServersDeleteRuntimeRequests).toBe(0)
    })

    it("does not read product preferences when the active runtime lacks personal-settings read", async () => {
        const state = seededTask()
        restoreClientConstructors = __setRemoteClientConstructorsForTest(
            createRuntimeBackedConstructors(state, {
                permissions: ["initialize", "subscription/update", "openade/snapshot/read", "openade/settings/mcpServers/read"],
            })
        )

        await act(async () => {
            root.render(createElement(RemoteApp))
        })

        await waitForElement(() => buttonByText(container, "Runtime Repo"), "runtime project")
        await click(await waitForElement(() => buttonByText(container, "Settings"), "settings tab"))
        await waitForElement(() => (container.textContent?.includes("Runtime MCP") ? container : null), "connector summary")

        expect(container.textContent).not.toContain("Product Preferences")
        expect(container.querySelector('select[aria-label="Product theme"]')).toBeNull()
        expect(state.personalSettingsReadRuntimeRequests).toBe(0)
        expect(state.personalSettingsReplaceRuntimeRequests).toBe(0)
        expect(state.mcpServersReadRuntimeRequests).toBe(1)
    })

    it("keeps shared settings mutations unavailable when read capabilities are missing", async () => {
        const state = seededTask()
        restoreClientConstructors = __setRemoteClientConstructorsForTest(
            createRuntimeBackedConstructors(state, {
                permissions: [
                    "initialize",
                    "subscription/update",
                    "openade/snapshot/read",
                    "openade/settings/personal/replace",
                    "openade/settings/mcpServers/upsert",
                    "openade/settings/mcpServers/delete",
                ],
            })
        )

        await act(async () => {
            root.render(createElement(RemoteApp))
        })

        await waitForElement(() => buttonByText(container, "Runtime Repo"), "runtime project")
        await click(await waitForElement(() => buttonByText(container, "Settings"), "settings tab"))
        await waitForElement(() => (container.textContent?.includes("Settings") ? container : null), "settings screen")

        expect(container.textContent).not.toContain("Product Preferences")
        expect(container.textContent).not.toContain("Runtime MCP")
        expect(container.querySelector('select[aria-label="Product theme"]')).toBeNull()
        expect(container.querySelector('input[aria-label="Enable connector Runtime MCP"]')).toBeNull()
        expect(buttonByTitle(container, "Delete connector Runtime MCP")).toBeNull()
        expect(state.personalSettingsReadRuntimeRequests).toBe(0)
        expect(state.personalSettingsReplaceRuntimeRequests).toBe(0)
        expect(state.mcpServersReadRuntimeRequests).toBe(0)
        expect(state.mcpServersUpsertRuntimeRequests).toBe(0)
        expect(state.mcpServersDeleteRuntimeRequests).toBe(0)
    })

    it("uses runtime personal settings as shared new-task agent defaults", async () => {
        const state = seededTask()
        state.personalSettings = {
            ...state.personalSettings,
            newTaskHarnessId: "codex",
            newTaskModelId: getDefaultModelForHarness("codex"),
        }
        restoreClientConstructors = __setRemoteClientConstructorsForTest(createRuntimeBackedConstructors(state))

        await act(async () => {
            root.render(createElement(RemoteApp))
        })

        await waitForElement(() => buttonByText(container, "Runtime Repo"), "runtime project")
        expect(state.personalSettingsReadRuntimeRequests).toBe(0)
        await click(await waitForElement(() => buttonByText(container, "New"), "new task tab"))
        await waitForElement(() => (state.personalSettingsReadRuntimeRequests === 1 ? container : null), "new-task defaults read")
        const titleInput = await waitForElement(() => inputByPlaceholder(container, "Optional title"), "new task title input")
        const promptInput = await waitForElement(() => taskInputElement(container), "new task prompt input")
        await typeInto(titleInput, "Defaulted agent task")
        await typeIntoTaskInput(promptInput, "Use the persisted agent defaults")
        await click(
            await waitForElement(() => {
                const button = buttonByText(container, "Create & Run")
                return button && !button.disabled ? button : null
            }, "create and run with defaults")
        )

        await waitForElement(() => (state.turnStarts.length === 1 ? container : null), "turn start request")
        expect(state.turnStarts[0]).toMatchObject({
            harnessId: "codex",
            modelId: getDefaultModelForHarness("codex"),
        })
        expect(state.taskRuntimeReads).toBe(0)
    })

    it("refreshes the selected task from a queued-turn runtime notification", async () => {
        const state = seededTask()
        const runtimeHarness = createRuntimeBackedConstructors(state)
        restoreClientConstructors = __setRemoteClientConstructorsForTest(runtimeHarness)

        await act(async () => {
            root.render(createElement(RemoteApp))
        })

        const projectRow = await waitForElement(() => buttonByText(container, "Runtime Repo"), "project row")
        await act(async () => {
            await new Promise((resolve) => window.setTimeout(resolve, 250))
        })
        const snapshotReadsBeforeProjectOpen = state.snapshotRuntimeReads
        await click(projectRow)
        await waitForElement(() => (state.taskListRuntimeReads > 0 ? container : null), "project task-list refresh")
        expect(state.snapshotRuntimeReads).toBe(snapshotReadsBeforeProjectOpen)
        expect(state.projectFileTreeRuntimeReads).toBe(0)
        await click(await waitForElement(() => buttonByText(container, "Original task"), "task row"))
        await waitForElement(() => (container.textContent?.includes("Run this after the current turn") ? container : null), "initial queued turn")
        expect(state.taskRuntimeReads).toBe(1)

        await click(await waitForElement(() => buttonByText(container, "Projects"), "projects nav from cached task"))
        await click(await waitForElement(() => buttonByText(container, "Runtime Repo"), "project row from cached task"))
        await click(await waitForElement(() => buttonByText(container, "Original task"), "cached task row"))
        await waitForElement(() => (container.textContent?.includes("Run this after the current turn") ? container : null), "cached task detail")
        expect(state.taskRuntimeReads).toBe(1)

        await act(async () => {
            runtimeHarness.publishQueuedTurnUpdated({
                ...state.queuedTurn,
                input: "Queued turn promoted by core",
                status: "running",
                updatedAt: now,
            })
        })

        await waitForElement(
            () => (container.textContent?.includes("Queued turn promoted by core") && container.textContent.includes("running") ? container : null),
            "queued turn refresh from notification"
        )
    })

    it("refreshes task previews from task-list notifications without full snapshot reads", async () => {
        const state = seededTask()
        const runtimeHarness = createRuntimeBackedConstructors(state)
        restoreClientConstructors = __setRemoteClientConstructorsForTest(runtimeHarness)

        await act(async () => {
            root.render(createElement(RemoteApp))
        })

        const projectRow = await waitForElement(() => buttonByText(container, "Runtime Repo"), "project row")
        await act(async () => {
            await new Promise((resolve) => window.setTimeout(resolve, 250))
        })
        const snapshotReadsBeforeProjectOpen = state.snapshotRuntimeReads
        await click(projectRow)
        await waitForElement(() => (state.taskListRuntimeReads > 0 ? container : null), "project task-list refresh")
        expect(state.snapshotRuntimeReads).toBe(snapshotReadsBeforeProjectOpen)

        const taskListReadsBeforeNotification = state.taskListRuntimeReads
        const snapshotReadsBeforeNotification = state.snapshotRuntimeReads
        await act(async () => {
            runtimeHarness.publishTaskPreviewChanged("Preview from task list")
        })

        await waitForElement(() => (state.taskListRuntimeReads > taskListReadsBeforeNotification ? container : null), "notification task-list refresh")
        await waitForElement(() => (container.textContent?.includes("Preview from task list") ? container : null), "task preview title")
        expect(state.snapshotRuntimeReads).toBe(snapshotReadsBeforeNotification)
    })

    it("repairs task preview notifications through project-list when task-list is unavailable", async () => {
        const state = seededTask()
        const runtimeHarness = createRuntimeBackedConstructors(state, {
            permissions: ["initialize", "subscription/update", "openade/snapshot/read", "openade/project/list"],
        })
        restoreClientConstructors = __setRemoteClientConstructorsForTest(runtimeHarness)

        await act(async () => {
            root.render(createElement(RemoteApp))
        })

        const projectRow = await waitForElement(() => buttonByText(container, "Runtime Repo"), "project row")
        await click(projectRow)
        expect(state.taskListRuntimeReads).toBe(0)

        const projectListReadsBeforeNotification = state.projectListRuntimeReads
        const snapshotReadsBeforeNotification = state.snapshotRuntimeReads
        await act(async () => {
            runtimeHarness.publishTaskPreviewChanged("Preview from project list")
        })

        await waitForElement(() => (state.projectListRuntimeReads > projectListReadsBeforeNotification ? container : null), "notification project-list repair")
        await waitForElement(() => (container.textContent?.includes("Preview from project list") ? container : null), "project-list repaired task preview")
        expect(state.taskListRuntimeReads).toBe(0)
        expect(state.snapshotRuntimeReads).toBe(snapshotReadsBeforeNotification)
    })

    it("coalesces task preview notification bursts into one task-list refresh", async () => {
        const state = seededTask()
        const runtimeHarness = createRuntimeBackedConstructors(state)
        restoreClientConstructors = __setRemoteClientConstructorsForTest(runtimeHarness)

        await act(async () => {
            root.render(createElement(RemoteApp))
        })

        const projectRow = await waitForElement(() => buttonByText(container, "Runtime Repo"), "project row")
        await act(async () => {
            await new Promise((resolve) => window.setTimeout(resolve, 250))
        })
        const snapshotReadsBeforeProjectOpen = state.snapshotRuntimeReads
        await click(projectRow)
        await waitForElement(() => (state.taskListRuntimeReads > 0 ? container : null), "project task-list refresh")
        expect(state.snapshotRuntimeReads).toBe(snapshotReadsBeforeProjectOpen)

        const taskListReadsBeforeNotification = state.taskListRuntimeReads
        const snapshotReadsBeforeNotification = state.snapshotRuntimeReads
        await act(async () => {
            runtimeHarness.publishTaskPreviewChanged("Preview burst 1")
            runtimeHarness.publishTaskPreviewChanged("Preview burst 2")
            runtimeHarness.publishTaskPreviewChanged("Preview burst 3")
        })

        await waitForElement(() => (container.textContent?.includes("Preview burst 3") ? container : null), "coalesced task preview title")
        await act(async () => {
            await new Promise((resolve) => window.setTimeout(resolve, 300))
        })
        expect(state.taskListRuntimeReads).toBe(taskListReadsBeforeNotification + 1)
        expect(state.snapshotRuntimeReads).toBe(snapshotReadsBeforeNotification)
    })

    it("refreshes task deletions from bridge notification bursts through one task-list read", async () => {
        const state = seededTask()
        const runtimeHarness = createRuntimeBackedConstructors(state)
        restoreClientConstructors = __setRemoteClientConstructorsForTest(runtimeHarness)

        await act(async () => {
            root.render(createElement(RemoteApp))
        })

        const projectRow = await waitForElement(() => buttonByText(container, "Runtime Repo"), "project row")
        await act(async () => {
            await new Promise((resolve) => window.setTimeout(resolve, 250))
        })
        const snapshotReadsBeforeProjectOpen = state.snapshotRuntimeReads
        await click(projectRow)
        await waitForElement(() => buttonByText(container, "Original task"), "task row")
        expect(state.snapshotRuntimeReads).toBe(snapshotReadsBeforeProjectOpen)

        const taskListReadsBeforeNotification = state.taskListRuntimeReads
        const snapshotReadsBeforeNotification = state.snapshotRuntimeReads
        const projectListReadsBeforeNotification = state.projectListRuntimeReads
        await act(async () => {
            runtimeHarness.publishTaskDeleted()
        })

        await waitForElement(() => (state.taskListRuntimeReads > taskListReadsBeforeNotification ? container : null), "task delete task-list refresh")
        await waitForElement(() => (container.textContent?.includes("No tasks yet.") ? container : null), "deleted task removed from project")
        await act(async () => {
            await new Promise((resolve) => window.setTimeout(resolve, 300))
        })
        expect(state.taskListRuntimeReads).toBe(taskListReadsBeforeNotification + 1)
        expect(state.snapshotRuntimeReads).toBe(snapshotReadsBeforeNotification)
        expect(state.projectListRuntimeReads).toBe(projectListReadsBeforeNotification)
    })

    it("cancels delayed selected-task reads when task deletion supersedes a task notification", async () => {
        const state = seededTask()
        const runtimeHarness = createRuntimeBackedConstructors(state)
        restoreClientConstructors = __setRemoteClientConstructorsForTest(runtimeHarness)

        await act(async () => {
            root.render(createElement(RemoteApp))
        })

        const projectRow = await waitForElement(() => buttonByText(container, "Runtime Repo"), "project row")
        await act(async () => {
            await new Promise((resolve) => window.setTimeout(resolve, 250))
        })
        await click(projectRow)
        await click(await waitForElement(() => buttonByText(container, "Original task"), "task row"))
        await waitForElement(() => (container.textContent?.includes("Run this after the current turn") ? container : null), "selected task")

        const taskReadsBeforeNotification = state.taskRuntimeReads
        const taskListReadsBeforeNotification = state.taskListRuntimeReads
        await act(async () => {
            runtimeHarness.publishQueuedTurnUpdated({
                ...state.queuedTurn,
                input: "This update is superseded by deletion",
                status: "running",
                updatedAt: now,
            })
            runtimeHarness.publishTaskDeleted()
        })

        await waitForElement(() => (state.taskListRuntimeReads > taskListReadsBeforeNotification ? container : null), "task delete task-list refresh")
        await waitForElement(() => (container.textContent?.includes("No tasks yet.") ? container : null), "deleted task removed from project")
        await act(async () => {
            await new Promise((resolve) => window.setTimeout(resolve, 300))
        })

        expect(state.taskRuntimeReads).toBe(taskReadsBeforeNotification)
    })

    it("refreshes project notifications through project-list without full snapshot reads", async () => {
        const state = seededTask()
        const runtimeHarness = createRuntimeBackedConstructors(state)
        restoreClientConstructors = __setRemoteClientConstructorsForTest(runtimeHarness)

        await act(async () => {
            root.render(createElement(RemoteApp))
        })

        await waitForElement(() => buttonByText(container, "Runtime Repo"), "runtime project")
        const snapshotReadsBeforeNotification = state.snapshotRuntimeReads
        const projectListReadsBeforeNotification = state.projectListRuntimeReads

        await act(async () => {
            runtimeHarness.publishRepoUpdated("Runtime Repo Updated")
        })

        await waitForElement(() => (state.projectListRuntimeReads > projectListReadsBeforeNotification ? container : null), "notification project-list refresh")
        await waitForElement(() => (container.textContent?.includes("Runtime Repo Updated") ? container : null), "updated project name")
        expect(state.snapshotRuntimeReads).toBe(snapshotReadsBeforeNotification)
        expect(state.taskRuntimeReads).toBe(0)
    })

    it("patches working task notifications without full snapshot reads", async () => {
        const state = seededTask()
        const runtimeHarness = createRuntimeBackedConstructors(state)
        restoreClientConstructors = __setRemoteClientConstructorsForTest(runtimeHarness)

        await act(async () => {
            root.render(createElement(RemoteApp))
        })

        const projectRow = await waitForElement(() => buttonByText(container, "Runtime Repo"), "project row")
        await act(async () => {
            await new Promise((resolve) => window.setTimeout(resolve, 250))
        })
        const snapshotReadsBeforeProjectOpen = state.snapshotRuntimeReads
        await click(projectRow)
        await waitForElement(() => buttonByText(container, "Original task"), "task row")
        expect(state.snapshotRuntimeReads).toBe(snapshotReadsBeforeProjectOpen)
        expect(container.textContent).not.toContain("Running")

        const snapshotReadsBeforeNotification = state.snapshotRuntimeReads
        await act(async () => {
            runtimeHarness.publishWorkingTasks(["task-1"])
        })

        await waitForElement(() => (container.textContent?.includes("Running") ? container : null), "running task indicator")
        expect(state.snapshotRuntimeReads).toBe(snapshotReadsBeforeNotification)
    })

    it("creates remote tasks with the shared composer agent controls over a real runtime client", async () => {
        const state = seededTask()
        restoreClientConstructors = __setRemoteClientConstructorsForTest(createRuntimeBackedConstructors(state))

        await act(async () => {
            root.render(createElement(RemoteApp))
        })

        await waitForElement(() => buttonByText(container, "Runtime Repo"), "runtime project")
        await click(await waitForElement(() => buttonByText(container, "New"), "new task tab"))
        const titleInput = await waitForElement(() => inputByPlaceholder(container, "Optional title"), "new task title input")
        const promptInput = await waitForElement(() => taskInputElement(container), "new task prompt input")
        expect(state.mcpServersReadRuntimeRequests).toBe(0)
        await click(await waitForElement(() => buttonByTitle(container, "Load MCP connectors"), "new task mcp load"))
        await waitForElement(() => buttonByText(container, "Runtime MCP"), "new task mcp selector")
        expect(state.mcpServersReadRuntimeRequests).toBe(1)
        await click(await waitForElement(() => buttonByText(container, "Runtime MCP"), "new task mcp selector"))
        await typeInto(titleInput, "Remote composer task")
        await typeIntoTaskInput(promptInput, "Create from the shared composer")
        await click(await waitForElement(() => buttonByTitle(container, "Fast mode"), "fast mode toggle"))
        expect(state.mcpServersReadRuntimeRequests).toBe(1)
        expect(state.projectGitBranchesRuntimeReads).toBe(0)
        await click(await waitForElement(() => buttonByText(container, "Load Branches"), "load branches button"))
        await waitForElement(() => (state.projectGitBranchesRuntimeReads === 1 ? container : null), "project branches runtime read")
        const worktreeToggle = await waitForElement(() => {
            const element = container.querySelector('input[aria-label="Use worktree"]')
            return element instanceof HTMLInputElement ? element : null
        }, "worktree toggle")
        await click(worktreeToggle)
        const sourceBranchSelect = await waitForElement(() => {
            const element = container.querySelector('select[aria-label="Source branch"]')
            return element instanceof HTMLSelectElement ? element : null
        }, "source branch select")
        await selectValue(sourceBranchSelect, "feature/shared-shell")
        const snapshotReadsBeforeCreate = state.snapshotRuntimeReads
        const taskReadsBeforeCreate = state.taskRuntimeReads
        await click(
            await waitForElement(() => {
                const button = buttonByText(container, "Create & Run")
                return button && !button.disabled ? button : null
            }, "enabled create task button")
        )

        await waitForElement(() => (state.turnStarts.length === 1 ? container : null), "remote task start request")
        expect(state.taskCreateRuntimeRequests).toBe(1)
        expect(state.snapshotRuntimeReads).toBe(snapshotReadsBeforeCreate)
        expect(state.taskRuntimeReads).toBe(taskReadsBeforeCreate)
        expect(state.task).toMatchObject({
            id: "task-created",
            repoId: "repo-1",
            title: "Remote composer task",
            description: "Create from the shared composer",
            createdBy: {
                id: "remote-companion",
                email: "remote-companion@openade.local",
            },
            isolationStrategy: {
                type: "worktree",
                sourceBranch: "feature/shared-shell",
            },
            enabledMcpServerIds: ["mcp-runtime"],
        })
        expect(state.turnStarts[0]).toMatchObject({
            repoId: "repo-1",
            inTaskId: "task-created",
            type: "do",
            input: "Create from the shared composer",
            harnessId: DEFAULT_HARNESS_ID,
            modelId: getVisibleModelId(getDefaultModelForHarness(DEFAULT_HARNESS_ID), DEFAULT_HARNESS_ID),
            thinking: "max",
            fastMode: true,
            enabledMcpServerIds: ["mcp-runtime"],
        })
        await act(async () => {
            await new Promise((resolve) => window.setTimeout(resolve, 250))
        })
        expect(state.snapshotRuntimeReads).toBe(snapshotReadsBeforeCreate)
        expect(state.taskRuntimeReads).toBe(taskReadsBeforeCreate)
    })

    it("persists shared new-task Create More and last worktree branch preferences", async () => {
        const state = seededTask()
        restoreClientConstructors = __setRemoteClientConstructorsForTest(createRuntimeBackedConstructors(state))

        await act(async () => {
            root.render(createElement(RemoteApp))
        })

        await waitForElement(() => buttonByText(container, "Runtime Repo"), "runtime project")
        await click(await waitForElement(() => buttonByText(container, "New"), "new task tab"))
        await click(await waitForElement(() => buttonByLabel(container, "Create more tasks"), "create more switch"))
        await click(await waitForElement(() => buttonByText(container, "Load Branches"), "load branches button"))
        const worktreeToggle = await waitForElement(() => {
            const element = container.querySelector('input[aria-label="Use worktree"]')
            return element instanceof HTMLInputElement ? element : null
        }, "worktree toggle")
        await click(worktreeToggle)
        const sourceBranchSelect = await waitForElement(() => {
            const element = container.querySelector('select[aria-label="Source branch"]')
            return element instanceof HTMLSelectElement ? element : null
        }, "source branch select")
        await selectValue(sourceBranchSelect, "feature/shared-shell")

        await act(async () => {
            await drainAsyncReactWork()
            root.unmount()
            await drainAsyncReactWork()
        })
        root = createRoot(container)
        await act(async () => {
            root.render(createElement(RemoteApp))
            await drainAsyncReactWork()
        })

        await waitForElement(() => buttonByText(container, "Runtime Repo"), "runtime project after remount")
        await click(await waitForElement(() => buttonByText(container, "New"), "new task tab after remount"))
        await waitForElement(() => {
            const toggle = buttonByLabel(container, "Create more tasks")
            return toggle?.getAttribute("aria-checked") === "true" ? toggle : null
        }, "persisted create-more preference")
        await click(await waitForElement(() => buttonByText(container, "Load Branches"), "reload branches button"))
        const restoredWorktreeToggle = await waitForElement(() => {
            const element = container.querySelector('input[aria-label="Use worktree"]')
            return element instanceof HTMLInputElement ? element : null
        }, "restored worktree toggle")
        await click(restoredWorktreeToggle)
        const restoredSourceBranchSelect = await waitForElement(() => {
            const element = container.querySelector('select[aria-label="Source branch"]')
            return element instanceof HTMLSelectElement && element.value === "feature/shared-shell" ? element : null
        }, "persisted source branch")

        expect(Array.from(restoredSourceBranchSelect.options).map((option) => option.textContent)).toContain("feature/shared-shell (last)")
        expect(state.projectGitBranchesRuntimeReads).toBe(1)
    })

    it("keeps the shared new-task composer open when Create More is enabled", async () => {
        const state = seededTask()
        restoreClientConstructors = __setRemoteClientConstructorsForTest(createRuntimeBackedConstructors(state))

        await act(async () => {
            root.render(createElement(RemoteApp))
        })

        await waitForElement(() => buttonByText(container, "Runtime Repo"), "runtime project")
        await click(await waitForElement(() => buttonByText(container, "New"), "new task tab"))
        await click(await waitForElement(() => buttonByLabel(container, "Create more tasks"), "create more switch"))
        const titleInput = await waitForElement(() => inputByPlaceholder(container, "Optional title"), "new task title input")
        const promptInput = await waitForElement(() => taskInputElement(container), "new task prompt input")
        await typeInto(titleInput, "First create-more task")
        await typeIntoTaskInput(promptInput, "Create this and keep composing")

        const taskReadsBeforeCreate = state.taskRuntimeReads
        await click(
            await waitForElement(() => {
                const button = buttonByText(container, "Create & Run")
                return button && !button.disabled ? button : null
            }, "enabled create-more task button")
        )

        await waitForElement(() => (state.turnStarts.length === 1 ? container : null), "create-more turn start request")
        await waitForElement(() => summaryByText(container, "1 ready"), "create-more ready task")
        const clearedTitleInput = await waitForElement(() => inputByPlaceholder(container, "Optional title"), "new task title after create more")
        const clearedPromptInput = await waitForElement(() => taskInputElement(container), "new task prompt after create more")
        expect(clearedTitleInput.value).toBe("")
        expect(taskInputValue(clearedPromptInput)).toBe("")
        expect(buttonByText(container, "Create & Run")).toBeTruthy()
        expect(container.textContent).toContain("Task created and started.")
        expect(state.taskCreateRuntimeRequests).toBe(1)
        expect(state.taskRuntimeReads).toBe(taskReadsBeforeCreate)
        expect(state.task).toMatchObject({
            id: "task-created",
            title: "First create-more task",
            description: "Create this and keep composing",
        })
        expect(state.turnStarts[0]).toMatchObject({
            repoId: "repo-1",
            inTaskId: "task-created",
            input: "Create this and keep composing",
        })
    })

    it("keeps Create More usable while previous task creations are still pending", async () => {
        const state = seededTask()
        const delayedStart = createDeferredValue<void>()
        restoreClientConstructors = __setRemoteClientConstructorsForTest(
            createRuntimeBackedConstructors(state, {
                startTurnDelay: delayedStart.promise,
            })
        )

        await act(async () => {
            root.render(createElement(RemoteApp))
        })

        await waitForElement(() => buttonByText(container, "Runtime Repo"), "runtime project")
        await click(await waitForElement(() => buttonByText(container, "New"), "new task tab"))
        await click(await waitForElement(() => buttonByLabel(container, "Create more tasks"), "create more switch"))

        const firstTitleInput = await waitForElement(() => inputByPlaceholder(container, "Optional title"), "first title input")
        const firstPromptInput = await waitForElement(() => taskInputElement(container), "first prompt input")
        await typeInto(firstTitleInput, "First delayed create-more task")
        await typeIntoTaskInput(firstPromptInput, "First delayed create-more prompt")
        await click(
            await waitForElement(() => {
                const button = buttonByText(container, "Create & Run")
                return button && !button.disabled ? button : null
            }, "first create-more submit")
        )

        await waitForElement(() => summaryByText(container, "1 pending"), "first pending creation")
        const clearedTitleInput = await waitForElement(() => inputByPlaceholder(container, "Optional title"), "cleared title after first pending")
        const clearedPromptInput = await waitForElement(() => taskInputElement(container), "cleared prompt after first pending")
        expect(clearedTitleInput.value).toBe("")
        expect(taskInputValue(clearedPromptInput)).toBe("")
        expect(state.taskCreateRuntimeRequests).toBe(1)
        expect(state.turnStartRuntimeRequests).toBe(1)
        expect(state.turnStarts).toHaveLength(0)

        await typeInto(clearedTitleInput, "Second delayed create-more task")
        await typeIntoTaskInput(clearedPromptInput, "Second delayed create-more prompt")
        await click(
            await waitForElement(() => {
                const button = buttonByText(container, "Create & Run")
                return button && !button.disabled ? button : null
            }, "second create-more submit")
        )

        await waitForElement(() => summaryByText(container, "2 pending"), "second pending creation")
        expect(state.taskCreateRuntimeRequests).toBe(2)
        expect(state.turnStartRuntimeRequests).toBe(2)
        expect(state.turnStarts).toHaveLength(0)

        await act(async () => {
            delayedStart.resolve(undefined)
        })

        await waitForElement(() => (state.turnStarts.length === 2 ? container : null), "both delayed create-more starts")
        expect(state.turnStarts.map((turn) => turn.input)).toEqual(["First delayed create-more prompt", "Second delayed create-more prompt"])
        await waitForElement(() => summaryByText(container, "2 ready"), "completed create-more tasks remain navigable")
        expect(buttonByText(container, "Create & Run")).toBeTruthy()
        await click(await waitForElement(() => summaryByText(container, "2 ready"), "completed create-more menu"))
        await click(await waitForElement(() => buttonByText(container, "Open"), "open completed create-more task"))
        await waitForElement(() => (container.textContent?.includes("Second delayed create-more prompt") ? container : null), "opened completed create-more task")
    })

    it("cancels pending shared new-task creation before runtime turn start", async () => {
        const state = seededTask()
        const delayedCreate = createDeferredValue<void>()
        restoreClientConstructors = __setRemoteClientConstructorsForTest(
            createRuntimeBackedConstructors(state, {
                createTaskDelay: delayedCreate.promise,
            })
        )

        await act(async () => {
            root.render(createElement(RemoteApp))
        })

        await waitForElement(() => buttonByText(container, "Runtime Repo"), "runtime project")
        await click(await waitForElement(() => buttonByText(container, "New"), "new task tab"))
        const titleInput = await waitForElement(() => inputByPlaceholder(container, "Optional title"), "new task title input")
        const promptInput = await waitForElement(() => taskInputElement(container), "new task prompt input")
        await typeInto(titleInput, "Cancelled remote task")
        await typeIntoTaskInput(promptInput, "Cancel before the runtime starts a turn")
        await click(
            await waitForElement(() => {
                const button = buttonByText(container, "Create & Run")
                return button && !button.disabled ? button : null
            }, "enabled cancellable task button")
        )

        await waitForElement(() => (state.taskCreateRuntimeRequests === 1 ? container : null), "delayed create request")
        await click(await waitForElement(() => summaryByText(container, "1 pending"), "cancellable pending menu"))
        await click(await waitForElement(() => buttonByText(container, "Cancel"), "cancel pending creation"))
        await waitForElement(() => (summaryByText(container, "1 pending") === null ? container : null), "pending creation removed after cancel")
        expect(buttonByText(container, "Create & Run")?.disabled).toBe(false)

        await act(async () => {
            delayedCreate.resolve(undefined)
            await drainAsyncReactWork()
            await new Promise((resolve) => window.setTimeout(resolve, 50))
        })

        expect(state.taskCreateRuntimeRequests).toBe(1)
        expect(state.turnStartRuntimeRequests).toBe(0)
        expect(state.turnStarts).toHaveLength(0)
        expect(container.textContent).toContain("New task")
    })

    it("stashes and restores shared new-task drafts before runtime create/start", async () => {
        const state = seededTask()
        restoreClientConstructors = __setRemoteClientConstructorsForTest(createRuntimeBackedConstructors(state))

        await act(async () => {
            root.render(createElement(RemoteApp))
        })

        await waitForElement(() => buttonByText(container, "Runtime Repo"), "runtime project")
        await click(await waitForElement(() => buttonByText(container, "New"), "new task tab"))
        const titleInput = await waitForElement(() => inputByPlaceholder(container, "Optional title"), "new task title input")
        const promptInput = await waitForElement(() => taskInputElement(container), "new task prompt input")
        await typeInto(titleInput, "Drafted remote task")
        await typeIntoTaskInput(promptInput, "Restore this draft through the shared shell")
        await click(await waitForElement(() => buttonByText(container, "Stash"), "stash draft button"))

        const clearedTitleInput = await waitForElement(() => inputByPlaceholder(container, "Optional title"), "cleared draft title")
        const clearedPromptInput = await waitForElement(() => taskInputElement(container), "cleared draft prompt")
        expect(clearedTitleInput.value).toBe("")
        expect(taskInputValue(clearedPromptInput)).toBe("")
        await click(await waitForElement(() => summaryByText(container, "Drafts"), "drafts menu"))
        await waitForElement(() => (container.textContent?.includes("Drafted remote task") ? container : null), "stashed draft preview")
        await click(await waitForElement(() => buttonByText(container, "Pop"), "pop stashed draft"))

        const restoredTitleInput = await waitForElement(() => {
            const element = inputByPlaceholder(container, "Optional title")
            return element?.value === "Drafted remote task" ? element : null
        }, "restored draft title")
        const restoredPromptInput = await waitForElement(() => {
            const element = taskInputElement(container)
            return element && taskInputValue(element) === "Restore this draft through the shared shell" ? element : null
        }, "restored draft prompt")
        expect(restoredTitleInput.value).toBe("Drafted remote task")
        expect(taskInputValue(restoredPromptInput)).toBe("Restore this draft through the shared shell")

        await click(
            await waitForElement(() => {
                const button = buttonByText(container, "Create & Run")
                return button && !button.disabled ? button : null
            }, "enabled restored-draft create button")
        )

        await waitForElement(() => (state.turnStarts.length === 1 ? container : null), "restored draft turn start request")
        expect(state.taskCreateRuntimeRequests).toBe(1)
        expect(state.task).toMatchObject({
            id: "task-created",
            title: "Drafted remote task",
            description: "Restore this draft through the shared shell",
        })
        expect(state.turnStarts[0]).toMatchObject({
            repoId: "repo-1",
            inTaskId: "task-created",
            type: "do",
            input: "Restore this draft through the shared shell",
        })
    })

    it("stashes and restores same-session new-task image drafts before runtime create/start", async () => {
        const state = seededTask()
        restoreClientConstructors = __setRemoteClientConstructorsForTest(createRuntimeBackedConstructors(state))

        await act(async () => {
            root.render(createElement(RemoteApp))
        })

        await waitForElement(() => buttonByText(container, "Runtime Repo"), "runtime project")
        await click(await waitForElement(() => buttonByText(container, "New"), "new task tab"))
        await waitForElement(() => buttonByLabel(container, "Attach image"), "new task image attach button")
        const titleInput = await waitForElement(() => inputByPlaceholder(container, "Optional title"), "new task title input")
        const promptInput = await waitForElement(() => taskInputElement(container), "new task prompt input")
        await typeInto(titleInput, "Image draft task")
        await typeIntoTaskInput(promptInput, "Restore this image draft through the shared shell")

        await attachImage(container, tinyPngFile())
        await waitForElement(() => (state.taskImageWriteRuntimeRequests === 1 ? container : null), "new-task image write request")
        const written = state.taskImageWrites[0]
        expect(written).toMatchObject({ ext: "png", mediaType: "image/png" })
        await waitForElement(() => container.querySelector(`img[src^="blob:"]`), "new-task image preview before stash")

        await click(await waitForElement(() => buttonByText(container, "Stash"), "stash image draft button"))
        await waitForElement(() => (container.querySelector(`img[src^="blob:"]`) === null ? container : null), "image preview moved into draft")
        await click(await waitForElement(() => summaryByText(container, "Drafts"), "drafts menu"))
        await waitForElement(() => (container.textContent?.includes("Image draft task") ? container : null), "stashed image draft preview")
        await waitForElement(() => (container.textContent?.includes("1 image") ? container : null), "stashed image count")
        const persistedDrafts = localStorageDump()
        expect(persistedDrafts).not.toContain("blob:")
        expect(persistedDrafts).not.toContain(written.imageId)

        await click(await waitForElement(() => buttonByText(container, "Pop"), "pop stashed image draft"))
        await waitForElement(() => container.querySelector(`img[src^="blob:"]`), "restored new-task image preview")
        await waitForElement(() => {
            const element = inputByPlaceholder(container, "Optional title")
            return element?.value === "Image draft task" ? element : null
        }, "restored image draft title")
        await waitForElement(() => {
            const element = taskInputElement(container)
            return element && taskInputValue(element) === "Restore this image draft through the shared shell" ? element : null
        }, "restored image draft prompt")

        await click(
            await waitForElement(() => {
                const button = buttonByText(container, "Create & Run")
                return button && !button.disabled ? button : null
            }, "enabled restored image-draft create button")
        )

        await waitForElement(() => (state.turnStarts.length === 1 ? container : null), "restored image draft turn start request")
        expect(state.taskCreateRuntimeRequests).toBe(1)
        expect(state.task).toMatchObject({
            id: "task-created",
            title: "Image draft task",
            description: "Restore this image draft through the shared shell",
        })
        expect(state.turnStarts[0]).toMatchObject({
            repoId: "repo-1",
            inTaskId: "task-created",
            type: "do",
            input: "Restore this image draft through the shared shell",
            images: [
                expect.objectContaining({
                    id: written.imageId,
                    ext: "png",
                    mediaType: "image/png",
                }),
            ],
        })
    })

    it("shows shared new-task pending creation state while runtime start is delayed", async () => {
        const state = seededTask()
        const delayedStart = createDeferredValue<void>()
        restoreClientConstructors = __setRemoteClientConstructorsForTest(
            createRuntimeBackedConstructors(state, {
                startTurnDelay: delayedStart.promise,
            })
        )

        await act(async () => {
            root.render(createElement(RemoteApp))
        })

        await waitForElement(() => buttonByText(container, "Runtime Repo"), "runtime project")
        await click(await waitForElement(() => buttonByText(container, "New"), "new task tab"))
        const titleInput = await waitForElement(() => inputByPlaceholder(container, "Optional title"), "new task title input")
        const promptInput = await waitForElement(() => taskInputElement(container), "new task prompt input")
        await typeInto(titleInput, "Delayed remote task")
        await typeIntoTaskInput(promptInput, "Show pending creation while the runtime is still starting")
        await click(
            await waitForElement(() => {
                const button = buttonByText(container, "Create & Run")
                return button && !button.disabled ? button : null
            }, "enabled create task button")
        )

        await waitForElement(() => summaryByText(container, "1 pending"), "pending creation indicator")
        await click(await waitForElement(() => summaryByText(container, "1 pending"), "pending creation menu"))
        await waitForElement(() => (container.textContent?.includes("Delayed remote task") ? container : null), "pending creation preview")
        await waitForElement(() => (container.textContent?.includes("Starting task") ? container : null), "pending creation phase")
        expect(state.taskCreateRuntimeRequests).toBe(1)
        expect(state.turnStartRuntimeRequests).toBe(1)
        expect(state.turnStarts).toHaveLength(0)

        await act(async () => {
            delayedStart.resolve(undefined)
        })

        await waitForElement(() => (state.turnStarts.length === 1 ? container : null), "delayed pending turn start")
        expect(state.turnStarts[0]).toMatchObject({
            repoId: "repo-1",
            inTaskId: "task-created",
            input: "Show pending creation while the runtime is still starting",
        })
        await waitForElement(() => (container.textContent?.includes("Delayed remote task") ? container : null), "created task detail")
        expect(summaryByText(container, "1 pending")).toBeNull()
    })

    it("submits shared new-task mode shortcuts through the runtime create/start path", async () => {
        const state = seededTask()
        restoreClientConstructors = __setRemoteClientConstructorsForTest(createRuntimeBackedConstructors(state))

        await act(async () => {
            root.render(createElement(RemoteApp))
        })

        await waitForElement(() => buttonByText(container, "Runtime Repo"), "runtime project")
        await click(await waitForElement(() => buttonByText(container, "New"), "new task tab"))
        const promptInput = await waitForElement(() => taskInputElement(container), "new task prompt input")
        await typeIntoTaskInput(promptInput, "Plan from the shared shortcut")

        await act(async () => {
            window.dispatchEvent(new KeyboardEvent("keydown", { code: "Digit2", key: "2", metaKey: true, bubbles: true }))
        })

        await waitForElement(() => (state.turnStarts.length === 1 ? container : null), "shortcut turn start request")
        expect(state.taskCreateRuntimeRequests).toBe(1)
        expect(state.turnStarts[0]).toMatchObject({
            repoId: "repo-1",
            inTaskId: "task-created",
            type: "plan",
            input: "Plan from the shared shortcut",
        })
    })

    it("sends selected HyperPlan strategy when creating remote tasks", async () => {
        const state = seededTask()
        restoreClientConstructors = __setRemoteClientConstructorsForTest(createRuntimeBackedConstructors(state))

        await act(async () => {
            root.render(createElement(RemoteApp))
        })

        await waitForElement(() => buttonByText(container, "Runtime Repo"), "runtime project")
        await click(await waitForElement(() => buttonByText(container, "New"), "new task tab"))
        const promptInput = await waitForElement(() => taskInputElement(container), "new task prompt input")
        await typeIntoTaskInput(promptInput, "Create a multi-agent plan")
        await click(await waitForElement(() => buttonByText(container, "HyperPlan"), "hyperplan command"))
        await click(await waitForElement(() => buttonByText(container, "Peer Review"), "peer-review strategy"))
        await click(
            await waitForElement(() => {
                const button = buttonByText(container, "Create & Run")
                return button && !button.disabled ? button : null
            }, "enabled hyperplan create button")
        )

        await waitForElement(() => (state.turnStarts.length === 1 ? container : null), "remote hyperplan start request")
        expect(state.turnStarts[0]).toMatchObject({
            repoId: "repo-1",
            inTaskId: "task-created",
            type: "hyperplan",
            input: "Create a multi-agent plan",
            hyperplanStrategy: {
                id: "peer-review",
                terminalStepId: "revise_a",
            },
        })
        expect(state.turnStarts[0].hyperplanStrategy?.steps.map((step) => step.primitive)).toEqual(["plan", "review", "revise"])
    })

    it("starts existing task turns with shared composer agent controls over a real runtime client", async () => {
        const state = seededTask()
        restoreClientConstructors = __setRemoteClientConstructorsForTest(createRuntimeBackedConstructors(state))

        await act(async () => {
            root.render(createElement(RemoteApp))
        })

        await click(await waitForElement(() => buttonByText(container, "Runtime Repo"), "project row"))
        await click(await waitForElement(() => buttonByText(container, "Original task"), "task row"))
        await waitForElement(() => (container.textContent?.includes("Describe this image") ? container : null), "initial task detail")
        expect(state.mcpServersReadRuntimeRequests).toBe(0)
        await click(await waitForElement(() => buttonByTitle(container, "Load MCP connectors"), "task mcp load"))
        await waitForElement(() => buttonByText(container, "Runtime MCP"), "task mcp selector")
        expect(state.mcpServersReadRuntimeRequests).toBe(1)
        await click(await waitForElement(() => buttonByText(container, "Runtime MCP"), "task mcp selector"))
        await waitForElement(() => (state.task.enabledMcpServerIds?.includes("mcp-runtime") ? container : null), "task mcp metadata update")
        const promptInput = await waitForElement(() => taskInputElement(container), "task prompt input")
        await typeIntoTaskInput(promptInput, "Run in the existing task with selected agent settings")
        await click(await waitForElement(() => buttonByTitle(container, "Fast mode"), "fast mode toggle"))
        const snapshotReadsBeforeSend = state.snapshotRuntimeReads
        const taskReadsBeforeSend = state.taskRuntimeReads
        await click(
            await waitForElement(() => {
                const button = sendButtonForTaskInput(promptInput)
                return button && !button.disabled ? button : null
            }, "enabled existing task send button")
        )

        await waitForElement(() => (state.turnStarts.length === 1 ? container : null), "existing task start request")
        expect(state.snapshotRuntimeReads).toBe(snapshotReadsBeforeSend)
        expect(state.taskRuntimeReads).toBe(taskReadsBeforeSend)
        expect(state.turnStarts[0]).toMatchObject({
            repoId: "repo-1",
            inTaskId: "task-1",
            type: "do",
            input: "Run in the existing task with selected agent settings",
            harnessId: DEFAULT_HARNESS_ID,
            modelId: getVisibleModelId(getDefaultModelForHarness(DEFAULT_HARNESS_ID), DEFAULT_HARNESS_ID),
            thinking: "max",
            fastMode: true,
            enabledMcpServerIds: ["mcp-runtime"],
        })
        await act(async () => {
            await new Promise((resolve) => window.setTimeout(resolve, 250))
        })
        expect(state.snapshotRuntimeReads).toBe(snapshotReadsBeforeSend)
        expect(state.taskRuntimeReads).toBe(taskReadsBeforeSend)
    })

    it("does not submit stale task MCP ids when the runtime cannot read MCP connectors", async () => {
        const state = seededTask()
        state.task.enabledMcpServerIds = ["mcp-runtime"]
        restoreClientConstructors = __setRemoteClientConstructorsForTest(
            createRuntimeBackedConstructors(state, {
                permissions: ["initialize", "subscription/update", "openade/snapshot/read", "openade/task/read", "openade/turn/start"],
            })
        )

        await act(async () => {
            root.render(createElement(RemoteApp))
        })

        await click(await waitForElement(() => buttonByText(container, "Runtime Repo"), "project row"))
        await click(await waitForElement(() => buttonByText(container, "Original task"), "task row"))
        await waitForElement(() => (container.textContent?.includes("Describe this image") ? container : null), "initial task detail")
        expect(buttonByTitle(container, "Load MCP connectors")).toBeNull()
        expect(state.mcpServersReadRuntimeRequests).toBe(0)

        const promptInput = await waitForElement(() => taskInputElement(container), "task prompt input")
        await typeIntoTaskInput(promptInput, "Run without hidden connectors")
        await click(
            await waitForElement(() => {
                const button = sendButtonForTaskInput(promptInput)
                return button && !button.disabled ? button : null
            }, "enabled existing task send button")
        )

        await waitForElement(() => (state.turnStarts.length === 1 ? container : null), "existing task start request")
        expect(state.turnStarts[0]).toMatchObject({
            repoId: "repo-1",
            inTaskId: "task-1",
            type: "do",
            input: "Run without hidden connectors",
        })
        expect(state.turnStarts[0].enabledMcpServerIds).toBeUndefined()
        expect(state.mcpServersReadRuntimeRequests).toBe(0)
    })

    it("does not let a delayed existing-task turn response repaint after navigating away", async () => {
        const state = seededTask()
        const startGate = createDeferredValue<void>()
        restoreClientConstructors = __setRemoteClientConstructorsForTest(
            createRuntimeBackedConstructors(state, {
                startTurnDelay: startGate.promise,
            })
        )

        await act(async () => {
            root.render(createElement(RemoteApp))
        })

        await click(await waitForElement(() => buttonByText(container, "Runtime Repo"), "project row"))
        await click(await waitForElement(() => buttonByText(container, "Original task"), "task row"))
        await waitForElement(() => (container.textContent?.includes("Describe this image") ? container : null), "initial task detail")
        const promptInput = await waitForElement(() => taskInputElement(container), "task prompt input")
        await typeIntoTaskInput(promptInput, "Run after I leave the task")
        await click(
            await waitForElement(() => {
                const button = sendButtonForTaskInput(promptInput)
                return button && !button.disabled ? button : null
            }, "enabled delayed turn send button")
        )
        await waitForElement(() => (state.turnStartRuntimeRequests === 1 ? container : null), "delayed turn start request")
        await click(await waitForElement(() => buttonByText(container, "Settings"), "settings tab during delayed turn"))
        await waitForElement(() => (container.textContent?.includes("Product Preferences") ? container : null), "settings screen")

        await act(async () => {
            startGate.resolve(undefined)
            await new Promise((resolve) => window.setTimeout(resolve, 50))
        })

        expect(state.turnStarts).toHaveLength(1)
        expect(container.textContent).toContain("Product Preferences")
        expect(container.textContent).not.toContain("Run after I leave the task")
    })

    it("does not show delayed task read failures after leaving the task shell scope", async () => {
        const state = seededTask()
        const taskReadGate = createDeferredValue<void>()
        restoreClientConstructors = __setRemoteClientConstructorsForTest(
            createRuntimeBackedConstructors(state, {
                readTaskDelay: taskReadGate.promise,
                readTaskError: "delayed task read failed",
            })
        )

        await act(async () => {
            root.render(createElement(RemoteApp))
        })

        await click(await waitForElement(() => buttonByText(container, "Runtime Repo"), "project row"))
        await click(await waitForElement(() => buttonByText(container, "Original task"), "task row"))
        await waitForElement(() => (state.taskRuntimeReads === 1 ? container : null), "delayed task read request")
        await click(await waitForElement(() => buttonByText(container, "Settings"), "settings tab during delayed task read"))
        await waitForElement(() => (container.textContent?.includes("Product Preferences") ? container : null), "settings screen")

        await act(async () => {
            taskReadGate.resolve(undefined)
            await new Promise((resolve) => window.setTimeout(resolve, 50))
        })

        expect(state.taskRuntimeReads).toBe(1)
        expect(container.textContent).toContain("Product Preferences")
        expect(container.textContent).not.toContain("Unable to load task")
        expect(container.textContent).not.toContain("delayed task read failed")
    })

    it("does not keep delayed task git refresh data after leaving the task shell scope", async () => {
        const state = seededTask()
        const changesGate = createDeferredValue<void>()
        restoreClientConstructors = __setRemoteClientConstructorsForTest(
            createRuntimeBackedConstructors(state, {
                readTaskChangesDelay: changesGate.promise,
            })
        )

        await act(async () => {
            root.render(createElement(RemoteApp))
        })

        await click(await waitForElement(() => buttonByText(container, "Runtime Repo"), "project row"))
        await click(await waitForElement(() => buttonByText(container, "Original task"), "task row"))
        await waitForElement(() => (container.textContent?.includes("Describe this image") ? container : null), "initial task detail")
        await click(await waitForElement(() => buttonByText(container, "Load Changes"), "load delayed task git"))
        await waitForElement(() => (state.taskChangesRuntimeReads === 1 ? container : null), "delayed task changes request")
        await click(await waitForElement(() => buttonByText(container, "Settings"), "settings tab during delayed task git"))
        await waitForElement(() => (container.textContent?.includes("Product Preferences") ? container : null), "settings screen")

        await act(async () => {
            changesGate.resolve(undefined)
            await new Promise((resolve) => window.setTimeout(resolve, 50))
        })

        expect(container.textContent).toContain("Product Preferences")
        expect(container.textContent).not.toContain("src/app.ts")

        await click(await waitForElement(() => buttonByText(container, "Projects"), "projects tab after delayed task git"))
        await click(await waitForElement(() => buttonByText(container, "Runtime Repo"), "return to project after delayed task git"))
        await click(await waitForElement(() => buttonByText(container, "Original task"), "return to task after delayed task git"))
        await waitForElement(() => buttonByText(container, "Load Changes"), "unloaded task git panel")
        expect(container.textContent).not.toContain("src/app.ts")
        expect(state.taskChangesRuntimeReads).toBe(1)
    })

    it("does not run a broad refresh from a delayed interrupt after leaving the task shell scope", async () => {
        const state = seededTask()
        state.workingTaskIds = ["task-1"]
        const interruptGate = createDeferredValue<void>()
        restoreClientConstructors = __setRemoteClientConstructorsForTest(
            createRuntimeBackedConstructors(state, {
                interruptTurnDelay: interruptGate.promise,
            })
        )

        await act(async () => {
            root.render(createElement(RemoteApp))
        })

        await click(await waitForElement(() => buttonByText(container, "Runtime Repo"), "project row"))
        await click(await waitForElement(() => buttonByText(container, "Original task"), "running task row"))
        await waitForElement(() => (container.textContent?.includes("Describe this image") ? container : null), "running task detail")
        const taskReadsBeforeInterrupt = state.taskRuntimeReads
        const snapshotReadsBeforeInterrupt = state.snapshotRuntimeReads
        await click(await waitForElement(() => buttonByLabel(container, "Abort task"), "abort task button"))
        await waitForElement(() => (state.turnInterruptRuntimeRequests === 1 ? container : null), "delayed interrupt request")
        await click(await waitForElement(() => buttonByText(container, "Settings"), "settings tab during delayed interrupt"))
        await waitForElement(() => (container.textContent?.includes("Product Preferences") ? container : null), "settings screen")

        await act(async () => {
            interruptGate.resolve(undefined)
            await new Promise((resolve) => window.setTimeout(resolve, 50))
        })

        expect(state.turnInterruptRuntimeRequests).toBe(1)
        expect(state.taskRuntimeReads).toBe(taskReadsBeforeInterrupt)
        expect(state.snapshotRuntimeReads).toBe(snapshotReadsBeforeInterrupt)
        expect(container.textContent).toContain("Product Preferences")
    })

    it("does not refresh task git or show commit notices after a delayed commit leaves task scope", async () => {
        const state = seededTask()
        const commitGate = createDeferredValue<void>()
        restoreClientConstructors = __setRemoteClientConstructorsForTest(
            createRuntimeBackedConstructors(state, {
                commitTaskGitDelay: commitGate.promise,
            })
        )

        await act(async () => {
            root.render(createElement(RemoteApp))
        })

        await click(await waitForElement(() => buttonByText(container, "Runtime Repo"), "project row"))
        await click(await waitForElement(() => buttonByText(container, "Original task"), "task row"))
        await waitForElement(() => (container.textContent?.includes("Describe this image") ? container : null), "task detail")
        await click(await waitForElement(() => buttonByText(container, "Load Changes"), "load task git"))
        await waitForElement(() => (container.textContent?.includes("1 changed file") ? container : null), "task git summary")
        const changesReadsBeforeCommit = state.taskChangesRuntimeReads
        const logReadsBeforeCommit = state.taskGitLogRuntimeReads
        const summaryReadsBeforeCommit = state.taskGitSummaryRuntimeReads
        const scopesReadsBeforeCommit = state.taskGitScopesRuntimeReads
        const commitMessageInput = await waitForElement(() => inputByPlaceholder(container, "Commit message"), "commit message input")
        await typeInto(commitMessageInput, "Delayed shared shell commit")
        await click(await waitForElement(() => buttonByText(container, "Commit"), "commit task changes button"))
        await waitForElement(() => (state.taskGitCommitRuntimeRequests === 1 ? container : null), "delayed task git commit request")
        await click(await waitForElement(() => buttonByText(container, "Settings"), "settings tab during delayed task git commit"))
        await waitForElement(() => (container.textContent?.includes("Product Preferences") ? container : null), "settings screen")
        const refreshButtonWhileCommitIsDelayed = await waitForElement(() => buttonByLabel(container, "Refresh"), "settings refresh after delayed task git commit")
        expect(refreshButtonWhileCommitIsDelayed.querySelector(".animate-spin")).toBeNull()

        await act(async () => {
            commitGate.resolve(undefined)
            await new Promise((resolve) => window.setTimeout(resolve, 50))
        })

        expect(state.taskGitCommitMessages).toEqual(["Delayed shared shell commit"])
        expect(state.taskChangesRuntimeReads).toBe(changesReadsBeforeCommit)
        expect(state.taskGitLogRuntimeReads).toBe(logReadsBeforeCommit)
        expect(state.taskGitSummaryRuntimeReads).toBe(summaryReadsBeforeCommit)
        expect(state.taskGitScopesRuntimeReads).toBe(scopesReadsBeforeCommit)
        expect(container.textContent).toContain("Product Preferences")
        expect(container.textContent).not.toContain("Committed fedcba98")
    })

    it("does not keep delayed task resources after leaving the task shell scope", async () => {
        const state = seededTask()
        const resourcesGate = createDeferredValue<void>()
        restoreClientConstructors = __setRemoteClientConstructorsForTest(
            createRuntimeBackedConstructors(state, {
                readTaskResourceInventoryDelay: resourcesGate.promise,
            })
        )

        await act(async () => {
            root.render(createElement(RemoteApp))
        })

        await click(await waitForElement(() => buttonByText(container, "Runtime Repo"), "project row"))
        await click(await waitForElement(() => buttonByText(container, "Original task"), "task row"))
        await waitForElement(() => (container.textContent?.includes("Describe this image") ? container : null), "task detail")
        await click(await waitForElement(() => buttonByLabel(container, "Load task resources"), "load delayed task resources"))
        await waitForElement(() => (state.taskResourceInventoryRuntimeReads === 1 ? container : null), "delayed task resources request")
        await click(await waitForElement(() => buttonByText(container, "Settings"), "settings tab during delayed task resources"))
        await waitForElement(() => (container.textContent?.includes("Product Preferences") ? container : null), "settings screen")

        await act(async () => {
            resourcesGate.resolve(undefined)
            await new Promise((resolve) => window.setTimeout(resolve, 50))
        })

        expect(container.textContent).toContain("Product Preferences")
        expect(container.textContent).not.toContain("openade/task-1")

        await click(await waitForElement(() => buttonByText(container, "Projects"), "projects tab after delayed task resources"))
        await click(await waitForElement(() => buttonByText(container, "Runtime Repo"), "return to project after delayed task resources"))
        await click(await waitForElement(() => buttonByText(container, "Original task"), "return to task after delayed task resources"))
        await waitForElement(() => buttonByLabel(container, "Load task resources"), "unloaded task resources")
        expect(container.textContent).not.toContain("openade/task-1")
        expect(state.taskResourceInventoryRuntimeReads).toBe(1)
    })

    it("does not let delayed task panel reads from an old session repaint a new active session", async () => {
        const state = seededTask()
        const diffGate = createDeferredValue<void>()
        saveRemoteSessions("session-1", [
            {
                id: "session-1",
                baseUrl: "http://100.64.1.10:7823",
                token: "token-1",
                host: "First Runtime",
                savedAt: now,
                lastUsedAt: now,
            },
            {
                id: "session-2",
                baseUrl: "http://100.64.1.10:7823",
                token: "token-2",
                host: "Second Runtime",
                savedAt: now,
                lastUsedAt: now,
            },
        ])
        restoreClientConstructors = __setRemoteClientConstructorsForTest(
            createRuntimeBackedConstructors(state, {
                readTaskDiffDelay: diffGate.promise,
            })
        )

        await act(async () => {
            root.render(createElement(RemoteApp))
        })

        await click(await waitForElement(() => buttonByText(container, "Runtime Repo"), "first session project row"))
        await click(await waitForElement(() => buttonByText(container, "Original task"), "first session task row"))
        await waitForElement(() => (container.textContent?.includes("Describe this image") ? container : null), "first session task detail")
        await click(await waitForElement(() => buttonByText(container, "Load Changes"), "load first session task git"))
        await waitForElement(() => (container.textContent?.includes("src/app.ts") ? container : null), "first session changed file")
        await click(await waitForElement(() => buttonByText(container, "src/app.ts"), "start delayed first session task diff"))
        await waitForElement(() => (state.taskDiffRuntimeReads === 1 ? container : null), "delayed task diff request")

        await click(await waitForElement(() => buttonByText(container, "Settings"), "settings tab before session switch"))
        await click(await waitForElement(() => buttonByText(container, "Manage Sessions"), "manage sessions before switch"))
        await click(await waitForElement(() => buttonByText(container, "Second Runtime"), "second saved session row"))
        await waitForElement(() => buttonByText(container, "Runtime Repo"), "second session project row")
        expect(loadRemoteConfig()?.id).toBe("session-2")
        await click(await waitForElement(() => buttonByText(container, "Runtime Repo"), "second session project"))
        await click(await waitForElement(() => buttonByText(container, "Original task"), "second session task"))
        await waitForElement(() => (container.textContent?.includes("Describe this image") ? container : null), "second session task detail")

        await act(async () => {
            diffGate.resolve(undefined)
            await new Promise((resolve) => window.setTimeout(resolve, 50))
        })

        expect(container.textContent).toContain("Describe this image")
        expect(container.textContent).not.toContain("+remote task changes")
        expect(loadRemoteConfig()?.id).toBe("session-2")
    })

    it("does not refresh task state from a delayed metadata mutation after leaving the task shell scope", async () => {
        const state = seededTask()
        const metadataGate = createDeferredValue<void>()
        restoreClientConstructors = __setRemoteClientConstructorsForTest(
            createRuntimeBackedConstructors(state, {
                updateTaskMetadataDelay: metadataGate.promise,
            })
        )

        await act(async () => {
            root.render(createElement(RemoteApp))
        })

        await click(await waitForElement(() => buttonByText(container, "Runtime Repo"), "project row"))
        await click(await waitForElement(() => buttonByText(container, "Original task"), "task row"))
        const titleInput = await waitForElement(() => inputByValue(container, "Original task"), "task title input")
        const taskReadsBeforeMutation = state.taskRuntimeReads
        await typeInto(titleInput, "Delayed metadata title")
        await click(await waitForElement(() => buttonByText(container, "Save"), "save delayed title button"))
        await waitForElement(() => (state.taskMetadataUpdateRuntimeRequests === 1 ? container : null), "delayed metadata update request")
        await click(await waitForElement(() => buttonByText(container, "Settings"), "settings tab during delayed metadata update"))
        await waitForElement(() => (container.textContent?.includes("Product Preferences") ? container : null), "settings screen")

        await act(async () => {
            metadataGate.resolve(undefined)
            await new Promise((resolve) => window.setTimeout(resolve, 50))
        })

        expect(state.task.title).toBe("Delayed metadata title")
        expect(state.taskRuntimeReads).toBe(taskReadsBeforeMutation)
        expect(container.textContent).toContain("Product Preferences")
        expect(container.textContent).not.toContain("Delayed metadata title")
    })

    it("does not show delayed metadata mutation failures after leaving the task shell scope", async () => {
        const state = seededTask()
        const metadataGate = createDeferredValue<void>()
        restoreClientConstructors = __setRemoteClientConstructorsForTest(
            createRuntimeBackedConstructors(state, {
                updateTaskMetadataDelay: metadataGate.promise,
                updateTaskMetadataError: "delayed metadata update failed",
            })
        )

        await act(async () => {
            root.render(createElement(RemoteApp))
        })

        await click(await waitForElement(() => buttonByText(container, "Runtime Repo"), "project row"))
        await click(await waitForElement(() => buttonByText(container, "Original task"), "task row"))
        const titleInput = await waitForElement(() => inputByValue(container, "Original task"), "task title input")
        await typeInto(titleInput, "Failed delayed metadata title")
        await click(await waitForElement(() => buttonByText(container, "Save"), "save delayed failing title button"))
        await waitForElement(() => (state.taskMetadataUpdateRuntimeRequests === 1 ? container : null), "delayed failing metadata update request")
        await click(await waitForElement(() => buttonByText(container, "Settings"), "settings tab during delayed failing metadata update"))
        await waitForElement(() => (container.textContent?.includes("Product Preferences") ? container : null), "settings screen")

        await act(async () => {
            metadataGate.resolve(undefined)
            await new Promise((resolve) => window.setTimeout(resolve, 50))
        })

        expect(state.task.title).toBe("Original task")
        expect(container.textContent).toContain("Product Preferences")
        expect(container.textContent).not.toContain("Unable to update task title")
        expect(container.textContent).not.toContain("delayed metadata update failed")
    })

    it("uploads shared composer images through the runtime product API before starting a turn", async () => {
        const state = seededTask()
        restoreClientConstructors = __setRemoteClientConstructorsForTest(createRuntimeBackedConstructors(state))

        await act(async () => {
            root.render(createElement(RemoteApp))
        })

        await click(await waitForElement(() => buttonByText(container, "Runtime Repo"), "project row"))
        await click(await waitForElement(() => buttonByText(container, "Original task"), "task row"))
        await waitForElement(() => (container.textContent?.includes("Describe this image") ? container : null), "initial task detail")
        const promptInput = await waitForElement(() => taskInputElement(container), "task prompt input")
        await waitForElement(() => buttonByLabel(container, "Attach image"), "task image attach button")

        await attachImage(container, tinyPngFile())
        await waitForElement(() => (state.taskImageWriteRuntimeRequests === 1 ? container : null), "task image write request")

        const written = state.taskImageWrites[0]
        expect(written).toMatchObject({
            ext: "png",
            mediaType: "image/png",
        })
        expect(written.imageId).toBeTruthy()
        expect(written.data.length).toBeGreaterThan(0)
        await waitForElement(() => container.querySelector(`img[src^="blob:"]`), "attached image preview")

        await typeIntoTaskInput(promptInput, "Run with the attached image")
        await click(
            await waitForElement(() => {
                const button = sendButtonForTaskInput(promptInput)
                return button && !button.disabled ? button : null
            }, "enabled image turn send button")
        )

        await waitForElement(() => (state.turnStarts.length === 1 ? container : null), "image turn start request")
        expect(state.turnStarts[0]).toMatchObject({
            repoId: "repo-1",
            inTaskId: "task-1",
            input: "Run with the attached image",
            images: [
                expect.objectContaining({
                    id: written.imageId,
                    ext: "png",
                    mediaType: "image/png",
                }),
            ],
        })
    })

    it("does not keep delayed new-task image attachments after leaving the new-task shell scope", async () => {
        const state = seededTask()
        const imageWriteGate = createDeferredValue<void>()
        restoreClientConstructors = __setRemoteClientConstructorsForTest(
            createRuntimeBackedConstructors(state, {
                writeTaskImageDelay: imageWriteGate.promise,
            })
        )

        await act(async () => {
            root.render(createElement(RemoteApp))
        })

        await click(await waitForElement(() => buttonByText(container, "Runtime Repo"), "project row"))
        await click(await waitForElement(() => buttonByText(container, "New"), "new task tab"))
        await waitForElement(() => buttonByLabel(container, "Attach image"), "new task image attach button")

        await attachImage(container, tinyPngFile())
        await waitForElement(() => (state.taskImageWriteRuntimeRequests === 1 ? container : null), "delayed new-task image write request")
        await click(await waitForElement(() => buttonByText(container, "Settings"), "settings tab during delayed image attach"))
        await waitForElement(() => (container.textContent?.includes("Product Preferences") ? container : null), "settings screen")

        await act(async () => {
            imageWriteGate.resolve(undefined)
            await new Promise((resolve) => window.setTimeout(resolve, 50))
        })

        expect(state.taskImageWrites).toHaveLength(1)
        await click(await waitForElement(() => buttonByText(container, "New"), "return to new task tab"))
        await waitForElement(() => buttonByText(container, "Create & Run"), "new task composer after delayed image")
        expect(container.querySelector(`img[src^="blob:"]`)).toBeNull()
        expect(state.turnStarts).toHaveLength(0)
    })

    it("does not expose image upload when image-write is granted without turn submit capability", async () => {
        const state = seededTask()
        restoreClientConstructors = __setRemoteClientConstructorsForTest(
            createRuntimeBackedConstructors(state, {
                permissions: [
                    "initialize",
                    "subscription/update",
                    "openade/snapshot/read",
                    "openade/task/read",
                    "openade/task/create",
                    "openade/task/image/write",
                ],
            })
        )

        await act(async () => {
            root.render(createElement(RemoteApp))
        })

        await click(await waitForElement(() => buttonByText(container, "Runtime Repo"), "project row"))
        await click(await waitForElement(() => buttonByText(container, "Original task"), "task row"))
        await waitForElement(() => (container.textContent?.includes("Describe this image") ? container : null), "task detail")
        expect(buttonByLabel(container, "Attach image")).toBeNull()
        expect(container.querySelector("input[type='file']")).toBeNull()

        await click(await waitForElement(() => buttonByText(container, "New"), "new task tab"))
        await waitForElement(() => (container.textContent?.includes("Create Task") ? container : null), "create-only new task composer")
        expect(buttonByLabel(container, "Attach image")).toBeNull()
        expect(container.querySelector("input[type='file']")).toBeNull()
        expect(state.taskImageWriteRuntimeRequests).toBe(0)
        expect(state.turnStarts).toHaveLength(0)
    })

    it("does not expose idle-task image upload when only queued turns can submit", async () => {
        const state = seededTask()
        restoreClientConstructors = __setRemoteClientConstructorsForTest(
            createRuntimeBackedConstructors(state, {
                permissions: [
                    "initialize",
                    "subscription/update",
                    "openade/snapshot/read",
                    "openade/task/read",
                    "openade/task/image/write",
                    "openade/queued-turn/enqueue",
                ],
            })
        )

        await act(async () => {
            root.render(createElement(RemoteApp))
        })

        await click(await waitForElement(() => buttonByText(container, "Runtime Repo"), "project row"))
        await click(await waitForElement(() => buttonByText(container, "Original task"), "idle task row"))
        await waitForElement(() => (container.textContent?.includes("Describe this image") ? container : null), "task detail")
        const promptInput = await waitForElement(() => taskInputElement(container), "task prompt input")

        expect(buttonByLabel(container, "Attach image")).toBeNull()
        expect(container.querySelector("input[type='file']")).toBeNull()
        await typeIntoTaskInput(promptInput, "This idle task cannot be queued")
        const sendButton = sendButtonForTaskInput(promptInput)
        expect(sendButton instanceof HTMLButtonElement ? sendButton.disabled : false).toBe(true)
        expect(state.taskImageWriteRuntimeRequests).toBe(0)
        expect(state.queuedTurnEnqueueRuntimeRequests).toBe(0)
        expect(state.turnStarts).toHaveLength(0)
    })

    it("sends selected HyperPlan strategy for existing task turns", async () => {
        const state = seededTask()
        restoreClientConstructors = __setRemoteClientConstructorsForTest(createRuntimeBackedConstructors(state))

        await act(async () => {
            root.render(createElement(RemoteApp))
        })

        await click(await waitForElement(() => buttonByText(container, "Runtime Repo"), "project row"))
        await click(await waitForElement(() => buttonByText(container, "Original task"), "task row"))
        await waitForElement(() => (container.textContent?.includes("Describe this image") ? container : null), "initial task detail")
        const promptInput = await waitForElement(() => taskInputElement(container), "task prompt input")
        await typeIntoTaskInput(promptInput, "Run a multi-agent pass in the existing task")
        await click(await waitForElement(() => buttonByText(container, "HyperPlan"), "hyperplan command"))
        await click(await waitForElement(() => buttonByText(container, "Cross Review"), "cross-review strategy"))
        await click(
            await waitForElement(() => {
                const button = sendButtonForTaskInput(promptInput)
                return button && !button.disabled ? button : null
            }, "enabled existing hyperplan send button")
        )

        await waitForElement(() => (state.turnStarts.length === 1 ? container : null), "existing hyperplan start request")
        expect(state.turnStarts[0]).toMatchObject({
            repoId: "repo-1",
            inTaskId: "task-1",
            type: "hyperplan",
            input: "Run a multi-agent pass in the existing task",
            hyperplanStrategy: {
                id: "cross-review",
                terminalStepId: "reconcile_0",
            },
        })
        expect(state.turnStarts[0].hyperplanStrategy?.steps.map((step) => step.primitive)).toEqual(["plan", "plan", "review", "review", "reconcile"])
    })

    it("retries failed task turns through the shared runtime startTurn path", async () => {
        const state = seededTask()
        state.task.events = [
            ...state.task.events,
            {
                id: "event-failed",
                type: "action",
                status: "error",
                createdAt: now,
                userInput: "Previous failing run",
                source: { type: "do", userLabel: "Do" },
            },
        ]
        restoreClientConstructors = __setRemoteClientConstructorsForTest(createRuntimeBackedConstructors(state))

        await act(async () => {
            root.render(createElement(RemoteApp))
        })

        await click(await waitForElement(() => buttonByText(container, "Runtime Repo"), "project row"))
        await click(await waitForElement(() => buttonByText(container, "Original task"), "task row"))
        await waitForElement(() => (container.textContent?.includes("Previous failing run") ? container : null), "failed task detail")
        await click(await waitForElement(() => buttonByTitle(container, "Retry"), "retry task button"))

        await waitForElement(() => (state.turnStarts.length === 1 ? container : null), "retry turn start request")
        expect(state.turnStarts[0]).toMatchObject({
            repoId: "repo-1",
            inTaskId: "task-1",
            type: "do",
            input: ACTION_PROMPTS.retry,
            harnessId: DEFAULT_HARNESS_ID,
            modelId: getVisibleModelId(getDefaultModelForHarness(DEFAULT_HARNESS_ID), DEFAULT_HARNESS_ID),
            thinking: "max",
            fastMode: false,
            label: "Retry",
            includeComments: false,
        })
    })

    it("cancels active plans through the shared task metadata runtime path", async () => {
        const state = seededTask()
        state.task.events = [
            ...state.task.events,
            {
                id: "event-plan",
                type: "action",
                status: "completed",
                createdAt: now,
                userInput: "Plan the implementation",
                source: { type: "plan", userLabel: "Plan" },
            },
        ]
        restoreClientConstructors = __setRemoteClientConstructorsForTest(createRuntimeBackedConstructors(state))

        await act(async () => {
            root.render(createElement(RemoteApp))
        })

        await click(await waitForElement(() => buttonByText(container, "Runtime Repo"), "project row"))
        await click(await waitForElement(() => buttonByText(container, "Original task"), "task row"))
        await waitForElement(() => (container.textContent?.includes("Plan the implementation") ? container : null), "planned task detail")
        expect(buttonByText(container, "Run Plan")).toBeTruthy()
        expect(buttonByText(container, "Revise Plan")).toBeTruthy()
        await click(await waitForElement(() => buttonByText(container, "Cancel Plan"), "cancel plan button"))

        await waitForElement(() => (state.task.cancelledPlanEventId === "event-plan" ? container : null), "cancelled plan metadata")
        expect(buttonByText(container, "Cancel Plan")).toBeNull()
        expect(buttonByText(container, "Run Plan")).toBeNull()
        expect(buttonByText(container, "Revise Plan")).toBeNull()
    })

    it("enqueues running task turns through the explicit queued-turn runtime method", async () => {
        const state = seededTask()
        state.workingTaskIds = ["task-1"]
        restoreClientConstructors = __setRemoteClientConstructorsForTest(createRuntimeBackedConstructors(state))

        await act(async () => {
            root.render(createElement(RemoteApp))
        })

        await click(await waitForElement(() => buttonByText(container, "Runtime Repo"), "project row"))
        await click(await waitForElement(() => buttonByText(container, "Original task"), "running task row"))
        await waitForElement(() => (container.textContent?.includes("Describe this image") ? container : null), "running task detail")
        const promptInput = await waitForElement(() => taskInputElement(container), "task prompt input")
        await typeIntoTaskInput(promptInput, "Queue this behind the active run")
        const snapshotReadsBeforeSend = state.snapshotRuntimeReads
        const taskReadsBeforeSend = state.taskRuntimeReads
        await click(
            await waitForElement(() => {
                const button = sendButtonForTaskInput(promptInput)
                return button && !button.disabled ? button : null
            }, "enabled queued turn button")
        )

        await waitForElement(() => (state.queuedTurnEnqueueRuntimeRequests === 1 ? container : null), "queued-turn enqueue request")
        expect(state.turnStarts).toHaveLength(0)
        expect(state.snapshotRuntimeReads).toBe(snapshotReadsBeforeSend)
        expect(state.taskRuntimeReads).toBe(taskReadsBeforeSend)
        expect(state.queuedTurn).toMatchObject({
            type: "do",
            input: "Queue this behind the active run",
            harnessId: DEFAULT_HARNESS_ID,
            modelId: getVisibleModelId(getDefaultModelForHarness(DEFAULT_HARNESS_ID), DEFAULT_HARNESS_ID),
            thinking: "max",
            fastMode: false,
        })
        expect(container.textContent).toContain("Queued. It will run after the current turn finishes.")
    })

    it("enqueues selected HyperPlan strategy while the current task is running", async () => {
        const state = seededTask()
        state.workingTaskIds = ["task-1"]
        restoreClientConstructors = __setRemoteClientConstructorsForTest(createRuntimeBackedConstructors(state))

        await act(async () => {
            root.render(createElement(RemoteApp))
        })

        await click(await waitForElement(() => buttonByText(container, "Runtime Repo"), "project row"))
        await click(await waitForElement(() => buttonByText(container, "Original task"), "running task row"))
        await waitForElement(() => (container.textContent?.includes("Describe this image") ? container : null), "running task detail")
        const promptInput = await waitForElement(() => taskInputElement(container), "task prompt input")
        await typeIntoTaskInput(promptInput, "Queue a multi-agent pass")
        await click(await waitForElement(() => buttonByText(container, "HyperPlan"), "hyperplan command"))
        await click(await waitForElement(() => buttonByText(container, "Cross Review"), "cross-review strategy"))
        await click(
            await waitForElement(() => {
                const button = sendButtonForTaskInput(promptInput)
                return button && !button.disabled ? button : null
            }, "enabled queued hyperplan button")
        )

        await waitForElement(() => (state.queuedTurnEnqueueRuntimeRequests === 1 ? container : null), "queued hyperplan request")
        expect(state.turnStarts).toHaveLength(0)
        expect(state.queuedTurn).toMatchObject({
            type: "hyperplan",
            input: "Queue a multi-agent pass",
            hyperplanStrategy: {
                id: "cross-review",
                terminalStepId: "reconcile_0",
            },
        })
        expect(state.queuedTurn.hyperplanStrategy?.steps.map((step) => step.primitive)).toEqual(["plan", "plan", "review", "review", "reconcile"])
    })

    it("hides task terminal controls when runtime capabilities do not grant terminal methods", async () => {
        const state = seededTask()
        restoreClientConstructors = __setRemoteClientConstructorsForTest(
            createRuntimeBackedConstructors(state, {
                permissions: [
                    "initialize",
                    "subscription/update",
                    "openade/snapshot/read",
                    "openade/task/read",
                    "openade/project/files/tree",
                    "openade/task/image/read",
                ],
            })
        )

        await act(async () => {
            root.render(createElement(RemoteApp))
        })

        await click(await waitForElement(() => buttonByText(container, "Runtime Repo"), "project row"))
        expect(hasButtonExactText(container, "New")).toBe(false)
        await click(await waitForElement(() => buttonByText(container, "Original task"), "task row"))
        await waitForElement(() => (container.textContent?.includes("Describe this image") ? container : null), "task detail")

        const titleInput = await waitForElement(() => inputByValue(container, "Original task"), "task title input")
        expect(titleInput.disabled).toBe(true)
        const promptInput = await waitForElement(() => taskInputElement(container), "task prompt input")
        await typeIntoTaskInput(promptInput, "Denied turn start")
        const sendButton = sendButtonForTaskInput(promptInput)
        expect(sendButton instanceof HTMLButtonElement ? sendButton.disabled : false).toBe(true)
        expect(buttonByText(container, "Open Terminal")).toBeNull()
        expect(buttonByText(container, "Delete")).toBeNull()
        expect(buttonByText(container, "Save")).toBeNull()
        expect(buttonByText(container, "Generate")).toBeNull()
        expect(buttonByText(container, "Prepare Environment")).toBeNull()
        expect(buttonByText(container, "Close")).toBeNull()
        expect(buttonByText(container, "Review Work")).toBeNull()
        expect(buttonByText(container, "Add")).toBeNull()
        expect(buttonByText(container, "Cancel")).toBeNull()
        expect(buttonByLabel(container, "Attach image")).toBeNull()
        expect(buttonByTitle(container, "Move queued turn down")).toBeNull()
        expect(buttonByText(container, "Load Changes")).toBeNull()
        expect(buttonByText(container, "Commit")).toBeNull()
        expect(buttonByText(container, "Patch")).toBeNull()
        expect(container.textContent).not.toContain("Resources")
        expect(state.turnStarts).toHaveLength(0)
        expect(state.reviewStarts).toHaveLength(0)
        expect(state.taskTerminalReconnectRuntimeRequests).toBe(0)
        expect(state.taskTerminalStartRuntimeRequests).toBe(0)
        expect(state.taskChangesRuntimeReads).toBe(0)
        expect(state.taskGitLogRuntimeReads).toBe(0)
        expect(state.taskGitSummaryRuntimeReads).toBe(0)
        expect(state.taskGitScopesRuntimeReads).toBe(0)
        expect(state.taskGitCommitRuntimeRequests).toBe(0)
        expect(state.taskSnapshotPatchRuntimeReads).toBe(0)
        expect(state.taskResourceInventoryRuntimeReads).toBe(0)
        expect(state.taskImageWriteRuntimeRequests).toBe(0)
        expect(state.taskTitleGenerateRuntimeRequests).toBe(0)
        expect(state.taskEnvironmentPrepareRuntimeRequests).toBe(0)
        expect(state.projectFileWriteRuntimeRequests).toBe(0)

        await click(await waitForElement(() => buttonByText(container, "Settings"), "settings tab without self revoke permission"))
        expect(buttonByText(container, "Revoke This Device")).toBeNull()
        expect(state.selfRevoked).toBe(false)
    })

    it("opens reconnect-only task terminals without issuing denied terminal mutations", async () => {
        const state = seededTask()
        restoreClientConstructors = __setRemoteClientConstructorsForTest(
            createRuntimeBackedConstructors(state, {
                permissions: ["initialize", "subscription/update", "openade/snapshot/read", "openade/task/read", "openade/task/terminal/reconnect"],
            })
        )

        await act(async () => {
            root.render(createElement(RemoteApp))
        })

        await click(await waitForElement(() => buttonByText(container, "Runtime Repo"), "project row"))
        await click(await waitForElement(() => buttonByText(container, "Original task"), "task row"))
        await waitForElement(() => (container.textContent?.includes("Describe this image") ? container : null), "task detail")

        expect(buttonByText(container, "Open Terminal")).toBeTruthy()
        await click(await waitForElement(() => buttonByText(container, "Open Terminal"), "open reconnect-only task terminal"))
        await waitForElement(() => (state.taskTerminalReconnectRuntimeRequests === 1 ? container : null), "task terminal reconnect-only runtime request")

        expect(buttonByText(container, "Restart")).toBeNull()
        expect(state.taskTerminalStartRuntimeRequests).toBe(0)
        expect(state.taskTerminalWriteRuntimeRequests).toBe(0)
        expect(state.taskTerminalResizeRuntimeRequests).toBe(0)
        expect(state.taskTerminalStopRuntimeRequests).toBe(0)
    })

    it("creates a task without starting execution when only task-create is granted", async () => {
        const state = seededTask()
        restoreClientConstructors = __setRemoteClientConstructorsForTest(
            createRuntimeBackedConstructors(state, {
                permissions: [
                    "initialize",
                    "subscription/update",
                    "openade/snapshot/read",
                    "openade/task/read",
                    "openade/task/create",
                    "openade/settings/mcpServers/read",
                    "openade/project/sdkCapabilities/read",
                ],
            })
        )

        await act(async () => {
            root.render(createElement(RemoteApp))
        })

        await waitForElement(() => buttonByText(container, "Runtime Repo"), "runtime project")
        await click(await waitForElement(() => buttonByText(container, "New"), "new task tab"))
        const titleInput = await waitForElement(() => inputByPlaceholder(container, "Optional title"), "new task title input")
        const promptInput = await waitForElement(() => taskInputElement(container), "new task prompt input")
        expect(state.mcpServersReadRuntimeRequests).toBe(0)
        await click(await waitForElement(() => buttonByTitle(container, "Load MCP connectors"), "create-only new task mcp load"))
        await waitForElement(() => buttonByText(container, "Runtime MCP"), "create-only new task mcp selector")
        expect(state.mcpServersReadRuntimeRequests).toBe(1)
        await click(await waitForElement(() => buttonByText(container, "Runtime MCP"), "create-only new task mcp selector"))
        await typeInto(titleInput, "Remote draft task")
        await typeIntoTaskInput(promptInput, "Capture this without execution")

        expect(buttonByText(container, "Create Task")).toBeTruthy()
        expect(container.textContent).not.toContain("Ask")
        expect(buttonByText(container, "Load Branches")).toBeNull()
        await click(
            await waitForElement(() => {
                const button = buttonByText(container, "Create Task")
                return button && !button.disabled ? button : null
            }, "enabled create-only task button")
        )

        await waitForElement(() => (state.taskCreateRuntimeRequests === 1 ? container : null), "task create runtime request")
        expect(state.turnStarts).toHaveLength(0)
        expect(state.mcpServersReadRuntimeRequests).toBe(1)
        expect(state.projectSdkCapabilitiesRuntimeReads).toBe(0)
        expect(state.projectGitBranchesRuntimeReads).toBe(0)
        expect(state.taskRuntimeReads).toBe(0)
        expect(state.task).toMatchObject({
            id: "task-created",
            title: "Remote draft task",
            description: "Capture this without execution",
            enabledMcpServerIds: ["mcp-runtime"],
        })
        expect(container.textContent).toContain("Task created.")
        expect(container.textContent).toContain("Remote draft task")
    })

    it("creates a project through the runtime product API when repo-create is granted", async () => {
        const state = seededTask()
        restoreClientConstructors = __setRemoteClientConstructorsForTest(createRuntimeBackedConstructors(state))

        await act(async () => {
            root.render(createElement(RemoteApp))
        })

        await waitForElement(() => buttonByText(container, "Runtime Repo"), "runtime project")
        await click(await waitForElement(() => lastButtonByExactText(container, "Project"), "create project toggle"))
        const nameInput = await waitForElement(() => inputByPlaceholder(container, "Project name"), "project name input")
        const pathInput = await waitForElement(() => inputByPlaceholder(container, "/path/to/project"), "project path input")
        await typeInto(nameInput, "Created Runtime Project")
        await typeInto(pathInput, "/tmp/created-runtime-project")
        await click(await waitForElement(() => buttonByText(container, "Create"), "create project button"))

        await waitForElement(() => (state.repoPathInspectRuntimeRequests === 1 ? container : null), "repo path inspect runtime request")
        await waitForElement(() => (state.repoCreateRuntimeRequests === 1 ? container : null), "repo create runtime request")
        await waitForElement(() => (container.textContent?.includes("Created Runtime Project") ? container : null), "created project screen")
        expect(container.textContent).toContain("/tmp/created-runtime-project")
        expect(container.textContent).toContain("Project added.")
        expect(state.taskRuntimeReads).toBe(0)
        expect(state.projectFileTreeRuntimeReads).toBe(0)
        expect(state.processListRuntimeReads).toBe(0)
    })

    it("does not navigate from a delayed project create after leaving the projects shell scope", async () => {
        const state = seededTask()
        const createGate = createDeferredValue<void>()
        restoreClientConstructors = __setRemoteClientConstructorsForTest(
            createRuntimeBackedConstructors(state, {
                createRepoDelay: createGate.promise,
            })
        )

        await act(async () => {
            root.render(createElement(RemoteApp))
        })

        await waitForElement(() => buttonByText(container, "Runtime Repo"), "runtime project")
        await click(await waitForElement(() => lastButtonByExactText(container, "Project"), "create project toggle"))
        await typeInto(await waitForElement(() => inputByPlaceholder(container, "Project name"), "project name input"), "Delayed Runtime Project")
        await typeInto(await waitForElement(() => inputByPlaceholder(container, "/path/to/project"), "project path input"), "/tmp/delayed-runtime-project")
        await click(await waitForElement(() => buttonByText(container, "Create"), "create project button"))
        await waitForElement(() => (state.repoCreateRuntimeRequests === 1 ? container : null), "delayed repo create runtime request")
        await click(await waitForElement(() => buttonByText(container, "Settings"), "settings tab during delayed project create"))
        await waitForElement(() => (container.textContent?.includes("Product Preferences") ? container : null), "settings screen")

        await act(async () => {
            createGate.resolve(undefined)
            await new Promise((resolve) => window.setTimeout(resolve, 50))
        })

        expect(container.textContent).toContain("Product Preferences")
        expect(container.textContent).not.toContain("Project added.")
        expect(container.textContent).not.toContain("Delayed Runtime Project")
    })

    it("updates, archives, and deletes projects through the runtime product API when granted", async () => {
        const state = seededTask()
        restoreClientConstructors = __setRemoteClientConstructorsForTest(createRuntimeBackedConstructors(state))
        vi.spyOn(window, "confirm").mockReturnValue(true)

        await act(async () => {
            root.render(createElement(RemoteApp))
        })

        await click(await waitForElement(() => buttonByText(container, "Runtime Repo"), "project row"))
        await click(await waitForElement(() => buttonByText(container, "Manage"), "project management"))
        await typeInto(await waitForElement(() => inputByValue(container, "Runtime Repo"), "project name input"), "Renamed Runtime Repo")
        await typeInto(await waitForElement(() => inputByValue(container, "/tmp/openade-runtime-repo"), "project path input"), "/tmp/renamed-runtime-repo")
        await click(await waitForElement(() => buttonByText(container, "Save"), "save project"))

        await waitForElement(() => (state.repoUpdateRuntimeRequests === 1 ? container : null), "repo update runtime request")
        await waitForElement(() => (container.textContent?.includes("Renamed Runtime Repo") ? container : null), "renamed project")
        expect(container.textContent).toContain("/tmp/renamed-runtime-repo")
        expect(container.textContent).toContain("Project updated.")

        await click(await waitForElement(() => buttonByText(container, "Manage"), "project management after rename"))
        await click(await waitForElement(() => buttonByText(container, "Archive"), "archive project"))
        await waitForElement(() => (state.repoUpdateRuntimeRequests === 2 ? container : null), "repo archive runtime request")
        await waitForElement(() => (container.textContent?.includes("Archived") ? container : null), "archived badge")
        expect(container.textContent).toContain("Project archived.")

        await click(await waitForElement(() => buttonByText(container, "Delete"), "delete project"))
        await waitForElement(() => (state.repoDeleteRuntimeRequests === 1 ? container : null), "repo delete runtime request")
        await waitForElement(() => (container.textContent?.includes("Project deleted.") ? container : null), "deleted project notice")
        expect(container.textContent).not.toContain("Renamed Runtime Repo")
        expect(state.taskRuntimeReads).toBe(0)
        expect(state.projectFileTreeRuntimeReads).toBe(0)
        expect(state.processListRuntimeReads).toBe(0)
    })

    it("does not show delayed project update failures after leaving the project shell scope", async () => {
        const state = seededTask()
        const updateGate = createDeferredValue<void>()
        restoreClientConstructors = __setRemoteClientConstructorsForTest(
            createRuntimeBackedConstructors(state, {
                updateRepoDelay: updateGate.promise,
                updateRepoError: "delayed project update failed",
            })
        )

        await act(async () => {
            root.render(createElement(RemoteApp))
        })

        await click(await waitForElement(() => buttonByText(container, "Runtime Repo"), "project row"))
        await click(await waitForElement(() => buttonByText(container, "Manage"), "project management"))
        await typeInto(await waitForElement(() => inputByValue(container, "Runtime Repo"), "project name input"), "Delayed Rename")
        await click(await waitForElement(() => buttonByText(container, "Save"), "save delayed project update"))
        await waitForElement(() => (state.repoUpdateRuntimeRequests === 1 ? container : null), "delayed repo update runtime request")
        await click(await waitForElement(() => buttonByText(container, "Settings"), "settings tab during delayed project update"))
        await waitForElement(() => (container.textContent?.includes("Product Preferences") ? container : null), "settings screen")

        await act(async () => {
            updateGate.resolve(undefined)
            await new Promise((resolve) => window.setTimeout(resolve, 50))
        })

        expect(container.textContent).toContain("Product Preferences")
        expect(container.textContent).not.toContain("Unable to update project")
        expect(container.textContent).not.toContain("delayed project update failed")
    })

    it("keeps paired project process output while hiding denied start and stop controls", async () => {
        const state = seededTask()
        state.processRunning = true
        restoreClientConstructors = __setRemoteClientConstructorsForTest(
            createRuntimeBackedConstructors(state, {
                permissions: [
                    "initialize",
                    "subscription/update",
                    "openade/snapshot/read",
                    "openade/project/files/tree",
                    "openade/project/process/list",
                    "openade/project/process/reconnect",
                ],
            })
        )

        await act(async () => {
            root.render(createElement(RemoteApp))
        })

        await click(await waitForElement(() => buttonByText(container, "Runtime Repo"), "project row"))
        expect(lastButtonByExactText(container, "Project")).toBeNull()
        expect(buttonByText(container, "Manage")).toBeNull()
        expect(buttonByText(container, "Runtime MCP")).toBeNull()
        expect(buttonByText(container, "Load Git")).toBeNull()
        expect(buttonByText(container, "Load Crons")).toBeNull()
        await click(await waitForElement(() => buttonByText(container, "Load Processes"), "load project processes"))
        await waitForElement(() => (container.textContent?.includes("Phone Echo") ? container : null), "project process")

        expect(buttonByText(container, "Output")).toBeTruthy()
        expect(buttonByText(container, "Start")).toBeNull()
        expect(buttonByText(container, "Stop")).toBeNull()

        await click(await waitForElement(() => buttonByText(container, "Output"), "process output button"))
        await waitForElement(() => (container.textContent?.includes("phone process output") ? container : null), "process output")

        expect(state.processListRuntimeReads).toBe(1)
        expect(state.processReconnectRuntimeRequests).toBe(1)
        expect(state.processStartRuntimeRequests).toBe(0)
        expect(state.processStopRuntimeRequests).toBe(0)
        expect(state.repoCreateRuntimeRequests).toBe(0)
        expect(state.repoUpdateRuntimeRequests).toBe(0)
        expect(state.repoDeleteRuntimeRequests).toBe(0)
        expect(state.mcpServersReadRuntimeRequests).toBe(0)
    })

    it("does not repaint project process state from a delayed start after leaving the project shell scope", async () => {
        const state = seededTask()
        const processStartGate = createDeferredValue<void>()
        restoreClientConstructors = __setRemoteClientConstructorsForTest(
            createRuntimeBackedConstructors(state, {
                startProjectProcessDelay: processStartGate.promise,
            })
        )

        await act(async () => {
            root.render(createElement(RemoteApp))
        })

        await click(await waitForElement(() => buttonByText(container, "Runtime Repo"), "project row"))
        await click(await waitForElement(() => buttonByText(container, "Load Processes"), "load project processes"))
        await waitForElement(() => (container.textContent?.includes("Phone Echo") ? container : null), "loaded project process")
        await click(await waitForElement(() => buttonByText(container, "Start"), "start delayed project process"))
        await waitForElement(() => (state.processStartRuntimeRequests === 1 ? container : null), "delayed project process start request")
        await click(await waitForElement(() => buttonByText(container, "Settings"), "settings tab during delayed project process start"))
        await waitForElement(() => (container.textContent?.includes("Product Preferences") ? container : null), "settings screen")

        await act(async () => {
            processStartGate.resolve(undefined)
            await new Promise((resolve) => window.setTimeout(resolve, 50))
        })

        expect(state.processRunning).toBe(true)
        expect(container.textContent).toContain("Product Preferences")
        expect(container.textContent).not.toContain("Phone Echo")
        expect(container.textContent).not.toContain("Running")

        await click(await waitForElement(() => buttonByText(container, "Projects"), "projects tab after delayed project process start"))
        await click(await waitForElement(() => buttonByText(container, "Runtime Repo"), "return to project after delayed process start"))
        await waitForElement(() => buttonByText(container, "Load Processes"), "unloaded process panel after delayed start")
        expect(container.textContent).toContain("Not loaded.")
        expect(container.textContent).not.toContain("Running")
        expect(state.processStartRuntimeRequests).toBe(1)
        expect(state.processListRuntimeReads).toBe(1)
    })

    it("does not keep delayed project file action state after leaving the project shell scope", async () => {
        const state = seededTask()
        const fileReadGate = createDeferredValue<void>()
        restoreClientConstructors = __setRemoteClientConstructorsForTest(
            createRuntimeBackedConstructors(state, {
                readProjectFileDelay: fileReadGate.promise,
            })
        )

        await act(async () => {
            root.render(createElement(RemoteApp))
        })

        await click(await waitForElement(() => buttonByText(container, "Runtime Repo"), "project row"))
        await click(await waitForElement(() => buttonByText(container, "Load Files"), "load project files"))
        await waitForElement(() => buttonByText(container, "README.md"), "project file row")
        await click(await waitForElement(() => buttonByText(container, "README.md"), "start delayed project file read"))
        await waitForElement(() => {
            const button = buttonByText(container, "README.md")
            return button?.disabled === true ? button : null
        }, "delayed project file read marker")
        await click(await waitForElement(() => buttonByText(container, "Settings"), "settings tab during delayed project file read"))
        await waitForElement(() => (container.textContent?.includes("Product Preferences") ? container : null), "settings screen")

        await act(async () => {
            fileReadGate.resolve(undefined)
            await new Promise((resolve) => window.setTimeout(resolve, 50))
        })

        expect(container.textContent).toContain("Product Preferences")
        expect(container.textContent).not.toContain("remote project file")

        await click(await waitForElement(() => buttonByText(container, "Projects"), "projects tab after delayed project file read"))
        await click(await waitForElement(() => buttonByText(container, "Runtime Repo"), "return to project after delayed project file read"))
        await click(await waitForElement(() => buttonByText(container, "Load Files"), "reload project files after delayed read"))
        const readmeAfterReturn = await waitForElement(() => buttonByText(container, "README.md"), "project file row after delayed read")
        expect(readmeAfterReturn.disabled).toBe(false)
        expect(container.querySelector('textarea[aria-label="File contents"]')).toBeNull()
    })

    it("loads only granted project git methods for partial git capability profiles", async () => {
        const state = seededTask()
        restoreClientConstructors = __setRemoteClientConstructorsForTest(
            createRuntimeBackedConstructors(state, {
                permissions: ["initialize", "subscription/update", "openade/snapshot/read", "openade/project/git/summary/read"],
            })
        )

        await act(async () => {
            root.render(createElement(RemoteApp))
        })

        await click(await waitForElement(() => buttonByText(container, "Runtime Repo"), "project row"))
        await click(await waitForElement(() => buttonByText(container, "Load Git"), "load summary-only project git"))
        await waitForElement(() => (container.textContent?.includes("1 changed file") ? container : null), "summary-only project git")

        expect(container.textContent).toContain("abc123")
        expect(state.projectGitSummaryRuntimeReads).toBe(1)
        expect(state.projectGitInfoRuntimeReads).toBe(0)
        expect(state.projectGitBranchesRuntimeReads).toBe(0)
        expect(state.projectFileTreeRuntimeReads).toBe(0)
        expect(state.processListRuntimeReads).toBe(0)
        expect(state.taskRuntimeReads).toBe(0)
    })

    it("opens a task without eager host-side panel reads", async () => {
        const state = seededTask()
        restoreClientConstructors = __setRemoteClientConstructorsForTest(createRuntimeBackedConstructors(state))

        await act(async () => {
            root.render(createElement(RemoteApp))
        })

        await click(await waitForElement(() => buttonByText(container, "Runtime Repo"), "project row"))
        await waitForElement(() => (container.textContent?.includes("Original task") ? container : null), "project task list")

        expect(state.taskRuntimeReads).toBe(0)
        expect(state.projectSdkCapabilitiesRuntimeReads).toBe(0)
        expect(state.projectGitInfoRuntimeReads).toBe(0)
        expect(state.projectGitBranchesRuntimeReads).toBe(0)
        expect(state.projectGitSummaryRuntimeReads).toBe(0)
        expect(state.projectCronDefinitionsRuntimeReads).toBe(0)
        expect(state.projectCronInstallStateRuntimeReads).toBe(0)
        expect(state.projectFileTreeRuntimeReads).toBe(0)
        expect(state.projectFileFuzzySearchRuntimeReads).toBe(0)
        expect(state.processListRuntimeReads).toBe(0)

        await click(await waitForElement(() => buttonByText(container, "Original task"), "task row"))
        await waitForElement(() => (container.textContent?.includes("Describe this image") ? container : null), "task detail")

        expect(state.taskRuntimeReads).toBe(1)
        expect(state.taskReadRequests).toEqual([{ repoId: "repo-1", taskId: "task-1", hydrateSessionEvents: false, eventLimit: 12 }])
        expect(state.projectSdkCapabilitiesRuntimeReads).toBe(0)
        expect(state.projectGitInfoRuntimeReads).toBe(0)
        expect(state.projectGitBranchesRuntimeReads).toBe(0)
        expect(state.projectGitSummaryRuntimeReads).toBe(0)
        expect(state.projectCronDefinitionsRuntimeReads).toBe(0)
        expect(state.projectCronInstallStateRuntimeReads).toBe(0)
        expect(state.projectFileTreeRuntimeReads).toBe(0)
        expect(state.projectFileFuzzySearchRuntimeReads).toBe(0)
        expect(state.processListRuntimeReads).toBe(0)
        expect(state.taskChangesRuntimeReads).toBe(0)
        expect(state.taskGitLogRuntimeReads).toBe(0)
        expect(state.taskGitSummaryRuntimeReads).toBe(0)
        expect(state.taskGitScopesRuntimeReads).toBe(0)
        expect(state.taskFilePairRuntimeReads).toBe(0)
        expect(state.taskDiffRuntimeReads).toBe(0)
        expect(state.taskGitCommitFilesRuntimeReads).toBe(0)
        expect(state.taskGitFileAtTreeishRuntimeReads).toBe(0)
        expect(state.taskGitCommitFilePatchRuntimeReads).toBe(0)
        expect(state.taskSnapshotPatchRuntimeReads).toBe(0)
        expect(state.taskSnapshotIndexRuntimeReads).toBe(0)
        expect(state.taskSnapshotPatchSliceRuntimeReads).toBe(0)
        expect(state.taskResourceInventoryRuntimeReads).toBe(0)
        expect(state.taskTerminalReconnectRuntimeRequests).toBe(0)
        expect(state.taskTerminalStartRuntimeRequests).toBe(0)
    })

    it("loads only granted task git methods for partial git capability profiles", async () => {
        const state = seededTask()
        restoreClientConstructors = __setRemoteClientConstructorsForTest(
            createRuntimeBackedConstructors(state, {
                permissions: ["initialize", "subscription/update", "openade/snapshot/read", "openade/task/read", "openade/task/git/summary/read"],
            })
        )

        await act(async () => {
            root.render(createElement(RemoteApp))
        })

        await click(await waitForElement(() => buttonByText(container, "Runtime Repo"), "project row"))
        await click(await waitForElement(() => buttonByText(container, "Original task"), "task row"))
        await waitForElement(() => (container.textContent?.includes("Describe this image") ? container : null), "task detail")
        await click(await waitForElement(() => buttonByText(container, "Load Git"), "load summary-only task git"))
        await waitForElement(() => (container.textContent?.includes("1 changed file") ? container : null), "summary-only task git")

        expect(container.textContent).toContain("abc123")
        expect(container.textContent).not.toContain("src/app.ts")
        expect(state.taskRuntimeReads).toBe(1)
        expect(state.taskGitSummaryRuntimeReads).toBe(1)
        expect(state.taskChangesRuntimeReads).toBe(0)
        expect(state.taskGitLogRuntimeReads).toBe(0)
        expect(state.taskGitScopesRuntimeReads).toBe(0)
        expect(state.taskFilePairRuntimeReads).toBe(0)
        expect(state.taskDiffRuntimeReads).toBe(0)
        expect(state.taskGitCommitFilesRuntimeReads).toBe(0)
        expect(state.projectFileTreeRuntimeReads).toBe(0)
        expect(state.processListRuntimeReads).toBe(0)
    })

    it("drives task metadata, comments, queued turns, review, and delete through a real runtime client", async () => {
        const state = seededTask()
        restoreClientConstructors = __setRemoteClientConstructorsForTest(createRuntimeBackedConstructors(state))
        vi.spyOn(window, "confirm").mockReturnValue(true)

        await act(async () => {
            root.render(createElement(RemoteApp))
        })

        await click(await waitForElement(() => buttonByText(container, "Runtime Repo"), "project row"))
        await waitForElement(() => (container.textContent?.includes("Original task") ? container : null), "project task list")
        expect(state.projectFileTreeRuntimeReads).toBe(0)
        expect(state.projectFileFuzzySearchRuntimeReads).toBe(0)
        expect(state.projectGitInfoRuntimeReads).toBe(0)
        expect(state.projectGitBranchesRuntimeReads).toBe(0)
        expect(state.projectGitSummaryRuntimeReads).toBe(0)
        expect(state.projectCronDefinitionsRuntimeReads).toBe(0)
        expect(state.projectCronInstallStateRuntimeReads).toBe(0)
        expect(state.projectCronInstallStateReplaceRuntimeRequests).toBe(0)
        expect(state.projectCronRunRuntimeRequests).toBe(0)
        expect(state.processListRuntimeReads).toBe(0)
        await click(await waitForElement(() => buttonByText(container, "Load Git"), "load project git"))
        await waitForElement(() => (container.textContent?.includes("1 changed file") ? container : null), "project git summary")
        expect(container.textContent).toContain("abc123")
        expect(state.projectGitInfoRuntimeReads).toBe(1)
        expect(state.projectGitBranchesRuntimeReads).toBe(1)
        expect(state.projectGitSummaryRuntimeReads).toBe(1)
        await click(await waitForElement(() => buttonByText(container, "Load Crons"), "load project crons"))
        await waitForElement(() => (container.textContent?.includes("Nightly") ? container : null), "project cron")
        expect(container.textContent).toContain("0 1 * * *")
        expect(state.projectCronDefinitionsRuntimeReads).toBe(1)
        expect(state.projectCronInstallStateRuntimeReads).toBe(1)
        expect(container.textContent).toContain("Enabled")
        await click(await waitForElement(() => buttonByText(container, "Pause"), "pause project cron"))
        await waitForElement(() => (state.projectCronInstallStateReplaceRuntimeRequests === 1 ? container : null), "project cron install-state replace")
        expect(state.projectCronInstallations["openade.toml::Nightly"]).toMatchObject({
            cronId: "openade.toml::Nightly",
            enabled: false,
            installedAt: "2026-05-31T00:00:00.000Z",
            lastTaskId: "task-1",
        })
        await click(await waitForElement(() => buttonByText(container, "Run"), "run project cron"))
        await waitForElement(() => (state.projectCronRunRuntimeRequests === 1 ? container : null), "project cron run request")
        expect(state.cronRuns).toMatchObject([{ repoId: "repo-1", cronId: "openade.toml::Nightly" }])
        expect(state.projectCronInstallations["openade.toml::Nightly"]).toMatchObject({
            cronId: "openade.toml::Nightly",
            enabled: false,
            installedAt: "2026-05-31T00:00:00.000Z",
            lastRunAt: "2026-05-31T00:00:00.000Z",
            lastTaskId: "task-cron-run",
        })
        expect(container.textContent).toContain("Cron started")
        const fileSearchInput = await waitForElement(() => inputByPlaceholder(container, "Find file"), "project file search input")
        await typeInto(fileSearchInput, "remote")
        await click(await waitForElement(() => buttonByText(container, "Find"), "project file search button"))
        await waitForElement(() => (state.projectFileFuzzySearchRuntimeReads === 1 ? container : null), "project file fuzzy-search runtime read")
        await waitForElement(() => (container.textContent?.includes("README.md") ? container : null), "project file fuzzy-search result")
        expect(state.projectFileTreeRuntimeReads).toBe(0)
        await click(await waitForElement(() => buttonByText(container, "README.md"), "read fuzzy-search project file"))
        await waitForElement(() => {
            const element = container.querySelector('textarea[aria-label="File contents"]')
            return element instanceof HTMLTextAreaElement && element.value === "remote project file" ? element : null
        }, "project file content from fuzzy-search result")
        await click(await waitForElement(() => buttonByText(container, "Load Files"), "load project files"))
        await waitForElement(() => (container.textContent?.includes("README.md") ? container : null), "project file")
        expect(state.projectFileTreeRuntimeReads).toBe(1)
        await click(await waitForElement(() => buttonByText(container, "README.md"), "read project file"))
        const projectFileEditor = await waitForElement(() => {
            const element = container.querySelector('textarea[aria-label="File contents"]')
            return element instanceof HTMLTextAreaElement && element.value === "remote project file" ? element : null
        }, "project file content")
        const projectFileTreeReadsBeforeSave = state.projectFileTreeRuntimeReads
        await typeInto(projectFileEditor, "remote project file updated")
        await click(await waitForElement(() => buttonByText(container, "Save"), "save project file"))
        await waitForElement(() => (state.projectFileWriteRuntimeRequests === 1 ? container : null), "project file write runtime request")
        expect(state.projectFileTreeRuntimeReads).toBe(projectFileTreeReadsBeforeSave)
        expect(state.projectFileWriteContents).toEqual(["remote project file updated"])
        expect(state.projectFileContent).toBe("remote project file updated")
        await waitForElement(() => {
            const element = container.querySelector('textarea[aria-label="File contents"]')
            return element instanceof HTMLTextAreaElement && element.value === "remote project file updated" ? element : null
        }, "updated project file content")
        const searchInput = await waitForElement(() => inputByPlaceholder(container, "Search files"), "project search input")
        await typeInto(searchInput, "remote")
        await click(await waitForElement(() => buttonByText(container, "Search"), "project search button"))
        await waitForElement(() => (container.textContent?.includes("remote project file search hit") ? container : null), "project search result")
        expect(state.processListRuntimeReads).toBe(0)
        await click(await waitForElement(() => buttonByText(container, "Load Processes"), "load project processes"))
        await waitForElement(() => (container.textContent?.includes("Phone Echo") ? container : null), "project process")
        const processListReadsBeforeProcessActions = state.processListRuntimeReads
        expect(processListReadsBeforeProcessActions).toBe(1)
        await click(await waitForElement(() => buttonByText(container, "Start"), "start project process"))
        await waitForElement(() => (container.textContent?.includes("Running") ? container : null), "running project process")
        expect(state.processRunning).toBe(true)
        expect(state.processListRuntimeReads).toBe(processListReadsBeforeProcessActions)
        await click(await waitForElement(() => buttonByText(container, "Output"), "project process output button"))
        await waitForElement(() => (container.textContent?.includes("phone process output") ? container : null), "project process output")
        await click(await waitForElement(() => buttonByText(container, "Stop"), "stop project process"))
        await waitForElement(() => (container.textContent?.includes("Stopped") ? container : null), "stopped project process")
        expect(state.processRunning).toBe(false)
        expect(state.processListRuntimeReads).toBe(processListReadsBeforeProcessActions)

        await click(await waitForElement(() => buttonByText(container, "Original task"), "task row"))
        await waitForElement(() => (container.textContent?.includes("Describe this image") ? container : null), "task detail before git load")
        expect(state.taskSnapshotPatchRuntimeReads).toBe(0)
        expect(state.taskSnapshotIndexRuntimeReads).toBe(0)
        expect(state.taskSnapshotPatchSliceRuntimeReads).toBe(0)
        await click(await waitForElement(() => buttonByText(container, "Patch"), "snapshot patch button"))
        await waitForElement(() => (container.textContent?.includes("snapshot.txt") ? container : null), "snapshot patch index")
        expect(state.taskSnapshotPatchRuntimeReads).toBe(0)
        expect(state.taskSnapshotIndexRuntimeReads).toBe(1)
        expect(state.taskSnapshotPatchSliceRuntimeReads).toBe(0)
        await click(await waitForElement(() => lastButtonByExactText(container, "Load"), "snapshot patch slice button"))
        await waitForElement(() => (container.textContent?.includes("snapshot patch content") ? container : null), "snapshot patch content")
        expect(state.taskSnapshotPatchRuntimeReads).toBe(0)
        expect(state.taskSnapshotPatchSliceRuntimeReads).toBe(1)
        expect(state.taskChangesRuntimeReads).toBe(0)
        expect(state.taskGitLogRuntimeReads).toBe(0)
        expect(state.taskGitSummaryRuntimeReads).toBe(0)
        expect(state.taskGitScopesRuntimeReads).toBe(0)
        expect(state.taskFilePairRuntimeReads).toBe(0)
        expect(state.taskGitCommitFilesRuntimeReads).toBe(0)
        expect(state.taskGitFileAtTreeishRuntimeReads).toBe(0)
        expect(state.taskGitCommitFilePatchRuntimeReads).toBe(0)
        await click(await waitForElement(() => buttonByText(container, "Load Changes"), "load task git"))
        await waitForElement(() => (container.textContent?.includes("src/app.ts") ? container : null), "task changed file")
        await waitForElement(() => (container.textContent?.includes("Initial remote commit") ? container : null), "task git log")
        await waitForElement(() => (container.textContent?.includes("HEAD") ? container : null), "task git scope")
        expect(state.taskChangesRuntimeReads).toBe(1)
        expect(state.taskGitLogRuntimeReads).toBe(1)
        expect(state.taskGitSummaryRuntimeReads).toBe(1)
        expect(state.taskGitScopesRuntimeReads).toBe(1)
        const commitMessageInput = await waitForElement(() => inputByPlaceholder(container, "Commit message"), "commit message input")
        await typeInto(commitMessageInput, "Runtime shared shell commit")
        await click(await waitForElement(() => buttonByText(container, "Commit"), "commit task changes button"))
        await waitForElement(() => (state.taskGitCommitRuntimeRequests === 1 ? container : null), "task git commit runtime request")
        expect(state.taskGitCommitMessages).toEqual(["Runtime shared shell commit"])
        await waitForElement(() => (container.textContent?.includes("Committed fedcba98") ? container : null), "committed notice")
        await click(await waitForElement(() => buttonByLabel(container, "Load files for commit 0123456"), "load commit files"))
        await waitForElement(() => (container.textContent?.includes("Commit 01234567") ? container : null), "commit files")
        expect(state.taskGitCommitFilesRuntimeReads).toBe(1)
        await click(await waitForElement(() => buttonByLabel(container, "Read patch for src/app.ts at commit 01234567"), "read commit file patch"))
        await waitForElement(() => (container.textContent?.includes("+remote task changes") ? container : null), "commit patch content")
        expect(state.taskGitCommitFilePatchRuntimeReads).toBe(1)
        await click(await waitForElement(() => buttonByLabel(container, "View src/app.ts at commit 01234567"), "read file at commit"))
        await waitForElement(() => (container.textContent?.includes("remote task file") ? container : null), "file at commit content")
        expect(state.taskGitFileAtTreeishRuntimeReads).toBe(1)
        await click(await waitForElement(() => buttonByText(container, "Files"), "read task file pair"))
        await waitForElement(() => {
            const text = container.textContent ?? ""
            return text.includes("before") && text.includes("after") ? container : null
        }, "task file pair")
        expect(state.taskFilePairRuntimeReads).toBe(1)
        await click(await waitForElement(() => buttonByText(container, "src/app.ts"), "read task diff"))
        await waitForElement(() => (container.textContent?.includes("+remote task changes") ? container : null), "task diff content")
        expect(state.taskDiffRuntimeReads).toBe(1)
        await waitForElement(() => container.querySelector('img[src="data:image/png;base64,cmVtb3RlIGltYWdl"]'), "remote task image")
        expect(state.taskResourceInventoryRuntimeReads).toBe(0)
        await click(await waitForElement(() => buttonByText(container, "Load"), "load task resources"))
        await waitForElement(() => (container.textContent?.includes("openade/task-1") ? container : null), "task resources loaded")
        expect(container.textContent).toContain("1 patch")
        expect(container.textContent).toContain("1 image")
        expect(state.taskResourceInventoryRuntimeReads).toBe(1)
        expect(state.taskTerminalReconnectRuntimeRequests).toBe(0)
        expect(state.taskTerminalStartRuntimeRequests).toBe(0)
        await click(await waitForElement(() => buttonByText(container, "Open Terminal"), "open task terminal"))
        await waitForElement(
            () => (state.taskTerminalReconnectRuntimeRequests > 0 && state.taskTerminalStartRuntimeRequests > 0 ? container : null),
            "task terminal runtime connection"
        )
        expect(state.taskTerminalWriteRuntimeRequests).toBe(0)
        expect(state.taskTerminalStopRuntimeRequests).toBe(0)

        const snapshotReadsBeforeAcceptedMutations = state.snapshotRuntimeReads
        const taskReadsBeforeAcceptedMutations = state.taskRuntimeReads
        const titleInput = await waitForElement(() => inputByValue(container, "Original task"), "task title input")
        await typeInto(titleInput, "Remote updated task")
        await waitForElement(() => inputByValue(container, "Remote updated task"), "edited task title draft")
        await click(await waitForElement(() => buttonByText(container, "Save"), "save title button"))
        await waitForElement(() => inputByValue(container, "Remote updated task"), "updated task title")
        expect(state.task.title).toBe("Remote updated task")
        await click(await waitForElement(() => buttonByText(container, "Generate"), "generate title button"))
        await waitForElement(() => inputByValue(container, "Remote generated title"), "generated task title")
        expect(state.task.title).toBe("Remote generated title")
        expect(state.taskTitleGenerateRuntimeRequests).toBe(1)
        await click(await waitForElement(() => buttonByText(container, "Prepare Environment"), "prepare task environment button"))
        await waitForElement(() => (container.textContent?.includes("1 environment") ? container : null), "prepared task environment")
        expect(state.task.deviceEnvironments).toEqual([expect.objectContaining({ id: "runtime-device", setupComplete: true })])
        expect(state.taskEnvironmentPrepareRuntimeRequests).toBe(1)

        await click(await waitForElement(() => buttonByText(container, "Close"), "close task button"))
        await waitForElement(() => buttonByText(container, "Reopen"), "reopen task button")
        expect(state.task.closed).toBe(true)

        const commentInput = await waitForElement(() => inputByPlaceholder(container, "Add a comment"), "comment input")
        await typeInto(commentInput, "Runtime-backed remote comment")
        await waitForElement(() => inputByValue(container, "Runtime-backed remote comment"), "comment draft")
        const addCommentButton = await waitForElement(
            () => Array.from(commentInput.parentElement?.querySelectorAll("button") ?? []).find((button) => button.textContent === "Add") ?? null,
            "add comment button"
        )
        await click(addCommentButton)
        await waitForElement(() => (container.textContent?.includes("Runtime-backed remote comment") ? container : null), "created comment")
        expect(state.task.comments).toEqual([expect.objectContaining({ content: "Runtime-backed remote comment" })])

        await click(await waitForElement(() => buttonByTitle(container, "Move queued turn down"), "move queued turn down button"))
        await waitForElement(() => (state.task.queuedTurns?.[0]?.id === "queued-2" ? container : null), "reordered queued turns")
        expect(state.task.queuedTurns?.map((turn) => turn.id)).toEqual(["queued-2", "queued-1"])
        await click(await waitForElement(() => buttonByText(container, "Cancel"), "cancel queued turn button"))
        await waitForElement(() => (container.textContent?.includes("cancelled") ? container : null), "cancelled queued turn")
        expect(state.queuedTurn.status).toBe("cancelled")
        await act(async () => {
            await new Promise((resolve) => window.setTimeout(resolve, 250))
        })
        expect(state.snapshotRuntimeReads).toBe(snapshotReadsBeforeAcceptedMutations)
        expect(state.taskRuntimeReads).toBe(taskReadsBeforeAcceptedMutations)

        await click(await waitForElement(() => buttonByTitle(container, "Fast mode"), "fast mode toggle before review"))
        const snapshotReadsBeforeReview = state.snapshotRuntimeReads
        const taskReadsBeforeReview = state.taskRuntimeReads
        await click(await waitForElement(() => buttonByText(container, "Review Work"), "review work button"))
        await waitForElement(() => (state.task.events.some((event) => JSON.stringify(event).includes("event-review")) ? container : null), "review event")
        expect(state.reviewStarts[0]).toMatchObject({
            repoId: "repo-1",
            taskId: "task-1",
            reviewType: "work",
            harnessId: DEFAULT_HARNESS_ID,
            modelId: getVisibleModelId(getDefaultModelForHarness(DEFAULT_HARNESS_ID), DEFAULT_HARNESS_ID),
            thinking: "max",
            fastMode: true,
        })
        expect(state.snapshotRuntimeReads).toBe(snapshotReadsBeforeReview)
        expect(state.taskRuntimeReads).toBe(taskReadsBeforeReview)
        await act(async () => {
            await new Promise((resolve) => window.setTimeout(resolve, 250))
        })
        expect(state.snapshotRuntimeReads).toBe(snapshotReadsBeforeReview)
        expect(state.taskRuntimeReads).toBe(taskReadsBeforeReview)

        await click(await waitForElement(() => buttonByText(container, "Delete"), "delete task button"))
        await waitForElement(() => (state.taskDeleted ? container : null), "deleted task")
        expect(container.textContent).toContain("No tasks yet.")

        await click(await waitForElement(() => buttonByText(container, "Settings"), "settings tab"))
        await click(await waitForElement(() => buttonByText(container, "Revoke This Device"), "self revoke button"))
        await waitForElement(() => (state.selfRevoked ? container : null), "self revoked device")
        expect(loadRemoteConfig()).toBeNull()
    })
})
