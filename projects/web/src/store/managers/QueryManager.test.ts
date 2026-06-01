import { beforeEach, describe, expect, it, vi } from "vitest"
import type { CodeStore } from "../store"
import { QueryManager } from "./QueryManager"

function createStoreStub(isTaskRunning: boolean) {
    const store = {
        isTaskRunning: vi.fn(() => isTaskRunning),
        interruptProductTurn: vi.fn(async () => undefined),
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

        const interrupted = await manager.interruptTask("task-1")

        expect(interrupted).toBe(true)
        expect(store.interruptProductTurn).toHaveBeenCalledWith("task-1")
    })

    it("returns false without calling the runtime when nothing is running", async () => {
        const { store } = createStoreStub(false)
        const manager = new QueryManager(store)

        const interrupted = await manager.interruptTask("task-2")

        expect(interrupted).toBe(false)
        expect(store.interruptProductTurn).not.toHaveBeenCalled()
    })

    it("interrupts running server-owned tasks", async () => {
        const { store } = createStoreStub(true)
        const manager = new QueryManager(store)

        await manager.abortTask("task-1")

        expect(store.isTaskRunning).toHaveBeenCalledWith("task-1")
        expect(store.interruptProductTurn).toHaveBeenCalledWith("task-1")
    })

    it("does not call the runtime when no server-owned task is running", async () => {
        const { store } = createStoreStub(false)
        const manager = new QueryManager(store)

        await manager.abortTask("task-2")

        expect(store.isTaskRunning).toHaveBeenCalledWith("task-2")
        expect(store.interruptProductTurn).not.toHaveBeenCalled()
    })
})
