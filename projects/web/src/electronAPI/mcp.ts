/**
 * MCP Server API Bridge
 *
 * Client-side API for MCP server operations.
 * Communicates with Electron main process via openadeAPI.
 */

import type { McpOAuthTokens, McpServerItem } from "../persistence/mcpServerStore"
import type { McpHttpServerConfig, McpServerConfig, McpStdioServerConfig } from "./claudeEventTypes"

// Re-export types for convenience
export type { McpServerConfig, McpStdioServerConfig, McpHttpServerConfig }

// ============================================================================
// Type Definitions
// IMPORTANT: Keep in sync with projects/electron/src/modules/code/mcp.ts
// ============================================================================

export interface TestMcpConnectionResponse {
    success: boolean
    error?: string
    requiresAuth?: boolean
    authDetails?: {
        resourceMetadataUrl?: string
        scope?: string
    }
}

export interface InitiateMcpOAuthParams {
    serverId: string
    serverUrl: string // MCP server URL - OAuth endpoints are discovered automatically
}

export interface InitiateMcpOAuthResponse {
    success: boolean
    error?: string
}

export interface CancelMcpOAuthParams {
    serverId: string
}

export interface CancelMcpOAuthResponse {
    success: boolean
}

export interface RefreshMcpOAuthParams {
    serverId: string
    serverUrl: string
    refreshToken: string
}

export interface RefreshMcpOAuthResponse {
    success: boolean
    tokens?: McpOAuthTokens
    error?: string
}

export type OnMcpOAuthCompleteCallback = (result: { serverId: string; tokens: McpOAuthTokens } | { serverId: string; error: string }) => void

// ============================================================================
// API Check
// ============================================================================

import { isCodeModuleAvailable } from "./capabilities"

// ============================================================================
// MCP API Functions
// ============================================================================

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
    if (!window.openadeAPI) {
        return { success: false, error: "Not running in Electron" }
    }

    try {
        const response = (await window.openadeAPI.mcp.testConnection({ config })) as TestMcpConnectionResponse
        return response
    } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : "Unknown error" }
    }
}

/**
 * Initiate OAuth flow for an MCP server
 * Opens OAuth URL in system browser and handles callback
 */
export async function initiateMcpOAuth(params: InitiateMcpOAuthParams): Promise<InitiateMcpOAuthResponse> {
    if (!window.openadeAPI) {
        return { success: false, error: "Not running in Electron" }
    }

    try {
        const response = (await window.openadeAPI.mcp.initiateOAuth(params)) as InitiateMcpOAuthResponse
        return response
    } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : "Unknown error" }
    }
}

/**
 * Cancel a pending OAuth flow for an MCP server
 */
export async function cancelMcpOAuth(params: CancelMcpOAuthParams): Promise<CancelMcpOAuthResponse> {
    if (!window.openadeAPI) {
        return { success: false }
    }

    try {
        const response = (await window.openadeAPI.mcp.cancelOAuth(params)) as CancelMcpOAuthResponse
        return response
    } catch (err) {
        console.error("[McpAPI] Failed to cancel OAuth:", err)
        return { success: false }
    }
}

/**
 * Refresh OAuth tokens for an MCP server using the refresh token
 */
export async function refreshMcpOAuthToken(params: RefreshMcpOAuthParams): Promise<RefreshMcpOAuthResponse> {
    if (!window.openadeAPI) {
        return { success: false, error: "Not running in Electron" }
    }

    try {
        const response = (await window.openadeAPI.mcp.refreshOAuth(params)) as RefreshMcpOAuthResponse
        return response
    } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : "Unknown error" }
    }
}

/**
 * Subscribe to OAuth completion events
 * Returns an unsubscribe function
 */
export function onMcpOAuthComplete(callback: OnMcpOAuthCompleteCallback): () => void {
    if (!window.openadeAPI) {
        console.warn("[McpAPI] Not running in Electron, cannot subscribe to OAuth events")
        return () => {}
    }

    return window.openadeAPI.mcp.onOAuthComplete((result: unknown) => {
        callback(result as Parameters<OnMcpOAuthCompleteCallback>[0])
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
            result[server.name] = config
        }
    }

    return result
}
