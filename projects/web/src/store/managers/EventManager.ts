/**
 * EventManager
 *
 * Runtime execution and event mutation are owned by the OpenADE server
 * protocol. This manager only keeps renderer-side event readers plus narrow
 * task metadata actions that go through the protocol.
 */

import type { HarnessId, HarnessStreamEvent } from "../../electronAPI/harnessEventTypes"
import type { ActionEvent } from "../../types"
import type { CodeStore } from "../store"

export class EventManager {
    constructor(private store: CodeStore) {}

    /** Get the latest completed plan/revise event for a task */
    getTaskLatestCompletedPlanEvent(taskId: string): ActionEvent | null {
        const task = this.store.tasks.getTask(taskId)
        if (!task) return null

        for (let i = task.events.length - 1; i >= 0; i--) {
            const event = task.events[i]
            if (
                event.type === "action" &&
                (event.source.type === "plan" || event.source.type === "revise" || event.source.type === "hyperplan") &&
                event.status === "completed"
            ) {
                return event
            }
        }
        return null
    }

    /**
     * Check if an action event failed due to defunct session (forking from expired session).
     * Returns the defunct session ID if found, or null if no defunct session error.
     */
    getDefunctSessionId(event: ActionEvent): string | null {
        const stderrText = event.execution.events
            .filter((e): e is HarnessStreamEvent & { type: "stderr"; direction: "execution" } => e.direction === "execution" && e.type === "stderr")
            .map((e) => e.data)
            .join(" ")

        const errorText = event.execution.events
            .filter((e): e is HarnessStreamEvent & { type: "error"; direction: "execution" } => e.direction === "execution" && e.type === "error")
            .map((e) => e.error)
            .join(" ")

        const resultErrors: string[] = []
        for (const e of event.execution.events) {
            if (e.direction === "execution" && (e.type === "raw_message" || (e.type as string) === "sdk_message")) {
                const msg = (e as Record<string, unknown>).message as { type?: string; errors?: string[] }
                if (msg?.type === "result" && msg.errors) {
                    resultErrors.push(...msg.errors)
                }
            }
        }

        const combined = stderrText + " " + errorText + " " + resultErrors.join(" ")
        const match = combined.match(/no conversation found with session id[:\s]+([a-f0-9-]+)/i)
        if (match) return match[1]

        const lower = combined.toLowerCase()
        if (lower.includes("no conversation found") || (lower.includes("session") && lower.includes("not found"))) {
            return event.execution.parentSessionId || null
        }

        return null
    }

    /** Check if an action event failed due to defunct session (forking from expired session) */
    hasDefunctSessionError(event: ActionEvent): boolean {
        return this.getDefunctSessionId(event) !== null
    }

    /** Get the session ID from the last event with an execution, skipping defunct sessions */
    getLastEventSessionId(taskId: string): string | undefined {
        return this.getLastEventSessionContext(taskId)?.sessionId
    }

    /**
     * Get the full session context (session ID + harness + model) from the last
     * event with an execution, skipping review events and defunct sessions.
     */
    getLastEventSessionContext(taskId: string): { sessionId: string; harnessId: HarnessId; modelId?: string } | undefined {
        const task = this.store.tasks.getTask(taskId)
        if (!task) return undefined

        const defunctSessionIds = new Set<string>()
        for (let i = task.events.length - 1; i >= 0; i--) {
            const event = task.events[i]
            if (event.type !== "action") continue
            if (event.source.type === "review") continue

            const defunctSessionId = this.getDefunctSessionId(event)
            if (defunctSessionId) {
                defunctSessionIds.add(defunctSessionId)
                if (event.execution.sessionId) {
                    defunctSessionIds.add(event.execution.sessionId)
                }
            }

            if (event.execution.sessionId && !defunctSessionIds.has(event.execution.sessionId)) {
                return {
                    sessionId: event.execution.sessionId,
                    harnessId: event.execution.harnessId,
                    modelId: event.execution.modelId,
                }
            }
        }
        return undefined
    }

    async cancelPlan(taskId: string, planEventId: string): Promise<boolean> {
        if (!this.store.tasks.getTask(taskId)) return false

        await this.store.updateProductTaskMetadata({ taskId, cancelledPlanEventId: planEventId })
        await this.store.refreshProductStateAfterTaskMutation(taskId)
        return true
    }
}
