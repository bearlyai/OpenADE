import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { handle, removeHandler, connect, handleRequest } = vi.hoisted(() => ({
    handle: vi.fn(),
    removeHandler: vi.fn(),
    connect: vi.fn(() => vi.fn()),
    handleRequest: vi.fn(),
}))

vi.mock("electron", () => ({
    ipcMain: {
        handle,
        removeHandler,
    },
}))

vi.mock("./runtimeGateway", () => ({
    getRuntimeServer: () => ({
        connect,
        handleRequest,
    }),
}))

async function loadModule() {
    vi.resetModules()
    return import("./runtimeIpc")
}

beforeEach(() => {
    handle.mockClear()
    removeHandler.mockClear()
    connect.mockClear()
    handleRequest.mockClear()
})

afterEach(() => {
    vi.restoreAllMocks()
})

function sender() {
    return {
        id: 1,
        isDestroyed: () => false,
        once: vi.fn(),
        send: vi.fn(),
    }
}

describe("runtime IPC lifecycle", () => {
    it("registers the local runtime bridge handlers and keeps registration idempotent", async () => {
        const { cleanupRuntimeIpc, loadRuntimeIpc } = await loadModule()

        loadRuntimeIpc()
        loadRuntimeIpc()

        expect(handle.mock.calls.map(([channel]) => channel)).toEqual(["runtime:connect", "runtime:disconnect", "runtime:request"])

        cleanupRuntimeIpc()
        cleanupRuntimeIpc()

        expect(removeHandler.mock.calls.map(([channel]) => channel)).toEqual(["runtime:connect", "runtime:disconnect", "runtime:request"])
    })

    it("passes IPC arrival time into runtime slow-request accounting", async () => {
        vi.spyOn(Date, "now").mockReturnValue(123_456)
        handleRequest.mockResolvedValue({ id: 1, result: { ok: true } })
        const { cleanupRuntimeIpc, loadRuntimeIpc } = await loadModule()

        loadRuntimeIpc()
        const requestHandler = handle.mock.calls.find(([channel]) => channel === "runtime:request")?.[1]
        expect(requestHandler).toBeDefined()

        await requestHandler?.({ sender: sender() }, { id: 1, method: "initialize" })

        expect(handleRequest).toHaveBeenCalledWith(
            { id: 1, method: "initialize" },
            expect.objectContaining({ id: "renderer:1" }),
            { requireInitialized: true, queuedAtMs: 123_456 }
        )

        cleanupRuntimeIpc()
    })
})
