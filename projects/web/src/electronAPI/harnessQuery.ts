/**
 * Harness Query Bridge - Client Side
 *
 * Unified event stream API for communicating with Electron main process.
 * Replaces claude.ts with harness-agnostic types.
 *
 * Architecture:
 * - HarnessQueryManager: Singleton that manages all executions and routes events
 * - HarnessQuery: Individual query instance for a single execution
 *
 * Features:
 * - Single unified event stream (HarnessStreamEvent)
 * - Global buffering and deduplication
 * - Reconnection support after renderer refresh
 * - Client-defined tools with renderer-side handlers
 */

import type { ZodObject, ZodRawShape, z } from "zod"
import { zodToJsonSchema } from "zod-to-json-schema"
import {
    type ContentBlock,
    type ExecutionState,
    type HarnessCommandEvent,
    type HarnessExecutionEvent,
    type HarnessId,
    type HarnessQueryOptions,
    type HarnessRawMessageEvent,
    type HarnessStreamEvent,
    type McpServerConfig,
    type SerializedToolDefinition,
    type ToolResult,
    extractRawMessageEvents,
    extractStderr,
    hasEventId,
} from "./harnessEventTypes"

// Re-export types for convenience
export type { HarnessRawMessageEvent, HarnessStreamEvent, HarnessExecutionEvent, HarnessCommandEvent, ExecutionState, ToolResult, McpServerConfig, HarnessId, HarnessQueryOptions, ContentBlock }

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

export type ClientHarnessQueryOptions = HarnessQueryOptions & {
    /** Client-defined tools that execute in the renderer process (with handlers) */
    clientToolDefinitions?: AnyClientToolDefinition[]
}

// ============================================================================
// API Check
// ============================================================================

import { isCodeModuleAvailable } from "./capabilities"

// ============================================================================
// HarnessQuery Class
// ============================================================================

type EventHandler = (...args: unknown[]) => void
type ToolHandler = (args: unknown) => Promise<ToolResult>

/**
 * HarnessQuery - wrapper for a single query to a harness
 */
export class HarnessQuery {
    private _executionId: string
    private _options: ClientHarnessQueryOptions
    private _executionState: ExecutionState
    private _isAborted = false
    private listeners: Map<string, EventHandler[]> = new Map()
    private toolHandlers: Map<string, ToolHandler> = new Map()

    constructor(executionId: string, options: ClientHarnessQueryOptions = { harnessId: "claude-code", cwd: "" }) {
        this._executionId = executionId
        this._options = options
        this._executionState = {
            executionId,
            harnessId: options.harnessId,
            status: "in_progress",
            events: [],
            createdAt: new Date().toISOString(),
        }

        // Register tool handlers
        if (options.clientToolDefinitions) {
            for (const tool of options.clientToolDefinitions) {
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
    get options(): ClientHarnessQueryOptions {
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

    /** Get all raw message events from the event stream */
    getRawMessageEvents(): HarnessRawMessageEvent[] {
        return extractRawMessageEvents(this._executionState.events)
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
    handleEvent(event: HarnessStreamEvent): boolean {
        // Deduplicate by event ID
        if (hasEventId(this._executionState.events, event.id)) {
            console.debug("[HarnessQuery] handleEvent: duplicate event skipped", { executionId: this._executionId, eventId: event.id, type: event.type })
            return false
        }

        console.debug("[HarnessQuery] handleEvent", { executionId: this._executionId, direction: event.direction, type: event.type, eventId: event.id })

        // Add to buffer
        this._executionState.events.push(event)

        // Process the event
        if (event.direction === "execution") {
            this.processExecutionEvent(event)
        }

        return true
    }

    private processExecutionEvent(event: HarnessExecutionEvent & { direction: "execution" }): void {
        switch (event.type) {
            case "raw_message":
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
                console.error("[HarnessQuery] Execution error:", event.error)
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
        console.debug("[HarnessQuery] handleToolCall", { executionId: this._executionId, callId, toolName, hasArgs: !!args })
        if (!window.openadeAPI) {
            console.debug("[HarnessQuery] handleToolCall: no openadeAPI, cannot respond", { callId, toolName })
            return
        }

        const handler = this.toolHandlers.get(toolName)
        if (!handler) {
            console.debug("[HarnessQuery] No handler for tool (expected during reconnect):", toolName)
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

        const command: HarnessCommandEvent = {
            id: crypto.randomUUID(),
            type: "tool_response",
            executionId: this._executionId,
            callId,
            result,
            error,
        }

        // Send via openadeAPI
        await window.openadeAPI.harness.toolResponse({
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
     * Async generator that yields raw messages as they arrive.
     * Messages are untyped here — callers narrow via harnessId on the persisted event.
     */
    async *stream(): AsyncGenerator<unknown> {
        const messageQueue: unknown[] = []
        let resolveNext: (() => void) | null = null
        let isDone = false

        const onMessage = (msg: unknown) => {
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

        await window.openadeAPI.harness.abort({ executionId: this._executionId })
        this._isAborted = true
        this._executionState.status = "aborted"
        this._executionState.completedAt = new Date().toISOString()
    }

    /**
     * Clear the Electron-side buffer (call after persisting to storage)
     */
    async clearBuffer(): Promise<void> {
        if (!window.openadeAPI) return

        const command: HarnessCommandEvent = {
            id: crypto.randomUUID(),
            type: "clear_buffer",
            executionId: this._executionId,
        }

        await window.openadeAPI.harness.command(command)
    }

    /**
     * Clean up this query's resources (removes from manager)
     */
    cleanup(): void {
        getHarnessQueryManager().cleanup(this._executionId)
    }
}

// ============================================================================
// HarnessQueryManager Singleton
// ============================================================================

/**
 * HarnessQueryManager - manages all harness executions
 *
 * Provides a single point of contact for:
 * - Starting new executions
 * - Attaching to existing executions (reconnection)
 * - Routing events to appropriate HarnessQuery instances
 */
class HarnessQueryManagerImpl {
    private queries: Map<string, HarnessQuery> = new Map()
    // @ts-expect-error Stored for potential future cleanup - intentionally unused
    private _unsubscribeEvent: (() => void) | null = null

    constructor() {
        this.setupEventListener()
    }

    private setupEventListener(): void {
        if (!window.openadeAPI) {
            console.debug("[HarnessQueryManager] setupEventListener: no openadeAPI available, skipping")
            return
        }

        console.debug("[HarnessQueryManager] setupEventListener: registering harness event listener")

        // Subscribe to unified events using the new pattern
        this._unsubscribeEvent = window.openadeAPI.harness.onEvent((event) => {
            const streamEvent = event as HarnessStreamEvent
            const query = this.queries.get(streamEvent.executionId)
            if (query) {
                query.handleEvent(streamEvent)
            } else {
                console.debug("[HarnessQueryManager] event received for unknown executionId", {
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
        prompt: string | ContentBlock[],
        options: ClientHarnessQueryOptions,
        executionId?: string
    ): Promise<HarnessQuery | null> {
        const promptPreview = typeof prompt === "string" ? prompt.slice(0, 100) : `[${prompt.length} content blocks]`
        console.debug("[HarnessQueryManager] startExecution called", {
            promptLength: prompt.length,
            promptPreview,
            executionId,
            harnessId: options.harnessId,
            model: options.model,
            cwd: options.cwd,
            mode: options.mode,
            hasClientToolDefinitions: !!(options.clientToolDefinitions && options.clientToolDefinitions.length > 0),
            hasMcpServerConfigs: !!options.mcpServerConfigs,
            resumeSessionId: options.resumeSessionId,
            forkSession: options.forkSession,
            hasImages: Array.isArray(prompt),
        })

        if (!window.openadeAPI) {
            console.debug("[HarnessQueryManager] startExecution: no openadeAPI - not running in Electron")
            return null
        }

        const mergedOptions: ClientHarnessQueryOptions = {
            // Defaults
            model: "sonnet",
            disablePlanningTools: true,
            // Caller options override defaults
            ...options,
        }

        const finalId = executionId || crypto.randomUUID()
        const query = new HarnessQuery(finalId, mergedOptions)

        // Register with manager
        this.queries.set(finalId, query)

        // Serialize tool definitions for IPC
        const { z } = await import("zod")
        const serializedTools: SerializedToolDefinition[] | undefined = mergedOptions.clientToolDefinitions?.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: zodToJsonSchema(z.object(t.inputSchema)),
        }))

        // Build IPC options - exclude client-side-only fields
        const { clientToolDefinitions: _, ...restOptions } = mergedOptions
        const ipcOptions: HarnessQueryOptions = serializedTools ? { ...restOptions, clientTools: serializedTools } : restOptions

        // Start the query
        console.debug("[HarnessQueryManager] startExecution: invoking openadeAPI.harness.query", {
            executionId: finalId,
            promptLength: prompt.length,
            harnessId: ipcOptions.harnessId,
            model: ipcOptions.model,
            cwd: ipcOptions.cwd,
            mode: ipcOptions.mode,
            disablePlanningTools: ipcOptions.disablePlanningTools,
            hasSerializedTools: !!serializedTools,
            serializedToolCount: serializedTools?.length ?? 0,
        })

        try {
            const ipcResult = await window.openadeAPI.harness.query({
                executionId: finalId,
                prompt,
                options: ipcOptions,
            })
            console.debug("[HarnessQueryManager] startExecution: query succeeded", {
                executionId: finalId,
                ipcResult,
            })
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err)
            const errorStack = err instanceof Error ? err.stack : undefined
            console.debug("[HarnessQueryManager] startExecution: query FAILED", {
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
    async attachExecution(executionId: string, toolHandlers?: Map<string, ToolHandler>): Promise<HarnessQuery | null> {
        console.debug("[HarnessQueryManager] attachExecution called", { executionId, hasToolHandlers: !!toolHandlers })
        if (!window.openadeAPI) {
            console.debug("[HarnessQueryManager] attachExecution: no openadeAPI available")
            return null
        }

        // Check if we already have this query
        let query = this.queries.get(executionId)
        if (!query) {
            query = new HarnessQuery(executionId)
            this.queries.set(executionId, query)
        }

        // Register tool handlers if provided
        if (toolHandlers) {
            for (const [name, handler] of toolHandlers) {
                query.registerToolHandler(name, handler)
            }
        }

        // Reconnect to get buffered events
        const result = (await window.openadeAPI.harness.reconnect({ executionId })) as {
            ok: boolean
            found: boolean
            events?: HarnessStreamEvent[]
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
    getQuery(executionId: string): HarnessQuery | null {
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
let managerInstance: HarnessQueryManagerImpl | null = null

export function getHarnessQueryManager(): HarnessQueryManagerImpl {
    if (!managerInstance) {
        managerInstance = new HarnessQueryManagerImpl()
    }
    return managerInstance
}

/**
 * Check if Harness API is available (running in Electron)
 */
export function isHarnessApiAvailable(): boolean {
    const available = isCodeModuleAvailable()
    console.debug("[HarnessAPI] isHarnessApiAvailable called", { available, hasOpenadeAPI: !!window.openadeAPI })
    return available
}
