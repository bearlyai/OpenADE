/**
 * QueryManager
 *
 * Manages active harness queries for abort functionality.
 * Tracks queries per task and handles abort operations.
 *
 * Uses the unified HarnessStreamEvent system.
 */

import { makeAutoObservable } from "mobx"
import { hasOnlyInitMessage } from "../../electronAPI/harnessEventTypes"
import { type HarnessQuery, getHarnessQueryManager } from "../../electronAPI/harnessQuery"
import type { CodeStore } from "../store"

export class QueryManager {
    private activeQueries: Map<string, { query: HarnessQuery; eventId: string | null; parentSessionId?: string }> = new Map()

    constructor(private store: CodeStore) {
        makeAutoObservable(this, {
            // activeQueries is private, no need to annotate
        })
    }

    // ==================== Query tracking ====================

    setActiveQuery(taskId: string, query: HarnessQuery, eventId: string | null, parentSessionId?: string): void {
        this.activeQueries.set(taskId, { query, eventId, parentSessionId })
    }

    clearActiveQuery(taskId: string): void {
        this.activeQueries.delete(taskId)
    }

    getActiveQuery(taskId: string): { query: HarnessQuery; eventId: string | null; parentSessionId?: string } | null {
        return this.activeQueries.get(taskId) || null
    }

    // ==================== Abort ====================

    async abortTask(taskId: string): Promise<void> {
        const active = this.activeQueries.get(taskId)
        if (!active) {
            console.debug("[QueryManager] abortTask: No active query for task", taskId)
            return
        }

        console.debug("[QueryManager] Aborting task", taskId, "event", active.eventId)

        // Capture session ID before aborting so we can resume from it
        const sessionId = active.query.sessionId

        try {
            await active.query.abort()
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
        const executionId = active.query.id
        getHarnessQueryManager().cleanup(executionId)

        console.debug("[QueryManager] Task stopped successfully", taskId, { sessionId })
    }
}
