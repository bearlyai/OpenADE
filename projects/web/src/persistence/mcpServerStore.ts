/**
 * McpServerStore
 *
 * Manages MCP server configurations using YJS for sync.
 * Backed by a single YJS document for all MCP server configs.
 */

import type * as Y from "yjs"
import { type YArrayHandle, arrayOfType } from "./storage"

// ============================================================================
// Types
// ============================================================================

/**
 * OAuth tokens received after successful authentication.
 * Obtained automatically via OAuth discovery and dynamic client registration.
 */
export interface McpOAuthTokens {
    accessToken: string
    refreshToken?: string
    expiresAt?: string // ISO timestamp
    tokenType: string
}

/**
 * Health status for MCP servers.
 */
export type McpHealthStatus = "unknown" | "healthy" | "unhealthy" | "needs_auth"

/**
 * Base fields shared by all MCP server types.
 */
interface McpServerBase {
    id: string
    name: string
    enabled: boolean
    presetId?: string // Which preset it was created from (stripe, github, etc.)
    lastTested?: string // ISO timestamp
    healthStatus: McpHealthStatus
    createdAt: string
    updatedAt: string
}

/**
 * HTTP MCP server configuration.
 * OAuth endpoints are discovered automatically from the server URL per MCP spec.
 */
export interface McpHttpServerItem extends McpServerBase {
    transportType: "http"
    url: string
    headers?: Record<string, string> // Custom headers (Authorization is added automatically from oauthTokens)
    oauthTokens?: McpOAuthTokens
}

/**
 * Stdio MCP server configuration (local process).
 */
export interface McpStdioServerItem extends McpServerBase {
    transportType: "stdio"
    command: string
    args?: string[]
    envVars?: Record<string, string>
}

/**
 * MCP server configuration - discriminated union.
 * Use `server.transportType` to narrow the type.
 */
export type McpServerItem = McpHttpServerItem | McpStdioServerItem

/**
 * Update payload for MCP servers.
 * Allows updating any field that's valid for either HTTP or Stdio servers.
 * The transportType cannot be changed after creation.
 */
export interface McpServerUpdate {
    name?: string
    enabled?: boolean
    healthStatus?: McpHealthStatus
    lastTested?: string
    // HTTP fields
    url?: string
    headers?: Record<string, string>
    oauthTokens?: McpOAuthTokens
    // Stdio fields
    command?: string
    args?: string[]
    envVars?: Record<string, string>
}

/**
 * McpServerStore manages all MCP server configurations.
 * Backed by a single YJS document.
 */
export interface McpServerStore {
    servers: YArrayHandle<McpServerItem>
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Creates a McpServerStore backed by the given YJS document.
 * The document should be obtained via getYDoc() with the MCP store room ticket.
 */
export function createMcpServerStore(doc: Y.Doc): McpServerStore {
    const servers = arrayOfType<McpServerItem>(doc, "mcp_servers")
    return { servers }
}
