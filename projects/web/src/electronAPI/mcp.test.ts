import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { type RuntimeConnection, RuntimeServer } from "../../../runtime/src"
import { type RuntimeMessage, validateRuntimeRequest } from "../../../runtime-protocol/src"
import { localRuntimeClient } from "../runtime/localRuntimeClient"
import { onMcpOAuthComplete, testMcpConnection, type OnMcpOAuthCompleteCallback } from "./mcp"

type OAuthCompleteResult = Parameters<OnMcpOAuthCompleteCallback>[0]

function installRuntimeBackedOpenADEApi(server: RuntimeServer): () => void {
    const previous = window.openadeAPI
    const listeners = new Set<(message: unknown) => void>()
    let disposeConnection: (() => void) | null = null
    const connection: RuntimeConnection = {
        id: "mcp-runtime-test",
        send(message: RuntimeMessage) {
            for (const listener of listeners) listener(message)
        },
    }
    const noopUnsubscribe = () => undefined

    window.openadeAPI = {
        app: {
            activeWorkUnloadBlockerDisabled: true,
            quit: async () => undefined,
            openUrl: async () => undefined,
            applyUpdate: async () => undefined,
            forceEnableDevTools: async () => undefined,
            isWindowedWithFrame: async () => false,
            setTerminalKeyboardCapture: async () => undefined,
            onUpdateAvailable: () => noopUnsubscribe,
            onUpdateError: () => noopUnsubscribe,
            onFocusInputShortcut: () => noopUnsubscribe,
            retryUpdateCheck: async () => undefined,
        },
        window: {
            isPinned: async () => false,
            isAutoHide: async () => false,
            action: async () => undefined,
            frameEnabled: async () => true,
            setFrameColors: async () => undefined,
            findInPage: async () => null,
        },
        settings: {
            getDeviceConfig: async () => null,
            setDeviceId: async () => null,
            setTelemetryDisabled: async () => undefined,
        },
        shell: {
            selectDirectory: async () => ({ canceled: true }),
            openUrl: async () => undefined,
            openPath: async () => undefined,
        },
        codeWindowFrame: {
            enabled: async () => true,
            setColors: async () => undefined,
        },
        notifications: {
            getState: async () => null,
            shouldShow: async () => false,
        },
        companion: {
            getState: async () => null,
            setEnabled: async () => null,
            setKeepAwakeMode: async () => null,
            startPairing: async () => null,
        },
        runtime: {
            connect: async () => {
                disposeConnection?.()
                disposeConnection = server.connect(connection)
                return null
            },
            disconnect: async () => {
                disposeConnection?.()
                disposeConnection = null
                return null
            },
            request: async (rawRequest: unknown) => {
                const request = validateRuntimeRequest(rawRequest)
                if (!request.ok) throw new Error(request.error.message)
                return server.handleRequest(request.value, connection, { requireInitialized: true })
            },
            onMessage: (cb: (message: unknown) => void) => {
                listeners.add(cb)
                return () => listeners.delete(cb)
            },
        },
    }

    return () => {
        disposeConnection?.()
        disposeConnection = null
        window.openadeAPI = previous
    }
}

async function waitForResult(results: OAuthCompleteResult[], count: number): Promise<void> {
    for (let attempt = 0; attempt < 50; attempt++) {
        if (results.length >= count) return
        await new Promise((resolve) => window.setTimeout(resolve, 10))
    }
    throw new Error(`Timed out waiting for ${count} OAuth completion result(s)`)
}

describe("MCP Electron API runtime bridge", () => {
    let cleanupOpenADEApi: (() => void) | null = null

    beforeEach(async () => {
        await localRuntimeClient.close()
    })

    afterEach(async () => {
        await localRuntimeClient.close()
        cleanupOpenADEApi?.()
        cleanupOpenADEApi = null
    })

    it("subscribes to OAuth completion through the trusted local runtime bridge", async () => {
        const server = new RuntimeServer({ serverName: "mcp-wrapper-test" })
        server.registerNotification("host/mcp/oauthComplete")
        server.register("host/mcp/testConnection", () => ({ success: true }))
        cleanupOpenADEApi = installRuntimeBackedOpenADEApi(server)

        const results: OAuthCompleteResult[] = []
        const unsubscribe = onMcpOAuthComplete((result) => {
            results.push(result)
        })

        await expect(testMcpConnection({ type: "stdio", command: "echo" })).resolves.toEqual({ success: true })

        server.notify("host/mcp/oauthComplete", {
            serverId: "mcp-private",
            tokens: {
                accessToken: "access-token",
                refreshToken: "refresh-token",
                tokenType: "Bearer",
                expiresAt: "2026-06-01T01:00:00.000Z",
            },
        })
        server.notify("host/mcp/oauthComplete", {
            serverId: "invalid-mcp",
            tokens: {
                accessToken: 123,
                tokenType: "Bearer",
            },
        })
        server.notify("host/mcp/oauthComplete", {
            serverId: "mcp-error",
            error: "OAuth flow failed",
        })

        await waitForResult(results, 2)
        expect(results).toEqual([
            {
                serverId: "mcp-private",
                tokens: {
                    accessToken: "access-token",
                    refreshToken: "refresh-token",
                    tokenType: "Bearer",
                    expiresAt: "2026-06-01T01:00:00.000Z",
                },
            },
            {
                serverId: "mcp-error",
                error: "OAuth flow failed",
            },
        ])

        unsubscribe()
    })
})
