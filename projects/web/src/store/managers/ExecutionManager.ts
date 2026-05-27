/**
 * ExecutionManager
 *
 * Runtime execution is owned by the OpenADE server protocol. This manager now
 * only preserves renderer subscriptions that react to completed task events and
 * the local plan-cancel mutation.
 */

import { track } from "../../analytics"
import type { HarnessId } from "../../electronAPI/harnessEventTypes"
import type { ActionEventSource } from "../../types"
import type { CodeStore } from "../store"

type AfterEventCallback = (taskId: string, eventType: ActionEventSource["type"]) => void

interface SessionContextSnapshot {
    sessionId: string
    harnessId: HarnessId
    modelId?: string
}

interface ResolvedExecutionSession {
    parentSessionId?: string
    effectiveHarnessId: HarnessId
    effectiveModel: string
}

export function resolveExecutionSession(args: {
    freshSession?: boolean
    overrideHarnessId?: HarnessId
    overrideModel?: string
    taskHarnessId: HarnessId
    taskModel: string
    sessionContext?: SessionContextSnapshot
}): ResolvedExecutionSession {
    const requestedHarnessId = args.overrideHarnessId ?? args.taskHarnessId
    const requestedModel = args.overrideModel ?? args.taskModel

    if (args.freshSession || !args.sessionContext?.sessionId) {
        return {
            effectiveHarnessId: requestedHarnessId,
            effectiveModel: requestedModel,
        }
    }

    const { sessionContext } = args
    if (sessionContext.harnessId !== requestedHarnessId) {
        return {
            parentSessionId: sessionContext.sessionId,
            effectiveHarnessId: sessionContext.harnessId,
            effectiveModel: sessionContext.modelId ?? requestedModel,
        }
    }

    return {
        parentSessionId: sessionContext.sessionId,
        effectiveHarnessId: requestedHarnessId,
        effectiveModel: requestedModel,
    }
}

export class ExecutionManager {
    private afterEventCallbacks: AfterEventCallback[] = []

    constructor(private store: CodeStore) {}

    onAfterEvent(callback: AfterEventCallback): () => void {
        this.afterEventCallbacks.push(callback)
        return () => {
            this.afterEventCallbacks = this.afterEventCallbacks.filter((cb) => cb !== callback)
        }
    }

    notifyAfterEvent(taskId: string, eventType: ActionEventSource["type"], success: boolean): void {
        track("execution_completed", { eventType, success })

        for (const cb of this.afterEventCallbacks) {
            try {
                cb(taskId, eventType)
            } catch (err) {
                console.error("[ExecutionManager] afterEvent callback error:", err)
            }
        }
    }

    async cancelPlan(taskId: string, planEventId: string): Promise<boolean> {
        return this.store.events.cancelPlan(taskId, planEventId)
    }
}
