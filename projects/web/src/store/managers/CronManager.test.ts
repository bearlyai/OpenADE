import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
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
    return {
        repos: { repos, getRepo: (repoId: string) => repos.find((repo) => repo.id === repoId) },
        execution: { onAfterEvent: vi.fn(() => vi.fn()) },
        refreshRepoStoreFromStorage: vi.fn().mockResolvedValue(undefined),
        refreshTaskStoreFromStorage: vi.fn().mockResolvedValue(undefined),
        refreshProductStateAfterTaskMutation: vi.fn().mockResolvedValue(undefined),
        refreshProductStateAfterTaskCreation: vi.fn().mockResolvedValue(undefined),
        getTaskStore: vi.fn().mockResolvedValue(undefined),
        shouldUseRuntimeProductAPI: vi.fn(() => false),
        shouldUseCoreOwnedCronScheduler: vi.fn(() => false),
        listProductProjectProcesses: vi.fn(),
        readProductCronDefinitions: vi.fn(),
        readProductCronInstallState: vi.fn().mockResolvedValue({ repoId: "repo-1", installations: {} }),
        replaceProductCronInstallState: vi.fn().mockResolvedValue({
            repoId: "repo-1",
            installations: {},
            replacedInstallations: 0,
        }),
        startProductTurn: vi.fn().mockResolvedValue({ taskId: "task-1" }),
    } as unknown as CodeStore
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
        const store = makeMockStore()
        const manager = new CronManager(store)

        vi.mocked(readProcs).mockResolvedValue(makeReadProcsResult([cronDef]))

        await manager.addRepo("repo-1", "/repo")
        await manager.installCron("repo-1", cronDef.id)

        expect(store.startProductTurn).not.toHaveBeenCalled()

        // Advance to 10:05:00 — the next minute boundary
        await vi.advanceTimersByTimeAsync(30_000)

        expect(store.startProductTurn).toHaveBeenCalledTimes(1)
        expect(store.startProductTurn).toHaveBeenCalledWith(
            expect.objectContaining({
                repoId: "repo-1",
                input: "Run tests",
                title: "[Cron] Test Cron",
            })
        )
    })

    it("fires when timer callback is slightly late", async () => {
        vi.setSystemTime(new Date("2026-01-01T10:04:30.000Z"))

        const cronDef = makeCronDef()
        const store = makeMockStore()
        const manager = new CronManager(store)

        vi.mocked(readProcs).mockResolvedValue(makeReadProcsResult([cronDef]))

        await manager.addRepo("repo-1", "/repo")
        await manager.installCron("repo-1", cronDef.id)

        // Advance 500ms past the target (simulating late callback)
        await vi.advanceTimersByTimeAsync(30_500)

        expect(store.startProductTurn).toHaveBeenCalledTimes(1)
    })

    it("chains next occurrence after firing", async () => {
        vi.setSystemTime(new Date("2026-01-01T10:04:30.000Z"))

        const cronDef = makeCronDef()
        const store = makeMockStore()
        const manager = new CronManager(store)

        vi.mocked(readProcs).mockResolvedValue(makeReadProcsResult([cronDef]))

        await manager.addRepo("repo-1", "/repo")
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
        const store = makeMockStore()
        vi.mocked(store.startProductTurn).mockReturnValue(
            new Promise((r) => {
                resolveRun = r
            })
        )
        const manager = new CronManager(store)

        vi.mocked(readProcs).mockResolvedValue(makeReadProcsResult([cronDef]))

        await manager.addRepo("repo-1", "/repo")
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
        const store = makeMockStore()
        const manager = new CronManager(store)

        vi.mocked(readProcs).mockResolvedValue(makeReadProcsResult([cronDef]))

        // addRepo calls readProcs once
        await manager.addRepo("repo-1", "/repo")
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

    it("bounds concurrent procs refreshes for repos with installed crons", async () => {
        const store = makeMockStore([
            { id: "repo-1", path: "/repo-1" },
            { id: "repo-2", path: "/repo-2" },
            { id: "repo-3", path: "/repo-3" },
            { id: "repo-4", path: "/repo-4" },
        ])
        vi.mocked(dataFolderApi.isAvailable).mockReturnValue(true)
        vi.mocked(dataFolderApi.load).mockResolvedValue(
            JSON.stringify({
                installations: {
                    "openade.toml::test-cron": {
                        cronId: "openade.toml::test-cron",
                        enabled: true,
                        installedAt: "2026-01-01T00:00:00.000Z",
                    },
                },
            })
        )
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

        const addRepo = manager.addRepo("repo-1", "/repo")
        await vi.waitFor(() => expect(readProcs).toHaveBeenCalledTimes(1))
        const ensureLoaded = manager.ensureRepoConfigLoaded("repo-1")

        expect(readProcs).toHaveBeenCalledTimes(1)

        resolveRead(makeReadProcsResult([cronDef]))
        await Promise.all([addRepo, ensureLoaded])

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

        await manager.addRepo("repo-1", "/repo")

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

    it("keeps renderer timers off when Core owns cron scheduling", async () => {
        vi.setSystemTime(new Date("2026-01-01T10:04:30.000Z"))

        const cronDef = makeCronDef()
        const store = makeMockStore([{ id: "repo-1", path: "/repo" }])
        vi.mocked(store.shouldUseRuntimeProductAPI).mockReturnValue(true)
        vi.mocked(store.shouldUseCoreOwnedCronScheduler).mockReturnValue(true)
        vi.mocked(store.readProductCronInstallState).mockResolvedValue({ repoId: "repo-1", installations: {} })
        vi.mocked(store.readProductCronDefinitions).mockResolvedValue(makeProductCronDefinitionsResult([cronDef]))
        const manager = new CronManager(store)

        await manager.addRepo("repo-1", "/repo")
        await manager.installCron("repo-1", cronDef.id)
        await vi.advanceTimersByTimeAsync(90_000)

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
        const store = makeMockStore()
        const manager = new CronManager(store)

        vi.mocked(readProcs).mockResolvedValue(makeReadProcsResult([cronDef]))

        await manager.addRepo("repo-1", "/repo")

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
        const store = makeMockStore()
        const manager = new CronManager(store)

        vi.mocked(readProcs).mockResolvedValue(makeReadProcsResult([cronDef]))

        await manager.addRepo("repo-1", "/repo")
        await manager.installCron("repo-1", cronDef.id)
        expect(manager.getCronsForRepo("repo-1")[0].installed).toBe(true)

        manager.updateCronDefs("repo-1", makeReadProcsResult([]))
        expect(manager.getCronsForRepo("repo-1")).toHaveLength(0)
    })
})
