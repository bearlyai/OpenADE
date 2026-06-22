import { describe, expect, it, vi } from "vitest"
import { OPENADE_REMOTE_METHOD, type OpenADEClientOptions } from "../../../openade-client/src"
import type { RuntimeCapabilities, RuntimeNotification } from "../../../runtime-protocol/src"
import type { RuntimeClientOptions } from "../../../runtime-client/src"
import { KernelSessionManager, requestKernelRemoteMethod, runtimeSocketUrl, type KernelSessionConfig } from "./session"

const runtimeClients: RuntimeClient[] = []
const openadeClients: OpenADEClient[] = []

class RuntimeClient {
    readonly capabilities: RuntimeCapabilities = runtimeCapabilities(Object.values(OPENADE_REMOTE_METHOD))
    close = vi.fn()
    connect = vi.fn(async () => undefined)

    constructor(readonly options: RuntimeClientOptions) {
        runtimeClients.push(this)
    }

    hasMethod(method: string): boolean {
        return this.capabilities.methods.includes(method)
    }

    request<T>(): Promise<T> {
        throw new Error("not implemented")
    }

    subscribe(_listener: (notification: RuntimeNotification) => void): () => void {
        return () => undefined
    }
}

class OpenADEClient {
    constructor(readonly options: OpenADEClientOptions) {
        openadeClients.push(this)
    }
}

class GuardedRuntimeClient {
    capabilities: RuntimeCapabilities | null = null
    readonly requests: string[] = []
    readonly connect = vi.fn(async () => {
        this.capabilities = runtimeCapabilities([OPENADE_REMOTE_METHOD.remoteDeviceList])
    })

    async request<T>(method: string): Promise<T> {
        this.requests.push(method)
        return { devices: [] } as T
    }
}

function runtimeCapabilities(methods: string[]): RuntimeCapabilities {
    return { methods, notifications: [], agentProviders: [] }
}

function config(overrides: Partial<KernelSessionConfig> = {}): KernelSessionConfig {
    return {
        id: "host-1",
        baseUrl: "http://100.64.1.2:7823/pair?token=ignored",
        token: "token-1",
        host: "100.64.1.2:7823",
        savedAt: "2026-05-31T00:00:00.000Z",
        lastUsedAt: "2026-05-31T00:00:00.000Z",
        ...overrides,
    }
}

describe("KernelSessionManager", () => {
    it("derives the runtime WebSocket URL from a paired kernel base URL", () => {
        expect(runtimeSocketUrl(config())).toBe("ws://100.64.1.2:7823/v1/runtime")
        expect(runtimeSocketUrl(config({ baseUrl: "https://host.local:7823/pair?token=ignored" }))).toBe("wss://host.local:7823/v1/runtime")
    })

    it("reuses one runtime client per saved session and replaces changed credentials", () => {
        runtimeClients.length = 0
        openadeClients.length = 0
        const manager = new KernelSessionManager<RuntimeClient, OpenADEClient>(
            { RuntimeClient, OpenADEClient },
            { clientName: "test", clientPlatform: "mobile", reconnect: true }
        )

        const first = manager.session(config()).entry
        const second = manager.session(config()).entry
        const changed = manager.session(config({ token: "token-2" })).entry

        expect(second).toBe(first)
        expect(changed).not.toBe(first)
        expect(runtimeClients).toHaveLength(2)
        expect(openadeClients).toHaveLength(2)
        expect(runtimeClients[0].close).toHaveBeenCalledTimes(1)
        expect(runtimeClients[1].options).toMatchObject({
            url: "ws://100.64.1.2:7823/v1/runtime",
            token: "token-2",
            clientName: "test",
            clientPlatform: "mobile",
            reconnect: true,
        })

        manager.clear()
        expect(runtimeClients[1].close).toHaveBeenCalledTimes(1)
    })

    it("fails before sending remote requests for methods missing from initialized capabilities", async () => {
        const runtime = new GuardedRuntimeClient()

        await expect(requestKernelRemoteMethod(runtime, OPENADE_REMOTE_METHOD.remoteDeviceSelfRevoke)).rejects.toThrow(
            `Kernel runtime method unavailable: ${OPENADE_REMOTE_METHOD.remoteDeviceSelfRevoke}`
        )

        expect(runtime.connect).toHaveBeenCalledOnce()
        expect(runtime.requests).toEqual([])
    })

    it("sends remote requests when initialized capabilities advertise the method", async () => {
        const runtime = new GuardedRuntimeClient()

        await expect(requestKernelRemoteMethod(runtime, OPENADE_REMOTE_METHOD.remoteDeviceList)).resolves.toEqual({ devices: [] })

        expect(runtime.connect).toHaveBeenCalledOnce()
        expect(runtime.requests).toEqual([OPENADE_REMOTE_METHOD.remoteDeviceList])
    })
})
