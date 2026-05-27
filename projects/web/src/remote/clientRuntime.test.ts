import { beforeEach, describe, expect, it, vi } from "vitest"
import type { RemoteConfig } from "./client"

const runtimeClients: RuntimeClient[] = []
const openadeClients: OpenADEClient[] = []
const changeListeners: Array<(notification: { method: string; params?: unknown }) => void> = []
let testRun = 0

class RuntimeClientError extends Error {
    constructor(
        readonly code: string,
        message: string,
        readonly data?: unknown
    ) {
        super(message)
        this.name = "RuntimeClientError"
    }
}

class RuntimeClient {
    close = vi.fn()

    constructor(readonly options: unknown) {
        runtimeClients.push(this)
    }
}

class OpenADEClient {
    getSnapshot = vi.fn(async () => ({
        repos: [],
        workingTaskIds: [],
        server: { version: "test", hostName: "test", theme: { setting: "system", className: "code-theme-light" } },
    }))
    getTask = vi.fn(async () => ({ id: "task-1", repoId: "repo-1", events: [] }))
    startTurn = vi.fn(async () => ({ taskId: "task-1" }))
    interruptTurn = vi.fn(async () => undefined)
    subscribeToChanges = vi.fn((listener: (notification: { method: string; params?: unknown }) => void) => {
        changeListeners.push(listener)
        return () => {
            const index = changeListeners.indexOf(listener)
            if (index >= 0) changeListeners.splice(index, 1)
        }
    })

    constructor(readonly options: unknown) {
        openadeClients.push(this)
    }
}

function config(overrides: Partial<RemoteConfig> = {}): RemoteConfig {
    const host = `100.64.1.${testRun + 1}:7823`
    return {
        id: `host-${testRun}`,
        baseUrl: `http://${host}`,
        token: "token-1",
        host,
        savedAt: "2026-05-27T00:00:00.000Z",
        lastUsedAt: "2026-05-27T00:00:00.000Z",
        ...overrides,
    }
}

async function importClient() {
    vi.doMock("../../../runtime-client/src", () => ({
        RuntimeClient,
        RuntimeClientError,
    }))
    vi.doMock("../../../openade-client/src", () => ({
        OpenADEClient,
    }))
    return import("./client")
}

beforeEach(() => {
    vi.resetModules()
    testRun += 1
    localStorage.clear()
    runtimeClients.length = 0
    openadeClients.length = 0
    changeListeners.length = 0
})

describe("companion remote runtime client cache", () => {
    it("reuses one runtime socket client for repeated calls to the same paired host", async () => {
        const { getSnapshot, getTask, startRemoteTurn, subscribeRemoteChanges } = await importClient()
        const remote = config()

        await getSnapshot(remote)
        await getTask(remote, "repo-1", "task-1")
        const unsubscribeA = subscribeRemoteChanges(remote, vi.fn())
        const unsubscribeB = subscribeRemoteChanges(remote, vi.fn())
        await startRemoteTurn(remote, { repoId: "repo-1", type: "ask", input: "hello" })

        expect(runtimeClients).toHaveLength(1)
        expect(openadeClients).toHaveLength(1)
        expect(openadeClients[0].getSnapshot).toHaveBeenCalledTimes(1)
        expect(openadeClients[0].getTask).toHaveBeenCalledWith("repo-1", "task-1")
        expect(openadeClients[0].subscribeToChanges).toHaveBeenCalledTimes(2)
        expect(openadeClients[0].startTurn).toHaveBeenCalledWith({ repoId: "repo-1", type: "ask", input: "hello" })

        unsubscribeA()
        unsubscribeB()
    })

    it("closes and replaces the runtime socket client when saved credentials change", async () => {
        const { getSnapshot } = await importClient()
        await getSnapshot(config())
        const firstRuntime = runtimeClients[0]

        await getSnapshot(config({ token: "token-2" }))

        expect(firstRuntime.close).toHaveBeenCalledTimes(1)
        expect(runtimeClients).toHaveLength(2)
        expect(openadeClients).toHaveLength(2)
    })

    it("forwards realtime socket statuses and lag notifications to the mobile UI", async () => {
        const { subscribeRemoteChanges } = await importClient()
        const onEvent = vi.fn()
        const onStatus = vi.fn()

        subscribeRemoteChanges(config(), onEvent, onStatus)
        const runtimeOptions = runtimeClients[0].options as { onStatus?: (status: string) => void }
        runtimeOptions.onStatus?.("connected")
        changeListeners[0]({ method: "connection/lagged", params: { requestedCursor: "1", oldestCursor: "10" } })

        expect(onStatus).toHaveBeenCalledWith("connected")
        expect(onStatus).toHaveBeenCalledWith("lagged")
        expect(onEvent).toHaveBeenCalledTimes(1)
    })
})
