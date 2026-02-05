/**
 * McpServerStore Bootstrap
 *
 * Handles connection setup for McpServerStore using the local storage driver.
 */

import { type McpServerStore, createMcpServerStore } from "./mcpServerStore"
import { getStorageDriver } from "./storage"

// ============================================================================
// Connection
// ============================================================================

export interface McpServerStoreConnection {
    store: McpServerStore
    sync: () => Promise<void>
    disconnect: () => void
}

/**
 * Connects to the McpServerStore using local storage.
 */
export async function connectMcpServerStore(): Promise<McpServerStoreConnection> {
    const storage = getStorageDriver()
    const { doc, sync, disconnect } = await storage.getYDoc("code:mcp_servers")

    const store = createMcpServerStore(doc)

    // Fire initial sync (non-blocking)
    sync().catch((e) => console.error("[McpServerStore] Initial sync failed:", e))

    return {
        store,
        sync,
        disconnect,
    }
}
