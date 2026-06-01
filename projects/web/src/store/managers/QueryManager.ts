/**
 * QueryManager
 *
 * Stops server-owned OpenADE task turns. Renderer-owned harness/custom run
 * handles were removed with the runtime protocol migration.
 */

import { makeAutoObservable } from "mobx"
import type { CodeStore } from "../store"

export class QueryManager {
    constructor(private store: CodeStore) {
        makeAutoObservable(this)
    }

    async interruptTask(taskId: string): Promise<boolean> {
        if (!this.store.isTaskRunning(taskId)) {
            console.debug("[QueryManager] interruptTask: No server-owned task is running", taskId)
            return false
        }

        await this.store.interruptProductTurn(taskId)
        return true
    }

    async abortTask(taskId: string): Promise<void> {
        await this.interruptTask(taskId).catch((err) => {
            console.error("[QueryManager] Failed to interrupt server-owned task:", err)
        })
    }
}
