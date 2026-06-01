import { describe, expect, it, vi } from "vitest"
import type { TaskTerminalProductAccess } from "./terminalSession"
import { ProductTaskTerminalSession } from "./terminalSession"

function createProductAccess(overrides: Partial<TaskTerminalProductAccess> = {}): TaskTerminalProductAccess {
    return {
        repoId: "repo-1",
        taskId: "task-1",
        startTaskTerminal: vi.fn(async (params) => ({
            repoId: "repo-1",
            taskId: "task-1",
            terminalId: "terminal-1",
            runtimeId: "pty:terminal-1",
            ok: true,
            ...params,
        })),
        reconnectTaskTerminal: vi.fn(async (params) => ({
            repoId: "repo-1",
            taskId: "task-1",
            terminalId: params.terminalId ?? "terminal-1",
            found: false,
            output: [],
        })),
        writeTaskTerminal: vi.fn(async (params) => ({ repoId: "repo-1", taskId: "task-1", terminalId: params.terminalId, ok: true })),
        resizeTaskTerminal: vi.fn(async (params) => ({ repoId: "repo-1", taskId: "task-1", terminalId: params.terminalId, ok: true })),
        stopTaskTerminal: vi.fn(async (params) => ({ repoId: "repo-1", taskId: "task-1", terminalId: params.terminalId, ok: true })),
        ...overrides,
    }
}

describe("ProductTaskTerminalSession", () => {
    it("reconnects by repo and task without client-side terminal id derivation", async () => {
        const access = createProductAccess({
            reconnectTaskTerminal: vi.fn(async (params) => ({
                repoId: "repo-1",
                taskId: "task-1",
                terminalId: params.terminalId ?? "terminal-1",
                found: true,
                outputCount: 2,
                output: [
                    { data: "hello", timestamp: 1 },
                    { data: " world", timestamp: 2 },
                ],
            })),
        })

        const session = await ProductTaskTerminalSession.connect(access, 80, 24, { pollIntervalMs: 0 })
        if (!session) throw new Error("Expected product terminal session")
        const output: string[] = []
        session.on("output", (chunk) => output.push(chunk))

        expect(access.reconnectTaskTerminal).toHaveBeenCalledWith({})
        expect(access.startTaskTerminal).not.toHaveBeenCalled()
        expect(output).toEqual(["hello", " world"])
    })

    it("starts a product terminal when reconnect does not find one and reuses the returned terminal id", async () => {
        const access = createProductAccess()
        const session = await ProductTaskTerminalSession.connect(access, 80, 24, { pollIntervalMs: 0 })
        if (!session) throw new Error("Expected product terminal session")

        await session.write("pwd\n")
        await session.resize(100, 30)
        await session.kill()

        expect(access.reconnectTaskTerminal).toHaveBeenCalledWith({})
        expect(access.startTaskTerminal).toHaveBeenCalledWith({ cols: 80, rows: 24 })
        expect(access.writeTaskTerminal).toHaveBeenCalledWith({ terminalId: "terminal-1", data: "pwd\n" })
        expect(access.resizeTaskTerminal).toHaveBeenCalledWith({ terminalId: "terminal-1", cols: 100, rows: 30 })
        expect(access.stopTaskTerminal).toHaveBeenCalledWith({ terminalId: "terminal-1" })
    })

    it("polls only new product output and emits exit once", async () => {
        const reconnectTaskTerminal: TaskTerminalProductAccess["reconnectTaskTerminal"] = vi
            .fn()
            .mockResolvedValueOnce({
                repoId: "repo-1",
                taskId: "task-1",
                terminalId: "terminal-1",
                found: true,
                outputCount: 1,
                output: [{ data: "first", timestamp: 1 }],
            })
            .mockResolvedValueOnce({
                repoId: "repo-1",
                taskId: "task-1",
                terminalId: "terminal-1",
                found: true,
                exited: true,
                exitCode: 0,
                outputCount: 3,
                output: [
                    { data: "first", timestamp: 1 },
                    { data: " second", timestamp: 2 },
                    { data: " third", timestamp: 3 },
                ],
            })
        const access = createProductAccess({ reconnectTaskTerminal })

        const session = await ProductTaskTerminalSession.connect(access, 80, 24, { pollIntervalMs: 0 })
        if (!session) throw new Error("Expected product terminal session")
        const output: string[] = []
        const exit = vi.fn()
        session.on("output", (chunk) => output.push(chunk))
        session.on("exit", exit)

        await session.pollOnce()
        await session.pollOnce()

        expect(output).toEqual(["first", " second", " third"])
        expect(exit).toHaveBeenCalledTimes(1)
        expect(reconnectTaskTerminal).toHaveBeenCalledTimes(2)
    })
})
