/**
 * CronManager
 *
 * Manages cron job definitions, per-machine install state, scheduling,
 * and catch-up execution across ALL workspaces. Uses RunCmdManager.run()
 * to execute cron tasks.
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

// ============================================================================
// CronManager
// ============================================================================

export class CronManager {
    private intervalId: ReturnType<typeof setInterval> | null = null
    private runningCrons = new Set<string>()
    private _repos = new Map<string, RepoState>()
    private _started = false
    private _afterEventDisposer: (() => void) | null = null
    private _focusHandler: (() => void) | null = null

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
            this.refreshAllConfigs()
        })

        // Refresh config when window regains focus
        this._focusHandler = () => this.refreshAllConfigs()
        window.addEventListener("focus", this._focusHandler)

        // Run catch-up check immediately
        this.checkAllCrons()
        // Then check every 60 seconds
        this.intervalId = setInterval(() => this.checkAllCrons(), 60_000)
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
    }

    stop(): void {
        if (this.intervalId) {
            clearInterval(this.intervalId)
            this.intervalId = null
        }
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
    }

    async uninstallCron(repoId: string, cronId: string): Promise<void> {
        const repoState = this._repos.get(repoId)
        if (!repoState) return

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

    async refreshAllConfigs(): Promise<void> {
        await Promise.all(Array.from(this._repos.values()).map((rs) => this.refreshRepoConfig(rs)))
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
    // Scheduler
    // ============================================================================

    private checkAllCrons(): void {
        for (const repoState of this._repos.values()) {
            for (const [cronId, { def }] of repoState.cronDefs) {
                const state = repoState.installStates.get(cronId)
                if (!state?.enabled) continue

                try {
                    const job = new Cron(def.schedule)
                    const prev = job.previousRun()
                    const lastRun = state.lastRunAt ? new Date(state.lastRunAt) : null

                    // Run if the previous scheduled time is after the last run
                    if (prev && (!lastRun || prev > lastRun)) {
                        this.executeCron(repoState, cronId, def)
                    }
                } catch {
                    // invalid schedule, skip
                }
            }
        }
    }

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
