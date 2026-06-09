import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
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
            shouldUseRuntimeProductReads: vi.fn(() => false),
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

    it("cleans up a server-accepted task through product APIs when creation is cancelled", async () => {
        const managerRef: { current: TaskCreationManager | null } = { current: null }
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
            startProductTurn,
            refreshProductStateAfterTaskCreation,
            interruptProductTurn,
            deleteProductTask,
            refreshProductStateAfterTaskDeletion,
            shouldUseRuntimeProductReads: vi.fn(() => true),
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
