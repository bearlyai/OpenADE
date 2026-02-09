/**
 * Unified Claude Event Stream Types
 *
 * This file defines the shared event types used for communication between
 * the Electron main process and the Dashboard renderer process.
 *
 * Events are split by direction:
 * - ClaudeExecutionEvent: Events from Electron -> Dashboard (execution output)
 * - ClaudeCommandEvent: Commands from Dashboard -> Electron (control actions)
 */

import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk"

// ============================================================================
// Query Options (keep in sync with both sides)
// ============================================================================

import type { McpHttpServerConfig, McpStdioServerConfig, Options } from "@anthropic-ai/claude-agent-sdk"

// Re-export MCP types from the SDK for convenience
export type { McpStdioServerConfig, McpHttpServerConfig }

/** MCP server config is either stdio or http */
export type McpServerConfig = McpStdioServerConfig | McpHttpServerConfig

export type QueryOptions = Omit<Options, "abortController" | "mcpServers" | "canUseTool" | "hooks" | "stderr" | "spawnClaudeCodeProcess"> & {
    /** Client-defined tools that execute in the renderer process */
    clientTools?: SerializedToolDefinition[]
    /** MCP server configurations to use for this execution (keyed by server name) */
    mcpServerConfigs?: Record<string, McpServerConfig>
    /** Environment variables to control model selection for nested agents */
    modelEnvVars?: Record<string, string>
}

/** Serialized tool definition for IPC (no handler, JSON Schema) */
export interface SerializedToolDefinition {
    name: string
    description: string
    inputSchema: Record<string, unknown>
}

/** Tool result from renderer */
export interface ToolResult {
    content: Array<{ type: "text"; text: string }>
    isError?: boolean
}

// ============================================================================
// Execution Events (Electron -> Dashboard)
// ============================================================================

/**
 * Events emitted by the Claude execution (Electron -> Dashboard)
 * These represent the stream of things happening during execution
 * Each event has a unique `id` for deduplication on replay
 */
export type ClaudeExecutionEvent =
    | { id: string; type: "sdk_message"; executionId: string; message: SDKMessage }
    | { id: string; type: "stderr"; executionId: string; data: string }
    | { id: string; type: "complete"; executionId: string }
    | { id: string; type: "error"; executionId: string; error: string }
    | { id: string; type: "tool_call"; executionId: string; callId: string; toolName: string; args: unknown }
    | { id: string; type: "session_started"; executionId: string; sessionId: string }

// ============================================================================
// Command Events (Dashboard -> Electron)
// ============================================================================

/**
 * Commands sent to control Claude execution (Dashboard -> Electron)
 * These are requests/actions the client wants to perform
 * Each command has a unique `id` for tracking/deduplication
 */
export type ClaudeCommandEvent =
    | { id: string; type: "start_query"; executionId: string; prompt: string; options: QueryOptions }
    | { id: string; type: "tool_response"; executionId: string; callId: string; result?: ToolResult; error?: string }
    | { id: string; type: "abort"; executionId: string }
    | { id: string; type: "reconnect"; executionId: string }
    | { id: string; type: "clear_buffer"; executionId: string }

// ============================================================================
// Combined Event Type
// ============================================================================

/**
 * Combined event type for unified storage
 * Adds a `direction` discriminator to distinguish event source
 */
export type ClaudeStreamEvent = (ClaudeExecutionEvent & { direction: "execution" }) | (ClaudeCommandEvent & { direction: "command" })

// ============================================================================
// Execution State
// ============================================================================

/**
 * Execution state (used by both sides for buffering)
 */
export interface ExecutionState {
    executionId: string
    status: "in_progress" | "completed" | "error" | "aborted"
    sessionId?: string
    events: ClaudeStreamEvent[]
    createdAt: string
    completedAt?: string
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Extract SDKMessages from unified event stream (for rendering compatibility)
 */
export function extractSDKMessages(events: ClaudeStreamEvent[]): SDKMessage[] {
    return events
        .filter((e): e is ClaudeExecutionEvent & { direction: "execution"; type: "sdk_message" } => e.direction === "execution" && e.type === "sdk_message")
        .map((e) => e.message)
}

/**
 * Extract stderr output from unified event stream
 */
export function extractStderr(events: ClaudeStreamEvent[]): string[] {
    return events
        .filter((e): e is ClaudeExecutionEvent & { direction: "execution"; type: "stderr" } => e.direction === "execution" && e.type === "stderr")
        .map((e) => e.data)
}

/**
 * Check if an event ID already exists in the events array (for deduplication)
 * Uses linear scan - efficient for typical ~100-1000 events per execution
 */
export function hasEventId(events: ClaudeStreamEvent[], id: string): boolean {
    return events.some((e) => e.id === id)
}

/**
 * Check if events contain only a system:init message (no meaningful work done).
 * Used to detect "empty" executions where the user stopped before any real work happened.
 * These executions have no useful session context to resume from.
 */
export function hasOnlyInitMessage(events: ClaudeStreamEvent[]): boolean {
    const sdkMessages = extractSDKMessages(events)
    if (sdkMessages.length !== 1) return false
    const msg = sdkMessages[0]
    return msg.type === "system" && "subtype" in msg && (msg as Record<string, unknown>).subtype === "init"
}
