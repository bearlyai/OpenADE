import { describe, expect, it, vi } from "vitest"
import { localOpenADEClient } from "../../runtime/localOpenADEClient"
import type { CodeStore } from "../store"
import { TaskManager } from "./TaskManager"

vi.mock("../../persistence", () => ({
    syncTaskPreviewFromStore: vi.fn(),
    taskFromStore: vi.fn(),
}))

vi.mock("../../runtime/localOpenADEClient", () => ({
    localOpenADEClient: {
        updateTaskMetadata: vi.fn(async () => undefined),
    },
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
            repoStore,
            refreshProductStateAfterTaskMutation: vi.fn(async () => undefined),
        } as unknown as CodeStore

        const manager = new TaskManager(store)

        await manager.setTaskClosed("task-1", true)

        expect(localOpenADEClient.updateTaskMetadata).toHaveBeenCalledWith({ taskId: "task-1", closed: true })
        expect(store.refreshProductStateAfterTaskMutation).toHaveBeenCalledWith("task-1")
    })
})
