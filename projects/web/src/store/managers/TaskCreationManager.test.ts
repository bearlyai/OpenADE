import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ImageAttachment } from "../../types"
import { localOpenADEClient } from "../../runtime/localOpenADEClient"
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

vi.mock("../../runtime/localOpenADEClient", () => ({
    localOpenADEClient: {
        startTurn: vi.fn(),
        interruptTurn: vi.fn(),
    },
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
        vi.mocked(localOpenADEClient.startTurn).mockResolvedValue({ taskId: "task-1" })
        vi.mocked(localOpenADEClient.interruptTurn).mockResolvedValue(undefined)
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
        vi.mocked(localOpenADEClient.startTurn).mockImplementation(async (args) => {
            expect(() => structuredClone(args)).not.toThrow()
            return { taskId: "task-1" }
        })
        const generateTitleSpy = vi
            .spyOn(TaskCreationManager.prototype as unknown as { generateTitleAsync: (...args: unknown[]) => Promise<void> }, "generateTitleAsync")
            .mockResolvedValue(undefined)

        const store = {
            repos: {
                getRepo: vi.fn(() => ({ id: "repo-1", path: "/tmp/repo" })),
            },
            refreshRepoStoreFromStorage: vi.fn(async () => undefined),
            getTaskStore: vi.fn(async () => ({})),
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
            slug: null,
            abortController: new AbortController(),
            createdAt: "2026-01-01T00:00:00.000Z",
            completedTaskId: null,
        })

        await (manager as unknown as { runCreation: (id: string) => Promise<void> }).runCreation("creation-1")

        expect(generateTitleSpy).toHaveBeenCalled()
        expect(localOpenADEClient.startTurn).toHaveBeenCalledWith(
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
        expect(manager.getCreation("creation-1")?.completedTaskId).toBe("task-1")
    })
})
