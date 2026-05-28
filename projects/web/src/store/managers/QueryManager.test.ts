import { beforeEach, describe, expect, it, vi } from "vitest"
import { localOpenADEClient } from "../../runtime/localOpenADEClient"
import type { CodeStore } from "../store"
import { QueryManager } from "./QueryManager"

vi.mock("../../runtime/localOpenADEClient", () => ({
    localOpenADEClient: {
        interruptTurn: vi.fn(),
    },
}))

function createStoreStub(isTaskRunning: boolean) {
    const store = {
        isTaskRunning: vi.fn(() => isTaskRunning),
    } as unknown as CodeStore

    return { store }
}

describe("QueryManager abortTask", () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it("returns whether a running server-owned task was interrupted", async () => {
        const { store } = createStoreStub(true)
        const manager = new QueryManager(store)
        vi.mocked(localOpenADEClient.interruptTurn).mockResolvedValueOnce(undefined)

        const interrupted = await manager.interruptTask("task-1")

        expect(interrupted).toBe(true)
        expect(localOpenADEClient.interruptTurn).toHaveBeenCalledWith("task-1")
    })

    it("returns false without calling the runtime when nothing is running", async () => {
        const { store } = createStoreStub(false)
        const manager = new QueryManager(store)

        const interrupted = await manager.interruptTask("task-2")

        expect(interrupted).toBe(false)
        expect(localOpenADEClient.interruptTurn).not.toHaveBeenCalled()
    })

    it("interrupts running server-owned tasks", async () => {
        const { store } = createStoreStub(true)
        const manager = new QueryManager(store)
        vi.mocked(localOpenADEClient.interruptTurn).mockResolvedValueOnce(undefined)

        await manager.abortTask("task-1")

        expect(store.isTaskRunning).toHaveBeenCalledWith("task-1")
        expect(localOpenADEClient.interruptTurn).toHaveBeenCalledWith("task-1")
    })

    it("does not call the runtime when no server-owned task is running", async () => {
        const { store } = createStoreStub(false)
        const manager = new QueryManager(store)

        await manager.abortTask("task-2")

        expect(store.isTaskRunning).toHaveBeenCalledWith("task-2")
        expect(localOpenADEClient.interruptTurn).not.toHaveBeenCalled()
    })
})
