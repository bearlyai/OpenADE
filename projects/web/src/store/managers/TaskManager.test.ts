import { describe, expect, it, vi } from "vitest"
import type { CodeStore } from "../store"
import { TaskManager } from "./TaskManager"

vi.mock("../../persistence", () => ({
    syncTaskPreviewFromStore: vi.fn(),
    taskFromStore: vi.fn(),
}))

describe("TaskManager setTaskClosed", () => {
    it("routes close changes through the OpenADE runtime protocol", async () => {
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
            getCachedRuntimeProductTask: vi.fn(() => null),
            getCachedTaskStore: vi.fn(() => null),
            findRuntimeProductRepoIdForTask: vi.fn(() => null),
            repoStore,
            updateProductTaskMetadata: vi.fn(async () => undefined),
            refreshProductStateAfterTaskMutation: vi.fn(async () => undefined),
            shouldUseRuntimeProductReads: vi.fn(() => false),
        } as unknown as CodeStore

        const manager = new TaskManager(store)

        await manager.setTaskClosed("task-1", true)

        expect(store.updateProductTaskMetadata).toHaveBeenCalledWith({ taskId: "task-1", closed: true })
        expect(store.refreshProductStateAfterTaskMutation).toHaveBeenCalledWith("task-1")
    })

    it("does not double-refresh runtime-backed close changes after the product store mutation updates cache", async () => {
        const store = {
            execution: {
                onAfterEvent: vi.fn(() => () => {}),
            },
            getCachedRuntimeProductTask: vi.fn(() => ({ id: "task-1", repoId: "repo-1" })),
            getCachedTaskStore: vi.fn(() => null),
            findRuntimeProductRepoIdForTask: vi.fn(() => "repo-1"),
            updateProductTaskMetadata: vi.fn(async () => undefined),
            refreshProductStateAfterTaskMutation: vi.fn(async () => undefined),
            shouldUseRuntimeProductReads: vi.fn(() => true),
        } as unknown as CodeStore

        const manager = new TaskManager(store)

        await manager.setTaskClosed("task-1", true)

        expect(store.updateProductTaskMetadata).toHaveBeenCalledWith({ taskId: "task-1", closed: true })
        expect(store.refreshProductStateAfterTaskMutation).not.toHaveBeenCalled()
    })
})
