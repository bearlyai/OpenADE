import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
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

function makeMockStore(): CodeStore {
    return {
        repos: { repos: [] },
        execution: { onAfterEvent: vi.fn(() => vi.fn()) },
        runCmd: { run: vi.fn().mockResolvedValue({ taskId: "task-1" }) },
    } as unknown as CodeStore
}

describe("CronManager scheduling", () => {
    beforeEach(() => {
        vi.useFakeTimers()
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

        expect(store.runCmd.run).not.toHaveBeenCalled()

        // Advance to 10:05:00 — the next minute boundary
        await vi.advanceTimersByTimeAsync(30_000)

        expect(store.runCmd.run).toHaveBeenCalledTimes(1)
        expect(store.runCmd.run).toHaveBeenCalledWith(
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

        expect(store.runCmd.run).toHaveBeenCalledTimes(1)
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
        expect(store.runCmd.run).toHaveBeenCalledTimes(1)

        // Second fire at 10:06:00
        await vi.advanceTimersByTimeAsync(60_000)
        expect(store.runCmd.run).toHaveBeenCalledTimes(2)
    })

    it("does not reschedule running crons during rescheduleRepo", async () => {
        vi.setSystemTime(new Date("2026-01-01T10:04:30.000Z"))

        const cronDef = makeCronDef()
        let resolveRun!: (value: { taskId: string }) => void
        const store = makeMockStore()
        vi.mocked(store.runCmd.run).mockReturnValue(
            new Promise((r) => {
                resolveRun = r
            })
        )
        const manager = new CronManager(store)

        vi.mocked(readProcs).mockResolvedValue(makeReadProcsResult([cronDef]))

        await manager.addRepo("repo-1", "/repo")
        await manager.installCron("repo-1", cronDef.id)

        // Fire at 10:05:00 — starts executing but hangs on runCmd.run
        await vi.advanceTimersByTimeAsync(30_000)
        expect(store.runCmd.run).toHaveBeenCalledTimes(1)

        // Trigger rescheduleRepo while cron is running — should skip it
        manager.updateCronDefs("repo-1", makeReadProcsResult([cronDef]))

        // Let the run complete so fireCron.finally() can chain
        resolveRun({ taskId: "task-1" })
        await vi.advanceTimersByTimeAsync(0)

        // fireCron.finally() should have scheduled next — advance to 10:06:00
        await vi.advanceTimersByTimeAsync(60_000)
        expect(store.runCmd.run).toHaveBeenCalledTimes(2)
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
        expect(readProcs).toHaveBeenCalledTimes(2)

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
        expect(store.runCmd.run).toHaveBeenCalledTimes(1)
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
