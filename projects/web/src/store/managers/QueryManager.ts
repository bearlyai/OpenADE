/**
 * QueryManager
 *
 * Stops server-owned OpenADE task turns. Renderer-owned harness/custom run
 * handles were removed with the runtime protocol migration.
 */

import { makeAutoObservable } from "mobx"
import { localOpenADEClient } from "../../runtime/localOpenADEClient"
import type { CodeStore } from "../store"

export class QueryManager {
    constructor(private store: CodeStore) {
        makeAutoObservable(this)
    }

    async abortTask(taskId: string): Promise<void> {
        if (!this.store.isTaskRunning(taskId)) {
            console.debug("[QueryManager] abortTask: No server-owned task is running", taskId)
            return
        }

        await localOpenADEClient.interruptTurn(taskId).catch((err) => {
            console.error("[QueryManager] Failed to interrupt server-owned task:", err)
        })
    }
}
