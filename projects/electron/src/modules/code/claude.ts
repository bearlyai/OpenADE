/**
 * Claude Agent SDK Bridge for Electron
 *
 * This module exposes Claude Agent SDK v1 query() to the dashboard frontend via IPC.
 * Uses a unified event stream for all communication.
 *
 * Features:
 * - Single unified event stream (ClaudeStreamEvent) for all communication
 * - Global buffering with 10-minute retention or explicit clear
 * - Reconnection support after renderer refresh
 * - Client-defined tools that execute in the renderer process
 * - stderr capture and streaming
 */

import { ipcMain, type IpcMainInvokeEvent, type WebContents } from "electron"
import { query, createSdkMcpServer, tool, type Options, type McpServerConfig } from "@anthropic-ai/claude-agent-sdk"
import { isDev } from "../../config.js"
import { z, type ZodTypeAny } from "zod"
import { setSdkCache } from "./capabilities.js"
import { resolve as resolveBinary, getCliJsPath } from "./binaries.js"

// ============================================================================
// JSON Schema to Zod Converter
// ============================================================================

/** Convert a JSON Schema property to a Zod type */
function jsonSchemaPropertyToZod(schema: Record<string, unknown>): ZodTypeAny {
	const type = schema.type as string | undefined

	if (type === "string") {
		let zodType = z.string()
		if (schema.description) {
			zodType = zodType.describe(schema.description as string)
		}
		return zodType
	}
	if (type === "number" || type === "integer") {
		let zodType = z.number()
		if (schema.description) {
			zodType = zodType.describe(schema.description as string)
		}
		return zodType
	}
	if (type === "boolean") {
		let zodType = z.boolean()
		if (schema.description) {
			zodType = zodType.describe(schema.description as string)
		}
		return zodType
	}
	if (type === "array") {
		const items = schema.items as Record<string, unknown> | undefined
		const itemType = items ? jsonSchemaPropertyToZod(items) : z.any()
		return z.array(itemType)
	}
	if (type === "object" && schema.properties) {
		return jsonSchemaToZodObject(schema)
	}
	// Fallback for unknown types
	return z.any()
}

/** Convert a JSON Schema object to a Zod object schema */
function jsonSchemaToZodObject(schema: Record<string, unknown>): z.ZodObject<Record<string, ZodTypeAny>> {
	const properties = schema.properties as Record<string, Record<string, unknown>> | undefined
	const required = (schema.required as string[]) || []

	if (!properties) {
		return z.object({})
	}

	const shape: Record<string, ZodTypeAny> = {}
	for (const [key, propSchema] of Object.entries(properties)) {
		let zodType = jsonSchemaPropertyToZod(propSchema)
		if (!required.includes(key)) {
			zodType = zodType.optional()
		}
		shape[key] = zodType
	}

	return z.object(shape)
}

/** Convert a full JSON Schema (from zodToJsonSchema) to a ZodRawShape for tool() */
function jsonSchemaToZodShape(schema: Record<string, unknown>): Record<string, ZodTypeAny> {
	const properties = schema.properties as Record<string, Record<string, unknown>> | undefined
	const required = (schema.required as string[]) || []

	if (!properties) {
		return {}
	}

	const shape: Record<string, ZodTypeAny> = {}
	for (const [key, propSchema] of Object.entries(properties)) {
		let zodType = jsonSchemaPropertyToZod(propSchema)
		if (!required.includes(key)) {
			zodType = zodType.optional()
		}
		shape[key] = zodType
	}

	return shape
}

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

/** Query options (subset of SDK Options) */
type QueryOptions = Omit<
	Options,
	"abortController" | "mcpServers" | "canUseTool" | "hooks" | "stderr" | "spawnClaudeCodeProcess"
> & {
	clientTools?: SerializedToolDefinition[]
	/** MCP server configurations passed from frontend (keyed by server name) */
	mcpServerConfigs?: Record<string, McpServerConfig>
}

// SDK message type
type SDKMessage = ReturnType<typeof query> extends AsyncIterable<infer T> ? T : never

// ============================================================================
// Unified Event Types
// ============================================================================

// Base event shapes without id (used for emitting)
type ClaudeExecutionEventBase =
	| { type: "sdk_message"; executionId: string; message: SDKMessage }
	| { type: "stderr"; executionId: string; data: string }
	| { type: "complete"; executionId: string }
	| { type: "error"; executionId: string; error: string }
	| { type: "tool_call"; executionId: string; callId: string; toolName: string; args: unknown }
	| { type: "session_started"; executionId: string; sessionId: string }

type ClaudeExecutionEvent = ClaudeExecutionEventBase & { id: string }

type ClaudeCommandEvent =
	| { id: string; type: "start_query"; executionId: string; prompt: string; options: QueryOptions }
	| { id: string; type: "tool_response"; executionId: string; callId: string; result?: ToolResult; error?: string }
	| { id: string; type: "abort"; executionId: string }
	| { id: string; type: "reconnect"; executionId: string }
	| { id: string; type: "clear_buffer"; executionId: string }

type ClaudeStreamEvent =
	| (ClaudeExecutionEvent & { direction: "execution" })
	| (ClaudeCommandEvent & { direction: "command" })

// ============================================================================
// Execution State
// ============================================================================

interface ExecutionState {
	executionId: string
	status: "in_progress" | "completed" | "error" | "aborted"
	sessionId?: string
	cwd?: string
	events: ClaudeStreamEvent[]
	abortController: AbortController
	webContents: WebContents | null
	cleanupTimer: ReturnType<typeof setTimeout> | null
	createdAt: string
	completedAt?: string
}

/** Pending tool call waiting for renderer response */
interface PendingToolCall {
	resolve: (result: ToolResult) => void
	reject: (error: Error) => void
}

// ============================================================================
// Global State
// ============================================================================

// Track active executions with full event buffers
const activeExecutions = new Map<string, ExecutionState>()

// Track pending tool calls waiting for renderer response
const pendingToolCalls = new Map<string, PendingToolCall>()

// Buffer retention time (10 minutes)
const BUFFER_RETENTION_MS = 10 * 60 * 1000

// ============================================================================
// Helper Functions
// ============================================================================

function checkAllowed(e: IpcMainInvokeEvent): boolean {
	const origin = e.sender.getURL()
	console.debug("[ClaudeSdk] checkAllowed called", { origin, isDev })
	try {
		const url = new URL(origin)
		const allowed = isDev
			? url.hostname.endsWith("localhost")
			: url.hostname.endsWith("localhost") || url.protocol === "file:"
		if (!allowed) {
			console.debug("[ClaudeSdk] checkAllowed REJECTED - hostname not allowed", { hostname: url.hostname, isDev })
		}
		return allowed
	} catch (err) {
		console.debug("[ClaudeSdk] checkAllowed REJECTED - URL parse error", { origin, error: String(err) })
		return false
	}
}

/** Reset the cleanup timer for an execution */
function resetCleanupTimer(executionId: string): void {
	const execution = activeExecutions.get(executionId)
	if (!execution) return

	// Clear existing timer
	if (execution.cleanupTimer) {
		clearTimeout(execution.cleanupTimer)
	}

	// Set new timer
	execution.cleanupTimer = setTimeout(() => {
		console.log("[ClaudeSdk] Cleaning up stale execution:", executionId)
		activeExecutions.delete(executionId)
	}, BUFFER_RETENTION_MS)
}

/** Emit an execution event to the buffer and renderer */
function emitExecutionEvent(executionId: string, event: ClaudeExecutionEventBase): void {
	const execution = activeExecutions.get(executionId)
	if (!execution) {
		console.debug("[ClaudeSdk] emitExecutionEvent: no execution found", { executionId, eventType: event.type })
		return
	}

	const fullEvent: ClaudeStreamEvent = {
		...event,
		id: crypto.randomUUID(),
		direction: "execution",
	} as ClaudeStreamEvent

	// Buffer the event
	execution.events.push(fullEvent)

	// Reset cleanup timer on activity
	resetCleanupTimer(executionId)

	// Send to renderer if connected
	if (execution.webContents && !execution.webContents.isDestroyed()) {
		execution.webContents.send("claude:event", fullEvent)
	} else {
		console.debug("[ClaudeSdk] emitExecutionEvent: no webContents to send to", {
			executionId,
			eventType: event.type,
			hasWebContents: !!execution.webContents,
			isDestroyed: execution.webContents?.isDestroyed(),
		})
	}
}

/** Record a command event in the buffer */
function recordCommandEvent(executionId: string, event: Omit<ClaudeCommandEvent, "id">): void {
	const execution = activeExecutions.get(executionId)
	if (!execution) return

	const fullEvent: ClaudeStreamEvent = {
		...event,
		id: crypto.randomUUID(),
		direction: "command",
	} as ClaudeStreamEvent

	execution.events.push(fullEvent)
	resetCleanupTimer(executionId)
}

// ============================================================================
// Streaming
// ============================================================================

async function streamToRenderer(executionId: string, response: ReturnType<typeof query>): Promise<void> {
	const execution = activeExecutions.get(executionId)
	if (!execution) {
		console.debug("[ClaudeSdk] streamToRenderer: no execution found, aborting stream", { executionId })
		return
	}

	console.debug("[ClaudeSdk] streamToRenderer: starting stream loop", { executionId })
	let messageCount = 0

	try {
		for await (const msg of response) {
			messageCount++
			if (messageCount <= 3 || messageCount % 10 === 0) {
				console.debug("[ClaudeSdk] streamToRenderer: message received", { executionId, messageCount, msgType: msg.type })
			}
			// Emit SDK message event
			emitExecutionEvent(executionId, {
				type: "sdk_message",
				executionId,
				message: msg,
			})

			// Check for session ID in system:init message and update SDK capabilities cache
			if (msg.type === "system" && "subtype" in msg && msg.subtype === "init" && "session_id" in msg) {
				const sessionId = msg.session_id as string
				execution.sessionId = sessionId
				emitExecutionEvent(executionId, {
					type: "session_started",
					executionId,
					sessionId,
				})

				// Update SDK capabilities cache from init message
				if (execution.cwd) {
					const initMsg = msg as Record<string, unknown>
					setSdkCache(execution.cwd, {
						slash_commands: (initMsg.slash_commands as string[]) ?? [],
						skills: (initMsg.skills as string[]) ?? [],
						plugins: (initMsg.plugins as { name: string; path: string }[]) ?? [],
						cachedAt: Date.now(),
					})
				}
			}
		}

		// Mark completed
		console.debug("[ClaudeSdk] streamToRenderer: stream completed successfully", { executionId, messageCount })
		execution.status = "completed"
		execution.completedAt = new Date().toISOString()
		emitExecutionEvent(executionId, {
			type: "complete",
			executionId,
		})
	} catch (err: unknown) {
		const errorMessage = err instanceof Error ? err.message : "Unknown error"
		const errorStack = err instanceof Error ? err.stack : undefined
		console.debug("[ClaudeSdk] streamToRenderer: stream ERROR", { executionId, messageCount, errorMessage, errorStack })
		execution.status = "error"
		execution.completedAt = new Date().toISOString()
		emitExecutionEvent(executionId, {
			type: "error",
			executionId,
			error: errorMessage,
		})
	}
}

// ============================================================================
// IPC Handlers
// ============================================================================

export const load = () => {
	console.log("[ClaudeSdk] Registering unified IPC handlers...")

	// Unified command handler
	ipcMain.handle(
		"claude:command",
		async (
			event,
			command: ClaudeCommandEvent
		): Promise<{
			ok: boolean
			found?: boolean
			events?: ClaudeStreamEvent[]
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

	// Keep legacy handlers for backward compatibility during migration
	// These will be removed after migration is complete

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
				prompt: string
				options?: QueryOptions
			}
		) => {
			console.debug("[ClaudeSdk] IPC claude:query received", { executionId: args.executionId, promptLength: args.prompt?.length })
			if (!checkAllowed(event)) {
				console.debug("[ClaudeSdk] IPC claude:query BLOCKED by checkAllowed", { executionId: args.executionId })
				throw new Error("not allowed")
			}
			return handleStartQuery(event, {
				id: crypto.randomUUID(),
				type: "start_query",
				executionId: args.executionId,
				prompt: args.prompt,
				options: args.options ?? {},
			})
		}
	)

	ipcMain.handle("claude:reconnect", async (event, args: { executionId: string }) => {
		if (!checkAllowed(event)) throw new Error("not allowed")
		// Result not used directly; we check execution state for legacy format compatibility
		await handleReconnect(event, {
			id: crypto.randomUUID(),
			type: "reconnect",
			executionId: args.executionId,
		})

		// Legacy format compatibility
		const execution = activeExecutions.get(args.executionId)
		if (!execution) {
			return { ok: false, found: false }
		}

		// Send events via legacy channels for backward compatibility
		for (const evt of execution.events) {
			if (evt.direction === "execution" && evt.type === "sdk_message") {
				event.sender.send(`claude:message:${args.executionId}`, evt.message)
			}
		}

		if (execution.status === "completed") {
			event.sender.send(`claude:complete:${args.executionId}`)
			return { ok: true, found: true, completed: true, messageCount: execution.events.length }
		}

		if (execution.status === "error") {
			const errorEvent = execution.events.find(
				(e) => e.direction === "execution" && e.type === "error"
			) as (ClaudeExecutionEvent & { type: "error" }) | undefined
			event.sender.send(`claude:error:${args.executionId}`, errorEvent?.error ?? "Unknown error")
			return { ok: true, found: true, error: errorEvent?.error, messageCount: execution.events.length }
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
// Command Handlers
// ============================================================================

async function handleStartQuery(
	event: IpcMainInvokeEvent,
	command: ClaudeCommandEvent & { type: "start_query" }
): Promise<{ ok: boolean; error?: string }> {
	const { executionId, prompt, options } = command
	console.debug("[ClaudeSdk] handleStartQuery called", {
		executionId,
		promptLength: prompt.length,
		promptPreview: prompt.slice(0, 100),
		hasClientTools: !!(options.clientTools && options.clientTools.length > 0),
		clientToolCount: options.clientTools?.length ?? 0,
		model: options.model,
		cwd: options.cwd,
		hasMcpServerConfigs: !!options.mcpServerConfigs,
		permissionMode: options.permissionMode,
	})
	const { clientTools, ...sdkOptions } = options

	const abortController = new AbortController()

	// Create execution state
	const execution: ExecutionState = {
		executionId,
		status: "in_progress",
		cwd: sdkOptions.cwd as string | undefined,
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

	// Create MCP server with proxy handlers for client-defined tools
	// Start with frontend-provided MCP servers
	const mcpServers: Record<string, McpServerConfig> = { ...sdkOptions.mcpServerConfigs }
	console.log("[ClaudeSdk] MCP servers from frontend:", Object.keys(sdkOptions.mcpServerConfigs ?? {}))

	if (clientTools && clientTools.length > 0) {
		console.log("[ClaudeSdk] Creating MCP server with", clientTools.length, "client tools")

		const proxyTools = clientTools.map((toolDef) => {
			const zodShape = jsonSchemaToZodShape(toolDef.inputSchema)

			return tool(toolDef.name, toolDef.description, zodShape, async (inputArgs) => {
				const callId = crypto.randomUUID()

				const currentExecution = activeExecutions.get(executionId)
				if (!currentExecution?.webContents || currentExecution.webContents.isDestroyed()) {
					throw new Error("No renderer connected for tool call")
				}

				// Emit tool_call event
				emitExecutionEvent(executionId, {
					type: "tool_call",
					executionId,
					callId,
					toolName: toolDef.name,
					args: inputArgs,
				})

				// Also send via legacy channel for backward compatibility
				currentExecution.webContents.send(`claude:tool-call:${executionId}`, callId, toolDef.name, inputArgs)

				// Wait for response
				return new Promise<ToolResult>((resolve, reject) => {
					pendingToolCalls.set(callId, { resolve, reject })

					const timeout = setTimeout(() => {
						if (pendingToolCalls.has(callId)) {
							pendingToolCalls.delete(callId)
							reject(new Error(`Tool call timed out: ${toolDef.name}`))
						}
					}, 5 * 60 * 1000)

					const originalResolve = resolve
					const originalReject = reject
					pendingToolCalls.set(callId, {
						resolve: (result) => {
							clearTimeout(timeout)
							originalResolve(result)
						},
						reject: (error) => {
							clearTimeout(timeout)
							originalReject(error)
						},
					})
				})
			})
		})

		const clientServer = createSdkMcpServer({
			name: "client-tools",
			version: "1.0.0",
			tools: proxyTools,
		})

		mcpServers["client-tools"] = clientServer
	}

	// Build client tool names for allowedTools
	const clientToolNames = clientTools?.map((t) => `mcp__client-tools__${t.name}`) || []

	// Merge frontend options with runtime necessities (abortController, mcpServers, stderr)
	// Note: mcpServerConfigs is our custom field - extract it before spreading to SDK options
	const { mcpServerConfigs: _extractedMcpConfigs, ...restSdkOptions } = sdkOptions
	// Use managed bun binary if available (resolved via PATH after enhancePath()),
	// otherwise fall back to ELECTRON_RUN_AS_NODE.
	// The managed binary avoids creating a separate dock icon on macOS.
	const hasManagedBun = !!resolveBinary("bun")
	console.log("[ClaudeSdk] Runtime selection:", hasManagedBun ? "bun (managed)" : "node (ELECTRON_RUN_AS_NODE)")
	const executableConfig: Pick<Options, "executable" | "env" | "pathToClaudeCodeExecutable"> = hasManagedBun
		? {
				executable: "bun",
				pathToClaudeCodeExecutable: getCliJsPath(),
				env: {
					...process.env,
					DISABLE_TELEMETRY: "1",
					DISABLE_ERROR_REPORTING: "1",
					...sdkOptions.env,
				},
			}
		: {
				executable: process.execPath as "node",
				env: {
					...process.env,
					ELECTRON_RUN_AS_NODE: "1",
					DISABLE_TELEMETRY: "1",
					DISABLE_ERROR_REPORTING: "1",
					...sdkOptions.env,
				},
			}

	const mergedOptions: Options = {
		...restSdkOptions,
		...executableConfig,
		// Append client tool names to frontend's allowedTools
		allowedTools: [
			...(sdkOptions.allowedTools ?? []),
			...clientToolNames.filter((t) => !(sdkOptions.allowedTools ?? []).includes(t)),
		],
		abortController,
		mcpServers: Object.keys(mcpServers).length > 0 ? mcpServers : undefined,
		// Capture stderr
		stderr: (data: string) => {
			emitExecutionEvent(executionId, {
				type: "stderr",
				executionId,
				data,
			})
		},
	}

	console.debug("[ClaudeSdk] handleStartQuery: calling query()", {
		executionId,
		promptLength: prompt.length,
		model: mergedOptions.model,
		cwd: mergedOptions.cwd,
		hasMcpServers: !!mergedOptions.mcpServers,
		mcpServerNames: mergedOptions.mcpServers ? Object.keys(mergedOptions.mcpServers) : [],
		allowedToolCount: mergedOptions.allowedTools?.length ?? 0,
		disallowedToolCount: mergedOptions.disallowedTools?.length ?? 0,
	})

	let response: ReturnType<typeof query>
	try {
		response = query({
			prompt,
			options: mergedOptions,
		})
		console.debug("[ClaudeSdk] handleStartQuery: query() returned successfully (async iterator created)", { executionId })
	} catch (err) {
		const errorMessage = err instanceof Error ? err.message : "Unknown error"
		const errorStack = err instanceof Error ? err.stack : undefined
		console.debug("[ClaudeSdk] handleStartQuery: query() THREW synchronously", { executionId, errorMessage, errorStack })
		// Clean up execution state
		execution.status = "error"
		execution.completedAt = new Date().toISOString()
		emitExecutionEvent(executionId, { type: "error", executionId, error: errorMessage })
		return { ok: false, error: errorMessage }
	}

	// Start streaming (don't await - runs async)
	console.debug("[ClaudeSdk] handleStartQuery: starting streamToRenderer (fire-and-forget)", { executionId })
	streamToRenderer(executionId, response)

	return { ok: true }
}

function handleToolResponse(
	command: ClaudeCommandEvent & { type: "tool_response" }
): { ok: boolean; error?: string } {
	const { executionId, callId, result, error } = command

	// Record the command
	recordCommandEvent(executionId, command)

	const pending = pendingToolCalls.get(callId)
	if (!pending) {
		console.warn("[ClaudeSdk] Tool response for unknown call:", callId)
		return { ok: false, error: "Unknown call ID" }
	}

	pendingToolCalls.delete(callId)

	if (error) {
		pending.reject(new Error(error))
	} else if (result) {
		pending.resolve(result)
	} else {
		pending.reject(new Error("No result or error in tool response"))
	}

	return { ok: true }
}

function handleAbort(command: ClaudeCommandEvent & { type: "abort" }): { ok: boolean } {
	const { executionId } = command
	console.debug("[ClaudeSdk] handleAbort called", { executionId, hasExecution: activeExecutions.has(executionId) })

	const execution = activeExecutions.get(executionId)
	if (execution) {
		// Record the abort command before cleanup
		recordCommandEvent(executionId, command)

		execution.abortController.abort()
		execution.status = "aborted"
		execution.completedAt = new Date().toISOString()

		// Clear cleanup timer
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
	command: ClaudeCommandEvent & { type: "reconnect" }
): { ok: boolean; found: boolean; events?: ClaudeStreamEvent[] } {
	const { executionId } = command
	console.debug("[ClaudeSdk] handleReconnect called", { executionId, hasExecution: activeExecutions.has(executionId) })

	const execution = activeExecutions.get(executionId)
	if (!execution) {
		console.debug("[ClaudeSdk] handleReconnect: execution not found", { executionId })
		return { ok: false, found: false }
	}

	// Record the reconnect command
	recordCommandEvent(executionId, command)

	// Update webContents reference
	execution.webContents = event.sender

	// Reset cleanup timer
	resetCleanupTimer(executionId)

	// Return all buffered events
	return { ok: true, found: true, events: execution.events }
}

function handleClearBuffer(
	command: ClaudeCommandEvent & { type: "clear_buffer" }
): { ok: boolean } {
	const { executionId } = command

	const execution = activeExecutions.get(executionId)
	if (execution) {
		// Clear cleanup timer
		if (execution.cleanupTimer) {
			clearTimeout(execution.cleanupTimer)
		}

		// Delete the execution
		activeExecutions.delete(executionId)
		console.log("[ClaudeSdk] Buffer cleared for execution:", executionId)
	}

	return { ok: true }
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
