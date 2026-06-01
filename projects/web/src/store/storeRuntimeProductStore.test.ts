import { describe, expect, it, vi } from "vitest"
import { OpenADEClient } from "../../../openade-client/src"
import { type OpenADEModuleAdapters, createOpenADEModule } from "../../../openade-module/src/module"
import type { OpenADEProject, OpenADETask, OpenADETaskPreview } from "../../../openade-module/src/types"
import { RuntimeLocalClient, type RuntimeLocalTransport } from "../../../runtime-client/src"
import type { RuntimeMessage, RuntimeRecord, RuntimeRequest } from "../../../runtime-protocol/src"
import { type RuntimeConnection, RuntimeServer } from "../../../runtime/src"
import { analytics } from "../analytics"
import { OpenADEProductStore } from "../kernel/productStore"
import { CodeStore } from "./store"

const now = "2026-05-31T00:00:00.000Z"

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
            source: { type: "llm_output", eventId: "event-1", lineStart: 1, lineEnd: 1 },
            selectedText: { text: "Runtime", linesBefore: "", linesAfter: "" },
            author: { id: "user-1", email: "user@example.com" },
            createdAt: now,
        },
    ],
}

interface RuntimeBridgeState {
    project: OpenADEProject | null
    task: OpenADETask | null
}

function cloneProject(value: OpenADEProject): OpenADEProject {
    return structuredClone(value)
}

function cloneTask(value: OpenADETask): OpenADETask {
    return structuredClone(value)
}

function taskPreviewFromTask(value: OpenADETask): OpenADETaskPreview {
    return {
        id: value.id,
        slug: value.slug,
        title: value.title,
        closed: value.closed,
        createdAt: value.createdAt ?? now,
        lastEventAt: value.lastEventAt,
        lastViewedAt: value.lastViewedAt,
    }
}

function projectFromState(state: RuntimeBridgeState): OpenADEProject | null {
    if (!state.project) return null
    return {
        ...cloneProject(state.project),
        tasks: state.task ? [taskPreviewFromTask(state.task)] : [],
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
    }
}

function unsupportedMutation(method: string): () => Promise<never> {
    return async () => {
        throw new Error(`${method} is not available in the read-only bridge test runtime`)
    }
}

function createReadOnlyAdapters(state: RuntimeBridgeState): OpenADEModuleAdapters {
    return {
        version: () => "bridge-test-version",
        readSnapshot: async () => ({
            server: {
                version: "bridge-test-version",
                hostName: "bridge-test-host",
                theme: { setting: "system", className: "code-theme-light" },
            },
            repos: projectsFromState(state),
            workingTaskIds: [],
        }),
        readProjects: async () => projectsFromState(state),
        readTaskList: async () => projectFromState(state)?.tasks ?? [],
        readTask: async (_repoId, taskId) => {
            if (!state.task || taskId !== state.task.id) throw new Error(`Task ${taskId} not found`)
            return cloneTask(state.task)
        },
        listDataDocuments: async () => [],
        readDataDocumentBase64: async () => null,
        saveDataDocumentBase64: unsupportedMutation("saveDataDocumentBase64"),
        deleteDataDocument: unsupportedMutation("deleteDataDocument"),
        createRepo: unsupportedMutation("createRepo"),
        updateRepo: unsupportedMutation("updateRepo"),
        deleteRepo: unsupportedMutation("deleteRepo"),
        startTurn: unsupportedMutation("startTurn"),
        startReview: unsupportedMutation("startReview"),
        interruptTurn: unsupportedMutation("interruptTurn"),
        cancelQueuedTurn: unsupportedMutation("cancelQueuedTurn"),
        deleteTask: unsupportedMutation("deleteTask"),
        setupTaskEnvironment: unsupportedMutation("setupTaskEnvironment"),
        createActionEvent: unsupportedMutation("createActionEvent"),
        appendActionStreamEvent: unsupportedMutation("appendActionStreamEvent"),
        completeActionEvent: unsupportedMutation("completeActionEvent"),
        errorActionEvent: unsupportedMutation("errorActionEvent"),
        stoppedActionEvent: unsupportedMutation("stoppedActionEvent"),
        reconcileActionEventRuntime: async (params) => ({ taskId: params.taskId, changed: false }),
        updateActionExecution: unsupportedMutation("updateActionExecution"),
        addHyperPlanSubExecution: unsupportedMutation("addHyperPlanSubExecution"),
        appendHyperPlanSubExecutionStreamEvent: unsupportedMutation("appendHyperPlanSubExecutionStreamEvent"),
        updateHyperPlanSubExecution: unsupportedMutation("updateHyperPlanSubExecution"),
        setHyperPlanReconcileLabels: unsupportedMutation("setHyperPlanReconcileLabels"),
        createSnapshotEvent: unsupportedMutation("createSnapshotEvent"),
        createComment: unsupportedMutation("createComment"),
        editComment: unsupportedMutation("editComment"),
        deleteComment: unsupportedMutation("deleteComment"),
        updateTaskMetadata: unsupportedMutation("updateTaskMetadata"),
    }
}

function createLocalRuntimeClient(server: RuntimeServer): RuntimeLocalClient {
    const listeners = new Set<(message: RuntimeMessage) => void>()
    let dispose: (() => void) | null = null
    const connection: RuntimeConnection = {
        id: "desktop-product-store-test",
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
        onMessage(listener) {
            listeners.add(listener)
            return () => listeners.delete(listener)
        },
    }
    return new RuntimeLocalClient(transport, { clientName: "desktop-product-store-test", clientPlatform: "desktop" })
}

function createRuntimeBackedClient(state: RuntimeBridgeState = createBridgeState()): {
    client: OpenADEClient
    runtime: RuntimeLocalClient
    server: RuntimeServer
    state: RuntimeBridgeState
} {
    const server = new RuntimeServer({ serverName: "desktop-product-store-runtime", protocolVersion: 1 })
    server.registerModule(createOpenADEModule(createReadOnlyAdapters(state)))
    const runtime = createLocalRuntimeClient(server)
    return {
        server,
        state,
        runtime,
        client: new OpenADEClient({ runtime, clientName: "desktop-product-store-test", clientPlatform: "desktop" }),
    }
}

function runtimeRecord(status: RuntimeRecord["status"], updatedAt: string): RuntimeRecord {
    return {
        runtimeId: "runtime-1",
        kind: "agent",
        status,
        scope: { ownerType: "openade-task", ownerId: "task-1" },
        startedAt: now,
        updatedAt,
        lastActivityAt: updatedAt,
    }
}

async function waitForRuntimeBridge(assertion: () => void): Promise<void> {
    await vi.waitFor(assertion, { timeout: 1000, interval: 10 })
}

describe("CodeStore runtime product store bridge", () => {
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

            expect(codeStore.shouldUseRuntimeProductReads()).toBe(true)
            expect(codeStore.repos.getRepo("repo-1")).toEqual(expect.objectContaining({ id: "repo-1", name: "Runtime Repo" }))
            expect(codeStore.tasks.getTaskModel("task-1")?.exists).toBe(true)
            expect(codeStore.getTaskPreviewsForRepo("repo-1")).toEqual([expect.objectContaining({ id: "task-1", title: "Runtime task" })])
        } finally {
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("emits rollout telemetry when enabled runtime reads fall back to a legacy task store", async () => {
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

            await expect(codeStore.getTaskStore("repo-1", "task-1")).rejects.toThrow("RepoStore not initialized")

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

    it("prunes repo-scoped desktop bridge state from real repo deletion notifications", async () => {
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

            expect(codeStore.repos.repos).toEqual([expect.objectContaining({ id: "repo-1" })])
            expect(codeStore.tasks.getTask("task-1")).toMatchObject({ id: "task-1" })

            state.project = null
            state.task = null
            server.notify("openade/repo/deleted", { repoId: "repo-1" })

            await waitForRuntimeBridge(() => {
                expect(codeStore.runtimeProductSnapshot?.repos).toEqual([])
                expect(codeStore.repos.repos).toEqual([])
                expect(codeStore.getTaskPreviewsForRepo("repo-1")).toEqual([])
                expect(codeStore.tasks.getTask("task-1")).toBeNull()
                expect(codeStore.tasks.getTaskModel("task-1")).toBeNull()
            })
        } finally {
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
                        source: { type: "run_plan", userLabel: "Run Plan", planEventId: "event-1" },
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
                        source: { type: "llm_output", eventId: "event-2", lineStart: 1, lineEnd: 1 },
                        selectedText: { text: "notification", linesBefore: "", linesAfter: "" },
                        author: { id: "user-1", email: "user@example.com" },
                        createdAt: "2026-05-31T00:01:00.000Z",
                    },
                ],
            }
            server.notify("openade/task/updated", { repoId: "repo-1", taskId: "task-1" })

            await waitForRuntimeBridge(() => {
                expect(codeStore.tasks.getTask("task-1")).toMatchObject({
                    title: "Runtime notification task",
                    events: [
                        expect.objectContaining({ id: "event-1" }),
                        expect.objectContaining({ id: "event-2", source: expect.objectContaining({ type: "ask" }) }),
                    ],
                    comments: [expect.objectContaining({ id: "comment-1" }), expect.objectContaining({ id: "comment-2" })],
                })
            })

            state.task = {
                ...state.task,
                title: "Runtime preview notification task",
                closed: true,
                lastEventAt: "2026-05-31T00:02:00.000Z",
            }
            server.notify("openade/task/previewChanged", { repoId: "repo-1", taskId: "task-1" })

            await waitForRuntimeBridge(() => {
                expect(codeStore.runtimeProductSnapshot?.repos[0]?.tasks).toEqual([
                    expect.objectContaining({
                        id: "task-1",
                        title: "Runtime preview notification task",
                        closed: true,
                        lastEventAt: "2026-05-31T00:02:00.000Z",
                    }),
                ])
                expect(codeStore.getTaskPreviewsForRepo("repo-1")).toEqual([
                    expect.objectContaining({
                        id: "task-1",
                        title: "Runtime preview notification task",
                        closed: true,
                    }),
                ])
            })

            state.task = null
            server.notify("openade/task/deleted", { repoId: "repo-1", taskId: "task-1" })

            await waitForRuntimeBridge(() => {
                expect(codeStore.runtimeProductSnapshot?.repos[0]?.tasks).toEqual([])
                expect(codeStore.getTaskPreviewsForRepo("repo-1")).toEqual([])
                expect(codeStore.tasks.getTask("task-1")).toBeNull()
                expect(codeStore.tasks.getTaskModel("task-1")).toBeNull()
            })
        } finally {
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })
})
