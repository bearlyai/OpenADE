import { describe, expect, it, vi } from "vitest"
import { OPENADE_METHOD } from "../../../../openade-client/src"
import type { OpenADETurnStartRequest } from "../../../../openade-module/src"
import type { CodeStore } from "../store"
import { RepeatManager } from "./RepeatManager"

describe("RepeatManager runtime ownership", () => {
    it("does not open or refresh legacy task storage while Core owns product state", async () => {
        const getTaskStore = vi.fn(async () => undefined)
        const refreshProductStateAfterTaskMutation = vi.fn(async () => undefined)
        const startProductTurn = vi.fn(async (_request: OpenADETurnStartRequest) => ({ taskId: "task-1" }))
        let runtimeProductAPIAvailable = false
        const availableMethods = new Set<string>([OPENADE_METHOD.turnStart, OPENADE_METHOD.settingsMcpServersRead])
        const canUseProductMethodAfterConnect = vi.fn(async (method: string) => {
            if (!availableMethods.has(method)) return false
            runtimeProductAPIAvailable = true
            return true
        })
        const store = {
            execution: {
                onAfterEvent: vi.fn(() => vi.fn()),
            },
            canUseProductMethod: vi.fn((method: string) => runtimeProductAPIAvailable && availableMethods.has(method)),
            canUseProductMethodAfterConnect,
            shouldUseRuntimeProductAPI: vi.fn(() => runtimeProductAPIAvailable),
            usesCoreOwnedProductRuntime: vi.fn(() => true),
            shouldUseRuntimeProductTaskRoute: vi.fn(() => true),
            getTaskStore,
            refreshProductStateAfterTaskMutation,
            startProductTurn,
            tasks: {
                getTaskModel: vi.fn(() => ({
                    repoId: "repo-1",
                    input: { value: "repeat this" },
                    enabledMcpServerIds: ["mcp-1"],
                    harnessId: "codex",
                    model: "gpt-5-codex",
                    thinking: "med",
                    fastMode: true,
                })),
            },
        } as unknown as CodeStore
        const manager = new RepeatManager(store)

        manager.start("task-1")

        await vi.waitFor(() => expect(startProductTurn).toHaveBeenCalled())
        expect(canUseProductMethodAfterConnect).toHaveBeenCalledWith(OPENADE_METHOD.turnStart)
        expect(getTaskStore).not.toHaveBeenCalled()
        expect(refreshProductStateAfterTaskMutation).not.toHaveBeenCalled()
        expect(startProductTurn).toHaveBeenCalledWith(
            expect.objectContaining({
                repoId: "repo-1",
                inTaskId: "task-1",
                input: "repeat this",
                enabledMcpServerIds: ["mcp-1"],
            })
        )
    })

    it("omits stale MCP connector ids from repeat turns when MCP reads are denied", async () => {
        const startProductTurn = vi.fn(async (_request: OpenADETurnStartRequest) => ({ taskId: "task-1" }))
        const store = {
            execution: {
                onAfterEvent: vi.fn(() => vi.fn()),
            },
            canUseProductMethod: vi.fn((method: string) => method !== OPENADE_METHOD.settingsMcpServersRead),
            shouldUseRuntimeProductAPI: vi.fn(() => true),
            usesCoreOwnedProductRuntime: vi.fn(() => false),
            shouldUseRuntimeProductTaskRoute: vi.fn(() => true),
            getTaskStore: vi.fn(async () => undefined),
            refreshProductStateAfterTaskMutation: vi.fn(async () => undefined),
            startProductTurn,
            tasks: {
                getTaskModel: vi.fn(() => ({
                    repoId: "repo-1",
                    input: { value: "repeat this" },
                    enabledMcpServerIds: ["mcp-stale"],
                    harnessId: "codex",
                    model: "gpt-5-codex",
                    thinking: "med",
                    fastMode: true,
                })),
            },
        } as unknown as CodeStore
        const manager = new RepeatManager(store)

        manager.start("task-1")

        await vi.waitFor(() => expect(startProductTurn).toHaveBeenCalled())
        const request = startProductTurn.mock.calls.at(-1)?.[0]
        if (!request) throw new Error("Missing repeat turn request")
        expect("enabledMcpServerIds" in request).toBe(false)
    })

    it("does not open or refresh legacy task storage when only the runtime task route is ready", async () => {
        const getTaskStore = vi.fn(async () => undefined)
        const refreshProductStateAfterTaskMutation = vi.fn(async () => undefined)
        const startProductTurn = vi.fn(async (_request: OpenADETurnStartRequest) => ({ taskId: "task-1" }))
        const store = {
            execution: {
                onAfterEvent: vi.fn(() => vi.fn()),
            },
            canUseProductMethod: vi.fn(() => false),
            canUseProductMethodAfterConnect: vi.fn(async (method: string) => method === OPENADE_METHOD.turnStart),
            shouldUseRuntimeProductAPI: vi.fn(() => false),
            usesCoreOwnedProductRuntime: vi.fn(() => false),
            shouldUseRuntimeProductTaskRoute: vi.fn(() => true),
            getTaskStore,
            refreshProductStateAfterTaskMutation,
            startProductTurn,
            tasks: {
                getTaskModel: vi.fn(() => ({
                    repoId: "repo-1",
                    input: { value: "repeat this" },
                    enabledMcpServerIds: ["mcp-stale"],
                    harnessId: "codex",
                    model: "gpt-5-codex",
                    thinking: "med",
                    fastMode: true,
                })),
            },
        } as unknown as CodeStore
        const manager = new RepeatManager(store)

        manager.start("task-1")

        await vi.waitFor(() => expect(startProductTurn).toHaveBeenCalled())
        expect(getTaskStore).not.toHaveBeenCalled()
        expect(refreshProductStateAfterTaskMutation).not.toHaveBeenCalled()
        expect(startProductTurn).toHaveBeenCalledWith(
            expect.objectContaining({
                repoId: "repo-1",
                inTaskId: "task-1",
                input: "repeat this",
            })
        )
        const request = startProductTurn.mock.calls.at(-1)?.[0]
        if (!request) throw new Error("Missing repeat turn request")
        expect("enabledMcpServerIds" in request).toBe(false)
    })
})
