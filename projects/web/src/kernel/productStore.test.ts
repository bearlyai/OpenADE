import { describe, expect, it } from "vitest"
import { OpenADEClient } from "../../../openade-client/src"
import { createOpenADEModule, publishOpenADECompanionEvent, type OpenADEModuleAdapters } from "../../../openade-module/src/module"
import type {
    OpenADECommentCreateRequest,
    OpenADECommentDeleteRequest,
    OpenADECommentEditRequest,
    OpenADEProject,
    OpenADESnapshot,
    OpenADETask,
    OpenADETaskMetadataUpdateRequest,
    OpenADETaskReadOptions,
    OpenADETaskPreviewUsage,
    OpenADETaskPreview,
    OpenADETurnStartRequest,
} from "../../../openade-module/src/types"
import type { RuntimeConnection } from "../../../runtime/src"
import { RuntimeServer } from "../../../runtime/src"
import type { RuntimeMessage, RuntimeRequest } from "../../../runtime-protocol/src"
import { RuntimeLocalClient, type RuntimeLocalTransport } from "../../../runtime-client/src"
import { OpenADEProductStore } from "./productStore"

function now(): string {
    return "2026-05-31T00:00:00.000Z"
}

function isCommentRecord(value: unknown): value is Record<string, unknown> & { id: string } {
    return typeof value === "object" && value !== null && !Array.isArray(value) && "id" in value && typeof value.id === "string"
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
            return server.handleRequest(request, connection, { requireInitialized: true })
        },
        onMessage(listener: (message: RuntimeMessage) => void) {
            listeners.add(listener)
            return () => listeners.delete(listener)
        },
    }
    return new RuntimeLocalClient(transport, { clientName: "product-store-test", clientPlatform: "web" })
}

interface WrittenImageFixture {
    data: string
    ext: string
    mediaType: string
}

function createRuntimeBackedStore(): {
    store: OpenADEProductStore
    runtime: RuntimeLocalClient
    taskReadRequests: OpenADETaskReadOptions[]
    writtenImages: Map<string, WrittenImageFixture>
    publishTaskChanged(previewChanged?: boolean): void
    publishTaskUpdated(repoId: string, taskId: string): void
    snapshotRequestCount(): number
    processListRequestCount(): number
    fuzzySearchRequestCount(): number
    projectSearchRequestCount(): number
    projectGitSummaryRequestCount(): number
    taskGitSummaryRequestCount(): number
} {
    const server = new RuntimeServer({ serverName: "product-store-runtime", protocolVersion: 1 })
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
                images: [{ id: "image-1", ext: "png", mediaType: "image/png", originalWidth: 1, originalHeight: 1, resizedWidth: 1, resizedHeight: 1 }],
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
    let processListRequests = 0
    let fuzzySearchRequests = 0
    let projectSearchRequests = 0
    let projectGitSummaryRequests = 0
    let taskGitSummaryRequests = 0

    function snapshot(options?: { version?: string; hostName?: string; workingTaskIds?: string[] }): OpenADESnapshot {
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

    function publishTaskChanged(previewChanged = true): void {
        publishOpenADECompanionEvent(server, { type: "task_changed", repoId: "repo-1", taskId: "task-1", previewChanged, at: now() })
    }

    function publishTaskUpdated(repoId: string, taskId: string): void {
        server.notify("openade/task/updated", { repoId, taskId, at: now() })
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
        publishTaskChanged()
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
        publishTaskChanged(false)
        return { commentId, createdAt: params.createdAt ?? now() }
    }

    async function editComment(params: OpenADECommentEditRequest): Promise<void> {
        const current = tasks.get(params.taskId)
        if (!current) throw new Error(`Task ${params.taskId} not found`)
        current.comments = current.comments.map((comment) => {
            if (!isCommentRecord(comment) || comment.id !== params.commentId) return comment
            return { ...comment, content: params.content, ...(params.updatedAt !== undefined ? { updatedAt: params.updatedAt } : {}) }
        })
        publishTaskChanged(false)
    }

    async function deleteComment(params: OpenADECommentDeleteRequest): Promise<void> {
        const current = tasks.get(params.taskId)
        if (!current) throw new Error(`Task ${params.taskId} not found`)
        current.comments = current.comments.filter((comment) => !isCommentRecord(comment) || comment.id !== params.commentId)
        publishTaskChanged(false)
    }

    async function startTurn(params: OpenADETurnStartRequest): Promise<{ taskId: string; eventId: string }> {
        const taskId = params.inTaskId ?? "task-1"
        const current = tasks.get(taskId)
        if (!current) throw new Error(`Task ${taskId} not found`)
        const eventId = "event-1"
        current.events = [
            ...current.events,
            {
                id: eventId,
                type: "action",
                status: "completed",
                createdAt: now(),
                userInput: params.input,
                source: { type: params.type, userLabel: params.type },
            },
        ]
        preview.lastEvent = { type: "action", status: "completed", sourceType: "do", sourceLabel: "Do", at: now() }
        publishTaskChanged()
        return { taskId, eventId }
    }

    const adapters: OpenADEModuleAdapters = {
        version: () => "test",
        readSnapshot: async (options) => {
            snapshotRequests += 1
            return snapshot(options)
        },
        readProjects: async () => [project],
        readTaskList: async () => project.tasks,
        readTask: async (_repoId, taskId, options) => {
            taskReadRequests.push(options ?? {})
            const current = tasks.get(taskId)
            if (!current) throw new Error(`Task ${taskId} not found`)
            return current
        },
        listDataDocuments: async () => [],
        readDataDocumentBase64: async () => null,
        scopedHost: {
            listProjectFiles: async (params) => ({ repoId: params.repoId, path: params.path ?? "", entries: [], truncated: false }),
            readProjectFile: async (params) => ({
                repoId: params.repoId,
                path: params.path,
                encoding: params.encoding ?? "utf8",
                size: 0,
                tooLarge: false,
                content: "",
            }),
            writeProjectFile: async (params) => ({ repoId: params.repoId, taskId: params.taskId, path: params.path, size: params.content.length }),
            fuzzySearchProjectFiles: async (params) => {
                fuzzySearchRequests += 1
                return { repoId: params.repoId, taskId: params.taskId, results: ["src/runtime.ts"], truncated: false, source: "filesystem" }
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
            readProjectGitInfo: async (params) => ({
                repoId: params.repoId,
                isGitRepo: true,
                repoRoot: "/tmp/repo",
                relativePath: "",
                mainBranch: "main",
                hasGhCli: false,
            }),
            readProjectGitBranches: async (params) => ({
                repoId: params.repoId,
                defaultBranch: "main",
                branches: [
                    { name: "main", isDefault: true, isRemote: false },
                    ...(params.includeRemote ? [{ name: "origin/feature", isDefault: false, isRemote: true }] : []),
                ],
            }),
            readProjectGitSummary: async (params) => {
                projectGitSummaryRequests += 1
                return {
                    repoId: params.repoId,
                    branch: "main",
                    headCommit: "abc123",
                    ahead: 0,
                    hasChanges: true,
                    staged: { files: [], stats: { filesChanged: 0, insertions: 0, deletions: 0 } },
                    unstaged: { files: [{ path: "README.md", status: "modified" }], stats: { filesChanged: 1, insertions: 1, deletions: 0 } },
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
            writeTaskTerminal: async (params) => ({ repoId: params.repoId, taskId: params.taskId, terminalId: params.terminalId, ok: true }),
            resizeTaskTerminal: async (params) => ({ repoId: params.repoId, taskId: params.taskId, terminalId: params.terminalId, ok: true }),
            stopTaskTerminal: async (params) => ({ repoId: params.repoId, taskId: params.taskId, terminalId: params.terminalId, ok: true }),
            readTaskChanges: async (params) => ({
                repoId: params.repoId,
                taskId: params.taskId,
                fromTreeish: params.fromTreeish ?? "HEAD",
                toTreeish: "",
                files: [{ path: "README.md", status: "modified" }],
            }),
            readTaskGitSummary: async (params) => {
                taskGitSummaryRequests += 1
                return {
                    repoId: params.repoId,
                    taskId: params.taskId,
                    branch: "main",
                    headCommit: "abc123",
                    ahead: 1,
                    hasChanges: true,
                    staged: { files: [], stats: { filesChanged: 0, insertions: 0, deletions: 0 } },
                    unstaged: { files: [{ path: "README.md", status: "modified" }], stats: { filesChanged: 1, insertions: 1, deletions: 0 } },
                    untracked: [],
                }
            },
            readTaskGitScopes: async (params) => ({
                repoId: params.repoId,
                taskId: params.taskId,
                defaultBranch: "main",
                scopes: [
                    { id: "branch:HEAD", type: "branch", name: "HEAD", ref: "HEAD", isDefault: false, isRemote: false },
                    { id: "branch:main", type: "branch", name: "main", ref: "main", isDefault: true, isRemote: false },
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
                cwd: "/tmp/repo",
                rootPath: "/tmp/repo",
            }),
            readTaskDiff: async (params) => ({
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
            }),
            readTaskFilePair: async (params) => ({
                repoId: params.repoId,
                taskId: params.taskId,
                filePath: params.filePath,
                oldPath: params.oldPath,
                fromTreeish: params.fromTreeish ?? "HEAD",
                toTreeish: "",
                before: "before\n",
                after: "after\n",
            }),
            readTaskGitLog: async (params) => ({
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
            }),
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
                content: "runtime product store\n",
                exists: true,
            }),
            readTaskGitCommitFilePatch: async (params) => ({
                repoId: params.repoId,
                taskId: params.taskId,
                commit: params.commit,
                filePath: params.filePath,
                oldPath: params.oldPath,
                patch: "diff --git a/README.md b/README.md\n+runtime product store\n",
                truncated: false,
                heavy: false,
                stats: { insertions: 1, deletions: 0, changedLines: 1, hunkCount: 1 },
            }),
            commitTaskGit: async (params) => ({
                repoId: params.repoId,
                taskId: params.taskId,
                committed: true,
                status: "committed",
                sha: "def456",
            }),
            readTaskImage: async (params) => ({
                repoId: params.repoId,
                taskId: params.taskId,
                imageId: params.imageId,
                ext: params.ext,
                mediaType: params.image.mediaType,
                data: "aW1hZ2U=",
            }),
            readTaskSnapshotPatch: async (params) => ({
                repoId: params.repoId,
                taskId: params.taskId,
                eventId: params.eventId,
                patch: typeof params.snapshotEvent.fullPatch === "string" ? params.snapshotEvent.fullPatch : null,
            }),
            readTaskSnapshotIndex: async (params) => ({
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
            }),
            readTaskSnapshotPatchSlice: async (params) => ({
                repoId: params.repoId,
                taskId: params.taskId,
                eventId: params.eventId,
                patch: typeof params.snapshotEvent.fullPatch === "string" ? params.snapshotEvent.fullPatch.slice(params.start, params.end) : null,
            }),
        },
        saveDataDocumentBase64: async () => undefined,
        deleteDataDocument: async () => undefined,
        createRepo: async (params) => ({ repoId: params.repoId ?? "repo-created", createdAt: params.createdAt ?? now() }),
        updateRepo: async () => undefined,
        deleteRepo: async () => undefined,
        startTurn,
        startReview: async (params) => ({ taskId: params.taskId }),
        interruptTurn: async () => undefined,
        cancelQueuedTurn: async (params) => {
            const current = tasks.get(params.taskId)
            if (!current) throw new Error(`Task ${params.taskId} not found`)
            current.queuedTurns = (current.queuedTurns ?? []).map((turn) => (turn.id === params.queuedTurnId ? { ...turn, status: "cancelled" } : turn))
            return { taskId: params.taskId, queuedTurnId: params.queuedTurnId, cancelled: true }
        },
        deleteTask: async (params) => {
            tasks.delete(params.taskId)
            project.tasks = project.tasks.filter((candidate) => candidate.id !== params.taskId)
            publishOpenADECompanionEvent(server, { type: "task_deleted", repoId: params.repoId, taskId: params.taskId, at: now() })
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
        createActionEvent: async () => ({ eventId: "event-created", createdAt: now() }),
        appendActionStreamEvent: async () => undefined,
        completeActionEvent: async () => undefined,
        errorActionEvent: async () => undefined,
        stoppedActionEvent: async () => undefined,
        reconcileActionEventRuntime: async (params) => ({ taskId: params.taskId, changed: false }),
        updateActionExecution: async () => undefined,
        addHyperPlanSubExecution: async () => undefined,
        appendHyperPlanSubExecutionStreamEvent: async () => undefined,
        updateHyperPlanSubExecution: async () => undefined,
        setHyperPlanReconcileLabels: async () => undefined,
        createSnapshotEvent: async () => ({ eventId: "snapshot-1", createdAt: now() }),
        createComment,
        editComment,
        deleteComment,
        updateTaskMetadata,
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
            return { updatedTasks: updatedTasks.length, skippedTasks: 0, tasks: updatedTasks }
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
        runtime,
        store: new OpenADEProductStore(new OpenADEClient({ runtime, clientName: "product-store-test", clientPlatform: "web" })),
        taskReadRequests,
        writtenImages,
        publishTaskChanged,
        publishTaskUpdated,
        snapshotRequestCount: () => snapshotRequests,
        processListRequestCount: () => processListRequests,
        fuzzySearchRequestCount: () => fuzzySearchRequests,
        projectSearchRequestCount: () => projectSearchRequests,
        projectGitSummaryRequestCount: () => projectGitSummaryRequests,
        taskGitSummaryRequestCount: () => taskGitSummaryRequests,
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
            await store.startTurn({ repoId: "repo-1", inTaskId: "task-1", type: "do", input: "Run lightweight" }, { clientRequestId: "turn-lightweight" })

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
        const usage = { usageVersion: 1, inputTokens: 10, outputTokens: 5, totalCostUsd: 0.01, eventCount: 2, costByModel: { "model-1": 0.01 } }

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
                { repoId: "repo-1", name: "Existing repo", path: "/tmp/existing", createdBy: { id: "user-1", email: "user@example.com" } },
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
                { repoId: "repo-created", name: "Created repo", path: "/tmp/created", createdBy: { id: "user-1", email: "user@example.com" } },
                { clientRequestId: "repo-create-cache" }
            )
            expect(snapshotRequestCount()).toBe(existingSnapshotRequests)
            expect(store.snapshot?.repos).toEqual(
                expect.arrayContaining([expect.objectContaining({ id: "repo-created", name: "Created repo", path: "/tmp/created" })])
            )

            await store.updateRepo({ repoId: "repo-created", name: "Renamed repo", archived: true }, { clientRequestId: "repo-update-cache" })
            expect(snapshotRequestCount()).toBe(existingSnapshotRequests)
            expect(store.snapshot?.repos.find((repo) => repo.id === "repo-created")).toEqual(
                expect.objectContaining({ id: "repo-created", name: "Renamed repo", path: "/tmp/created", archived: true })
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
                expect.arrayContaining([expect.objectContaining({ id: "comment-local", content: "Accepted comment" })])
            )

            await store.editComment(
                { taskId: "task-1", commentId: "comment-local", content: "Edited accepted comment", updatedAt: "2026-01-01T00:01:00.000Z" },
                { clientRequestId: "comment-edit-cache" }
            )
            expect(store.getCachedTask("repo-1", "task-1")?.comments).toEqual(
                expect.arrayContaining([expect.objectContaining({ id: "comment-local", content: "Edited accepted comment" })])
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

    it("patches accepted queue, usage, and task deletion mutations locally without task or snapshot rereads", async () => {
        const { store, runtime, taskReadRequests, snapshotRequestCount } = createRuntimeBackedStore()

        try {
            await store.refreshSnapshot()
            await store.getTask("repo-1", "task-1")
            await store.updateTaskMetadata({
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
            })

            taskReadRequests.length = 0
            const existingSnapshotRequests = snapshotRequestCount()

            await store.cancelQueuedTurn({ repoId: "repo-1", taskId: "task-1", queuedTurnId: "queued-1" }, { clientRequestId: "queue-cancel-cache" })
            expect(store.getCachedTask("repo-1", "task-1")?.queuedTurns).toEqual([expect.objectContaining({ id: "queued-1", status: "cancelled" })])

            await store.backfillTaskUsage({ repoId: "repo-1", taskIds: ["task-1"] }, { clientRequestId: "usage-backfill-cache" })
            expect(store.snapshot?.repos[0]?.tasks[0]?.usage).toMatchObject({ usageVersion: 2, inputTokens: 11 })

            await store.recalculateTaskUsage({ repoId: "repo-1", taskId: "task-1" }, { clientRequestId: "usage-recalculate-cache" })
            expect(store.snapshot?.repos[0]?.tasks[0]?.usage).toMatchObject({ usageVersion: 2, inputTokens: 17 })

            await store.deleteTask({ repoId: "repo-1", taskId: "task-1" }, { clientRequestId: "task-delete-cache" })
            expect(store.getCachedTask("repo-1", "task-1")).toBeNull()
            expect(store.snapshot?.repos[0]?.tasks).toEqual([])

            expect(taskReadRequests).toEqual([])
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

            await store.startProjectProcess({ repoId: "repo-1", definitionId: "openade.toml::Echo" }, { clientRequestId: "process-cache-start" })
            await store.listProjectProcesses({ repoId: "repo-1" })
            await store.listProjectProcesses({ repoId: "repo-1" })

            expect(processListRequestCount()).toBe(2)

            await store.writeProjectFile(
                { repoId: "repo-1", path: "nested/openade.toml", content: '[process.echo]\ncmd = "echo hi"\n' },
                { clientRequestId: "process-cache-config-write" }
            )
            await store.listProjectProcesses({ repoId: "repo-1" })

            expect(processListRequestCount()).toBe(3)
        } finally {
            store.destroy()
            await runtime.close()
        }
    })

    it("reuses fresh project search reads and invalidates them after scoped file writes", async () => {
        const { store, runtime, fuzzySearchRequestCount, projectSearchRequestCount } = createRuntimeBackedStore()

        try {
            const fuzzyArgs = { repoId: "repo-1", taskId: "task-1", query: "runtime", limit: 10 }
            const searchArgs = { repoId: "repo-1", taskId: "task-1", query: "runtime", limit: 10, caseSensitive: false }

            await expect(store.fuzzySearchProjectFiles(fuzzyArgs)).resolves.toMatchObject({ results: ["src/runtime.ts"] })
            await expect(store.fuzzySearchProjectFiles(fuzzyArgs)).resolves.toMatchObject({ results: ["src/runtime.ts"] })
            await expect(store.searchProject(searchArgs)).resolves.toMatchObject({ matches: [expect.objectContaining({ path: "src/runtime.ts" })] })
            await expect(store.searchProject(searchArgs)).resolves.toMatchObject({ matches: [expect.objectContaining({ path: "src/runtime.ts" })] })

            expect(fuzzySearchRequestCount()).toBe(1)
            expect(projectSearchRequestCount()).toBe(1)

            await store.writeProjectFile(
                { repoId: "repo-1", taskId: "task-1", path: "src/runtime.ts", content: "runtime product search\n" },
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

    it("reuses fresh git summary reads while preserving explicit bypass and write invalidation", async () => {
        const { store, runtime, projectGitSummaryRequestCount, taskGitSummaryRequestCount } = createRuntimeBackedStore()

        try {
            await store.readProjectGitSummary({ repoId: "repo-1" })
            await store.readProjectGitSummary({ repoId: "repo-1" })
            await store.readTaskGitSummary({ repoId: "repo-1", taskId: "task-1" })
            await store.readTaskGitSummary({ repoId: "repo-1", taskId: "task-1" })

            expect(projectGitSummaryRequestCount()).toBe(1)
            expect(taskGitSummaryRequestCount()).toBe(1)

            await store.readTaskGitSummary({ repoId: "repo-1", taskId: "task-1" }, { bypassCache: true })
            expect(taskGitSummaryRequestCount()).toBe(2)

            await store.writeProjectFile(
                { repoId: "repo-1", taskId: "task-1", path: "src/runtime.ts", content: "runtime product search\n" },
                { clientRequestId: "git-summary-cache-write" }
            )
            await store.readProjectGitSummary({ repoId: "repo-1" })
            await store.readTaskGitSummary({ repoId: "repo-1", taskId: "task-1" })

            expect(projectGitSummaryRequestCount()).toBe(2)
            expect(taskGitSummaryRequestCount()).toBe(3)
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
        await expect(store.getTask("repo-1", "task-1")).resolves.toMatchObject({ title: "Original task", comments: [] })
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
            unstaged: { files: [expect.objectContaining({ path: "README.md", status: "modified" })] },
        })
        await expect(store.readTaskGitSummary({ repoId: "repo-1", taskId: "task-1" })).resolves.toMatchObject({
            branch: "main",
            headCommit: "abc123",
            hasChanges: true,
            unstaged: { files: [expect.objectContaining({ path: "README.md", status: "modified" })] },
        })
        await expect(store.readTaskGitScopes({ repoId: "repo-1", taskId: "task-1", includeRemote: true })).resolves.toMatchObject({
            defaultBranch: "main",
            scopes: [
                expect.objectContaining({ id: "branch:HEAD", type: "branch", ref: "HEAD" }),
                expect.objectContaining({ id: "branch:main", type: "branch", ref: "main" }),
            ],
        })
        await expect(store.prepareTaskEnvironment({ repoId: "repo-1", taskId: "task-1" }, { clientRequestId: "prepare-env" })).resolves.toMatchObject({
            repoId: "repo-1",
            taskId: "task-1",
            deviceEnvironment: expect.objectContaining({ id: "runtime-device", setupComplete: true }),
        })
        await expect(store.readTaskDiff({ repoId: "repo-1", taskId: "task-1", filePath: "README.md" })).resolves.toMatchObject({
            filePath: "README.md",
            patch: expect.stringContaining("+runtime product store"),
            stats: { insertions: 1, deletions: 0, changedLines: 1, hunkCount: 1 },
        })
        await expect(store.readTaskFilePair({ repoId: "repo-1", taskId: "task-1", filePath: "README.md" })).resolves.toMatchObject({
            filePath: "README.md",
            before: "before\n",
            after: "after\n",
        })
        await expect(store.readTaskGitLog({ repoId: "repo-1", taskId: "task-1" })).resolves.toMatchObject({
            commits: [expect.objectContaining({ message: "Runtime product store commit" })],
        })
        await expect(store.readTaskGitCommitFiles({ repoId: "repo-1", taskId: "task-1", commit: "abc123" })).resolves.toMatchObject({
            commit: "abc123",
            files: [expect.objectContaining({ path: "README.md", status: "modified" })],
        })
        await expect(store.readTaskGitFileAtTreeish({ repoId: "repo-1", taskId: "task-1", treeish: "abc123", filePath: "README.md" })).resolves.toMatchObject({
            treeish: "abc123",
            filePath: "README.md",
            content: "runtime product store\n",
        })
        await expect(store.readTaskGitCommitFilePatch({ repoId: "repo-1", taskId: "task-1", commit: "abc123", filePath: "README.md" })).resolves.toMatchObject({
            commit: "abc123",
            filePath: "README.md",
            patch: expect.stringContaining("+runtime product store"),
        })
        await expect(store.commitTaskGit({ repoId: "repo-1", taskId: "task-1", message: "Product store commit" })).resolves.toMatchObject({
            committed: true,
            sha: "def456",
        })
        await expect(store.readTaskImage({ repoId: "repo-1", taskId: "task-1", imageId: "image-1", ext: "png" })).resolves.toMatchObject({
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
        expect(writtenImages.get("image-written.png")).toEqual({ data: "aW1hZ2U=", ext: "png", mediaType: "image/png" })
        await expect(store.readTaskSnapshotPatch({ repoId: "repo-1", taskId: "task-1", eventId: "snapshot-1" })).resolves.toMatchObject({
            patch: expect.stringContaining("+snapshot product store"),
        })
        await expect(store.readTaskSnapshotIndex({ repoId: "repo-1", taskId: "task-1", eventId: "snapshot-1" })).resolves.toMatchObject({
            index: { files: [expect.objectContaining({ path: "README.md", insertions: 1 })] },
        })
        await expect(
            store.readTaskSnapshotPatchSlice({ repoId: "repo-1", taskId: "task-1", eventId: "snapshot-1", start: 35, end: 59 })
        ).resolves.toMatchObject({ patch: "+snapshot product store\n" })
        await expect(store.listProjectProcesses({ repoId: "repo-1" })).resolves.toMatchObject({
            processes: [expect.objectContaining({ id: "openade.toml::Echo", command: "printf 'runtime process\\n'" })],
        })
        const startedProcess = await store.startProjectProcess({ repoId: "repo-1", definitionId: "openade.toml::Echo" }, { clientRequestId: "process-start" })
        expect(startedProcess).toMatchObject({ processId: "proc-product-store", runtimeId: "process:proc-product-store" })
        await expect(store.reconnectProjectProcess({ repoId: "repo-1", processId: startedProcess.processId })).resolves.toMatchObject({
            found: true,
            output: [expect.objectContaining({ data: "runtime process\n" })],
        })
        await expect(
            store.stopProjectProcess({ repoId: "repo-1", processId: startedProcess.processId }, { clientRequestId: "process-stop" })
        ).resolves.toMatchObject({
            ok: true,
        })
        const startedTerminal = await store.startTaskTerminal({ repoId: "repo-1", taskId: "task-1", cols: 80, rows: 24 }, { clientRequestId: "terminal-start" })
        expect(startedTerminal).toMatchObject({ terminalId: "openade-task-terminal-test", ok: true })
        await expect(
            store.writeTaskTerminal({ repoId: "repo-1", taskId: "task-1", terminalId: startedTerminal.terminalId, data: "pwd\n" })
        ).resolves.toMatchObject({
            ok: true,
        })
        await expect(store.reconnectTaskTerminal({ repoId: "repo-1", taskId: "task-1", terminalId: startedTerminal.terminalId })).resolves.toMatchObject({
            found: true,
            output: [expect.objectContaining({ data: "terminal product store\n" })],
        })
        await expect(
            store.resizeTaskTerminal({ repoId: "repo-1", taskId: "task-1", terminalId: startedTerminal.terminalId, cols: 100, rows: 30 })
        ).resolves.toMatchObject({ ok: true })
        await expect(store.stopTaskTerminal({ repoId: "repo-1", taskId: "task-1", terminalId: startedTerminal.terminalId })).resolves.toMatchObject({
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

        expect(started).toEqual({ taskId: "task-1", eventId: "event-1" })
        expect(store.getCachedTask("repo-1", "task-1")?.events).toEqual(
            expect.arrayContaining([expect.objectContaining({ id: "event-1", status: "completed" })])
        )
        expect(store.runtimes.list({ ownerType: "openade-task", ownerId: "task-1" })).toHaveLength(1)

        await store.deleteTask({ repoId: "repo-1", taskId: "task-1" }, { clientRequestId: "task-delete" })
        expect(store.getCachedTask("repo-1", "task-1")).toBeNull()
        expect(store.snapshot?.repos[0]?.tasks).toEqual([])

        store.destroy()
        await runtime.close()
    })
})
