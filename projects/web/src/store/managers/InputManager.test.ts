import { beforeEach, describe, expect, it, vi } from "vitest"
import { OPENADE_METHOD } from "../../../../openade-client/src"
import type { ImageAttachment, QueuedTurn } from "../../types"
import { InputManager } from "./InputManager"
import { QueuedTurnManager } from "./QueuedTurnManager"

const TEST_IMAGE: ImageAttachment = {
    id: "img-1",
    mediaType: "image/png",
    ext: "png",
    originalWidth: 100,
    originalHeight: 100,
    resizedWidth: 100,
    resizedHeight: 100,
}

const mocks = vi.hoisted(() => ({
    startTurn: vi.fn(
        async (request: { type: string }): Promise<{ taskId: string; eventId?: string; queued?: boolean; queuedTurnId?: string }> => ({
            taskId: "task-1",
            queued: true,
            queuedTurnId: `queued-${request.type}`,
        })
    ),
    interruptTurn: vi.fn(async (_taskId: string) => undefined),
}))

vi.mock("../../runtime/localOpenADEClient", () => ({
    localOpenADEClient: {
        startTurn: mocks.startTurn,
        interruptTurn: mocks.interruptTurn,
    },
}))

function createDeferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void
    let reject!: (error?: unknown) => void
    const promise = new Promise<T>((promiseResolve, promiseReject) => {
        resolve = promiseResolve
        reject = promiseReject
    })
    return { promise, resolve, reject }
}

function createManager({
    queuedTurns = [],
    isTaskRunning = () => true,
    refreshTaskStoreFromStorage = vi.fn(async () => undefined),
    runtimeProductAPI = false,
    usesCoreOwnedProductRuntime = false,
    runtimeProductTaskRoute = runtimeProductAPI || usesCoreOwnedProductRuntime,
    methodChecksPromoteRuntimeProductAPI = true,
    isolationStrategy = { type: "head" as const },
    closed = false,
    environment = null,
    taskWorkingDirHint = environment?.taskWorkingDir ?? null,
    loadEnvironment = vi.fn(async () => environment),
    hasGitStateLoaded = true,
    hasActivePlan = false,
    hasWorkingChanges = false,
    aheadCount = 0,
    stopAllForContext = vi.fn(async () => undefined),
    canUseProductMethod = () => true,
    pendingImages = [],
}: {
    queuedTurns?: QueuedTurn[]
    isTaskRunning?: (taskId: string) => boolean
    refreshTaskStoreFromStorage?: (taskId: string) => Promise<void>
    runtimeProductAPI?: boolean
    usesCoreOwnedProductRuntime?: boolean
    runtimeProductTaskRoute?: boolean
    methodChecksPromoteRuntimeProductAPI?: boolean
    isolationStrategy?: { type: "head" } | { type: "worktree"; sourceBranch: string }
    closed?: boolean
    environment?: { taskWorkingDir: string } | null
    taskWorkingDirHint?: string | null
    loadEnvironment?: () => Promise<{ taskWorkingDir: string } | null>
    hasGitStateLoaded?: boolean
    hasActivePlan?: boolean
    hasWorkingChanges?: boolean
    aheadCount?: number
    stopAllForContext?: (
        context: { type: "worktree"; root: string },
        access?: { stopProjectProcess(args: { processId: string }): Promise<unknown> }
    ) => Promise<void>
    canUseProductMethod?: (method: string) => boolean
    pendingImages?: ImageAttachment[]
} = {}) {
    let runtimeProductAPIAvailable = runtimeProductAPI
    const canUseProductMethodAfterConnect = vi.fn(async (method: string) => {
        if (!canUseProductMethod(method)) return false
        if (methodChecksPromoteRuntimeProductAPI) runtimeProductAPIAvailable = true
        return true
    })
    const cancelQueuedTurn = vi.fn(async () => true)
    const setTaskClosed = vi.fn(async () => undefined)
    const task = {
        id: "task-1",
        repoId: "repo-1",
        closed,
        isolationStrategy,
        events: [
            {
                id: "event-1",
                type: "action",
                status: "completed",
                createdAt: "2026-06-01T00:00:00.000Z",
                source: { type: "do", userLabel: "Do" },
                execution: { events: [] },
            },
        ],
        queuedTurns,
    }
    const refreshGitState = vi.fn(async () => undefined)
    const taskModel = {
        repoId: "repo-1",
        hasActivePlan,
        hasWorkingChanges,
        hasGitStateLoaded,
        aheadCount,
        enabledMcpServerIds: ["mcp-1"],
        harnessId: "codex",
        model: "gpt-5-codex",
        thinking: "med",
        fastMode: true,
        gitStatus: { branch: "openade/task-1" },
        hasGhCli: true,
        environment,
        taskWorkingDirHint,
        loadEnvironment,
        queuedTurns,
        cancelQueuedTurn,
        refreshGitState,
        invalidateEnvironmentCache: vi.fn(),
    }
    const interruptTask = vi.fn(async (taskId: string) => {
        await mocks.interruptTurn(taskId)
        return true
    })
    const queuedTurnManager = new QueuedTurnManager()
    const store = {
        isTaskRunning: vi.fn((taskId: string) => taskId === "task-1" && isTaskRunning(taskId)),
        shouldUseRuntimeProductAPI: vi.fn(() => runtimeProductAPIAvailable),
        usesCoreOwnedProductRuntime: vi.fn(() => usesCoreOwnedProductRuntime),
        shouldUseRuntimeProductTaskRoute: vi.fn(() => runtimeProductTaskRoute),
        canUseProductMethod: vi.fn(canUseProductMethod),
        canUseProductMethodAfterConnect,
        startProductTurn: mocks.startTurn,
        persistProductTaskImage: vi.fn(async () => undefined),
        refreshRuntimeProductSnapshot: vi.fn(async () => null),
        refreshRuntimeProductTaskForTaskId: vi.fn(async () => null),
        getTaskStore: vi.fn(async () => undefined),
        refreshTaskStoreFromStorage,
        startProductProjectProcess: vi.fn(),
        reconnectProductProjectProcess: vi.fn(),
        stopProductProjectProcess: vi.fn(async () => ({ repoId: "repo-1", taskId: "task-1", processId: "process-1", ok: true })),
        repoProcesses: {
            stopAllForContext,
        },
        queuedTurns: queuedTurnManager,
        queries: {
            interruptTask,
            abortTask: vi.fn(async () => undefined),
        },
        repeat: {
            activeTaskId: null,
            isActive: false,
        },
        comments: {
            getPendingCommentCount: () => 0,
        },
        tasks: {
            getTask: (taskId: string) => (taskId === "task-1" ? task : null),
            getTaskModel: (taskId: string) => (taskId === "task-1" ? taskModel : null),
            setTaskClosed,
        },
        personalSettingsStore: {
            settings: {
                current: {},
            },
        },
    }
    const editor = {
        value: "follow up after this",
        pendingImages,
        clear: vi.fn(),
        setValue: vi.fn(),
        captureSnapshot: vi.fn(() => ({
            value: "follow up after this",
            files: [],
            editorContent: null,
            pendingImages,
            pendingImageDataUrls: new Map(),
        })),
        restoreSnapshot: vi.fn(),
        files: [],
    }

    return {
        manager: new InputManager(store as never, "task-1", editor as never),
        store,
        editor,
        cancelQueuedTurn,
        interruptTask,
        queuedTurnManager,
        setTaskClosed,
        taskModel,
        canUseProductMethodAfterConnect,
    }
}

beforeEach(() => {
    mocks.startTurn.mockClear()
    mocks.interruptTurn.mockClear()
})

describe("InputManager queueable desktop commands", () => {
    it("keeps Do and Ask available while the task is running so desktop users can queue follow-ups", async () => {
        const { manager, editor } = createManager()

        const doCommand = manager.commands.find((command) => command.id === "do")
        const askCommand = manager.commands.find((command) => command.id === "ask")

        expect(manager.commands.map((command) => command.id)).toContain("stop")
        expect(doCommand).toMatchObject({ id: "do", label: "Do Next", enabled: true })
        expect(askCommand).toMatchObject({ id: "ask", label: "Ask Next", enabled: true })

        await manager.runCommand("do")
        await manager.runCommand("ask")

        expect(editor.clear).toHaveBeenCalledTimes(2)
        expect(mocks.startTurn).toHaveBeenCalledWith(
            expect.objectContaining({
                repoId: "repo-1",
                inTaskId: "task-1",
                type: "do",
                input: "follow up after this",
            })
        )
        expect(mocks.startTurn).toHaveBeenCalledWith(
            expect.objectContaining({
                repoId: "repo-1",
                inTaskId: "task-1",
                type: "ask",
                input: "follow up after this",
            })
        )
    })

    it("keeps the accepted queued row when the first refresh has not observed the queued metadata yet", async () => {
        const refresh = createDeferred<void>()
        const { manager } = createManager({
            refreshTaskStoreFromStorage: vi.fn(() => refresh.promise),
        })

        const run = manager.runCommand("do")

        await vi.waitFor(() => {
            expect(manager.queuedTurns).toEqual([
                expect.objectContaining({
                    id: "queued-do",
                    type: "do",
                    input: "follow up after this",
                    status: "queued",
                    label: "Do Next",
                }),
            ])
        })

        refresh.resolve()
        await run

        expect(manager.queuedTurns).toEqual([
            expect.objectContaining({
                id: "queued-do",
                status: "queued",
            }),
        ])
    })

    it("uses runtime product mutation cache instead of opening a direct task store when clean Core has no snapshot", async () => {
        const { manager, store } = createManager({ runtimeProductAPI: true })

        await manager.runCommand("do")

        expect(store.getTaskStore).not.toHaveBeenCalled()
        expect(store.refreshTaskStoreFromStorage).not.toHaveBeenCalled()
        expect(store.refreshRuntimeProductSnapshot).not.toHaveBeenCalled()
        expect(store.refreshRuntimeProductTaskForTaskId).not.toHaveBeenCalled()
    })

    it("does not open a direct task store when only the runtime task route is ready", async () => {
        const { manager, store } = createManager({
            runtimeProductAPI: false,
            runtimeProductTaskRoute: true,
            methodChecksPromoteRuntimeProductAPI: false,
        })

        await manager.runCommand("do")

        expect(store.getTaskStore).not.toHaveBeenCalled()
        expect(store.refreshTaskStoreFromStorage).not.toHaveBeenCalled()
        expect(mocks.startTurn).toHaveBeenCalledWith(
            expect.objectContaining({
                repoId: "repo-1",
                type: "do",
                input: "follow up after this",
            })
        )
    })

    it("omits stale MCP connector ids from runtime turn payloads when MCP reads are denied", async () => {
        const { manager } = createManager({
            runtimeProductAPI: true,
            canUseProductMethod: (method) => method !== OPENADE_METHOD.settingsMcpServersRead,
        })

        await manager.runCommand("do")

        const request = mocks.startTurn.mock.calls.at(-1)?.[0]
        if (!request) throw new Error("Missing start-turn request")
        expect("enabledMcpServerIds" in request).toBe(false)
        expect(manager.queuedTurns).toEqual([
            expect.objectContaining({
                id: "queued-do",
                enabledMcpServerIds: [],
            }),
        ])
    })

    it("omits stale image refs from runtime turn payloads when image writes are denied", async () => {
        const { manager } = createManager({
            runtimeProductAPI: true,
            pendingImages: [TEST_IMAGE],
            canUseProductMethod: (method) => method !== OPENADE_METHOD.taskImageWrite,
        })

        expect(manager.canAttachImages).toBe(false)

        await manager.runCommand("do")

        const request = mocks.startTurn.mock.calls.at(-1)?.[0]
        if (!request) throw new Error("Missing start-turn request")
        expect(request).toEqual(expect.objectContaining({ images: [] }))
        expect(manager.queuedTurns).toEqual([
            expect.objectContaining({
                id: "queued-do",
                images: [],
            }),
        ])
    })

    it("does not open or refresh legacy task storage when Core owns product state without runtime product access", async () => {
        const { manager, store, canUseProductMethodAfterConnect } = createManager({
            runtimeProductAPI: false,
            usesCoreOwnedProductRuntime: true,
            canUseProductMethod: () => true,
        })

        await manager.runCommand("do")

        expect(canUseProductMethodAfterConnect).toHaveBeenCalledWith(OPENADE_METHOD.turnStart)
        expect(store.getTaskStore).not.toHaveBeenCalled()
        expect(store.refreshTaskStoreFromStorage).not.toHaveBeenCalled()
        expect(mocks.startTurn).toHaveBeenCalledWith(
            expect.objectContaining({
                repoId: "repo-1",
                inTaskId: "task-1",
                type: "do",
            })
        )
    })

    it("hides turn-start commands when a runtime product session lacks turn start capability", async () => {
        const { manager, editor } = createManager({
            runtimeProductAPI: true,
            isTaskRunning: () => false,
            hasWorkingChanges: true,
            canUseProductMethod: (method) => method !== OPENADE_METHOD.turnStart,
        })

        const commandIds = manager.commands.map((command) => command.id)

        expect(commandIds).not.toContain("do")
        expect(commandIds).not.toContain("ask")
        expect(commandIds).not.toContain("plan")
        expect(commandIds).not.toContain("repeat")
        expect(commandIds).not.toContain("commitAndPush")
        expect(commandIds).toContain("review")
        expect(commandIds).toContain("close")

        await manager.runCommand("do")
        await manager.runCommand("commitAndPush")

        expect(editor.clear).not.toHaveBeenCalled()
        expect(mocks.startTurn).not.toHaveBeenCalled()
    })

    it("hides review commands when a runtime product session lacks review start capability", async () => {
        const idle = createManager({
            runtimeProductAPI: true,
            isTaskRunning: () => false,
            canUseProductMethod: (method) => method !== OPENADE_METHOD.reviewStart,
        })
        const planned = createManager({
            runtimeProductAPI: true,
            isTaskRunning: () => false,
            hasActivePlan: true,
            canUseProductMethod: (method) => method !== OPENADE_METHOD.reviewStart,
        })

        const idleCommandIds = idle.manager.commands.map((command) => command.id)
        const plannedCommandIds = planned.manager.commands.map((command) => command.id)

        expect(idleCommandIds).not.toContain("review")
        expect(idleCommandIds).toContain("do")
        expect(plannedCommandIds).not.toContain("reviewPlan")
        expect(plannedCommandIds).toContain("runPlan")
    })

    it("hides metadata commands when a runtime product session lacks task metadata update capability", async () => {
        const open = createManager({
            runtimeProductAPI: true,
            isTaskRunning: () => false,
            hasActivePlan: true,
            canUseProductMethod: (method) => method !== OPENADE_METHOD.taskMetadataUpdate,
        })
        const closed = createManager({
            runtimeProductAPI: true,
            isTaskRunning: () => false,
            closed: true,
            canUseProductMethod: (method) => method !== OPENADE_METHOD.taskMetadataUpdate,
        })

        const openCommandIds = open.manager.commands.map((command) => command.id)
        const closedCommandIds = closed.manager.commands.map((command) => command.id)

        expect(openCommandIds).not.toContain("cancelPlan")
        expect(openCommandIds).not.toContain("close")
        expect(openCommandIds).toContain("runPlan")
        expect(closedCommandIds).not.toContain("reopen")

        await open.manager.runCommand("close")
        expect(open.setTaskClosed).not.toHaveBeenCalled()
    })

    it("keeps Commit & Push reachable in runtime mode without route-open git polling, then refreshes git on click", async () => {
        mocks.startTurn.mockResolvedValueOnce({ taskId: "task-1", eventId: "event-2" })
        const { manager, taskModel } = createManager({
            runtimeProductAPI: true,
            isTaskRunning: () => false,
            hasGitStateLoaded: false,
            hasWorkingChanges: true,
        })

        expect(manager.commands.map((command) => command.id)).toContain("commitAndPush")

        await manager.runCommand("commitAndPush")

        expect(taskModel.refreshGitState).toHaveBeenCalledWith({ force: true })
        expect(mocks.startTurn).toHaveBeenCalledWith(
            expect.objectContaining({
                repoId: "repo-1",
                type: "do",
                label: "Commit & Push",
                includeComments: false,
            })
        )
    })

    it("does not clear the commit instructions or start a runtime turn when refreshed git has nothing to commit or push", async () => {
        const { manager, editor, taskModel } = createManager({
            runtimeProductAPI: true,
            isTaskRunning: () => false,
            hasGitStateLoaded: false,
            hasWorkingChanges: false,
            aheadCount: 0,
        })

        await manager.runCommand("commitAndPush")

        expect(taskModel.refreshGitState).toHaveBeenCalledWith({ force: true })
        expect(editor.clear).not.toHaveBeenCalled()
        expect(mocks.startTurn).not.toHaveBeenCalled()
    })

    it("does not run Commit & Push when Core-owned refreshed git state is unavailable", async () => {
        const { manager, editor, taskModel } = createManager({
            runtimeProductAPI: false,
            usesCoreOwnedProductRuntime: true,
            isTaskRunning: () => false,
            hasGitStateLoaded: false,
            hasWorkingChanges: true,
            canUseProductMethod: () => true,
        })
        taskModel.refreshGitState.mockImplementation(async () => {
            taskModel.hasWorkingChanges = false
            taskModel.aheadCount = 0
        })

        expect(manager.commands.map((command) => command.id)).toContain("commitAndPush")

        await manager.runCommand("commitAndPush")

        expect(taskModel.refreshGitState).toHaveBeenCalledWith({ force: true })
        expect(editor.clear).not.toHaveBeenCalled()
        expect(mocks.startTurn).not.toHaveBeenCalled()
    })

    it("hides the accepted queued row once storage knows that queued turn is no longer queued", async () => {
        const queuedTurns: QueuedTurn[] = []
        const { manager } = createManager({
            queuedTurns,
        })

        await manager.runCommand("do")
        queuedTurns.push({
            id: "queued-do",
            type: "do",
            input: "follow up after this",
            status: "running",
            createdAt: "2026-05-28T00:00:00.000Z",
            updatedAt: "2026-05-28T00:00:01.000Z",
        })

        expect(manager.queuedTurns).toEqual([])
    })

    it("hides the queued row when the server reports that queued turn is running", async () => {
        const { manager, queuedTurnManager } = createManager()

        await manager.runCommand("do")

        expect(manager.queuedTurns).toEqual([
            expect.objectContaining({
                id: "queued-do",
                status: "queued",
            }),
        ])

        queuedTurnManager.applyNotification({
            method: "openade/queuedTurn/updated",
            params: {
                repoId: "repo-1",
                taskId: "task-1",
                turn: {
                    id: "queued-do",
                    type: "do",
                    input: "follow up after this",
                    status: "running",
                    createdAt: "2026-05-28T00:00:00.000Z",
                    updatedAt: "2026-05-28T00:00:01.000Z",
                },
            },
        })

        expect(manager.queuedTurns).toEqual([])
    })

    it("interrupts the running turn and submits the typed message immediately instead of queueing it", async () => {
        let running = true
        mocks.interruptTurn.mockImplementationOnce(async () => {
            running = false
        })
        mocks.startTurn.mockResolvedValueOnce({ taskId: "task-1", eventId: "event-2" })
        const { manager, editor, interruptTask } = createManager({
            isTaskRunning: () => running,
        })

        expect(manager.commands.find((command) => command.id === "interrupt")).toMatchObject({
            id: "interrupt",
            label: "Interrupt",
            enabled: true,
        })

        await manager.runCommand("interrupt")

        expect(interruptTask).toHaveBeenCalledWith("task-1")
        expect(mocks.interruptTurn).toHaveBeenCalledWith("task-1")
        expect(mocks.startTurn).toHaveBeenCalledWith(
            expect.objectContaining({
                repoId: "repo-1",
                inTaskId: "task-1",
                type: "do",
                input: "follow up after this",
            })
        )
        expect(editor.clear).toHaveBeenCalledWith({ revokeImagePreviews: false })
    })

    it("does not restore the interrupted draft after the replacement turn has been accepted", async () => {
        let running = true
        mocks.interruptTurn.mockImplementationOnce(async () => {
            running = false
        })
        mocks.startTurn.mockResolvedValueOnce({ taskId: "task-1", eventId: "event-2" })
        const { manager, editor } = createManager({
            isTaskRunning: () => running,
            refreshTaskStoreFromStorage: vi.fn(async () => {
                throw new Error("refresh failed")
            }),
        })

        await expect(manager.runCommand("interrupt")).rejects.toThrow("refresh failed")

        expect(mocks.startTurn).toHaveBeenCalledTimes(1)
        expect(editor.restoreSnapshot).not.toHaveBeenCalled()
    })

    it("exposes cancellable queued turns without showing old queue history", async () => {
        const { manager, cancelQueuedTurn } = createManager({
            queuedTurns: [
                {
                    id: "queued-do",
                    type: "do",
                    input: "Run this next",
                    status: "queued",
                    createdAt: "2026-05-28T00:00:00.000Z",
                    updatedAt: "2026-05-28T00:00:00.000Z",
                },
                {
                    id: "old-ask",
                    type: "ask",
                    input: "Already cancelled",
                    status: "cancelled",
                    createdAt: "2026-05-28T00:00:00.000Z",
                    updatedAt: "2026-05-28T00:00:00.000Z",
                },
            ],
        })

        expect(manager.queuedTurns.map((turn) => turn.id)).toEqual(["queued-do"])

        await manager.cancelQueuedTurn("queued-do")

        expect(cancelQueuedTurn).toHaveBeenCalledWith("queued-do")
    })

    it("does not cancel or optimistically suppress queued turns when cancel is unavailable", async () => {
        const { manager, cancelQueuedTurn } = createManager({
            runtimeProductAPI: true,
            canUseProductMethod: (method) => method !== OPENADE_METHOD.queuedTurnCancel,
            queuedTurns: [
                {
                    id: "queued-do",
                    type: "do",
                    input: "Run this next",
                    status: "queued",
                    createdAt: "2026-05-28T00:00:00.000Z",
                    updatedAt: "2026-05-28T00:00:00.000Z",
                },
            ],
        })

        expect(manager.canCancelQueuedTurn).toBe(false)

        await manager.cancelQueuedTurn("queued-do")

        expect(cancelQueuedTurn).not.toHaveBeenCalled()
        expect(manager.queuedTurns.map((turn) => turn.id)).toEqual(["queued-do"])
    })

    it("does not persist images when image upload is unavailable", async () => {
        const { manager, store } = createManager({
            runtimeProductAPI: true,
            canUseProductMethod: (method) => method !== OPENADE_METHOD.taskImageWrite,
        })

        expect(manager.canAttachImages).toBe(false)

        await expect(
            manager.persistImage({
                id: "image-1",
                ext: "png",
                mediaType: "image/png",
                data: new ArrayBuffer(0),
            })
        ).rejects.toThrow("Task image upload is not available from this runtime")
        expect(store.persistProductTaskImage).not.toHaveBeenCalled()
    })

    it("fails closed on command and image capabilities while Core owns product state but runtime access is unavailable", async () => {
        const { manager, store } = createManager({
            runtimeProductAPI: false,
            usesCoreOwnedProductRuntime: true,
            isTaskRunning: () => false,
            canUseProductMethod: () => false,
        })

        const commandIds = manager.commands.map((command) => command.id)

        expect(commandIds).not.toContain("do")
        expect(commandIds).not.toContain("ask")
        expect(commandIds).not.toContain("review")
        expect(commandIds).not.toContain("close")
        expect(manager.canAttachImages).toBe(false)

        await manager.runCommand("do")

        expect(mocks.startTurn).not.toHaveBeenCalled()
        expect(store.persistProductTaskImage).not.toHaveBeenCalled()
    })

    it("stops worktree product processes through scoped process APIs before closing runtime-backed tasks", async () => {
        const stopAllForContext = vi.fn(
            async (_context: { type: "worktree"; root: string }, access?: { stopProjectProcess(args: { processId: string }): Promise<unknown> }) => {
                await access?.stopProjectProcess({ processId: "process-1" })
            }
        )
        const { manager, store, setTaskClosed } = createManager({
            isTaskRunning: () => false,
            isolationStrategy: { type: "worktree", sourceBranch: "main" },
            environment: { taskWorkingDir: "/tmp/runtime-worktree" },
            stopAllForContext,
            runtimeProductAPI: true,
        })

        await manager.runCommand("close")

        expect(stopAllForContext).toHaveBeenCalledWith(
            { type: "worktree", root: "/tmp/runtime-worktree" },
            expect.objectContaining({ stopProjectProcess: expect.any(Function) })
        )
        expect(store.stopProductProjectProcess).toHaveBeenCalledWith({ repoId: "repo-1", taskId: "task-1", processId: "process-1" })
        expect(setTaskClosed).toHaveBeenCalledWith("task-1", true)
    })

    it("keeps worktree process cleanup on scoped APIs while Core owns product state before runtime access is active", async () => {
        const stopAllForContext = vi.fn(
            async (_context: { type: "worktree"; root: string }, access?: { stopProjectProcess(args: { processId: string }): Promise<unknown> }) => {
                await access?.stopProjectProcess({ processId: "process-1" })
            }
        )
        const { manager, store, setTaskClosed } = createManager({
            isTaskRunning: () => false,
            isolationStrategy: { type: "worktree", sourceBranch: "main" },
            environment: { taskWorkingDir: "/tmp/core-worktree" },
            stopAllForContext,
            runtimeProductAPI: false,
            usesCoreOwnedProductRuntime: true,
        })

        await manager.runCommand("close")

        expect(stopAllForContext).toHaveBeenCalledWith(
            { type: "worktree", root: "/tmp/core-worktree" },
            expect.objectContaining({ stopProjectProcess: expect.any(Function) })
        )
        expect(store.stopProductProjectProcess).toHaveBeenCalledWith({ repoId: "repo-1", taskId: "task-1", processId: "process-1" })
        expect(setTaskClosed).toHaveBeenCalledWith("task-1", true)
    })

    it("stops runtime worktree processes from the task working-dir hint without preloading environment", async () => {
        const stopAllForContext = vi.fn(
            async (_context: { type: "worktree"; root: string }, access?: { stopProjectProcess(args: { processId: string }): Promise<unknown> }) => {
                await access?.stopProjectProcess({ processId: "process-1" })
            }
        )
        const loadEnvironment = vi.fn(async () => ({ taskWorkingDir: "/tmp/should-not-load" }))
        const { manager, store, setTaskClosed } = createManager({
            isTaskRunning: () => false,
            isolationStrategy: { type: "worktree", sourceBranch: "main" },
            environment: null,
            taskWorkingDirHint: "/tmp/runtime-worktree-hint",
            loadEnvironment,
            stopAllForContext,
            runtimeProductAPI: true,
        })

        await manager.runCommand("close")

        expect(loadEnvironment).not.toHaveBeenCalled()
        expect(stopAllForContext).toHaveBeenCalledWith(
            { type: "worktree", root: "/tmp/runtime-worktree-hint" },
            expect.objectContaining({ stopProjectProcess: expect.any(Function) })
        )
        expect(store.stopProductProjectProcess).toHaveBeenCalledWith({ repoId: "repo-1", taskId: "task-1", processId: "process-1" })
        expect(setTaskClosed).toHaveBeenCalledWith("task-1", true)
    })

    it("loads a runtime worktree environment during explicit close when no working-dir hint is cached", async () => {
        const stopAllForContext = vi.fn(
            async (_context: { type: "worktree"; root: string }, access?: { stopProjectProcess(args: { processId: string }): Promise<unknown> }) => {
                await access?.stopProjectProcess({ processId: "process-1" })
            }
        )
        const loadEnvironment = vi.fn(async () => ({ taskWorkingDir: "/tmp/runtime-worktree-loaded" }))
        const { manager, store, setTaskClosed } = createManager({
            isTaskRunning: () => false,
            isolationStrategy: { type: "worktree", sourceBranch: "main" },
            environment: null,
            taskWorkingDirHint: null,
            loadEnvironment,
            stopAllForContext,
            runtimeProductAPI: true,
        })

        await manager.runCommand("close")

        expect(loadEnvironment).toHaveBeenCalledTimes(1)
        expect(stopAllForContext).toHaveBeenCalledWith(
            { type: "worktree", root: "/tmp/runtime-worktree-loaded" },
            expect.objectContaining({ stopProjectProcess: expect.any(Function) })
        )
        expect(store.stopProductProjectProcess).toHaveBeenCalledWith({ repoId: "repo-1", taskId: "task-1", processId: "process-1" })
        expect(setTaskClosed).toHaveBeenCalledWith("task-1", true)
    })
})
