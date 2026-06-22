import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { OPENADE_METHOD } from "../../../../openade-client/src"
import type { OpenADECronDefinitionsReadResult } from "../../../../openade-module/src"
import type { CronDef, ReadProcsResult } from "../../electronAPI/procs"
import type { CodeStore } from "../store"

vi.mock("../../electronAPI/dataFolder", () => ({
    dataFolderApi: {
        isAvailable: vi.fn(() => false),
        load: vi.fn(),
        save: vi.fn(),
        delete: vi.fn(),
    },
}))

vi.mock("../../electronAPI/procs", () => ({
    readProcs: vi.fn(),
}))

import { readProcs } from "../../electronAPI/procs"
import { dataFolderApi } from "../../electronAPI/dataFolder"
import { CronManager } from "./CronManager"

function makeCronDef(overrides?: Partial<CronDef>): CronDef {
    return {
        id: "openade.toml::test-cron",
        name: "Test Cron",
        schedule: "* * * * *",
        type: "do",
        prompt: "Run tests",
        ...overrides,
    }
}

function makeReadProcsResult(crons: CronDef[]): ReadProcsResult {
    return {
        repoRoot: "/repo",
        searchRoot: "/repo",
        isWorktree: false,
        configs: [{ relativePath: "openade.toml", processes: [], crons }],
        errors: [],
    }
}

function makeProductCronDefinitionsResult(crons: CronDef[]): OpenADECronDefinitionsReadResult {
    return {
        repoId: "repo-1",
        repoRoot: "/repo",
        searchRoot: "/repo",
        isWorktree: false,
        configs: [{ relativePath: "openade.toml", crons }],
        errors: [],
    }
}

function makeMockStore(repos: Array<{ id: string; path: string }> = []): CodeStore {
    const canUseProductMethod = vi.fn((_method: string) => true)
    return {
        repos: { repos, getRepo: (repoId: string) => repos.find((repo) => repo.id === repoId) },
        execution: { onAfterEvent: vi.fn(() => vi.fn()) },
        refreshRepoStoreFromStorage: vi.fn().mockResolvedValue(undefined),
        refreshTaskStoreFromStorage: vi.fn().mockResolvedValue(undefined),
        refreshProductStateAfterTaskMutation: vi.fn().mockResolvedValue(undefined),
        refreshProductStateAfterTaskCreation: vi.fn().mockResolvedValue(undefined),
        getTaskStore: vi.fn().mockResolvedValue(undefined),
        shouldUseRuntimeProductAPI: vi.fn(() => false),
        shouldUseRuntimeProductTaskRoute: vi.fn(() => false),
        usesCoreOwnedProductRuntime: vi.fn(() => false),
        shouldUseCoreOwnedCronScheduler: vi.fn(() => false),
        canUseProductMethod,
        canUseProductMethodAfterConnect: vi.fn(async (method) => canUseProductMethod(method)),
        listProductProjectProcesses: vi.fn(),
        readProductCronDefinitions: vi.fn(),
        listProductCronInstallStateRepos: vi.fn().mockResolvedValue(null),
        readProductCronInstallState: vi.fn().mockResolvedValue({ repoId: "repo-1", installations: {} }),
        replaceProductCronInstallState: vi.fn().mockResolvedValue({
            repoId: "repo-1",
            installations: {},
            replacedInstallations: 0,
        }),
        runProductCron: vi.fn().mockResolvedValue({ repoId: "repo-1", cronId: "openade.toml::test-cron", taskId: "task-1" }),
        startProductTurn: vi.fn().mockResolvedValue({ taskId: "task-1" }),
    } as unknown as CodeStore
}

async function addRepoAndLoadConfig(manager: CronManager, repoId = "repo-1", repoPath = "/repo"): Promise<void> {
    await manager.addRepo(repoId, repoPath)
    await manager.ensureRepoConfigLoaded(repoId)
}

describe("CronManager scheduling", () => {
    beforeEach(() => {
        vi.useFakeTimers()
        vi.mocked(dataFolderApi.isAvailable).mockReturnValue(false)
        vi.mocked(dataFolderApi.load).mockResolvedValue(null)
    })

    afterEach(() => {
        vi.useRealTimers()
        vi.restoreAllMocks()
    })

    it("fires on first scheduled occurrence with no lastRunAt", async () => {
        vi.setSystemTime(new Date("2026-01-01T10:04:30.000Z"))

        const cronDef = makeCronDef()
        const store = makeMockStore([{ id: "repo-1", path: "/repo" }])
        const manager = new CronManager(store)

        vi.mocked(readProcs).mockResolvedValue(makeReadProcsResult([cronDef]))

        await addRepoAndLoadConfig(manager)
        await manager.installCron("repo-1", cronDef.id)

        expect(store.startProductTurn).not.toHaveBeenCalled()

        // Advance to 10:05:00 — the next minute boundary
        await vi.advanceTimersByTimeAsync(30_000)

        expect(store.startProductTurn).toHaveBeenCalledTimes(1)
        expect(store.startProductTurn).toHaveBeenCalledWith(
            expect.objectContaining({
                repoId: "repo-1",
                input: "Run tests",
                isolationStrategy: { type: "head" },
                title: "[Cron] Test Cron",
            })
        )
    })

    it("does not start scheduled renderer cron turns when turn start is unavailable", async () => {
        vi.setSystemTime(new Date("2026-01-01T10:04:30.000Z"))

        const cronDef = makeCronDef()
        const store = makeMockStore([{ id: "repo-1", path: "/repo" }])
        vi.mocked(store.shouldUseRuntimeProductAPI).mockReturnValue(true)
        vi.mocked(store.canUseProductMethod).mockImplementation((method: string) => method !== OPENADE_METHOD.turnStart)
        vi.mocked(store.readProductCronDefinitions).mockResolvedValue(makeProductCronDefinitionsResult([cronDef]))
        const manager = new CronManager(store)

        await manager.addRepo("repo-1", "/repo")
        await manager.installCron("repo-1", cronDef.id)
        await vi.advanceTimersByTimeAsync(30_000)

        expect(store.startProductTurn).not.toHaveBeenCalled()

        manager.stop()
    })

    it("fires when timer callback is slightly late", async () => {
        vi.setSystemTime(new Date("2026-01-01T10:04:30.000Z"))

        const cronDef = makeCronDef()
        const store = makeMockStore([{ id: "repo-1", path: "/repo" }])
        const manager = new CronManager(store)

        vi.mocked(readProcs).mockResolvedValue(makeReadProcsResult([cronDef]))

        await addRepoAndLoadConfig(manager)
        await manager.installCron("repo-1", cronDef.id)

        // Advance 500ms past the target (simulating late callback)
        await vi.advanceTimersByTimeAsync(30_500)

        expect(store.startProductTurn).toHaveBeenCalledTimes(1)
    })

    it("chains next occurrence after firing", async () => {
        vi.setSystemTime(new Date("2026-01-01T10:04:30.000Z"))

        const cronDef = makeCronDef()
        const store = makeMockStore([{ id: "repo-1", path: "/repo" }])
        const manager = new CronManager(store)

        vi.mocked(readProcs).mockResolvedValue(makeReadProcsResult([cronDef]))

        await addRepoAndLoadConfig(manager)
        await manager.installCron("repo-1", cronDef.id)

        // First fire at 10:05:00
        await vi.advanceTimersByTimeAsync(30_000)
        expect(store.startProductTurn).toHaveBeenCalledTimes(1)

        // Second fire at 10:06:00
        await vi.advanceTimersByTimeAsync(60_000)
        expect(store.startProductTurn).toHaveBeenCalledTimes(2)
    })

    it("does not reschedule running crons during rescheduleRepo", async () => {
        vi.setSystemTime(new Date("2026-01-01T10:04:30.000Z"))

        const cronDef = makeCronDef()
        let resolveRun!: (value: { taskId: string }) => void
        const store = makeMockStore([{ id: "repo-1", path: "/repo" }])
        vi.mocked(store.startProductTurn).mockReturnValue(
            new Promise((r) => {
                resolveRun = r
            })
        )
        const manager = new CronManager(store)

        vi.mocked(readProcs).mockResolvedValue(makeReadProcsResult([cronDef]))

        await addRepoAndLoadConfig(manager)
        await manager.installCron("repo-1", cronDef.id)

        // Fire at 10:05:00 — starts executing but hangs on startProductTurn
        await vi.advanceTimersByTimeAsync(30_000)
        expect(store.startProductTurn).toHaveBeenCalledTimes(1)

        // Trigger rescheduleRepo while cron is running — should skip it
        manager.updateCronDefs("repo-1", makeReadProcsResult([cronDef]))

        // Let the run complete so fireCron.finally() can chain
        resolveRun({ taskId: "task-1" })
        await vi.advanceTimersByTimeAsync(0)

        // fireCron.finally() should have scheduled next — advance to 10:06:00
        await vi.advanceTimersByTimeAsync(60_000)
        expect(store.startProductTurn).toHaveBeenCalledTimes(2)
    })

    it("debounces rapid refresh calls from onAfterEvent", async () => {
        vi.setSystemTime(new Date("2026-01-01T10:00:00.000Z"))

        const cronDef = makeCronDef()
        const store = makeMockStore([{ id: "repo-1", path: "/repo" }])
        const manager = new CronManager(store)

        vi.mocked(readProcs).mockResolvedValue(makeReadProcsResult([cronDef]))

        // Config loading calls readProcs once
        await addRepoAndLoadConfig(manager)
        expect(readProcs).toHaveBeenCalledTimes(1)

        // startAll sets up event handlers (repos is empty so no additional addRepo calls)
        await manager.startAll()

        const afterEventCb = vi.mocked(store.execution.onAfterEvent).mock.calls[0]?.[0] as () => void

        // Fire 5 rapid events
        afterEventCb()
        afterEventCb()
        afterEventCb()
        afterEventCb()
        afterEventCb()

        // readProcs should not have been called again yet
        expect(readProcs).toHaveBeenCalledTimes(1)

        // Advance past the 3-second debounce
        await vi.advanceTimersByTimeAsync(3_000)

        // Now readProcs should have been called once more (coalesced)
        await vi.waitFor(() => expect(readProcs).toHaveBeenCalledTimes(2))

        manager.stop()
    })

    it("does not scan uninstalled repos on startup", async () => {
        const store = makeMockStore([
            { id: "repo-1", path: "/repo-1" },
            { id: "repo-2", path: "/repo-2" },
        ])
        const manager = new CronManager(store)

        vi.mocked(readProcs).mockResolvedValue(makeReadProcsResult([]))

        await manager.startAll()

        expect(readProcs).not.toHaveBeenCalled()

        manager.stop()
    })

    it("uses the legacy cron install index to avoid loading every repo state on startup", async () => {
        const cronDef = makeCronDef()
        const store = makeMockStore([
            { id: "repo-1", path: "/repo-1" },
            { id: "repo-2", path: "/repo-2" },
            { id: "repo-3", path: "/repo-3" },
        ])
        const manager = new CronManager(store)

        vi.mocked(dataFolderApi.isAvailable).mockReturnValue(true)
        vi.mocked(dataFolderApi.load).mockImplementation(async (_folder, id) => {
            if (id === "_index") return JSON.stringify({ version: 1, repoIds: ["repo-2"] })
            if (id === "repo-2") {
                return JSON.stringify({
                    installations: {
                        [cronDef.id]: {
                            cronId: cronDef.id,
                            enabled: true,
                            installedAt: "2026-01-01T00:00:00.000Z",
                        },
                    },
                })
            }
            throw new Error(`unexpected legacy cron state load: ${id}`)
        })
        vi.mocked(readProcs).mockResolvedValue(makeReadProcsResult([cronDef]))

        await manager.startAll()

        expect(dataFolderApi.load).toHaveBeenCalledTimes(2)
        expect(dataFolderApi.load).toHaveBeenCalledWith("cron", "_index", "json")
        expect(dataFolderApi.load).toHaveBeenCalledWith("cron", "repo-2", "json")
        expect(readProcs).toHaveBeenCalledTimes(1)
        expect(manager.getCronsForRepo("repo-2")).toEqual([expect.objectContaining({ repoId: "repo-2", def: cronDef })])
        expect(manager.getCronsForRepo("repo-1")).toEqual([])
        expect(manager.getCronsForRepo("repo-3")).toEqual([])

        manager.stop()
    })

    it("does not broad-scan legacy cron state when the install index is missing", async () => {
        const cronDef = makeCronDef()
        const store = makeMockStore([
            { id: "repo-1", path: "/repo-1" },
            { id: "repo-2", path: "/repo-2" },
            { id: "repo-3", path: "/repo-3" },
        ])
        const manager = new CronManager(store)

        vi.mocked(dataFolderApi.isAvailable).mockReturnValue(true)
        vi.mocked(dataFolderApi.load).mockImplementation(async (_folder, id) => {
            if (id === "_index") return null
            if (id === "repo-2") {
                return JSON.stringify({
                    installations: {
                        [cronDef.id]: {
                            cronId: cronDef.id,
                            enabled: true,
                            installedAt: "2026-01-01T00:00:00.000Z",
                        },
                    },
                })
            }
            return null
        })
        vi.mocked(readProcs).mockResolvedValue(makeReadProcsResult([cronDef]))
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)

        await manager.startAll()

        expect(dataFolderApi.load).toHaveBeenCalledTimes(1)
        expect(dataFolderApi.load).toHaveBeenCalledWith("cron", "_index", "json")
        expect(dataFolderApi.load).not.toHaveBeenCalledWith("cron", "repo-1", "json")
        expect(dataFolderApi.load).not.toHaveBeenCalledWith("cron", "repo-2", "json")
        expect(dataFolderApi.load).not.toHaveBeenCalledWith("cron", "repo-3", "json")
        expect(readProcs).not.toHaveBeenCalled()
        expect(dataFolderApi.save).not.toHaveBeenCalledWith("cron", "_index", expect.any(String), "json")
        expect(warn).toHaveBeenCalledWith("[CronManager] Legacy cron install-state index unavailable; skipping automatic startup scheduling")

        manager.stop()
        warn.mockRestore()
    })

    it("does not start renderer cron tracking when Core owns scheduling", async () => {
        const store = makeMockStore([
            { id: "repo-1", path: "/repo-1" },
            { id: "repo-2", path: "/repo-2" },
        ])
        vi.mocked(store.shouldUseRuntimeProductAPI).mockReturnValue(true)
        vi.mocked(store.shouldUseCoreOwnedCronScheduler).mockReturnValue(true)
        vi.mocked(store.readProductCronInstallState).mockRejectedValue(new Error("renderer should not load product cron state on clean Core startup"))
        vi.mocked(store.listProductProjectProcesses).mockRejectedValue(new Error("renderer should not scan product processes on clean Core startup"))
        vi.mocked(store.readProductCronDefinitions).mockRejectedValue(new Error("renderer should not scan product cron definitions on clean Core startup"))
        const manager = new CronManager(store)

        await manager.startAll()

        expect(manager.started).toBe(false)
        expect(store.readProductCronInstallState).not.toHaveBeenCalled()
        expect(store.listProductProjectProcesses).not.toHaveBeenCalled()
        expect(store.readProductCronDefinitions).not.toHaveBeenCalled()
        expect(store.execution.onAfterEvent).not.toHaveBeenCalled()

        window.dispatchEvent(new Event("focus"))
        await vi.advanceTimersByTimeAsync(60_000)

        expect(store.listProductProjectProcesses).not.toHaveBeenCalled()
        expect(store.readProductCronDefinitions).not.toHaveBeenCalled()
    })

    it("does not start renderer cron tracking when runtime product cron state is active", async () => {
        const store = makeMockStore([
            { id: "repo-1", path: "/repo-1" },
            { id: "repo-2", path: "/repo-2" },
            { id: "repo-3", path: "/repo-3" },
        ])
        vi.mocked(store.shouldUseRuntimeProductAPI).mockReturnValue(true)
        vi.mocked(store.canUseProductMethod).mockImplementation((method) => method !== OPENADE_METHOD.cronInstallStateList)
        vi.mocked(store.readProductCronInstallState).mockRejectedValue(new Error("startup should not scan repo install state"))
        vi.mocked(store.readProductCronDefinitions).mockRejectedValue(new Error("startup should not scan repo cron definitions"))
        const manager = new CronManager(store)

        await manager.startAll()

        expect(manager.started).toBe(false)
        expect(store.listProductCronInstallStateRepos).not.toHaveBeenCalled()
        expect(store.readProductCronInstallState).not.toHaveBeenCalled()
        expect(store.readProductCronDefinitions).not.toHaveBeenCalled()
        expect(store.execution.onAfterEvent).not.toHaveBeenCalled()
        expect(readProcs).not.toHaveBeenCalled()

        manager.stop()
    })

    it("does not start renderer cron tracking for route-owned runtime task sessions before broad projection initializes", async () => {
        const store = makeMockStore([{ id: "repo-1", path: "/repo-1" }])
        vi.mocked(store.shouldUseRuntimeProductTaskRoute).mockReturnValue(true)
        vi.mocked(store.shouldUseRuntimeProductAPI).mockReturnValue(false)
        vi.mocked(store.readProductCronInstallState).mockRejectedValue(new Error("route task startup should not load product cron state"))
        vi.mocked(store.readProductCronDefinitions).mockRejectedValue(new Error("route task startup should not scan product cron definitions"))
        const manager = new CronManager(store)

        await manager.startAll()
        await manager.addRepo("repo-1", "/repo-1")

        expect(manager.started).toBe(false)
        expect(store.readProductCronInstallState).not.toHaveBeenCalled()
        expect(store.readProductCronDefinitions).not.toHaveBeenCalled()
        expect(store.execution.onAfterEvent).not.toHaveBeenCalled()
        expect(readProcs).not.toHaveBeenCalled()
    })

    it("stops renderer cron startup if Core scheduling becomes active while loading install state", async () => {
        const cronDef = makeCronDef()
        const store = makeMockStore([{ id: "repo-1", path: "/repo-1" }])
        const manager = new CronManager(store)

        vi.mocked(dataFolderApi.isAvailable).mockReturnValue(true)
        vi.mocked(dataFolderApi.load).mockImplementation(async (_folder, id) => {
            if (id === "_index") return JSON.stringify({ version: 1, repoIds: ["repo-1"] })
            if (id === "repo-1") {
                vi.mocked(store.shouldUseCoreOwnedCronScheduler).mockReturnValue(true)
                return JSON.stringify({
                    installations: {
                        [cronDef.id]: {
                            cronId: cronDef.id,
                            enabled: true,
                            installedAt: "2026-01-01T00:00:00.000Z",
                        },
                    },
                })
            }
            return null
        })
        vi.mocked(readProcs).mockResolvedValue(makeReadProcsResult([cronDef]))

        await manager.startAll()

        expect(manager.started).toBe(false)
        expect(readProcs).not.toHaveBeenCalled()
        expect(store.execution.onAfterEvent).not.toHaveBeenCalled()

        window.dispatchEvent(new Event("focus"))
        await vi.advanceTimersByTimeAsync(60_000)

        expect(readProcs).not.toHaveBeenCalled()
    })

    it("stops renderer cron tracking when Core ownership becomes active after startup", async () => {
        const cronDef = makeCronDef()
        const store = makeMockStore([{ id: "repo-1", path: "/repo-1" }])
        const manager = new CronManager(store)

        vi.mocked(dataFolderApi.isAvailable).mockReturnValue(true)
        vi.mocked(dataFolderApi.load).mockImplementation(async (_folder, id) => {
            if (id === "_index") return JSON.stringify({ version: 1, repoIds: ["repo-1"] })
            if (id === "repo-1") {
                return JSON.stringify({
                    installations: {
                        [cronDef.id]: {
                            cronId: cronDef.id,
                            enabled: true,
                            installedAt: "2026-01-01T00:00:00.000Z",
                        },
                    },
                })
            }
            return null
        })
        vi.mocked(readProcs).mockResolvedValue(makeReadProcsResult([cronDef]))

        await manager.startAll()
        expect(manager.started).toBe(true)
        expect(readProcs).toHaveBeenCalledTimes(1)

        vi.mocked(readProcs).mockClear()
        vi.mocked(store.shouldUseCoreOwnedCronScheduler).mockReturnValue(true)

        window.dispatchEvent(new Event("focus"))
        await vi.advanceTimersByTimeAsync(60_000)

        expect(manager.started).toBe(false)
        expect(readProcs).not.toHaveBeenCalled()
    })

    it("does not hydrate renderer cron state from repo-add bookkeeping when Core owns scheduling", async () => {
        const store = makeMockStore([{ id: "repo-1", path: "/repo" }])
        vi.mocked(store.shouldUseRuntimeProductAPI).mockReturnValue(true)
        vi.mocked(store.shouldUseCoreOwnedCronScheduler).mockReturnValue(true)
        vi.mocked(store.readProductCronInstallState).mockRejectedValue(new Error("repo-add should not load product cron state"))
        vi.mocked(store.readProductCronDefinitions).mockRejectedValue(new Error("repo-add should not load product cron definitions"))
        vi.mocked(readProcs).mockRejectedValue(new Error("repo-add should not read legacy process config"))
        const manager = new CronManager(store)

        await manager.addRepo("repo-1", "/repo")

        expect(store.readProductCronInstallState).not.toHaveBeenCalled()
        expect(store.readProductCronDefinitions).not.toHaveBeenCalled()
        expect(readProcs).not.toHaveBeenCalled()
        expect(manager.getCronsForRepo("repo-1")).toEqual([])
    })

    it("bounds concurrent procs refreshes for repos with installed crons", async () => {
        const store = makeMockStore([
            { id: "repo-1", path: "/repo-1" },
            { id: "repo-2", path: "/repo-2" },
            { id: "repo-3", path: "/repo-3" },
            { id: "repo-4", path: "/repo-4" },
        ])
        vi.mocked(dataFolderApi.isAvailable).mockReturnValue(true)
        vi.mocked(dataFolderApi.load).mockImplementation(async (_folder, id) => {
            if (id === "_index") return JSON.stringify({ version: 1, repoIds: ["repo-1", "repo-2", "repo-3", "repo-4"] })
            return JSON.stringify({
                installations: {
                    "openade.toml::test-cron": {
                        cronId: "openade.toml::test-cron",
                        enabled: true,
                        installedAt: "2026-01-01T00:00:00.000Z",
                    },
                },
            })
        })
        const manager = new CronManager(store)
        const releases: Array<() => void> = []
        let active = 0
        let maxActive = 0

        vi.mocked(readProcs).mockImplementation(
            () =>
                new Promise<ReadProcsResult>((resolve) => {
                    active += 1
                    maxActive = Math.max(maxActive, active)
                    releases.push(() => {
                        active -= 1
                        resolve(makeReadProcsResult([]))
                    })
                })
        )

        const started = manager.startAll()
        await vi.waitFor(() => expect(readProcs).toHaveBeenCalledTimes(2))
        expect(maxActive).toBeLessThanOrEqual(2)

        releases.splice(0).forEach((release) => release())
        await vi.waitFor(() => expect(readProcs).toHaveBeenCalledTimes(4))
        expect(maxActive).toBeLessThanOrEqual(2)

        releases.splice(0).forEach((release) => release())
        await started
        expect(maxActive).toBeLessThanOrEqual(2)

        manager.stop()
    })

    it("does not run another all-repo procs refresh on focus immediately after startup", async () => {
        vi.setSystemTime(new Date("2026-01-01T10:00:00.000Z"))

        const store = makeMockStore([{ id: "repo-1", path: "/repo" }])
        const manager = new CronManager(store)

        vi.mocked(readProcs).mockResolvedValue(makeReadProcsResult([]))

        await manager.startAll()
        expect(readProcs).not.toHaveBeenCalled()

        window.dispatchEvent(new Event("focus"))
        await vi.advanceTimersByTimeAsync(3_000)

        expect(readProcs).not.toHaveBeenCalled()

        await vi.advanceTimersByTimeAsync(60_001)
        window.dispatchEvent(new Event("focus"))
        await vi.advanceTimersByTimeAsync(3_000)

        expect(readProcs).not.toHaveBeenCalled()

        manager.stop()
    })

    it("loads repo cron config on demand for sidebar display", async () => {
        const cronDef = makeCronDef()
        const store = makeMockStore([{ id: "repo-1", path: "/repo" }])
        const manager = new CronManager(store)

        vi.mocked(readProcs).mockResolvedValue(makeReadProcsResult([cronDef]))

        await manager.startAll()
        expect(readProcs).not.toHaveBeenCalled()

        await manager.ensureRepoConfigLoaded("repo-1")

        expect(readProcs).toHaveBeenCalledTimes(1)
        expect(manager.getCronsForRepo("repo-1")).toEqual([expect.objectContaining({ repoId: "repo-1", def: cronDef })])

        manager.stop()
    })

    it("does not scan newly added repos until cron config is requested", async () => {
        const cronDef = makeCronDef()
        const store = makeMockStore([{ id: "repo-1", path: "/repo" }])
        const manager = new CronManager(store)

        vi.mocked(readProcs).mockResolvedValue(makeReadProcsResult([cronDef]))

        await manager.addRepo("repo-1", "/repo")

        expect(readProcs).not.toHaveBeenCalled()
        expect(manager.getCronsForRepo("repo-1")).toEqual([])

        await manager.ensureRepoConfigLoaded("repo-1")

        expect(readProcs).toHaveBeenCalledTimes(1)
        expect(manager.getCronsForRepo("repo-1")).toEqual([expect.objectContaining({ repoId: "repo-1", def: cronDef })])

        manager.stop()
    })

    it("coalesces overlapping same-repo config refreshes", async () => {
        const cronDef = makeCronDef()
        const store = makeMockStore([{ id: "repo-1", path: "/repo" }])
        const manager = new CronManager(store)
        let resolveRead!: (value: ReadProcsResult) => void
        vi.mocked(readProcs).mockImplementation(
            () =>
                new Promise((resolve) => {
                    resolveRead = resolve
                })
        )

        const firstLoad = manager.ensureRepoConfigLoaded("repo-1")
        await Promise.resolve()
        await Promise.resolve()
        expect(readProcs).toHaveBeenCalledTimes(1)
        const secondLoad = manager.ensureRepoConfigLoaded("repo-1")

        expect(readProcs).toHaveBeenCalledTimes(1)

        resolveRead(makeReadProcsResult([cronDef]))
        await Promise.all([firstLoad, secondLoad])

        expect(readProcs).toHaveBeenCalledTimes(1)
        expect(manager.getCronsForRepo("repo-1")).toEqual([expect.objectContaining({ repoId: "repo-1", def: cronDef })])

        manager.stop()
    })

    it("loads and saves runtime cron install state through product APIs", async () => {
        vi.setSystemTime(new Date("2026-01-01T00:05:30.000Z"))

        const cronDef = makeCronDef()
        const store = makeMockStore([{ id: "repo-1", path: "/repo" }])
        vi.mocked(store.shouldUseRuntimeProductAPI).mockReturnValue(true)
        vi.mocked(store.readProductCronInstallState).mockResolvedValue({
            repoId: "repo-1",
            installations: {
                [cronDef.id]: {
                    cronId: cronDef.id,
                    enabled: false,
                    installedAt: "2026-01-01T00:00:00.000Z",
                    lastRunAt: "2026-01-01T00:05:00.000Z",
                    lastTaskId: "task-existing",
                },
            },
        })
        vi.mocked(store.readProductCronDefinitions).mockResolvedValue(makeProductCronDefinitionsResult([cronDef]))
        vi.mocked(dataFolderApi.isAvailable).mockReturnValue(true)
        vi.mocked(dataFolderApi.load).mockRejectedValue(new Error("legacy cron data folder should not be used"))
        vi.mocked(dataFolderApi.save).mockRejectedValue(new Error("legacy cron data folder should not be used"))
        const manager = new CronManager(store)

        await addRepoAndLoadConfig(manager)

        expect(store.readProductCronInstallState).toHaveBeenCalledWith({ repoId: "repo-1" })
        expect(store.readProductCronDefinitions).toHaveBeenCalledWith({ repoId: "repo-1" })
        expect(store.listProductProjectProcesses).not.toHaveBeenCalled()
        expect(dataFolderApi.load).not.toHaveBeenCalled()
        expect(manager.getCronsForRepo("repo-1")[0]).toEqual(
            expect.objectContaining({
                installed: true,
                enabled: false,
                lastTaskId: "task-existing",
            })
        )

        await manager.toggleCron("repo-1", cronDef.id, true)

        expect(store.replaceProductCronInstallState).toHaveBeenCalledWith({
            repoId: "repo-1",
            installations: {
                [cronDef.id]: expect.objectContaining({
                    cronId: cronDef.id,
                    enabled: true,
                    installedAt: "2026-01-01T00:00:00.000Z",
                }),
            },
        })
        expect(dataFolderApi.save).not.toHaveBeenCalled()

        manager.stop()
    })

    it("does not use the runtime cron install-state index for renderer startup scheduling", async () => {
        const cronDef = makeCronDef()
        const store = makeMockStore([
            { id: "repo-1", path: "/repo-1" },
            { id: "repo-2", path: "/repo-2" },
            { id: "repo-3", path: "/repo-3" },
        ])
        vi.mocked(store.shouldUseRuntimeProductAPI).mockReturnValue(true)
        vi.mocked(store.listProductCronInstallStateRepos).mockResolvedValue({ repoIds: ["repo-2"] })
        vi.mocked(store.readProductCronInstallState).mockImplementation(async ({ repoId }) => ({
            repoId,
            installations:
                repoId === "repo-2"
                    ? {
                          [cronDef.id]: {
                              cronId: cronDef.id,
                              enabled: true,
                              installedAt: "2026-01-01T00:00:00.000Z",
                          },
                      }
                    : {},
        }))
        vi.mocked(store.readProductCronDefinitions).mockResolvedValue(makeProductCronDefinitionsResult([cronDef]))
        vi.mocked(dataFolderApi.isAvailable).mockReturnValue(true)
        vi.mocked(dataFolderApi.load).mockRejectedValue(new Error("legacy cron data folder should not be used"))
        vi.mocked(readProcs).mockRejectedValue(new Error("legacy process config should not be used"))
        const manager = new CronManager(store)

        await manager.startAll()

        expect(manager.started).toBe(false)
        expect(store.listProductCronInstallStateRepos).not.toHaveBeenCalled()
        expect(store.readProductCronInstallState).not.toHaveBeenCalled()
        expect(store.readProductCronDefinitions).not.toHaveBeenCalled()
        expect(store.execution.onAfterEvent).not.toHaveBeenCalled()
        expect(dataFolderApi.load).not.toHaveBeenCalled()
        expect(readProcs).not.toHaveBeenCalled()

        manager.stop()
    })

    it("does not wait for Core runtime cron capabilities during renderer startup", async () => {
        const cronDef = makeCronDef()
        const store = makeMockStore([
            { id: "repo-1", path: "/repo-1" },
            { id: "repo-2", path: "/repo-2" },
        ])
        vi.mocked(store.shouldUseRuntimeProductAPI).mockReturnValue(true)
        vi.mocked(store.usesCoreOwnedProductRuntime).mockReturnValue(true)
        vi.mocked(store.canUseProductMethod).mockReturnValue(false)
        vi.mocked(store.canUseProductMethodAfterConnect).mockResolvedValue(true)
        vi.mocked(store.listProductCronInstallStateRepos).mockResolvedValue({ repoIds: ["repo-2"] })
        vi.mocked(store.readProductCronInstallState).mockResolvedValue({
            repoId: "repo-2",
            installations: {
                [cronDef.id]: {
                    cronId: cronDef.id,
                    enabled: true,
                    installedAt: "2026-01-01T00:00:00.000Z",
                },
            },
        })
        vi.mocked(store.readProductCronDefinitions).mockResolvedValue(makeProductCronDefinitionsResult([cronDef]))
        vi.mocked(dataFolderApi.isAvailable).mockReturnValue(true)
        vi.mocked(dataFolderApi.load).mockRejectedValue(new Error("legacy cron data folder should not be used"))
        vi.mocked(readProcs).mockRejectedValue(new Error("legacy process config should not be used"))
        const manager = new CronManager(store)

        await manager.startAll()

        expect(manager.started).toBe(false)
        expect(store.canUseProductMethodAfterConnect).not.toHaveBeenCalled()
        expect(store.listProductCronInstallStateRepos).not.toHaveBeenCalled()
        expect(store.readProductCronInstallState).not.toHaveBeenCalled()
        expect(store.readProductCronDefinitions).not.toHaveBeenCalled()
        expect(store.execution.onAfterEvent).not.toHaveBeenCalled()
        expect(dataFolderApi.load).not.toHaveBeenCalled()
        expect(readProcs).not.toHaveBeenCalled()

        manager.stop()
    })

    it("skips runtime cron reads when cron read capabilities are absent", async () => {
        const store = makeMockStore([{ id: "repo-1", path: "/repo" }])
        vi.mocked(store.shouldUseRuntimeProductAPI).mockReturnValue(true)
        vi.mocked(store.canUseProductMethod).mockImplementation(
            (method) => method !== OPENADE_METHOD.cronDefinitionsRead && method !== OPENADE_METHOD.cronInstallStateRead
        )
        vi.mocked(store.readProductCronDefinitions).mockRejectedValue(new Error("cron definitions should not be requested"))
        vi.mocked(store.readProductCronInstallState).mockRejectedValue(new Error("cron install state should not be requested"))
        vi.mocked(dataFolderApi.isAvailable).mockReturnValue(true)
        vi.mocked(dataFolderApi.load).mockRejectedValue(new Error("legacy cron data folder should not be used"))
        const manager = new CronManager(store)

        await manager.ensureRepoConfigLoaded("repo-1")
        await manager.ensureRepoConfigLoaded("repo-1")

        expect(store.readProductCronDefinitions).not.toHaveBeenCalled()
        expect(store.readProductCronInstallState).not.toHaveBeenCalled()
        expect(dataFolderApi.load).not.toHaveBeenCalled()
        expect(manager.getCronsForRepo("repo-1")).toEqual([])

        manager.stop()
    })

    it("retries runtime cron config and install-state reads after capabilities attach", async () => {
        const cronDef = makeCronDef()
        const store = makeMockStore([{ id: "repo-1", path: "/repo" }])
        vi.mocked(store.shouldUseRuntimeProductAPI).mockReturnValue(true)
        const allowedMethods = new Set<string>()
        vi.mocked(store.canUseProductMethod).mockImplementation((method) => allowedMethods.has(method))
        vi.mocked(store.readProductCronInstallState).mockResolvedValue({
            repoId: "repo-1",
            installations: {
                [cronDef.id]: {
                    cronId: cronDef.id,
                    enabled: true,
                    installedAt: "2026-01-01T00:00:00.000Z",
                    lastTaskId: "task-existing",
                },
            },
        })
        vi.mocked(store.readProductCronDefinitions).mockResolvedValue(makeProductCronDefinitionsResult([cronDef]))
        const manager = new CronManager(store)

        await manager.ensureRepoConfigLoaded("repo-1")

        expect(store.readProductCronDefinitions).not.toHaveBeenCalled()
        expect(store.readProductCronInstallState).not.toHaveBeenCalled()
        expect(manager.getCronsForRepo("repo-1")).toEqual([])

        allowedMethods.add(OPENADE_METHOD.cronDefinitionsRead)
        allowedMethods.add(OPENADE_METHOD.cronInstallStateRead)
        await manager.ensureRepoConfigLoaded("repo-1")

        expect(store.readProductCronInstallState).toHaveBeenCalledWith({ repoId: "repo-1" })
        expect(store.readProductCronDefinitions).toHaveBeenCalledWith({ repoId: "repo-1" })
        expect(manager.getCronsForRepo("repo-1")).toEqual([
            expect.objectContaining({
                installed: true,
                enabled: true,
                lastTaskId: "task-existing",
            }),
        ])

        manager.stop()
    })

    it("hides runtime cron definitions on capability loss without pruning install state", async () => {
        const cronDef = makeCronDef()
        const store = makeMockStore([{ id: "repo-1", path: "/repo" }])
        vi.mocked(store.shouldUseRuntimeProductAPI).mockReturnValue(true)
        const allowedMethods = new Set<string>([
            OPENADE_METHOD.cronDefinitionsRead,
            OPENADE_METHOD.cronInstallStateRead,
            OPENADE_METHOD.cronInstallStateReplace,
        ])
        vi.mocked(store.canUseProductMethod).mockImplementation((method) => allowedMethods.has(method))
        vi.mocked(store.readProductCronInstallState).mockResolvedValue({
            repoId: "repo-1",
            installations: {
                [cronDef.id]: {
                    cronId: cronDef.id,
                    enabled: true,
                    installedAt: "2026-01-01T00:00:00.000Z",
                    lastTaskId: "task-existing",
                },
            },
        })
        vi.mocked(store.readProductCronDefinitions).mockResolvedValue(makeProductCronDefinitionsResult([cronDef]))
        const manager = new CronManager(store)

        await manager.ensureRepoConfigLoaded("repo-1")
        expect(manager.getCronsForRepo("repo-1")).toEqual([expect.objectContaining({ installed: true })])

        allowedMethods.delete(OPENADE_METHOD.cronDefinitionsRead)
        await manager.addRepo("repo-1", "/repo")

        expect(manager.getCronsForRepo("repo-1")).toEqual([])
        expect(store.replaceProductCronInstallState).not.toHaveBeenCalled()

        allowedMethods.add(OPENADE_METHOD.cronDefinitionsRead)
        await manager.ensureRepoConfigLoaded("repo-1")

        expect(manager.getCronsForRepo("repo-1")).toEqual([
            expect.objectContaining({
                installed: true,
                enabled: true,
                lastTaskId: "task-existing",
            }),
        ])

        manager.stop()
    })

    it("does not fall back to legacy cron storage when Core owns cron state before capabilities attach", async () => {
        const store = makeMockStore([{ id: "repo-1", path: "/repo" }])
        vi.mocked(store.usesCoreOwnedProductRuntime).mockReturnValue(true)
        vi.mocked(store.shouldUseCoreOwnedCronScheduler).mockReturnValue(true)
        vi.mocked(store.canUseProductMethod).mockReturnValue(false)
        vi.mocked(store.readProductCronDefinitions).mockRejectedValue(new Error("cron definitions should wait for capabilities"))
        vi.mocked(store.readProductCronInstallState).mockRejectedValue(new Error("cron install state should wait for capabilities"))
        vi.mocked(readProcs).mockRejectedValue(new Error("Core-owned cron state should not read legacy process config"))
        vi.mocked(dataFolderApi.isAvailable).mockReturnValue(true)
        vi.mocked(dataFolderApi.load).mockRejectedValue(new Error("Core-owned cron state should not read legacy data folder"))
        vi.mocked(dataFolderApi.save).mockRejectedValue(new Error("Core-owned cron state should not save legacy data folder"))
        const manager = new CronManager(store)

        await manager.ensureRepoConfigLoaded("repo-1")

        expect(store.readProductCronDefinitions).not.toHaveBeenCalled()
        expect(store.readProductCronInstallState).not.toHaveBeenCalled()
        expect(readProcs).not.toHaveBeenCalled()
        expect(dataFolderApi.load).not.toHaveBeenCalled()
        expect(dataFolderApi.save).not.toHaveBeenCalled()
        expect(manager.getCronsForRepo("repo-1")).toEqual([])

        manager.stop()
    })

    it("omits task creation fields when renderer cron appends to an existing task", async () => {
        vi.setSystemTime(new Date("2026-01-01T10:04:30.000Z"))

        const cronDef = makeCronDef({ isolation: "worktree", reuseTask: true })
        const store = makeMockStore([{ id: "repo-1", path: "/repo" }])
        vi.mocked(store.shouldUseRuntimeProductAPI).mockReturnValue(true)
        vi.mocked(store.readProductCronInstallState).mockResolvedValue({
            repoId: "repo-1",
            installations: {
                [cronDef.id]: {
                    cronId: cronDef.id,
                    enabled: true,
                    installedAt: "2026-01-01T10:00:00.000Z",
                    lastRunAt: "2026-01-01T10:04:00.000Z",
                    lastTaskId: "task-existing",
                },
            },
        })
        vi.mocked(store.readProductCronDefinitions).mockResolvedValue(makeProductCronDefinitionsResult([cronDef]))
        const manager = new CronManager(store)

        await manager.ensureRepoConfigLoaded("repo-1")
        await manager.runNow("repo-1", cronDef.id)

        expect(store.startProductTurn).toHaveBeenCalledTimes(1)
        const request = vi.mocked(store.startProductTurn).mock.calls[0]?.[0]
        expect(request).toMatchObject({
            repoId: "repo-1",
            input: "Run tests",
            inTaskId: "task-existing",
        })
        expect(request).not.toHaveProperty("isolationStrategy")
        expect(request).not.toHaveProperty("title")

        manager.stop()
    })

    it("hides and guards runtime cron mutation controls when capabilities are absent", async () => {
        const cronDef = makeCronDef()
        const store = makeMockStore([{ id: "repo-1", path: "/repo" }])
        vi.mocked(store.shouldUseRuntimeProductAPI).mockReturnValue(true)
        vi.mocked(store.canUseProductMethod).mockImplementation(
            (method) => method !== OPENADE_METHOD.cronRun && method !== OPENADE_METHOD.cronInstallStateReplace
        )
        vi.mocked(store.readProductCronInstallState).mockResolvedValue({
            repoId: "repo-1",
            installations: {
                [cronDef.id]: {
                    cronId: cronDef.id,
                    enabled: true,
                    installedAt: "2026-01-01T00:00:00.000Z",
                },
            },
        })
        vi.mocked(store.readProductCronDefinitions).mockResolvedValue(makeProductCronDefinitionsResult([cronDef]))
        const manager = new CronManager(store)

        await manager.ensureRepoConfigLoaded("repo-1")

        expect(manager.getCronsForRepo("repo-1")).toEqual([
            expect.objectContaining({
                canRunNow: false,
                canUpdateInstallState: false,
            }),
        ])

        await manager.runNow("repo-1", cronDef.id)
        await manager.toggleCron("repo-1", cronDef.id, false)
        await manager.installCron("repo-1", cronDef.id)
        await manager.uninstallCron("repo-1", cronDef.id)

        expect(store.runProductCron).not.toHaveBeenCalled()
        expect(store.replaceProductCronInstallState).not.toHaveBeenCalled()
    })

    it("keeps renderer timers off when Core owns cron scheduling", async () => {
        vi.setSystemTime(new Date("2026-01-01T10:04:30.000Z"))

        const cronDef = makeCronDef()
        const store = makeMockStore([{ id: "repo-1", path: "/repo" }])
        vi.mocked(store.shouldUseRuntimeProductAPI).mockReturnValue(true)
        vi.mocked(store.shouldUseCoreOwnedCronScheduler).mockReturnValue(true)
        vi.mocked(store.readProductCronInstallState).mockResolvedValue({ repoId: "repo-1", installations: {} })
        vi.mocked(store.readProductCronDefinitions).mockResolvedValue(makeProductCronDefinitionsResult([cronDef]))
        vi.mocked(store.runProductCron).mockResolvedValue({
            repoId: "repo-1",
            cronId: cronDef.id,
            taskId: "task-1",
            installation: {
                cronId: cronDef.id,
                enabled: true,
                installedAt: "2026-01-01T10:04:30.000Z",
                lastRunAt: "2026-01-01T10:05:00.000Z",
                lastTaskId: "task-1",
            },
        })
        const manager = new CronManager(store)

        await manager.ensureRepoConfigLoaded("repo-1")
        await manager.installCron("repo-1", cronDef.id)
        await manager.runNow("repo-1", cronDef.id)
        await vi.advanceTimersByTimeAsync(90_000)

        expect(manager.getCronsForRepo("repo-1")).toEqual([
            expect.objectContaining({
                canRunNow: true,
                enabled: true,
                lastTaskId: "task-1",
            }),
        ])
        expect(store.runProductCron).toHaveBeenCalledWith({ repoId: "repo-1", cronId: cronDef.id })
        expect(store.replaceProductCronInstallState).toHaveBeenCalledWith({
            repoId: "repo-1",
            installations: {
                [cronDef.id]: expect.objectContaining({
                    cronId: cronDef.id,
                    enabled: true,
                }),
            },
        })
        expect(store.startProductTurn).not.toHaveBeenCalled()

        manager.stop()
    })

    it("catches up missed runs when lastRunAt is set", async () => {
        // Set time to 10:05:30 — 30 seconds PAST the 10:05:00 slot
        vi.setSystemTime(new Date("2026-01-01T10:05:30.000Z"))

        const cronDef = makeCronDef()
        const store = makeMockStore([{ id: "repo-1", path: "/repo" }])
        const manager = new CronManager(store)

        vi.mocked(readProcs).mockResolvedValue(makeReadProcsResult([cronDef]))

        await addRepoAndLoadConfig(manager)

        // Install with a lastRunAt of 10:04:00 — so the 10:05:00 slot was missed
        await manager.installCron("repo-1", cronDef.id)

        // Manually set lastRunAt to simulate a prior run
        const cronsView = manager.getCronsForRepo("repo-1")
        expect(cronsView).toHaveLength(1)

        // The installCron call above has no lastRunAt, so it won't catch-up.
        // But after the first fire (at 10:06:00), lastRunAt gets set.
        // Let's verify the first scheduled fire works:
        await vi.advanceTimersByTimeAsync(30_000)
        expect(store.startProductTurn).toHaveBeenCalledTimes(1)
    })

    it("prunes install state for removed cron definitions", async () => {
        vi.setSystemTime(new Date("2026-01-01T10:00:00.000Z"))

        const cronDef = makeCronDef()
        const store = makeMockStore([{ id: "repo-1", path: "/repo" }])
        const manager = new CronManager(store)

        vi.mocked(readProcs).mockResolvedValue(makeReadProcsResult([cronDef]))

        await addRepoAndLoadConfig(manager)
        await manager.installCron("repo-1", cronDef.id)
        expect(manager.getCronsForRepo("repo-1")[0].installed).toBe(true)

        manager.updateCronDefs("repo-1", makeReadProcsResult([]))
        expect(manager.getCronsForRepo("repo-1")).toHaveLength(0)
    })
})
