import { beforeEach, describe, expect, it, vi } from "vitest"
import { InputManager } from "./InputManager"

const mocks = vi.hoisted(() => ({
    startTurn: vi.fn(async () => ({ taskId: "task-1", queued: true, queuedTurnId: "queued-1" })),
}))

vi.mock("../../runtime/localOpenADEClient", () => ({
    localOpenADEClient: {
        startTurn: mocks.startTurn,
    },
}))

function createManager() {
    const task = {
        id: "task-1",
        repoId: "repo-1",
        closed: false,
        events: [],
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
        expect(doCommand).toMatchObject({
            id: "do",
            label: "Queue Do",
            enabled: true,
        })
        expect(askCommand).toMatchObject({
            id: "ask",
            label: "Queue Ask",
            enabled: true,
        })

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
})
