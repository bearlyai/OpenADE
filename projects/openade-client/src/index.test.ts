import { describe, expect, it, vi } from "vitest"
import type { OpenADEProjectProcessListResult } from "../../openade-module/src/types"
import { RuntimeServer, type RuntimeConnection, type RuntimeSlowRequestEvent } from "../../runtime/src"
import type { RuntimeCapabilities, RuntimeMessage, RuntimeNotification, RuntimeRequest } from "../../runtime-protocol/src"
import { RuntimeLocalClient, type RuntimeLocalTransport } from "../../runtime-client/src"
import type { OpenADEMethod, OpenADERequestForMethod, OpenADEResponseForMethod } from "./generated/openade-contracts"
import { OPENADE_METHOD, OPENADE_NOTIFICATION, OpenADEClient, type RuntimeClientLike } from "./index"

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

function createLocalRuntimeClient(server: RuntimeServer, permissions?: string[]): RuntimeLocalClient {
    const listeners = new Set<(message: RuntimeMessage) => void>()
    let dispose: (() => void) | null = null
    const connection: RuntimeConnection = {
        id: "openade-client-test",
        ...(permissions ? { permissions } : {}),
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
    readonly capabilities: RuntimeCapabilities = {
        methods: [...Object.values(OPENADE_METHOD), "runtime/list"],
        notifications: Object.values(OPENADE_NOTIFICATION),
        agentProviders: [],
    }
    private readonly listeners = new Set<(notification: RuntimeNotification) => void>()

    connect(): void {}

    hasMethod(method: string): boolean {
        return this.capabilities.methods.includes(method)
    }

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

    subscribe(listener: (notification: RuntimeNotification) => void): () => void {
        this.listeners.add(listener)
        return () => this.listeners.delete(listener)
    }

    emit(notification: RuntimeNotification): void {
        for (const listener of this.listeners) listener(notification)
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
    it("filters subscribed product notifications through the generated notification contract", () => {
        const runtime = new CapturingRuntimeClient()
        const client = new OpenADEClient({ runtime, clientName: "OpenADE Test", clientPlatform: "web" })
        const notifications: RuntimeNotification[] = []
        const unsubscribe = client.subscribeToChanges((notification) => notifications.push(notification))

        try {
            runtime.emit({ method: OPENADE_NOTIFICATION.taskUpdated, params: { taskId: "task-1" } })
            runtime.emit({ method: OPENADE_NOTIFICATION.remoteDeviceChanged })
            runtime.emit({ method: "runtime/updated", params: { id: "runtime-1" } })
            runtime.emit({ method: "connection/lagged" })
            runtime.emit({ method: "openade/not-in-contract" })
            runtime.emit({ method: "remote/not-in-contract" })

            expect(notifications.map((notification) => notification.method)).toEqual([
                OPENADE_NOTIFICATION.taskUpdated,
                OPENADE_NOTIFICATION.remoteDeviceChanged,
                "runtime/updated",
                "connection/lagged",
            ])
        } finally {
            unsubscribe()
        }
    })

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

    it("defaults task reads to the lightweight history shape", async () => {
        const runtime = new CapturingRuntimeClient()
        const client = new OpenADEClient({ runtime, clientName: "OpenADE Test", clientPlatform: "web" })

        await client.getTask("repo-1", "task-1")

        expect(runtime.calls).toEqual([
            {
                method: OPENADE_METHOD.taskRead,
                hasParams: true,
                params: {
                    repoId: "repo-1",
                    taskId: "task-1",
                    hydrateSessionEvents: false,
                },
            },
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
            await client.listProjectProcesses({ repoId: "repo-1", taskId: "task-1" })

            expect(warnSpy).toHaveBeenCalledWith(
                "[OpenADEClient] Slow runtime request",
                expect.objectContaining({
                    method: OPENADE_METHOD.projectProcessList,
                    requestId: "openade-client:1",
                    durationMs: 800,
                    clientObservedDurationMs: 800,
                    methodInFlight: 1,
                    totalInFlight: 1,
                    serverTiming: "correlate with runtime slow logs by requestId for queueWaitMs and handlerMs",
                    failed: false,
                    clientName: "OpenADE Test",
                    clientPlatform: "web",
                    scope: {
                        repoId: "repo-1",
                        taskId: "task-1",
                    },
                })
            )
        } finally {
            nowSpy.mockRestore()
            warnSpy.mockRestore()
        }
    })

    it("includes a sanitized local request id in slow raw runtime request logs", async () => {
        const runtime = new CapturingRuntimeClient()
        const client = new OpenADEClient({ runtime, clientName: "OpenADE Test", clientPlatform: "web" })
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined)
        const nowSpy = vi.spyOn(Date, "now")
        const times = [1_000, 1_000, 1_800]
        nowSpy.mockImplementation(() => times.shift() ?? 1_800)

        try {
            await client.listRuntimes({ ownerType: "openade-task" })

            expect(warnSpy).toHaveBeenCalledWith(
                "[OpenADEClient] Slow runtime request",
                expect.objectContaining({
                    method: "runtime/list",
                    requestId: "openade-client:1",
                    durationMs: 800,
                    clientObservedDurationMs: 800,
                    methodInFlight: 1,
                    totalInFlight: 1,
                    serverTiming: "correlate with runtime slow logs by requestId for queueWaitMs and handlerMs",
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

    it("uses the same sanitized request id for client telemetry and runtime server slow events", async () => {
        const events: RuntimeSlowRequestEvent[] = []
        const server = new RuntimeServer({
            serverName: "openade-client-correlation-test",
            protocolVersion: 1,
            slowRequestThresholdMs: 0,
            onSlowRequest: (event) => events.push(event),
        })
        server.register("openade/snapshot/read", () => ({
            server: { version: "test" },
            repos: [],
            workingTaskIds: [],
        }))
        const runtime = createLocalRuntimeClient(server)
        const client = new OpenADEClient({ runtime, clientName: "OpenADE Test", clientPlatform: "web" })

        try {
            await client.getSnapshot()

            expect(events).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        method: "openade/snapshot/read",
                        requestId: "openade-client:1",
                    }),
                ])
            )
        } finally {
            await runtime.close()
        }
    })

    it("uses the same sanitized request id for raw runtime client telemetry and runtime server slow events", async () => {
        const events: RuntimeSlowRequestEvent[] = []
        const server = new RuntimeServer({
            serverName: "openade-client-runtime-correlation-test",
            protocolVersion: 1,
            slowRequestThresholdMs: 0,
            onSlowRequest: (event) => events.push(event),
        })
        const runtime = createLocalRuntimeClient(server)
        const client = new OpenADEClient({ runtime, clientName: "OpenADE Test", clientPlatform: "web" })

        try {
            await client.listRuntimes({ ownerType: "openade-task" })

            expect(events).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        method: "runtime/list",
                        requestId: "openade-client:1",
                    }),
                ])
            )
        } finally {
            await runtime.close()
        }
    })

    it("fails before sending typed requests for methods missing from initialized runtime capabilities", async () => {
        const server = new RuntimeServer({ serverName: "openade-client-capabilities-test", protocolVersion: 1 })
        server.register(OPENADE_METHOD.snapshotRead, () => ({
            server: { version: "test" },
            repos: [],
            workingTaskIds: [],
        }))
        const runtime = createLocalRuntimeClient(server, ["initialize", OPENADE_METHOD.snapshotRead])
        const requestSpy = vi.spyOn(runtime, "requestWithOptions")
        const client = new OpenADEClient({ runtime, clientName: "OpenADE Test", clientPlatform: "web" })

        try {
            await expect(client.updateTaskMetadata({ taskId: "task-1", title: "Denied title" })).rejects.toThrow(
                `OpenADE runtime method unavailable: ${OPENADE_METHOD.taskMetadataUpdate}`
            )

            expect(runtime.capabilities?.methods).toContain(OPENADE_METHOD.snapshotRead)
            expect(runtime.capabilities?.methods).not.toContain(OPENADE_METHOD.taskMetadataUpdate)
            expect(requestSpy).not.toHaveBeenCalled()
        } finally {
            requestSpy.mockRestore()
            await runtime.close()
        }
    })

    it("fails before sending raw runtime requests for methods missing from initialized runtime capabilities", async () => {
        const server = new RuntimeServer({ serverName: "openade-client-runtime-capabilities-test", protocolVersion: 1 })
        const runtime = createLocalRuntimeClient(server, ["initialize"])
        const requestSpy = vi.spyOn(runtime, "requestWithOptions")
        const client = new OpenADEClient({ runtime, clientName: "OpenADE Test", clientPlatform: "web" })

        try {
            await expect(client.listRuntimes({ ownerType: "openade-task" })).rejects.toThrow("OpenADE runtime method unavailable: runtime/list")

            expect(runtime.capabilities?.methods).not.toContain("runtime/list")
            expect(requestSpy).not.toHaveBeenCalled()
        } finally {
            requestSpy.mockRestore()
            await runtime.close()
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
                    methodInFlight: 1,
                    totalInFlight: 1,
                    clientName: "OpenADE Test",
                    clientPlatform: "web",
                })
            )
        } finally {
            nowSpy.mockRestore()
            warnSpy.mockRestore()
        }
    })

    it("does not carry burst counters across client instances", async () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined)
        const nowSpy = vi.spyOn(Date, "now").mockReturnValue(2_000)

        try {
            const firstClient = new OpenADEClient({
                runtime: new CapturingRuntimeClient(),
                clientName: "OpenADE First Test",
                clientPlatform: "web",
            })
            for (let index = 0; index < 11; index += 1) {
                await firstClient.createTask({
                    repoId: "repo-1",
                    taskId: `first-task-${index}`,
                    input: "Create task",
                    createdBy: { id: "user-1", email: "user@example.com" },
                    deviceId: "device-1",
                })
            }

            const secondClient = new OpenADEClient({
                runtime: new CapturingRuntimeClient(),
                clientName: "OpenADE Second Test",
                clientPlatform: "web",
            })
            await secondClient.createTask({
                repoId: "repo-1",
                taskId: "second-task",
                input: "Create task",
                createdBy: { id: "user-1", email: "user@example.com" },
                deviceId: "device-1",
            })

            expect(warnSpy.mock.calls.some(([message]) => message === "[OpenADEClient] Runtime request burst")).toBe(false)
        } finally {
            nowSpy.mockRestore()
            warnSpy.mockRestore()
        }
    })
})
