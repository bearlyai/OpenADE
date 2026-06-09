import { afterEach, describe, expect, it } from "vitest"
import type { OpenADECoreRuntimeEndpoint } from "../../../electron/src/preload-api"
import { RuntimeClient } from "../../../runtime-client/src"
import { createLocalProductRuntimeClient, resolveCoreRolloutState, runtimeClientOptionsForCoreEndpoint } from "./localProductRuntimeClient"

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
})
