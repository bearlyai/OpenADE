import { describe, expect, it, vi } from "vitest"
import { ptyApi } from "../../electronAPI/pty"
import { syncTaskPreviewFromStore } from "../../persistence"
import type { TaskStore } from "../../persistence/taskStore"
import type { CodeStore } from "../store"
import { TaskManager } from "./TaskManager"

vi.mock("../../electronAPI/pty", () => ({
    PtyHandle: {
        spawn: vi.fn(async () => null),
        reconnect: vi.fn(async () => ({ handle: null, found: false })),
    },
    getTaskPtyId: (taskId: string) => taskId,
    ptyApi: {
        kill: vi.fn(async () => undefined),
    },
}))

vi.mock("../../persistence", () => ({
    deleteTaskPreview: vi.fn(),
    syncTaskPreviewFromStore: vi.fn(),
    taskFromStore: vi.fn(),
    updateTaskPreview: vi.fn(),
}))

function createTaskStoreStub() {
    const meta = {
        id: "task-1",
        repoId: "repo-1",
        slug: "task-1",
        title: "Task",
        description: "Task",
        isolationStrategy: { type: "head" },
        sessionIds: {},
        createdBy: { id: "user-1", email: "test@example.com" },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        closed: false,
    }

    const taskStore = {
        meta: {
            get current() {
                return meta
            },
            update: vi.fn((updater: (draft: typeof meta) => void) => updater(meta)),
        },
    } as unknown as TaskStore

    return { taskStore, meta }
}

describe("TaskManager setTaskClosed", () => {
    it("loads an uncached task from its repo preview before closing it", async () => {
        const { taskStore, meta } = createTaskStoreStub()
        const getTaskStore = vi.fn(async () => taskStore)
        const repoStore = {
            repos: {
                all: vi.fn(() => [
                    {
                        id: "repo-1",
                        tasks: [{ id: "task-1" }],
                    },
                ]),
            },
        }
        const store = {
            execution: {
                onAfterEvent: vi.fn(() => () => {}),
            },
            getCachedTaskStore: vi.fn(() => null),
            getTaskStore,
            repoStore,
        } as unknown as CodeStore

        const manager = new TaskManager(store)

        await manager.setTaskClosed("task-1", true)

        expect(getTaskStore).toHaveBeenCalledWith("repo-1", "task-1")
        expect(ptyApi.kill).toHaveBeenCalledWith("task-1")
        expect(meta.closed).toBe(true)
        expect(syncTaskPreviewFromStore).toHaveBeenCalledTimes(1)
        expect(vi.mocked(syncTaskPreviewFromStore).mock.calls[0]?.[1]).toBe("repo-1")
        expect(vi.mocked(syncTaskPreviewFromStore).mock.calls[0]?.[2]).toBe(taskStore)
    })
})
