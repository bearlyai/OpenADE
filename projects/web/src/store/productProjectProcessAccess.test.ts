import { describe, expect, it, vi } from "vitest"
import { OPENADE_METHOD, type OpenADEMethod } from "../../../openade-client/src"
import type { CodeStore } from "./store"
import { createProductProjectProcessAccess } from "./productProjectProcessAccess"

type ProcessAccessStore = Pick<
    CodeStore,
    | "canUseProductMethod"
    | "canUseProductMethodAfterConnect"
    | "startProductProjectProcess"
    | "reconnectProductProjectProcess"
    | "stopProductProjectProcess"
>

describe("createProductProjectProcessAccess", () => {
    it("rechecks runtime capabilities after the access object is created", async () => {
        const grantedMethods = new Set<OpenADEMethod>([
            OPENADE_METHOD.projectProcessStart,
            OPENADE_METHOD.projectProcessReconnect,
            OPENADE_METHOD.projectProcessStop,
        ])
        const store: ProcessAccessStore = {
            canUseProductMethod: vi.fn((method: OpenADEMethod) => grantedMethods.has(method)),
            canUseProductMethodAfterConnect: vi.fn(async (method: OpenADEMethod) => grantedMethods.has(method)),
            startProductProjectProcess: vi.fn(async (params) => ({
                repoId: params.repoId,
                taskId: params.taskId,
                definitionId: params.definitionId,
                processId: "process-1",
            })),
            reconnectProductProjectProcess: vi.fn(async (params) => ({
                repoId: params.repoId,
                taskId: params.taskId,
                processId: params.processId,
                found: true,
                completed: false,
                output: [],
            })),
            stopProductProjectProcess: vi.fn(async (params) => ({ repoId: params.repoId, taskId: params.taskId, processId: params.processId, ok: true })),
        } as ProcessAccessStore
        const access = createProductProjectProcessAccess(store, { repoId: "repo-1", taskId: "task-1" })

        expect(access.canStartProjectProcess).toBe(true)
        await expect(access.startProjectProcess({ definitionId: "daemon" })).resolves.toMatchObject({ processId: "process-1" })

        grantedMethods.delete(OPENADE_METHOD.projectProcessStart)

        expect(access.canStartProjectProcess).toBe(false)
        await expect(access.startProjectProcess({ definitionId: "daemon" })).rejects.toThrow("Attached runtime does not support starting project processes")
        expect(store.startProductProjectProcess).toHaveBeenCalledTimes(1)
    })

    it("attaches Core-owned process capabilities before stale mutation handlers issue requests", async () => {
        let attached = false
        const store: ProcessAccessStore = {
            canUseProductMethod: vi.fn((method: OpenADEMethod) => attached && method === OPENADE_METHOD.projectProcessStart),
            canUseProductMethodAfterConnect: vi.fn(async (method: OpenADEMethod) => {
                if (method !== OPENADE_METHOD.projectProcessStart) return false
                attached = true
                return true
            }),
            startProductProjectProcess: vi.fn(async (params) => ({
                repoId: params.repoId,
                taskId: params.taskId,
                definitionId: params.definitionId,
                processId: "process-1",
            })),
            reconnectProductProjectProcess: vi.fn(),
            stopProductProjectProcess: vi.fn(),
        } as ProcessAccessStore
        const access = createProductProjectProcessAccess(store, { repoId: "repo-1", taskId: "task-1" })

        expect(access.canStartProjectProcess).toBe(false)
        await expect(access.startProjectProcess({ definitionId: "daemon" })).resolves.toMatchObject({ processId: "process-1" })

        expect(store.canUseProductMethodAfterConnect).toHaveBeenCalledWith(OPENADE_METHOD.projectProcessStart)
        expect(store.startProductProjectProcess).toHaveBeenCalledWith({ repoId: "repo-1", taskId: "task-1", definitionId: "daemon" })
    })
})
