/**
 * McpServerStore Bootstrap
 *
 * Handles connection setup for McpServerStore using the local storage driver.
 */

import { type McpServerStore, createMcpServerStore } from "./mcpServerStore"
import { getStorageDriver } from "./storage"
import * as Y from "yjs"

// ============================================================================
// Connection
// ============================================================================

export interface McpServerStoreConnection {
    store: McpServerStore
    sync: () => Promise<void>
    disconnect: () => void
}

export function createEphemeralMcpServerStoreConnection(): McpServerStoreConnection {
    const doc = new Y.Doc()
    const store = createMcpServerStore(doc)
    return {
        store,
        sync: async () => undefined,
        disconnect: () => doc.destroy(),
    }
}

/**
 * Connects to the McpServerStore using local storage.
 */
export async function connectMcpServerStore(): Promise<McpServerStoreConnection> {
    const storage = getStorageDriver()
    const { doc, sync, disconnect } = await storage.getYDoc("code:mcp_servers")

    const store = createMcpServerStore(doc)

    return {
        store,
        sync,
        disconnect,
    }
}
