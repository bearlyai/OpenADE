import { describe, expect, it, vi } from "vitest"
import { OPENADE_METHOD } from "../../../../openade-client/src"
import type { CodeStore } from "../store"
import { TaskManager } from "./TaskManager"

describe("TaskManager setTaskClosed", () => {
    it("routes close changes through the OpenADE runtime protocol", async () => {
        const store = {
            execution: {
                onAfterEvent: vi.fn(() => () => {}),
            },
            tasks: {
                getTask: vi.fn(() => null),
            },
            getCachedProductTask: vi.fn(() => null),
            hasProductTaskModelSource: vi.fn(() => false),
            findProductRepoIdForTask: vi.fn(() => "repo-1"),
            updateProductTaskMetadata: vi.fn(async () => undefined),
            refreshProductStateAfterTaskMutation: vi.fn(async () => undefined),
            shouldUseRuntimeProductAPI: vi.fn(() => false),
            usesCoreOwnedProductRuntime: vi.fn(() => false),
            shouldUseRuntimeProductTaskRoute: vi.fn(() => false),
            canUseProductMethod: vi.fn(() => true),
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
            usesCoreOwnedProductRuntime: vi.fn(() => false),
            shouldUseRuntimeProductTaskRoute: vi.fn(() => true),
            canUseProductMethod: vi.fn(() => true),
        } as unknown as CodeStore

        const manager = new TaskManager(store)

        await manager.setTaskClosed("task-1", true)

        expect(store.updateProductTaskMetadata).toHaveBeenCalledWith({ taskId: "task-1", closed: true })
        expect(store.refreshProductStateAfterTaskMutation).not.toHaveBeenCalled()
    })

    it("does not update task MCP selection when runtime MCP reads are denied", async () => {
        const store = {
            execution: {
                onAfterEvent: vi.fn(() => () => {}),
            },
            updateProductTaskMetadata: vi.fn(async () => undefined),
            refreshProductStateAfterTaskMutation: vi.fn(async () => undefined),
            shouldUseRuntimeProductAPI: vi.fn(() => true),
            usesCoreOwnedProductRuntime: vi.fn(() => false),
            shouldUseRuntimeProductTaskRoute: vi.fn(() => true),
            canUseProductMethod: vi.fn((method: string) => method !== OPENADE_METHOD.settingsMcpServersRead),
        } as unknown as CodeStore
        const manager = new TaskManager(store)

        manager.setEnabledMcpServerIds("task-1", ["mcp-stale"])

        await vi.waitFor(() => expect(store.canUseProductMethod).toHaveBeenCalledWith(OPENADE_METHOD.settingsMcpServersRead))
        expect(store.updateProductTaskMetadata).not.toHaveBeenCalled()
        expect(store.refreshProductStateAfterTaskMutation).not.toHaveBeenCalled()
    })

    it("warms Core-owned MCP selection capability before writing task metadata", async () => {
        const canUseProductMethodAfterConnect = vi.fn(async (method: string) => {
            return method === OPENADE_METHOD.taskMetadataUpdate || method === OPENADE_METHOD.settingsMcpServersRead
        })
        const store = {
            execution: {
                onAfterEvent: vi.fn(() => () => {}),
            },
            updateProductTaskMetadata: vi.fn(async () => undefined),
            refreshProductStateAfterTaskMutation: vi.fn(async () => undefined),
            shouldUseRuntimeProductAPI: vi.fn(() => false),
            usesCoreOwnedProductRuntime: vi.fn(() => true),
            shouldUseRuntimeProductTaskRoute: vi.fn(() => true),
            canUseProductMethod: vi.fn(() => false),
            canUseProductMethodAfterConnect,
        } as unknown as CodeStore
        const manager = new TaskManager(store)

        manager.setEnabledMcpServerIds("task-1", ["mcp-1"])

        await vi.waitFor(() =>
            expect(store.updateProductTaskMetadata).toHaveBeenCalledWith({
                taskId: "task-1",
                enabledMcpServerIds: ["mcp-1"],
            }),
        )
        expect(canUseProductMethodAfterConnect).toHaveBeenCalledWith(OPENADE_METHOD.taskMetadataUpdate)
        expect(canUseProductMethodAfterConnect).toHaveBeenCalledWith(OPENADE_METHOD.settingsMcpServersRead)
        expect(store.canUseProductMethod).not.toHaveBeenCalled()
        expect(store.refreshProductStateAfterTaskMutation).not.toHaveBeenCalled()
    })

    it("keeps runtime viewed persistence off the route-open path while patching local runtime state", async () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date("2026-06-10T12:00:00.000Z"))
        const store = {
            execution: {
                onAfterEvent: vi.fn(() => () => {}),
            },
            getCachedProductTask: vi.fn(() => ({ id: "task-1", repoId: "repo-1" })),
            hasProductTaskModelSource: vi.fn(() => true),
            findProductRepoIdForTask: vi.fn(() => "repo-1"),
            getTaskPreviewsForRepo: vi.fn(() => [
                {
                    id: "task-1",
                    slug: "task-1",
                    title: "Task",
                    createdAt: "2026-06-10T00:00:00.000Z",
                    lastEventAt: "2026-06-10T11:59:00.000Z",
                    lastViewedAt: "2026-06-10T11:50:00.000Z",
                },
            ]),
            patchRuntimeProductTaskMetadata: vi.fn(() => true),
            updateProductTaskMetadata: vi.fn(async () => undefined),
            refreshProductStateAfterTaskMutation: vi.fn(async () => undefined),
            shouldUseRuntimeProductAPI: vi.fn(() => true),
            usesCoreOwnedProductRuntime: vi.fn(() => false),
            shouldUseRuntimeProductTaskRoute: vi.fn(() => true),
            canUseProductMethod: vi.fn(() => true),
        } as unknown as CodeStore
        const manager = new TaskManager(store)

        try {
            await manager.markTaskViewed("task-1", { defer: true })

            expect(store.patchRuntimeProductTaskMetadata).toHaveBeenCalledWith({ taskId: "task-1", lastViewedAt: "2026-06-10T12:00:00.000Z" })
            expect(store.updateProductTaskMetadata).not.toHaveBeenCalled()

            await vi.advanceTimersByTimeAsync(30_000)
            expect(store.updateProductTaskMetadata).not.toHaveBeenCalled()

            await vi.advanceTimersByTimeAsync(270_000)
            expect(store.updateProductTaskMetadata).toHaveBeenCalledWith({ taskId: "task-1", lastViewedAt: "2026-06-10T12:00:00.000Z" })
            expect(store.refreshProductStateAfterTaskMutation).not.toHaveBeenCalled()
        } finally {
            manager.disposeDeferredViewedWrites()
            vi.useRealTimers()
        }
    })

    it("defers Core-owned viewed persistence before runtime projection is active", async () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date("2026-06-10T12:00:00.000Z"))
        let runtimeProductAPIAvailable = false
        const canUseProductMethodAfterConnect = vi.fn(async (method: string) => {
            if (method !== OPENADE_METHOD.taskMetadataUpdate) return false
            runtimeProductAPIAvailable = true
            return true
        })
        const store = {
            execution: {
                onAfterEvent: vi.fn(() => () => {}),
            },
            getCachedProductTask: vi.fn(() => ({ id: "task-1", repoId: "repo-1" })),
            hasProductTaskModelSource: vi.fn(() => true),
            findProductRepoIdForTask: vi.fn(() => "repo-1"),
            getTaskPreviewsForRepo: vi.fn(() => [
                {
                    id: "task-1",
                    slug: "task-1",
                    title: "Task",
                    createdAt: "2026-06-10T00:00:00.000Z",
                    lastEventAt: "2026-06-10T11:59:00.000Z",
                    lastViewedAt: "2026-06-10T11:50:00.000Z",
                },
            ]),
            patchRuntimeProductTaskMetadata: vi.fn(() => true),
            updateProductTaskMetadata: vi.fn(async () => undefined),
            refreshProductStateAfterTaskMutation: vi.fn(async () => undefined),
            shouldUseRuntimeProductAPI: vi.fn(() => runtimeProductAPIAvailable),
            usesCoreOwnedProductRuntime: vi.fn(() => true),
            shouldUseRuntimeProductTaskRoute: vi.fn(() => true),
            canUseProductMethod: vi.fn((method: string) => runtimeProductAPIAvailable && method === OPENADE_METHOD.taskMetadataUpdate),
            canUseProductMethodAfterConnect,
        } as unknown as CodeStore
        const manager = new TaskManager(store)

        try {
            await manager.markTaskViewed("task-1", { defer: true })

            expect(store.patchRuntimeProductTaskMetadata).toHaveBeenCalledWith({ taskId: "task-1", lastViewedAt: "2026-06-10T12:00:00.000Z" })
            expect(store.updateProductTaskMetadata).not.toHaveBeenCalled()

            await vi.advanceTimersByTimeAsync(30_000)
            expect(store.updateProductTaskMetadata).not.toHaveBeenCalled()

            await vi.advanceTimersByTimeAsync(270_000)
            expect(canUseProductMethodAfterConnect).toHaveBeenCalledWith(OPENADE_METHOD.taskMetadataUpdate)
            expect(store.updateProductTaskMetadata).toHaveBeenCalledWith({ taskId: "task-1", lastViewedAt: "2026-06-10T12:00:00.000Z" })
            expect(store.refreshProductStateAfterTaskMutation).not.toHaveBeenCalled()
        } finally {
            manager.disposeDeferredViewedWrites()
            vi.useRealTimers()
        }
    })

    it("defers route-owned viewed persistence before broad runtime projection is active", async () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date("2026-06-10T12:00:00.000Z"))
        const canUseProductMethodAfterConnect = vi.fn(async (method: string) => method === OPENADE_METHOD.taskMetadataUpdate)
        const store = {
            execution: {
                onAfterEvent: vi.fn(() => () => {}),
            },
            getCachedProductTask: vi.fn(() => ({ id: "task-1", repoId: "repo-1" })),
            hasProductTaskModelSource: vi.fn(() => true),
            findProductRepoIdForTask: vi.fn(() => "repo-1"),
            getTaskPreviewsForRepo: vi.fn(() => [
                {
                    id: "task-1",
                    slug: "task-1",
                    title: "Task",
                    createdAt: "2026-06-10T00:00:00.000Z",
                    lastEventAt: "2026-06-10T11:59:00.000Z",
                    lastViewedAt: "2026-06-10T11:50:00.000Z",
                },
            ]),
            patchRuntimeProductTaskMetadata: vi.fn(() => true),
            updateProductTaskMetadata: vi.fn(async () => undefined),
            refreshProductStateAfterTaskMutation: vi.fn(async () => undefined),
            shouldUseRuntimeProductAPI: vi.fn(() => false),
            usesCoreOwnedProductRuntime: vi.fn(() => false),
            shouldUseRuntimeProductTaskRoute: vi.fn(() => true),
            canUseProductMethod: vi.fn(() => false),
            canUseProductMethodAfterConnect,
        } as unknown as CodeStore
        const manager = new TaskManager(store)

        try {
            await manager.markTaskViewed("task-1", { defer: true })

            expect(store.canUseProductMethod).not.toHaveBeenCalled()
            expect(canUseProductMethodAfterConnect).not.toHaveBeenCalled()
            expect(store.patchRuntimeProductTaskMetadata).toHaveBeenCalledWith({ taskId: "task-1", lastViewedAt: "2026-06-10T12:00:00.000Z" })
            expect(store.updateProductTaskMetadata).not.toHaveBeenCalled()

            await vi.advanceTimersByTimeAsync(300_000)

            expect(canUseProductMethodAfterConnect).toHaveBeenCalledWith(OPENADE_METHOD.taskMetadataUpdate)
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
            getTaskPreviewsForRepo: vi.fn(() => [
                {
                    id: "task-1",
                    slug: "task-1",
                    title: "Task",
                    createdAt: "2026-06-10T00:00:00.000Z",
                    lastEventAt: "2026-06-10T11:59:00.000Z",
                    lastViewedAt: "2026-06-10T11:50:00.000Z",
                },
            ]),
            patchRuntimeProductTaskMetadata: vi.fn(() => true),
            updateProductTaskMetadata: vi.fn(async () => undefined),
            refreshProductStateAfterTaskMutation: vi.fn(async () => undefined),
            shouldUseRuntimeProductAPI: vi.fn(() => true),
            usesCoreOwnedProductRuntime: vi.fn(() => false),
            shouldUseRuntimeProductTaskRoute: vi.fn(() => true),
            canUseProductMethod: vi.fn(() => true),
        } as unknown as CodeStore
        const manager = new TaskManager(store)

        try {
            await manager.markTaskViewed("task-1", { defer: true })
            manager.disposeDeferredViewedWrites()
            await vi.advanceTimersByTimeAsync(300_000)

            expect(store.patchRuntimeProductTaskMetadata).toHaveBeenCalledOnce()
            expect(store.updateProductTaskMetadata).not.toHaveBeenCalled()
        } finally {
            manager.disposeDeferredViewedWrites()
            vi.useRealTimers()
        }
    })

    it("flushes deferred runtime viewed persistence before runtime store teardown", async () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date("2026-06-10T12:00:00.000Z"))
        const store = {
            execution: {
                onAfterEvent: vi.fn(() => () => {}),
            },
            getCachedProductTask: vi.fn(() => ({ id: "task-1", repoId: "repo-1" })),
            hasProductTaskModelSource: vi.fn(() => true),
            findProductRepoIdForTask: vi.fn(() => "repo-1"),
            getTaskPreviewsForRepo: vi.fn(() => [
                {
                    id: "task-1",
                    slug: "task-1",
                    title: "Task",
                    createdAt: "2026-06-10T00:00:00.000Z",
                    lastEventAt: "2026-06-10T11:59:00.000Z",
                    lastViewedAt: "2026-06-10T11:50:00.000Z",
                },
            ]),
            patchRuntimeProductTaskMetadata: vi.fn(() => true),
            updateProductTaskMetadata: vi.fn(async () => undefined),
            refreshProductStateAfterTaskMutation: vi.fn(async () => undefined),
            shouldUseRuntimeProductAPI: vi.fn(() => true),
            usesCoreOwnedProductRuntime: vi.fn(() => false),
            shouldUseRuntimeProductTaskRoute: vi.fn(() => true),
            canUseProductMethod: vi.fn(() => true),
        } as unknown as CodeStore
        const manager = new TaskManager(store)

        try {
            await manager.markTaskViewed("task-1", { defer: true })
            await manager.flushDeferredViewedWrites()

            expect(store.updateProductTaskMetadata).toHaveBeenCalledWith({ taskId: "task-1", lastViewedAt: "2026-06-10T12:00:00.000Z" })

            await vi.advanceTimersByTimeAsync(300_000)
            expect(store.updateProductTaskMetadata).toHaveBeenCalledTimes(1)
        } finally {
            manager.disposeDeferredViewedWrites()
            vi.useRealTimers()
        }
    })

    it("does not issue runtime metadata writes when task metadata update is unavailable", async () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date("2026-06-10T12:00:00.000Z"))
        const store = {
            execution: {
                onAfterEvent: vi.fn(() => () => {}),
            },
            getCachedProductTask: vi.fn(() => ({
                id: "task-1",
                repoId: "repo-1",
                description: "describe task",
            })),
            hasProductTaskModelSource: vi.fn(() => false),
            findProductRepoIdForTask: vi.fn(() => "repo-1"),
            getTaskPreviewsForRepo: vi.fn(() => [{ id: "task-1", slug: "task-1", title: "Task", createdAt: "2026-06-10T00:00:00.000Z" }]),
            patchRuntimeProductTaskMetadata: vi.fn(() => true),
            updateProductTaskMetadata: vi.fn(async () => undefined),
            refreshProductStateAfterTaskMutation: vi.fn(async () => undefined),
            generateProductTaskTitle: vi.fn(async () => ({ repoId: "repo-1", taskId: "task-1", title: "Generated" })),
            shouldUseRuntimeProductAPI: vi.fn(() => true),
            usesCoreOwnedProductRuntime: vi.fn(() => false),
            shouldUseRuntimeProductTaskRoute: vi.fn(() => true),
            canUseProductMethod: vi.fn((method: string) => method !== OPENADE_METHOD.taskMetadataUpdate && method !== OPENADE_METHOD.taskTitleGenerate),
        } as unknown as CodeStore
        const manager = new TaskManager(store)

        try {
            await manager.setTaskClosed("task-1", true)
            await manager.markTaskViewed("task-1", { defer: true })
            manager.setEnabledMcpServerIds("task-1", ["mcp-1"])
            manager.setTaskTitle("task-1", "New title")
            await manager.regenerateTitle("task-1")
            await vi.advanceTimersByTimeAsync(30_000)

            expect(store.updateProductTaskMetadata).not.toHaveBeenCalled()
            expect(store.patchRuntimeProductTaskMetadata).not.toHaveBeenCalled()
            expect(store.generateProductTaskTitle).not.toHaveBeenCalled()
        } finally {
            manager.disposeDeferredViewedWrites()
            vi.useRealTimers()
        }
    })

    it("does not mark a runtime task viewed when it has no event timestamp", async () => {
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
            usesCoreOwnedProductRuntime: vi.fn(() => false),
            shouldUseRuntimeProductTaskRoute: vi.fn(() => true),
            canUseProductMethod: vi.fn(() => true),
        } as unknown as CodeStore
        const manager = new TaskManager(store)

        try {
            await manager.markTaskViewed("task-1", { defer: true })
            await vi.advanceTimersByTimeAsync(30_000)

            expect(store.patchRuntimeProductTaskMetadata).not.toHaveBeenCalled()
            expect(store.updateProductTaskMetadata).not.toHaveBeenCalled()
        } finally {
            manager.disposeDeferredViewedWrites()
            vi.useRealTimers()
        }
    })

    it("does not mark an already-viewed runtime task viewed again on route open", async () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date("2026-06-10T12:00:00.000Z"))
        const store = {
            execution: {
                onAfterEvent: vi.fn(() => () => {}),
            },
            getCachedProductTask: vi.fn(() => ({ id: "task-1", repoId: "repo-1" })),
            hasProductTaskModelSource: vi.fn(() => true),
            findProductRepoIdForTask: vi.fn(() => "repo-1"),
            getTaskPreviewsForRepo: vi.fn(() => [
                {
                    id: "task-1",
                    slug: "task-1",
                    title: "Task",
                    createdAt: "2026-06-10T00:00:00.000Z",
                    lastEventAt: "2026-06-10T11:00:00.000Z",
                    lastViewedAt: "2026-06-10T11:05:00.000Z",
                },
            ]),
            patchRuntimeProductTaskMetadata: vi.fn(() => true),
            updateProductTaskMetadata: vi.fn(async () => undefined),
            refreshProductStateAfterTaskMutation: vi.fn(async () => undefined),
            shouldUseRuntimeProductAPI: vi.fn(() => true),
            usesCoreOwnedProductRuntime: vi.fn(() => false),
            shouldUseRuntimeProductTaskRoute: vi.fn(() => true),
            canUseProductMethod: vi.fn(() => true),
        } as unknown as CodeStore
        const manager = new TaskManager(store)

        try {
            await manager.markTaskViewed("task-1", { defer: true })
            await vi.advanceTimersByTimeAsync(30_000)

            expect(store.patchRuntimeProductTaskMetadata).not.toHaveBeenCalled()
            expect(store.updateProductTaskMetadata).not.toHaveBeenCalled()
        } finally {
            manager.disposeDeferredViewedWrites()
            vi.useRealTimers()
        }
    })

    it("uses cached runtime task-read preview for route-open viewed checks before repo previews", async () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date("2026-06-10T12:00:00.000Z"))
        const store = {
            execution: {
                onAfterEvent: vi.fn(() => () => {}),
            },
            getCachedProductTask: vi.fn(() => ({ id: "task-1", repoId: "repo-1" })),
            hasProductTaskModelSource: vi.fn(() => true),
            findProductRepoIdForTask: vi.fn(() => "repo-1"),
            getRuntimeProductTaskPreviewDto: vi.fn(() => ({
                id: "task-1",
                slug: "task-1",
                title: "Task",
                createdAt: "2026-06-10T00:00:00.000Z",
                lastEventAt: "2026-06-10T11:00:00.000Z",
                lastViewedAt: "2026-06-10T11:05:00.000Z",
            })),
            getTaskPreviewsForRepo: vi.fn(() => {
                throw new Error("repo previews should not be needed for direct task-route preview")
            }),
            patchRuntimeProductTaskMetadata: vi.fn(() => true),
            updateProductTaskMetadata: vi.fn(async () => undefined),
            refreshProductStateAfterTaskMutation: vi.fn(async () => undefined),
            shouldUseRuntimeProductAPI: vi.fn(() => true),
            usesCoreOwnedProductRuntime: vi.fn(() => false),
            shouldUseRuntimeProductTaskRoute: vi.fn(() => true),
            canUseProductMethod: vi.fn(() => true),
        } as unknown as CodeStore
        const manager = new TaskManager(store)

        try {
            await manager.markTaskViewed("task-1", { defer: true })

            expect(store.getRuntimeProductTaskPreviewDto).toHaveBeenCalledWith("repo-1", "task-1")
            expect(store.getTaskPreviewsForRepo).not.toHaveBeenCalled()
            expect(store.patchRuntimeProductTaskMetadata).not.toHaveBeenCalled()
            expect(store.updateProductTaskMetadata).not.toHaveBeenCalled()
        } finally {
            manager.disposeDeferredViewedWrites()
            vi.useRealTimers()
        }
    })

    it("creates a stable Core route model before task detail is cached", () => {
        const store = {
            execution: {
                onAfterEvent: vi.fn(() => () => {}),
            },
            tasks: {
                getTask: vi.fn(() => null),
            },
            getCachedProductTask: vi.fn(() => null),
            hasProductTaskModelSource: vi.fn(() => false),
            findProductRepoIdForTask: vi.fn(() => null),
            getRuntimeProductTaskPreviewDto: vi.fn(() => null),
            shouldUseRuntimeProductAPI: vi.fn(() => false),
            usesCoreOwnedProductRuntime: vi.fn(() => true),
            shouldUseRuntimeProductTaskRoute: vi.fn(() => true),
            canUseProductMethod: vi.fn((method: string) => method === OPENADE_METHOD.taskRead),
            canUseRuntimeProductTaskRouteModelSource: vi.fn(() => true),
        } as unknown as CodeStore
        const manager = new TaskManager(store)

        expect(manager.getTaskModel("task-1")).toBeNull()

        const model = manager.getTaskModelForRoute("repo-1", "task-1")

        expect(model?.exists).toBe(true)
        expect(model?.repoId).toBe("repo-1")
        expect(model?.workspaceId).toBe("repo-1")
        expect(model?.needsEnvironmentSetup).toBe(false)
        expect(manager.getTaskModelForRoute("repo-1", "task-1")).toBe(model)
        expect(manager.getTaskModel("task-1")).toBe(model)
    })
})

describe("TaskManager addDeviceEnvironment", () => {
    it("does not issue runtime environment setup when the capability is unavailable", async () => {
        const store = {
            getCachedProductTask: vi.fn(() => null),
            getTaskPreviewsForRepo: vi.fn(() => []),
            setupProductTaskEnvironment: vi.fn(async () => undefined),
            refreshProductStateAfterTaskMutation: vi.fn(async () => undefined),
            shouldUseRuntimeProductAPI: vi.fn(() => true),
            usesCoreOwnedProductRuntime: vi.fn(() => false),
            shouldUseRuntimeProductTaskRoute: vi.fn(() => true),
            canUseProductMethod: vi.fn((method: string) => method !== OPENADE_METHOD.taskEnvironmentSetup),
        } as unknown as CodeStore
        const manager = new TaskManager(store)

        await manager.addDeviceEnvironment("task-1", {
            id: "device-1",
            deviceId: "device-1",
            setupComplete: true,
            createdAt: "2026-06-12T00:00:00.000Z",
            lastUsedAt: "2026-06-12T00:00:00.000Z",
        })

        expect(store.setupProductTaskEnvironment).not.toHaveBeenCalled()
        expect(store.refreshProductStateAfterTaskMutation).not.toHaveBeenCalled()
    })

    it("attaches Core-owned task delete capability before deleting a task", async () => {
        let runtimeProductAPIAvailable = false
        const canUseProductMethodAfterConnect = vi.fn(async (method: string) => {
            if (method !== OPENADE_METHOD.taskDelete) return false
            runtimeProductAPIAvailable = true
            return true
        })
        const store = {
            execution: {
                onAfterEvent: vi.fn(() => () => {}),
            },
            queries: {
                abortTask: vi.fn(async () => undefined),
            },
            runtimes: {
                removeTask: vi.fn(),
            },
            getCachedProductTask: vi.fn(() => null),
            hasProductTaskModelSource: vi.fn(() => false),
            findProductRepoIdForTask: vi.fn(() => "repo-1"),
            deleteProductTask: vi.fn(async () => ({ deleted: true })),
            refreshProductStateAfterTaskDeletion: vi.fn(async () => undefined),
            shouldUseRuntimeProductAPI: vi.fn(() => runtimeProductAPIAvailable),
            usesCoreOwnedProductRuntime: vi.fn(() => true),
            shouldUseRuntimeProductTaskRoute: vi.fn(() => true),
            canUseProductMethod: vi.fn((method: string) => runtimeProductAPIAvailable && method === OPENADE_METHOD.taskDelete),
            canUseProductMethodAfterConnect,
        } as unknown as CodeStore
        const manager = new TaskManager(store)

        await manager.deepRemoveTask("task-1", {
            deleteSnapshots: true,
            deleteImages: true,
            deleteSessions: true,
            deleteWorktrees: true,
        })

        expect(canUseProductMethodAfterConnect).toHaveBeenCalledWith(OPENADE_METHOD.taskDelete)
        expect(store.queries.abortTask).toHaveBeenCalledWith("task-1")
        expect(store.deleteProductTask).toHaveBeenCalledWith({
            repoId: "repo-1",
            taskId: "task-1",
            options: {
                deleteSnapshots: true,
                deleteImages: true,
                deleteSessions: true,
                deleteWorktrees: true,
            },
        })
        expect(store.refreshProductStateAfterTaskDeletion).toHaveBeenCalledWith("task-1")
        expect(store.runtimes.removeTask).toHaveBeenCalledWith("task-1")
    })

    it("does not refresh legacy task storage after metadata writes while Core owns product state", async () => {
        let runtimeProductAPIAvailable = false
        const canUseProductMethodAfterConnect = vi.fn(async (method: string) => {
            if (method !== OPENADE_METHOD.taskMetadataUpdate) return false
            runtimeProductAPIAvailable = true
            return true
        })
        const store = {
            execution: {
                onAfterEvent: vi.fn(() => () => {}),
            },
            getCachedProductTask: vi.fn(() => null),
            hasProductTaskModelSource: vi.fn(() => false),
            findProductRepoIdForTask: vi.fn(() => "repo-1"),
            updateProductTaskMetadata: vi.fn(async () => undefined),
            refreshProductStateAfterTaskMutation: vi.fn(async () => undefined),
            shouldUseRuntimeProductAPI: vi.fn(() => runtimeProductAPIAvailable),
            usesCoreOwnedProductRuntime: vi.fn(() => true),
            shouldUseRuntimeProductTaskRoute: vi.fn(() => true),
            canUseProductMethod: vi.fn((method: string) => runtimeProductAPIAvailable && method === OPENADE_METHOD.taskMetadataUpdate),
            canUseProductMethodAfterConnect,
        } as unknown as CodeStore
        const manager = new TaskManager(store)

        await manager.setTaskClosed("task-1", true)

        expect(canUseProductMethodAfterConnect).toHaveBeenCalledWith(OPENADE_METHOD.taskMetadataUpdate)
        expect(store.updateProductTaskMetadata).toHaveBeenCalledWith({ taskId: "task-1", closed: true })
        expect(store.refreshProductStateAfterTaskMutation).not.toHaveBeenCalled()
    })

    it("attaches Core-owned title generation instead of falling back to local title generation", async () => {
        let runtimeProductAPIAvailable = false
        const canUseProductMethodAfterConnect = vi.fn(async (method: string) => {
            if (method !== OPENADE_METHOD.taskTitleGenerate) return false
            runtimeProductAPIAvailable = true
            return true
        })
        const store = {
            execution: {
                onAfterEvent: vi.fn(() => () => {}),
            },
            getCachedProductTask: vi.fn(() => ({
                id: "task-1",
                repoId: "repo-1",
                description: "describe task",
                events: [],
            })),
            hasProductTaskModelSource: vi.fn(() => false),
            findProductRepoIdForTask: vi.fn(() => "repo-1"),
            generateProductTaskTitle: vi.fn(async () => ({ repoId: "repo-1", taskId: "task-1", title: "Generated" })),
            setTaskTitle: vi.fn(async () => undefined),
            shouldUseRuntimeProductAPI: vi.fn(() => runtimeProductAPIAvailable),
            usesCoreOwnedProductRuntime: vi.fn(() => true),
            shouldUseRuntimeProductTaskRoute: vi.fn(() => true),
            canUseProductMethod: vi.fn((method: string) => runtimeProductAPIAvailable && method === OPENADE_METHOD.taskTitleGenerate),
            canUseProductMethodAfterConnect,
            repos: {
                getRepo: vi.fn(() => {
                    throw new Error("legacy title generation should not resolve a local repo cwd")
                }),
            },
        } as unknown as CodeStore
        const manager = new TaskManager(store)

        await manager.regenerateTitle("task-1")

        expect(canUseProductMethodAfterConnect).toHaveBeenCalledWith(OPENADE_METHOD.taskTitleGenerate)
        expect(store.generateProductTaskTitle).toHaveBeenCalledWith({ repoId: "repo-1", taskId: "task-1", harnessId: undefined })
        expect(store.repos.getRepo).not.toHaveBeenCalled()
    })

    it("does not load task detail before checking denied runtime title generation capability", async () => {
        const store = {
            execution: {
                onAfterEvent: vi.fn(() => () => {}),
            },
            getCachedProductTask: vi.fn(() => null),
            hasProductTaskModelSource: vi.fn(() => false),
            findProductRepoIdForTask: vi.fn(() => "repo-1"),
            loadProductTaskForRead: vi.fn(async () => {
                throw new Error("denied title generation should not read task detail")
            }),
            generateProductTaskTitle: vi.fn(async () => ({ repoId: "repo-1", taskId: "task-1", title: "Generated" })),
            updateProductTaskMetadata: vi.fn(async () => undefined),
            refreshProductStateAfterTaskMutation: vi.fn(async () => undefined),
            shouldUseRuntimeProductAPI: vi.fn(() => true),
            usesCoreOwnedProductRuntime: vi.fn(() => false),
            shouldUseRuntimeProductTaskRoute: vi.fn(() => true),
            canUseProductMethod: vi.fn((method: string) => method !== OPENADE_METHOD.taskTitleGenerate),
        } as unknown as CodeStore
        const manager = new TaskManager(store)

        await manager.regenerateTitle("task-1")

        expect(store.findProductRepoIdForTask).not.toHaveBeenCalled()
        expect(store.loadProductTaskForRead).not.toHaveBeenCalled()
        expect(store.generateProductTaskTitle).not.toHaveBeenCalled()
        expect(store.updateProductTaskMetadata).not.toHaveBeenCalled()
    })

    it("does not write fallback titles when runtime title generation fails", async () => {
        const store = {
            execution: {
                onAfterEvent: vi.fn(() => () => {}),
            },
            getCachedProductTask: vi.fn(() => ({
                id: "task-1",
                repoId: "repo-1",
                description: "describe task",
                events: [],
            })),
            hasProductTaskModelSource: vi.fn(() => false),
            findProductRepoIdForTask: vi.fn(() => "repo-1"),
            generateProductTaskTitle: vi.fn(async () => {
                throw new Error("runtime title generator failed")
            }),
            updateProductTaskMetadata: vi.fn(async () => undefined),
            refreshProductStateAfterTaskMutation: vi.fn(async () => undefined),
            shouldUseRuntimeProductAPI: vi.fn(() => true),
            usesCoreOwnedProductRuntime: vi.fn(() => true),
            shouldUseRuntimeProductTaskRoute: vi.fn(() => true),
            canUseProductMethod: vi.fn(() => true),
            canUseProductMethodAfterConnect: vi.fn(async () => true),
        } as unknown as CodeStore
        const manager = new TaskManager(store)

        await manager.regenerateTitle("task-1")

        expect(store.generateProductTaskTitle).toHaveBeenCalledWith({ repoId: "repo-1", taskId: "task-1", harnessId: undefined })
        expect(store.updateProductTaskMetadata).not.toHaveBeenCalled()
        expect(store.refreshProductStateAfterTaskMutation).not.toHaveBeenCalled()
    })
})

describe("TaskManager resource inventory", () => {
    it("attaches Core inventory reads without loading legacy task history or git inventory", async () => {
        let runtimeProductAPIAvailable = false
        const inventory = {
            repoId: "repo-1",
            taskId: "task-1",
            taskTitle: "Task",
            isRunning: false,
            snapshotIds: [],
            images: [],
            sessions: [],
            worktree: null,
        }
        const store = {
            findProductRepoIdForTask: vi.fn(() => "repo-1"),
            shouldUseRuntimeProductAPI: vi.fn(() => runtimeProductAPIAvailable),
            usesCoreOwnedProductRuntime: vi.fn(() => true),
            shouldUseRuntimeProductTaskRoute: vi.fn(() => true),
            canUseProductMethod: vi.fn((method: string) => runtimeProductAPIAvailable && method === OPENADE_METHOD.taskResourceInventoryRead),
            canUseProductMethodAfterConnect: vi.fn(async (method: string) => {
                runtimeProductAPIAvailable = method === OPENADE_METHOD.taskResourceInventoryRead
                return runtimeProductAPIAvailable
            }),
            readProductTaskResourceInventory: vi.fn(async () => inventory),
            loadProductTaskForRead: vi.fn(async () => {
                throw new Error("legacy task history should not be read while Core owns product state")
            }),
            repos: {
                getGitInfo: vi.fn(async () => {
                    throw new Error("legacy git inventory should not run while Core owns product state")
                }),
            },
        } as unknown as CodeStore
        const manager = new TaskManager(store)

        await expect(manager.getResourceInventory(["task-1"])).resolves.toEqual([inventory])

        expect(store.canUseProductMethodAfterConnect).toHaveBeenCalledWith(OPENADE_METHOD.taskResourceInventoryRead)
        expect(store.readProductTaskResourceInventory).toHaveBeenCalledWith({ repoId: "repo-1", taskId: "task-1" })
        expect(store.loadProductTaskForRead).not.toHaveBeenCalled()
        expect(store.repos.getGitInfo).not.toHaveBeenCalled()
    })
})
