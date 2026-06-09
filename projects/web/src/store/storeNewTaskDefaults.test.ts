import { beforeEach, describe, expect, it, vi } from "vitest"
import * as Y from "yjs"
import { createPersonalSettingsStore, type PersonalSettingsStore } from "../persistence/personalSettingsStore"
import { CodeStore } from "./store"

const mocks: { personalSettingsStore: PersonalSettingsStore | undefined } = vi.hoisted(() => ({
    personalSettingsStore: undefined,
}))

vi.mock("../analytics", () => ({
    analytics: { init: vi.fn(), setEnabled: vi.fn() },
    track: vi.fn(),
}))

vi.mock("../electronAPI/deviceConfig", () => ({
    getDeviceConfig: vi.fn(async () => null),
    setDeviceId: vi.fn(async () => null),
    setTelemetryDisabled: vi.fn(async () => undefined),
}))

vi.mock("../electronAPI/mcp", () => ({
    buildMcpServerConfigs: vi.fn(() => ({})),
    cancelMcpOAuth: vi.fn(async () => ({ success: true })),
    initiateMcpOAuth: vi.fn(async () => ({ success: false, error: "not available" })),
    isMcpApiAvailable: vi.fn(() => false),
    onMcpOAuthComplete: vi.fn(() => () => undefined),
    refreshMcpOAuthToken: vi.fn(async () => ({ success: false, error: "not available" })),
    testMcpConnection: vi.fn(async () => ({ success: false, error: "not available" })),
}))

vi.mock("../electronAPI/subprocess", () => ({
    setGlobalEnv: vi.fn(async () => ({ success: true })),
}))

vi.mock("../persistence/repoStoreBootstrap", () => ({
    connectRepoStore: vi.fn(async () => ({
        store: {
            repos: {
                all: () => [],
            },
        },
        sync: vi.fn(async () => undefined),
        refresh: vi.fn(async () => true),
        disconnect: vi.fn(),
    })),
}))

vi.mock("../persistence/mcpServerStoreBootstrap", () => ({
    createEphemeralMcpServerStoreConnection: vi.fn(() => ({
        store: {
            servers: {
                all: () => [],
            },
        },
        sync: vi.fn(async () => undefined),
        disconnect: vi.fn(),
    })),
    connectMcpServerStore: vi.fn(async () => ({
        store: {
            servers: {
                all: () => [],
            },
        },
        sync: vi.fn(async () => undefined),
        refresh: vi.fn(async () => true),
        disconnect: vi.fn(),
    })),
}))

vi.mock("../persistence/personalSettingsStoreBootstrap", () => ({
    connectPersonalSettingsStore: vi.fn(async () => ({
        store: mocks.personalSettingsStore,
        sync: vi.fn(async () => undefined),
        refresh: vi.fn(async () => true),
        disconnect: vi.fn(),
    })),
    connectProductPersonalSettingsStore: vi.fn(async () => ({
        store: mocks.personalSettingsStore,
        sync: vi.fn(async () => undefined),
        refresh: vi.fn(async () => true),
        disconnect: vi.fn(),
    })),
}))

describe("CodeStore new task defaults", () => {
    beforeEach(() => {
        mocks.personalSettingsStore = undefined
        vi.clearAllMocks()
    })

    it("persists selected harness and model to personal settings", () => {
        const settingsStore = createPersonalSettingsStore(new Y.Doc())
        const store = new CodeStore({
            getCurrentUser: () => ({ id: "u1", email: "u1@example.com" }),
            navigateToTask: vi.fn(),
        })

        store.personalSettingsStore = settingsStore

        store.setDefaultHarnessId("codex")
        expect(settingsStore.settings.current.newTaskHarnessId).toBe("codex")
        expect(settingsStore.settings.current.newTaskModelId).toBe("gpt-5.5")

        store.setDefaultModel("gpt-5.3-codex")
        expect(settingsStore.settings.current.newTaskHarnessId).toBe("codex")
        expect(settingsStore.settings.current.newTaskModelId).toBe("gpt-5.3-codex")
    })

    it("loads persisted harness and model defaults when stores initialize", async () => {
        const settingsStore = createPersonalSettingsStore(new Y.Doc())
        settingsStore.settings.set({ newTaskHarnessId: "codex", newTaskModelId: "gpt-5.3-codex" })
        mocks.personalSettingsStore = settingsStore
        const store = new CodeStore({
            getCurrentUser: () => ({ id: "u1", email: "u1@example.com" }),
            navigateToTask: vi.fn(),
        })

        await store.initializeStores()

        expect(store.defaultHarnessId).toBe("codex")
        expect(store.defaultModel).toBe("gpt-5.3-codex")

        store.disconnectAllStores()
    })
})
