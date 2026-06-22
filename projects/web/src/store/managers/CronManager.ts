/**
 * CronManager
 *
 * Manages cron job definitions, per-machine install state, scheduling,
 * and catch-up execution across ALL workspaces. Uses openade-client to start
 * server-owned cron turns.
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
 * Runtime-backed cron state is persisted through OpenADE product APIs.
 * Legacy renderer scheduling falls back to ~/.openade/data/cron/{repoId}.json
 * only when the product runtime does not own cron state.
 */

import { Cron } from "croner"
import { makeAutoObservable, observable, runInAction } from "mobx"
import { OPENADE_METHOD } from "../../../../openade-client/src"
import type { OpenADECronInstallState, OpenADETurnStartRequest } from "../../../../openade-module/src"
import { dataFolderApi } from "../../electronAPI/dataFolder"
import type { CronDef, ReadProcsResult } from "../../electronAPI/procs"
import { readProcs } from "../../electronAPI/procs"
import type { HarnessId } from "../../types"
import { readProcsResultFromProductCronDefinitions } from "../projectProcessReadResult"
import type { CodeStore } from "../store"

// ============================================================================
// Cron Install State (persisted per machine in data folder)
// ============================================================================

export type CronInstallState = OpenADECronInstallState

interface PersistedCronState {
    installations: Record<string, CronInstallState>
}

interface PersistedCronInstallIndex {
    version: 1
    repoIds: string[]
}

function isPersistedCronInstallIndex(value: unknown): value is PersistedCronInstallIndex {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false
    const record = value as Record<string, unknown>
    return record.version === 1 && Array.isArray(record.repoIds) && record.repoIds.every((repoId) => typeof repoId === "string" && repoId.length > 0)
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
    canRunNow: boolean
    canUpdateInstallState: boolean
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
    configLoaded: boolean
    installStateLoaded: boolean
}

// Max safe delay for setTimeout (~24.8 days). Longer delays get chained.
const MAX_TIMEOUT_DELAY = 0x7fffffff
const PROCS_REFRESH_CONCURRENCY = 2
const FOCUS_PROCS_REFRESH_MIN_INTERVAL_MS = 60_000
const LEGACY_CRON_INSTALL_INDEX_ID = "_index"

async function runWithConcurrencyLimit<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
    let index = 0
    const workerCount = Math.max(1, Math.min(limit, items.length))
    await Promise.all(
        Array.from({ length: workerCount }, async () => {
            while (index < items.length) {
                const item = items[index]
                index += 1
                await worker(item)
            }
        })
    )
}

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
    private _configLoadInFlight = new Map<string, Promise<void>>()
    private _refreshInFlight = false
    private _refreshPendingAgain = false
    private _lastConfigRefreshAt = 0

    constructor(private store: CodeStore) {
        makeAutoObservable<CronManager, "store">(this, { store: false })
    }

    /** Start cron tracking for all repos */
    async startAll(): Promise<void> {
        if (this.stopIfProductRuntimeOwnsScheduling()) return
        if (this._started) return
        this._started = true

        const repos = this.store.repos.repos
        const indexedRepoIds = this.productRuntimeOwnsCrons() ? await this.loadProductCronInstallStateRepoIds() : await this.loadLegacyCronInstallIndex()
        const reposToLoadInstallState = repos.filter((repo) => indexedRepoIds.has(repo.id))

        if (this.stopIfProductRuntimeOwnsScheduling()) return
        await runWithConcurrencyLimit(reposToLoadInstallState, PROCS_REFRESH_CONCURRENCY, async (repo) => {
            if (this.stopIfProductRuntimeOwnsScheduling()) return
            await this.ensureRepoState(repo.id, repo.path)
        })
        if (this.stopIfProductRuntimeOwnsScheduling()) return
        const reposWithInstalledCrons = Array.from(this._repos.values()).filter((repoState) => repoState.installStates.size > 0)
        await runWithConcurrencyLimit(reposWithInstalledCrons, PROCS_REFRESH_CONCURRENCY, async (repoState) => {
            if (this.stopIfProductRuntimeOwnsScheduling()) return
            await this.refreshRepoConfig(repoState)
            if (this.stopIfProductRuntimeOwnsScheduling()) return
            this.rescheduleRepo(repoState)
        })
        if (this.stopIfProductRuntimeOwnsScheduling()) return

        // Refresh config after task events complete (e.g. a plan that edits openade.toml)
        this._afterEventDisposer = this.store.execution.onAfterEvent(() => {
            this.requestRefresh()
        })

        // Refresh config + reschedule when window regains focus (catches sleep/wake misses)
        this._focusHandler = () => this.requestFocusRefresh()
        window.addEventListener("focus", this._focusHandler)
    }

    /** Add or refresh a single repo */
    async addRepo(repoId: string, repoPath: string): Promise<void> {
        if (this.stopIfProductRuntimeOwnsScheduling()) return

        const repoState = await this.ensureRepoState(repoId, repoPath)
        if (this.stopIfProductRuntimeOwnsScheduling()) return
        if (!repoState.configLoaded && repoState.installStates.size === 0) return

        await this.refreshRepoConfig(repoState)
        if (this.stopIfProductRuntimeOwnsScheduling()) return
        this.rescheduleRepo(repoState)
    }

    async ensureRepoConfigLoaded(repoId: string): Promise<void> {
        const repo = this.store.repos.getRepo(repoId)
        if (!repo) return

        const repoState = await this.ensureRepoState(repo.id, repo.path)
        if (repoState.configLoaded) return

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
        this._configLoadInFlight.clear()
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
        runInAction(() => {
            repoState.configLoaded = true
        })
        this.applyProcsResult(repoState, result)
        this.rescheduleRepo(repoState)
    }

    /** Get view models for sidebar display for a specific repo */
    getCronsForRepo(repoId: string): CronViewModel[] {
        if (this.productRuntimeOwnsCrons() && !this.store.canUseProductMethod(OPENADE_METHOD.cronDefinitionsRead)) return []

        const repoState = this._repos.get(repoId)
        if (!repoState) return []

        const canRunNow = this.canRunNow()
        const canUpdateInstallState = this.canUpdateInstallState()
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
                canRunNow,
                canUpdateInstallState,
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
        if (!this.canUpdateInstallState()) return

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
        if (!this.canUpdateInstallState()) return

        const repoState = this._repos.get(repoId)
        if (!repoState) return

        this.cancelTimer(`${repoId}::${cronId}`)
        runInAction(() => {
            repoState.installStates.delete(cronId)
        })
        await this.saveInstallStates(repoState)
    }

    async toggleCron(repoId: string, cronId: string, enabled: boolean): Promise<void> {
        if (!this.canUpdateInstallState()) return

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
        if (!this.canRunNow()) return

        if (this.store.shouldUseCoreOwnedCronScheduler()) {
            await this.runCoreCronNow(repoId, cronId)
            return
        }
        const repoState = this._repos.get(repoId)
        if (!repoState) return

        const entry = repoState.cronDefs.get(cronId)
        if (!entry) return

        await this.executeCron(repoState, cronId, entry.def)
    }

    private async runCoreCronNow(repoId: string, cronId: string): Promise<void> {
        const repoState = this._repos.get(repoId)
        try {
            const result = await this.store.runProductCron({ repoId, cronId })
            const installation = result.installation
            if (repoState && installation) {
                runInAction(() => {
                    repoState.installStates.set(result.cronId, installation)
                })
            }
        } catch (err) {
            console.error(`[CronManager] Failed to run product cron ${cronId}:`, err)
        }
    }

    private canRunNow(): boolean {
        return this.store.canUseProductMethod(OPENADE_METHOD.cronRun)
    }

    private canUpdateInstallState(): boolean {
        return this.store.canUseProductMethod(OPENADE_METHOD.cronInstallStateReplace)
    }

    private canUseProductCronMethodAfterConnect(method: Parameters<CodeStore["canUseProductMethodAfterConnect"]>[0]): Promise<boolean> {
        return this.store.canUseProductMethodAfterConnect(method)
    }

    private canStartCronTurn(): boolean {
        if (!this.productRuntimeOwnsCrons()) return true
        return this.store.canUseProductMethod(OPENADE_METHOD.turnStart)
    }

    private productRuntimeOwnsCrons(): boolean {
        return this.store.shouldUseRuntimeProductTaskRoute()
    }

    private productRuntimeOwnsScheduling(): boolean {
        return this.productRuntimeOwnsCrons() || this.store.shouldUseCoreOwnedCronScheduler()
    }

    // ============================================================================
    // Config refresh
    // ============================================================================

    private requestRefresh(): void {
        if (this.stopIfProductRuntimeOwnsScheduling()) return
        if (this._refreshDebounceTimer) clearTimeout(this._refreshDebounceTimer)
        this._refreshDebounceTimer = setTimeout(() => {
            this._refreshDebounceTimer = null
            this.debouncedRefresh()
        }, 3_000)
    }

    private requestFocusRefresh(): void {
        if (this.stopIfProductRuntimeOwnsScheduling()) return
        if (Date.now() - this._lastConfigRefreshAt < FOCUS_PROCS_REFRESH_MIN_INTERVAL_MS) return
        this.requestRefresh()
    }

    private async debouncedRefresh(): Promise<void> {
        if (this.stopIfProductRuntimeOwnsScheduling()) return
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
        if (this.stopIfProductRuntimeOwnsScheduling()) return
        const reposToRefresh = Array.from(this._repos.values()).filter(
            (repoState) => repoState.configLoaded || repoState.installStates.size > 0 || repoState.cronDefs.size > 0
        )
        await runWithConcurrencyLimit(reposToRefresh, PROCS_REFRESH_CONCURRENCY, async (rs) => {
            if (this.stopIfProductRuntimeOwnsScheduling()) return
            await this.refreshRepoConfig(rs)
            if (this.stopIfProductRuntimeOwnsScheduling()) return
            this.rescheduleRepo(rs)
        })
    }

    private async refreshRepoConfig(repoState: RepoState): Promise<void> {
        const existing = this._configLoadInFlight.get(repoState.repoId)
        if (existing) return existing

        const promise = this.refreshRepoConfigUncoalesced(repoState).finally(() => {
            this._configLoadInFlight.delete(repoState.repoId)
        })
        this._configLoadInFlight.set(repoState.repoId, promise)
        return promise
    }

    private stopIfProductRuntimeOwnsScheduling(): boolean {
        if (!this.productRuntimeOwnsScheduling()) return false
        this.stop()
        return true
    }

    private async refreshRepoConfigUncoalesced(repoState: RepoState): Promise<void> {
        try {
            if (this.productRuntimeOwnsCrons()) {
                if (!(await this.canUseProductCronMethodAfterConnect(OPENADE_METHOD.cronDefinitionsRead))) {
                    runInAction(() => {
                        repoState.cronDefs.clear()
                        repoState.configLoaded = false
                    })
                    this._lastConfigRefreshAt = Date.now()
                    return
                }
                const result = await this.store.readProductCronDefinitions({ repoId: repoState.repoId })
                this.applyProcsResult(repoState, readProcsResultFromProductCronDefinitions(result))
                runInAction(() => {
                    repoState.configLoaded = true
                })
                this._lastConfigRefreshAt = Date.now()
                return
            }
            const result = await readProcs(repoState.repoPath)
            this.applyProcsResult(repoState, result)
            runInAction(() => {
                repoState.configLoaded = true
            })
            this._lastConfigRefreshAt = Date.now()
        } catch (err) {
            console.error(`[CronManager] Failed to refresh config for ${repoState.repoId}:`, err)
        }
    }

    private async ensureRepoState(repoId: string, repoPath: string): Promise<RepoState> {
        let repoState = this._repos.get(repoId)
        if (repoState) {
            if (!repoState.installStateLoaded) await this.loadInstallStates(repoState)
            return repoState
        }

        repoState = {
            repoId,
            repoPath,
            cronDefs: observable.map(),
            installStates: observable.map(),
            configLoaded: false,
            installStateLoaded: false,
        }
        this._repos.set(repoId, repoState)
        await this.loadInstallStates(repoState)
        return repoState
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
    // Persistence
    // ============================================================================

    private async loadInstallStates(repoState: RepoState): Promise<void> {
        if (this.productRuntimeOwnsCrons()) {
            if (!(await this.canUseProductCronMethodAfterConnect(OPENADE_METHOD.cronInstallStateRead))) return
            try {
                const result = await this.store.readProductCronInstallState({ repoId: repoState.repoId })
                runInAction(() => {
                    repoState.installStates.clear()
                    for (const [key, state] of Object.entries(result.installations)) {
                        repoState.installStates.set(key, state)
                    }
                    repoState.installStateLoaded = true
                })
                return
            } catch (err) {
                console.error(`[CronManager] Failed to load product install states for ${repoState.repoId}:`, err)
                return
            }
        }

        if (!dataFolderApi.isAvailable()) {
            runInAction(() => {
                repoState.installStateLoaded = true
            })
            return
        }

        try {
            const data = await dataFolderApi.load("cron", repoState.repoId, "json")
            if (!data) {
                runInAction(() => {
                    repoState.installStateLoaded = true
                })
                return
            }

            const text = typeof data === "string" ? data : new TextDecoder().decode(data as ArrayBuffer)
            const parsed: PersistedCronState = JSON.parse(text)

            runInAction(() => {
                repoState.installStates.clear()
                for (const [key, state] of Object.entries(parsed.installations)) {
                    repoState.installStates.set(key, state)
                }
                repoState.installStateLoaded = true
            })
        } catch (err) {
            console.error(`[CronManager] Failed to load install states for ${repoState.repoId}:`, err)
            runInAction(() => {
                repoState.installStateLoaded = true
            })
        }
    }

    private async loadLegacyCronInstallIndex(options: { warnIfMissing?: boolean } = {}): Promise<Set<string>> {
        if (!dataFolderApi.isAvailable()) return new Set()

        try {
            const data = await dataFolderApi.load("cron", LEGACY_CRON_INSTALL_INDEX_ID, "json")
            if (!data) {
                if (options.warnIfMissing !== false) {
                    console.warn("[CronManager] Legacy cron install-state index unavailable; skipping automatic startup scheduling")
                }
                return new Set()
            }

            const text = typeof data === "string" ? data : new TextDecoder().decode(data as ArrayBuffer)
            const parsed: unknown = JSON.parse(text)
            if (!isPersistedCronInstallIndex(parsed)) {
                console.warn("[CronManager] Legacy cron install-state index invalid; skipping automatic startup scheduling")
                return new Set()
            }

            return new Set(parsed.repoIds)
        } catch (err) {
            console.warn("[CronManager] Failed to load legacy cron install index; skipping automatic startup scheduling:", err)
            return new Set()
        }
    }

    private async loadProductCronInstallStateRepoIds(): Promise<Set<string>> {
        if (!(await this.canUseProductCronMethodAfterConnect(OPENADE_METHOD.cronInstallStateList))) {
            console.warn("[CronManager] Product cron install-state index unavailable; skipping automatic startup scheduling")
            return new Set()
        }

        try {
            const result = await this.store.listProductCronInstallStateRepos()
            if (!result) return new Set()
            return new Set(result.repoIds)
        } catch (err) {
            console.warn("[CronManager] Failed to load product cron install-state repo index; skipping automatic startup scheduling:", err)
            return new Set()
        }
    }

    private async saveLegacyCronInstallIndex(repoIds: string[]): Promise<void> {
        if (!dataFolderApi.isAvailable()) return

        const uniqueRepoIds = Array.from(new Set(repoIds)).sort()
        const index: PersistedCronInstallIndex = { version: 1, repoIds: uniqueRepoIds }
        try {
            await dataFolderApi.save("cron", LEGACY_CRON_INSTALL_INDEX_ID, JSON.stringify(index, null, 2), "json")
        } catch (err) {
            console.warn("[CronManager] Failed to save legacy cron install index:", err)
        }
    }

    private async updateLegacyCronInstallIndexForRepo(repoState: RepoState): Promise<void> {
        const current = await this.loadLegacyCronInstallIndex({ warnIfMissing: false })
        if (repoState.installStates.size > 0) {
            current.add(repoState.repoId)
        } else {
            current.delete(repoState.repoId)
        }
        await this.saveLegacyCronInstallIndex(Array.from(current))
    }

    private async saveInstallStates(repoState: RepoState): Promise<void> {
        const data: PersistedCronState = {
            installations: Object.fromEntries(repoState.installStates),
        }

        if (this.productRuntimeOwnsCrons()) {
            if (!this.store.canUseProductMethod(OPENADE_METHOD.cronInstallStateReplace)) return
            try {
                await this.store.replaceProductCronInstallState({ repoId: repoState.repoId, installations: data.installations })
                return
            } catch (err) {
                console.error(`[CronManager] Failed to save product install states for ${repoState.repoId}:`, err)
                return
            }
        }

        if (!dataFolderApi.isAvailable()) return

        try {
            await dataFolderApi.save("cron", repoState.repoId, JSON.stringify(data, null, 2), "json")
            await this.updateLegacyCronInstallIndexForRepo(repoState)
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

        if (this.productRuntimeOwnsScheduling()) return

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
    private cancelRepoTimers(repoId: string): void {
        const prefix = `${repoId}::`
        for (const [key, timer] of this._timers) {
            if (key.startsWith(prefix)) {
                clearTimeout(timer)
                this._timers.delete(key)
            }
        }
    }

    /** Cancel all timers for a repo and reschedule all its enabled crons */
    private rescheduleRepo(repoState: RepoState): void {
        this.cancelRepoTimers(repoState.repoId)
        if (this.productRuntimeOwnsScheduling()) return
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
        if (!this.canStartCronTurn()) return

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
            const isolationStrategy: OpenADETurnStartRequest["isolationStrategy"] =
                def.isolation === "worktree" ? { type: "worktree", sourceBranch: "HEAD" } : { type: "head" }
            const inTaskId = def.inTaskId || (def.reuseTask && state?.lastTaskId) || undefined
            const args: OpenADETurnStartRequest = {
                repoId: repoState.repoId,
                type: def.type,
                input: def.prompt,
                appendSystemPrompt: def.appendSystemPrompt,
                harnessId: (def.harness as HarnessId) || undefined,
                hyperplanStrategy: def.type === "hyperplan" ? this.store.getActiveHyperPlanStrategy() : undefined,
            }
            if (inTaskId) {
                args.inTaskId = inTaskId
            } else {
                args.isolationStrategy = isolationStrategy
                args.title = `[Cron] ${def.name}`
            }

            const result = await this.store.startProductTurn(args)
            if (!this.productRuntimeOwnsCrons()) {
                if (args.inTaskId) {
                    await this.store.refreshProductStateAfterTaskMutation(result.taskId)
                } else {
                    await this.store.refreshProductStateAfterTaskCreation(repoState.repoId, result.taskId)
                }
            }

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
