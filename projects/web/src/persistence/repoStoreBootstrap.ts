/**
 * RepoStore Bootstrap
 *
 * Handles connection setup for RepoStore using the local storage driver.
 */

import { type RepoStore, createRepoStore } from "./repoStore"
import { getStorageDriver } from "./storage"

// ============================================================================
// Connection
// ============================================================================

export interface RepoStoreConnection {
    store: RepoStore
    sync: () => Promise<void>
    disconnect: () => void
}

/**
 * Connects to the RepoStore using local storage.
 */
export async function connectRepoStore(): Promise<RepoStoreConnection> {
    const storage = getStorageDriver()
    const { doc, sync, disconnect } = await storage.getYDoc("code:repos")

    const store = createRepoStore(doc)

    // Fire initial sync (non-blocking)
    sync().catch((e) => console.error("[RepoStore] Initial sync failed:", e))

    return {
        store,
        sync,
        disconnect,
    }
}
