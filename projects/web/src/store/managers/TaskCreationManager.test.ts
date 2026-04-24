import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ImageAttachment } from "../../types"
import { TaskCreationManager, buildTaskCreationInput } from "./TaskCreationManager"
import type { CodeStore } from "../store"

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

    it("applies the selected model to the task before first execution", async () => {
        vi.useFakeTimers()

        const generateTitleSpy = vi
            .spyOn(TaskCreationManager.prototype as unknown as { generateTitleAsync: (...args: unknown[]) => Promise<void> }, "generateTitleAsync")
            .mockResolvedValue(undefined)

        const taskModel = {
            setHarnessId: vi.fn(),
            setModel: vi.fn(),
            setThinking: vi.fn(),
        }
        const executeAction = vi.fn()
        const taskStore = {
            meta: {
                current: { id: "" },
                set: vi.fn(),
            },
            events: {
                push: vi.fn(),
            },
            deviceEnvironments: {
                push: vi.fn(),
            },
        }

        const store = {
            repos: {
                getRepo: vi.fn(() => ({ id: "repo-1", path: "/tmp/repo" })),
                getGitInfo: vi.fn(async () => ({ isGitRepo: false, relativePath: "" })),
            },
            repoStore: {},
            getTaskStore: vi.fn(async () => taskStore),
            getCachedTaskStore: vi.fn(),
            tasks: {
                getTaskModel: vi.fn(() => taskModel),
            },
            execution: {
                executeAction,
                executePlan: vi.fn(),
                executeAsk: vi.fn(),
                executeHyperPlan: vi.fn(),
            },
            currentUser: { id: "user-1", email: "test@example.com" },
        } as unknown as CodeStore

        const manager = new TaskCreationManager(store)
        manager.creationsById.set("creation-1", {
            id: "creation-1",
            repoId: "repo-1",
            description: "describe task",
            mode: "do",
            isolationStrategy: { type: "head" },
            images: [],
            enabledMcpServerIds: undefined,
            harnessId: "codex",
            modelId: "gpt-5.5",
            thinking: "max",
            phase: "pending",
            error: null,
            slug: null,
            abortController: new AbortController(),
            createdAt: "2026-01-01T00:00:00.000Z",
            completedTaskId: null,
        })

        await (manager as unknown as { runCreation: (id: string) => Promise<void> }).runCreation("creation-1")

        expect(generateTitleSpy).toHaveBeenCalled()
        expect(taskModel.setHarnessId).toHaveBeenCalledWith("codex")
        expect(taskModel.setModel).toHaveBeenCalledWith("gpt-5.5")

        await vi.runAllTimersAsync()

        expect(executeAction).toHaveBeenCalledTimes(1)
        expect(taskModel.setModel.mock.invocationCallOrder[0]).toBeLessThan(executeAction.mock.invocationCallOrder[0])
    })
})
