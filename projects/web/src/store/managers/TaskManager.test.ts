import { describe, expect, it, vi } from "vitest"
import type { CodeStore } from "../store"
import { TaskManager } from "./TaskManager"

describe("TaskManager setTaskClosed", () => {
    it("routes close changes through the OpenADE runtime protocol", async () => {
        const store = {
            execution: {
                onAfterEvent: vi.fn(() => () => {}),
            },
            getCachedProductTask: vi.fn(() => null),
            hasProductTaskModelSource: vi.fn(() => false),
            findProductRepoIdForTask: vi.fn(() => "repo-1"),
            updateProductTaskMetadata: vi.fn(async () => undefined),
            refreshProductStateAfterTaskMutation: vi.fn(async () => undefined),
            shouldUseRuntimeProductAPI: vi.fn(() => false),
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
            getCachedProductTask: vi.fn(() => ({ id: "task-1", repoId: "repo-1" })),
            hasProductTaskModelSource: vi.fn(() => true),
            findProductRepoIdForTask: vi.fn(() => "repo-1"),
            updateProductTaskMetadata: vi.fn(async () => undefined),
            refreshProductStateAfterTaskMutation: vi.fn(async () => undefined),
            shouldUseRuntimeProductAPI: vi.fn(() => true),
        } as unknown as CodeStore

        const manager = new TaskManager(store)

        await manager.setTaskClosed("task-1", true)

        expect(store.updateProductTaskMetadata).toHaveBeenCalledWith({ taskId: "task-1", closed: true })
        expect(store.refreshProductStateAfterTaskMutation).not.toHaveBeenCalled()
    })

    it("defers runtime viewed persistence while patching local runtime state", async () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date("2026-06-10T12:00:00.000Z"))
        const store = {
            execution: {
                onAfterEvent: vi.fn(() => () => {}),
            },
            getCachedProductTask: vi.fn(() => ({ id: "task-1", repoId: "repo-1" })),
            hasProductTaskModelSource: vi.fn(() => true),
            findProductRepoIdForTask: vi.fn(() => "repo-1"),
            getTaskPreviewsForRepo: vi.fn(() => [{ id: "task-1", slug: "task-1", title: "Task", createdAt: "2026-06-10T00:00:00.000Z" }]),
            patchRuntimeProductTaskMetadata: vi.fn(() => true),
            updateProductTaskMetadata: vi.fn(async () => undefined),
            refreshProductStateAfterTaskMutation: vi.fn(async () => undefined),
            shouldUseRuntimeProductAPI: vi.fn(() => true),
        } as unknown as CodeStore
        const manager = new TaskManager(store)

        try {
            await manager.markTaskViewed("task-1", { defer: true })

            expect(store.patchRuntimeProductTaskMetadata).toHaveBeenCalledWith({ taskId: "task-1", lastViewedAt: "2026-06-10T12:00:00.000Z" })
            expect(store.updateProductTaskMetadata).not.toHaveBeenCalled()

            await vi.advanceTimersByTimeAsync(4_999)
            expect(store.updateProductTaskMetadata).not.toHaveBeenCalled()

            await vi.advanceTimersByTimeAsync(1)
            expect(store.updateProductTaskMetadata).toHaveBeenCalledWith({ taskId: "task-1", lastViewedAt: "2026-06-10T12:00:00.000Z" })
            expect(store.refreshProductStateAfterTaskMutation).not.toHaveBeenCalled()
        } finally {
            manager.disposeDeferredViewedWrites()
            vi.useRealTimers()
        }
    })

    it("cancels deferred runtime viewed persistence on dispose", async () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date("2026-06-10T12:00:00.000Z"))
        const store = {
            execution: {
                onAfterEvent: vi.fn(() => () => {}),
            },
            getCachedProductTask: vi.fn(() => ({ id: "task-1", repoId: "repo-1" })),
            hasProductTaskModelSource: vi.fn(() => true),
            findProductRepoIdForTask: vi.fn(() => "repo-1"),
            getTaskPreviewsForRepo: vi.fn(() => [{ id: "task-1", slug: "task-1", title: "Task", createdAt: "2026-06-10T00:00:00.000Z" }]),
            patchRuntimeProductTaskMetadata: vi.fn(() => true),
            updateProductTaskMetadata: vi.fn(async () => undefined),
            refreshProductStateAfterTaskMutation: vi.fn(async () => undefined),
            shouldUseRuntimeProductAPI: vi.fn(() => true),
        } as unknown as CodeStore
        const manager = new TaskManager(store)

        try {
            await manager.markTaskViewed("task-1", { defer: true })
            manager.disposeDeferredViewedWrites()
            await vi.advanceTimersByTimeAsync(5_000)

            expect(store.patchRuntimeProductTaskMetadata).toHaveBeenCalledOnce()
            expect(store.updateProductTaskMetadata).not.toHaveBeenCalled()
        } finally {
            manager.disposeDeferredViewedWrites()
            vi.useRealTimers()
        }
    })
})
