import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { afterEach, describe, expect, it } from "vitest"
import type { RuntimeMessage } from "../../../../runtime-protocol/src"
import { RuntimeServer } from "../../../../runtime/src"
import { registerRuntimeAgentModule } from "./runtimeAgents"
import { cleanupRuntimeHostModule, registerRuntimeHostModule } from "./runtimeHost"

function connection() {
    const messages: RuntimeMessage[] = []
    return {
        messages,
        connection: {
            id: "trusted-test",
            send(message: RuntimeMessage) {
                messages.push(message)
            },
        },
    }
}

function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
    const startedAt = Date.now()
    return new Promise((resolve, reject) => {
        const tick = () => {
            if (predicate()) {
                resolve()
                return
            }
            if (Date.now() - startedAt > timeoutMs) {
                reject(new Error("Timed out waiting for condition"))
                return
            }
            setTimeout(tick, 25)
        }
        tick()
    })
}

describe("runtime host integration", () => {
    afterEach(() => {
        cleanupRuntimeHostModule()
    })

    it("watches a real directory and emits runtime notifications", async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openade-runtime-watch-"))
        const runtime = new RuntimeServer({ serverName: "test-runtime" })
        registerRuntimeHostModule(runtime)
        const testConnection = connection()
        runtime.connect(testConnection.connection)

        const started = await runtime.handleRequest({ id: 1, method: "fs/watch/start", params: { dir } }, testConnection.connection)
        expect(started.error).toBeUndefined()

        const listed = await runtime.handleRequest({ id: 2, method: "fs/watch/list" }, testConnection.connection)
        expect(listed).toMatchObject({
            id: 2,
            result: [
                {
                    watchId: (started.result as { watchId: string }).watchId,
                    dir,
                    runtimeId: (started.result as { runtimeId: string }).runtimeId,
                },
            ],
        })

        fs.writeFileSync(path.join(dir, "changed.txt"), "hello")
        await waitFor(() => testConnection.messages.some((message) => "method" in message && message.method === "fs/watch/event"))

        const stopped = await runtime.handleRequest({ id: 3, method: "fs/watch/stop", params: { watchId: (started.result as { watchId: string }).watchId } }, testConnection.connection)
        expect(stopped.error).toBeUndefined()
        expect(testConnection.messages.some((message) => "method" in message && message.method === "fs/watch/stopped")).toBe(true)

        const listedAfterStop = await runtime.handleRequest({ id: 4, method: "fs/watch/list" }, testConnection.connection)
        expect(listedAfterStop).toEqual({ id: 4, result: [] })

        fs.rmSync(dir, { recursive: true, force: true })
    })

    it("runs a real process, streams output, and replays output on reconnect", async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openade-runtime-process-"))
        const runtime = new RuntimeServer({ serverName: "test-runtime" })
        registerRuntimeHostModule(runtime)
        const testConnection = connection()
        runtime.connect(testConnection.connection)

        const started = await runtime.handleRequest(
            {
                id: 1,
                method: "process/command/start",
                params: {
                    cmd: process.execPath,
                    args: ["-e", "process.stdout.write('hello from runtime')"],
                    cwd: dir,
                    timeoutMs: 5000,
                },
            },
            testConnection.connection
        )
        expect(started.error).toBeUndefined()
        const processId = (started.result as { processId: string }).processId

        await waitFor(() => testConnection.messages.some((message) => "method" in message && message.method === "process/output"))
        await waitFor(() => testConnection.messages.some((message) => "method" in message && message.method === "process/exit"))

        const reconnect = await runtime.handleRequest({ id: 2, method: "process/reconnect", params: { processId } }, testConnection.connection)
        expect(reconnect.error).toBeUndefined()
        expect(reconnect.result).toMatchObject({
            ok: true,
            found: true,
            completed: true,
            output: [expect.objectContaining({ type: "stdout", data: "hello from runtime" })],
        })

        fs.rmSync(dir, { recursive: true, force: true })
    })

    it("stops a real process through runtime/stop", async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openade-runtime-stop-process-"))
        const runtime = new RuntimeServer({ serverName: "test-runtime" })
        registerRuntimeHostModule(runtime)
        const testConnection = connection()
        runtime.connect(testConnection.connection)
        let processId: string | undefined

        try {
            const started = await runtime.handleRequest(
                {
                    id: 1,
                    method: "process/command/start",
                    params: {
                        cmd: process.execPath,
                        args: ["-e", "setInterval(() => {}, 1000)"],
                        cwd: dir,
                        timeoutMs: 10_000,
                    },
                },
                testConnection.connection
            )
            expect(started.error).toBeUndefined()
            processId = (started.result as { processId: string }).processId
            const runtimeId = (started.result as { runtimeId: string }).runtimeId

            const listedBefore = await runtime.handleRequest({ id: 2, method: "process/list" }, testConnection.connection)
            expect((listedBefore.result as { processes: Array<{ processId: string }> }).processes.some((process) => process.processId === processId)).toBe(true)

            const stopped = await runtime.handleRequest({ id: 3, method: "runtime/stop", params: { runtimeId, reason: "test stop" } }, testConnection.connection)
            expect(stopped.error).toBeUndefined()
            expect(stopped.result).toMatchObject({ runtimeId, status: "stopped", error: "test stop" })

            const listedAfter = await runtime.handleRequest({ id: 4, method: "process/list" }, testConnection.connection)
            expect((listedAfter.result as { processes: Array<{ processId: string }> }).processes.some((process) => process.processId === processId)).toBe(false)
            expect(testConnection.messages.some((message) => "method" in message && message.method === "runtime/stopped")).toBe(true)
            processId = undefined
        } finally {
            if (processId) await runtime.handleRequest({ id: 5, method: "process/kill", params: { processId } }, testConnection.connection)
            fs.rmSync(dir, { recursive: true, force: true })
        }
    })

    it("reads git state from a real repository through runtime git methods", async () => {
        const installedRuntime = new RuntimeServer({ serverName: "test-runtime" })
        registerRuntimeHostModule(installedRuntime)
        const testConnection = connection()
        const installed = await installedRuntime.handleRequest({ id: 1, method: "git/installed/read" }, testConnection.connection)
        if (!(installed.result as { installed?: boolean })?.installed) return

        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openade-runtime-git-"))
        execFileSync("git", ["init"], { cwd: dir })
        fs.writeFileSync(path.join(dir, "README.md"), "# runtime git\n")

        const directory = await installedRuntime.handleRequest({ id: 2, method: "git/directory/read", params: { directory: dir } }, testConnection.connection)
        expect(directory.error).toBeUndefined()
        expect(directory.result).toMatchObject({ isGitDirectory: true, repoRoot: fs.realpathSync(dir) })

        const status = await installedRuntime.handleRequest({ id: 3, method: "git/status/read", params: { repoDir: dir } }, testConnection.connection)
        expect(status.error).toBeUndefined()
        expect(status.result).toMatchObject({
            hasChanges: true,
            untracked: [expect.objectContaining({ path: "README.md" })],
        })

        fs.rmSync(dir, { recursive: true, force: true })
    })

    it("reads harness install status through runtime agent methods", async () => {
        const runtime = new RuntimeServer({ serverName: "test-runtime" })
        registerRuntimeAgentModule(runtime)
        const testConnection = connection()

        const status = await runtime.handleRequest({ id: 1, method: "agent/provider/status" }, testConnection.connection)
        expect(status.error).toBeUndefined()
        expect(status.result).toEqual(expect.any(Object))
    })

    it("records failed runtime state when harness execution cannot start", async () => {
        const runtime = new RuntimeServer({ serverName: "test-runtime" })
        registerRuntimeAgentModule(runtime)
        const testConnection = connection()
        runtime.connect(testConnection.connection)

        const started = await runtime.handleRequest(
            {
                id: 1,
                method: "agent/execution/start",
                params: {
                    executionId: "missing-harness",
                    prompt: "hello",
                    options: { harnessId: "missing-harness", cwd: os.tmpdir() },
                },
            },
            testConnection.connection
        )

        expect(started.error).toBeUndefined()
        expect(started.result).toMatchObject({ ok: false })
        expect(runtime.supervisor.get("agent:missing-harness")).toMatchObject({ status: "failed" })
        expect(testConnection.messages.some((message) => "method" in message && message.method === "runtime/failed")).toBe(true)
    })
})
