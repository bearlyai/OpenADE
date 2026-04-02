/**
 * QueryManager
 *
 * Manages active task runs for abort functionality.
 * Tracks harness queries and custom run handles (for HyperPlan, etc.) per task.
 *
 * Uses the unified HarnessStreamEvent system.
 */

import { makeAutoObservable } from "mobx"
import { hasOnlyInitMessage } from "../../electronAPI/harnessEventTypes"
import { type HarnessQuery, getHarnessQueryManager } from "../../electronAPI/harnessQuery"
import type { CodeStore } from "../store"

interface ActiveHarnessRun {
    kind: "harness"
    query: HarnessQuery
    eventId: string | null
    parentSessionId?: string
}

interface ActiveCustomRun {
    kind: "custom"
    eventId: string | null
    parentSessionId?: string
    abort: () => Promise<void> | void
    sessionId?: () => string | undefined
    cleanup?: () => void
}

type ActiveTaskRun = ActiveHarnessRun | ActiveCustomRun

export class QueryManager {
    private activeRuns: Map<string, ActiveTaskRun> = new Map()

    constructor(private store: CodeStore) {
        makeAutoObservable(this, {
            // activeRuns is private, no need to annotate
        })
    }

    // ==================== Query tracking ====================

    setActiveQuery(taskId: string, query: HarnessQuery, eventId: string | null, parentSessionId?: string): void {
        this.activeRuns.set(taskId, { kind: "harness", query, eventId, parentSessionId })
    }

    setActiveCustomRun(taskId: string, run: Omit<ActiveCustomRun, "kind">): void {
        this.activeRuns.set(taskId, {
            kind: "custom",
            ...run,
        })
    }

    updateActiveRunEvent(taskId: string, eventId: string, parentSessionId?: string): void {
        const active = this.activeRuns.get(taskId)
        if (!active) return
        active.eventId = eventId
        if (parentSessionId !== undefined) {
            active.parentSessionId = parentSessionId
        }
    }

    clearActiveQuery(taskId: string): void {
        this.activeRuns.delete(taskId)
    }

    getActiveQuery(taskId: string): { query: HarnessQuery; eventId: string | null; parentSessionId?: string } | null {
        const active = this.activeRuns.get(taskId)
        if (!active || active.kind !== "harness") return null
        return { query: active.query, eventId: active.eventId, parentSessionId: active.parentSessionId }
    }

    // ==================== Abort ====================

    async abortTask(taskId: string): Promise<void> {
        const active = this.activeRuns.get(taskId)
        if (!active) {
            console.debug("[QueryManager] abortTask: No active query for task", taskId)
            return
        }

        console.debug("[QueryManager] Aborting task", taskId, "event", active.eventId)

        // Capture session ID before aborting so we can resume from it
        const sessionId = active.kind === "harness" ? active.query.sessionId : active.sessionId?.()

        try {
            if (active.kind === "harness") {
                await active.query.abort()
            } else {
                await active.abort()
            }
        } catch (err) {
            console.error("[QueryManager] Error aborting query:", err)
        }

        // Mark event as stopped (not error)
        // Only save session IDs if there's meaningful content to resume from
        if (active.eventId) {
            const taskStore = this.store.getCachedTaskStore(taskId)
            const event = taskStore?.events.get(active.eventId)
            const isEmpty = event?.type === "action" && hasOnlyInitMessage(event.execution.events)

            this.store.events.stoppedEvent({
                taskId,
                eventId: active.eventId,
                // Don't save session IDs for empty events - nothing useful to resume from
                sessionId: isEmpty ? undefined : sessionId,
                parentSessionId: isEmpty ? undefined : active.parentSessionId,
            })
        }

        this.clearActiveQuery(taskId)
        this.store.setTaskWorking(taskId, false)

        // Cleanup manager reference
        if (active.kind === "harness") {
            const executionId = active.query.id
            getHarnessQueryManager().cleanup(executionId)
        } else {
            active.cleanup?.()
        }

        console.debug("[QueryManager] Task stopped successfully", taskId, { sessionId })
    }
}
