/**
 * Harness Bridge for Electron
 *
 * This module replaces the former Claude Agent SDK bridge (claude.ts) with
 * a unified harness layer powered by @openade/harness.  It supports multiple
 * AI coding CLIs (Claude Code, Codex, and future harnesses) via a single
 * registry and IPC interface.
 *
 * Features:
 * - Single unified event stream (HarnessStreamEvent) for all communication
 * - Global buffering with 30-minute retention or explicit clear
 * - Reconnection support after renderer refresh
 * - Client-defined tools that execute in the renderer process (proxied via IPC)
 * - stderr capture and streaming
 * - Backward-compatible "claude:*" IPC channels
 */

import { ipcMain, type IpcMainInvokeEvent, type WebContents } from "electron"
import {
    HarnessRegistry,
    ClaudeCodeHarness,
    CodexHarness,
    type HarnessEvent,
    type HarnessQuery,
    type HarnessId,
    type McpServerConfig,
    type ClientToolDefinition,
    type ClientToolResult,
} from "@openade/harness"
import { isDev } from "../../config.js"
import { setSdkCache } from "./capabilities.js"

// ============================================================================
// Registry — singleton shared with capabilities.ts
// ============================================================================

export const registry = new HarnessRegistry()

// Register harnesses at module level.
// Binary resolution is handled by the harness internally via resolveExecutable().
// The managed binaries (bun, rg) are on PATH via binaries.ts enhancePath(),
// but claude/codex CLI resolution is done by each harness.
registry.register(new ClaudeCodeHarness())
registry.register(new CodexHarness())

// ============================================================================
// Shared Types (mirrors claudeEventTypes.ts in dashboard)
// ============================================================================

/** Serialized tool definition received from renderer (with JSON Schema) */
interface SerializedToolDefinition {
    name: string
    description: string
    inputSchema: Record<string, unknown>
}

/** Tool result from renderer */
interface ToolResult {
    content: Array<{ type: "text"; text: string }>
    isError?: boolean
}

/** Query options received over IPC from the renderer */
interface HarnessQueryOptions {
    harnessId: HarnessId
    cwd: string
    mode?: "read-only" | "yolo"
    model?: string
    thinking?: "low" | "med" | "high"
    appendSystemPrompt?: string
    resumeSessionId?: string
    forkSession?: boolean
    additionalDirectories?: string[]
    env?: Record<string, string>
    disablePlanningTools?: boolean
    mcpServerConfigs?: Record<string, McpServerConfig>
    clientTools?: SerializedToolDefinition[]
}

type ContentBlock =
    | { type: "text"; text: string }
    | { type: "image"; source: { type: "base64"; media_type: string; data: string } }

// ============================================================================
// Unified Event Types
// ============================================================================

// Base event shapes without id (used for emitting)
type HarnessExecutionEventBase =
    | { type: "raw_message"; executionId: string; harnessId: HarnessId; message: unknown }
    | { type: "stderr"; executionId: string; harnessId: HarnessId; data: string }
    | { type: "complete"; executionId: string; harnessId: HarnessId; usage?: unknown }
    | { type: "error"; executionId: string; harnessId: HarnessId; error: string; code?: string }
    | { type: "tool_call"; executionId: string; harnessId: HarnessId; callId: string; toolName: string; args: unknown }
    | { type: "session_started"; executionId: string; harnessId: HarnessId; sessionId: string }

type HarnessExecutionEvent = HarnessExecutionEventBase & { id: string }

type HarnessCommandEvent =
    | {
          id: string
          type: "start_query"
          executionId: string
          prompt: string | ContentBlock[]
          options: HarnessQueryOptions
      }
    | { id: string; type: "tool_response"; executionId: string; callId: string; result?: ToolResult; error?: string }
    | { id: string; type: "abort"; executionId: string }
    | { id: string; type: "reconnect"; executionId: string }
    | { id: string; type: "clear_buffer"; executionId: string }

type HarnessStreamEvent =
    | (HarnessExecutionEvent & { direction: "execution" })
    | (HarnessCommandEvent & { direction: "command" })

// ============================================================================
// Execution State
// ============================================================================

interface ExecutionState {
    executionId: string
    harnessId: HarnessId
    status: "in_progress" | "completed" | "error" | "aborted"
    sessionId?: string
    cwd?: string
    events: HarnessStreamEvent[]
    abortController: AbortController
    webContents: WebContents | null
    cleanupTimer: ReturnType<typeof setTimeout> | null
    createdAt: string
    completedAt?: string
}

/** Pending tool call waiting for renderer response */
interface PendingToolCall {
    resolve: (result: ClientToolResult) => void
    reject: (error: Error) => void
}

// ============================================================================
// Global State
// ============================================================================

// Track active executions with full event buffers
const activeExecutions = new Map<string, ExecutionState>()

// Track pending tool calls waiting for renderer response
const pendingToolCalls = new Map<string, PendingToolCall>()

// Buffer retention time (30 minutes)
const BUFFER_RETENTION_MS = 30 * 60 * 1000

// ============================================================================
// Helper Functions
// ============================================================================

function checkAllowed(e: IpcMainInvokeEvent): boolean {
    const origin = e.sender.getURL()
    console.debug("[Harness] checkAllowed called", { origin, isDev })
    try {
        const url = new URL(origin)
        const allowed = isDev
            ? url.hostname.endsWith("localhost")
            : url.hostname.endsWith("localhost") || url.protocol === "file:"
        if (!allowed) {
            console.debug("[Harness] checkAllowed REJECTED - hostname not allowed", {
                hostname: url.hostname,
                isDev,
            })
        }
        return allowed
    } catch (err) {
        console.debug("[Harness] checkAllowed REJECTED - URL parse error", {
            origin,
            error: String(err),
        })
        return false
    }
}

/** Reset the cleanup timer for an execution */
function resetCleanupTimer(executionId: string): void {
    const execution = activeExecutions.get(executionId)
    if (!execution) return

    if (execution.cleanupTimer) {
        clearTimeout(execution.cleanupTimer)
    }

    execution.cleanupTimer = setTimeout(() => {
        console.log("[Harness] Cleaning up stale execution:", executionId)
        activeExecutions.delete(executionId)
    }, BUFFER_RETENTION_MS)
}

/** Emit an execution event to the buffer and renderer */
function emitExecutionEvent(executionId: string, event: HarnessExecutionEventBase): void {
    const execution = activeExecutions.get(executionId)
    if (!execution) {
        console.debug("[Harness] emitExecutionEvent: no execution found", {
            executionId,
            eventType: event.type,
        })
        return
    }

    const fullEvent: HarnessStreamEvent = {
        ...event,
        id: crypto.randomUUID(),
        direction: "execution",
    } as HarnessStreamEvent

    // Buffer the event
    execution.events.push(fullEvent)

    // Reset cleanup timer on activity
    resetCleanupTimer(executionId)

    // Send to renderer if connected
    if (execution.webContents && !execution.webContents.isDestroyed()) {
        // New channel
        execution.webContents.send("harness:event", fullEvent)
        // Legacy channel for backward compat
        execution.webContents.send("claude:event", fullEvent)
    } else {
        console.debug("[Harness] emitExecutionEvent: no webContents to send to", {
            executionId,
            eventType: event.type,
            hasWebContents: !!execution.webContents,
            isDestroyed: execution.webContents?.isDestroyed(),
        })
    }
}

/** Record a command event in the buffer */
function recordCommandEvent(executionId: string, event: Omit<HarnessCommandEvent, "id">): void {
    const execution = activeExecutions.get(executionId)
    if (!execution) return

    const fullEvent: HarnessStreamEvent = {
        ...event,
        id: crypto.randomUUID(),
        direction: "command",
    } as HarnessStreamEvent

    execution.events.push(fullEvent)
    resetCleanupTimer(executionId)
}

// ============================================================================
// Streaming
// ============================================================================

async function streamToRenderer(
    executionId: string,
    harnessId: HarnessId,
    generator: AsyncGenerator<HarnessEvent<unknown>>
): Promise<void> {
    const execution = activeExecutions.get(executionId)
    if (!execution) {
        console.debug("[Harness] streamToRenderer: no execution found, aborting stream", {
            executionId,
        })
        return
    }

    console.debug("[Harness] streamToRenderer: starting stream loop", { executionId, harnessId })
    let messageCount = 0

    try {
        for await (const harnessEvent of generator) {
            messageCount++
            if (messageCount <= 3 || messageCount % 10 === 0) {
                console.debug("[Harness] streamToRenderer: event received", {
                    executionId,
                    messageCount,
                    eventType: harnessEvent.type,
                })
            }

            switch (harnessEvent.type) {
                case "message":
                    emitExecutionEvent(executionId, {
                        type: "raw_message",
                        executionId,
                        harnessId,
                        message: harnessEvent.message,
                    })

                    // Update SDK capabilities cache from system:init message (Claude Code specific)
                    if (harnessId === "claude-code") {
                        const msg = harnessEvent.message as Record<string, unknown>
                        if (
                            msg.type === "system" &&
                            "subtype" in msg &&
                            msg.subtype === "init" &&
                            "session_id" in msg
                        ) {
                            const sessionId = msg.session_id as string
                            execution.sessionId = sessionId

                            if (execution.cwd) {
                                setSdkCache(execution.cwd, {
                                    slash_commands: (msg.slash_commands as string[]) ?? [],
                                    skills: (msg.skills as string[]) ?? [],
                                    plugins:
                                        (msg.plugins as { name: string; path: string }[]) ?? [],
                                    cachedAt: Date.now(),
                                })
                            }
                        }
                    }
                    break

                case "session_started":
                    execution.sessionId = harnessEvent.sessionId
                    emitExecutionEvent(executionId, {
                        type: "session_started",
                        executionId,
                        harnessId,
                        sessionId: harnessEvent.sessionId,
                    })
                    break

                case "complete":
                    execution.status = "completed"
                    execution.completedAt = new Date().toISOString()
                    emitExecutionEvent(executionId, {
                        type: "complete",
                        executionId,
                        harnessId,
                        usage: harnessEvent.usage,
                    })
                    break

                case "error":
                    emitExecutionEvent(executionId, {
                        type: "error",
                        executionId,
                        harnessId,
                        error: harnessEvent.error,
                        code: harnessEvent.code,
                    })
                    break

                case "stderr":
                    emitExecutionEvent(executionId, {
                        type: "stderr",
                        executionId,
                        harnessId,
                        data: harnessEvent.data,
                    })
                    break
            }
        }

        // If we get here without a "complete" event having set status, mark completed
        if (execution.status === "in_progress") {
            console.debug("[Harness] streamToRenderer: stream ended without complete event", {
                executionId,
                messageCount,
            })
            execution.status = "completed"
            execution.completedAt = new Date().toISOString()
        }
    } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : "Unknown error"
        const errorStack = err instanceof Error ? err.stack : undefined
        console.debug("[Harness] streamToRenderer: stream ERROR", {
            executionId,
            messageCount,
            errorMessage,
            errorStack,
        })

        // AbortError is expected when the user cancels
        if (err instanceof Error && (err.name === "AbortError" || err.message?.includes("abort"))) {
            if (execution.status === "in_progress") {
                execution.status = "aborted"
                execution.completedAt = new Date().toISOString()
            }
            return
        }

        execution.status = "error"
        execution.completedAt = new Date().toISOString()
        emitExecutionEvent(executionId, {
            type: "error",
            executionId,
            harnessId,
            error: errorMessage,
        })
    }
}

// ============================================================================
// Command Handlers
// ============================================================================

async function handleStartQuery(
    event: IpcMainInvokeEvent,
    command: HarnessCommandEvent & { type: "start_query" }
): Promise<{ ok: boolean; error?: string }> {
    const { executionId, prompt, options } = command
    const harnessId = options.harnessId || "claude-code"
    const promptPreview =
        typeof prompt === "string" ? prompt.slice(0, 100) : `[${prompt.length} content blocks]`

    console.debug("[Harness] handleStartQuery called", {
        executionId,
        harnessId,
        promptPreview,
        hasClientTools: !!(options.clientTools && options.clientTools.length > 0),
        clientToolCount: options.clientTools?.length ?? 0,
        model: options.model,
        cwd: options.cwd,
    })

    const harness = registry.get(harnessId)
    if (!harness) {
        return { ok: false, error: `Unknown harness: ${harnessId}` }
    }

    const abortController = new AbortController()

    // Create execution state
    const execution: ExecutionState = {
        executionId,
        harnessId,
        status: "in_progress",
        cwd: options.cwd,
        events: [],
        abortController,
        webContents: event.sender,
        cleanupTimer: null,
        createdAt: new Date().toISOString(),
    }

    activeExecutions.set(executionId, execution)

    // Record the start command
    recordCommandEvent(executionId, command)

    // Set initial cleanup timer
    resetCleanupTimer(executionId)

    // Build client tool definitions with IPC-proxied handlers
    let clientTools: ClientToolDefinition[] | undefined
    if (options.clientTools && options.clientTools.length > 0) {
        console.log("[Harness] Creating client tools with IPC proxies:", options.clientTools.length)

        clientTools = options.clientTools.map(
            (toolDef: SerializedToolDefinition): ClientToolDefinition => ({
                name: toolDef.name,
                description: toolDef.description,
                inputSchema: toolDef.inputSchema,
                handler: async (inputArgs: Record<string, unknown>): Promise<ClientToolResult> => {
                    const callId = crypto.randomUUID()

                    const currentExecution = activeExecutions.get(executionId)
                    if (
                        !currentExecution?.webContents ||
                        currentExecution.webContents.isDestroyed()
                    ) {
                        return { error: "No renderer connected for tool call" }
                    }

                    // Emit tool_call event via unified stream
                    emitExecutionEvent(executionId, {
                        type: "tool_call",
                        executionId,
                        harnessId,
                        callId,
                        toolName: toolDef.name,
                        args: inputArgs,
                    })

                    // Also send via legacy channel for backward compatibility
                    currentExecution.webContents.send(
                        `claude:tool-call:${executionId}`,
                        callId,
                        toolDef.name,
                        inputArgs
                    )

                    // Wait for response from renderer
                    return new Promise<ClientToolResult>((resolve, reject) => {
                        const timeout = setTimeout(() => {
                            if (pendingToolCalls.has(callId)) {
                                pendingToolCalls.delete(callId)
                                reject(new Error(`Tool call timed out: ${toolDef.name}`))
                            }
                        }, 5 * 60 * 1000)

                        pendingToolCalls.set(callId, {
                            resolve: (result) => {
                                clearTimeout(timeout)
                                resolve(result)
                            },
                            reject: (error) => {
                                clearTimeout(timeout)
                                reject(error)
                            },
                        })
                    })
                },
            })
        )
    }

    // Build HarnessQuery
    const harnessQuery: HarnessQuery = {
        prompt:
            typeof prompt === "string"
                ? prompt
                : prompt.map((block) => {
                      if (block.type === "text") {
                          return { type: "text" as const, text: block.text }
                      }
                      // Image block
                      return {
                          type: "image" as const,
                          source: {
                              kind: "base64" as const,
                              data: block.source.data,
                              mediaType: block.source.media_type,
                          },
                      }
                  }),
        cwd: options.cwd,
        mode: options.mode ?? "yolo",
        model: options.model,
        thinking: options.thinking,
        appendSystemPrompt: options.appendSystemPrompt,
        resumeSessionId: options.resumeSessionId,
        forkSession: options.forkSession,
        additionalDirectories: options.additionalDirectories,
        env: options.env,
        disablePlanningTools: options.disablePlanningTools,
        mcpServers: options.mcpServerConfigs,
        clientTools,
        signal: abortController.signal,
    }

    console.debug("[Harness] handleStartQuery: calling harness.query()", {
        executionId,
        harnessId,
        model: harnessQuery.model,
        cwd: harnessQuery.cwd,
        hasClientTools: !!clientTools,
        clientToolCount: clientTools?.length ?? 0,
    })

    let generator: AsyncGenerator<HarnessEvent<unknown>>
    try {
        generator = harness.query(harnessQuery) as AsyncGenerator<HarnessEvent<unknown>>
        console.debug(
            "[Harness] handleStartQuery: query() returned successfully (async generator created)",
            { executionId }
        )
    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Unknown error"
        const errorStack = err instanceof Error ? err.stack : undefined
        console.debug("[Harness] handleStartQuery: query() THREW synchronously", {
            executionId,
            errorMessage,
            errorStack,
        })
        execution.status = "error"
        execution.completedAt = new Date().toISOString()
        emitExecutionEvent(executionId, {
            type: "error",
            executionId,
            harnessId,
            error: errorMessage,
        })
        return { ok: false, error: errorMessage }
    }

    // Start streaming (don't await - runs async)
    console.debug("[Harness] handleStartQuery: starting streamToRenderer (fire-and-forget)", {
        executionId,
    })
    streamToRenderer(executionId, harnessId, generator)

    return { ok: true }
}

function handleToolResponse(
    command: HarnessCommandEvent & { type: "tool_response" }
): { ok: boolean; error?: string } {
    const { executionId, callId, result, error } = command

    // Record the command
    recordCommandEvent(executionId, command)

    const pending = pendingToolCalls.get(callId)
    if (!pending) {
        console.warn("[Harness] Tool response for unknown call:", callId)
        return { ok: false, error: "Unknown call ID" }
    }

    pendingToolCalls.delete(callId)

    if (error) {
        pending.reject(new Error(error))
    } else if (result) {
        // Convert ToolResult (from renderer) to ClientToolResult (harness format)
        const textContent = result.content.map((c) => c.text).join("\n")
        if (result.isError) {
            pending.resolve({ error: textContent })
        } else {
            pending.resolve({ content: textContent })
        }
    } else {
        pending.reject(new Error("No result or error in tool response"))
    }

    return { ok: true }
}

function handleAbort(command: HarnessCommandEvent & { type: "abort" }): { ok: boolean } {
    const { executionId } = command
    console.debug("[Harness] handleAbort called", {
        executionId,
        hasExecution: activeExecutions.has(executionId),
    })

    const execution = activeExecutions.get(executionId)
    if (execution) {
        recordCommandEvent(executionId, command)

        execution.abortController.abort()
        execution.status = "aborted"
        execution.completedAt = new Date().toISOString()

        if (execution.cleanupTimer) {
            clearTimeout(execution.cleanupTimer)
        }

        // Don't delete immediately - keep buffer for a bit
        resetCleanupTimer(executionId)
    }

    return { ok: true }
}

function handleReconnect(
    event: IpcMainInvokeEvent,
    command: HarnessCommandEvent & { type: "reconnect" }
): { ok: boolean; found: boolean; events?: HarnessStreamEvent[] } {
    const { executionId } = command
    console.debug("[Harness] handleReconnect called", {
        executionId,
        hasExecution: activeExecutions.has(executionId),
    })

    const execution = activeExecutions.get(executionId)
    if (!execution) {
        console.debug("[Harness] handleReconnect: execution not found", { executionId })
        return { ok: false, found: false }
    }

    recordCommandEvent(executionId, command)

    // Update webContents reference
    execution.webContents = event.sender

    // Reset cleanup timer
    resetCleanupTimer(executionId)

    // Return all buffered events
    return { ok: true, found: true, events: execution.events }
}

function handleClearBuffer(
    command: HarnessCommandEvent & { type: "clear_buffer" }
): { ok: boolean } {
    const { executionId } = command

    const execution = activeExecutions.get(executionId)
    if (execution) {
        if (execution.cleanupTimer) {
            clearTimeout(execution.cleanupTimer)
        }
        activeExecutions.delete(executionId)
        console.log("[Harness] Buffer cleared for execution:", executionId)
    }

    return { ok: true }
}

// ============================================================================
// IPC Handlers
// ============================================================================

export const load = () => {
    console.log("[Harness] Registering unified IPC handlers...")

    // ── New unified command handler ──
    ipcMain.handle(
        "harness:command",
        async (
            event,
            command: HarnessCommandEvent
        ): Promise<{
            ok: boolean
            found?: boolean
            events?: HarnessStreamEvent[]
            error?: string
        }> => {
            if (!checkAllowed(event)) throw new Error("not allowed")

            switch (command.type) {
                case "start_query":
                    return handleStartQuery(event, command)
                case "tool_response":
                    return handleToolResponse(command)
                case "abort":
                    return handleAbort(command)
                case "reconnect":
                    return handleReconnect(event, command)
                case "clear_buffer":
                    return handleClearBuffer(command)
                default:
                    return { ok: false, error: "Unknown command type" }
            }
        }
    )

    // ── Legacy "claude:command" handler (backward compat, delegates to same handlers) ──
    ipcMain.handle(
        "claude:command",
        async (
            event,
            command: HarnessCommandEvent
        ): Promise<{
            ok: boolean
            found?: boolean
            events?: HarnessStreamEvent[]
            error?: string
        }> => {
            if (!checkAllowed(event)) throw new Error("not allowed")

            // Ensure harnessId defaults to claude-code for legacy callers
            if (command.type === "start_query" && !command.options.harnessId) {
                command.options.harnessId = "claude-code"
            }

            switch (command.type) {
                case "start_query":
                    return handleStartQuery(event, command)
                case "tool_response":
                    return handleToolResponse(command)
                case "abort":
                    return handleAbort(command)
                case "reconnect":
                    return handleReconnect(event, command)
                case "clear_buffer":
                    return handleClearBuffer(command)
                default:
                    return { ok: false, error: "Unknown command type" }
            }
        }
    )

    // ── Legacy individual handlers for backward compatibility ──

    ipcMain.handle(
        "claude:tool-response",
        async (
            event,
            args: {
                executionId: string
                callId: string
                result?: ToolResult
                error?: string
            }
        ) => {
            if (!checkAllowed(event)) throw new Error("not allowed")
            return handleToolResponse({
                id: crypto.randomUUID(),
                type: "tool_response",
                executionId: args.executionId,
                callId: args.callId,
                result: args.result,
                error: args.error,
            })
        }
    )

    ipcMain.handle(
        "claude:query",
        async (
            event,
            args: {
                executionId: string
                prompt: string | ContentBlock[]
                options?: HarnessQueryOptions
            }
        ) => {
            console.debug("[Harness] IPC claude:query received (legacy)", {
                executionId: args.executionId,
            })
            if (!checkAllowed(event)) throw new Error("not allowed")
            return handleStartQuery(event, {
                id: crypto.randomUUID(),
                type: "start_query",
                executionId: args.executionId,
                prompt: args.prompt,
                options: {
                    harnessId: "claude-code",
                    cwd: args.options?.cwd ?? process.cwd(),
                    ...args.options,
                },
            })
        }
    )

    ipcMain.handle("claude:reconnect", async (event, args: { executionId: string }) => {
        if (!checkAllowed(event)) throw new Error("not allowed")

        handleReconnect(event, {
            id: crypto.randomUUID(),
            type: "reconnect",
            executionId: args.executionId,
        })

        const execution = activeExecutions.get(args.executionId)
        if (!execution) {
            return { ok: false, found: false }
        }

        // Send events via legacy channels for backward compatibility
        for (const evt of execution.events) {
            if (evt.direction === "execution" && evt.type === "raw_message") {
                event.sender.send(
                    `claude:message:${args.executionId}`,
                    (evt as HarnessExecutionEvent & { type: "raw_message" }).message
                )
            }
        }

        if (execution.status === "completed") {
            event.sender.send(`claude:complete:${args.executionId}`)
            return {
                ok: true,
                found: true,
                completed: true,
                messageCount: execution.events.length,
            }
        }

        if (execution.status === "error") {
            const errorEvent = execution.events.find(
                (e) => e.direction === "execution" && e.type === "error"
            ) as (HarnessExecutionEvent & { type: "error" }) | undefined
            event.sender.send(
                `claude:error:${args.executionId}`,
                errorEvent?.error ?? "Unknown error"
            )
            return {
                ok: true,
                found: true,
                error: errorEvent?.error,
                messageCount: execution.events.length,
            }
        }

        return { ok: true, found: true, completed: false, messageCount: execution.events.length }
    })

    ipcMain.handle("claude:abort", async (event, args: { executionId: string }) => {
        if (!checkAllowed(event)) throw new Error("not allowed")
        return handleAbort({
            id: crypto.randomUUID(),
            type: "abort",
            executionId: args.executionId,
        })
    })
}

// ============================================================================
// Query Status
// ============================================================================

/** Check if there are any active queries in progress */
export function hasActiveQueries(): boolean {
    for (const execution of activeExecutions.values()) {
        if (execution.status === "in_progress") {
            return true
        }
    }
    return false
}

// ============================================================================
// Cleanup
// ============================================================================

export const cleanup = () => {
    for (const [executionId, execution] of activeExecutions) {
        execution.abortController.abort()
        if (execution.cleanupTimer) {
            clearTimeout(execution.cleanupTimer)
        }
        activeExecutions.delete(executionId)
    }
}
