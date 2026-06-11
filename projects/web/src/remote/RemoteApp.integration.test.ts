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
    OpenADEProject,
    OpenADEProjectProcessInstance,
    OpenADEQueuedTurn,
    OpenADEReviewStartRequest,
    OpenADESnapshot,
    OpenADETask,
    OpenADETaskDeleteRequest,
    OpenADETaskMetadataUpdateRequest,
    OpenADETaskPreview,
    OpenADETurnStartRequest,
} from "../../../openade-module/src/types"
import { type RuntimeClientOptions, RuntimeLocalClient, type RuntimeLocalTransport } from "../../../runtime-client/src"
import type { RuntimeMessage, RuntimeRequest } from "../../../runtime-protocol/src"
import type { RuntimeConnection } from "../../../runtime/src"
import { RuntimeServer } from "../../../runtime/src"
import { DEFAULT_HARNESS_ID, getDefaultModelForHarness } from "../constants"
import { runtimeSocketUrl } from "../kernel/session"
import { getVisibleModelId } from "../modelVisibility"
import { REMOTE_THEME_STORAGE_KEY, RemoteApp } from "./RemoteApp"
import { REMOTE_CONFIG_STORAGE_KEY, __setRemoteClientConstructorsForTest, loadRemoteConfig, loadRemoteConfigs } from "./client"

const now = "2026-05-31T00:00:00.000Z"

let restoreClientConstructors: (() => void) | undefined

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

type RuntimeClientConstructor = new (options: RuntimeClientOptions) => RuntimeLocalClient

function createSnapshotRuntimeServer(snapshot: OpenADESnapshot): RuntimeServer {
    const server = new RuntimeServer({
        serverName: `${snapshot.server.hostName}-runtime`,
        protocolVersion: 1,
    })
    server.register("openade/snapshot/read", () => snapshot)
    server.registerNotification("openade/snapshotChanged")
    return server
}

function createSnapshotRuntimeConstructors(sessions: Array<{ baseUrl: string; snapshot: OpenADESnapshot }>): {
    RuntimeClient: RuntimeClientConstructor
    OpenADEClient: typeof OpenADEClient
} {
    const servers = new Map<string, RuntimeServer>()
    for (const session of sessions) {
        servers.set(runtimeSocketUrl({ baseUrl: session.baseUrl }), createSnapshotRuntimeServer(session.snapshot))
    }

    class MultiSessionRuntimeClient extends RuntimeLocalClient {
        constructor(options: RuntimeClientOptions) {
            const server = servers.get(options.url)
            if (!server) throw new Error(`Missing test runtime server for ${options.url}`)
            super(createRuntimeLocalTransport(server), {
                clientName: options.clientName,
                clientVersion: options.clientVersion,
                clientPlatform: options.clientPlatform,
                protocolVersion: options.protocolVersion,
            })
        }
    }

    return { RuntimeClient: MultiSessionRuntimeClient, OpenADEClient }
}

function createRuntimeBackedConstructors(
    state: {
        taskDeleted: boolean
        processRunning: boolean
        selfRevoked: boolean
        taskCreateRuntimeRequests: number
        queuedTurnEnqueueRuntimeRequests: number
        turnStarts: OpenADETurnStartRequest[]
        reviewStarts: OpenADEReviewStartRequest[]
        workingTaskIds: string[]
        snapshotReads: number
        taskReads: number
        snapshotRuntimeReads: number
        taskListRuntimeReads: number
        taskRuntimeReads: number
        projectGitInfoRuntimeReads: number
        projectGitBranchesRuntimeReads: number
        projectGitSummaryRuntimeReads: number
        projectCronDefinitionsRuntimeReads: number
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
        taskTitleGenerateRuntimeRequests: number
        taskEnvironmentPrepareRuntimeRequests: number
        task: OpenADETask
        queuedTurn: OpenADEQueuedTurn
    },
    runtimeOptions: { permissions?: string[] } = {}
): {
    RuntimeClient: RuntimeClientConstructor
    OpenADEClient: typeof OpenADEClient
    publishQueuedTurnUpdated(turn: OpenADEQueuedTurn): void
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
            repos: [project],
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
                { path: "README.md", name: "README.md", type: "file", size: state.projectFileContent.length },
                { path: "src", name: "src", type: "directory" },
            ],
            truncated: false,
        }),
        readProjectFile: async (params) => ({
            repoId: params.repoId,
            path: params.path,
            encoding: params.encoding ?? "utf8",
            size: state.projectFileContent.length,
            tooLarge: false,
            content: params.path === "README.md" ? state.projectFileContent : "",
        }),
        writeProjectFile: async (params) => {
            state.projectFileContent = params.content
            state.projectFileWriteContents.push(params.content)
            return {
                repoId: params.repoId,
                path: params.path,
                size: params.content.length,
            }
        },
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
            branches: [{ name: "main", isDefault: true, isRemote: false }],
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
        readTaskResourceInventory: async (params) => ({
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
        }),
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
            state.task.events = [...state.task.events, { id: setupEvent.eventId, type: "setup_environment", status: "completed", ...setupEvent }]
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
        readTaskChanges: async (params) => ({
            repoId: params.repoId,
            taskId: params.taskId,
            files: [{ path: "src/app.ts", status: "modified" }],
            fromTreeish: "HEAD",
            toTreeish: "",
        }),
        readTaskDiff: async (params) => ({
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
        }),
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
        readProjects: async () => [project],
        readTaskList: async () => project.tasks,
        readTask: async () => {
            state.taskReads += 1
            return readTaskDto()
        },
        listDataDocuments: async () => [],
        readDataDocumentBase64: async () => null,
        saveDataDocumentBase64: async () => undefined,
        deleteDataDocument: async () => undefined,
        scopedHost,
        createRepo: async () => ({ repoId: "repo-created", createdAt: now }),
        updateRepo: async () => undefined,
        deleteRepo: async () => undefined,
        createTask: async (params) => {
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
            publishTaskChanged({ previewChanged: true, clientRequestId: params.clientRequestId })
            return {
                taskId,
                slug,
                title,
                createdAt,
            }
        },
        startTurn: async (params) => {
            state.turnStarts.push({ ...params })
            const eventId = "event-turn"
            const actionEvent = {
                id: eventId,
                type: "action" as const,
                status: "in_progress" as const,
                createdAt: now,
                userInput: params.input,
                source: { type: params.type, userLabel: params.type },
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
        interruptTurn: async () => undefined,
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
            if (params.title) {
                state.task.title = params.title
                preview.title = params.title
            }
            if (params.closed !== undefined) {
                state.task.closed = params.closed
                preview.closed = params.closed
            }
            publishTaskChanged({ clientRequestId: params.clientRequestId })
        },
    }
    server.registerModule(createOpenADEModule(adapters))
    server.register("remote/device/selfRevoke", () => {
        state.selfRevoked = true
        return { ok: true, revoked: true }
    })

    class TestRuntimeClient extends RuntimeLocalClient {
        constructor(options: RuntimeClientOptions) {
            const transport = createRuntimeLocalTransport(server, runtimeOptions.permissions)
            const request = transport.request.bind(transport)
            transport.request = (runtimeRequest) => {
                if (runtimeRequest.method === "openade/snapshot/read") state.snapshotRuntimeReads += 1
                if (runtimeRequest.method === "openade/task/list") state.taskListRuntimeReads += 1
                if (runtimeRequest.method === "openade/task/read") state.taskRuntimeReads += 1
                if (runtimeRequest.method === "openade/task/create") state.taskCreateRuntimeRequests += 1
                if (runtimeRequest.method === "openade/queued-turn/enqueue") state.queuedTurnEnqueueRuntimeRequests += 1
                if (runtimeRequest.method === "openade/project/git/info/read") state.projectGitInfoRuntimeReads += 1
                if (runtimeRequest.method === "openade/project/git/branches/read") state.projectGitBranchesRuntimeReads += 1
                if (runtimeRequest.method === "openade/project/git/summary/read") state.projectGitSummaryRuntimeReads += 1
                if (runtimeRequest.method === "openade/cron/definitions/read") state.projectCronDefinitionsRuntimeReads += 1
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
                if (runtimeRequest.method === "openade/task/title/generate") state.taskTitleGenerateRuntimeRequests += 1
                if (runtimeRequest.method === "openade/task/environment/prepare") state.taskEnvironmentPrepareRuntimeRequests += 1
                return request(runtimeRequest)
            }
            super(transport, {
                clientName: options.clientName,
                clientVersion: options.clientVersion,
                clientPlatform: options.clientPlatform,
                protocolVersion: options.protocolVersion,
            })
            queueMicrotask(() => options.onStatus?.("connected"))
        }
    }

    return {
        RuntimeClient: TestRuntimeClient,
        OpenADEClient,
        publishQueuedTurnUpdated,
    }
}

function seededTask(): {
    taskDeleted: boolean
    processRunning: boolean
    selfRevoked: boolean
    taskCreateRuntimeRequests: number
    queuedTurnEnqueueRuntimeRequests: number
    turnStarts: OpenADETurnStartRequest[]
    reviewStarts: OpenADEReviewStartRequest[]
    workingTaskIds: string[]
    snapshotReads: number
    taskReads: number
    snapshotRuntimeReads: number
    taskListRuntimeReads: number
    taskRuntimeReads: number
    projectGitInfoRuntimeReads: number
    projectGitBranchesRuntimeReads: number
    projectGitSummaryRuntimeReads: number
    projectCronDefinitionsRuntimeReads: number
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
    taskTitleGenerateRuntimeRequests: number
    taskEnvironmentPrepareRuntimeRequests: number
    task: OpenADETask
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
        taskCreateRuntimeRequests: 0,
        queuedTurnEnqueueRuntimeRequests: 0,
        turnStarts: [],
        reviewStarts: [],
        workingTaskIds: [],
        snapshotReads: 0,
        taskReads: 0,
        snapshotRuntimeReads: 0,
        taskListRuntimeReads: 0,
        taskRuntimeReads: 0,
        projectGitInfoRuntimeReads: 0,
        projectGitBranchesRuntimeReads: 0,
        projectGitSummaryRuntimeReads: 0,
        projectCronDefinitionsRuntimeReads: 0,
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
        taskTitleGenerateRuntimeRequests: 0,
        taskEnvironmentPrepareRuntimeRequests: 0,
        queuedTurn,
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

function inputByValue(container: HTMLElement, value: string): HTMLInputElement | null {
    return Array.from(container.querySelectorAll("input")).find((input): input is HTMLInputElement => input.value === value) ?? null
}

function inputByPlaceholder(container: HTMLElement, value: string): HTMLInputElement | null {
    return Array.from(container.querySelectorAll("input")).find((input): input is HTMLInputElement => input.placeholder === value) ?? null
}

function sendButtonForTaskInput(input: HTMLTextAreaElement): HTMLButtonElement | null {
    const next = input.nextElementSibling
    return next instanceof HTMLButtonElement ? next : null
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

    afterEach(() => {
        restoreClientConstructors?.()
        restoreClientConstructors = undefined
        act(() => root.unmount())
        container.remove()
        localStorage.clear()
        vi.restoreAllMocks()
    })

    it("switches saved sessions, removes stale hosts, and persists shell theme through real runtime clients", async () => {
        const laptopBaseUrl = "http://100.64.1.10:7823"
        const studioBaseUrl = "http://100.64.1.11:7823"
        const laptopSnapshot = snapshotWithProject("Laptop Desktop", "laptop-repo", "Laptop Repo", "code-theme-light", "Light")
        const studioSnapshot = snapshotWithProject("Studio Desktop", "studio-repo", "Studio Repo", "code-theme-bright", "Bright")
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
                { baseUrl: laptopBaseUrl, snapshot: laptopSnapshot },
                { baseUrl: studioBaseUrl, snapshot: studioSnapshot },
            ])
        )

        await act(async () => {
            root.render(createElement(RemoteApp))
        })

        await waitForElement(() => buttonByText(container, "Laptop Repo"), "active laptop project")
        expect(loadRemoteConfig()?.id).toBe("session-1")
        expect(shellRootClassName(container)).toContain("code-theme-light")

        await click(await waitForElement(() => buttonByText(container, "Settings"), "settings tab"))
        const themeSelect = await waitForElement(() => {
            const element = container.querySelector("select")
            return element instanceof HTMLSelectElement ? element : null
        }, "shell theme select")
        await selectValue(themeSelect, "code-theme-dracula")
        expect(localStorage.getItem(REMOTE_THEME_STORAGE_KEY)).toBe("code-theme-dracula")
        expect(shellRootClassName(container)).toContain("code-theme-dracula")

        await click(await waitForElement(() => buttonByText(container, "Manage Sessions"), "manage sessions button"))
        await click(await waitForElement(() => buttonByText(container, "Studio Desktop"), "studio session row"))
        await waitForElement(() => buttonByText(container, "Studio Repo"), "active studio project")
        expect(loadRemoteConfig()?.id).toBe("session-2")
        expect(shellRootClassName(container)).toContain("code-theme-dracula")

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
            root.unmount()
        })
        root = createRoot(container)
        await act(async () => {
            root.render(createElement(RemoteApp))
        })

        await waitForElement(() => buttonByText(container, "Studio Repo"), "persisted active studio project")
        expect(loadRemoteConfig()?.id).toBe("session-2")
        expect(localStorage.getItem(REMOTE_THEME_STORAGE_KEY)).toBe("code-theme-dracula")
        expect(shellRootClassName(container)).toContain("code-theme-dracula")
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

    it("creates remote tasks with the shared composer agent controls over a real runtime client", async () => {
        const state = seededTask()
        restoreClientConstructors = __setRemoteClientConstructorsForTest(createRuntimeBackedConstructors(state))

        await act(async () => {
            root.render(createElement(RemoteApp))
        })

        await waitForElement(() => buttonByText(container, "Runtime Repo"), "runtime project")
        await click(await waitForElement(() => buttonByText(container, "New"), "new task tab"))
        const titleInput = await waitForElement(() => inputByPlaceholder(container, "Optional title"), "new task title input")
        const promptInput = await waitForElement(() => {
            const element = container.querySelector('textarea[aria-label="Task input"]')
            return element instanceof HTMLTextAreaElement ? element : null
        }, "new task prompt input")
        await typeInto(titleInput, "Remote composer task")
        await typeInto(promptInput, "Create from the shared composer")
        await click(await waitForElement(() => buttonByTitle(container, "Fast mode"), "fast mode toggle"))
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
            createdBy: { id: "remote-companion", email: "remote-companion@openade.local" },
            isolationStrategy: { type: "head" },
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
        })
        await act(async () => {
            await new Promise((resolve) => window.setTimeout(resolve, 250))
        })
        expect(state.snapshotRuntimeReads).toBe(snapshotReadsBeforeCreate)
        expect(state.taskRuntimeReads).toBe(taskReadsBeforeCreate)
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
        const promptInput = await waitForElement(() => {
            const element = container.querySelector('textarea[aria-label="Task input"]')
            return element instanceof HTMLTextAreaElement ? element : null
        }, "task prompt input")
        await typeInto(promptInput, "Run in the existing task with selected agent settings")
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
        })
        await act(async () => {
            await new Promise((resolve) => window.setTimeout(resolve, 250))
        })
        expect(state.snapshotRuntimeReads).toBe(snapshotReadsBeforeSend)
        expect(state.taskRuntimeReads).toBe(taskReadsBeforeSend)
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
        const promptInput = await waitForElement(() => {
            const element = container.querySelector('textarea[aria-label="Task input"]')
            return element instanceof HTMLTextAreaElement ? element : null
        }, "task prompt input")
        await typeInto(promptInput, "Queue this behind the active run")
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
        const promptInput = await waitForElement(() => {
            const element = container.querySelector('textarea[aria-label="Task input"]')
            return element instanceof HTMLTextAreaElement ? element : null
        }, "task prompt input")
        await typeInto(promptInput, "Denied turn start")
        const sendButton = promptInput.parentElement?.querySelector("button")
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
        expect(state.taskTitleGenerateRuntimeRequests).toBe(0)
        expect(state.taskEnvironmentPrepareRuntimeRequests).toBe(0)
        expect(state.projectFileWriteRuntimeRequests).toBe(0)

        await click(await waitForElement(() => buttonByText(container, "Settings"), "settings tab without self revoke permission"))
        expect(buttonByText(container, "Revoke This Device")).toBeNull()
        expect(state.selfRevoked).toBe(false)
    })

    it("creates a task without starting execution when only task-create is granted", async () => {
        const state = seededTask()
        restoreClientConstructors = __setRemoteClientConstructorsForTest(
            createRuntimeBackedConstructors(state, {
                permissions: ["initialize", "subscription/update", "openade/snapshot/read", "openade/task/read", "openade/task/create"],
            })
        )

        await act(async () => {
            root.render(createElement(RemoteApp))
        })

        await waitForElement(() => buttonByText(container, "Runtime Repo"), "runtime project")
        await click(await waitForElement(() => buttonByText(container, "New"), "new task tab"))
        const titleInput = await waitForElement(() => inputByPlaceholder(container, "Optional title"), "new task title input")
        const promptInput = await waitForElement(() => {
            const element = container.querySelector('textarea[aria-label="Task input"]')
            return element instanceof HTMLTextAreaElement ? element : null
        }, "new task prompt input")
        await typeInto(titleInput, "Remote draft task")
        await typeInto(promptInput, "Capture this without execution")

        expect(buttonByText(container, "Create Task")).toBeTruthy()
        expect(container.textContent).not.toContain("Ask")
        await click(
            await waitForElement(() => {
                const button = buttonByText(container, "Create Task")
                return button && !button.disabled ? button : null
            }, "enabled create-only task button")
        )

        await waitForElement(() => (state.taskCreateRuntimeRequests === 1 ? container : null), "task create runtime request")
        expect(state.turnStarts).toHaveLength(0)
        expect(state.taskRuntimeReads).toBe(0)
        expect(state.task).toMatchObject({
            id: "task-created",
            title: "Remote draft task",
            description: "Capture this without execution",
        })
        expect(container.textContent).toContain("Task created.")
        expect(container.textContent).toContain("Remote draft task")
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
        await typeInto(projectFileEditor, "remote project file updated")
        await click(await waitForElement(() => buttonByText(container, "Save"), "save project file"))
        await waitForElement(() => (state.projectFileWriteRuntimeRequests === 1 ? container : null), "project file write runtime request")
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
