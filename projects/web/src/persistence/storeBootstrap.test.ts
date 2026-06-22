import { beforeEach, describe, expect, it, vi } from "vitest"
import * as Y from "yjs"
import { connectMcpServerStore, createEphemeralMcpServerStoreConnection } from "./mcpServerStoreBootstrap"
import { connectPersonalSettingsStore, connectProductPersonalSettingsStore } from "./personalSettingsStoreBootstrap"
import { connectRepoStore } from "./repoStoreBootstrap"
import type { GetDocResult, StorageDriver } from "./storage/types"

const mocks = vi.hoisted(() => ({
    getYDoc: vi.fn<(id: string) => Promise<GetDocResult>>(),
    syncCallIds: [] as string[],
    refreshCallIds: [] as string[],
    disconnectCallIds: [] as string[],
}))

vi.mock("./storage", async (importOriginal) => {
    const actual = await importOriginal<typeof import("./storage")>()
    const driver: StorageDriver = {
        getYDoc: mocks.getYDoc,
        deleteDoc: vi.fn(async () => undefined),
        disconnect: vi.fn(),
    }

    return {
        ...actual,
        getStorageDriver: () => driver,
    }
})

function createStorageResult(id: string): GetDocResult {
    const doc = new Y.Doc()
    return {
        doc,
        sync: async () => {
            mocks.syncCallIds.push(id)
        },
        refresh: async () => {
            mocks.refreshCallIds.push(id)
            return true
        },
        disconnect: () => {
            mocks.disconnectCallIds.push(id)
            doc.destroy()
        },
    }
}

async function flushQueuedPersonalSettingsPersist(): Promise<void> {
    await Promise.resolve()
    await Promise.resolve()
}

describe("legacy store bootstraps", () => {
    beforeEach(() => {
        mocks.getYDoc.mockReset()
        mocks.syncCallIds.length = 0
        mocks.refreshCallIds.length = 0
        mocks.disconnectCallIds.length = 0
        mocks.getYDoc.mockImplementation(async (id) => createStorageResult(id))
    })

    it("lets CodeStore own initial sync timing for startup legacy stores", async () => {
        const repoConnection = await connectRepoStore()
        const mcpConnection = await connectMcpServerStore()
        const settingsConnection = await connectPersonalSettingsStore()

        expect(mocks.getYDoc).toHaveBeenCalledTimes(3)
        expect(mocks.getYDoc).toHaveBeenNthCalledWith(1, "code:repos")
        expect(mocks.getYDoc).toHaveBeenNthCalledWith(2, "code:mcp_servers")
        expect(mocks.getYDoc).toHaveBeenNthCalledWith(3, "code:personal_settings")
        expect(mocks.syncCallIds).toEqual([])

        await repoConnection.sync()
        await mcpConnection.sync()
        await settingsConnection.sync()

        expect(mocks.syncCallIds).toEqual(["code:repos", "code:mcp_servers", "code:personal_settings"])

        repoConnection.disconnect()
        mcpConnection.disconnect()
        settingsConnection.disconnect()

        expect(mocks.disconnectCallIds).toEqual(["code:repos", "code:mcp_servers", "code:personal_settings"])
    })

    it("keeps ephemeral MCP stores in memory only", async () => {
        const connection = createEphemeralMcpServerStoreConnection()

        await connection.sync()
        connection.disconnect()

        expect(mocks.getYDoc).not.toHaveBeenCalled()
        expect(mocks.syncCallIds).toEqual([])
    })

    it("does not persist product personal settings when replace capability is unavailable", async () => {
        const initialSettings = { theme: "system" as const, envVars: {}, renderMarkdownMessages: true }
        const replacePersonalSettings = vi.fn(async (params) => ({ settings: params.settings }))
        const connection = await connectProductPersonalSettingsStore({
            readPersonalSettings: vi.fn(async () => ({ settings: initialSettings })),
            replacePersonalSettings,
            canReplacePersonalSettings: () => false,
        })

        connection.store.settings.set({ theme: "code-theme-black" })
        await flushQueuedPersonalSettingsPersist()

        expect(connection.store.settings.current.theme).toBe("code-theme-black")
        expect(replacePersonalSettings).not.toHaveBeenCalled()

        connection.disconnect()
    })

    it("uses local defaults for product personal settings when read capability is unavailable", async () => {
        const readPersonalSettings = vi.fn(async () => ({ settings: { theme: "code-theme-black" as const, envVars: {}, renderMarkdownMessages: false } }))
        const replacePersonalSettings = vi.fn(async (params) => ({ settings: params.settings }))
        const connection = await connectProductPersonalSettingsStore({
            readPersonalSettings,
            replacePersonalSettings,
            canReadPersonalSettings: () => false,
            canReplacePersonalSettings: () => false,
        })

        await connection.sync()

        expect(connection.store.settings.current).toMatchObject({
            theme: "system",
            envVars: {},
            renderMarkdownMessages: true,
        })
        expect(readPersonalSettings).not.toHaveBeenCalled()
        expect(replacePersonalSettings).not.toHaveBeenCalled()

        connection.disconnect()
    })

    it("does not duplicate the initial product personal settings read on immediate sync", async () => {
        let theme: "system" | "code-theme-black" = "system"
        const readPersonalSettings = vi.fn(async () => ({ settings: { theme, envVars: {}, renderMarkdownMessages: true } }))
        const connection = await connectProductPersonalSettingsStore({
            readPersonalSettings,
            replacePersonalSettings: vi.fn(async (params) => ({ settings: params.settings })),
        })

        await connection.sync()
        expect(readPersonalSettings).toHaveBeenCalledTimes(1)
        expect(connection.store.settings.current.theme).toBe("system")

        theme = "code-theme-black"
        await connection.sync()
        expect(readPersonalSettings).toHaveBeenCalledTimes(2)
        expect(connection.store.settings.current.theme).toBe("code-theme-black")

        connection.disconnect()
    })

    it("persists product personal settings when replace capability is available", async () => {
        const initialSettings = { theme: "system" as const, envVars: {}, renderMarkdownMessages: true }
        const replacePersonalSettings = vi.fn(async (params) => ({ settings: params.settings }))
        const connection = await connectProductPersonalSettingsStore({
            readPersonalSettings: vi.fn(async () => ({ settings: initialSettings })),
            replacePersonalSettings,
            canReplacePersonalSettings: () => true,
        })

        connection.store.settings.set({ theme: "code-theme-black" })
        await flushQueuedPersonalSettingsPersist()

        expect(replacePersonalSettings).toHaveBeenCalledWith({
            settings: { theme: "code-theme-black", envVars: {}, renderMarkdownMessages: true },
        })

        connection.disconnect()
    })
})
