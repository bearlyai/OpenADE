import { beforeEach, describe, expect, it, vi } from "vitest"
import type { QueuedTurn } from "../../types"
import { InputManager } from "./InputManager"
import { QueuedTurnManager } from "./QueuedTurnManager"

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
}: {
    queuedTurns?: QueuedTurn[]
    isTaskRunning?: (taskId: string) => boolean
    refreshTaskStoreFromStorage?: (taskId: string) => Promise<void>
} = {}) {
    const cancelQueuedTurn = vi.fn(async () => undefined)
    const task = {
        id: "task-1",
        repoId: "repo-1",
        closed: false,
        events: [],
        queuedTurns,
    }
    const taskModel = {
        repoId: "repo-1",
        hasActivePlan: false,
        hasWorkingChanges: false,
        aheadCount: 0,
        enabledMcpServerIds: ["mcp-1"],
        harnessId: "codex",
        model: "gpt-5-codex",
        thinking: "med",
        fastMode: true,
        queuedTurns,
        cancelQueuedTurn,
    }
    const interruptTask = vi.fn(async (taskId: string) => {
        await mocks.interruptTurn(taskId)
        return true
    })
    const queuedTurnManager = new QueuedTurnManager()
    const store = {
        isTaskRunning: vi.fn((taskId: string) => taskId === "task-1" && isTaskRunning(taskId)),
        getTaskStore: vi.fn(async () => undefined),
        refreshTaskStoreFromStorage,
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
        },
        personalSettingsStore: {
            settings: {
                current: {},
            },
        },
    }
    const editor = {
        value: "follow up after this",
        pendingImages: [],
        clear: vi.fn(),
        setValue: vi.fn(),
        captureSnapshot: vi.fn(() => ({
            value: "follow up after this",
            files: [],
            editorContent: null,
            pendingImages: [],
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
})
