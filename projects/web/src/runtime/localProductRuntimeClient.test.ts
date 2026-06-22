import { afterEach, describe, expect, it, vi } from "vitest"
import type { OpenADECoreRuntimeEndpoint } from "../../../electron/src/preload-api"
import { RuntimeClient } from "../../../runtime-client/src"
import {
    createLocalProductRuntimeClient,
    resolveCoreMigrationRuntimeEndpoint,
    localProductRuntimeClient,
    resolveCoreRuntimeEndpoint,
    resolveCoreRolloutState,
    runtimeClientOptionsForCoreEndpoint,
    selectedLocalProductRuntime,
    selectedLocalProductRuntimeClient,
} from "./localProductRuntimeClient"
import { localRuntimeClient } from "./localRuntimeClient"

function stubOpenADEAPI(openadeAPI: unknown): void {
    Object.defineProperty(window, "openadeAPI", {
        value: openadeAPI,
        configurable: true,
        writable: true,
    })
}

describe("local product runtime client", () => {
    afterEach(() => {
        window.openadeAPI = undefined
        selectedLocalProductRuntime()
        vi.restoreAllMocks()
    })

    it("uses Electron IPC when no Core endpoint is configured", () => {
        const runtime = createLocalProductRuntimeClient(null)

        expect(runtime.source).toBe("electron-ipc")
    })

    it("uses a Core WebSocket runtime when an endpoint is configured", () => {
        const endpoint: OpenADECoreRuntimeEndpoint = {
            url: "ws://127.0.0.1:4567/v1/runtime",
            token: "trusted-token",
        }
        const runtime = createLocalProductRuntimeClient(endpoint)

        expect(runtime.source).toBe("core-websocket")
        expect(runtime.client).toBeInstanceOf(RuntimeClient)
    })

    it("ignores malformed or non-WebSocket Core endpoints from preload", () => {
        stubOpenADEAPI({
            core: {
                runtimeEndpoint: {
                    url: "https://127.0.0.1:4567/v1/runtime",
                    token: "trusted-token",
                },
            },
        })

        expect(resolveCoreRuntimeEndpoint()).toBeNull()
        expect(selectedLocalProductRuntime().source).toBe("electron-ipc")

        stubOpenADEAPI({
            core: {
                runtimeEndpoint: {
                    url: "not a url",
                    token: "trusted-token",
                },
            },
        })

        expect(resolveCoreRuntimeEndpoint()).toBeNull()
        expect(selectedLocalProductRuntime().source).toBe("electron-ipc")
    })

    it("resolves migration Core endpoints without selecting them for normal product calls", () => {
        stubOpenADEAPI({
            core: {
                migrationRuntimeEndpoint: {
                    url: "ws://127.0.0.1:4567/v1/runtime",
                    token: "migration-token",
                },
            },
        })

        expect(resolveCoreRuntimeEndpoint()).toBeNull()
        expect(resolveCoreMigrationRuntimeEndpoint()).toEqual({
            url: "ws://127.0.0.1:4567/v1/runtime",
            token: "migration-token",
        })
        expect(selectedLocalProductRuntime().source).toBe("electron-ipc")
    })

    it("ignores malformed migration Core endpoints", () => {
        stubOpenADEAPI({
            core: {
                migrationRuntimeEndpoint: {
                    url: "file:///tmp/openade-core.sock",
                    token: "migration-token",
                },
            },
        })

        expect(resolveCoreMigrationRuntimeEndpoint()).toBeNull()
    })

    it("late-selects Core endpoints after module initialization", () => {
        expect(selectedLocalProductRuntime().source).toBe("electron-ipc")

        stubOpenADEAPI({
            core: {
                runtimeEndpoint: {
                    url: "ws://127.0.0.1:4567/v1/runtime",
                    token: "trusted-token",
                },
            },
        })

        const runtime = selectedLocalProductRuntime()

        expect(runtime.source).toBe("core-websocket")
        expect(runtime.client).toBeInstanceOf(RuntimeClient)
        expect(selectedLocalProductRuntimeClient()).toBe(runtime.client)
        expect(localProductRuntimeClient.capabilities).toBeNull()
    })

    it("switches Core clients when the selected endpoint changes", () => {
        stubOpenADEAPI({
            core: {
                runtimeEndpoint: {
                    url: "ws://127.0.0.1:4567/v1/runtime",
                    token: "trusted-token",
                },
            },
        })
        const firstRuntime = selectedLocalProductRuntime()

        stubOpenADEAPI({
            core: {
                runtimeEndpoint: {
                    url: "ws://127.0.0.1:4568/v1/runtime",
                    token: "next-token",
                },
            },
        })
        const secondRuntime = selectedLocalProductRuntime()

        expect(firstRuntime.source).toBe("core-websocket")
        expect(secondRuntime.source).toBe("core-websocket")
        expect(secondRuntime.client).toBeInstanceOf(RuntimeClient)
        expect(secondRuntime.client).not.toBe(firstRuntime.client)
        expect(selectedLocalProductRuntimeClient()).toBe(secondRuntime.client)
    })

    it("rebinds notification subscriptions when the selected runtime changes", () => {
        const localUnsubscribe = vi.fn()
        const firstCoreUnsubscribe = vi.fn()
        const secondCoreUnsubscribe = vi.fn()
        const localSubscribe = vi.spyOn(localRuntimeClient, "subscribe").mockReturnValue(localUnsubscribe)
        const coreSubscribe = vi
            .spyOn(RuntimeClient.prototype, "subscribe")
            .mockReturnValueOnce(firstCoreUnsubscribe)
            .mockReturnValueOnce(secondCoreUnsubscribe)

        const unsubscribe = localProductRuntimeClient.subscribe(() => undefined)

        expect(localSubscribe).toHaveBeenCalledTimes(1)

        stubOpenADEAPI({
            core: {
                runtimeEndpoint: {
                    url: "ws://127.0.0.1:4567/v1/runtime",
                    token: "trusted-token",
                },
            },
        })
        expect(selectedLocalProductRuntime().source).toBe("core-websocket")
        expect(localUnsubscribe).toHaveBeenCalledTimes(1)
        expect(coreSubscribe).toHaveBeenCalledTimes(1)

        stubOpenADEAPI({
            core: {
                runtimeEndpoint: {
                    url: "ws://127.0.0.1:4568/v1/runtime",
                    token: "next-token",
                },
            },
        })
        expect(selectedLocalProductRuntime().source).toBe("core-websocket")
        expect(firstCoreUnsubscribe).toHaveBeenCalledTimes(1)
        expect(coreSubscribe).toHaveBeenCalledTimes(2)

        unsubscribe()
        expect(secondCoreUnsubscribe).toHaveBeenCalledTimes(1)
    })

    it("builds desktop runtime client options for Core endpoints", () => {
        expect(
            runtimeClientOptionsForCoreEndpoint({
                url: "ws://127.0.0.1:4567/v1/runtime",
                token: "trusted-token",
            })
        ).toEqual({
            url: "ws://127.0.0.1:4567/v1/runtime",
            token: "trusted-token",
            clientName: "OpenADE Desktop",
            clientPlatform: "desktop",
            protocolVersion: 1,
            reconnect: true,
        })
    })

    it("resolves sanitized Core rollout state from Electron preload", () => {
        stubOpenADEAPI({
            core: {
                rolloutState: {
                    status: "connected",
                    source: "managed",
                    reason: "legacy-yjs-migration-accepted",
                    automatic: true,
                    legacyYjsDocumentsPresent: true,
                    legacyYjsMigrationAccepted: true,
                },
            },
        })

        expect(resolveCoreRolloutState()).toEqual({
            status: "connected",
            source: "managed",
            reason: "legacy-yjs-migration-accepted",
            automatic: true,
            legacyYjsDocumentsPresent: true,
            legacyYjsMigrationAccepted: true,
        })
    })

    it("ignores malformed Core rollout state from Electron preload", () => {
        stubOpenADEAPI({
            core: {
                rolloutState: {
                    status: "connected",
                    source: "managed",
                    reason: "unexpected",
                    automatic: false,
                    legacyYjsDocumentsPresent: false,
                    legacyYjsMigrationAccepted: false,
                },
            },
        })

        expect(resolveCoreRolloutState()).toBeNull()
    })

    it("accepts invalid external Core endpoint rollout state as a sanitized non-Core state", () => {
        stubOpenADEAPI({
            core: {
                rolloutState: {
                    status: "legacy-ipc",
                    source: "legacy-ipc",
                    reason: "invalid-external-endpoint",
                    automatic: false,
                    legacyYjsDocumentsPresent: false,
                    legacyYjsMigrationAccepted: false,
                },
            },
        })

        expect(resolveCoreRolloutState()).toEqual({
            status: "legacy-ipc",
            source: "legacy-ipc",
            reason: "invalid-external-endpoint",
            automatic: false,
            legacyYjsDocumentsPresent: false,
            legacyYjsMigrationAccepted: false,
        })
    })
})
