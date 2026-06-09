import { describe, expect, it, vi } from "vitest"
import type { OpenADEProjectProcessListResult } from "../../openade-module/src/types"
import { RuntimeServer, type RuntimeConnection } from "../../runtime/src"
import type { RuntimeMessage, RuntimeRequest } from "../../runtime-protocol/src"
import { RuntimeLocalClient, type RuntimeLocalTransport } from "../../runtime-client/src"
import { OpenADEClient } from "./index"

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

async function waitUntil(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
    const startedAt = Date.now()
    while (!predicate()) {
        if (Date.now() - startedAt > timeoutMs) throw new Error("Timed out waiting for condition")
        await new Promise((resolve) => setTimeout(resolve, 5))
    }
}

describe("OpenADEClient request telemetry", () => {
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
})
