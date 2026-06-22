import { describe, expect, it } from "vitest"
import type { RuntimeInitializeResult, RuntimeMessage, RuntimeRequest, RuntimeResponse } from "../../runtime-protocol/src"
import { RuntimeClientError, RuntimeLocalClient, type RuntimeLocalTransport } from "./client"

interface Deferred<T> {
    promise: Promise<T>
    resolve(value: T): void
    reject(error: unknown): void
}

function deferred<T>(): Deferred<T> {
    let resolveValue: (value: T) => void = () => undefined
    let rejectValue: (error: unknown) => void = () => undefined
    const promise = new Promise<T>((resolve, reject) => {
        resolveValue = resolve
        rejectValue = reject
    })
    return { promise, resolve: resolveValue, reject: rejectValue }
}

const initializeResult: RuntimeInitializeResult = {
    protocolVersion: 1,
    serverName: "local-runtime-test",
    capabilities: {
        methods: ["test/one", "test/two"],
        notifications: ["test/changed"],
        agentProviders: [],
    },
}

describe("RuntimeLocalClient", () => {
    it("shares one local transport connection and initialize request across concurrent callers", async () => {
        const connectGate = deferred<void>()
        const requests: RuntimeRequest[] = []
        const listeners = new Set<(message: RuntimeMessage) => void>()
        let connectCalls = 0
        let listenerRegistrations = 0
        const transport: RuntimeLocalTransport = {
            connect() {
                connectCalls += 1
                return connectGate.promise
            },
            disconnect() {
                return undefined
            },
            request(request: RuntimeRequest): RuntimeResponse {
                requests.push(request)
                if (request.method === "initialize") return { id: request.id, result: initializeResult }
                return { id: request.id, result: { method: request.method } }
            },
            onMessage(listener: (message: RuntimeMessage) => void) {
                listenerRegistrations += 1
                listeners.add(listener)
                return () => listeners.delete(listener)
            },
        }
        const client = new RuntimeLocalClient(transport, {
            clientName: "Concurrent Local Client",
            clientPlatform: "desktop",
        })

        const first = client.request<{ method: string }>("test/one")
        const second = client.request<{ method: string }>("test/two")
        await Promise.resolve()

        expect(connectCalls).toBe(1)
        expect(listenerRegistrations).toBe(0)
        expect(requests).toEqual([])

        connectGate.resolve()
        await expect(Promise.all([first, second])).resolves.toEqual([{ method: "test/one" }, { method: "test/two" }])

        expect(connectCalls).toBe(1)
        expect(listenerRegistrations).toBe(1)
        expect(requests.map((request) => request.method)).toEqual(["initialize", "test/one", "test/two"])
        expect(client.capabilities?.methods).toEqual(["test/one", "test/two"])
    })

    it("cleans up a connected local transport when initialize fails before retrying", async () => {
        const requests: RuntimeRequest[] = []
        const listeners = new Set<(message: RuntimeMessage) => void>()
        let connectCalls = 0
        let disconnectCalls = 0
        let initializeAttempts = 0
        let notifications = 0
        const transport: RuntimeLocalTransport = {
            connect() {
                connectCalls += 1
            },
            disconnect() {
                disconnectCalls += 1
            },
            request(request: RuntimeRequest): RuntimeResponse {
                requests.push(request)
                if (request.method === "initialize") {
                    initializeAttempts += 1
                    if (initializeAttempts === 1) {
                        return { id: request.id, error: { code: "initialize_failed", message: "Initialization failed" } }
                    }
                    return { id: request.id, result: initializeResult }
                }
                return { id: request.id, result: { method: request.method } }
            },
            onMessage(listener: (message: RuntimeMessage) => void) {
                listeners.add(listener)
                return () => listeners.delete(listener)
            },
        }
        const client = new RuntimeLocalClient(transport)

        await expect(client.connect()).rejects.toMatchObject(new RuntimeClientError("initialize_failed", "Initialization failed"))

        expect(connectCalls).toBe(1)
        expect(disconnectCalls).toBe(1)
        expect(listeners.size).toBe(0)
        expect(client.capabilities).toBeNull()

        await expect(client.request<{ method: string }>("test/after-retry")).resolves.toEqual({ method: "test/after-retry" })

        expect(connectCalls).toBe(2)
        expect(disconnectCalls).toBe(1)
        expect(listeners.size).toBe(1)
        expect(requests.map((request) => request.method)).toEqual(["initialize", "initialize", "test/after-retry"])

        client.subscribe(() => {
            notifications += 1
        })
        for (const listener of listeners) listener({ method: "test/changed" })
        expect(notifications).toBe(1)
    })
})
