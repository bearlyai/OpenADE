import { describe, expect, it, vi } from "vitest"
import type { OpenADEProjectProcessListResult } from "../../openade-module/src/types"
import { RuntimeServer, type RuntimeConnection } from "../../runtime/src"
import type { RuntimeMessage, RuntimeNotification, RuntimeRequest } from "../../runtime-protocol/src"
import { RuntimeLocalClient, type RuntimeLocalTransport } from "../../runtime-client/src"
import type { OpenADEMethod, OpenADERequestForMethod, OpenADEResponseForMethod } from "./generated/openade-contracts"
import { OpenADEClient, type RuntimeClientLike } from "./index"

interface Deferred<T> {
    promise: Promise<T>
    resolve(value: T): void
    reject(error: Error): void
}

function createDeferred<T>(): Deferred<T> {
    let resolveValue = (_value: T): void => {
        throw new Error("Deferred resolve called before initialization")
    }
    let rejectValue = (_error: Error): void => {
        throw new Error("Deferred reject called before initialization")
    }
    const promise = new Promise<T>((resolve, reject) => {
        resolveValue = resolve
        rejectValue = reject
    })
    return {
        promise,
        resolve: resolveValue,
        reject: rejectValue,
    }
}

function createLocalRuntimeClient(server: RuntimeServer): RuntimeLocalClient {
    const listeners = new Set<(message: RuntimeMessage) => void>()
    let dispose: (() => void) | null = null
    const connection: RuntimeConnection = {
        id: "openade-client-test",
        send(message) {
            for (const listener of listeners) listener(message)
        },
    }
    const transport: RuntimeLocalTransport = {
        connect() {
            dispose = server.connect(connection)
        },
        disconnect() {
            dispose?.()
            dispose = null
        },
        request(request: RuntimeRequest) {
            return server.handleRequest(request, connection, { requireInitialized: true })
        },
        onMessage(listener: (message: RuntimeMessage) => void) {
            listeners.add(listener)
            return () => listeners.delete(listener)
        },
    }
    return new RuntimeLocalClient(transport, { clientName: "openade-client-test", clientPlatform: "web" })
}

interface CapturedRuntimeCall {
    method: string
    hasParams: boolean
    params: unknown
}

class CapturingRuntimeClient implements RuntimeClientLike {
    readonly calls: CapturedRuntimeCall[] = []

    request<Method extends OpenADEMethod>(
        method: Method,
        ...[params]: undefined extends OpenADERequestForMethod<Method>
            ? [params?: OpenADERequestForMethod<Method>]
            : [params: OpenADERequestForMethod<Method>]
    ): Promise<OpenADEResponseForMethod<Method>>
    request<T>(method: string, params?: unknown): Promise<T>
    async request<T>(method: string, params?: unknown): Promise<T> {
        this.calls.push({ method, hasParams: arguments.length >= 2, params })
        if (method === "runtime/list") return [] as T
        if (method === "openade/snapshot/read") {
            return {
                server: { version: "test" },
                repos: [],
                workingTaskIds: [],
            } as T
        }
        return {} as T
    }

    subscribe(_listener: (notification: RuntimeNotification) => void): () => void {
        return () => undefined
    }

    close(): void {}
}

async function waitUntil(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
    const startedAt = Date.now()
    while (!predicate()) {
        if (Date.now() - startedAt > timeoutMs) throw new Error("Timed out waiting for condition")
        await new Promise((resolve) => setTimeout(resolve, 5))
    }
}

describe("OpenADEClient request telemetry", () => {
    it("omits params for generated undefined-request OpenADE methods while preserving raw runtime requests", async () => {
        const runtime = new CapturingRuntimeClient()
        const client = new OpenADEClient({ runtime, clientName: "OpenADE Test", clientPlatform: "web" })

        await client.getSnapshot()
        await client.listRuntimes({ ownerType: "openade-task" })

        expect(runtime.calls).toEqual([
            { method: "openade/snapshot/read", hasParams: false, params: undefined },
            { method: "runtime/list", hasParams: true, params: { ownerType: "openade-task" } },
        ])
    })

    it("does not report coalesced read callers as outbound runtime request bursts", async () => {
        const server = new RuntimeServer({ serverName: "openade-client-test", protocolVersion: 1 })
        const result: OpenADEProjectProcessListResult = {
            repoId: "repo-1",
            searchRoot: "/repo",
            repoRoot: "/repo",
            isWorktree: false,
            processes: [],
            errors: [],
            instances: [],
        }
        const deferred = createDeferred<OpenADEProjectProcessListResult>()
        let processListRequests = 0
        server.register("openade/project/process/list", () => {
            processListRequests += 1
            return deferred.promise
        })

        const runtime = createLocalRuntimeClient(server)
        const client = new OpenADEClient({ runtime, clientName: "OpenADE Test", clientPlatform: "web" })
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined)

        try {
            const requests = Array.from({ length: 12 }, () => client.listProjectProcesses({ repoId: "repo-1" }))
            await waitUntil(() => processListRequests === 1)

            deferred.resolve(result)
            await expect(Promise.all(requests)).resolves.toEqual(Array.from({ length: 12 }, () => result))

            expect(processListRequests).toBe(1)
            expect(warnSpy.mock.calls.some(([message]) => message === "[OpenADEClient] Runtime request burst")).toBe(false)
        } finally {
            warnSpy.mockRestore()
            await runtime.close()
        }
    })

    it("includes a sanitized local request id in slow request logs", async () => {
        const runtime = new CapturingRuntimeClient()
        const client = new OpenADEClient({ runtime, clientName: "OpenADE Test", clientPlatform: "web" })
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined)
        const nowSpy = vi.spyOn(Date, "now")
        const times = [1_000, 1_000, 1_800]
        nowSpy.mockImplementation(() => times.shift() ?? 1_800)

        try {
            await client.getSnapshot()

            expect(warnSpy).toHaveBeenCalledWith(
                "[OpenADEClient] Slow runtime request",
                expect.objectContaining({
                    method: "openade/snapshot/read",
                    requestId: "openade-client:1",
                    durationMs: 800,
                    failed: false,
                    clientName: "OpenADE Test",
                    clientPlatform: "web",
                })
            )
        } finally {
            nowSpy.mockRestore()
            warnSpy.mockRestore()
        }
    })

    it("includes the latest outbound request id in request burst logs", async () => {
        const runtime = new CapturingRuntimeClient()
        const client = new OpenADEClient({ runtime, clientName: "OpenADE Test", clientPlatform: "web" })
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined)
        const nowSpy = vi.spyOn(Date, "now").mockReturnValue(2_000)

        try {
            for (let index = 0; index < 12; index += 1) {
                await client.createTask({
                    repoId: "repo-1",
                    taskId: `task-${index}`,
                    input: "Create task",
                    createdBy: { id: "user-1", email: "user@example.com" },
                    deviceId: "device-1",
                })
            }

            expect(warnSpy).toHaveBeenCalledWith(
                "[OpenADEClient] Runtime request burst",
                expect.objectContaining({
                    method: "openade/task/create",
                    lastRequestId: "openade-client:12",
                    count: 12,
                    windowMs: 0,
                    clientName: "OpenADE Test",
                    clientPlatform: "web",
                })
            )
        } finally {
            nowSpy.mockRestore()
            warnSpy.mockRestore()
        }
    })
})
