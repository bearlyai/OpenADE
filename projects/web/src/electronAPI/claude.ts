/**
 * Claude Agent SDK Bridge - Client Side
 *
 * Unified event stream API for communicating with Electron main process.
 *
 * Architecture:
 * - ClaudeQueryManager: Singleton that manages all executions and routes events
 * - ClaudeQuery: Individual query instance for a single execution
 *
 * Features:
 * - Single unified event stream (ClaudeStreamEvent)
 * - Global buffering and deduplication
 * - Reconnection support after renderer refresh
 * - Client-defined tools with renderer-side handlers
 */

import type { Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk"
import type { ZodObject, ZodRawShape, z } from "zod"
import { zodToJsonSchema } from "zod-to-json-schema"
import {
    type ClaudeCommandEvent,
    type ClaudeExecutionEvent,
    type ClaudeStreamEvent,
    type ExecutionState,
    type McpServerConfig,
    type QueryOptions,
    type SerializedToolDefinition,
    type ToolResult,
    extractSDKMessages,
    extractStderr,
    hasEventId,
} from "./claudeEventTypes"

// Re-export types for convenience
export type { SDKMessage, ClaudeStreamEvent, ClaudeExecutionEvent, ClaudeCommandEvent, ExecutionState, ToolResult, McpServerConfig }

// ============================================================================
// Client-Defined Tool Types
// ============================================================================

/**
 * Definition for a tool that runs in the renderer process
 */
interface ClientToolDefinition<Schema extends ZodRawShape = ZodRawShape> {
    name: string
    description: string
    inputSchema: Schema
    handler: (args: z.infer<ZodObject<Schema>>) => Promise<ToolResult>
}

// ============================================================================
// Client Query Options
// ============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClientToolDefinition = ClientToolDefinition<any>

export type ClientQueryOptions = Omit<Options, "abortController" | "mcpServers" | "canUseTool" | "hooks" | "stderr" | "spawnClaudeCodeProcess"> & {
    /** Client-defined tools that execute in the renderer process */
    clientTools?: AnyClientToolDefinition[]
    /** When true, disallows write tools (Edit, Write, NotebookEdit) */
    readOnly?: boolean
    /** System prompt to append (convenience shorthand for systemPrompt.append) */
    appendSystemPrompt?: string
    /** MCP server configurations to use for this execution (keyed by server name) */
    mcpServerConfigs?: Record<string, McpServerConfig>
    /** Environment variables to control model selection for nested agents */
    modelEnvVars?: Record<string, string>
}

// ============================================================================
// API Check
// ============================================================================

import { isCodeModuleAvailable } from "./capabilities"

// ============================================================================
// ClaudeQuery Class
// ============================================================================

type EventHandler = (...args: unknown[]) => void
type ToolHandler = (args: unknown) => Promise<ToolResult>

/**
 * ClaudeQuery - wrapper for a single query to Claude
 */
export class ClaudeQuery {
    private _executionId: string
    private _options: ClientQueryOptions
    private _executionState: ExecutionState
    private _isAborted = false
    private listeners: Map<string, EventHandler[]> = new Map()
    private toolHandlers: Map<string, ToolHandler> = new Map()

    constructor(executionId: string, options: ClientQueryOptions = {}) {
        this._executionId = executionId
        this._options = options
        this._executionState = {
            executionId,
            status: "in_progress",
            events: [],
            createdAt: new Date().toISOString(),
        }

        // Register tool handlers
        if (options.clientTools) {
            for (const tool of options.clientTools) {
                this.toolHandlers.set(tool.name, tool.handler as ToolHandler)
            }
        }
    }

    /** Execution ID */
    get id(): string {
        return this._executionId
    }

    /** Session ID (available after session_started event) */
    get sessionId(): string | undefined {
        return this._executionState.sessionId
    }

    /** Query options */
    get options(): ClientQueryOptions {
        return this._options
    }

    /** Full execution state */
    get executionState(): ExecutionState {
        return this._executionState
    }

    /** Whether the query has completed */
    get isComplete(): boolean {
        return this._executionState.status !== "in_progress"
    }

    /** Whether the query was aborted */
    get isAborted(): boolean {
        return this._isAborted
    }

    /** Get all SDK messages from the event stream */
    getSDKMessages(): SDKMessage[] {
        return extractSDKMessages(this._executionState.events)
    }

    /** Get all stderr output from the event stream */
    getStderr(): string[] {
        return extractStderr(this._executionState.events)
    }

    /** Register a tool handler (used during attach for reconnection) */
    registerToolHandler(name: string, handler: ToolHandler): void {
        this.toolHandlers.set(name, handler)
    }

    /**
     * Handle an incoming event from the manager
     * Returns true if the event was new (not a duplicate)
     */
    handleEvent(event: ClaudeStreamEvent): boolean {
        // Deduplicate by event ID
        if (hasEventId(this._executionState.events, event.id)) {
            console.debug("[ClaudeQuery] handleEvent: duplicate event skipped", { executionId: this._executionId, eventId: event.id, type: event.type })
            return false
        }

        console.debug("[ClaudeQuery] handleEvent", { executionId: this._executionId, direction: event.direction, type: event.type, eventId: event.id })

        // Add to buffer
        this._executionState.events.push(event)

        // Process the event
        if (event.direction === "execution") {
            this.processExecutionEvent(event)
        }

        return true
    }

    private processExecutionEvent(event: ClaudeExecutionEvent & { direction: "execution" }): void {
        switch (event.type) {
            case "sdk_message":
                this.emit("message", event.message)
                break

            case "stderr":
                this.emit("stderr", event.data)
                break

            case "session_started":
                this._executionState.sessionId = event.sessionId
                this.emit("sessionId", event.sessionId)
                break

            case "complete":
                this._executionState.status = "completed"
                this._executionState.completedAt = new Date().toISOString()
                this.emit("complete")
                break

            case "error":
                this._executionState.status = "error"
                this._executionState.completedAt = new Date().toISOString()
                this.emit("error", event.error)
                break

            case "tool_call":
                this.handleToolCall(event.callId, event.toolName, event.args)
                break
        }
    }

    private async handleToolCall(callId: string, toolName: string, args: unknown): Promise<void> {
        console.debug("[ClaudeQuery] handleToolCall", { executionId: this._executionId, callId, toolName, hasArgs: !!args })
        if (!window.openadeAPI) {
            console.debug("[ClaudeQuery] handleToolCall: no openadeAPI, cannot respond", { callId, toolName })
            return
        }

        const handler = this.toolHandlers.get(toolName)
        if (!handler) {
            console.debug("[ClaudeQuery] No handler for tool (expected during reconnect):", toolName)
            await this.sendToolResponse(callId, {
                content: [{ type: "text", text: "Tool handler not available (reconnected session)" }],
            })
            return
        }

        try {
            const result = await handler(args)
            await this.sendToolResponse(callId, result)
        } catch (err) {
            await this.sendToolResponse(callId, undefined, err instanceof Error ? err.message : "Unknown error")
        }
    }

    private async sendToolResponse(callId: string, result?: ToolResult, error?: string): Promise<void> {
        if (!window.openadeAPI) return

        const command: ClaudeCommandEvent = {
            id: crypto.randomUUID(),
            type: "tool_response",
            executionId: this._executionId,
            callId,
            result,
            error,
        }

        // Send via openadeAPI
        await window.openadeAPI.claude.toolResponse({
            executionId: this._executionId,
            callId,
            result,
            error,
        })

        // Record in our event stream
        this._executionState.events.push({ ...command, direction: "command" })
    }

    private emit(event: string, ...args: unknown[]): void {
        const handlers = this.listeners.get(event) || []
        for (const h of handlers) {
            h(...args)
        }
    }

    on(event: string, handler: EventHandler): void {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, [])
        }
        this.listeners.get(event)!.push(handler)
    }

    off(event: string, handler: EventHandler): void {
        const handlers = this.listeners.get(event)
        if (handlers) {
            const idx = handlers.indexOf(handler)
            if (idx >= 0) handlers.splice(idx, 1)
        }
    }

    /**
     * Listen for session ID (called when session_started event arrives)
     */
    onSessionId(callback: (sessionId: string) => void): void {
        if (this._executionState.sessionId) {
            callback(this._executionState.sessionId)
        }
        this.on("sessionId", callback as EventHandler)
    }

    /**
     * Async generator that yields messages as they arrive
     */
    async *stream(): AsyncGenerator<SDKMessage> {
        const messageQueue: SDKMessage[] = []
        let resolveNext: (() => void) | null = null
        let isDone = false

        const onMessage = (msg: SDKMessage) => {
            messageQueue.push(msg)
            if (resolveNext) {
                resolveNext()
                resolveNext = null
            }
        }

        const onComplete = () => {
            isDone = true
            if (resolveNext) {
                resolveNext()
                resolveNext = null
            }
        }

        const onError = () => {
            isDone = true
            if (resolveNext) {
                resolveNext()
                resolveNext = null
            }
        }

        this.on("message", onMessage as EventHandler)
        this.on("complete", onComplete as EventHandler)
        this.on("error", onError as EventHandler)

        try {
            while (!isDone || messageQueue.length > 0) {
                if (messageQueue.length > 0) {
                    yield messageQueue.shift()!
                } else if (!isDone) {
                    await new Promise<void>((r) => {
                        resolveNext = r
                    })
                }
            }
        } finally {
            this.off("message", onMessage as EventHandler)
            this.off("complete", onComplete as EventHandler)
            this.off("error", onError as EventHandler)
        }
    }

    /**
     * Abort the query
     */
    async abort(): Promise<void> {
        if (!window.openadeAPI) return

        await window.openadeAPI.claude.abort({ executionId: this._executionId })
        this._isAborted = true
        this._executionState.status = "aborted"
        this._executionState.completedAt = new Date().toISOString()
    }

    /**
     * Clear the Electron-side buffer (call after persisting to storage)
     */
    async clearBuffer(): Promise<void> {
        if (!window.openadeAPI) return

        const command: ClaudeCommandEvent = {
            id: crypto.randomUUID(),
            type: "clear_buffer",
            executionId: this._executionId,
        }

        await window.openadeAPI.claude.command(command)
    }

    /**
     * Clean up this query's resources (removes from manager)
     */
    cleanup(): void {
        getClaudeQueryManager().cleanup(this._executionId)
    }
}

// ============================================================================
// ClaudeQueryManager Singleton
// ============================================================================

/**
 * ClaudeQueryManager - manages all Claude executions
 *
 * Provides a single point of contact for:
 * - Starting new executions
 * - Attaching to existing executions (reconnection)
 * - Routing events to appropriate ClaudeQuery instances
 */
class ClaudeQueryManagerImpl {
    private queries: Map<string, ClaudeQuery> = new Map()
    // @ts-expect-error Stored for potential future cleanup - intentionally unused
    private _unsubscribeEvent: (() => void) | null = null

    constructor() {
        this.setupEventListener()
    }

    private setupEventListener(): void {
        if (!window.openadeAPI) {
            console.debug("[ClaudeQueryManager] setupEventListener: no openadeAPI available, skipping")
            return
        }

        console.debug("[ClaudeQueryManager] setupEventListener: registering claude event listener")

        // Subscribe to unified events using the new pattern
        this._unsubscribeEvent = window.openadeAPI.claude.onEvent((event) => {
            const streamEvent = event as ClaudeStreamEvent
            const query = this.queries.get(streamEvent.executionId)
            if (query) {
                query.handleEvent(streamEvent)
            } else {
                console.debug("[ClaudeQueryManager] event received for unknown executionId", {
                    executionId: streamEvent.executionId,
                    direction: streamEvent.direction,
                    type: streamEvent.type,
                    activeQueryIds: Array.from(this.queries.keys()),
                })
            }
        })
    }

    /**
     * Start a new execution
     */
    async startExecution(
        prompt: string | import("./claudeEventTypes").ContentBlock[],
        options: ClientQueryOptions = {},
        executionId?: string
    ): Promise<ClaudeQuery | null> {
        const promptPreview = typeof prompt === "string" ? prompt.slice(0, 100) : `[${prompt.length} content blocks]`
        console.debug("[ClaudeQueryManager] startExecution called", {
            promptLength: prompt.length,
            promptPreview,
            executionId,
            model: options.model,
            cwd: options.cwd,
            readOnly: options.readOnly,
            hasClientTools: !!(options.clientTools && options.clientTools.length > 0),
            hasMcpServerConfigs: !!options.mcpServerConfigs,
            resume: options.resume,
            forkSession: options.forkSession,
            hasImages: Array.isArray(prompt),
        })

        if (!window.openadeAPI) {
            console.debug("[ClaudeQueryManager] startExecution: no openadeAPI - not running in Electron")
            return null
        }

        // Default options - caller overrides take precedence
        const defaultAllowedTools = ["Read", "Edit", "Glob", "Bash", "Grep", "WebSearch", "WebFetch"]
        const defaultDisallowedTools = ["AskUserQuestion", "EnterPlanMode", "ExitPlanMode"]
        // Note: Bash is intentionally allowed in read-only modes (plan/ask/revise) so the model can run
        // read-only commands like git log, git diff, ls, etc. The system prompt provides soft enforcement
        // against state-changing commands.
        const readOnlyDisallowedTools = ["Edit", "Write", "NotebookEdit"]

        // Build systemPrompt option if appendSystemPrompt is provided
        const systemPromptOption = options.appendSystemPrompt
            ? { type: "preset" as const, preset: "claude_code" as const, append: options.appendSystemPrompt }
            : options.systemPrompt

        const mergedOptions: ClientQueryOptions = {
            // Defaults that can be overridden
            model: "sonnet",
            tools: { type: "preset", preset: "claude_code" },
            permissionMode: "bypassPermissions",
            settingSources: ["user", "project", "local"],
            // Caller options override defaults
            ...options,
            // Handle systemPrompt specially
            systemPrompt: systemPromptOption,
            // Merge array fields: combine defaults with caller additions
            allowedTools: [...defaultAllowedTools, ...(options.allowedTools ?? []).filter((t) => !defaultAllowedTools.includes(t))],
            disallowedTools: [
                ...defaultDisallowedTools,
                ...(options.readOnly ? readOnlyDisallowedTools : []),
                ...(options.disallowedTools ?? []).filter((t) => !defaultDisallowedTools.includes(t) && !readOnlyDisallowedTools.includes(t)),
            ],
        }

        const finalId = executionId || crypto.randomUUID()
        const query = new ClaudeQuery(finalId, mergedOptions)

        // Register with manager
        this.queries.set(finalId, query)

        // Serialize tool definitions for IPC
        const { z } = await import("zod")
        const serializedTools: SerializedToolDefinition[] | undefined = mergedOptions.clientTools?.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: zodToJsonSchema(z.object(t.inputSchema)),
        }))

        // Build IPC options - exclude client-side-only fields
        const { clientTools: _, appendSystemPrompt: __, readOnly: ___, modelEnvVars: extractedModelEnvVars, ...restOptions } = mergedOptions
        const baseIpcOptions = { ...restOptions, ...(extractedModelEnvVars ? { modelEnvVars: extractedModelEnvVars } : {}) }
        const ipcOptions: QueryOptions = serializedTools ? { ...baseIpcOptions, clientTools: serializedTools } : baseIpcOptions

        // Start the query
        console.debug("[ClaudeQueryManager] startExecution: invoking openadeAPI.claude.query", {
            executionId: finalId,
            promptLength: prompt.length,
            model: ipcOptions.model,
            cwd: ipcOptions.cwd,
            allowedTools: ipcOptions.allowedTools,
            disallowedTools: ipcOptions.disallowedTools,
            hasSerializedTools: !!serializedTools,
            serializedToolCount: serializedTools?.length ?? 0,
        })

        try {
            const ipcResult = await window.openadeAPI.claude.query({
                executionId: finalId,
                prompt,
                options: ipcOptions,
            })
            console.debug("[ClaudeQueryManager] startExecution: query succeeded", {
                executionId: finalId,
                ipcResult,
            })
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err)
            const errorStack = err instanceof Error ? err.stack : undefined
            console.debug("[ClaudeQueryManager] startExecution: query FAILED", {
                executionId: finalId,
                errorMessage,
                errorStack,
            })
            // Clean up query from manager since it failed
            this.queries.delete(finalId)
            return null
        }

        return query
    }

    /**
     * Attach to an existing execution (reconnection)
     */
    async attachExecution(executionId: string, toolHandlers?: Map<string, ToolHandler>): Promise<ClaudeQuery | null> {
        console.debug("[ClaudeQueryManager] attachExecution called", { executionId, hasToolHandlers: !!toolHandlers })
        if (!window.openadeAPI) {
            console.debug("[ClaudeQueryManager] attachExecution: no openadeAPI available")
            return null
        }

        // Check if we already have this query
        let query = this.queries.get(executionId)
        if (!query) {
            query = new ClaudeQuery(executionId)
            this.queries.set(executionId, query)
        }

        // Register tool handlers if provided
        if (toolHandlers) {
            for (const [name, handler] of toolHandlers) {
                query.registerToolHandler(name, handler)
            }
        }

        // Reconnect to get buffered events
        const result = (await window.openadeAPI.claude.reconnect({ executionId })) as {
            ok: boolean
            found: boolean
            events?: ClaudeStreamEvent[]
            completed?: boolean
            error?: string
        }

        if (!result.found) {
            this.queries.delete(executionId)
            return null
        }

        // Process buffered events from unified response
        if (result.events) {
            for (const event of result.events) {
                query.handleEvent(event)
            }
        }

        return query
    }

    /**
     * Get an existing query
     */
    getQuery(executionId: string): ClaudeQuery | null {
        return this.queries.get(executionId) || null
    }

    /**
     * Clear the Electron-side buffer for an execution
     */
    async clearBuffer(executionId: string): Promise<void> {
        const query = this.queries.get(executionId)
        if (query) {
            await query.clearBuffer()
        }
    }

    /**
     * Cleanup a query (remove from manager)
     */
    cleanup(executionId: string): void {
        this.queries.delete(executionId)
    }
}

// Singleton instance
let managerInstance: ClaudeQueryManagerImpl | null = null

export function getClaudeQueryManager(): ClaudeQueryManagerImpl {
    if (!managerInstance) {
        managerInstance = new ClaudeQueryManagerImpl()
    }
    return managerInstance
}

/**
 * Check if Claude API is available (running in Electron)
 */
export function isClaudeApiAvailable(): boolean {
    const available = isCodeModuleAvailable()
    console.debug("[ClaudeAPI] isClaudeApiAvailable called", { available, hasOpenadeAPI: !!window.openadeAPI })
    return available
}
