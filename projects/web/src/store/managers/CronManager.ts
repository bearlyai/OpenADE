/**
 * CronManager
 *
 * Manages cron job definitions, per-machine install state, scheduling,
 * and catch-up execution across ALL workspaces. Uses RunCmdManager.run()
 * to execute cron tasks.
 *
 * Scheduling: Each enabled cron gets its own setTimeout targeting a
 * specific timestamp computed via croner's nextRun(). When the timer
 * fires it calls fireCron() directly (rather than recomputing nextRun(),
 * which would skip the current slot). For delays exceeding ~24.8 days,
 * intermediate timeouts chain via scheduleTimerForTarget(). After
 * execution, fireCron().finally() chains to the next occurrence.
 *
 * Refresh events (task completion, window focus) are debounced to avoid
 * cancelling/recreating timers on every event.
 *
 * Cron state is persisted in ~/.openade/data/cron/{repoId}.json via the data folder API.
 */

import { Cron } from "croner"
import { makeAutoObservable, observable, runInAction } from "mobx"
import { dataFolderApi } from "../../electronAPI/dataFolder"
import type { CronDef, ReadProcsResult } from "../../electronAPI/procs"
import { readProcs } from "../../electronAPI/procs"
import type { HarnessId, RunCmdArgs } from "../../types"
import type { CodeStore } from "../store"

// ============================================================================
// Cron Install State (persisted per machine in data folder)
// ============================================================================

export interface CronInstallState {
    cronId: string
    enabled: boolean
    installedAt: string
    lastRunAt?: string
    lastTaskId?: string
}

interface PersistedCronState {
    installations: Record<string, CronInstallState>
}

// ============================================================================
// Cron View Model (for sidebar display)
// ============================================================================

export interface CronViewModel {
    def: CronDef
    repoId: string
    installed: boolean
    enabled: boolean
    running: boolean
    nextRunAt: Date | null
    lastRunAt?: string
    lastTaskId?: string
    configFilePath: string
}

// ============================================================================
// Per-repo state
// ============================================================================

interface RepoState {
    repoId: string
    repoPath: string
    cronDefs: Map<string, { def: CronDef; configFilePath: string }>
    installStates: Map<string, CronInstallState>
}

// Max safe delay for setTimeout (~24.8 days). Longer delays get chained.
const MAX_TIMEOUT_DELAY = 0x7fffffff

// ============================================================================
// CronManager
// ============================================================================

export class CronManager {
    private runningCrons = new Set<string>()
    private _repos = new Map<string, RepoState>()
    private _timers = new Map<string, ReturnType<typeof setTimeout>>()
    private _started = false
    private _afterEventDisposer: (() => void) | null = null
    private _focusHandler: (() => void) | null = null
    private _refreshDebounceTimer: ReturnType<typeof setTimeout> | null = null
    private _refreshInFlight = false
    private _refreshPendingAgain = false

    constructor(private store: CodeStore) {
        makeAutoObservable<CronManager, "store">(this, { store: false })
    }

    /** Start cron tracking for all repos */
    async startAll(): Promise<void> {
        if (this._started) return
        this._started = true

        const repos = this.store.repos.repos
        await Promise.all(repos.map((repo) => this.addRepo(repo.id, repo.path)))

        // Refresh config after any task event completes (e.g. a plan that edits openade.toml)
        this._afterEventDisposer = this.store.execution.onAfterEvent(() => {
            this.requestRefresh()
        })

        // Refresh config + reschedule when window regains focus (catches sleep/wake misses)
        this._focusHandler = () => this.requestRefresh()
        window.addEventListener("focus", this._focusHandler)
    }

    /** Add or refresh a single repo */
    async addRepo(repoId: string, repoPath: string): Promise<void> {
        let repoState = this._repos.get(repoId)
        if (!repoState) {
            repoState = {
                repoId,
                repoPath,
                cronDefs: observable.map(),
                installStates: observable.map(),
            }
            this._repos.set(repoId, repoState)
            await this.loadInstallStates(repoState)
        }
        await this.refreshRepoConfig(repoState)
        this.rescheduleRepo(repoState)
    }

    stop(): void {
        this.cancelAllTimers()
        if (this._refreshDebounceTimer) {
            clearTimeout(this._refreshDebounceTimer)
            this._refreshDebounceTimer = null
        }
        this._refreshInFlight = false
        this._refreshPendingAgain = false
        if (this._afterEventDisposer) {
            this._afterEventDisposer()
            this._afterEventDisposer = null
        }
        if (this._focusHandler) {
            window.removeEventListener("focus", this._focusHandler)
            this._focusHandler = null
        }
        this._started = false
        this._repos.clear()
        this.runningCrons.clear()
    }

    get started(): boolean {
        return this._started
    }

    /** Called when procs config is refreshed externally (e.g. ProcessesTray) */
    updateCronDefs(repoId: string, result: ReadProcsResult): void {
        const repoState = this._repos.get(repoId)
        if (!repoState) return
        this.applyProcsResult(repoState, result)
        this.rescheduleRepo(repoState)
    }

    /** Get view models for sidebar display for a specific repo */
    getCronsForRepo(repoId: string): CronViewModel[] {
        const repoState = this._repos.get(repoId)
        if (!repoState) return []

        return Array.from(repoState.cronDefs.values()).map(({ def, configFilePath }) => {
            const state = repoState.installStates.get(def.id)
            let nextRunAt: Date | null = null
            try {
                const job = new Cron(def.schedule)
                nextRunAt = job.nextRun() ?? null
            } catch {
                // invalid schedule
            }

            return {
                def,
                repoId,
                installed: !!state,
                enabled: state?.enabled ?? false,
                running: this.runningCrons.has(`${repoId}::${def.id}`),
                nextRunAt,
                lastRunAt: state?.lastRunAt,
                lastTaskId: state?.lastTaskId,
                configFilePath,
            }
        })
    }

    // ============================================================================
    // Install / Toggle / Run Now
    // ============================================================================

    async installCron(repoId: string, cronId: string): Promise<void> {
        const repoState = this._repos.get(repoId)
        if (!repoState) return

        const state: CronInstallState = {
            cronId,
            enabled: true,
            installedAt: new Date().toISOString(),
        }
        runInAction(() => {
            repoState.installStates.set(cronId, state)
        })
        await this.saveInstallStates(repoState)

        const entry = repoState.cronDefs.get(cronId)
        if (entry) this.scheduleCron(repoState, cronId, entry.def)
    }

    async uninstallCron(repoId: string, cronId: string): Promise<void> {
        const repoState = this._repos.get(repoId)
        if (!repoState) return

        this.cancelTimer(`${repoId}::${cronId}`)
        runInAction(() => {
            repoState.installStates.delete(cronId)
        })
        await this.saveInstallStates(repoState)
    }

    async toggleCron(repoId: string, cronId: string, enabled: boolean): Promise<void> {
        const repoState = this._repos.get(repoId)
        if (!repoState) return

        const state = repoState.installStates.get(cronId)
        if (!state) return

        runInAction(() => {
            state.enabled = enabled
        })
        await this.saveInstallStates(repoState)

        if (enabled) {
            const entry = repoState.cronDefs.get(cronId)
            if (entry) this.scheduleCron(repoState, cronId, entry.def)
        } else {
            this.cancelTimer(`${repoId}::${cronId}`)
        }
    }

    /** Immediately execute a cron job regardless of schedule */
    async runNow(repoId: string, cronId: string): Promise<void> {
        const repoState = this._repos.get(repoId)
        if (!repoState) return

        const entry = repoState.cronDefs.get(cronId)
        if (!entry) return

        await this.executeCron(repoState, cronId, entry.def)
    }

    // ============================================================================
    // Config refresh
    // ============================================================================

    private requestRefresh(): void {
        if (this._refreshDebounceTimer) clearTimeout(this._refreshDebounceTimer)
        this._refreshDebounceTimer = setTimeout(() => {
            this._refreshDebounceTimer = null
            this.debouncedRefresh()
        }, 3_000)
    }

    private async debouncedRefresh(): Promise<void> {
        if (this._refreshInFlight) {
            this._refreshPendingAgain = true
            return
        }
        this._refreshInFlight = true
        try {
            await this.refreshAndRescheduleAll()
        } finally {
            this._refreshInFlight = false
            if (this._refreshPendingAgain) {
                this._refreshPendingAgain = false
                this.debouncedRefresh()
            }
        }
    }

    private async refreshAndRescheduleAll(): Promise<void> {
        await Promise.all(
            Array.from(this._repos.values()).map(async (rs) => {
                await this.refreshRepoConfig(rs)
                this.rescheduleRepo(rs)
            })
        )
    }

    private async refreshRepoConfig(repoState: RepoState): Promise<void> {
        try {
            const result = await readProcs(repoState.repoPath)
            this.applyProcsResult(repoState, result)
        } catch (err) {
            console.error(`[CronManager] Failed to refresh config for ${repoState.repoId}:`, err)
        }
    }

    private applyProcsResult(repoState: RepoState, result: ReadProcsResult): void {
        runInAction(() => {
            repoState.cronDefs.clear()
            for (const config of result.configs) {
                for (const cron of config.crons) {
                    repoState.cronDefs.set(cron.id, {
                        def: cron,
                        configFilePath: `${result.repoRoot}/${config.relativePath}`,
                    })
                }
            }
        })
        this.pruneStaleInstallStates(repoState)
    }

    private pruneStaleInstallStates(repoState: RepoState): void {
        let removed = false
        runInAction(() => {
            for (const cronId of repoState.installStates.keys()) {
                if (!repoState.cronDefs.has(cronId)) {
                    repoState.installStates.delete(cronId)
                    removed = true
                }
            }
        })

        if (removed) {
            void this.saveInstallStates(repoState)
        }
    }

    // ============================================================================
    // Persistence (data folder)
    // ============================================================================

    private async loadInstallStates(repoState: RepoState): Promise<void> {
        if (!dataFolderApi.isAvailable()) return

        try {
            const data = await dataFolderApi.load("cron", repoState.repoId, "json")
            if (!data) return

            const text = typeof data === "string" ? data : new TextDecoder().decode(data as ArrayBuffer)
            const parsed: PersistedCronState = JSON.parse(text)

            runInAction(() => {
                repoState.installStates.clear()
                for (const [key, state] of Object.entries(parsed.installations)) {
                    repoState.installStates.set(key, state)
                }
            })
        } catch (err) {
            console.error(`[CronManager] Failed to load install states for ${repoState.repoId}:`, err)
        }
    }

    private async saveInstallStates(repoState: RepoState): Promise<void> {
        if (!dataFolderApi.isAvailable()) return

        try {
            const data: PersistedCronState = {
                installations: Object.fromEntries(repoState.installStates),
            }
            await dataFolderApi.save("cron", repoState.repoId, JSON.stringify(data, null, 2), "json")
        } catch (err) {
            console.error(`[CronManager] Failed to save install states for ${repoState.repoId}:`, err)
        }
    }

    // ============================================================================
    // Scheduler — setTimeout per cron, no polling
    // ============================================================================

    /**
     * Core scheduling entry point for a single cron.
     *
     * 1. Catch-up: if lastRunAt exists and a scheduled time was missed, fire immediately.
     * 2. Otherwise compute nextRun() and delegate to scheduleTimerForTarget().
     */
    private scheduleCron(repoState: RepoState, cronId: string, def: CronDef): void {
        const key = `${repoState.repoId}::${cronId}`
        this.cancelTimer(key)

        const state = repoState.installStates.get(cronId)
        if (!state?.enabled) return

        try {
            const cron = new Cron(def.schedule)

            // Catch-up: was a scheduled run missed since the last execution?
            if (state.lastRunAt) {
                const nextAfterLast = cron.nextRun(new Date(state.lastRunAt))
                if (nextAfterLast && nextAfterLast.getTime() <= Date.now()) {
                    this.fireCron(repoState, cronId, def)
                    return
                }
            }

            // Schedule for the next future occurrence
            const next = cron.nextRun()
            if (!next) return

            this.scheduleTimerForTarget(repoState, cronId, def, next.getTime())
        } catch {
            // invalid schedule expression
        }
    }

    /**
     * Set a setTimeout targeting a specific timestamp. If the delay exceeds
     * MAX_TIMEOUT_DELAY (~24.8 days), chains intermediate timeouts.
     * When the target time is reached, fires the cron directly.
     */
    private scheduleTimerForTarget(repoState: RepoState, cronId: string, def: CronDef, targetMs: number): void {
        const key = `${repoState.repoId}::${cronId}`
        this.cancelTimer(key)

        const delay = targetMs - Date.now()
        if (delay <= 0) {
            this.fireCron(repoState, cronId, def)
            return
        }

        const clampedDelay = Math.min(delay, MAX_TIMEOUT_DELAY)

        this._timers.set(
            key,
            setTimeout(() => {
                this._timers.delete(key)
                if (Date.now() >= targetMs) {
                    this.fireCron(repoState, cronId, def)
                } else {
                    // MAX_TIMEOUT_DELAY chaining — not yet time to fire
                    this.scheduleTimerForTarget(repoState, cronId, def, targetMs)
                }
            }, clampedDelay)
        )
    }

    /**
     * Execution gatekeeper. Prevents concurrent runs of the same cron.
     * After execution completes, chains to the next scheduled occurrence.
     */
    private fireCron(repoState: RepoState, cronId: string, def: CronDef): void {
        const key = `${repoState.repoId}::${cronId}`

        if (this.runningCrons.has(key)) {
            // Previous invocation still running — skip, schedule next
            this.scheduleCron(repoState, cronId, def)
            return
        }

        this.executeCron(repoState, cronId, def).finally(() => {
            const state = repoState.installStates.get(cronId)
            if (state?.enabled) {
                this.scheduleCron(repoState, cronId, def)
            }
        })
    }

    /** Cancel a single cron's timer */
    private cancelTimer(key: string): void {
        const timer = this._timers.get(key)
        if (timer) {
            clearTimeout(timer)
            this._timers.delete(key)
        }
    }

    /** Cancel all timers */
    private cancelAllTimers(): void {
        for (const timer of this._timers.values()) {
            clearTimeout(timer)
        }
        this._timers.clear()
    }

    /** Cancel all timers for a repo and reschedule all its enabled crons */
    private rescheduleRepo(repoState: RepoState): void {
        // Cancel existing timers for this repo
        const prefix = `${repoState.repoId}::`
        for (const [key, timer] of this._timers) {
            if (key.startsWith(prefix)) {
                clearTimeout(timer)
                this._timers.delete(key)
            }
        }
        // Schedule all enabled crons (skip running ones — fireCron.finally() handles their rescheduling)
        for (const [cronId, { def }] of repoState.cronDefs) {
            const key = `${repoState.repoId}::${cronId}`
            if (this.runningCrons.has(key)) continue
            this.scheduleCron(repoState, cronId, def)
        }
    }

    // ============================================================================
    // Execution
    // ============================================================================

    private async executeCron(repoState: RepoState, cronId: string, def: CronDef): Promise<void> {
        const runKey = `${repoState.repoId}::${cronId}`
        if (this.runningCrons.has(runKey)) return

        runInAction(() => {
            this.runningCrons.add(runKey)
        })

        // Update lastRunAt immediately to prevent double-runs
        const state = repoState.installStates.get(cronId)
        if (state) {
            state.lastRunAt = new Date().toISOString()
            await this.saveInstallStates(repoState)
        }

        try {
            const args: RunCmdArgs = {
                repoId: repoState.repoId,
                type: def.type,
                input: def.prompt,
                appendSystemPrompt: def.appendSystemPrompt,
                inTaskId: def.inTaskId || undefined,
                isolationStrategy: def.isolation === "worktree" ? { type: "worktree", sourceBranch: "HEAD" } : { type: "head" },
                harnessId: (def.harness as HarnessId) || undefined,
                title: `[Cron] ${def.name}`,
            }

            const result = await this.store.runCmd.run(args)

            if (state) {
                state.lastTaskId = result.taskId
                await this.saveInstallStates(repoState)
            }

            console.debug(`[CronManager] Executed cron "${def.name}" -> task ${result.taskId}`)
        } catch (err) {
            console.error(`[CronManager] Failed to execute cron "${def.name}":`, err)
        } finally {
            runInAction(() => {
                this.runningCrons.delete(runKey)
            })
        }
    }
}
