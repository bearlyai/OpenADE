import { observable } from "mobx"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { OPENADE_METHOD } from "../../../../openade-client/src"
import { buildMcpServerConfigs, initiateMcpOAuth, isMcpApiAvailable, refreshMcpOAuthToken, testMcpConnection } from "../../electronAPI/mcp"
import type { McpHttpServerItem, McpServerItem, McpServerStore } from "../../persistence/mcpServerStore"
import type { YArrayHandle } from "../../persistence/storage"
import type { CodeStore } from "../store"
import { McpServerManager } from "./McpServerManager"

vi.mock("../../electronAPI/mcp", () => ({
    buildMcpServerConfigs: vi.fn(() => ({})),
    cancelMcpOAuth: vi.fn(async () => ({ success: true })),
    initiateMcpOAuth: vi.fn(async () => ({ success: true })),
    isMcpApiAvailable: vi.fn(() => false),
    onMcpOAuthComplete: vi.fn(() => () => {}),
    refreshMcpOAuthToken: vi.fn(async () => ({
        success: true,
        tokens: {
            accessToken: "refreshed-token",
            refreshToken: "refresh-token",
            tokenType: "Bearer",
            expiresAt: "2026-06-12T13:00:00.000Z",
        },
    })),
    testMcpConnection: vi.fn(async () => ({ success: true })),
}))

function server(id: string): McpServerItem {
    return {
        id,
        name: id,
        transportType: "stdio",
        enabled: true,
        command: "echo",
        healthStatus: "unknown",
        createdAt: "2026-06-12T00:00:00.000Z",
        updatedAt: "2026-06-12T00:00:00.000Z",
    }
}

function httpServerWithExpiringTokens(id: string): McpHttpServerItem {
    return {
        id,
        name: id,
        transportType: "http",
        enabled: true,
        url: "https://example.test/mcp",
        oauthTokens: {
            accessToken: "access-token",
            refreshToken: "refresh-token",
            clientId: "registered-client",
            tokenType: "Bearer",
            expiresAt: "2026-06-12T12:00:00.000Z",
        },
        healthStatus: "unknown",
        createdAt: "2026-06-12T00:00:00.000Z",
        updatedAt: "2026-06-12T00:00:00.000Z",
    }
}

function createMcpServerStore(initialServers: McpServerItem[]): McpServerStore {
    const ids = observable.array(
        initialServers.map((item) => item.id),
        { deep: false }
    )
    const items = observable.map<string, McpServerItem>(
        initialServers.map((item) => [item.id, item]),
        { deep: false }
    )
    const servers: Pick<YArrayHandle<McpServerItem>, "ids" | "items" | "all" | "get" | "push" | "delete" | "update" | "clear"> = {
        ids: ids as unknown as string[],
        items,
        all: () => ids.map((id) => items.get(id)).filter((item): item is McpServerItem => item !== undefined),
        get: (id) => items.get(id),
        push: (item) => {
            if (!items.has(item.id)) ids.push(item.id)
            items.set(item.id, item)
        },
        delete: (id) => {
            items.delete(id)
            const index = ids.indexOf(id)
            if (index >= 0) ids.splice(index, 1)
        },
        update: (id, recipe) => {
            const current = items.get(id)
            if (!current) return
            const draft = { ...current }
            recipe(draft)
            items.set(id, draft)
        },
        clear: () => {
            items.clear()
            ids.clear()
        },
    }
    return { servers: servers as unknown as YArrayHandle<McpServerItem> }
}

function createStore({
    useRuntimeProductAPI,
    usesCoreOwnedProductRuntime = false,
    canUseProductMethod = () => true,
    initialServers = [server("mcp-1")],
    productServers = [],
}: {
    useRuntimeProductAPI: boolean
    usesCoreOwnedProductRuntime?: boolean
    canUseProductMethod?: (method: string) => boolean
    initialServers?: McpServerItem[]
    productServers?: McpServerItem[]
}): CodeStore {
    let runtimeProductAPIAvailable = useRuntimeProductAPI
    const canUseProductMethodAfterConnect = vi.fn(async (method: string) => {
        if (!canUseProductMethod(method)) return false
        runtimeProductAPIAvailable = true
        return true
    })
    return {
        mcpServerStore: createMcpServerStore(initialServers),
        shouldUseRuntimeProductAPI: vi.fn(() => runtimeProductAPIAvailable),
        usesCoreOwnedProductRuntime: vi.fn(() => usesCoreOwnedProductRuntime),
        ensureRuntimeMcpServerProjectionStore: vi.fn(async () => undefined),
        canUseProductMethod: vi.fn((method: string) => {
            if (usesCoreOwnedProductRuntime && !runtimeProductAPIAvailable) return false
            if (!runtimeProductAPIAvailable) return true
            return canUseProductMethod(method)
        }),
        canUseProductMethodAfterConnect,
        readProductMcpServers: vi.fn(async () => ({ servers: productServers })),
        replaceProductMcpServers: vi.fn(async (params) => ({ servers: params.servers, replacedServers: params.servers.length })),
        upsertProductMcpServer: vi.fn(async (params) => ({ server: params.server, created: false })),
        deleteProductMcpServer: vi.fn(async (params) => ({ serverId: params.serverId, deleted: true })),
    } as unknown as CodeStore
}

describe("McpServerManager runtime capabilities", () => {
    beforeEach(() => {
        vi.useRealTimers()
        vi.clearAllMocks()
        vi.mocked(isMcpApiAvailable).mockReturnValue(false)
        vi.mocked(initiateMcpOAuth).mockResolvedValue({ success: true })
        vi.mocked(refreshMcpOAuthToken).mockResolvedValue({
            success: true,
            tokens: {
                accessToken: "refreshed-token",
                refreshToken: "refresh-token",
                tokenType: "Bearer",
                expiresAt: "2026-06-12T13:00:00.000Z",
            },
        })
    })

    afterEach(() => {
        vi.useRealTimers()
        vi.clearAllMocks()
    })

    it("does not mutate product-backed connector settings when MCP settings mutations are unavailable", async () => {
        const store = createStore({
            useRuntimeProductAPI: true,
            canUseProductMethod: (method) =>
                method !== OPENADE_METHOD.settingsMcpServersRead &&
                method !== OPENADE_METHOD.settingsMcpServersReplace &&
                method !== OPENADE_METHOD.settingsMcpServersUpsert &&
                method !== OPENADE_METHOD.settingsMcpServersDelete,
        })
        const manager = new McpServerManager(store)

        try {
            await manager.initializeProductSettingsProjection()
            await expect(manager.addHttpServer({ name: "HTTP", url: "https://example.test/mcp" })).resolves.toBeNull()
            await expect(manager.addStdioServer({ name: "Local", command: "node" })).resolves.toBeNull()
            await manager.updateServer("mcp-1", { name: "Renamed" })
            await manager.deleteServer("mcp-1")

            expect(manager.servers).toEqual([expect.objectContaining({ id: "mcp-1", name: "mcp-1" })])
            expect(store.readProductMcpServers).not.toHaveBeenCalled()
            expect(store.replaceProductMcpServers).not.toHaveBeenCalled()
            expect(store.upsertProductMcpServer).not.toHaveBeenCalled()
            expect(store.deleteProductMcpServer).not.toHaveBeenCalled()
        } finally {
            manager.dispose()
        }
    })

    it("does not import local connector settings into the product store without replace capability", async () => {
        const store = createStore({
            useRuntimeProductAPI: true,
            canUseProductMethod: (method) => method === OPENADE_METHOD.settingsMcpServersRead,
            initialServers: [server("legacy-mcp")],
            productServers: [],
        })
        const manager = new McpServerManager(store)

        try {
            await manager.initializeProductSettingsProjection()

            expect(store.readProductMcpServers).toHaveBeenCalledOnce()
            expect(store.replaceProductMcpServers).not.toHaveBeenCalled()
            expect(manager.servers).toEqual([])
        } finally {
            manager.dispose()
        }
    })

    it("attaches Core connector settings before product projection initialization", async () => {
        const store = createStore({
            useRuntimeProductAPI: false,
            usesCoreOwnedProductRuntime: true,
            initialServers: [server("local-mcp")],
            productServers: [server("core-mcp")],
        })
        const manager = new McpServerManager(store)

        try {
            await manager.initializeProductSettingsProjection()

            expect(store.canUseProductMethodAfterConnect).toHaveBeenCalledWith(OPENADE_METHOD.settingsMcpServersRead)
            expect(store.readProductMcpServers).toHaveBeenCalledOnce()
            expect(store.replaceProductMcpServers).not.toHaveBeenCalled()
            expect(manager.servers).toEqual([expect.objectContaining({ id: "core-mcp" })])
        } finally {
            manager.dispose()
        }
    })

    it("keeps legacy connector settings mutations available outside runtime product mode", async () => {
        const store = createStore({
            useRuntimeProductAPI: false,
            canUseProductMethod: () => false,
            initialServers: [server("mcp-1")],
        })
        const manager = new McpServerManager(store)

        try {
            await manager.updateServer("mcp-1", { name: "Renamed" })
            const createdId = await manager.addStdioServer({ name: "Local", command: "node" })
            await manager.deleteServer("mcp-1")

            expect(manager.servers).toEqual([expect.objectContaining({ id: createdId, name: "Local" })])
            expect(store.upsertProductMcpServer).not.toHaveBeenCalled()
            expect(store.deleteProductMcpServer).not.toHaveBeenCalled()
        } finally {
            manager.dispose()
        }
    })

    it("does not run background OAuth refresh from local connector state when product settings are read-only", async () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date("2026-06-12T12:01:00.000Z"))
        vi.mocked(isMcpApiAvailable).mockReturnValue(true)
        const store = createStore({
            useRuntimeProductAPI: true,
            canUseProductMethod: (method) => method === OPENADE_METHOD.settingsMcpServersRead,
            initialServers: [httpServerWithExpiringTokens("mcp-http")],
        })
        const manager = new McpServerManager(store)

        try {
            await vi.advanceTimersByTimeAsync(5000)

            expect(refreshMcpOAuthToken).not.toHaveBeenCalled()
            expect(store.upsertProductMcpServer).not.toHaveBeenCalled()
        } finally {
            manager.dispose()
        }
    })

    it("does not run renderer background OAuth refresh when product settings are runtime-owned", async () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date("2026-06-12T12:01:00.000Z"))
        vi.mocked(isMcpApiAvailable).mockReturnValue(true)
        const store = createStore({
            useRuntimeProductAPI: true,
            initialServers: [httpServerWithExpiringTokens("mcp-http")],
        })
        const manager = new McpServerManager(store)

        try {
            await vi.advanceTimersByTimeAsync(5000)

            expect(refreshMcpOAuthToken).not.toHaveBeenCalled()
            expect(store.upsertProductMcpServer).not.toHaveBeenCalled()
        } finally {
            manager.dispose()
        }
    })

    it("does not run renderer background OAuth refresh when Core owns product settings", async () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date("2026-06-12T12:01:00.000Z"))
        vi.mocked(isMcpApiAvailable).mockReturnValue(true)
        const store = createStore({
            useRuntimeProductAPI: true,
            usesCoreOwnedProductRuntime: true,
            initialServers: [httpServerWithExpiringTokens("mcp-http")],
        })
        const manager = new McpServerManager(store)

        try {
            await vi.advanceTimersByTimeAsync(5000)

            expect(refreshMcpOAuthToken).not.toHaveBeenCalled()
            expect(store.upsertProductMcpServer).not.toHaveBeenCalled()
        } finally {
            manager.dispose()
        }
    })

    it("attaches Core connector settings before explicit mutations", async () => {
        vi.mocked(isMcpApiAvailable).mockReturnValue(true)
        const store = createStore({
            useRuntimeProductAPI: false,
            usesCoreOwnedProductRuntime: true,
            initialServers: [httpServerWithExpiringTokens("mcp-http")],
        })
        const manager = new McpServerManager(store)

        try {
            await manager.updateServer("mcp-http", { name: "Renamed" })
            await manager.deleteServer("mcp-http")
            const createdId = await manager.addStdioServer({ name: "Local", command: "node" })
            const startedOAuth = await manager.initiateOAuth("mcp-http")

            expect(createdId).toEqual(expect.any(String))
            expect(startedOAuth).toBe(false)
            expect(manager.servers).toEqual([expect.objectContaining({ id: createdId, name: "Local" })])
            expect(store.canUseProductMethodAfterConnect).toHaveBeenCalledWith(OPENADE_METHOD.settingsMcpServersUpsert)
            expect(initiateMcpOAuth).not.toHaveBeenCalled()
            expect(store.upsertProductMcpServer).toHaveBeenCalledWith({
                server: expect.objectContaining({ id: "mcp-http", name: "Renamed" }),
            })
            expect(store.upsertProductMcpServer).toHaveBeenCalledWith({
                server: expect.objectContaining({ id: createdId, name: "Local" }),
            })
            expect(store.deleteProductMcpServer).toHaveBeenCalledWith({ serverId: "mcp-http" })
        } finally {
            manager.dispose()
        }
    })

    it("attaches Core connector settings before explicit OAuth and health actions", async () => {
        vi.mocked(isMcpApiAvailable).mockReturnValue(true)
        vi.mocked(buildMcpServerConfigs).mockReturnValue({
            "mcp-http": {
                type: "http",
                url: "https://example.test/mcp",
            },
        })
        const store = createStore({
            useRuntimeProductAPI: false,
            usesCoreOwnedProductRuntime: true,
            initialServers: [httpServerWithExpiringTokens("mcp-http")],
        })
        const manager = new McpServerManager(store)

        try {
            await expect(manager.testConnection("mcp-http")).resolves.toEqual({ success: true })
            await expect(manager.initiateOAuth("mcp-http")).resolves.toBe(true)

            expect(store.canUseProductMethodAfterConnect).toHaveBeenCalledWith(OPENADE_METHOD.settingsMcpServersRead)
            expect(store.canUseProductMethodAfterConnect).toHaveBeenCalledWith(OPENADE_METHOD.settingsMcpServersUpsert)
            expect(testMcpConnection).toHaveBeenCalledOnce()
            expect(initiateMcpOAuth).toHaveBeenCalledWith({
                serverId: "mcp-http",
                serverUrl: "https://example.test/mcp",
            })
            expect(store.upsertProductMcpServer).toHaveBeenCalledWith({
                server: expect.objectContaining({
                    id: "mcp-http",
                    healthStatus: "healthy",
                }),
            })
        } finally {
            manager.dispose()
        }
    })

    it("keeps background OAuth refresh available for legacy local connector settings", async () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date("2026-06-12T12:01:00.000Z"))
        vi.mocked(isMcpApiAvailable).mockReturnValue(true)
        const store = createStore({
            useRuntimeProductAPI: false,
            canUseProductMethod: () => false,
            initialServers: [httpServerWithExpiringTokens("mcp-http")],
        })
        const manager = new McpServerManager(store)

        try {
            await vi.advanceTimersByTimeAsync(5000)

            expect(refreshMcpOAuthToken).toHaveBeenCalledOnce()
            expect(refreshMcpOAuthToken).toHaveBeenCalledWith(
                expect.objectContaining({
                    clientId: "registered-client",
                    refreshToken: "refresh-token",
                })
            )
            expect(manager.getServer("mcp-http")).toEqual(
                expect.objectContaining({
                    oauthTokens: expect.objectContaining({ accessToken: "refreshed-token" }),
                })
            )
            expect(store.upsertProductMcpServer).not.toHaveBeenCalled()
        } finally {
            manager.dispose()
        }
    })

    it("persists an explicit product OAuth token refresh once", async () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date("2026-06-12T12:01:00.000Z"))
        vi.mocked(isMcpApiAvailable).mockReturnValue(true)
        const store = createStore({
            useRuntimeProductAPI: true,
            initialServers: [httpServerWithExpiringTokens("mcp-http")],
        })
        const manager = new McpServerManager(store)

        try {
            await expect(manager.refreshTokenIfNeeded("mcp-http")).resolves.toBe(true)

            expect(refreshMcpOAuthToken).toHaveBeenCalledOnce()
            expect(store.upsertProductMcpServer).toHaveBeenCalledOnce()
            expect(store.upsertProductMcpServer).toHaveBeenCalledWith({
                server: expect.objectContaining({
                    id: "mcp-http",
                    oauthTokens: expect.objectContaining({ accessToken: "refreshed-token" }),
                }),
            })
        } finally {
            manager.dispose()
        }
    })

    it("does not run disposed startup OAuth refresh timers", async () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date("2026-06-12T12:01:00.000Z"))
        vi.mocked(isMcpApiAvailable).mockReturnValue(true)
        const store = createStore({
            useRuntimeProductAPI: false,
            initialServers: [httpServerWithExpiringTokens("mcp-http")],
        })
        const manager = new McpServerManager(store)

        manager.dispose()
        await vi.advanceTimersByTimeAsync(5000)

        expect(refreshMcpOAuthToken).not.toHaveBeenCalled()
    })

    it("does not run background OAuth refresh for old token rows without registered client ids", async () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date("2026-06-12T12:01:00.000Z"))
        vi.mocked(isMcpApiAvailable).mockReturnValue(true)
        const oldTokenServer = httpServerWithExpiringTokens("mcp-http")
        oldTokenServer.oauthTokens = {
            accessToken: "access-token",
            refreshToken: "refresh-token",
            tokenType: "Bearer",
            expiresAt: "2026-06-12T12:00:00.000Z",
        }
        const store = createStore({
            useRuntimeProductAPI: false,
            initialServers: [oldTokenServer],
        })
        const manager = new McpServerManager(store)

        try {
            await vi.advanceTimersByTimeAsync(5000)

            expect(refreshMcpOAuthToken).not.toHaveBeenCalled()
        } finally {
            manager.dispose()
        }
    })

    it("does not initiate OAuth when product connector settings cannot persist token updates", async () => {
        vi.mocked(isMcpApiAvailable).mockReturnValue(true)
        const store = createStore({
            useRuntimeProductAPI: true,
            canUseProductMethod: (method) => method === OPENADE_METHOD.settingsMcpServersRead,
            initialServers: [httpServerWithExpiringTokens("mcp-http")],
        })
        const manager = new McpServerManager(store)

        try {
            await expect(manager.initiateOAuth("mcp-http")).resolves.toBe(false)

            expect(initiateMcpOAuth).not.toHaveBeenCalled()
        } finally {
            manager.dispose()
        }
    })

    it("does not test connector health when product connector settings cannot persist health updates", async () => {
        vi.mocked(isMcpApiAvailable).mockReturnValue(true)
        vi.mocked(buildMcpServerConfigs).mockReturnValue({
            "mcp-http": {
                type: "http",
                url: "https://example.test/mcp",
            },
        })
        const store = createStore({
            useRuntimeProductAPI: true,
            canUseProductMethod: (method) => method === OPENADE_METHOD.settingsMcpServersRead,
            initialServers: [httpServerWithExpiringTokens("mcp-http")],
        })
        const manager = new McpServerManager(store)

        try {
            await expect(manager.testConnection("mcp-http")).resolves.toEqual({ success: false })

            expect(testMcpConnection).not.toHaveBeenCalled()
            expect(store.upsertProductMcpServer).not.toHaveBeenCalled()
            expect(manager.getServer("mcp-http")?.healthStatus).toBe("unknown")
            expect(manager.getServer("mcp-http")?.lastTested).toBeUndefined()
        } finally {
            manager.dispose()
        }
    })
})
