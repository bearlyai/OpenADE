import { beforeEach, describe, expect, it, vi } from "vitest"

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
})
