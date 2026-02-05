/**
 * PersonalSettingsStore Bootstrap
 *
 * Handles connection setup for PersonalSettingsStore using the local storage driver.
 */

import { type PersonalSettingsStore, createPersonalSettingsStore } from "./personalSettingsStore"
import { getStorageDriver } from "./storage"

// ============================================================================
// Connection
// ============================================================================

export interface PersonalSettingsStoreConnection {
    store: PersonalSettingsStore
    sync: () => Promise<void>
    disconnect: () => void
}

/**
 * Connects to the PersonalSettingsStore using local storage.
 */
export async function connectPersonalSettingsStore(): Promise<PersonalSettingsStoreConnection> {
    const storage = getStorageDriver()
    const { doc, sync, disconnect } = await storage.getYDoc("code:personal_settings")

    const store = createPersonalSettingsStore(doc)

    // Fire initial sync (non-blocking)
    sync().catch((e) => console.error("[PersonalSettingsStore] Initial sync failed:", e))

    return {
        store,
        sync,
        disconnect,
    }
}
