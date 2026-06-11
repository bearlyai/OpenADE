import { describe, expect, it, vi } from "vitest"
import { createOpenADEModule, publishOpenADECompanionEvent, type OpenADEModuleAdapters } from "../../../../openade-module/src"
import type { RuntimeMessage } from "../../../../runtime-protocol/src"
import { RuntimeServer } from "../../../../runtime/src"

function connection() {
    return {
        id: "trusted-openade-module-test",
        send(_message: RuntimeMessage) {},
    }
}

function adapters(startTurn: OpenADEModuleAdapters["startTurn"]): OpenADEModuleAdapters {
    return {
        clientRequestRetentionMs: 60_000,
        readSnapshot: async () => ({
            server: {
                version: "test",
                hostName: "test-host",
                theme: { setting: "code-theme-light", className: "code-theme-light", label: "Light" },
            },
            repos: [],
            workingTaskIds: [],
        }),
        readProjects: async () => [],
        readTaskList: async () => [],
        readTask: async (_repoId, taskId) => ({
            id: taskId,
            repoId: "repo-1",
            slug: taskId,
            title: taskId,
            description: "",
            deviceEnvironments: [],
            events: [],
            comments: [],
        }),
        listDataDocuments: async () => [],
        readDataDocumentBase64: async () => null,
        saveDataDocumentBase64: async () => ({ ok: true }),
        deleteDataDocument: async () => ({ ok: true }),
        createRepo: async () => ({ repoId: "repo-1", createdAt: "2026-05-26T00:00:00.000Z" }),
        updateRepo: async () => ({ ok: true }),
        deleteRepo: async () => ({ ok: true }),
        createTask: async (params) => ({
            taskId: params.taskId ?? "task-created",
            slug: params.slug ?? "task-created",
            title: params.title ?? "Created task",
            createdAt: params.createdAt ?? "2026-05-26T00:00:00.000Z",
        }),
        startTurn,
        startReview: async () => ({ taskId: "task-1" }),
        interruptTurn: async () => ({ ok: true }),
        enqueueQueuedTurn: async (params) => {
            const turn = {
                id: params.queuedTurnId ?? "queued-1",
                clientRequestId: params.clientRequestId,
                type: params.type,
                input: params.input,
                status: "queued" as const,
                createdAt: "2026-05-26T00:00:00.000Z",
                updatedAt: "2026-05-26T00:00:00.000Z",
            }
            return { taskId: params.taskId, queuedTurnId: turn.id, queued: true, turn }
        },
        reorderQueuedTurns: async (params) => ({
            taskId: params.taskId,
            reordered: true,
            turns: params.queuedTurnIds.map((id) => ({
                id,
                type: "ask" as const,
                input: id,
                status: "queued" as const,
                createdAt: "2026-05-26T00:00:00.000Z",
                updatedAt: "2026-05-26T00:00:00.000Z",
            })),
        }),
        cancelQueuedTurn: async (params) => ({ taskId: params.taskId, queuedTurnId: params.queuedTurnId, cancelled: true }),
        deleteTask: async (_params) => ({ repoId: "repo-1", taskId: "task-1", deleted: true }),
        setupTaskEnvironment: async () => ({ ok: true }),
        createActionEvent: async () => ({ eventId: "event-1", createdAt: "2026-05-26T00:00:00.000Z" }),
        appendActionStreamEvent: async () => ({ ok: true }),
        completeActionEvent: async () => ({ ok: true }),
        errorActionEvent: async () => ({ ok: true }),
        stoppedActionEvent: async () => ({ ok: true }),
        reconcileActionEventRuntime: async () => ({ taskId: "task-1", eventId: "event-1", status: "stopped", changed: true }),
        updateActionExecution: async () => ({ ok: true }),
        addHyperPlanSubExecution: async () => ({ ok: true }),
        appendHyperPlanSubExecutionStreamEvent: async () => ({ ok: true }),
        updateHyperPlanSubExecution: async () => ({ ok: true }),
        setHyperPlanReconcileLabels: async () => ({ ok: true }),
        createSnapshotEvent: async () => ({ eventId: "snapshot-1", createdAt: "2026-05-26T00:00:00.000Z" }),
        createComment: async () => ({ commentId: "comment-1", createdAt: "2026-05-26T00:00:00.000Z" }),
        editComment: async () => ({ ok: true }),
        deleteComment: async () => ({ ok: true }),
        updateTaskMetadata: async () => ({ ok: true }),
    }
}

describe("OpenADE runtime module", () => {
    it("keeps product execution modes inside OpenADE-owned runtime methods", () => {
        const runtime = new RuntimeServer({ serverName: "test-runtime" })
        runtime.registerModule(createOpenADEModule(adapters(async () => ({ taskId: "task-1" }))))

        const productModes = new Set(["do", "ask", "plan", "run", "run_plan", "review", "revise", "hyperplan"])
        const leakedMethods = runtime
            .capabilities()
            .methods.filter((method) => !method.startsWith("openade/"))
            .filter((method) => method.split("/").some((segment) => productModes.has(segment)))

        expect(leakedMethods).toEqual([])
        expect(runtime.capabilities().methods).toEqual(
            expect.arrayContaining([
                "openade/task/create",
                "openade/turn/start",
                "openade/review/start",
                "openade/queued-turn/enqueue",
                "openade/queued-turn/reorder",
                "openade/queued-turn/cancel",
            ])
        )
        expect(runtime.capabilities().notifications).toEqual(expect.arrayContaining(["openade/queuedTurn/updated"]))
    })

    it("creates tasks through the OpenADE runtime method", async () => {
        const runtime = new RuntimeServer({ serverName: "test-runtime" })
        const createTask = vi.fn(async (params: Parameters<OpenADEModuleAdapters["createTask"]>[0]) => ({
            taskId: params.taskId ?? "task-created",
            slug: params.slug ?? "task-created",
            title: params.title ?? "Created task",
            createdAt: params.createdAt ?? "2026-05-26T00:00:00.000Z",
        }))
        runtime.registerModule(createOpenADEModule({ ...adapters(async () => ({ taskId: "task-1" })), createTask }))

        const response = await runtime.handleRequest(
            {
                id: 1,
                method: "openade/task/create",
                params: {
                    repoId: "repo-1",
                    taskId: "task-created",
                    slug: "created-task",
                    title: "Created task",
                    input: "Create without starting execution",
                    createdBy: { id: "user-1", email: "user@example.com" },
                    deviceId: "device-1",
                    isolationStrategy: { type: "head" },
                    clientRequestId: "task-create-request",
                },
            },
            connection()
        )

        expect(response).toMatchObject({
            id: 1,
            result: {
                taskId: "task-created",
                slug: "created-task",
                title: "Created task",
            },
        })
        expect(createTask).toHaveBeenCalledTimes(1)
    })

    it("retains completed clientRequestId results so retrying does not duplicate turns", async () => {
        const runtime = new RuntimeServer({ serverName: "test-runtime" })
        const startTurn = vi.fn(async () => ({ taskId: "task-1" }))
        runtime.registerModule(createOpenADEModule(adapters(startTurn)))

        const params = {
            repoId: "repo-1",
            type: "do",
            input: "ship it",
            clientRequestId: "request-1",
        }

        const first = await runtime.handleRequest({ id: 1, method: "openade/turn/start", params }, connection())
        const retry = await runtime.handleRequest({ id: 2, method: "openade/turn/start", params }, connection())

        expect(first.error).toBeUndefined()
        expect(retry.error).toBeUndefined()
        expect(first.result).toEqual({ taskId: "task-1" })
        expect(retry.result).toEqual({ taskId: "task-1" })
        expect(startTurn).toHaveBeenCalledTimes(1)
    })

    it("passes fast task read options to adapters", async () => {
        const runtime = new RuntimeServer({ serverName: "test-runtime" })
        const readTask = vi.fn<OpenADEModuleAdapters["readTask"]>(async (_repoId, taskId) => ({
            id: taskId,
            repoId: "repo-1",
            slug: taskId,
            title: taskId,
            description: "",
            deviceEnvironments: [],
            events: [],
            comments: [],
        }))
        runtime.registerModule(createOpenADEModule({ ...adapters(async () => ({ taskId: "task-1" })), readTask }))

        const response = await runtime.handleRequest(
            { id: 1, method: "openade/task/read", params: { repoId: "repo-1", taskId: "task-1", hydrateSessionEvents: false } },
            connection()
        )

        expect(response.error).toBeUndefined()
        expect(readTask).toHaveBeenCalledWith("repo-1", "task-1", { hydrateSessionEvents: false })
    })

    it("can suppress task preview notifications for stream-only task changes", () => {
        const runtime = new RuntimeServer({ serverName: "test-runtime" })
        runtime.registerModule(createOpenADEModule(adapters(async () => ({ taskId: "task-1" }))))
        const sent: RuntimeMessage[] = []
        runtime.connect({
            id: "notification-client",
            send(message) {
                sent.push(message)
            },
        })

        publishOpenADECompanionEvent(runtime, {
            type: "task_changed",
            repoId: "repo-1",
            taskId: "task-1",
            previewChanged: false,
            at: "2026-05-28T00:00:00.000Z",
        })

        expect(sent.map((message) => ("method" in message ? message.method : ""))).toEqual(["openade/task/updated"])
    })

    it("does not retain failed clientRequestId attempts", async () => {
        const runtime = new RuntimeServer({ serverName: "test-runtime" })
        const startTurn = vi
            .fn<OpenADEModuleAdapters["startTurn"]>()
            .mockRejectedValueOnce(new Error("temporary failure"))
            .mockResolvedValueOnce({ taskId: "task-2" })
        runtime.registerModule(createOpenADEModule(adapters(startTurn)))

        const params = {
            repoId: "repo-1",
            type: "ask",
            input: "try again",
            clientRequestId: "request-2",
        }

        const failed = await runtime.handleRequest({ id: 1, method: "openade/turn/start", params }, connection())
        const retry = await runtime.handleRequest({ id: 2, method: "openade/turn/start", params }, connection())

        expect(failed.error?.message).toBe("temporary failure")
        expect(retry.error).toBeUndefined()
        expect(retry.result).toEqual({ taskId: "task-2" })
        expect(startTurn).toHaveBeenCalledTimes(2)
    })

    it("scopes retained clientRequestId results by OpenADE method", async () => {
        const runtime = new RuntimeServer({ serverName: "test-runtime" })
        const startTurn = vi.fn(async () => ({ taskId: "turn-task" }))
        const startReview = vi.fn(async () => ({ taskId: "review-task" }))
        runtime.registerModule(createOpenADEModule({ ...adapters(startTurn), startReview }))

        const clientRequestId = "shared-request-id"
        const turn = await runtime.handleRequest(
            {
                id: 1,
                method: "openade/turn/start",
                params: { repoId: "repo-1", type: "do", input: "ship it", clientRequestId },
            },
            connection()
        )
        const review = await runtime.handleRequest(
            {
                id: 2,
                method: "openade/review/start",
                params: {
                    repoId: "repo-1",
                    taskId: "task-1",
                    reviewType: "work",
                    harnessId: "claude-code",
                    modelId: "sonnet",
                    clientRequestId,
                },
            },
            connection()
        )

        expect(turn.error).toBeUndefined()
        expect(review.error).toBeUndefined()
        expect(turn.result).toEqual({ taskId: "turn-task" })
        expect(review.result).toEqual({ taskId: "review-task" })
        expect(startTurn).toHaveBeenCalledTimes(1)
        expect(startReview).toHaveBeenCalledTimes(1)
    })

    it("retains completed clientRequestId results for non-turn mutations", async () => {
        const runtime = new RuntimeServer({ serverName: "test-runtime" })
        const base = adapters(async () => ({ taskId: "task-1" }))
        const createComment = vi.fn(async () => ({ commentId: "comment-1", createdAt: "2026-05-26T00:00:00.000Z" }))
        runtime.registerModule(createOpenADEModule({ ...base, createComment }))

        const params = {
            taskId: "task-1",
            content: "Looks good",
            source: { type: "task" },
            selectedText: { text: "", linesBefore: "", linesAfter: "" },
            author: { id: "user-1", email: "user@example.com" },
            clientRequestId: "comment-request-1",
        }

        const first = await runtime.handleRequest({ id: 1, method: "openade/comment/create", params }, connection())
        const retry = await runtime.handleRequest({ id: 2, method: "openade/comment/create", params }, connection())

        expect(first.error).toBeUndefined()
        expect(retry.error).toBeUndefined()
        expect(first.result).toEqual({ commentId: "comment-1", createdAt: "2026-05-26T00:00:00.000Z" })
        expect(retry.result).toEqual({ commentId: "comment-1", createdAt: "2026-05-26T00:00:00.000Z" })
        expect(createComment).toHaveBeenCalledTimes(1)
    })

    it("does not retain failed clientRequestId attempts for non-turn mutations", async () => {
        const runtime = new RuntimeServer({ serverName: "test-runtime" })
        const base = adapters(async () => ({ taskId: "task-1" }))
        const createComment = vi
            .fn<OpenADEModuleAdapters["createComment"]>()
            .mockRejectedValueOnce(new Error("temporary comment failure"))
            .mockResolvedValueOnce({ commentId: "comment-2", createdAt: "2026-05-26T00:00:00.000Z" })
        runtime.registerModule(createOpenADEModule({ ...base, createComment }))

        const params = {
            taskId: "task-1",
            content: "Retry me",
            source: { type: "task" },
            selectedText: { text: "", linesBefore: "", linesAfter: "" },
            author: { id: "user-1", email: "user@example.com" },
            clientRequestId: "comment-request-2",
        }

        const failed = await runtime.handleRequest({ id: 1, method: "openade/comment/create", params }, connection())
        const retry = await runtime.handleRequest({ id: 2, method: "openade/comment/create", params }, connection())

        expect(failed.error?.message).toBe("temporary comment failure")
        expect(retry.error).toBeUndefined()
        expect(retry.result).toEqual({ commentId: "comment-2", createdAt: "2026-05-26T00:00:00.000Z" })
        expect(createComment).toHaveBeenCalledTimes(2)
    })

    it("rejects malformed OpenADE params before runtime or adapter side effects", async () => {
        const runtime = new RuntimeServer({ serverName: "test-runtime" })
        const startTurn = vi.fn(async () => ({ taskId: "task-1" }))
        const saveDataDocumentBase64 = vi.fn(async () => ({ ok: true }))
        runtime.registerModule(createOpenADEModule({ ...adapters(startTurn), saveDataDocumentBase64 }))

        const badTurn = await runtime.handleRequest(
            {
                id: 1,
                method: "openade/turn/start",
                params: { type: "do", input: "ship it", clientRequestId: "bad-turn" },
            },
            connection()
        )
        const badDataSave = await runtime.handleRequest(
            {
                id: 2,
                method: "data/yjs/save",
                params: { id: "doc-1", data: "not base64" },
            },
            connection()
        )

        expect(badTurn.error?.code).toBe("invalid_params")
        expect(badTurn.error?.message).toBe("repoId is invalid")
        expect(badTurn.error?.data).toEqual({ path: "$.repoId" })
        expect(badDataSave.error?.code).toBe("invalid_params")
        expect(badDataSave.error?.message).toBe("data is invalid")
        expect(startTurn).not.toHaveBeenCalled()
        expect(saveDataDocumentBase64).not.toHaveBeenCalled()
        expect(runtime.supervisor.list({ ownerType: "openade-turn" })).toHaveLength(0)
    })

    it("validates data document reads without converting handler params", async () => {
        const runtime = new RuntimeServer({ serverName: "test-runtime" })
        const readDataDocumentBase64 = vi.fn(async (id: string) => ({ id, data: "AAAA" }))
        runtime.registerModule(createOpenADEModule({ ...adapters(async () => ({ taskId: "task-1" })), readDataDocumentBase64 }))

        const result = await runtime.handleRequest(
            {
                id: 1,
                method: "data/yjs/read",
                params: { id: "doc-1" },
            },
            connection()
        )

        expect(result.error).toBeUndefined()
        expect(result.result).toEqual({ id: "doc-1", data: "AAAA" })
        expect(readDataDocumentBase64).toHaveBeenCalledWith("doc-1")
    })

    it("exposes HyperPlan sub-execution mutation methods", async () => {
        const runtime = new RuntimeServer({ serverName: "test-runtime" })
        const base = adapters(async () => ({ taskId: "task-1" }))
        const addHyperPlanSubExecution = vi.fn(async () => ({ ok: true }))
        const appendHyperPlanSubExecutionStreamEvent = vi.fn(async () => ({ ok: true }))
        const updateHyperPlanSubExecution = vi.fn(async () => ({ ok: true }))
        const setHyperPlanReconcileLabels = vi.fn(async () => ({ ok: true }))
        runtime.registerModule(
            createOpenADEModule({
                ...base,
                addHyperPlanSubExecution,
                appendHyperPlanSubExecutionStreamEvent,
                updateHyperPlanSubExecution,
                setHyperPlanReconcileLabels,
            })
        )

        await runtime.handleRequest(
            {
                id: 1,
                method: "openade/hyperplan/subExecution/add",
                params: {
                    taskId: "task-1",
                    eventId: "event-1",
                    subExecution: {
                        stepId: "plan_a",
                        primitive: "plan",
                        harnessId: "claude-code",
                        modelId: "sonnet",
                        executionId: "",
                        status: "in_progress",
                        events: [],
                    },
                },
            },
            connection()
        )
        await runtime.handleRequest(
            {
                id: 2,
                method: "openade/hyperplan/subExecution/stream/append",
                params: {
                    taskId: "task-1",
                    eventId: "event-1",
                    stepId: "plan_a",
                    streamEvent: { id: "raw-1", type: "raw_message" },
                },
            },
            connection()
        )
        await runtime.handleRequest(
            {
                id: 3,
                method: "openade/hyperplan/subExecution/update",
                params: {
                    taskId: "task-1",
                    eventId: "event-1",
                    stepId: "plan_a",
                    executionId: "execution-1",
                    status: "stopped",
                },
            },
            connection()
        )
        await runtime.handleRequest(
            {
                id: 4,
                method: "openade/hyperplan/reconcileLabels/set",
                params: {
                    taskId: "task-1",
                    eventId: "event-1",
                    mapping: [{ stepId: "plan_a", label: "A" }],
                },
            },
            connection()
        )

        expect(addHyperPlanSubExecution).toHaveBeenCalledWith(expect.objectContaining({ taskId: "task-1", eventId: "event-1" }))
        expect(appendHyperPlanSubExecutionStreamEvent).toHaveBeenCalledWith(expect.objectContaining({ stepId: "plan_a" }))
        expect(updateHyperPlanSubExecution).toHaveBeenCalledWith(expect.objectContaining({ executionId: "execution-1", status: "stopped" }))
        expect(setHyperPlanReconcileLabels).toHaveBeenCalledWith(expect.objectContaining({ mapping: [{ stepId: "plan_a", label: "A" }] }))
    })
})
