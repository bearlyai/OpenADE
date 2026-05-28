import { beforeEach, describe, expect, it, vi } from "vitest"
import type { QueuedTurn } from "../../types"
import { InputManager } from "./InputManager"

const mocks = vi.hoisted(() => ({
    startTurn: vi.fn(async () => ({ taskId: "task-1", queued: true, queuedTurnId: "queued-1" })),
}))

vi.mock("../../runtime/localOpenADEClient", () => ({
    localOpenADEClient: {
        startTurn: mocks.startTurn,
    },
}))

function createManager({ queuedTurns = [] }: { queuedTurns?: QueuedTurn[] } = {}) {
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
    const store = {
        isTaskRunning: (taskId: string) => taskId === "task-1",
        getTaskStore: vi.fn(async () => undefined),
        refreshTaskStoreFromStorage: vi.fn(async () => undefined),
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
        files: [],
    }

    return {
        manager: new InputManager(store as never, "task-1", editor as never),
        store,
        editor,
        cancelQueuedTurn,
    }
}

beforeEach(() => {
    mocks.startTurn.mockClear()
})

describe("InputManager queueable desktop commands", () => {
    it("keeps Do and Ask available while the task is running so desktop users can queue follow-ups", async () => {
        const { manager, editor } = createManager()

        const doCommand = manager.commands.find((command) => command.id === "do")
        const askCommand = manager.commands.find((command) => command.id === "ask")

        expect(manager.commands.map((command) => command.id)).toContain("stop")
        expect(doCommand).toMatchObject({ id: "do", enabled: true })
        expect(askCommand).toMatchObject({ id: "ask", enabled: true })

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
