import { afterEach, describe, expect, it, vi } from "vitest"
import type { ImageAttachment } from "../../types"
import { TaskCreationManager, buildTaskCreationInput } from "./TaskCreationManager"
import type { CodeStore } from "../store"

const TEST_IMAGE: ImageAttachment = {
    id: "img-1",
    mediaType: "image/png",
    ext: "png",
    originalWidth: 100,
    originalHeight: 100,
    resizedWidth: 100,
    resizedHeight: 100,
}

describe("TaskCreationManager image plumbing", () => {
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
})
