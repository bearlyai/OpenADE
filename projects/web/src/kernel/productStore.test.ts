import { describe, expect, it } from "vitest"
import { OpenADEClient } from "../../../openade-client/src"
import {
    createOpenADEModule,
    publishOpenADECompanionEvent,
    type OpenADECommentCreateRequest,
    type OpenADEModuleAdapters,
    type OpenADEProject,
    type OpenADESnapshot,
    type OpenADETask,
    type OpenADETaskMetadataUpdateRequest,
    type OpenADETaskPreview,
    type OpenADETurnStartRequest,
} from "../../../openade-module/src"
import type { RuntimeConnection } from "../../../runtime/src"
import { RuntimeServer } from "../../../runtime/src"
import type { RuntimeMessage, RuntimeRequest } from "../../../runtime-protocol/src"
import { RuntimeLocalClient, type RuntimeLocalTransport } from "../../../runtime-client/src"
import { OpenADEProductStore } from "./productStore"

function now(): string {
    return "2026-05-31T00:00:00.000Z"
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

function createRuntimeBackedStore(): { store: OpenADEProductStore; runtime: RuntimeLocalClient } {
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
        readSnapshot: async (options) => snapshot(options),
        readProjects: async () => [project],
        readTaskList: async () => project.tasks,
        readTask: async (_repoId, taskId) => {
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
            writeProjectFile: async (params) => ({ repoId: params.repoId, path: params.path, size: params.content.length }),
            searchProject: async (params) => ({ repoId: params.repoId, matches: [], truncated: false }),
            listProjectProcesses: async (params) => ({
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
            }),
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
                terminalId: params.terminalId,
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
        createRepo: async () => ({ repoId: "repo-created", createdAt: now() }),
        updateRepo: async () => undefined,
        deleteRepo: async () => undefined,
        startTurn,
        startReview: async (params) => ({ taskId: params.taskId }),
        interruptTurn: async () => undefined,
        cancelQueuedTurn: async (params) => ({ taskId: params.taskId, queuedTurnId: params.queuedTurnId, cancelled: true }),
        deleteTask: async (params) => {
            tasks.delete(params.taskId)
            project.tasks = project.tasks.filter((candidate) => candidate.id !== params.taskId)
            publishOpenADECompanionEvent(server, { type: "task_deleted", repoId: params.repoId, taskId: params.taskId, at: now() })
            return { repoId: params.repoId, taskId: params.taskId, deleted: true }
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
        editComment: async () => undefined,
        deleteComment: async () => undefined,
        updateTaskMetadata,
    }
    server.registerModule(createOpenADEModule(adapters))

    const runtime = createLocalRuntimeClient(server)
    return { runtime, store: new OpenADEProductStore(new OpenADEClient({ runtime, clientName: "product-store-test", clientPlatform: "web" })) }
}

async function flushAsyncNotifications(): Promise<void> {
    await Promise.resolve()
    await Promise.resolve()
}

describe("OpenADEProductStore", () => {
    it("refreshes DTO state and runtime records through a real local runtime client", async () => {
        const { store, runtime } = createRuntimeBackedStore()
        store.subscribe()

        await expect(store.refreshSnapshot()).resolves.toMatchObject({
            repos: [{ id: "repo-1", tasks: [{ id: "task-1", title: "Original task" }] }],
        })
        await expect(store.getTask("repo-1", "task-1")).resolves.toMatchObject({ title: "Original task", comments: [] })
        await expect(store.readTaskChanges({ repoId: "repo-1", taskId: "task-1" })).resolves.toMatchObject({
            files: [expect.objectContaining({ path: "README.md", status: "modified" })],
        })
        await expect(store.readTaskDiff({ repoId: "repo-1", taskId: "task-1", filePath: "README.md" })).resolves.toMatchObject({
            filePath: "README.md",
            patch: expect.stringContaining("+runtime product store"),
            stats: { insertions: 1, deletions: 0, changedLines: 1, hunkCount: 1 },
        })
        await expect(store.readTaskGitLog({ repoId: "repo-1", taskId: "task-1" })).resolves.toMatchObject({
            commits: [expect.objectContaining({ message: "Runtime product store commit" })],
        })
        await expect(store.commitTaskGit({ repoId: "repo-1", taskId: "task-1", message: "Product store commit" })).resolves.toMatchObject({
            committed: true,
            sha: "def456",
        })
        await expect(store.readTaskImage({ repoId: "repo-1", taskId: "task-1", imageId: "image-1", ext: "png" })).resolves.toMatchObject({
            mediaType: "image/png",
            data: "aW1hZ2U=",
        })
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
