import { describe, expect, it } from "vitest"
import { OpenADEClient } from "../../../openade-client/src"
import { createOpenADEModule, publishOpenADECompanionEvent, type OpenADEModuleAdapters } from "../../../openade-module/src/module"
import type {
    OpenADECommentCreateRequest,
    OpenADECommentDeleteRequest,
    OpenADECommentEditRequest,
    OpenADECronInstallState,
    OpenADEMCPServer,
    OpenADEPersonalSettings,
    OpenADEProject,
    OpenADEQueuedTurn,
    OpenADESnapshot,
    OpenADETask,
    OpenADETaskCreateRequest,
    OpenADETaskCreateResult,
    OpenADETaskMetadataUpdateRequest,
    OpenADETaskReadOptions,
    OpenADETaskPreviewUsage,
    OpenADETaskPreview,
    OpenADETurnStartResult,
    OpenADETurnStartRequest,
} from "../../../openade-module/src/types"
import type { RuntimeConnection } from "../../../runtime/src"
import { RuntimeServer } from "../../../runtime/src"
import type { RuntimeMessage, RuntimeRecord, RuntimeRequest } from "../../../runtime-protocol/src"
import { RuntimeLocalClient, type RuntimeLocalTransport } from "../../../runtime-client/src"
import { OpenADEProductStore } from "./productStore"

function now(): string {
    return "2026-05-31T00:00:00.000Z"
}

function isCommentRecord(value: unknown): value is Record<string, unknown> & { id: string } {
    return typeof value === "object" && value !== null && !Array.isArray(value) && "id" in value && typeof value.id === "string"
}

function runtimeRecord(runtimeId: string, status: RuntimeRecord["status"], ownerId = "task-1", updatedAt = now()): RuntimeRecord {
    return {
        runtimeId,
        kind: "agent",
        status,
        scope: { ownerType: "openade-task", ownerId },
        startedAt: now(),
        updatedAt,
        lastActivityAt: updatedAt,
    }
}

function createLocalRuntimeClient(server: RuntimeServer): RuntimeLocalClient {
    const listeners = new Set<(message: RuntimeMessage) => void>()
    let dispose: (() => void) | null = null
    const connection: RuntimeConnection = {
        id: "product-store-test",
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
    return new RuntimeLocalClient(transport, {
        clientName: "product-store-test",
        clientPlatform: "web",
    })
}

interface Deferred {
    promise: Promise<void>
    resolve(): void
}

function createDeferred(): Deferred {
    let resolveValue = (): void => {
        throw new Error("Deferred resolve called before initialization")
    }
    const promise = new Promise<void>((resolve) => {
        resolveValue = resolve
    })
    return {
        promise,
        resolve: resolveValue,
    }
}

interface RuntimeBackedStoreOptions {
    beforeRuntimeList?: () => Promise<void>
}

interface WrittenImageFixture {
    data: string
    ext: string
    mediaType: string
}

function createRuntimeBackedStore(options: RuntimeBackedStoreOptions = {}): {
    server: RuntimeServer
    store: OpenADEProductStore
    runtime: RuntimeLocalClient
    taskReadRequests: OpenADETaskReadOptions[]
    writtenImages: Map<string, WrittenImageFixture>
    publishTaskChanged(previewChanged?: boolean, clientRequestId?: string): void
    publishTaskUpdated(repoId: string, taskId: string): void
    publishActionEventUpdated(repoId: string, taskId: string, eventId: string, eventStatus: string): void
    snapshotRequestCount(): number
    taskListRequestCount(): number
    runtimeListRequestCount(): number
    projectGitInfoRequestCount(): number
    projectGitBranchesRequestCount(): number
    projectFilesTreeRequestCount(): number
    projectFileReadRequestCount(): number
    processListRequestCount(): number
    cronDefinitionsRequestCount(): number
    cronInstallStateReadRequestCount(): number
    fuzzySearchRequestCount(): number
    projectSearchRequestCount(): number
    projectGitSummaryRequestCount(): number
    taskGitSummaryRequestCount(): number
    taskGitScopesRequestCount(): number
    taskGitLogRequestCount(): number
    taskGitCommitFilesRequestCount(): number
    taskGitFileAtTreeishRequestCount(): number
    taskGitCommitFilePatchRequestCount(): number
    taskChangesRequestCount(): number
    taskDiffRequestCount(): number
    taskFilePairRequestCount(): number
    taskSnapshotPatchRequestCount(): number
    taskSnapshotIndexRequestCount(): number
    taskSnapshotPatchSliceRequestCount(): number
    taskResourceInventoryRequestCount(): number
    mcpServersReadRequestCount(): number
    personalSettingsReadRequestCount(): number
    taskImageReadRequestCount(): number
    stagedTaskImageReadRequestCount(): number
} {
    let runtimeListRequests = 0
    let cronDefinitionsRequests = 0
    let taskListRequests = 0
    const server = new RuntimeServer({
        serverName: "product-store-runtime",
        protocolVersion: 1,
        runHandlerWithContext: async (event, run) => {
            if (event.method === "runtime/list") runtimeListRequests += 1
            if (event.method === "openade/cron/definitions/read") cronDefinitionsRequests += 1
            if (event.method === "runtime/list" && options.beforeRuntimeList) await options.beforeRuntimeList()
            return run()
        },
    })
    const preview: OpenADETaskPreview = {
        id: "task-1",
        slug: "task-1",
        title: "Original task",
        createdAt: now(),
    }
    const project: OpenADEProject = {
        id: "repo-1",
        name: "Repo",
        path: "/tmp/repo",
        tasks: [preview],
    }
    const task: OpenADETask = {
        id: "task-1",
        repoId: "repo-1",
        slug: "task-1",
        title: "Original task",
        description: "Task detail",
        isolationStrategy: { type: "head" },
        deviceEnvironments: [],
        events: [
            {
                id: "event-image",
                type: "action",
                status: "completed",
                createdAt: now(),
                userInput: "Prompt with image",
                source: { type: "do", userLabel: "Do" },
                images: [
                    {
                        id: "image-1",
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
                actionEventId: "event-0",
                referenceBranch: "main",
                mergeBaseCommit: "HEAD",
                fullPatch: "diff --git a/README.md b/README.md\n+snapshot product store\n",
                stats: { filesChanged: 1, insertions: 1, deletions: 0 },
            },
        ],
        comments: [],
    }
    const tasks = new Map([[task.id, task]])
    const taskReadRequests: OpenADETaskReadOptions[] = []
    const writtenImages = new Map<string, WrittenImageFixture>()
    let snapshotRequests = 0
    let projectGitInfoRequests = 0
    let projectGitBranchesRequests = 0
    let projectFilesTreeRequests = 0
    let projectFileReadRequests = 0
    let processListRequests = 0
    let cronInstallStateReadRequests = 0
    let fuzzySearchRequests = 0
    let projectSearchRequests = 0
    let projectGitSummaryRequests = 0
    let taskGitSummaryRequests = 0
    let taskGitScopesRequests = 0
    let taskGitLogRequests = 0
    let taskGitCommitFilesRequests = 0
    let taskGitFileAtTreeishRequests = 0
    let taskGitCommitFilePatchRequests = 0
    let taskChangesRequests = 0
    let taskDiffRequests = 0
    let taskFilePairRequests = 0
    let taskSnapshotPatchRequests = 0
    let taskSnapshotIndexRequests = 0
    let taskSnapshotPatchSliceRequests = 0
    let taskResourceInventoryRequests = 0
    let mcpServersReadRequests = 0
    let personalSettingsReadRequests = 0
    let taskImageReadRequests = 0
    let stagedTaskImageReadRequests = 0
    let mcpServers: OpenADEMCPServer[] = [
        {
            id: "mcp-stdio-1",
            name: "Runtime MCP",
            enabled: true,
            transportType: "stdio",
            command: "node",
            args: ["server.js"],
            healthStatus: "unknown",
            createdAt: now(),
            updatedAt: now(),
        },
    ]
    let personalSettings: OpenADEPersonalSettings = {
        envVars: {},
        theme: "system",
        renderMarkdownMessages: true,
    }
    const cronInstallStates = new Map<string, Record<string, OpenADECronInstallState>>([
        [
            "repo-1",
            {
                "openade.toml::Runtime Cron": {
                    cronId: "openade.toml::Runtime Cron",
                    enabled: false,
                    installedAt: "2026-05-30T00:00:00.000Z",
                },
            },
        ],
    ])

    function snapshot(options?: {
        version?: string
        hostName?: string
        workingTaskIds?: string[]
    }): OpenADESnapshot {
        return {
            server: {
                version: options?.version ?? "test",
                hostName: options?.hostName ?? "test-host",
                theme: { setting: "system", className: "code-theme-light" },
            },
            repos: [project],
            workingTaskIds: options?.workingTaskIds ?? [],
        }
    }

    function publishTaskChanged(previewChanged = true, clientRequestId?: string): void {
        publishOpenADECompanionEvent(server, {
            type: "task_changed",
            repoId: "repo-1",
            taskId: "task-1",
            previewChanged,
            clientRequestId,
            at: now(),
        })
    }

    function publishTaskUpdated(repoId: string, taskId: string): void {
        server.notify("openade/task/updated", { repoId, taskId, at: now() })
    }

    function publishActionEventUpdated(repoId: string, taskId: string, eventId: string, eventStatus: string): void {
        server.notify("openade/task/updated", {
            repoId,
            taskId,
            eventId,
            eventStatus,
            at: now(),
        })
    }

    async function updateTaskMetadata(params: OpenADETaskMetadataUpdateRequest): Promise<void> {
        const current = tasks.get(params.taskId)
        if (!current) throw new Error(`Task ${params.taskId} not found`)
        if (params.title) {
            current.title = params.title
            preview.title = params.title
        }
        if (params.closed !== undefined) {
            current.closed = params.closed
            preview.closed = params.closed
        }
        if (params.queuedTurns !== undefined) {
            current.queuedTurns = params.queuedTurns
        }
        publishTaskChanged(true, params.clientRequestId)
    }

    async function createComment(params: OpenADECommentCreateRequest): Promise<{ commentId: string; createdAt: string }> {
        const current = tasks.get(params.taskId)
        if (!current) throw new Error(`Task ${params.taskId} not found`)
        const commentId = params.commentId ?? "comment-1"
        current.comments = [
            ...current.comments,
            {
                id: commentId,
                content: params.content,
                source: params.source,
                selectedText: params.selectedText,
                author: params.author,
                createdAt: params.createdAt ?? now(),
            },
        ]
        publishTaskChanged(false, params.clientRequestId)
        return { commentId, createdAt: params.createdAt ?? now() }
    }

    async function editComment(params: OpenADECommentEditRequest): Promise<void> {
        const current = tasks.get(params.taskId)
        if (!current) throw new Error(`Task ${params.taskId} not found`)
        current.comments = current.comments.map((comment) => {
            if (!isCommentRecord(comment) || comment.id !== params.commentId) return comment
            return {
                ...comment,
                content: params.content,
                ...(params.updatedAt !== undefined ? { updatedAt: params.updatedAt } : {}),
            }
        })
        publishTaskChanged(false, params.clientRequestId)
    }

    async function deleteComment(params: OpenADECommentDeleteRequest): Promise<void> {
        const current = tasks.get(params.taskId)
        if (!current) throw new Error(`Task ${params.taskId} not found`)
        current.comments = current.comments.filter((comment) => !isCommentRecord(comment) || comment.id !== params.commentId)
        publishTaskChanged(false, params.clientRequestId)
    }

    async function createTask(params: OpenADETaskCreateRequest): Promise<OpenADETaskCreateResult> {
        const taskId = params.taskId ?? "task-created"
        const slug = params.slug ?? taskId
        const title = params.title ?? "Created runtime task"
        const createdAt = params.createdAt ?? now()
        const current: OpenADETask = {
            id: taskId,
            repoId: params.repoId,
            slug,
            title,
            description: params.input,
            isolationStrategy: params.isolationStrategy,
            enabledMcpServerIds: params.enabledMcpServerIds,
            deviceEnvironments: params.deviceEnvironment ? [structuredClone(params.deviceEnvironment)] : [],
            events: [],
            comments: [],
            createdAt,
            updatedAt: createdAt,
        }
        tasks.set(taskId, current)
        project.tasks = [
            ...project.tasks.filter((candidate) => candidate.id !== taskId),
            {
                id: taskId,
                slug,
                title,
                createdAt,
            },
        ]
        publishOpenADECompanionEvent(server, {
            type: "task_changed",
            repoId: params.repoId,
            taskId,
            previewChanged: true,
            clientRequestId: params.clientRequestId,
            at: now(),
        })
        return { taskId, slug, title, createdAt }
    }

    async function startTurn(params: OpenADETurnStartRequest): Promise<OpenADETurnStartResult> {
        const createdTask = params.inTaskId === undefined
        const taskId = params.inTaskId ?? "task-created"
        let current = tasks.get(taskId)
        let currentPreview = project.tasks.find((candidate) => candidate.id === taskId)
        if (!current && createdTask) {
            current = {
                id: taskId,
                repoId: params.repoId,
                slug: "task-created",
                title: "Created runtime task",
                description: params.input,
                isolationStrategy: params.isolationStrategy,
                enabledMcpServerIds: params.enabledMcpServerIds,
                deviceEnvironments: [],
                events: [],
                comments: [],
                createdAt: now(),
                updatedAt: now(),
            }
            currentPreview = {
                id: taskId,
                slug: "task-created",
                title: "Created runtime task",
                createdAt: now(),
            }
            tasks.set(taskId, current)
            project.tasks = [...project.tasks, currentPreview]
        }
        if (!current) throw new Error(`Task ${taskId} not found`)
        if (!currentPreview) throw new Error(`Task preview ${taskId} not found`)
        const eventId = createdTask ? "event-created" : "event-1"
        current.events = [
            ...current.events,
            {
                id: eventId,
                type: "action",
                status: "in_progress",
                createdAt: now(),
                userInput: params.input,
                source: { type: params.type, userLabel: params.type },
            },
        ]
        current.lastEventAt = now()
        current.updatedAt = now()
        currentPreview.lastEvent = {
            type: "action",
            status: "in_progress",
            sourceType: params.type,
            sourceLabel: params.type,
            at: now(),
        }
        currentPreview.lastEventAt = now()
        publishActionEventUpdated("repo-1", taskId, eventId, "in_progress")
        return {
            taskId,
            eventId,
            executionId: createdTask ? "exec-created" : "exec-1",
            createdAt: now(),
            ...(createdTask
                ? {
                      task: structuredClone(current),
                      preview: structuredClone(currentPreview),
                  }
                : {}),
        }
    }

    const adapters: OpenADEModuleAdapters = {
        version: () => "test",
        readSnapshot: async (options) => {
            snapshotRequests += 1
            return snapshot(options)
        },
        readProjects: async () => [project],
        readTaskList: async () => {
            taskListRequests += 1
            return project.tasks
        },
        readTask: async (_repoId, taskId, options) => {
            taskReadRequests.push(options ?? {})
            const current = tasks.get(taskId)
            if (!current) throw new Error(`Task ${taskId} not found`)
            return current
        },
        readCronInstallState: async (params) => {
            cronInstallStateReadRequests += 1
            return {
                repoId: params.repoId,
                installations: structuredClone(cronInstallStates.get(params.repoId) ?? {}),
            }
        },
        replaceCronInstallState: async (params) => {
            const installations = structuredClone(params.installations)
            cronInstallStates.set(params.repoId, installations)
            return {
                repoId: params.repoId,
                installations,
                replacedInstallations: Object.keys(installations).length,
            }
        },
        listDataDocuments: async () => [],
        readDataDocumentBase64: async () => null,
        scopedHost: {
            listProjectFiles: async (params) => {
                projectFilesTreeRequests += 1
                return {
                    repoId: params.repoId,
                    taskId: params.taskId,
                    path: params.path ?? "",
                    entries: [
                        {
                            path: "src/runtime.ts",
                            name: "runtime.ts",
                            type: "file",
                            size: 21,
                        },
                    ],
                    truncated: false,
                }
            },
            readProjectFile: async (params) => {
                projectFileReadRequests += 1
                return {
                    repoId: params.repoId,
                    taskId: params.taskId,
                    path: params.path,
                    encoding: params.encoding ?? "utf8",
                    size: "runtime product file\n".length,
                    tooLarge: false,
                    content: "runtime product file\n",
                }
            },
            writeProjectFile: async (params) => ({
                repoId: params.repoId,
                taskId: params.taskId,
                path: params.path,
                size: params.content.length,
            }),
            fuzzySearchProjectFiles: async (params) => {
                fuzzySearchRequests += 1
                return {
                    repoId: params.repoId,
                    taskId: params.taskId,
                    results: ["src/runtime.ts"],
                    truncated: false,
                    source: "filesystem",
                }
            },
            searchProject: async (params) => {
                projectSearchRequests += 1
                return {
                    repoId: params.repoId,
                    matches: [
                        {
                            path: "src/runtime.ts",
                            line: 1,
                            content: "runtime product search",
                            matchStart: 0,
                            matchEnd: params.query.length,
                        },
                    ],
                    truncated: false,
                }
            },
            readProjectGitInfo: async (params) => {
                projectGitInfoRequests += 1
                return {
                    repoId: params.repoId,
                    isGitRepo: true,
                    repoRoot: "/tmp/repo",
                    relativePath: "",
                    mainBranch: "main",
                    hasGhCli: false,
                }
            },
            readProjectGitBranches: async (params) => {
                projectGitBranchesRequests += 1
                return {
                    repoId: params.repoId,
                    defaultBranch: "main",
                    branches: [
                        { name: "main", isDefault: true, isRemote: false },
                        ...(params.includeRemote ? [{ name: "origin/feature", isDefault: false, isRemote: true }] : []),
                    ],
                }
            },
            readProjectGitSummary: async (params) => {
                projectGitSummaryRequests += 1
                return {
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
                }
            },
            listProjectProcesses: async (params) => {
                processListRequests += 1
                return {
                    repoId: params.repoId,
                    taskId: params.taskId,
                    searchRoot: "/tmp/repo",
                    repoRoot: "/tmp/repo",
                    isWorktree: false,
                    processes: [
                        {
                            id: "openade.toml::Echo",
                            name: "Echo",
                            command: "printf 'runtime process\\n'",
                            type: "task",
                            configPath: "openade.toml",
                            cwd: "/tmp/repo",
                        },
                    ],
                    configs: [
                        {
                            relativePath: "openade.toml",
                            processes: [],
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
                    errors: [],
                    instances: [],
                }
            },
            startProjectProcess: async (params) => ({
                repoId: params.repoId,
                taskId: params.taskId,
                definitionId: params.definitionId,
                processId: "proc-product-store",
                runtimeId: "process:proc-product-store",
            }),
            reconnectProjectProcess: async (params) => ({
                repoId: params.repoId,
                taskId: params.taskId,
                processId: params.processId,
                found: true,
                completed: true,
                exitCode: 0,
                signal: null,
                outputCount: 1,
                output: [{ type: "stdout", data: "runtime process\n", timestamp: 1 }],
            }),
            stopProjectProcess: async (params) => ({
                repoId: params.repoId,
                taskId: params.taskId,
                processId: params.processId,
                ok: true,
            }),
            startTaskTerminal: async (params) => ({
                repoId: params.repoId,
                taskId: params.taskId,
                terminalId: "openade-task-terminal-test",
                runtimeId: "pty:openade-task-terminal-test",
                ok: true,
            }),
            reconnectTaskTerminal: async (params) => ({
                repoId: params.repoId,
                taskId: params.taskId,
                terminalId: params.terminalId ?? "openade-task-terminal-test",
                found: true,
                exited: false,
                exitCode: null,
                outputCount: 1,
                output: [{ data: "terminal product store\n", timestamp: 1 }],
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
            readTaskChanges: async (params) => {
                taskChangesRequests += 1
                return {
                    repoId: params.repoId,
                    taskId: params.taskId,
                    fromTreeish: params.fromTreeish ?? "HEAD",
                    toTreeish: "",
                    files: [{ path: "README.md", status: "modified" }],
                }
            },
            readTaskGitSummary: async (params) => {
                taskGitSummaryRequests += 1
                return {
                    repoId: params.repoId,
                    taskId: params.taskId,
                    branch: "main",
                    headCommit: "abc123",
                    ahead: 1,
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
            readTaskGitScopes: async (params) => {
                taskGitScopesRequests += 1
                return {
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
                }
            },
            readTaskResourceInventory: async (params) => {
                taskResourceInventoryRequests += 1
                return {
                    repoId: params.repoId,
                    taskId: params.taskId,
                    taskTitle: params.task.title,
                    isRunning: params.isRunning,
                    snapshotIds: [],
                    images: [],
                    sessions: [],
                    worktree: null,
                }
            },
            generateTaskTitle: async (params) => ({
                repoId: params.repoId,
                taskId: params.taskId,
                title: "Generated task title",
            }),
            prepareTaskEnvironment: async (params) => ({
                repoId: params.repoId,
                taskId: params.taskId,
                deviceEnvironment: {
                    id: "runtime-device",
                    deviceId: "runtime-device",
                    setupComplete: true,
                    createdAt: now(),
                    lastUsedAt: now(),
                },
                setupEvent: {
                    eventId: "setup-runtime-device",
                    worktreeId: "runtime-worktree",
                    deviceId: "runtime-device",
                    workingDir: "/tmp/repo",
                    createdAt: now(),
                    completedAt: now(),
                    setupOutput: "Runtime environment ready",
                },
                cwd: "/tmp/repo",
                rootPath: "/tmp/repo",
            }),
            readTaskDiff: async (params) => {
                taskDiffRequests += 1
                return {
                    repoId: params.repoId,
                    taskId: params.taskId,
                    filePath: params.filePath,
                    oldPath: params.oldPath,
                    fromTreeish: params.fromTreeish ?? "HEAD",
                    toTreeish: "",
                    patch: "diff --git a/README.md b/README.md\n+runtime product store\n",
                    truncated: false,
                    heavy: false,
                    stats: { insertions: 1, deletions: 0, changedLines: 1, hunkCount: 1 },
                }
            },
            readTaskFilePair: async (params) => {
                taskFilePairRequests += 1
                return {
                    repoId: params.repoId,
                    taskId: params.taskId,
                    filePath: params.filePath,
                    oldPath: params.oldPath,
                    fromTreeish: params.fromTreeish ?? "HEAD",
                    toTreeish: "",
                    before: "before\n",
                    after: "after\n",
                }
            },
            readTaskGitLog: async (params) => {
                taskGitLogRequests += 1
                return {
                    repoId: params.repoId,
                    taskId: params.taskId,
                    commits: [
                        {
                            sha: "abc123",
                            shortSha: "abc123",
                            message: "Runtime product store commit",
                            author: "Runtime Test",
                            date: now(),
                            relativeDate: "now",
                            parentCount: 1,
                        },
                    ],
                    hasMore: false,
                }
            },
            readTaskGitCommitFiles: async (params) => {
                taskGitCommitFilesRequests += 1
                return {
                    repoId: params.repoId,
                    taskId: params.taskId,
                    commit: params.commit,
                    files: [{ path: "README.md", status: "modified" }],
                }
            },
            readTaskGitFileAtTreeish: async (params) => {
                taskGitFileAtTreeishRequests += 1
                return {
                    repoId: params.repoId,
                    taskId: params.taskId,
                    treeish: params.treeish,
                    filePath: params.filePath,
                    content: "runtime product store\n",
                    exists: true,
                }
            },
            readTaskGitCommitFilePatch: async (params) => {
                taskGitCommitFilePatchRequests += 1
                return {
                    repoId: params.repoId,
                    taskId: params.taskId,
                    commit: params.commit,
                    filePath: params.filePath,
                    oldPath: params.oldPath,
                    patch: "diff --git a/README.md b/README.md\n+runtime product store\n",
                    truncated: false,
                    heavy: false,
                    stats: { insertions: 1, deletions: 0, changedLines: 1, hunkCount: 1 },
                }
            },
            commitTaskGit: async (params) => ({
                repoId: params.repoId,
                taskId: params.taskId,
                committed: true,
                status: "committed",
                sha: "def456",
            }),
            readTaskImage: async (params) => {
                taskImageReadRequests += 1
                return {
                    repoId: params.repoId,
                    taskId: params.taskId,
                    imageId: params.imageId,
                    ext: params.ext,
                    mediaType: params.image.mediaType,
                    data: "aW1hZ2U=",
                }
            },
            readTaskSnapshotPatch: async (params) => {
                taskSnapshotPatchRequests += 1
                return {
                    repoId: params.repoId,
                    taskId: params.taskId,
                    eventId: params.eventId,
                    patch: typeof params.snapshotEvent.fullPatch === "string" ? params.snapshotEvent.fullPatch : null,
                }
            },
            readTaskSnapshotIndex: async (params) => {
                taskSnapshotIndexRequests += 1
                return {
                    repoId: params.repoId,
                    taskId: params.taskId,
                    eventId: params.eventId,
                    index: {
                        version: 1,
                        patchSize: 59,
                        files: [
                            {
                                id: "0",
                                path: "README.md",
                                status: "modified",
                                binary: false,
                                insertions: 1,
                                deletions: 0,
                                changedLines: 1,
                                hunkCount: 0,
                                patchStart: 0,
                                patchEnd: 59,
                            },
                        ],
                    },
                }
            },
            readTaskSnapshotPatchSlice: async (params) => {
                taskSnapshotPatchSliceRequests += 1
                return {
                    repoId: params.repoId,
                    taskId: params.taskId,
                    eventId: params.eventId,
                    patch: typeof params.snapshotEvent.fullPatch === "string" ? params.snapshotEvent.fullPatch.slice(params.start, params.end) : null,
                }
            },
        },
        readStagedTaskImage: async (params) => {
            stagedTaskImageReadRequests += 1
            const image = writtenImages.get(`${params.imageId}.${params.ext}`)
            return {
                imageId: params.imageId,
                ext: params.ext,
                mediaType: image?.mediaType ?? "image/png",
                data: image?.data ?? null,
            }
        },
        saveDataDocumentBase64: async () => undefined,
        deleteDataDocument: async () => undefined,
        createRepo: async (params) => ({
            repoId: params.repoId ?? "repo-created",
            createdAt: params.createdAt ?? now(),
        }),
        updateRepo: async () => undefined,
        deleteRepo: async () => undefined,
        createTask,
        startTurn,
        startReview: async (params) => ({
            taskId: params.taskId,
            eventId: "event-review",
            executionId: "exec-review",
            createdAt: now(),
        }),
        interruptTurn: async () => undefined,
        enqueueQueuedTurn: async (params) => {
            const current = tasks.get(params.taskId)
            if (!current) throw new Error(`Task ${params.taskId} not found`)
            const createdAt = params.createdAt ?? now()
            const queuedTurnId = params.queuedTurnId ?? `queued-${params.clientRequestId ?? (current.queuedTurns?.length ?? 0) + 1}`
            const existingTurn = current.queuedTurns?.find((turn) => turn.id === queuedTurnId)
            if (existingTurn)
                return {
                    taskId: params.taskId,
                    queuedTurnId: existingTurn.id,
                    queued: existingTurn.status === "queued",
                    turn: existingTurn,
                }
            const turn: OpenADEQueuedTurn = {
                id: queuedTurnId,
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
            current.queuedTurns = [...(current.queuedTurns ?? []), turn]
            publishTaskChanged(false, params.clientRequestId)
            server.notify("openade/queuedTurn/updated", {
                repoId: params.repoId,
                taskId: params.taskId,
                turn,
                at: now(),
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
            const current = tasks.get(params.taskId)
            if (!current) throw new Error(`Task ${params.taskId} not found`)
            if (new Set(params.queuedTurnIds).size !== params.queuedTurnIds.length) throw new Error("queuedTurnIds must be unique")
            const turnsById = new Map((current.queuedTurns ?? []).map((turn) => [turn.id, turn]))
            const updatedAt = params.updatedAt ?? now()
            const turns = params.queuedTurnIds.map((queuedTurnId) => {
                const turn = turnsById.get(queuedTurnId)
                if (!turn) throw new Error(`Queued turn ${queuedTurnId} not found`)
                return { ...turn, updatedAt }
            })
            const requestedIds = new Set(params.queuedTurnIds)
            const remainingTurns = (current.queuedTurns ?? []).filter((turn) => !requestedIds.has(turn.id))
            const nextQueuedTurns = [...turns, ...remainingTurns]
            const reordered = (current.queuedTurns ?? []).map((turn) => turn.id).join("\0") !== nextQueuedTurns.map((turn) => turn.id).join("\0")
            current.queuedTurns = nextQueuedTurns
            publishTaskChanged(false, params.clientRequestId)
            for (const turn of turns) {
                server.notify("openade/queuedTurn/updated", {
                    repoId: params.repoId,
                    taskId: params.taskId,
                    turn,
                    at: now(),
                    clientRequestId: params.clientRequestId,
                })
            }
            return { taskId: params.taskId, reordered, turns }
        },
        cancelQueuedTurn: async (params) => {
            const current = tasks.get(params.taskId)
            if (!current) throw new Error(`Task ${params.taskId} not found`)
            current.queuedTurns = (current.queuedTurns ?? []).map((turn) => (turn.id === params.queuedTurnId ? { ...turn, status: "cancelled" } : turn))
            const turn = current.queuedTurns.find((candidate) => candidate.id === params.queuedTurnId)
            publishTaskChanged(false, params.clientRequestId)
            if (turn)
                server.notify("openade/queuedTurn/updated", {
                    repoId: params.repoId,
                    taskId: params.taskId,
                    turn,
                    at: now(),
                    clientRequestId: params.clientRequestId,
                })
            return {
                taskId: params.taskId,
                queuedTurnId: params.queuedTurnId,
                cancelled: true,
            }
        },
        deleteTask: async (params) => {
            tasks.delete(params.taskId)
            project.tasks = project.tasks.filter((candidate) => candidate.id !== params.taskId)
            publishOpenADECompanionEvent(server, {
                type: "task_deleted",
                repoId: params.repoId,
                taskId: params.taskId,
                at: now(),
            })
            return { repoId: params.repoId, taskId: params.taskId, deleted: true }
        },
        writeTaskImage: async (params) => {
            writtenImages.set(`${params.imageId}.${params.ext}`, {
                data: params.data,
                ext: params.ext,
                mediaType: params.mediaType,
            })
            return {
                imageId: params.imageId,
                ext: params.ext,
                mediaType: params.mediaType,
                size: 5,
                sha256: "runtime-image-sha256",
            }
        },
        setupTaskEnvironment: async () => undefined,
        createActionEvent: async () => ({
            eventId: "event-created",
            createdAt: now(),
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
            eventId: "snapshot-1",
            createdAt: now(),
        }),
        createComment,
        editComment,
        deleteComment,
        updateTaskMetadata,
        readMcpServers: async () => {
            mcpServersReadRequests += 1
            return { servers: mcpServers.map((server) => structuredClone(server)) }
        },
        replaceMcpServers: async (params) => {
            mcpServers = params.servers.map((server) => structuredClone(server))
            return {
                servers: mcpServers.map((server) => structuredClone(server)),
                replacedServers: mcpServers.length,
            }
        },
        upsertMcpServer: async (params) => {
            const index = mcpServers.findIndex((server) => server.id === params.server.id)
            const created = index === -1
            mcpServers = created
                ? [...mcpServers, structuredClone(params.server)]
                : mcpServers.map((server) => (server.id === params.server.id ? structuredClone(params.server) : server))
            return { server: structuredClone(params.server), created }
        },
        deleteMcpServer: async (params) => {
            const deleted = mcpServers.some((server) => server.id === params.serverId)
            mcpServers = mcpServers.filter((server) => server.id !== params.serverId)
            return { serverId: params.serverId, deleted }
        },
        readPersonalSettings: async () => {
            personalSettingsReadRequests += 1
            return { settings: structuredClone(personalSettings) }
        },
        replacePersonalSettings: async (params) => {
            personalSettings = structuredClone(params.settings)
            return { settings: structuredClone(params.settings) }
        },
        backfillTaskUsage: async (params) => {
            const taskIds = params.taskIds ?? [...tasks.keys()]
            const updatedTasks = taskIds.map((taskId) => {
                const current = tasks.get(taskId)
                if (!current) throw new Error(`Task ${taskId} not found`)
                const usage: OpenADETaskPreviewUsage = {
                    usageVersion: 2,
                    inputTokens: 11,
                    outputTokens: 7,
                    totalCostUsd: 0.001,
                    eventCount: current.events.length,
                    costByModel: { "model-1": 0.001 },
                    durationMs: 50,
                }
                return { repoId: params.repoId ?? current.repoId, taskId, usage }
            })
            return {
                updatedTasks: updatedTasks.length,
                skippedTasks: 0,
                tasks: updatedTasks,
            }
        },
        recalculateTaskUsage: async (params) => {
            const current = tasks.get(params.taskId)
            if (!current) throw new Error(`Task ${params.taskId} not found`)
            return {
                usage: {
                    usageVersion: 2,
                    inputTokens: 17,
                    outputTokens: 13,
                    totalCostUsd: 0.002,
                    eventCount: current.events.length,
                    costByModel: { "model-2": 0.002 },
                    durationMs: 80,
                },
            }
        },
    }
    server.registerModule(createOpenADEModule(adapters))

    const runtime = createLocalRuntimeClient(server)
    return {
        server,
        runtime,
        store: new OpenADEProductStore(
            new OpenADEClient({
                runtime,
                clientName: "product-store-test",
                clientPlatform: "web",
            })
        ),
        taskReadRequests,
        writtenImages,
        publishTaskChanged,
        publishTaskUpdated,
        publishActionEventUpdated,
        snapshotRequestCount: () => snapshotRequests,
        taskListRequestCount: () => taskListRequests,
        runtimeListRequestCount: () => runtimeListRequests,
        projectGitInfoRequestCount: () => projectGitInfoRequests,
        projectGitBranchesRequestCount: () => projectGitBranchesRequests,
        projectFilesTreeRequestCount: () => projectFilesTreeRequests,
        projectFileReadRequestCount: () => projectFileReadRequests,
        processListRequestCount: () => processListRequests,
        cronDefinitionsRequestCount: () => cronDefinitionsRequests,
        cronInstallStateReadRequestCount: () => cronInstallStateReadRequests,
        fuzzySearchRequestCount: () => fuzzySearchRequests,
        projectSearchRequestCount: () => projectSearchRequests,
        projectGitSummaryRequestCount: () => projectGitSummaryRequests,
        taskGitSummaryRequestCount: () => taskGitSummaryRequests,
        taskGitScopesRequestCount: () => taskGitScopesRequests,
        taskGitLogRequestCount: () => taskGitLogRequests,
        taskGitCommitFilesRequestCount: () => taskGitCommitFilesRequests,
        taskGitFileAtTreeishRequestCount: () => taskGitFileAtTreeishRequests,
        taskGitCommitFilePatchRequestCount: () => taskGitCommitFilePatchRequests,
        taskChangesRequestCount: () => taskChangesRequests,
        taskDiffRequestCount: () => taskDiffRequests,
        taskFilePairRequestCount: () => taskFilePairRequests,
        taskSnapshotPatchRequestCount: () => taskSnapshotPatchRequests,
        taskSnapshotIndexRequestCount: () => taskSnapshotIndexRequests,
        taskSnapshotPatchSliceRequestCount: () => taskSnapshotPatchSliceRequests,
        taskResourceInventoryRequestCount: () => taskResourceInventoryRequests,
        mcpServersReadRequestCount: () => mcpServersReadRequests,
        personalSettingsReadRequestCount: () => personalSettingsReadRequests,
        taskImageReadRequestCount: () => taskImageReadRequests,
        stagedTaskImageReadRequestCount: () => stagedTaskImageReadRequests,
    }
}

async function flushAsyncNotifications(): Promise<void> {
    await Promise.resolve()
    await Promise.resolve()
}

async function waitForNotificationCoalescing(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 180))
    await flushAsyncNotifications()
}

describe("OpenADEProductStore", () => {
    it("reuses fresh snapshot and lightweight task reads while refresh paths bypass cache", async () => {
        const { store, runtime, snapshotRequestCount, taskReadRequests } = createRuntimeBackedStore()

        try {
            await store.refreshSnapshot()
            await store.refreshSnapshot()

            expect(snapshotRequestCount()).toBe(1)

            await store.refreshSnapshot({ bypassCache: true })
            expect(snapshotRequestCount()).toBe(2)

            await store.getTask("repo-1", "task-1")
            await store.getTask("repo-1", "task-1")

            expect(taskReadRequests).toEqual([{ hydrateSessionEvents: false }])

            await store.refreshTask("repo-1", "task-1")
            expect(taskReadRequests).toEqual([{ hydrateSessionEvents: false }, { hydrateSessionEvents: false }])

            taskReadRequests.length = 0
            await store.getTask("repo-1", "task-1", { hydrateSessionEvents: true })
            await store.getTask("repo-1", "task-1", { hydrateSessionEvents: true })

            expect(taskReadRequests).toEqual([{ hydrateSessionEvents: true }, { hydrateSessionEvents: true }])
        } finally {
            store.destroy()
            await runtime.close()
        }
    })

    it("refreshes task previews through the scoped task-list method without rereading the snapshot", async () => {
        const { store, runtime, snapshotRequestCount, taskListRequestCount } = createRuntimeBackedStore()

        try {
            await store.refreshSnapshot()
            const snapshotRequests = snapshotRequestCount()

            const previews = await store.listTasks("repo-1", { bypassCache: true })

            expect(previews).toEqual([expect.objectContaining({ id: "task-1", title: "Original task" })])
            expect(taskListRequestCount()).toBe(1)
            expect(snapshotRequestCount()).toBe(snapshotRequests)
            expect(store.snapshot?.repos[0]?.tasks).toEqual(previews)
            expect(store.getCachedProjects()?.[0]?.tasks).toEqual(previews)
        } finally {
            store.destroy()
            await runtime.close()
        }
    })

    it("reuses fresh runtime-list reads and invalidates them after accepted mutations and runtime notifications", async () => {
        const { store, runtime, server, runtimeListRequestCount } = createRuntimeBackedStore()
        const params = {
            ownerType: "openade-task",
            statuses: ["starting", "running"] as RuntimeRecord["status"][],
        }

        try {
            server.supervisor.register(runtimeRecord("runtime-1", "running", "task-1", "2026-05-31T00:01:00.000Z"))

            await expect(store.listRuntimes(params)).resolves.toEqual([
                expect.objectContaining({
                    runtimeId: "runtime-1",
                    status: "running",
                    scope: { ownerType: "openade-task", ownerId: "task-1" },
                }),
            ])
            await expect(store.listRuntimes(params)).resolves.toEqual([expect.objectContaining({ runtimeId: "runtime-1", status: "running" })])

            expect(runtimeListRequestCount()).toBe(1)

            await store.startTurn(
                {
                    repoId: "repo-1",
                    inTaskId: "task-1",
                    type: "do",
                    input: "Clear runtime cache",
                },
                { clientRequestId: "runtime-list-turn" }
            )
            await expect(store.listRuntimes(params)).resolves.toEqual([
                expect.objectContaining({
                    runtimeId: "openade-turn:runtime-list-turn",
                    status: "running",
                }),
                expect.objectContaining({ runtimeId: "runtime-1", status: "running" }),
            ])
            expect(runtimeListRequestCount()).toBe(2)

            store.subscribe()
            const runtime2 = runtimeRecord("runtime-2", "running", "task-2", "2026-05-31T00:02:00.000Z")
            server.supervisor.register(runtime2)
            server.notify("runtime/updated", runtime2)
            await flushAsyncNotifications()

            await expect(store.listRuntimes(params)).resolves.toEqual([
                expect.objectContaining({
                    runtimeId: "openade-turn:runtime-list-turn",
                    status: "running",
                }),
                expect.objectContaining({
                    runtimeId: "runtime-2",
                    status: "running",
                    scope: { ownerType: "openade-task", ownerId: "task-2" },
                }),
                expect.objectContaining({
                    runtimeId: "runtime-1",
                    status: "running",
                    scope: { ownerType: "openade-task", ownerId: "task-1" },
                }),
            ])
            expect(runtimeListRequestCount()).toBe(3)
        } finally {
            store.destroy()
            await runtime.close()
        }
    })

    it("coalesces concurrent runtime-list reads before hitting the runtime handler", async () => {
        const runtimeListGate = createDeferred()
        const { store, runtime, server, runtimeListRequestCount } = createRuntimeBackedStore({
            beforeRuntimeList: () => runtimeListGate.promise,
        })
        const params = {
            ownerType: "openade-task",
            statuses: ["starting", "running"] as RuntimeRecord["status"][],
        }

        try {
            server.supervisor.register(runtimeRecord("runtime-1", "running", "task-1", "2026-05-31T00:01:00.000Z"))

            const first = store.listRuntimes(params)
            const second = store.listRuntimes(params)
            await new Promise((resolve) => setTimeout(resolve, 0))

            expect(runtimeListRequestCount()).toBe(1)

            runtimeListGate.resolve()
            await expect(Promise.all([first, second])).resolves.toEqual([
                [expect.objectContaining({ runtimeId: "runtime-1", status: "running" })],
                [expect.objectContaining({ runtimeId: "runtime-1", status: "running" })],
            ])
            expect(runtimeListRequestCount()).toBe(1)

            await expect(store.listRuntimes(params)).resolves.toEqual([expect.objectContaining({ runtimeId: "runtime-1", status: "running" })])
            expect(runtimeListRequestCount()).toBe(1)
        } finally {
            store.destroy()
            await runtime.close()
        }
    })

    it("does not cache an invalidated in-flight runtime-list read", async () => {
        const runtimeListGate = createDeferred()
        const { store, runtime, server, runtimeListRequestCount } = createRuntimeBackedStore({
            beforeRuntimeList: () => runtimeListGate.promise,
        })
        const params = {
            ownerType: "openade-task",
            statuses: ["starting", "running"] as RuntimeRecord["status"][],
        }

        try {
            server.supervisor.register(runtimeRecord("runtime-1", "running", "task-1", "2026-05-31T00:01:00.000Z"))

            const first = store.listRuntimes(params)
            await new Promise((resolve) => setTimeout(resolve, 0))
            expect(runtimeListRequestCount()).toBe(1)

            await store.handleNotification({
                method: "runtime/updated",
                params: runtimeRecord("runtime-notification", "running", "task-notified", "2026-05-31T00:02:00.000Z"),
            })

            runtimeListGate.resolve()
            await expect(first).resolves.toEqual([expect.objectContaining({ runtimeId: "runtime-1", status: "running" })])
            expect(store.runtimes.get("runtime-notification")).toEqual(expect.objectContaining({ runtimeId: "runtime-notification" }))
            expect(store.runtimes.get("runtime-1")).toBeUndefined()

            await expect(store.listRuntimes(params)).resolves.toEqual([expect.objectContaining({ runtimeId: "runtime-1", status: "running" })])
            expect(runtimeListRequestCount()).toBe(2)
        } finally {
            store.destroy()
            await runtime.close()
        }
    })

    it("keeps default task detail refreshes lightweight unless hydration is requested", async () => {
        const { store, runtime, taskReadRequests } = createRuntimeBackedStore()

        try {
            await store.getTask("repo-1", "task-1")
            await store.updateTaskMetadata({ taskId: "task-1", title: "Lightweight metadata refresh" }, { clientRequestId: "metadata-lightweight" })
            await store.createComment(
                {
                    taskId: "task-1",
                    commentId: "comment-lightweight",
                    content: "Do not hydrate sessions",
                    source: { type: "manual" },
                    selectedText: { text: "hydrate", linesBefore: "", linesAfter: "" },
                    author: { id: "user-1", email: "user@example.com" },
                },
                { clientRequestId: "comment-lightweight" }
            )
            await store.generateTaskTitle({ repoId: "repo-1", taskId: "task-1", harnessId: "codex" }, { clientRequestId: "title-lightweight" })
            await store.startTurn(
                {
                    repoId: "repo-1",
                    inTaskId: "task-1",
                    type: "do",
                    input: "Run lightweight",
                },
                { clientRequestId: "turn-lightweight" }
            )

            expect(taskReadRequests).not.toHaveLength(0)
            expect(taskReadRequests.every((options) => options.hydrateSessionEvents === false)).toBe(true)

            taskReadRequests.length = 0
            await store.getTask("repo-1", "task-1", { hydrateSessionEvents: true })
            expect(taskReadRequests).toEqual([{ hydrateSessionEvents: true }])
        } finally {
            store.destroy()
            await runtime.close()
        }
    })

    it("patches accepted metadata locally without re-reading task detail or snapshot", async () => {
        const { store, runtime, taskReadRequests, snapshotRequestCount } = createRuntimeBackedStore()
        const lastViewedAt = "2026-01-01T00:10:00.000Z"
        const lastEventAt = "2026-01-01T00:11:00.000Z"
        const updatedAt = "2026-01-01T00:12:00.000Z"
        const usage = {
            usageVersion: 1,
            inputTokens: 10,
            outputTokens: 5,
            totalCostUsd: 0.01,
            eventCount: 2,
            costByModel: { "model-1": 0.01 },
        }

        try {
            await store.refreshSnapshot()
            await store.getTask("repo-1", "task-1")

            taskReadRequests.length = 0
            const existingSnapshotRequests = snapshotRequestCount()
            await store.updateTaskMetadata(
                {
                    taskId: "task-1",
                    title: "Accepted metadata",
                    closed: true,
                    lastViewedAt,
                    lastEventAt,
                    cancelledPlanEventId: "event-plan",
                    usage,
                    enabledMcpServerIds: ["server-1"],
                    sessionIds: { claude: "session-1" },
                    queuedTurns: [],
                    updatedAt,
                },
                { clientRequestId: "metadata-patch" }
            )

            expect(taskReadRequests).toEqual([])
            expect(snapshotRequestCount()).toBe(existingSnapshotRequests)
            expect(store.snapshot?.repos[0]?.tasks[0]).toMatchObject({
                title: "Accepted metadata",
                closed: true,
                lastViewedAt,
                lastEventAt,
                usage,
            })
            expect(store.getCachedTask("repo-1", "task-1")).toMatchObject({
                title: "Accepted metadata",
                closed: true,
                lastViewedAt,
                lastEventAt,
                cancelledPlanEventId: "event-plan",
                enabledMcpServerIds: ["server-1"],
                sessionIds: { claude: "session-1" },
                queuedTurns: [],
                updatedAt,
            })
        } finally {
            store.destroy()
            await runtime.close()
        }
    })

    it("patches accepted repo mutations locally without re-reading the snapshot", async () => {
        const { store, runtime, snapshotRequestCount } = createRuntimeBackedStore()

        try {
            await store.refreshSnapshot()
            const existingSnapshotRequests = snapshotRequestCount()

            await store.createRepo(
                {
                    repoId: "repo-1",
                    name: "Existing repo",
                    path: "/tmp/existing",
                    createdBy: { id: "user-1", email: "user@example.com" },
                },
                { clientRequestId: "repo-create-existing-cache" }
            )
            expect(snapshotRequestCount()).toBe(existingSnapshotRequests)
            expect(store.snapshot?.repos.find((repo) => repo.id === "repo-1")).toEqual(
                expect.objectContaining({
                    id: "repo-1",
                    name: "Existing repo",
                    path: "/tmp/existing",
                    tasks: [expect.objectContaining({ id: "task-1" })],
                })
            )

            await store.createRepo(
                {
                    repoId: "repo-created",
                    name: "Created repo",
                    path: "/tmp/created",
                    createdBy: { id: "user-1", email: "user@example.com" },
                },
                { clientRequestId: "repo-create-cache" }
            )
            expect(snapshotRequestCount()).toBe(existingSnapshotRequests)
            expect(store.snapshot?.repos).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        id: "repo-created",
                        name: "Created repo",
                        path: "/tmp/created",
                    }),
                ])
            )

            await store.updateRepo({ repoId: "repo-created", name: "Renamed repo", archived: true }, { clientRequestId: "repo-update-cache" })
            expect(snapshotRequestCount()).toBe(existingSnapshotRequests)
            expect(store.snapshot?.repos.find((repo) => repo.id === "repo-created")).toEqual(
                expect.objectContaining({
                    id: "repo-created",
                    name: "Renamed repo",
                    path: "/tmp/created",
                    archived: true,
                })
            )

            await store.deleteRepo({ repoId: "repo-created" }, { clientRequestId: "repo-delete-cache" })
            expect(snapshotRequestCount()).toBe(existingSnapshotRequests)
            expect(store.snapshot?.repos.some((repo) => repo.id === "repo-created")).toBe(false)
        } finally {
            store.destroy()
            await runtime.close()
        }
    })

    it("patches accepted title and comment mutations locally without post-accept task or snapshot rereads", async () => {
        const { store, runtime, taskReadRequests, snapshotRequestCount } = createRuntimeBackedStore()

        try {
            await store.refreshSnapshot()
            await store.getTask("repo-1", "task-1")

            taskReadRequests.length = 0
            const existingSnapshotRequests = snapshotRequestCount()

            await store.generateTaskTitle({ repoId: "repo-1", taskId: "task-1", harnessId: "codex" }, { clientRequestId: "title-cache" })
            expect(store.snapshot?.repos[0]?.tasks[0]?.title).toBe("Generated task title")
            expect(store.getCachedTask("repo-1", "task-1")?.title).toBe("Generated task title")
            expect(taskReadRequests).toEqual([{ hydrateSessionEvents: false }])
            taskReadRequests.length = 0

            await store.createComment(
                {
                    taskId: "task-1",
                    commentId: "comment-local",
                    content: "Accepted comment",
                    source: { type: "manual" },
                    selectedText: { text: "accepted", linesBefore: "", linesAfter: "" },
                    author: { id: "user-1", email: "user@example.com" },
                    createdAt: "2026-01-01T00:00:00.000Z",
                },
                { clientRequestId: "comment-create-cache" }
            )
            expect(store.getCachedTask("repo-1", "task-1")?.comments).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        id: "comment-local",
                        content: "Accepted comment",
                    }),
                ])
            )

            await store.editComment(
                {
                    taskId: "task-1",
                    commentId: "comment-local",
                    content: "Edited accepted comment",
                    updatedAt: "2026-01-01T00:01:00.000Z",
                },
                { clientRequestId: "comment-edit-cache" }
            )
            expect(store.getCachedTask("repo-1", "task-1")?.comments).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        id: "comment-local",
                        content: "Edited accepted comment",
                    }),
                ])
            )

            await store.deleteComment({ taskId: "task-1", commentId: "comment-local" }, { clientRequestId: "comment-delete-cache" })
            expect(store.getCachedTask("repo-1", "task-1")?.comments).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: "comment-local" })]))

            expect(taskReadRequests).toEqual([])
            expect(snapshotRequestCount()).toBe(existingSnapshotRequests)
        } finally {
            store.destroy()
            await runtime.close()
        }
    })

    it("patches accepted existing-task turn and review starts locally without post-accept task or snapshot rereads", async () => {
        const { store, runtime, taskReadRequests, snapshotRequestCount } = createRuntimeBackedStore()

        try {
            await store.refreshSnapshot()
            await store.getTask("repo-1", "task-1")

            taskReadRequests.length = 0
            const existingSnapshotRequests = snapshotRequestCount()

            const turn = await store.startTurn(
                {
                    repoId: "repo-1",
                    inTaskId: "task-1",
                    type: "do",
                    input: "Run cache patch",
                    harnessId: "codex",
                    modelId: "gpt-test",
                },
                { clientRequestId: "turn-cache-patch" }
            )
            expect(turn).toEqual({
                taskId: "task-1",
                eventId: "event-1",
                executionId: "exec-1",
                createdAt: now(),
            })
            expect(store.getCachedTask("repo-1", "task-1")?.events).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        id: "event-1",
                        type: "action",
                        status: "in_progress",
                        userInput: "Run cache patch",
                        source: { type: "do", userLabel: "do" },
                    }),
                ])
            )
            expect(store.snapshot?.repos[0]?.tasks[0]?.lastEvent).toEqual(
                expect.objectContaining({
                    type: "action",
                    status: "in_progress",
                    sourceType: "do",
                    sourceLabel: "do",
                    at: now(),
                })
            )
            expect(store.snapshot?.workingTaskIds).toEqual(["task-1"])

            const review = await store.startReview(
                {
                    repoId: "repo-1",
                    taskId: "task-1",
                    reviewType: "plan",
                    harnessId: "codex",
                    modelId: "gpt-test",
                    thinking: "max",
                    fastMode: true,
                    customInstructions: "Check plan",
                },
                { clientRequestId: "review-cache-patch" }
            )
            expect(review).toEqual({
                taskId: "task-1",
                eventId: "event-review",
                executionId: "exec-review",
                createdAt: now(),
            })
            expect(store.getCachedTask("repo-1", "task-1")?.events).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        id: "event-review",
                        type: "action",
                        status: "in_progress",
                        userInput: "Review Plan: Check plan",
                        execution: expect.objectContaining({
                            harnessId: "codex",
                            modelId: "gpt-test",
                            fastMode: true,
                        }),
                        source: expect.objectContaining({
                            type: "review",
                            userLabel: "Review Plan",
                            reviewType: "plan",
                        }),
                    }),
                ])
            )
            expect(store.snapshot?.repos[0]?.tasks[0]?.lastEvent).toEqual(
                expect.objectContaining({
                    type: "action",
                    status: "in_progress",
                    sourceType: "review",
                    sourceLabel: "Review Plan",
                    at: now(),
                })
            )

            expect(taskReadRequests).toEqual([])
            expect(snapshotRequestCount()).toBe(existingSnapshotRequests)
        } finally {
            store.destroy()
            await runtime.close()
        }
    })

    it("patches accepted new-task turn starts locally without post-accept task or snapshot rereads", async () => {
        const { store, runtime, taskReadRequests, snapshotRequestCount } = createRuntimeBackedStore()

        try {
            await store.refreshSnapshot()
            taskReadRequests.length = 0
            const existingSnapshotRequests = snapshotRequestCount()

            const result = await store.startTurn(
                {
                    repoId: "repo-1",
                    type: "do",
                    input: "Create a runtime-backed task",
                    isolationStrategy: { type: "head" },
                    harnessId: "codex",
                    modelId: "gpt-test",
                },
                { clientRequestId: "turn-new-task-cache-patch" }
            )

            expect(result).toEqual(
                expect.objectContaining({
                    taskId: "task-created",
                    eventId: "event-created",
                    executionId: "exec-created",
                    createdAt: now(),
                    task: expect.objectContaining({
                        id: "task-created",
                        description: "Create a runtime-backed task",
                    }),
                    preview: expect.objectContaining({
                        id: "task-created",
                        title: "Created runtime task",
                    }),
                })
            )
            expect(store.getCachedTask("repo-1", "task-created")).toEqual(
                expect.objectContaining({
                    id: "task-created",
                    events: expect.arrayContaining([
                        expect.objectContaining({
                            id: "event-created",
                            status: "in_progress",
                        }),
                    ]),
                })
            )
            expect(store.snapshot?.repos[0]?.tasks).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        id: "task-created",
                        lastEvent: expect.objectContaining({ status: "in_progress" }),
                    }),
                ])
            )
            expect(store.snapshot?.workingTaskIds).toEqual(["task-created"])
            expect(taskReadRequests).toEqual([])
            expect(snapshotRequestCount()).toBe(existingSnapshotRequests)
        } finally {
            store.destroy()
            await runtime.close()
        }
    })

    it("suppresses self-accepted action-start notifications without hiding later task updates", async () => {
        const { store, runtime, taskReadRequests, publishActionEventUpdated } = createRuntimeBackedStore()

        try {
            store.subscribe()
            await store.refreshSnapshot()
            await store.getTask("repo-1", "task-1")

            taskReadRequests.length = 0
            await store.startTurn(
                {
                    repoId: "repo-1",
                    inTaskId: "task-1",
                    type: "do",
                    input: "Run with tagged notification",
                },
                { clientRequestId: "turn-tagged-notification" }
            )
            await waitForNotificationCoalescing()
            expect(taskReadRequests).toEqual([])

            publishActionEventUpdated("repo-1", "task-1", "event-1", "completed")
            await waitForNotificationCoalescing()
            expect(taskReadRequests).toEqual([{ hydrateSessionEvents: false }])
        } finally {
            store.destroy()
            await runtime.close()
        }
    })

    it("suppresses self-accepted mutation notifications without hiding later task updates", async () => {
        const { store, runtime, taskReadRequests, snapshotRequestCount, publishTaskUpdated } = createRuntimeBackedStore()

        try {
            store.subscribe()
            await store.refreshSnapshot()
            await store.getTask("repo-1", "task-1")
            await store.updateTaskMetadata(
                {
                    taskId: "task-1",
                    queuedTurns: [
                        {
                            id: "queued-1",
                            type: "do",
                            input: "Queued runtime follow-up",
                            status: "queued",
                            createdAt: "2026-01-01T00:00:00.000Z",
                            updatedAt: "2026-01-01T00:00:00.000Z",
                        },
                    ],
                },
                { clientRequestId: "mutation-notification-seed" }
            )
            await waitForNotificationCoalescing()

            taskReadRequests.length = 0
            const existingSnapshotRequests = snapshotRequestCount()
            await store.updateTaskMetadata({ taskId: "task-1", title: "Tagged metadata echo" }, { clientRequestId: "metadata-tagged-echo" })
            await store.createComment(
                {
                    taskId: "task-1",
                    commentId: "comment-tagged-echo",
                    content: "Tagged comment echo",
                    source: { type: "manual" },
                    selectedText: { text: "tagged", linesBefore: "", linesAfter: "" },
                    author: { id: "user-1", email: "user@example.com" },
                },
                { clientRequestId: "comment-tagged-echo" }
            )
            await store.cancelQueuedTurn({ repoId: "repo-1", taskId: "task-1", queuedTurnId: "queued-1" }, { clientRequestId: "queue-tagged-echo" })
            await waitForNotificationCoalescing()

            expect(taskReadRequests).toEqual([])
            expect(snapshotRequestCount()).toBe(existingSnapshotRequests)
            expect(store.getCachedTask("repo-1", "task-1")).toMatchObject({
                title: "Tagged metadata echo",
                queuedTurns: [expect.objectContaining({ id: "queued-1", status: "cancelled" })],
            })
            expect(store.getCachedTask("repo-1", "task-1")?.comments).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        id: "comment-tagged-echo",
                        content: "Tagged comment echo",
                    }),
                ])
            )

            publishTaskUpdated("repo-1", "task-1")
            await waitForNotificationCoalescing()
            expect(taskReadRequests).toEqual([{ hydrateSessionEvents: false }])
        } finally {
            store.destroy()
            await runtime.close()
        }
    })

    it("suppresses self-accepted mutation notifications on the direct runtime bridge path", async () => {
        const { store, runtime, taskReadRequests, snapshotRequestCount } = createRuntimeBackedStore()

        try {
            await store.refreshSnapshot()
            await store.getTask("repo-1", "task-1")

            taskReadRequests.length = 0
            const existingSnapshotRequests = snapshotRequestCount()
            await store.updateTaskMetadata({ taskId: "task-1", title: "Direct tagged metadata echo" }, { clientRequestId: "metadata-direct-echo" })

            await expect(
                store.handleNotification({
                    method: "openade/task/updated",
                    params: {
                        repoId: "repo-1",
                        taskId: "task-1",
                        clientRequestId: "metadata-direct-echo",
                        at: now(),
                    },
                })
            ).resolves.toBe(true)
            await expect(
                store.handleNotification({
                    method: "openade/task/previewChanged",
                    params: {
                        repoId: "repo-1",
                        taskId: "task-1",
                        clientRequestId: "metadata-direct-echo",
                        at: now(),
                    },
                })
            ).resolves.toBe(true)

            expect(taskReadRequests).toEqual([])
            expect(snapshotRequestCount()).toBe(existingSnapshotRequests)

            await expect(
                store.handleNotification({
                    method: "openade/task/previewChanged",
                    params: { repoId: "repo-1", taskId: "task-1", at: now() },
                })
            ).resolves.toBe(true)
            expect(taskReadRequests).toEqual([])
            expect(snapshotRequestCount()).toBe(existingSnapshotRequests + 1)
        } finally {
            store.destroy()
            await runtime.close()
        }
    })

    it("suppresses self-accepted action-start notifications on the direct runtime bridge path", async () => {
        const { store, runtime, taskReadRequests } = createRuntimeBackedStore()

        try {
            await store.refreshSnapshot()
            await store.getTask("repo-1", "task-1")

            taskReadRequests.length = 0
            await store.startTurn(
                {
                    repoId: "repo-1",
                    inTaskId: "task-1",
                    type: "do",
                    input: "Run through direct bridge",
                },
                { clientRequestId: "turn-direct-echo" }
            )
            await expect(
                store.handleNotification({
                    method: "openade/task/updated",
                    params: {
                        repoId: "repo-1",
                        taskId: "task-1",
                        eventId: "event-1",
                        eventStatus: "in_progress",
                        at: now(),
                    },
                })
            ).resolves.toBe(true)
            expect(taskReadRequests).toEqual([])

            await expect(
                store.handleNotification({
                    method: "openade/task/updated",
                    params: {
                        repoId: "repo-1",
                        taskId: "task-1",
                        eventId: "event-1",
                        eventStatus: "completed",
                        at: now(),
                    },
                })
            ).resolves.toBe(true)
            expect(taskReadRequests).toEqual([{ hydrateSessionEvents: false }])
        } finally {
            store.destroy()
            await runtime.close()
        }
    })

    it("patches accepted queue, usage, and task deletion mutations locally without task or snapshot rereads", async () => {
        const { store, runtime, taskReadRequests, snapshotRequestCount } = createRuntimeBackedStore()

        try {
            await store.refreshSnapshot()
            await store.getTask("repo-1", "task-1")
            await store.enqueueQueuedTurn(
                {
                    repoId: "repo-1",
                    taskId: "task-1",
                    queuedTurnId: "queued-1",
                    type: "do",
                    input: "Queued runtime follow-up",
                    createdAt: "2026-01-01T00:00:00.000Z",
                },
                { clientRequestId: "queue-seed-cache" }
            )
            await waitForNotificationCoalescing()

            taskReadRequests.length = 0
            const existingSnapshotRequests = snapshotRequestCount()

            const enqueued = await store.enqueueQueuedTurn(
                {
                    repoId: "repo-1",
                    taskId: "task-1",
                    type: "ask",
                    input: "Queued runtime question",
                },
                { clientRequestId: "queue-enqueue-cache" }
            )
            expect(store.getCachedTask("repo-1", "task-1")?.queuedTurns).toEqual([
                expect.objectContaining({ id: "queued-1", status: "queued" }),
                expect.objectContaining({
                    id: enqueued.queuedTurnId,
                    input: "Queued runtime question",
                    status: "queued",
                }),
            ])

            await store.reorderQueuedTurns(
                {
                    repoId: "repo-1",
                    taskId: "task-1",
                    queuedTurnIds: [enqueued.queuedTurnId, "queued-1"],
                },
                { clientRequestId: "queue-reorder-cache" }
            )
            expect(store.getCachedTask("repo-1", "task-1")?.queuedTurns?.map((turn) => turn.id)).toEqual([enqueued.queuedTurnId, "queued-1"])

            await store.cancelQueuedTurn({ repoId: "repo-1", taskId: "task-1", queuedTurnId: "queued-1" }, { clientRequestId: "queue-cancel-cache" })
            expect(store.getCachedTask("repo-1", "task-1")?.queuedTurns).toEqual([
                expect.objectContaining({
                    id: enqueued.queuedTurnId,
                    status: "queued",
                }),
                expect.objectContaining({ id: "queued-1", status: "cancelled" }),
            ])

            await store.backfillTaskUsage({ repoId: "repo-1", taskIds: ["task-1"] }, { clientRequestId: "usage-backfill-cache" })
            expect(store.snapshot?.repos[0]?.tasks[0]?.usage).toMatchObject({
                usageVersion: 2,
                inputTokens: 11,
            })

            await store.recalculateTaskUsage({ repoId: "repo-1", taskId: "task-1" }, { clientRequestId: "usage-recalculate-cache" })
            expect(store.snapshot?.repos[0]?.tasks[0]?.usage).toMatchObject({
                usageVersion: 2,
                inputTokens: 17,
            })

            await store.deleteTask({ repoId: "repo-1", taskId: "task-1" }, { clientRequestId: "task-delete-cache" })
            expect(store.getCachedTask("repo-1", "task-1")).toBeNull()
            expect(store.snapshot?.repos[0]?.tasks).toEqual([])

            await waitForNotificationCoalescing()
            expect(taskReadRequests).toEqual([])
            expect(snapshotRequestCount()).toBe(existingSnapshotRequests)
        } finally {
            store.destroy()
            await runtime.close()
        }
    })

    it("patches accepted task environment mutations locally without follow-up task or snapshot rereads", async () => {
        const { store, runtime, taskReadRequests, snapshotRequestCount } = createRuntimeBackedStore()

        try {
            await store.refreshSnapshot()
            await store.getTask("repo-1", "task-1")

            taskReadRequests.length = 0
            const existingSnapshotRequests = snapshotRequestCount()

            await store.setupTaskEnvironment(
                {
                    taskId: "task-1",
                    deviceEnvironment: {
                        id: "device-local",
                        deviceId: "device-local",
                        worktreeDir: "/tmp/local-worktree",
                        setupComplete: true,
                        mergeBaseCommit: "abc123",
                        createdAt: "2026-01-01T00:00:00.000Z",
                        lastUsedAt: "2026-01-01T00:00:00.000Z",
                    },
                    setupEvent: {
                        eventId: "setup-local-device",
                        worktreeId: "local-worktree",
                        deviceId: "device-local",
                        workingDir: "/tmp/local-worktree",
                        createdAt: "2026-01-01T00:00:00.000Z",
                        completedAt: "2026-01-01T00:00:01.000Z",
                        setupOutput: "Local environment ready",
                    },
                },
                { clientRequestId: "setup-env-cache" }
            )

            expect(store.getCachedTask("repo-1", "task-1")?.deviceEnvironments).toEqual([
                expect.objectContaining({
                    id: "device-local",
                    worktreeDir: "/tmp/local-worktree",
                }),
            ])
            expect(store.getCachedTask("repo-1", "task-1")?.events).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        id: "setup-local-device",
                        type: "setup_environment",
                        workingDir: "/tmp/local-worktree",
                    }),
                ])
            )
            expect(store.snapshot?.repos[0]?.tasks[0]?.lastEvent).toEqual(
                expect.objectContaining({
                    type: "setup_environment",
                    status: "completed",
                    sourceLabel: "Setup",
                    at: "2026-01-01T00:00:01.000Z",
                })
            )
            expect(taskReadRequests).toEqual([])

            await store.prepareTaskEnvironment({ repoId: "repo-1", taskId: "task-1" }, { clientRequestId: "prepare-env-cache" })
            expect(store.getCachedTask("repo-1", "task-1")?.deviceEnvironments).toEqual([
                expect.objectContaining({ id: "device-local" }),
                expect.objectContaining({ id: "runtime-device", setupComplete: true }),
            ])
            expect(store.getCachedTask("repo-1", "task-1")?.events).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        id: "setup-runtime-device",
                        type: "setup_environment",
                        setupOutput: "Runtime environment ready",
                    }),
                ])
            )

            expect(taskReadRequests).toEqual([{ hydrateSessionEvents: false }])
            expect(snapshotRequestCount()).toBe(existingSnapshotRequests)
        } finally {
            store.destroy()
            await runtime.close()
        }
    })

    it("coalesces subscribed task update notifications before refreshing task detail", async () => {
        const { store, runtime, taskReadRequests, publishTaskChanged } = createRuntimeBackedStore()

        try {
            await store.refreshSnapshot()
            await store.getTask("repo-1", "task-1")
            store.subscribe()

            taskReadRequests.length = 0
            publishTaskChanged(false)
            publishTaskChanged(false)
            publishTaskChanged(false)
            await waitForNotificationCoalescing()

            expect(taskReadRequests).toEqual([{ hydrateSessionEvents: false }])

            taskReadRequests.length = 0
            publishTaskChanged(true)
            await waitForNotificationCoalescing()

            expect(taskReadRequests).toEqual([])
        } finally {
            store.destroy()
            await runtime.close()
        }
    })

    it("does not read uncached task detail for background task update notifications", async () => {
        const { store, runtime, taskReadRequests, publishTaskUpdated } = createRuntimeBackedStore()

        try {
            await store.refreshSnapshot()
            store.subscribe()

            taskReadRequests.length = 0
            publishTaskUpdated("repo-1", "task-background")
            await waitForNotificationCoalescing()

            expect(taskReadRequests).toEqual([])
            expect(store.getCachedTask("repo-1", "task-background")).toBeNull()
        } finally {
            store.destroy()
            await runtime.close()
        }
    })

    it("reuses fresh process-list reads and invalidates them after process config mutations", async () => {
        const { store, runtime, processListRequestCount } = createRuntimeBackedStore()

        try {
            await store.listProjectProcesses({ repoId: "repo-1" })
            await store.listProjectProcesses({ repoId: "repo-1" })

            expect(processListRequestCount()).toBe(1)

            const started = await store.startProjectProcess(
                { repoId: "repo-1", definitionId: "openade.toml::Echo" },
                { clientRequestId: "process-cache-start" }
            )
            const withStartedProcess = await store.listProjectProcesses({
                repoId: "repo-1",
            })
            await store.listProjectProcesses({ repoId: "repo-1" })

            expect(withStartedProcess.instances).toEqual([
                expect.objectContaining({
                    processId: started.processId,
                    definitionId: "openade.toml::Echo",
                    completed: false,
                }),
            ])
            expect(processListRequestCount()).toBe(1)

            await store.stopProjectProcess({ repoId: "repo-1", processId: started.processId }, { clientRequestId: "process-cache-stop" })
            const afterStoppedProcess = await store.listProjectProcesses({
                repoId: "repo-1",
            })

            expect(afterStoppedProcess.instances).toEqual([])
            expect(processListRequestCount()).toBe(1)

            await store.writeProjectFile(
                {
                    repoId: "repo-1",
                    path: "nested/openade.toml",
                    content: '[process.echo]\ncmd = "echo hi"\n',
                },
                { clientRequestId: "process-cache-config-write" }
            )
            await store.listProjectProcesses({ repoId: "repo-1" })

            expect(processListRequestCount()).toBe(2)
        } finally {
            store.destroy()
            await runtime.close()
        }
    })

    it("reuses fresh cron-definition reads and invalidates them after process config mutations", async () => {
        const { store, runtime, cronDefinitionsRequestCount, processListRequestCount } = createRuntimeBackedStore()

        try {
            await expect(store.readCronDefinitions({ repoId: "repo-1" })).resolves.toMatchObject({
                configs: [
                    expect.objectContaining({
                        relativePath: "openade.toml",
                        crons: [
                            expect.objectContaining({
                                id: "openade.toml::Runtime Cron",
                                name: "Runtime Cron",
                            }),
                        ],
                    }),
                ],
            })
            await expect(store.readCronDefinitions({ repoId: "repo-1" })).resolves.toMatchObject({
                configs: [
                    expect.objectContaining({
                        crons: [expect.objectContaining({ id: "openade.toml::Runtime Cron" })],
                    }),
                ],
            })

            expect(cronDefinitionsRequestCount()).toBe(1)
            expect(processListRequestCount()).toBe(1)

            await store.writeProjectFile(
                {
                    repoId: "repo-1",
                    path: "openade.toml",
                    content: '[[cron]]\nname = "Runtime Cron"\nschedule = "0 9 * * *"\ntype = "do"\nprompt = "Run runtime cron"\n',
                },
                { clientRequestId: "cron-definitions-cache-config-write" }
            )
            await store.readCronDefinitions({ repoId: "repo-1" })

            expect(cronDefinitionsRequestCount()).toBe(2)
        } finally {
            store.destroy()
            await runtime.close()
        }
    })

    it("reuses fresh cron install state reads and patches accepted replace results", async () => {
        const { store, runtime, cronInstallStateReadRequestCount } = createRuntimeBackedStore()

        try {
            await expect(store.readCronInstallState({ repoId: "repo-1" })).resolves.toMatchObject({
                installations: {
                    "openade.toml::Runtime Cron": expect.objectContaining({
                        enabled: false,
                    }),
                },
            })
            await expect(store.readCronInstallState({ repoId: "repo-1" })).resolves.toMatchObject({
                installations: {
                    "openade.toml::Runtime Cron": expect.objectContaining({
                        enabled: false,
                    }),
                },
            })

            expect(cronInstallStateReadRequestCount()).toBe(1)

            await store.replaceCronInstallState(
                {
                    repoId: "repo-1",
                    installations: {
                        "openade.toml::Runtime Cron": {
                            cronId: "openade.toml::Runtime Cron",
                            enabled: true,
                            installedAt: "2026-05-30T00:00:00.000Z",
                            lastRunAt: "2026-06-01T00:00:00.000Z",
                        },
                    },
                },
                { clientRequestId: "cron-cache-replace" }
            )

            await expect(store.readCronInstallState({ repoId: "repo-1" })).resolves.toMatchObject({
                installations: {
                    "openade.toml::Runtime Cron": expect.objectContaining({
                        enabled: true,
                        lastRunAt: "2026-06-01T00:00:00.000Z",
                    }),
                },
            })
            expect(cronInstallStateReadRequestCount()).toBe(1)
        } finally {
            store.destroy()
            await runtime.close()
        }
    })

    it("reuses fresh project search reads and invalidates them after scoped file writes", async () => {
        const { store, runtime, fuzzySearchRequestCount, projectSearchRequestCount } = createRuntimeBackedStore()

        try {
            const fuzzyArgs = {
                repoId: "repo-1",
                taskId: "task-1",
                query: "runtime",
                limit: 10,
            }
            const searchArgs = {
                repoId: "repo-1",
                taskId: "task-1",
                query: "runtime",
                limit: 10,
                caseSensitive: false,
            }

            await expect(store.fuzzySearchProjectFiles(fuzzyArgs)).resolves.toMatchObject({ results: ["src/runtime.ts"] })
            await expect(store.fuzzySearchProjectFiles(fuzzyArgs)).resolves.toMatchObject({ results: ["src/runtime.ts"] })
            await expect(store.searchProject(searchArgs)).resolves.toMatchObject({
                matches: [expect.objectContaining({ path: "src/runtime.ts" })],
            })
            await expect(store.searchProject(searchArgs)).resolves.toMatchObject({
                matches: [expect.objectContaining({ path: "src/runtime.ts" })],
            })

            expect(fuzzySearchRequestCount()).toBe(1)
            expect(projectSearchRequestCount()).toBe(1)

            await store.writeProjectFile(
                {
                    repoId: "repo-1",
                    taskId: "task-1",
                    path: "src/runtime.ts",
                    content: "runtime product search\n",
                },
                { clientRequestId: "search-cache-write" }
            )

            await store.fuzzySearchProjectFiles(fuzzyArgs)
            await store.searchProject(searchArgs)

            expect(fuzzySearchRequestCount()).toBe(2)
            expect(projectSearchRequestCount()).toBe(2)
        } finally {
            store.destroy()
            await runtime.close()
        }
    })

    it("reuses fresh project file reads and invalidates them after scoped file writes", async () => {
        const { store, runtime, projectFilesTreeRequestCount, projectFileReadRequestCount } = createRuntimeBackedStore()

        try {
            const treeArgs = {
                repoId: "repo-1",
                taskId: "task-1",
                path: "src",
                maxDepth: 1,
            }
            const fileArgs = {
                repoId: "repo-1",
                taskId: "task-1",
                path: "src/runtime.ts",
            }

            await expect(store.listProjectFiles(treeArgs)).resolves.toMatchObject({
                path: "src",
                entries: [expect.objectContaining({ path: "src/runtime.ts", type: "file" })],
            })
            await expect(store.listProjectFiles(treeArgs)).resolves.toMatchObject({
                entries: [expect.objectContaining({ path: "src/runtime.ts" })],
            })
            await expect(store.readProjectFile(fileArgs)).resolves.toMatchObject({
                path: "src/runtime.ts",
                content: "runtime product file\n",
            })
            await expect(store.readProjectFile(fileArgs)).resolves.toMatchObject({
                path: "src/runtime.ts",
                content: "runtime product file\n",
            })

            expect(projectFilesTreeRequestCount()).toBe(1)
            expect(projectFileReadRequestCount()).toBe(1)

            await store.writeProjectFile(
                {
                    repoId: "repo-1",
                    taskId: "task-1",
                    path: "src/runtime.ts",
                    content: "runtime product file updated\n",
                },
                { clientRequestId: "file-cache-write" }
            )

            await store.listProjectFiles(treeArgs)
            await store.readProjectFile(fileArgs)

            expect(projectFilesTreeRequestCount()).toBe(2)
            expect(projectFileReadRequestCount()).toBe(2)
        } finally {
            store.destroy()
            await runtime.close()
        }
    })

    it("reuses fresh git reads while preserving explicit bypass and mutation invalidation", async () => {
        const {
            store,
            runtime,
            projectGitInfoRequestCount,
            projectGitBranchesRequestCount,
            projectGitSummaryRequestCount,
            taskGitSummaryRequestCount,
            taskGitScopesRequestCount,
            taskGitLogRequestCount,
            taskGitCommitFilesRequestCount,
            taskGitFileAtTreeishRequestCount,
            taskGitCommitFilePatchRequestCount,
            taskChangesRequestCount,
            taskDiffRequestCount,
            taskFilePairRequestCount,
        } = createRuntimeBackedStore()

        try {
            await store.readProjectGitInfo({ repoId: "repo-1" })
            await store.readProjectGitInfo({ repoId: "repo-1" })
            await store.readProjectGitBranches({ repoId: "repo-1" })
            await store.readProjectGitBranches({ repoId: "repo-1" })
            await store.readProjectGitBranches({
                repoId: "repo-1",
                includeRemote: true,
            })
            await store.readProjectGitBranches({
                repoId: "repo-1",
                includeRemote: true,
            })
            await store.readProjectGitSummary({ repoId: "repo-1" })
            await store.readProjectGitSummary({ repoId: "repo-1" })
            await store.readTaskGitSummary({ repoId: "repo-1", taskId: "task-1" })
            await store.readTaskGitSummary({ repoId: "repo-1", taskId: "task-1" })
            await store.readTaskGitScopes({
                repoId: "repo-1",
                taskId: "task-1",
                includeRemote: true,
            })
            await store.readTaskGitScopes({
                repoId: "repo-1",
                taskId: "task-1",
                includeRemote: true,
            })
            await store.readTaskGitLog({
                repoId: "repo-1",
                taskId: "task-1",
                ref: "HEAD",
                limit: 50,
                skip: 0,
            })
            await store.readTaskGitLog({
                repoId: "repo-1",
                taskId: "task-1",
                ref: "HEAD",
                limit: 50,
                skip: 0,
            })
            await store.readTaskGitCommitFiles({
                repoId: "repo-1",
                taskId: "task-1",
                commit: "abc123",
            })
            await store.readTaskGitCommitFiles({
                repoId: "repo-1",
                taskId: "task-1",
                commit: "abc123",
            })
            await store.readTaskGitFileAtTreeish({
                repoId: "repo-1",
                taskId: "task-1",
                treeish: "abc123",
                filePath: "README.md",
            })
            await store.readTaskGitFileAtTreeish({
                repoId: "repo-1",
                taskId: "task-1",
                treeish: "abc123",
                filePath: "README.md",
            })
            await store.readTaskGitCommitFilePatch({
                repoId: "repo-1",
                taskId: "task-1",
                commit: "abc123",
                filePath: "README.md",
            })
            await store.readTaskGitCommitFilePatch({
                repoId: "repo-1",
                taskId: "task-1",
                commit: "abc123",
                filePath: "README.md",
            })
            await store.readTaskChanges({
                repoId: "repo-1",
                taskId: "task-1",
                fromTreeish: "HEAD",
            })
            await store.readTaskChanges({
                repoId: "repo-1",
                taskId: "task-1",
                fromTreeish: "HEAD",
            })
            await store.readTaskDiff({
                repoId: "repo-1",
                taskId: "task-1",
                filePath: "README.md",
                contextLines: 3,
            })
            await store.readTaskDiff({
                repoId: "repo-1",
                taskId: "task-1",
                filePath: "README.md",
                contextLines: 3,
            })
            await store.readTaskFilePair({
                repoId: "repo-1",
                taskId: "task-1",
                filePath: "README.md",
            })
            await store.readTaskFilePair({
                repoId: "repo-1",
                taskId: "task-1",
                filePath: "README.md",
            })

            expect(projectGitInfoRequestCount()).toBe(1)
            expect(projectGitBranchesRequestCount()).toBe(2)
            expect(projectGitSummaryRequestCount()).toBe(1)
            expect(taskGitSummaryRequestCount()).toBe(1)
            expect(taskGitScopesRequestCount()).toBe(1)
            expect(taskGitLogRequestCount()).toBe(1)
            expect(taskGitCommitFilesRequestCount()).toBe(1)
            expect(taskGitFileAtTreeishRequestCount()).toBe(1)
            expect(taskGitCommitFilePatchRequestCount()).toBe(1)
            expect(taskChangesRequestCount()).toBe(1)
            expect(taskDiffRequestCount()).toBe(1)
            expect(taskFilePairRequestCount()).toBe(1)

            await store.readTaskGitSummary({ repoId: "repo-1", taskId: "task-1" }, { bypassCache: true })
            expect(taskGitSummaryRequestCount()).toBe(2)

            await store.writeProjectFile(
                {
                    repoId: "repo-1",
                    taskId: "task-1",
                    path: "src/runtime.ts",
                    content: "runtime product search\n",
                },
                { clientRequestId: "git-summary-cache-write" }
            )
            await store.readProjectGitSummary({ repoId: "repo-1" })
            await store.readTaskGitSummary({ repoId: "repo-1", taskId: "task-1" })
            await store.readTaskGitScopes({
                repoId: "repo-1",
                taskId: "task-1",
                includeRemote: true,
            })
            await store.readTaskGitLog({
                repoId: "repo-1",
                taskId: "task-1",
                ref: "HEAD",
                limit: 50,
                skip: 0,
            })
            await store.readTaskGitCommitFiles({
                repoId: "repo-1",
                taskId: "task-1",
                commit: "abc123",
            })
            await store.readTaskGitFileAtTreeish({
                repoId: "repo-1",
                taskId: "task-1",
                treeish: "abc123",
                filePath: "README.md",
            })
            await store.readTaskGitCommitFilePatch({
                repoId: "repo-1",
                taskId: "task-1",
                commit: "abc123",
                filePath: "README.md",
            })
            await store.readTaskChanges({
                repoId: "repo-1",
                taskId: "task-1",
                fromTreeish: "HEAD",
            })
            await store.readTaskDiff({
                repoId: "repo-1",
                taskId: "task-1",
                filePath: "README.md",
                contextLines: 3,
            })
            await store.readTaskFilePair({
                repoId: "repo-1",
                taskId: "task-1",
                filePath: "README.md",
            })

            expect(projectGitInfoRequestCount()).toBe(1)
            expect(projectGitSummaryRequestCount()).toBe(2)
            expect(taskGitSummaryRequestCount()).toBe(3)
            expect(taskGitScopesRequestCount()).toBe(2)
            expect(taskGitLogRequestCount()).toBe(2)
            expect(taskGitCommitFilesRequestCount()).toBe(2)
            expect(taskGitFileAtTreeishRequestCount()).toBe(2)
            expect(taskGitCommitFilePatchRequestCount()).toBe(2)
            expect(taskChangesRequestCount()).toBe(2)
            expect(taskDiffRequestCount()).toBe(2)
            expect(taskFilePairRequestCount()).toBe(2)

            await store.commitTaskGit(
                {
                    repoId: "repo-1",
                    taskId: "task-1",
                    message: "Commit cached git reads",
                },
                { clientRequestId: "git-read-cache-commit" }
            )
            await store.readTaskGitScopes({
                repoId: "repo-1",
                taskId: "task-1",
                includeRemote: true,
            })
            await store.readTaskGitLog({
                repoId: "repo-1",
                taskId: "task-1",
                ref: "HEAD",
                limit: 50,
                skip: 0,
            })
            await store.readTaskGitCommitFiles({
                repoId: "repo-1",
                taskId: "task-1",
                commit: "abc123",
            })
            await store.readTaskGitFileAtTreeish({
                repoId: "repo-1",
                taskId: "task-1",
                treeish: "abc123",
                filePath: "README.md",
            })
            await store.readTaskGitCommitFilePatch({
                repoId: "repo-1",
                taskId: "task-1",
                commit: "abc123",
                filePath: "README.md",
            })
            await store.readTaskChanges({
                repoId: "repo-1",
                taskId: "task-1",
                fromTreeish: "HEAD",
            })
            await store.readTaskDiff({
                repoId: "repo-1",
                taskId: "task-1",
                filePath: "README.md",
                contextLines: 3,
            })
            await store.readTaskFilePair({
                repoId: "repo-1",
                taskId: "task-1",
                filePath: "README.md",
            })

            expect(taskGitScopesRequestCount()).toBe(3)
            expect(taskGitLogRequestCount()).toBe(3)
            expect(taskGitCommitFilesRequestCount()).toBe(3)
            expect(taskGitFileAtTreeishRequestCount()).toBe(3)
            expect(taskGitCommitFilePatchRequestCount()).toBe(3)
            expect(taskChangesRequestCount()).toBe(3)
            expect(taskDiffRequestCount()).toBe(3)
            expect(taskFilePairRequestCount()).toBe(3)

            await store.updateRepo({ repoId: "repo-1", name: "Repo renamed" }, { clientRequestId: "git-info-cache-repo-update" })
            await store.readProjectGitInfo({ repoId: "repo-1" })
            await store.readProjectGitBranches({
                repoId: "repo-1",
                includeRemote: true,
            })

            expect(projectGitInfoRequestCount()).toBe(2)
            expect(projectGitBranchesRequestCount()).toBe(3)
        } finally {
            store.destroy()
            await runtime.close()
        }
    })

    it("reuses fresh snapshot artifact reads without serving deleted task artifacts", async () => {
        const { store, runtime, taskSnapshotPatchRequestCount, taskSnapshotIndexRequestCount, taskSnapshotPatchSliceRequestCount } = createRuntimeBackedStore()

        const patchArgs = {
            repoId: "repo-1",
            taskId: "task-1",
            eventId: "snapshot-1",
        }
        const sliceArgs = { ...patchArgs, start: 35, end: 59 }

        try {
            await expect(store.readTaskSnapshotPatch(patchArgs)).resolves.toMatchObject({
                patch: expect.stringContaining("+snapshot product store"),
            })
            await expect(store.readTaskSnapshotPatch(patchArgs)).resolves.toMatchObject({
                patch: expect.stringContaining("+snapshot product store"),
            })
            await expect(store.readTaskSnapshotIndex(patchArgs)).resolves.toMatchObject({
                index: expect.objectContaining({
                    files: [expect.objectContaining({ path: "README.md" })],
                }),
            })
            await expect(store.readTaskSnapshotIndex(patchArgs)).resolves.toMatchObject({
                index: expect.objectContaining({
                    files: [expect.objectContaining({ path: "README.md" })],
                }),
            })
            await expect(store.readTaskSnapshotPatchSlice(sliceArgs)).resolves.toMatchObject({
                patch: expect.stringContaining("snapshot product store"),
            })
            await expect(store.readTaskSnapshotPatchSlice(sliceArgs)).resolves.toMatchObject({
                patch: expect.stringContaining("snapshot product store"),
            })

            expect(taskSnapshotPatchRequestCount()).toBe(1)
            expect(taskSnapshotIndexRequestCount()).toBe(1)
            expect(taskSnapshotPatchSliceRequestCount()).toBe(1)

            await store.deleteTask({ repoId: "repo-1", taskId: "task-1" }, { clientRequestId: "snapshot-cache-delete" })

            await expect(store.readTaskSnapshotPatch(patchArgs)).rejects.toThrow()
            await expect(store.readTaskSnapshotIndex(patchArgs)).rejects.toThrow()
            await expect(store.readTaskSnapshotPatchSlice(sliceArgs)).rejects.toThrow()
        } finally {
            store.destroy()
            await runtime.close()
        }
    })

    it("reuses fresh task resource inventories and invalidates them after task and runtime changes", async () => {
        const { store, runtime, server, taskResourceInventoryRequestCount } = createRuntimeBackedStore()
        const args = { repoId: "repo-1", taskId: "task-1" }

        try {
            await expect(store.readTaskResourceInventory(args)).resolves.toMatchObject({
                taskTitle: "Original task",
                isRunning: false,
            })
            await expect(store.readTaskResourceInventory(args)).resolves.toMatchObject({
                taskTitle: "Original task",
                isRunning: false,
            })
            expect(taskResourceInventoryRequestCount()).toBe(1)

            await store.updateTaskMetadata({ taskId: "task-1", title: "Inventory title" }, { clientRequestId: "inventory-title" })
            await expect(store.readTaskResourceInventory(args)).resolves.toMatchObject({
                taskTitle: "Inventory title",
                isRunning: false,
            })
            expect(taskResourceInventoryRequestCount()).toBe(2)

            store.subscribe()
            const running = runtimeRecord("runtime-inventory", "running", "task-1", "2026-05-31T00:02:00.000Z")
            server.supervisor.register(running)
            server.notify("runtime/updated", running)
            await flushAsyncNotifications()

            await expect(store.readTaskResourceInventory(args)).resolves.toMatchObject({
                taskTitle: "Inventory title",
                isRunning: true,
            })
            expect(taskResourceInventoryRequestCount()).toBe(3)
        } finally {
            store.destroy()
            await runtime.close()
        }
    })

    it("reuses fresh product settings reads and patches accepted settings writes", async () => {
        const { store, runtime, mcpServersReadRequestCount, personalSettingsReadRequestCount } = createRuntimeBackedStore()
        const replacementServer: OpenADEMCPServer = {
            id: "mcp-http-1",
            name: "Runtime HTTP MCP",
            enabled: true,
            transportType: "http",
            url: "https://mcp.example.com",
            headers: {},
            healthStatus: "healthy",
            createdAt: now(),
            updatedAt: now(),
        }
        const upsertedServer: OpenADEMCPServer = {
            id: "mcp-stdio-2",
            name: "Runtime Stdio MCP 2",
            enabled: false,
            transportType: "stdio",
            command: "node",
            args: ["server-two.js"],
            healthStatus: "unknown",
            createdAt: now(),
            updatedAt: now(),
        }

        try {
            await expect(store.readMcpServers()).resolves.toMatchObject({
                servers: [expect.objectContaining({ id: "mcp-stdio-1" })],
            })
            await expect(store.readMcpServers()).resolves.toMatchObject({
                servers: [expect.objectContaining({ id: "mcp-stdio-1" })],
            })
            expect(mcpServersReadRequestCount()).toBe(1)

            await store.replaceMcpServers({ servers: [replacementServer] }, { clientRequestId: "settings-mcp-replace" })
            await expect(store.readMcpServers()).resolves.toMatchObject({
                servers: [expect.objectContaining({ id: "mcp-http-1" })],
            })
            expect(mcpServersReadRequestCount()).toBe(1)

            await store.upsertMcpServer({ server: upsertedServer }, { clientRequestId: "settings-mcp-upsert" })
            await expect(store.readMcpServers()).resolves.toMatchObject({
                servers: [expect.objectContaining({ id: "mcp-http-1" }), expect.objectContaining({ id: "mcp-stdio-2" })],
            })
            expect(mcpServersReadRequestCount()).toBe(1)

            await store.deleteMcpServer({ serverId: "mcp-http-1" }, { clientRequestId: "settings-mcp-delete" })
            await expect(store.readMcpServers()).resolves.toMatchObject({
                servers: [expect.objectContaining({ id: "mcp-stdio-2" })],
            })
            expect(mcpServersReadRequestCount()).toBe(1)

            await expect(store.readPersonalSettings()).resolves.toMatchObject({
                settings: { theme: "system", renderMarkdownMessages: true },
            })
            await expect(store.readPersonalSettings()).resolves.toMatchObject({
                settings: { theme: "system", renderMarkdownMessages: true },
            })
            expect(personalSettingsReadRequestCount()).toBe(1)

            await store.replacePersonalSettings(
                {
                    settings: {
                        envVars: { OPENADE_TEST_SETTING: "1" },
                        theme: "code-theme-light",
                        renderMarkdownMessages: false,
                    },
                },
                { clientRequestId: "settings-personal-replace" }
            )
            await expect(store.readPersonalSettings()).resolves.toMatchObject({
                settings: {
                    envVars: { OPENADE_TEST_SETTING: "1" },
                    theme: "code-theme-light",
                    renderMarkdownMessages: false,
                },
            })
            expect(personalSettingsReadRequestCount()).toBe(1)
        } finally {
            store.destroy()
            await runtime.close()
        }
    })

    it("reuses fresh task image reads and patches accepted staged image writes", async () => {
        const { store, runtime, taskImageReadRequestCount, stagedTaskImageReadRequestCount } = createRuntimeBackedStore()
        const taskImageArgs = {
            repoId: "repo-1",
            taskId: "task-1",
            imageId: "image-1",
            ext: "png",
        }
        const stagedImageArgs = { imageId: "image-written", ext: "png" }

        try {
            await expect(store.readTaskImage(taskImageArgs)).resolves.toMatchObject({
                imageId: "image-1",
                data: "aW1hZ2U=",
            })
            await expect(store.readTaskImage(taskImageArgs)).resolves.toMatchObject({
                imageId: "image-1",
                data: "aW1hZ2U=",
            })
            expect(taskImageReadRequestCount()).toBe(1)

            await store.deleteTask({ repoId: "repo-1", taskId: "task-1" }, { clientRequestId: "image-cache-delete" })
            await expect(store.readTaskImage(taskImageArgs)).rejects.toThrow()

            await expect(store.readStagedTaskImage(stagedImageArgs)).resolves.toMatchObject({ imageId: "image-written", data: null })
            await expect(store.readStagedTaskImage(stagedImageArgs)).resolves.toMatchObject({ imageId: "image-written", data: null })
            expect(stagedTaskImageReadRequestCount()).toBe(1)

            await store.writeTaskImage(
                {
                    imageId: "image-written",
                    ext: "png",
                    mediaType: "image/png",
                    data: "aW1hZ2U=",
                },
                { clientRequestId: "image-cache-write" }
            )
            await expect(store.readStagedTaskImage(stagedImageArgs)).resolves.toMatchObject({
                imageId: "image-written",
                mediaType: "image/png",
                data: "aW1hZ2U=",
            })
            expect(stagedTaskImageReadRequestCount()).toBe(1)
        } finally {
            store.destroy()
            await runtime.close()
        }
    })

    it("refreshes DTO state and runtime records through a real local runtime client", async () => {
        const { store, runtime, writtenImages } = createRuntimeBackedStore()
        store.subscribe()

        await expect(store.refreshSnapshot()).resolves.toMatchObject({
            repos: [{ id: "repo-1", tasks: [{ id: "task-1", title: "Original task" }] }],
        })
        await expect(store.getTask("repo-1", "task-1")).resolves.toMatchObject({
            title: "Original task",
            comments: [],
        })
        await expect(store.readTaskChanges({ repoId: "repo-1", taskId: "task-1" })).resolves.toMatchObject({
            files: [expect.objectContaining({ path: "README.md", status: "modified" })],
        })
        await expect(store.readProjectGitInfo({ repoId: "repo-1" })).resolves.toMatchObject({
            repoId: "repo-1",
            isGitRepo: true,
            mainBranch: "main",
        })
        await expect(store.readProjectGitBranches({ repoId: "repo-1", includeRemote: true })).resolves.toMatchObject({
            repoId: "repo-1",
            defaultBranch: "main",
            branches: [expect.objectContaining({ name: "main", isDefault: true }), expect.objectContaining({ name: "origin/feature", isRemote: true })],
        })
        await expect(store.readProjectGitSummary({ repoId: "repo-1" })).resolves.toMatchObject({
            repoId: "repo-1",
            branch: "main",
            hasChanges: true,
            unstaged: {
                files: [expect.objectContaining({ path: "README.md", status: "modified" })],
            },
        })
        await expect(store.readTaskGitSummary({ repoId: "repo-1", taskId: "task-1" })).resolves.toMatchObject({
            branch: "main",
            headCommit: "abc123",
            hasChanges: true,
            unstaged: {
                files: [expect.objectContaining({ path: "README.md", status: "modified" })],
            },
        })
        await expect(
            store.readTaskGitScopes({
                repoId: "repo-1",
                taskId: "task-1",
                includeRemote: true,
            })
        ).resolves.toMatchObject({
            defaultBranch: "main",
            scopes: [
                expect.objectContaining({
                    id: "branch:HEAD",
                    type: "branch",
                    ref: "HEAD",
                }),
                expect.objectContaining({
                    id: "branch:main",
                    type: "branch",
                    ref: "main",
                }),
            ],
        })
        await expect(store.prepareTaskEnvironment({ repoId: "repo-1", taskId: "task-1" }, { clientRequestId: "prepare-env" })).resolves.toMatchObject({
            repoId: "repo-1",
            taskId: "task-1",
            deviceEnvironment: expect.objectContaining({
                id: "runtime-device",
                setupComplete: true,
            }),
        })
        await expect(
            store.readTaskDiff({
                repoId: "repo-1",
                taskId: "task-1",
                filePath: "README.md",
            })
        ).resolves.toMatchObject({
            filePath: "README.md",
            patch: expect.stringContaining("+runtime product store"),
            stats: { insertions: 1, deletions: 0, changedLines: 1, hunkCount: 1 },
        })
        await expect(
            store.readTaskFilePair({
                repoId: "repo-1",
                taskId: "task-1",
                filePath: "README.md",
            })
        ).resolves.toMatchObject({
            filePath: "README.md",
            before: "before\n",
            after: "after\n",
        })
        await expect(store.readTaskGitLog({ repoId: "repo-1", taskId: "task-1" })).resolves.toMatchObject({
            commits: [expect.objectContaining({ message: "Runtime product store commit" })],
        })
        await expect(
            store.readTaskGitCommitFiles({
                repoId: "repo-1",
                taskId: "task-1",
                commit: "abc123",
            })
        ).resolves.toMatchObject({
            commit: "abc123",
            files: [expect.objectContaining({ path: "README.md", status: "modified" })],
        })
        await expect(
            store.readTaskGitFileAtTreeish({
                repoId: "repo-1",
                taskId: "task-1",
                treeish: "abc123",
                filePath: "README.md",
            })
        ).resolves.toMatchObject({
            treeish: "abc123",
            filePath: "README.md",
            content: "runtime product store\n",
        })
        await expect(
            store.readTaskGitCommitFilePatch({
                repoId: "repo-1",
                taskId: "task-1",
                commit: "abc123",
                filePath: "README.md",
            })
        ).resolves.toMatchObject({
            commit: "abc123",
            filePath: "README.md",
            patch: expect.stringContaining("+runtime product store"),
        })
        await expect(
            store.commitTaskGit({
                repoId: "repo-1",
                taskId: "task-1",
                message: "Product store commit",
            })
        ).resolves.toMatchObject({
            committed: true,
            sha: "def456",
        })
        await expect(
            store.readTaskImage({
                repoId: "repo-1",
                taskId: "task-1",
                imageId: "image-1",
                ext: "png",
            })
        ).resolves.toMatchObject({
            mediaType: "image/png",
            data: "aW1hZ2U=",
        })
        await expect(
            store.writeTaskImage({
                imageId: "image-written",
                ext: "png",
                mediaType: "image/png",
                data: "aW1hZ2U=",
            })
        ).resolves.toMatchObject({
            imageId: "image-written",
            ext: "png",
            mediaType: "image/png",
            sha256: "runtime-image-sha256",
        })
        expect(writtenImages.get("image-written.png")).toEqual({
            data: "aW1hZ2U=",
            ext: "png",
            mediaType: "image/png",
        })
        await expect(
            store.readTaskSnapshotPatch({
                repoId: "repo-1",
                taskId: "task-1",
                eventId: "snapshot-1",
            })
        ).resolves.toMatchObject({
            patch: expect.stringContaining("+snapshot product store"),
        })
        await expect(
            store.readTaskSnapshotIndex({
                repoId: "repo-1",
                taskId: "task-1",
                eventId: "snapshot-1",
            })
        ).resolves.toMatchObject({
            index: {
                files: [expect.objectContaining({ path: "README.md", insertions: 1 })],
            },
        })
        await expect(
            store.readTaskSnapshotPatchSlice({
                repoId: "repo-1",
                taskId: "task-1",
                eventId: "snapshot-1",
                start: 35,
                end: 59,
            })
        ).resolves.toMatchObject({ patch: "+snapshot product store\n" })
        await expect(store.listProjectProcesses({ repoId: "repo-1" })).resolves.toMatchObject({
            processes: [
                expect.objectContaining({
                    id: "openade.toml::Echo",
                    command: "printf 'runtime process\\n'",
                }),
            ],
        })
        const startedProcess = await store.startProjectProcess({ repoId: "repo-1", definitionId: "openade.toml::Echo" }, { clientRequestId: "process-start" })
        expect(startedProcess).toMatchObject({
            processId: "proc-product-store",
            runtimeId: "process:proc-product-store",
        })
        await expect(
            store.reconnectProjectProcess({
                repoId: "repo-1",
                processId: startedProcess.processId,
            })
        ).resolves.toMatchObject({
            found: true,
            output: [expect.objectContaining({ data: "runtime process\n" })],
        })
        await expect(
            store.stopProjectProcess({ repoId: "repo-1", processId: startedProcess.processId }, { clientRequestId: "process-stop" })
        ).resolves.toMatchObject({
            ok: true,
        })
        const startedTerminal = await store.startTaskTerminal({ repoId: "repo-1", taskId: "task-1", cols: 80, rows: 24 }, { clientRequestId: "terminal-start" })
        expect(startedTerminal).toMatchObject({
            terminalId: "openade-task-terminal-test",
            ok: true,
        })
        await expect(
            store.writeTaskTerminal({
                repoId: "repo-1",
                taskId: "task-1",
                terminalId: startedTerminal.terminalId,
                data: "pwd\n",
            })
        ).resolves.toMatchObject({
            ok: true,
        })
        await expect(
            store.reconnectTaskTerminal({
                repoId: "repo-1",
                taskId: "task-1",
                terminalId: startedTerminal.terminalId,
            })
        ).resolves.toMatchObject({
            found: true,
            output: [expect.objectContaining({ data: "terminal product store\n" })],
        })
        await expect(
            store.resizeTaskTerminal({
                repoId: "repo-1",
                taskId: "task-1",
                terminalId: startedTerminal.terminalId,
                cols: 100,
                rows: 30,
            })
        ).resolves.toMatchObject({ ok: true })
        await expect(
            store.stopTaskTerminal({
                repoId: "repo-1",
                taskId: "task-1",
                terminalId: startedTerminal.terminalId,
            })
        ).resolves.toMatchObject({
            ok: true,
        })

        await store.updateTaskMetadata({ taskId: "task-1", title: "Updated task" }, { clientRequestId: "metadata-update" })
        expect(store.snapshot?.repos[0]?.tasks[0]?.title).toBe("Updated task")
        expect(store.getCachedTask("repo-1", "task-1")?.title).toBe("Updated task")

        await expect(
            store.generateTaskTitle({ repoId: "repo-1", taskId: "task-1", harnessId: "codex" }, { clientRequestId: "title-generate" })
        ).resolves.toEqual({
            repoId: "repo-1",
            taskId: "task-1",
            title: "Generated task title",
        })
        expect(store.snapshot?.repos[0]?.tasks[0]?.title).toBe("Generated task title")
        expect(store.getCachedTask("repo-1", "task-1")?.title).toBe("Generated task title")

        await store.createComment(
            {
                taskId: "task-1",
                commentId: "comment-1",
                content: "Use the runtime path",
                source: { type: "manual" },
                selectedText: { text: "runtime", linesBefore: "", linesAfter: "" },
                author: { id: "user-1", email: "user@example.com" },
            },
            { clientRequestId: "comment-create" }
        )
        expect(store.getCachedTask("repo-1", "task-1")?.comments).toEqual([expect.objectContaining({ id: "comment-1" })])

        const started = await store.startTurn({ repoId: "repo-1", inTaskId: "task-1", type: "do", input: "Run it" }, { clientRequestId: "turn-start" })
        await flushAsyncNotifications()

        expect(started).toEqual({
            taskId: "task-1",
            eventId: "event-1",
            executionId: "exec-1",
            createdAt: now(),
        })
        expect(store.getCachedTask("repo-1", "task-1")?.events).toEqual(
            expect.arrayContaining([expect.objectContaining({ id: "event-1", status: "in_progress" })])
        )
        expect(store.runtimes.list({ ownerType: "openade-task", ownerId: "task-1" })).toHaveLength(1)

        await store.deleteTask({ repoId: "repo-1", taskId: "task-1" }, { clientRequestId: "task-delete" })
        expect(store.getCachedTask("repo-1", "task-1")).toBeNull()
        expect(store.snapshot?.repos[0]?.tasks).toEqual([])

        store.destroy()
        await runtime.close()
    })
})
