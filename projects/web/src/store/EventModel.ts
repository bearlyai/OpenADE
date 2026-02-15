/**
 * EventModel - Observable wrappers for CodeEvent
 *
 * Provides derived state and actions for events.
 * Models compute from store's tasksById - no caching needed.
 *
 * Note: We use decorators instead of makeAutoObservable because
 * subclasses (ActionEventModel, etc.) extend this class,
 * and makeAutoObservable doesn't work with inheritance.
 */

import { action, computed, observable, runInAction } from "mobx"
import { snapshotsApi } from "../electronAPI/snapshots"
import type { HyperPlanSubExecution } from "../hyperplan/types"
import type { ActionEvent, ActionEventSource, ClaudeStreamEvent, CodeEvent, SetupEnvironmentEvent, SnapshotEvent } from "../types"
import type { CodeStore } from "./store"

/**
 * Base EventModel - wraps any CodeEvent
 */
export class EventModel {
    constructor(
        protected store: CodeStore,
        protected taskId: string,
        public readonly eventId: string,
        public readonly isLast: boolean
    ) {}

    @computed
    protected get event(): CodeEvent | undefined {
        return this.store.tasks.tasksById.get(this.taskId)?.events.find((e) => e.id === this.eventId)
    }

    // === Raw accessors ===

    @computed
    get id(): string {
        return this.eventId
    }

    @computed
    get type(): "action" | "setup_environment" | "snapshot" {
        return this.event?.type ?? "action"
    }

    @computed
    get status(): "in_progress" | "completed" | "error" | "stopped" {
        return this.event?.status ?? "in_progress"
    }

    @computed
    get createdAt(): string {
        return this.event?.createdAt ?? ""
    }

    @computed
    get completedAt(): string | undefined {
        return this.event?.completedAt
    }

    @computed
    get userInput(): string {
        return this.event?.userInput ?? ""
    }

    @computed
    get events(): ClaudeStreamEvent[] {
        const event = this.event
        if (!event) return []
        // Only action events have execution with events
        if (event.type === "action") {
            return event.execution.events
        }
        return []
    }

    @computed
    get executionId(): string | undefined {
        const event = this.event
        if (!event) return undefined
        if (event.type === "action") {
            return event.execution.executionId
        }
        return undefined
    }

    @computed
    get sessionId(): string | undefined {
        const event = this.event
        if (!event) return undefined
        if (event.type === "action") {
            return event.execution.sessionId
        }
        return undefined
    }

    @computed
    get parentSessionId(): string | undefined {
        const event = this.event
        if (!event) return undefined
        if (event.type === "action") {
            return event.execution.parentSessionId
        }
        return undefined
    }
}

/**
 * ActionEventModel - wraps ActionEvent with action-specific derived state
 * Handles all action types including plan, revise, run_plan, do, and ask
 */
export class ActionEventModel extends EventModel {
    @computed
    private get actionEvent(): ActionEvent | undefined {
        return this.event as ActionEvent | undefined
    }

    // === Source accessors ===

    @computed
    get source(): ActionEventSource {
        return this.actionEvent?.source ?? { type: "do", userLabel: "Do" }
    }

    @computed
    get includesCommentIds(): string[] {
        return this.actionEvent?.includesCommentIds ?? []
    }

    // === Result accessor (for run_plan/do/ask types) ===

    @computed
    get result(): { success: boolean } | undefined {
        return this.actionEvent?.result
    }

    // === HyperPlan accessors ===

    @computed
    get isHyperPlan(): boolean {
        return this.source.type === "hyperplan"
    }

    @computed
    get hyperplanSubExecutions(): HyperPlanSubExecution[] | undefined {
        return this.actionEvent?.hyperplanSubExecutions
    }

    @computed
    get hyperplanStrategyId(): string | undefined {
        return this.source.type === "hyperplan" ? this.source.strategyId : undefined
    }

    // === Label ===

    @computed
    get label(): string {
        return this.source.userLabel
    }
}

/**
 * SetupEnvironmentEventModel - wraps SetupEnvironmentEvent with setup-specific derived state
 */
export class SetupEnvironmentEventModel extends EventModel {
    @computed
    private get setupEvent(): SetupEnvironmentEvent | undefined {
        return this.event as SetupEnvironmentEvent | undefined
    }

    @computed
    get worktreeId(): string {
        return this.setupEvent?.worktreeId ?? ""
    }

    @computed
    get deviceId(): string {
        return this.setupEvent?.deviceId ?? ""
    }

    @computed
    get setupOutput(): string | undefined {
        return this.setupEvent?.setupOutput
    }

    @computed
    get label(): string {
        return "Setup Environment"
    }
}

/**
 * SnapshotEventModel - wraps SnapshotEvent with snapshot-specific derived state
 *
 * Supports lazy loading of patches stored in external files (~/.openade/snapshots/).
 * When patchFileId is set, the patch is loaded on-demand via loadPatch().
 */
export class SnapshotEventModel extends EventModel {
    /** Loaded patch content from file (null = not loaded yet) */
    @observable private _loadedPatch: string | null = null

    /** Whether we're currently loading the patch from file */
    @observable private _loading = false

    @computed
    private get snapshotEvent(): SnapshotEvent | undefined {
        return this.event as SnapshotEvent | undefined
    }

    @computed
    get actionEventId(): string {
        return this.snapshotEvent?.actionEventId ?? ""
    }

    @computed
    get mergeBaseCommit(): string {
        return this.snapshotEvent?.mergeBaseCommit ?? ""
    }

    /** ID of the patch file (if stored externally) */
    @computed
    get patchFileId(): string | undefined {
        return this.snapshotEvent?.patchFileId
    }

    /**
     * Get the full patch content.
     * Returns inline patch if present, otherwise returns loaded patch from file.
     * Call loadPatch() first to ensure the patch is loaded from file.
     */
    @computed
    get fullPatch(): string {
        // If patch is stored inline (legacy or fallback), use it
        const inline = this.snapshotEvent?.fullPatch ?? ""
        if (inline) return inline

        // Otherwise, return loaded patch from file
        return this._loadedPatch ?? ""
    }

    /** Whether the patch is currently being loaded from file */
    @computed
    get isPatchLoading(): boolean {
        return this._loading
    }

    /** Whether the patch has been loaded (or is available inline) */
    @computed
    get isPatchLoaded(): boolean {
        // Has inline patch
        if (this.snapshotEvent?.fullPatch) return true
        // Has loaded from file
        if (this._loadedPatch !== null) return true
        // No patch file to load
        if (!this.patchFileId) return true
        return false
    }

    /**
     * Load the patch from file if stored externally.
     * Safe to call multiple times - will only load once.
     */
    @action
    async loadPatch(): Promise<void> {
        // Already loaded or loading
        if (this._loadedPatch !== null || this._loading) return

        // No file to load (inline patch or no patch)
        const fileId = this.patchFileId
        if (!fileId) return

        // Has inline patch, no need to load
        if (this.snapshotEvent?.fullPatch) return

        // Check if API is available
        if (!snapshotsApi.isAvailable()) {
            console.warn("[SnapshotEventModel] Snapshots API not available, cannot load patch")
            return
        }

        this._loading = true
        try {
            const patch = await snapshotsApi.load(fileId)
            runInAction(() => {
                this._loadedPatch = patch ?? ""
                if (!patch) {
                    console.warn("[SnapshotEventModel] Patch file not found:", fileId)
                }
            })
        } catch (err) {
            console.error("[SnapshotEventModel] Failed to load patch:", err)
            runInAction(() => {
                this._loadedPatch = ""
            })
        } finally {
            runInAction(() => {
                this._loading = false
            })
        }
    }

    @computed
    get stats(): { filesChanged: number; insertions: number; deletions: number } {
        return this.snapshotEvent?.stats ?? { filesChanged: 0, insertions: 0, deletions: 0 }
    }

    @computed
    get label(): string {
        return "Snapshot"
    }
}
