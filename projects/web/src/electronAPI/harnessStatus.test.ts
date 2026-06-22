import { afterEach, describe, expect, it, vi } from "vitest"
import type { RuntimeClientLike } from "../../../openade-client/src"
import type { RuntimeCapabilities, RuntimeNotification } from "../../../runtime-protocol/src"
import { localRuntimeClient } from "../runtime/localRuntimeClient"
import { getHarnessStatuses, isHarnessStatusApiAvailable, normalizeHarnessStatuses } from "./harnessStatus"

type TestWindow = {
    openadeAPI?: Window["openadeAPI"]
}

const testGlobal = globalThis as unknown as {
    window?: TestWindow
}
if (!testGlobal.window) {
    testGlobal.window = {}
}
const testWindow = testGlobal.window
const originalOpenadeApi = testWindow.openadeAPI

class TestRuntimeClient implements RuntimeClientLike {
    connectCount = 0
    requestMethods: string[] = []

    constructor(
        private readonly advertisedMethods: string[],
        private readonly response: unknown
    ) {}

    get capabilities(): RuntimeCapabilities {
        return {
            methods: this.advertisedMethods,
            notifications: [],
            agentProviders: [],
        }
    }

    connect(): void {
        this.connectCount += 1
    }

    request<T>(method: string): Promise<T> {
        this.requestMethods.push(method)
        return Promise.resolve(this.response as T)
    }

    hasMethod(method: string): boolean {
        return this.advertisedMethods.includes(method)
    }

    subscribe(_listener: (notification: RuntimeNotification) => void): () => void {
        return () => {}
    }

    close(): void {}
}

afterEach(async () => {
    await localRuntimeClient.close()
    testWindow.openadeAPI = originalOpenadeApi
    vi.restoreAllMocks()
})

describe("normalizeHarnessStatuses", () => {
    it("keeps valid harness statuses and drops malformed entries", () => {
        const result = normalizeHarnessStatuses({
            "claude-code": {
                installed: true,
                version: "1.2.3",
                authType: "account",
                authenticated: true,
            },
            codex: {
                installed: true,
                authType: "account",
                authenticated: false,
                authInstructions: "Run `codex login`",
            },
            brokenString: "invalid",
            brokenShape: {
                installed: "yes",
                authType: "account",
                authenticated: true,
            },
        })

        expect(result).toEqual({
            "claude-code": {
                installed: true,
                version: "1.2.3",
                authType: "account",
                authenticated: true,
            },
            codex: {
                installed: true,
                authType: "account",
                authenticated: false,
                authInstructions: "Run `codex login`",
            },
        })
    })
})

describe("getHarnessStatuses", () => {
    it("returns a friendly error when Electron API is unavailable", async () => {
        testWindow.openadeAPI = undefined

        const result = await getHarnessStatuses()

        expect(result.statuses).toEqual({})
        expect(result.error).toBe("Harness status is only available in Electron.")
    })

    it("loads and normalizes harness status payloads", async () => {
        const request = vi.fn(async (runtimeRequest: { id: number; method: string }) => {
            if (runtimeRequest.method === "initialize") return { id: runtimeRequest.id, result: {} }
            return {
                id: runtimeRequest.id,
                result: {
                    "claude-code": {
                        installed: true,
                        version: "1.0.0",
                        authType: "account",
                        authenticated: true,
                    },
                    invalid: 123,
                },
            }
        })

        testWindow.openadeAPI = {
            runtime: {
                connect: vi.fn().mockResolvedValue({ ok: true }),
                disconnect: vi.fn().mockResolvedValue({ ok: true }),
                request,
                onMessage: vi.fn(() => () => {}),
            },
        } as unknown as NonNullable<Window["openadeAPI"]>

        const result = await getHarnessStatuses()
        const statusRequests = request.mock.calls.filter(([runtimeRequest]) => runtimeRequest.method === "agent/provider/status")

        expect(statusRequests).toHaveLength(1)
        expect(result.error).toBeNull()
        expect(result.statuses).toEqual({
            "claude-code": {
                installed: true,
                version: "1.0.0",
                authType: "account",
                authenticated: true,
            },
        })
    })

    it("surfaces invalid response payload errors", async () => {
        const request = vi.fn().mockResolvedValue({ id: 1, result: "invalid-response" })

        testWindow.openadeAPI = {
            runtime: {
                connect: vi.fn().mockResolvedValue({ ok: true }),
                disconnect: vi.fn().mockResolvedValue({ ok: true }),
                request,
                onMessage: vi.fn(() => () => {}),
            },
        } as unknown as NonNullable<Window["openadeAPI"]>

        const result = await getHarnessStatuses()

        expect(result.statuses).toEqual({})
        expect(result.error).toBe("Received an invalid harness status response.")
    })

    it("does not fall back to Electron local runtime when Core does not advertise harness status", async () => {
        const localRequest = vi.fn(async (runtimeRequest: { id: number; method: string }) => {
            if (runtimeRequest.method === "initialize") return { id: runtimeRequest.id, result: {} }
            throw new Error(`Unexpected local runtime request: ${runtimeRequest.method}`)
        })
        testWindow.openadeAPI = {
            core: {
                runtimeEndpoint: {
                    url: "ws://127.0.0.1:4567/v1/runtime",
                    token: "core-token",
                },
            },
            runtime: {
                connect: vi.fn().mockResolvedValue({ ok: true }),
                disconnect: vi.fn().mockResolvedValue({ ok: true }),
                request: localRequest,
                onMessage: vi.fn(() => () => {}),
            },
        } as unknown as NonNullable<Window["openadeAPI"]>
        const coreRuntime = new TestRuntimeClient(["openade/project/read"], {})

        const result = await getHarnessStatuses(coreRuntime)

        expect(result.statuses).toEqual({})
        expect(result.error).toBe("Harness status is not advertised by the selected runtime.")
        expect(coreRuntime.connectCount).toBe(1)
        expect(coreRuntime.requestMethods).toEqual([])
        expect(localRequest).not.toHaveBeenCalled()
    })

    it("does not use Electron local runtime while Core owns product runtime but is not attached", async () => {
        const localRuntimeRequest = vi.spyOn(localRuntimeClient, "request")
        testWindow.openadeAPI = {
            core: {
                rolloutState: {
                    status: "connected",
                    source: "managed",
                    reason: "managed-core",
                    automatic: true,
                    legacyYjsDocumentsPresent: false,
                    legacyYjsMigrationAccepted: false,
                },
            },
            runtime: {
                connect: vi.fn().mockResolvedValue({ ok: true }),
                disconnect: vi.fn().mockResolvedValue({ ok: true }),
                request: vi.fn().mockResolvedValue({
                    id: 1,
                    result: {
                        "claude-code": {
                            installed: true,
                            authType: "account",
                            authenticated: true,
                        },
                    },
                }),
                onMessage: vi.fn(() => () => {}),
            },
        } as unknown as NonNullable<Window["openadeAPI"]>

        const result = await getHarnessStatuses()

        expect(isHarnessStatusApiAvailable()).toBe(false)
        expect(result.statuses).toEqual({})
        expect(result.error).toBe("Harness status is unavailable until OpenADE Core is connected.")
        expect(localRuntimeRequest).not.toHaveBeenCalled()
        expect(testWindow.openadeAPI.runtime?.request).not.toHaveBeenCalled()
    })

    it("reads harness statuses from the selected Core runtime when advertised", async () => {
        testWindow.openadeAPI = {
            core: {
                runtimeEndpoint: {
                    url: "ws://127.0.0.1:4567/v1/runtime",
                    token: "core-token",
                },
            },
        } as unknown as NonNullable<Window["openadeAPI"]>
        const coreRuntime = new TestRuntimeClient(["agent/provider/status"], {
            status: {
                codex: {
                    installed: true,
                    version: "2.0.0",
                    authType: "account",
                    authenticated: true,
                },
            },
        })

        const result = await getHarnessStatuses(coreRuntime)

        expect(result.error).toBeNull()
        expect(result.statuses).toEqual({
            codex: {
                installed: true,
                version: "2.0.0",
                authType: "account",
                authenticated: true,
            },
        })
        expect(coreRuntime.connectCount).toBe(1)
        expect(coreRuntime.requestMethods).toEqual(["agent/provider/status"])
    })
})
