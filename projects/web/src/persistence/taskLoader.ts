/**
 * Task Loader
 *
 * Handles on-demand loading of TaskStore instances using task IDs.
 */

import type { Task } from "../types"
import { getStorageDriver } from "./storage"
import { type TaskStore, createTaskStore } from "./taskStore"

// ============================================================================
// Types
// ============================================================================

export interface TaskStoreConnection {
    store: TaskStore
    sync: () => Promise<void>
    disconnect: () => void
}

// ============================================================================
// Loading
// ============================================================================

/**
 * Loads a TaskStore for the given task.
 *
 * @param params.taskId - The task ID
 * @param params.initialTask - Optional initial data for seeding new tasks
 */
export async function loadTaskStore(params: {
    taskId: string
    initialTask?: Task
}): Promise<TaskStoreConnection> {
    const storage = getStorageDriver()
    const { doc, sync, disconnect } = await storage.getYDoc(`code:task:${params.taskId}`)

    const store = createTaskStore(doc, params.initialTask)

    // Skip initial sync - the document was just loaded from storage,
    // so there's nothing to sync. Syncing unchanged data wastes resources
    // and can cause memory pressure with large documents.

    return {
        store,
        sync,
        disconnect,
    }
}
