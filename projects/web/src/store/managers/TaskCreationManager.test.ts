import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { OPENADE_METHOD } from "../../../../openade-client/src"
import type { ImageAttachment } from "../../types"
import type { CodeStore } from "../store"
import { TaskCreationManager, buildTaskCreationInput } from "./TaskCreationManager"

vi.mock("../../persistence", () => ({
    addTaskPreview: vi.fn(),
    syncTaskPreviewFromStore: vi.fn(),
    taskFromStore: vi.fn(() => ({
        id: "task-1",
        repoId: "repo-1",
        slug: "task-slug",
        title: "New task",
        description: "describe task",
        isolationStrategy: { type: "head" },
        sessionIds: {},
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        createdBy: { id: "user-1", email: "test@example.com" },
        events: [],
    })),
    updateTaskPreview: vi.fn(),
}))

const TEST_IMAGE: ImageAttachment = {
    id: "img-1",
    mediaType: "image/png",
    ext: "png",
    originalWidth: 100,
    originalHeight: 100,
    resizedWidth: 100,
    resizedHeight: 100,
}

describe("TaskCreationManager creation plumbing", () => {
    beforeEach(() => {
        vi.useRealTimers()
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it("buildTaskCreationInput preserves images and clones the array", () => {
        const images = [TEST_IMAGE]
        const input = buildTaskCreationInput("describe task", images)

        expect(input.userInput).toBe("describe task")
        expect(input.images).toEqual(images)
        expect(input.images).not.toBe(images)
    })

    it("newTask stores provided images on the creation record", () => {
        const runCreationSpy = vi
            .spyOn(TaskCreationManager.prototype as unknown as { runCreation: (id: string) => Promise<void> }, "runCreation")
            .mockResolvedValue(undefined)

        const manager = new TaskCreationManager({} as CodeStore)
        const images = [TEST_IMAGE]

        const creationId = manager.newTask({
            repoId: "repo-1",
            description: "describe task",
            mode: "do",
            isolationStrategy: { type: "head" },
            images,
        })

        expect(runCreationSpy).toHaveBeenCalledWith(creationId)

        const creation = manager.getCreation(creationId)
        expect(creation).toBeTruthy()
        expect(creation?.images).toEqual(images)
        expect(creation?.images).not.toBe(images)
    })

    it("newTask stores the selected model on the creation record", () => {
        const runCreationSpy = vi
            .spyOn(TaskCreationManager.prototype as unknown as { runCreation: (id: string) => Promise<void> }, "runCreation")
            .mockResolvedValue(undefined)

        const manager = new TaskCreationManager({} as CodeStore)

        const creationId = manager.newTask({
            repoId: "repo-1",
            description: "describe task",
            mode: "do",
            isolationStrategy: { type: "head" },
            harnessId: "codex",
            modelId: "gpt-5.5",
        })

        expect(runCreationSpy).toHaveBeenCalledWith(creationId)
        expect(manager.getCreation(creationId)?.modelId).toBe("gpt-5.5")
    })

    it("passes the selected model to server-owned turn start", async () => {
        const startProductTurn = vi.fn(async (args) => {
            expect(JSON.parse(JSON.stringify(args))).toEqual(args)
            return { taskId: "task-1" }
        })
        const generateTitleSpy = vi
            .spyOn(TaskCreationManager.prototype as unknown as { generateTitleAsync: (...args: unknown[]) => Promise<void> }, "generateTitleAsync")
            .mockResolvedValue(undefined)

        const store = {
            repos: {
                getRepo: vi.fn(() => ({ id: "repo-1", path: "/tmp/repo" })),
            },
            startProductTurn,
            refreshProductStateAfterTaskCreation: vi.fn(async () => undefined),
            shouldUseRuntimeProductAPI: vi.fn(() => false),
            usesCoreOwnedProductRuntime: vi.fn(() => false),
            canUseProductMethod: vi.fn(() => true),
            getActiveHyperPlanStrategy: vi.fn(),
        } as unknown as CodeStore

        const manager = new TaskCreationManager(store)
        manager.creationsById.set("creation-1", {
            id: "creation-1",
            repoId: "repo-1",
            description: "describe task",
            mode: "do",
            isolationStrategy: { type: "worktree", sourceBranch: "main" },
            images: [TEST_IMAGE],
            enabledMcpServerIds: ["mcp-1"],
            harnessId: "codex",
            modelId: "gpt-5.5",
            thinking: "max",
            fastMode: true,
            phase: "pending",
            error: null,
            abortController: new AbortController(),
            createdAt: "2026-01-01T00:00:00.000Z",
            completedTaskId: null,
        })

        await (manager as unknown as { runCreation: (id: string) => Promise<void> }).runCreation("creation-1")

        expect(generateTitleSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                repoId: "repo-1",
                taskId: "task-1",
                description: "describe task",
                harnessId: "codex",
                cwd: "/tmp/repo",
            })
        )
        expect(startProductTurn).toHaveBeenCalledWith(
            expect.objectContaining({
                repoId: "repo-1",
                type: "do",
                input: "describe task",
                isolationStrategy: { type: "worktree", sourceBranch: "main" },
                enabledMcpServerIds: ["mcp-1"],
                images: [TEST_IMAGE],
                harnessId: "codex",
                modelId: "gpt-5.5",
                thinking: "max",
                fastMode: true,
            })
        )
        expect(store.refreshProductStateAfterTaskCreation).toHaveBeenCalledWith("repo-1", "task-1")
        expect(manager.getCreation("creation-1")?.completedTaskId).toBe("task-1")
    })

    it("starts a runtime task without requiring a projected repo path", async () => {
        const createProductTask = vi.fn(async (args) => {
            expect(JSON.parse(JSON.stringify(args))).toEqual(args)
            return {
                taskId: "task-1",
                slug: "task-1",
                title: "Runtime task",
                createdAt: "2026-01-01T00:00:00.000Z",
            }
        })
        const startProductTurn = vi.fn(async (args) => {
            expect(JSON.parse(JSON.stringify(args))).toEqual(args)
            return { taskId: "task-1" }
        })
        const generateProductTaskTitle = vi.fn(async () => undefined)

        const store = {
            repos: {
                getRepo: vi.fn(() => undefined),
            },
            currentUser: { id: "user-1", email: "user@example.com" },
            createProductTask,
            startProductTurn,
            refreshProductStateAfterTaskCreation: vi.fn(async () => undefined),
            shouldUseRuntimeProductAPI: vi.fn(() => true),
            usesCoreOwnedProductRuntime: vi.fn(() => false),
            canUseProductMethod: vi.fn(() => true),
            generateProductTaskTitle,
            tasks: {
                setTaskTitle: vi.fn(),
            },
            getActiveHyperPlanStrategy: vi.fn(),
        } as unknown as CodeStore

        const manager = new TaskCreationManager(store)
        manager.creationsById.set("creation-1", {
            id: "creation-1",
            repoId: "repo-1",
            description: "describe runtime task",
            mode: "do",
            isolationStrategy: { type: "head" },
            images: [],
            harnessId: "codex",
            phase: "pending",
            error: null,
            abortController: new AbortController(),
            createdAt: "2026-01-01T00:00:00.000Z",
            completedTaskId: null,
        })

        await (manager as unknown as { runCreation: (id: string) => Promise<void> }).runCreation("creation-1")

        expect(createProductTask).toHaveBeenCalledWith(
            expect.objectContaining({
                repoId: "repo-1",
                input: "describe runtime task",
                createdBy: { id: "user-1", email: "user@example.com" },
                deviceId: expect.any(String),
                isolationStrategy: { type: "head" },
            })
        )
        expect(startProductTurn).toHaveBeenCalledWith(
            expect.objectContaining({
                repoId: "repo-1",
                inTaskId: "task-1",
                type: "do",
                input: "describe runtime task",
                harnessId: "codex",
            })
        )
        expect(startProductTurn.mock.calls[0][0]).not.toHaveProperty("isolationStrategy")
        expect(store.refreshProductStateAfterTaskCreation).not.toHaveBeenCalled()
        expect(manager.getCreation("creation-1")).toEqual(expect.objectContaining({ completedTaskId: "task-1", error: null }))
        await vi.waitFor(() => {
            expect(generateProductTaskTitle).toHaveBeenCalledWith({ repoId: "repo-1", taskId: "task-1", harnessId: "codex" })
        })
    })

    it("attaches Core-owned title generation after creating a task before projection is active", async () => {
        let runtimeProductAPIAvailable = false
        const canUseProductMethodAfterConnect = vi.fn(async (method: string) => {
            if (
                method !== OPENADE_METHOD.taskCreate &&
                method !== OPENADE_METHOD.turnStart &&
                method !== OPENADE_METHOD.taskTitleGenerate
            ) {
                return false
            }
            runtimeProductAPIAvailable = true
            return true
        })
        const createProductTask = vi.fn(async () => ({
            taskId: "task-1",
            slug: "task-1",
            title: "Runtime task",
            createdAt: "2026-01-01T00:00:00.000Z",
        }))
        const startProductTurn = vi.fn(async () => ({ taskId: "task-1" }))
        const generateProductTaskTitle = vi.fn(async () => undefined)

        const store = {
            repos: {
                getRepo: vi.fn(() => undefined),
            },
            currentUser: { id: "user-1", email: "user@example.com" },
            createProductTask,
            startProductTurn,
            refreshProductStateAfterTaskCreation: vi.fn(async () => undefined),
            shouldUseRuntimeProductAPI: vi.fn(() => runtimeProductAPIAvailable),
            usesCoreOwnedProductRuntime: vi.fn(() => true),
            canUseProductMethod: vi.fn((method: string) => runtimeProductAPIAvailable && method !== OPENADE_METHOD.settingsMcpServersRead),
            canUseProductMethodAfterConnect,
            generateProductTaskTitle,
            tasks: {
                setTaskTitle: vi.fn(),
            },
            getActiveHyperPlanStrategy: vi.fn(),
        } as unknown as CodeStore

        const manager = new TaskCreationManager(store)
        manager.creationsById.set("creation-1", {
            id: "creation-1",
            repoId: "repo-1",
            description: "describe runtime task",
            mode: "do",
            isolationStrategy: { type: "head" },
            images: [],
            harnessId: "codex",
            phase: "pending",
            error: null,
            abortController: new AbortController(),
            createdAt: "2026-01-01T00:00:00.000Z",
            completedTaskId: null,
        })

        await (manager as unknown as { runCreation: (id: string) => Promise<void> }).runCreation("creation-1")

        expect(createProductTask).toHaveBeenCalledTimes(1)
        expect(startProductTurn).toHaveBeenCalledWith(expect.objectContaining({ inTaskId: "task-1" }))
        await vi.waitFor(() => {
            expect(generateProductTaskTitle).toHaveBeenCalledWith({ repoId: "repo-1", taskId: "task-1", harnessId: "codex" })
        })
        expect(canUseProductMethodAfterConnect).toHaveBeenCalledWith(OPENADE_METHOD.taskCreate)
        expect(canUseProductMethodAfterConnect).toHaveBeenCalledWith(OPENADE_METHOD.turnStart)
        expect(canUseProductMethodAfterConnect).toHaveBeenCalledWith(OPENADE_METHOD.taskTitleGenerate)
        expect(store.refreshProductStateAfterTaskCreation).not.toHaveBeenCalled()
        expect(store.tasks.setTaskTitle).not.toHaveBeenCalled()
    })

    it("preserves Core-owned task creation payload fields after capabilities attach", async () => {
        let runtimeProductAPIAvailable = false
        const canUseProductMethodAfterConnect = vi.fn(async (method: string) => {
            if (
                method !== OPENADE_METHOD.taskCreate &&
                method !== OPENADE_METHOD.turnStart &&
                method !== OPENADE_METHOD.settingsMcpServersRead &&
                method !== OPENADE_METHOD.taskImageWrite &&
                method !== OPENADE_METHOD.projectGitBranchesRead &&
                method !== OPENADE_METHOD.taskTitleGenerate
            ) {
                return false
            }
            runtimeProductAPIAvailable = true
            return true
        })
        const createProductTask = vi.fn(async (args) => {
            expect(JSON.parse(JSON.stringify(args))).toEqual(args)
            return {
                taskId: "task-1",
                slug: "task-1",
                title: "Runtime task",
                createdAt: "2026-01-01T00:00:00.000Z",
            }
        })
        const startProductTurn = vi.fn(async (args) => {
            expect(JSON.parse(JSON.stringify(args))).toEqual(args)
            return { taskId: "task-1" }
        })

        const store = {
            repos: {
                getRepo: vi.fn(() => undefined),
            },
            currentUser: { id: "user-1", email: "user@example.com" },
            createProductTask,
            startProductTurn,
            refreshProductStateAfterTaskCreation: vi.fn(async () => undefined),
            shouldUseRuntimeProductAPI: vi.fn(() => runtimeProductAPIAvailable),
            usesCoreOwnedProductRuntime: vi.fn(() => true),
            canUseProductMethod: vi.fn((method: string) => runtimeProductAPIAvailable && method !== OPENADE_METHOD.taskTitleGenerate),
            canUseProductMethodAfterConnect,
            generateProductTaskTitle: vi.fn(async () => undefined),
            tasks: {
                setTaskTitle: vi.fn(),
            },
            getActiveHyperPlanStrategy: vi.fn(),
        } as unknown as CodeStore

        const manager = new TaskCreationManager(store)
        manager.creationsById.set("creation-1", {
            id: "creation-1",
            repoId: "repo-1",
            description: "describe runtime task",
            mode: "do",
            isolationStrategy: { type: "worktree", sourceBranch: "main" },
            images: [TEST_IMAGE],
            enabledMcpServerIds: ["mcp-1"],
            harnessId: "codex",
            phase: "pending",
            error: null,
            abortController: new AbortController(),
            createdAt: "2026-01-01T00:00:00.000Z",
            completedTaskId: null,
        })

        await (manager as unknown as { runCreation: (id: string) => Promise<void> }).runCreation("creation-1")

        expect(createProductTask).toHaveBeenCalledWith(
            expect.objectContaining({
                enabledMcpServerIds: ["mcp-1"],
                isolationStrategy: { type: "worktree", sourceBranch: "main" },
            })
        )
        expect(startProductTurn).toHaveBeenCalledWith(
            expect.objectContaining({
                enabledMcpServerIds: ["mcp-1"],
                images: [TEST_IMAGE],
            })
        )
        expect(canUseProductMethodAfterConnect).toHaveBeenCalledWith(OPENADE_METHOD.settingsMcpServersRead)
        expect(canUseProductMethodAfterConnect).toHaveBeenCalledWith(OPENADE_METHOD.taskImageWrite)
        expect(canUseProductMethodAfterConnect).toHaveBeenCalledWith(OPENADE_METHOD.projectGitBranchesRead)
        expect(manager.getCreation("creation-1")).toEqual(expect.objectContaining({ completedTaskId: "task-1", error: null }))
    })

    it("omits stale MCP connector ids from runtime task-create and turn-start requests when MCP reads are denied", async () => {
        const createProductTask = vi.fn(async (args) => {
            expect(JSON.parse(JSON.stringify(args))).toEqual(args)
            return {
                taskId: "task-1",
                slug: "task-1",
                title: "Runtime task",
                createdAt: "2026-01-01T00:00:00.000Z",
            }
        })
        const startProductTurn = vi.fn(async (args) => {
            expect(JSON.parse(JSON.stringify(args))).toEqual(args)
            return { taskId: "task-1" }
        })

        const store = {
            repos: {
                getRepo: vi.fn(() => undefined),
            },
            currentUser: { id: "user-1", email: "user@example.com" },
            createProductTask,
            startProductTurn,
            refreshProductStateAfterTaskCreation: vi.fn(async () => undefined),
            shouldUseRuntimeProductAPI: vi.fn(() => true),
            usesCoreOwnedProductRuntime: vi.fn(() => false),
            canUseProductMethod: vi.fn((method: string) => method !== OPENADE_METHOD.settingsMcpServersRead),
            generateProductTaskTitle: vi.fn(async () => undefined),
            tasks: {
                setTaskTitle: vi.fn(),
            },
            getActiveHyperPlanStrategy: vi.fn(),
        } as unknown as CodeStore

        const manager = new TaskCreationManager(store)
        manager.creationsById.set("creation-1", {
            id: "creation-1",
            repoId: "repo-1",
            description: "describe runtime task",
            mode: "do",
            isolationStrategy: { type: "head" },
            images: [],
            enabledMcpServerIds: ["mcp-stale"],
            harnessId: "codex",
            phase: "pending",
            error: null,
            abortController: new AbortController(),
            createdAt: "2026-01-01T00:00:00.000Z",
            completedTaskId: null,
        })

        await (manager as unknown as { runCreation: (id: string) => Promise<void> }).runCreation("creation-1")

        const createRequest = createProductTask.mock.calls.at(-1)?.[0]
        if (!createRequest) throw new Error("Missing task-create request")
        expect("enabledMcpServerIds" in createRequest).toBe(false)
        const turnRequest = startProductTurn.mock.calls.at(-1)?.[0]
        if (!turnRequest) throw new Error("Missing turn-start request")
        expect("enabledMcpServerIds" in turnRequest).toBe(false)
        expect(manager.getCreation("creation-1")).toEqual(expect.objectContaining({ completedTaskId: "task-1", error: null }))
    })

    it("omits stale image refs from runtime turn-start requests when image writes are denied", async () => {
        const createProductTask = vi.fn(async (args) => {
            expect(JSON.parse(JSON.stringify(args))).toEqual(args)
            return {
                taskId: "task-1",
                slug: "task-1",
                title: "Runtime task",
                createdAt: "2026-01-01T00:00:00.000Z",
            }
        })
        const startProductTurn = vi.fn(async (args) => {
            expect(JSON.parse(JSON.stringify(args))).toEqual(args)
            return { taskId: "task-1" }
        })

        const store = {
            repos: {
                getRepo: vi.fn(() => undefined),
            },
            currentUser: { id: "user-1", email: "user@example.com" },
            createProductTask,
            startProductTurn,
            refreshProductStateAfterTaskCreation: vi.fn(async () => undefined),
            shouldUseRuntimeProductAPI: vi.fn(() => true),
            usesCoreOwnedProductRuntime: vi.fn(() => false),
            canUseProductMethod: vi.fn((method: string) => method !== OPENADE_METHOD.taskImageWrite),
            generateProductTaskTitle: vi.fn(async () => undefined),
            tasks: {
                setTaskTitle: vi.fn(),
            },
            getActiveHyperPlanStrategy: vi.fn(),
        } as unknown as CodeStore

        const manager = new TaskCreationManager(store)
        manager.creationsById.set("creation-1", {
            id: "creation-1",
            repoId: "repo-1",
            description: "describe runtime task",
            mode: "do",
            isolationStrategy: { type: "head" },
            images: [TEST_IMAGE],
            harnessId: "codex",
            phase: "pending",
            error: null,
            abortController: new AbortController(),
            createdAt: "2026-01-01T00:00:00.000Z",
            completedTaskId: null,
        })

        await (manager as unknown as { runCreation: (id: string) => Promise<void> }).runCreation("creation-1")

        const turnRequest = startProductTurn.mock.calls.at(-1)?.[0]
        if (!turnRequest) throw new Error("Missing turn-start request")
        expect(turnRequest).toEqual(expect.objectContaining({ images: [] }))
        expect(manager.getCreation("creation-1")).toEqual(expect.objectContaining({ completedTaskId: "task-1", error: null }))
    })

    it("downgrades stale worktree isolation to head when runtime branch reads are denied", async () => {
        const createProductTask = vi.fn(async (args) => {
            expect(JSON.parse(JSON.stringify(args))).toEqual(args)
            return {
                taskId: "task-1",
                slug: "task-1",
                title: "Runtime task",
                createdAt: "2026-01-01T00:00:00.000Z",
            }
        })
        const startProductTurn = vi.fn(async (args) => {
            expect(JSON.parse(JSON.stringify(args))).toEqual(args)
            return { taskId: "task-1" }
        })

        const store = {
            repos: {
                getRepo: vi.fn(() => undefined),
            },
            currentUser: { id: "user-1", email: "user@example.com" },
            createProductTask,
            startProductTurn,
            refreshProductStateAfterTaskCreation: vi.fn(async () => undefined),
            shouldUseRuntimeProductAPI: vi.fn(() => true),
            usesCoreOwnedProductRuntime: vi.fn(() => false),
            canUseProductMethod: vi.fn((method: string) => method !== OPENADE_METHOD.projectGitBranchesRead),
            generateProductTaskTitle: vi.fn(async () => undefined),
            tasks: {
                setTaskTitle: vi.fn(),
            },
            getActiveHyperPlanStrategy: vi.fn(),
        } as unknown as CodeStore

        const manager = new TaskCreationManager(store)
        manager.creationsById.set("creation-1", {
            id: "creation-1",
            repoId: "repo-1",
            description: "describe runtime task",
            mode: "do",
            isolationStrategy: { type: "worktree", sourceBranch: "hidden-stale-branch" },
            images: [],
            harnessId: "codex",
            phase: "pending",
            error: null,
            abortController: new AbortController(),
            createdAt: "2026-01-01T00:00:00.000Z",
            completedTaskId: null,
        })

        await (manager as unknown as { runCreation: (id: string) => Promise<void> }).runCreation("creation-1")

        expect(createProductTask).toHaveBeenCalledWith(expect.objectContaining({ isolationStrategy: { type: "head" } }))
        expect(startProductTurn).toHaveBeenCalledWith(expect.not.objectContaining({ isolationStrategy: expect.anything() }))
        expect(manager.getCreation("creation-1")).toEqual(expect.objectContaining({ completedTaskId: "task-1", error: null }))
    })

    it("does not start runtime title generation when the capability is unavailable", async () => {
        const createProductTask = vi.fn(async () => ({
            taskId: "task-1",
            slug: "task-1",
            title: "Runtime task",
            createdAt: "2026-01-01T00:00:00.000Z",
        }))
        const startProductTurn = vi.fn(async (args) => {
            expect(JSON.parse(JSON.stringify(args))).toEqual(args)
            return { taskId: "task-1" }
        })
        const generateProductTaskTitle = vi.fn(async () => undefined)

        const store = {
            repos: {
                getRepo: vi.fn(() => undefined),
            },
            currentUser: { id: "user-1", email: "user@example.com" },
            createProductTask,
            startProductTurn,
            refreshProductStateAfterTaskCreation: vi.fn(async () => undefined),
            shouldUseRuntimeProductAPI: vi.fn(() => true),
            usesCoreOwnedProductRuntime: vi.fn(() => false),
            canUseProductMethod: vi.fn((method: string) => method !== OPENADE_METHOD.taskTitleGenerate),
            generateProductTaskTitle,
            tasks: {
                setTaskTitle: vi.fn(),
            },
            getActiveHyperPlanStrategy: vi.fn(),
        } as unknown as CodeStore

        const manager = new TaskCreationManager(store)
        manager.creationsById.set("creation-1", {
            id: "creation-1",
            repoId: "repo-1",
            description: "describe runtime task",
            mode: "do",
            isolationStrategy: { type: "head" },
            images: [],
            harnessId: "codex",
            phase: "pending",
            error: null,
            abortController: new AbortController(),
            createdAt: "2026-01-01T00:00:00.000Z",
            completedTaskId: null,
        })

        await (manager as unknown as { runCreation: (id: string) => Promise<void> }).runCreation("creation-1")

        expect(createProductTask).toHaveBeenCalledTimes(1)
        expect(startProductTurn).toHaveBeenCalledWith(expect.objectContaining({ inTaskId: "task-1" }))
        expect(manager.getCreation("creation-1")).toEqual(expect.objectContaining({ completedTaskId: "task-1", error: null }))
        await vi.waitFor(() => {
            expect(store.canUseProductMethod).toHaveBeenCalledWith(OPENADE_METHOD.taskTitleGenerate)
        })
        expect(generateProductTaskTitle).not.toHaveBeenCalled()
        expect(store.tasks.setTaskTitle).not.toHaveBeenCalled()
    })

    it("does not write fallback titles when runtime task creation title generation fails", async () => {
        const createProductTask = vi.fn(async () => ({
            taskId: "task-1",
            slug: "task-1",
            title: "Runtime task",
            createdAt: "2026-01-01T00:00:00.000Z",
        }))
        const startProductTurn = vi.fn(async (args) => {
            expect(JSON.parse(JSON.stringify(args))).toEqual(args)
            return { taskId: "task-1" }
        })
        const generateProductTaskTitle = vi.fn(async () => {
            throw new Error("runtime title generator failed")
        })
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)

        const store = {
            repos: {
                getRepo: vi.fn(() => undefined),
            },
            currentUser: { id: "user-1", email: "user@example.com" },
            createProductTask,
            startProductTurn,
            refreshProductStateAfterTaskCreation: vi.fn(async () => undefined),
            shouldUseRuntimeProductAPI: vi.fn(() => true),
            usesCoreOwnedProductRuntime: vi.fn(() => false),
            canUseProductMethod: vi.fn(() => true),
            generateProductTaskTitle,
            tasks: {
                setTaskTitle: vi.fn(),
            },
            getActiveHyperPlanStrategy: vi.fn(),
        } as unknown as CodeStore

        const manager = new TaskCreationManager(store)
        manager.creationsById.set("creation-1", {
            id: "creation-1",
            repoId: "repo-1",
            description: "describe runtime task",
            mode: "do",
            isolationStrategy: { type: "head" },
            images: [],
            harnessId: "codex",
            phase: "pending",
            error: null,
            abortController: new AbortController(),
            createdAt: "2026-01-01T00:00:00.000Z",
            completedTaskId: null,
        })

        await (manager as unknown as { runCreation: (id: string) => Promise<void> }).runCreation("creation-1")

        await vi.waitFor(() => {
            expect(generateProductTaskTitle).toHaveBeenCalledWith({ repoId: "repo-1", taskId: "task-1", harnessId: "codex" })
        })
        expect(store.tasks.setTaskTitle).not.toHaveBeenCalled()
        expect(consoleError).toHaveBeenCalledWith("[TaskCreationManager] Title generation failed:", expect.any(Error))
    })

    it("creates a runtime task record without starting execution when turn start is unavailable", async () => {
        const createProductTask = vi.fn(async () => ({
            taskId: "task-1",
            slug: "task-1",
            title: "Runtime task",
            createdAt: "2026-01-01T00:00:00.000Z",
        }))
        const startProductTurn = vi.fn(async () => ({ taskId: "task-1" }))
        const generateProductTaskTitle = vi.fn(async () => undefined)

        const store = {
            repos: {
                getRepo: vi.fn(() => undefined),
            },
            currentUser: { id: "user-1", email: "user@example.com" },
            createProductTask,
            startProductTurn,
            refreshProductStateAfterTaskCreation: vi.fn(async () => undefined),
            shouldUseRuntimeProductAPI: vi.fn(() => true),
            usesCoreOwnedProductRuntime: vi.fn(() => false),
            canUseProductMethod: vi.fn((method: string) => method !== OPENADE_METHOD.turnStart),
            generateProductTaskTitle,
            tasks: {
                setTaskTitle: vi.fn(),
            },
            getActiveHyperPlanStrategy: vi.fn(),
        } as unknown as CodeStore

        const manager = new TaskCreationManager(store)
        manager.creationsById.set("creation-1", {
            id: "creation-1",
            repoId: "repo-1",
            description: "describe runtime task",
            mode: "do",
            isolationStrategy: { type: "head" },
            images: [],
            harnessId: "codex",
            phase: "pending",
            error: null,
            abortController: new AbortController(),
            createdAt: "2026-01-01T00:00:00.000Z",
            completedTaskId: null,
        })

        await (manager as unknown as { runCreation: (id: string) => Promise<void> }).runCreation("creation-1")

        expect(createProductTask).toHaveBeenCalledWith(expect.objectContaining({ repoId: "repo-1", input: "describe runtime task" }))
        expect(startProductTurn).not.toHaveBeenCalled()
        expect(store.refreshProductStateAfterTaskCreation).not.toHaveBeenCalled()
        expect(manager.getCreation("creation-1")).toEqual(expect.objectContaining({ completedTaskId: "task-1", error: null }))
        await vi.waitFor(() => {
            expect(generateProductTaskTitle).toHaveBeenCalledWith({ repoId: "repo-1", taskId: "task-1", harnessId: "codex" })
        })
    })

    it("does not create a runtime task when task create is unavailable", async () => {
        const createProductTask = vi.fn(async () => ({
            taskId: "task-1",
            slug: "task-1",
            title: "Runtime task",
            createdAt: "2026-01-01T00:00:00.000Z",
        }))
        const startProductTurn = vi.fn(async () => ({ taskId: "task-1" }))

        const store = {
            repos: {
                getRepo: vi.fn(() => undefined),
            },
            currentUser: { id: "user-1", email: "user@example.com" },
            createProductTask,
            startProductTurn,
            refreshProductStateAfterTaskCreation: vi.fn(async () => undefined),
            shouldUseRuntimeProductAPI: vi.fn(() => true),
            usesCoreOwnedProductRuntime: vi.fn(() => false),
            canUseProductMethod: vi.fn((method: string) => method !== OPENADE_METHOD.taskCreate),
            generateProductTaskTitle: vi.fn(async () => undefined),
            tasks: {
                setTaskTitle: vi.fn(),
            },
            getActiveHyperPlanStrategy: vi.fn(),
        } as unknown as CodeStore

        const manager = new TaskCreationManager(store)
        manager.creationsById.set("creation-1", {
            id: "creation-1",
            repoId: "repo-1",
            description: "describe runtime task",
            mode: "do",
            isolationStrategy: { type: "head" },
            images: [],
            harnessId: "codex",
            phase: "pending",
            error: null,
            abortController: new AbortController(),
            createdAt: "2026-01-01T00:00:00.000Z",
            completedTaskId: null,
        })

        await (manager as unknown as { runCreation: (id: string) => Promise<void> }).runCreation("creation-1")

        expect(createProductTask).not.toHaveBeenCalled()
        expect(startProductTurn).not.toHaveBeenCalled()
        expect(manager.getCreation("creation-1")).toEqual(
            expect.objectContaining({
                completedTaskId: null,
                error: "Task creation is not available from this runtime",
            })
        )
    })

    it("attaches Core task creation before falling back to legacy turn start", async () => {
        const createProductTask = vi.fn(async () => ({
            taskId: "task-1",
            slug: "task-1",
            title: "Runtime task",
            createdAt: "2026-01-01T00:00:00.000Z",
        }))
        const startProductTurn = vi.fn(async () => ({ taskId: "task-1" }))
        let runtimeProductAPIAvailable = false
        const canUseProductMethodAfterConnect = vi.fn(async () => {
            runtimeProductAPIAvailable = true
            return true
        })

        const store = {
            repos: {
                getRepo: vi.fn(() => ({ id: "repo-1", path: "/tmp/repo" })),
            },
            currentUser: { id: "user-1", email: "user@example.com" },
            createProductTask,
            startProductTurn,
            refreshProductStateAfterTaskCreation: vi.fn(async () => undefined),
            shouldUseRuntimeProductAPI: vi.fn(() => runtimeProductAPIAvailable),
            usesCoreOwnedProductRuntime: vi.fn(() => true),
            canUseProductMethod: vi.fn(() => true),
            canUseProductMethodAfterConnect,
            generateProductTaskTitle: vi.fn(async () => undefined),
            tasks: {
                setTaskTitle: vi.fn(),
            },
            getActiveHyperPlanStrategy: vi.fn(),
        } as unknown as CodeStore

        const manager = new TaskCreationManager(store)
        manager.creationsById.set("creation-1", {
            id: "creation-1",
            repoId: "repo-1",
            description: "describe runtime task",
            mode: "do",
            isolationStrategy: { type: "head" },
            images: [],
            harnessId: "codex",
            phase: "pending",
            error: null,
            abortController: new AbortController(),
            createdAt: "2026-01-01T00:00:00.000Z",
            completedTaskId: null,
        })

        await (manager as unknown as { runCreation: (id: string) => Promise<void> }).runCreation("creation-1")

        expect(canUseProductMethodAfterConnect).toHaveBeenCalledWith(OPENADE_METHOD.taskCreate)
        expect(canUseProductMethodAfterConnect).toHaveBeenCalledWith(OPENADE_METHOD.turnStart)
        expect(createProductTask).toHaveBeenCalledWith(
            expect.objectContaining({
                repoId: "repo-1",
                input: "describe runtime task",
                isolationStrategy: { type: "head" },
            })
        )
        expect(startProductTurn).toHaveBeenCalledWith(
            expect.objectContaining({
                repoId: "repo-1",
                inTaskId: "task-1",
                type: "do",
                input: "describe runtime task",
            })
        )
        expect(store.refreshProductStateAfterTaskCreation).not.toHaveBeenCalled()
        expect(manager.getCreation("creation-1")).toEqual(
            expect.objectContaining({
                completedTaskId: "task-1",
                error: null,
            })
        )
    })

    it("cleans up a server-accepted task through product APIs when creation is cancelled", async () => {
        const managerRef: { current: TaskCreationManager | null } = { current: null }
        const createProductTask = vi.fn(async () => ({
            taskId: "task-1",
            slug: "task-1",
            title: "Runtime task",
            createdAt: "2026-01-01T00:00:00.000Z",
        }))
        const startProductTurn = vi.fn(async () => {
            managerRef.current?.getCreation("creation-1")?.abortController.abort()
            return { taskId: "task-1" }
        })
        const refreshProductStateAfterTaskCreation = vi.fn(async () => {
            managerRef.current?.getCreation("creation-1")?.abortController.abort()
        })
        const interruptProductTurn = vi.fn(async () => undefined)
        const deleteProductTask = vi.fn(async () => ({ repoId: "repo-1", taskId: "task-1", deleted: true }))
        const refreshProductStateAfterTaskDeletion = vi.fn(async () => undefined)
        const generateTitleSpy = vi
            .spyOn(TaskCreationManager.prototype as unknown as { generateTitleAsync: (...args: unknown[]) => Promise<void> }, "generateTitleAsync")
            .mockResolvedValue(undefined)

        const store = {
            repos: {
                getRepo: vi.fn(() => ({ id: "repo-1", path: "/tmp/repo" })),
            },
            currentUser: { id: "user-1", email: "user@example.com" },
            createProductTask,
            startProductTurn,
            refreshProductStateAfterTaskCreation,
            interruptProductTurn,
            deleteProductTask,
            refreshProductStateAfterTaskDeletion,
            shouldUseRuntimeProductAPI: vi.fn(() => true),
            usesCoreOwnedProductRuntime: vi.fn(() => false),
            canUseProductMethod: vi.fn(() => true),
            getActiveHyperPlanStrategy: vi.fn(),
        } as unknown as CodeStore

        const manager = new TaskCreationManager(store)
        managerRef.current = manager
        manager.creationsById.set("creation-1", {
            id: "creation-1",
            repoId: "repo-1",
            description: "describe task",
            mode: "do",
            isolationStrategy: { type: "worktree", sourceBranch: "main" },
            images: [],
            phase: "pending",
            error: null,
            abortController: new AbortController(),
            createdAt: "2026-01-01T00:00:00.000Z",
            completedTaskId: null,
        })

        await (manager as unknown as { runCreation: (id: string) => Promise<void> }).runCreation("creation-1")

        expect(createProductTask).toHaveBeenCalledTimes(1)
        expect(startProductTurn).toHaveBeenCalledWith(expect.objectContaining({ inTaskId: "task-1" }))
        expect(interruptProductTurn).toHaveBeenCalledWith("task-1")
        expect(deleteProductTask).toHaveBeenCalledWith({
            repoId: "repo-1",
            taskId: "task-1",
            options: {
                deleteSnapshots: true,
                deleteImages: true,
                deleteSessions: true,
                deleteWorktrees: true,
            },
        })
        expect(refreshProductStateAfterTaskDeletion).toHaveBeenCalledWith("task-1")
        expect(refreshProductStateAfterTaskCreation).not.toHaveBeenCalled()
        expect(generateTitleSpy).not.toHaveBeenCalled()
        expect(manager.getCreation("creation-1")).toBeNull()
    })
})
