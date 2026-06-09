/**
 * MCP Server API Bridge
 *
 * Client-side API for MCP server operations.
 * Communicates with the local runtime protocol bridge.
 */

import type {
    McpCancelOAuthParams,
    McpCancelOAuthResponse,
    McpHttpServerConfig,
    McpInitiateOAuthParams,
    McpInitiateOAuthResponse,
    McpOAuthCompleteResult,
    McpOAuthTokens,
    McpRefreshOAuthParams,
    McpRefreshOAuthResponse,
    McpServerConfig,
    McpStdioServerConfig,
    McpTestConnectionResponse,
} from "@openade/harness/browser"
import type { McpServerItem } from "../persistence/mcpServerStore"
import { localRuntimeClient } from "../runtime/localRuntimeClient"

// Re-export types for convenience
export type { McpServerConfig, McpStdioServerConfig, McpHttpServerConfig }

export type TestMcpConnectionResponse = McpTestConnectionResponse
export type InitiateMcpOAuthParams = McpInitiateOAuthParams
export type InitiateMcpOAuthResponse = McpInitiateOAuthResponse
export type CancelMcpOAuthParams = McpCancelOAuthParams
export type CancelMcpOAuthResponse = McpCancelOAuthResponse
export type RefreshMcpOAuthParams = McpRefreshOAuthParams
export type RefreshMcpOAuthResponse = McpRefreshOAuthResponse
export type OnMcpOAuthCompleteCallback = (result: McpOAuthCompleteResult) => void

// ============================================================================
// API Check
// ============================================================================

import { isCodeModuleAvailable } from "./capabilities"

// ============================================================================
// MCP API Functions
// ============================================================================

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
    const value = record[key]
    return typeof value === "string" ? value : undefined
}

function parseMcpOAuthTokens(value: unknown): McpOAuthTokens | null {
    if (!isRecord(value)) return null
    const accessToken = optionalString(value, "accessToken")
    const tokenType = optionalString(value, "tokenType")
    if (!accessToken || !tokenType) return null
    const refreshToken = optionalString(value, "refreshToken")
    const expiresAt = optionalString(value, "expiresAt")

    return {
        accessToken,
        tokenType,
        ...(refreshToken ? { refreshToken } : {}),
        ...(expiresAt ? { expiresAt } : {}),
    }
}

function parseMcpOAuthComplete(value: unknown): Parameters<OnMcpOAuthCompleteCallback>[0] | null {
    if (!isRecord(value)) return null
    const serverId = optionalString(value, "serverId")
    if (!serverId) return null

    const error = optionalString(value, "error")
    if (error !== undefined) return { serverId, error }

    const tokens = parseMcpOAuthTokens(value.tokens)
    if (tokens) return { serverId, tokens }

    return null
}

/**
 * Check if MCP API is available (running in Electron)
 */
export function isMcpApiAvailable(): boolean {
    return isCodeModuleAvailable()
}

/**
 * Test connection to an MCP server
 * Returns connection status and available capabilities
 */
export async function testMcpConnection(config: McpServerConfig): Promise<TestMcpConnectionResponse> {
    if (!window.openadeAPI?.runtime) {
        return { success: false, error: "Not running in Electron" }
    }

    try {
        return await localRuntimeClient.request<TestMcpConnectionResponse>("host/mcp/testConnection", { config })
    } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : "Unknown error" }
    }
}

/**
 * Initiate OAuth flow for an MCP server
 * Opens OAuth URL in system browser and handles callback
 */
export async function initiateMcpOAuth(params: InitiateMcpOAuthParams): Promise<InitiateMcpOAuthResponse> {
    if (!window.openadeAPI?.runtime) {
        return { success: false, error: "Not running in Electron" }
    }

    try {
        return await localRuntimeClient.request<InitiateMcpOAuthResponse>("host/mcp/initiateOAuth", params)
    } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : "Unknown error" }
    }
}

/**
 * Cancel a pending OAuth flow for an MCP server
 */
export async function cancelMcpOAuth(params: CancelMcpOAuthParams): Promise<CancelMcpOAuthResponse> {
    if (!window.openadeAPI?.runtime) {
        return { success: false }
    }

    try {
        return await localRuntimeClient.request<CancelMcpOAuthResponse>("host/mcp/cancelOAuth", params)
    } catch (err) {
        console.error("[McpAPI] Failed to cancel OAuth:", err)
        return { success: false }
    }
}

/**
 * Refresh OAuth tokens for an MCP server using the refresh token
 */
export async function refreshMcpOAuthToken(params: RefreshMcpOAuthParams): Promise<RefreshMcpOAuthResponse> {
    if (!window.openadeAPI?.runtime) {
        return { success: false, error: "Not running in Electron" }
    }

    try {
        return await localRuntimeClient.request<RefreshMcpOAuthResponse>("host/mcp/refreshOAuth", params)
    } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : "Unknown error" }
    }
}

/**
 * Subscribe to OAuth completion events
 * Returns an unsubscribe function
 */
export function onMcpOAuthComplete(callback: OnMcpOAuthCompleteCallback): () => void {
    if (!window.openadeAPI?.runtime) {
        console.warn("[McpAPI] Not running in Electron, cannot subscribe to OAuth events")
        return () => {}
    }

    return localRuntimeClient.subscribe((notification) => {
        if (notification.method !== "host/mcp/oauthComplete") return
        const result = parseMcpOAuthComplete(notification.params)
        if (result) callback(result)
    })
}

/**
 * Build MCP server configs from McpServerItem array.
 * Returns a Record keyed by server name for SDK compatibility.
 * Filters to only include enabled servers.
 */
export function buildMcpServerConfigs(servers: McpServerItem[]): Record<string, McpServerConfig> {
    const result: Record<string, McpServerConfig> = {}

    for (const server of servers) {
        if (!server.enabled) continue

        if (server.transportType === "http") {
            // Build headers including OAuth token if available
            const headers: Record<string, string> = { ...server.headers }
            if (server.oauthTokens?.accessToken) {
                headers.Authorization = `Bearer ${server.oauthTokens.accessToken}`
            }

            const config: McpHttpServerConfig = {
                type: "http",
                url: server.url,
            }
            if (Object.keys(headers).length > 0) {
                config.headers = headers
            }
            result[server.name] = config
        } else {
            // stdio server
            const config: McpStdioServerConfig = {
                type: "stdio",
                command: server.command,
                args: server.args ?? [],
            }
            if (server.envVars && Object.keys(server.envVars).length > 0) {
                config.env = server.envVars
            }
            if (server.cwd) {
                config.cwd = server.cwd
            }
            result[server.name] = config
        }
    }

    return result
}
