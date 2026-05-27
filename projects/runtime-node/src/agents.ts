import { randomUUID } from "node:crypto"
import {
    ClaudeCodeHarness,
    CodexHarness,
    getModelFullId,
    HarnessRegistry,
    type HarnessEvent,
    type HarnessId,
    type HarnessQuery,
    type HarnessInstallStatus,
    type McpServerConfig,
    type PromptPart,
} from "../../harness/src"
import type {
    AgentGoalClearParams,
    AgentGoalCreateParams,
    AgentGoalGetParams,
    AgentGoalSetParams,
    AgentGoalUpdateParams,
    AgentProviderCapabilities,
    AgentProviderSummary,
    AgentThreadGoalStatus,
    AgentThreadResumeParams,
    AgentThreadStartParams,
    AgentTurnInterruptParams,
    AgentTurnSteerParams,
    AgentTurnStartParams,
    RuntimeRequestId,
    RuntimeValidationResult,
} from "../../runtime-protocol/src"
import { RuntimeHandlerError, type RuntimeServer } from "../../runtime/src"

export type RuntimeNodeAgentStreamEvent = Record<string, unknown> & {
    id: string
    direction?: string
    executionId?: string
    harnessId?: string
    type: string
}

export type RuntimeNodeAgentSettledStatus = "completed" | "failed" | "stopped"

export interface RuntimeNodeAgentStartParams {
    executionId: string
    harnessId: string
    prompt: string | unknown[]
    cwd: string
    mode?: "read-only" | "yolo"
    model?: string
    thinking?: "low" | "med" | "high" | "max"
    fastMode?: boolean
    appendSystemPrompt?: string
    resumeSessionId?: string
    forkSession?: boolean
    processLabel?: string
    additionalDirectories?: string[]
    env?: Record<string, string>
    mcpServerConfigs?: Record<string, McpServerConfig>
}

export interface RuntimeNodeAgentStartCallbacks {
    onEvent?: (event: RuntimeNodeAgentStreamEvent) => void
    onSpawn?: (result: {
        executionId: string
        pid: number
        pgid?: number
        processLabel?: string
        processStartedAt: string
    }) => void
    onSettled?: (result: {
        executionId: string
        status: RuntimeNodeAgentSettledStatus
        sessionId?: string
        error?: string
    }) => void
}

export interface RuntimeNodeAgentExecutor {
    providers(): AgentProviderSummary[]
    status(providerId?: string): Promise<Record<string, HarnessInstallStatus> | HarnessInstallStatus | null>
    models?(providerId?: string): Promise<unknown> | unknown
    listSessions?(params: { providerId?: string; cwd?: string; limit?: number }): Promise<unknown> | unknown
    readSession?(params: { providerId: string; sessionId: string; cwd?: string }): Promise<unknown> | unknown
    activeSession?(params: { providerId: string; sessionId: string }): Promise<unknown> | unknown
    start(params: RuntimeNodeAgentStartParams, callbacks?: RuntimeNodeAgentStartCallbacks): Promise<{ ok: boolean; error?: string }>
    interrupt(executionId: string): Promise<{ ok: boolean; error?: string }> | { ok: boolean; error?: string }
    reconnect?(
        executionId: string,
        callbacks?: Pick<RuntimeNodeAgentStartCallbacks, "onEvent">
    ): Promise<{ ok: boolean; events?: RuntimeNodeAgentStreamEvent[]; status?: RuntimeNodeAgentSettledStatus; error?: string }> | { ok: boolean; events?: RuntimeNodeAgentStreamEvent[]; status?: RuntimeNodeAgentSettledStatus; error?: string }
    respondTool?(params: {
        executionId: string
        callId: string
        result?: unknown
        error?: string
    }): Promise<{ ok: boolean; error?: string }> | { ok: boolean; error?: string }
    clearBuffer?(executionId: string): Promise<{ ok: boolean; error?: string }> | { ok: boolean; error?: string }
    structuredQuery?(params: {
        prompt: string | unknown[]
        options: Record<string, unknown>
        outputSchema: Record<string, unknown>
    }): Promise<unknown> | unknown
    deleteSession?(params: {
        harnessId: string
        sessionId: string
        cwd?: string
    }): Promise<{ ok: boolean; error?: string }> | { ok: boolean; error?: string }
}

export interface RuntimeNodeServerProtocolAgentBridge {
    providerId: string
    label?: string
    capabilities?: Partial<AgentProviderCapabilities>
    connect?(): Promise<void>
    disconnect?(): Promise<void>
    status?(): Promise<unknown> | unknown
    listModels?(params: { providerId: string }): Promise<unknown> | unknown
    listSessions?(params: { providerId: string; cwd?: string; limit?: number }): Promise<unknown> | unknown
    readSession?(params: { providerId: string; sessionId: string; cwd?: string }): Promise<unknown> | unknown
    activeSession?(params: { providerId: string; sessionId: string }): Promise<unknown> | unknown
    startThread(params: AgentThreadStartParams): Promise<unknown>
    resumeThread(params: AgentThreadResumeParams): Promise<unknown>
    startTurn(params: AgentTurnStartParams): Promise<unknown>
    steerTurn?(params: AgentTurnSteerParams): Promise<unknown>
    interruptTurn(params: AgentTurnInterruptParams): Promise<unknown>
    replayTurn?(params: AgentTurnSteerParams): Promise<unknown> | unknown
    setGoal(params: AgentGoalSetParams): Promise<unknown>
    getGoal(params: AgentGoalGetParams): Promise<unknown>
    clearGoal(params: AgentGoalClearParams): Promise<unknown>
    pendingServerRequestList?(): Array<{ requestId: RuntimeRequestId; method: string; params?: unknown }>
    resolveServerRequest?(requestId: RuntimeRequestId, result: unknown): boolean
    rejectServerRequest?(requestId: RuntimeRequestId, error: Error): boolean
}

export interface RuntimeNodeAgentBridgeRegistry {
    bridges: Map<string, RuntimeNodeServerProtocolAgentBridge>
}

export interface RuntimeNodeAgentModuleOptions {
    bridgeRegistry?: RuntimeNodeAgentBridgeRegistry
}

const PROCESS_AGENT_CAPABILITIES: AgentProviderCapabilities = {
    execution: true,
    streaming: true,
    sessions: true,
    steering: false,
    interrupt: true,
    goals: false,
    approvals: true,
    filesystem: true,
    processExec: true,
}

const SERVER_PROTOCOL_AGENT_CAPABILITIES: AgentProviderCapabilities = {
    execution: true,
    streaming: true,
    sessions: true,
    steering: true,
    interrupt: true,
    goals: true,
    approvals: true,
    filesystem: true,
    processExec: true,
}

const defaultServerProtocolBridgeRegistry = createRuntimeNodeAgentBridgeRegistry()

export function createRuntimeNodeAgentBridgeRegistry(): RuntimeNodeAgentBridgeRegistry {
    return { bridges: new Map() }
}

function providerSummary(providerId: HarnessId, label: string): AgentProviderSummary {
    return {
        providerId,
        label,
        kind: "process",
        capabilities: PROCESS_AGENT_CAPABILITIES,
    }
}

function bridgeCapabilities(bridge: RuntimeNodeServerProtocolAgentBridge): AgentProviderCapabilities {
    return {
        ...SERVER_PROTOCOL_AGENT_CAPABILITIES,
        ...bridge.capabilities,
    }
}

function bridgeSummary(bridge: RuntimeNodeServerProtocolAgentBridge): AgentProviderSummary {
    return {
        providerId: bridge.providerId,
        label: bridge.label ?? bridge.providerId,
        kind: "serverProtocol",
        capabilities: bridgeCapabilities(bridge),
    }
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {}
}

function paramsError(path: string, message: string): RuntimeValidationResult<never> {
    return { ok: false, error: { code: "invalid_params", message, path } }
}

function validateRecordParams(params: unknown): RuntimeValidationResult<Record<string, unknown>> {
    if (typeof params !== "object" || params === null || Array.isArray(params)) return paramsError("$", "Runtime params must be an object")
    return { ok: true, value: params as Record<string, unknown> }
}

function validateStringParams(...keys: string[]) {
    return (params: unknown): RuntimeValidationResult<Record<string, unknown>> => {
        const record = validateRecordParams(params)
        if (!record.ok) return record
        for (const key of keys) {
            if (typeof record.value[key] !== "string" || record.value[key].length < 1) return paramsError(`$.${key}`, `${key} must be a non-empty string`)
        }
        return record
    }
}

function validateRequestIdParams(params: unknown): RuntimeValidationResult<Record<string, unknown>> {
    const record = validateRecordParams(params)
    if (!record.ok) return record
    const value = record.value.requestId
    if ((typeof value !== "string" || value.length < 1) && (typeof value !== "number" || !Number.isFinite(value))) {
        return paramsError("$.requestId", "requestId must be a non-empty string or finite number")
    }
    return record
}

function validateThreadGoalIdParams(params: unknown): RuntimeValidationResult<Record<string, unknown>> {
    const record = validateRecordParams(params)
    if (!record.ok) return record
    if (typeof record.value.providerId !== "string" || record.value.providerId.length < 1) return paramsError("$.providerId", "providerId must be a non-empty string")
    const threadId = typeof record.value.threadId === "string" && record.value.threadId.length > 0
    const goalId = typeof record.value.goalId === "string" && record.value.goalId.length > 0
    if (!threadId && !goalId) return paramsError("$.threadId", "threadId or goalId must be a non-empty string")
    return record
}

function validateAgentExecutionStartParams(params: unknown): RuntimeValidationResult<Record<string, unknown>> {
    const record = validateRecordParams(params)
    if (!record.ok) return record
    if (typeof record.value.executionId !== "string" || record.value.executionId.length < 1) return paramsError("$.executionId", "executionId must be a non-empty string")
    if (!("prompt" in record.value)) return paramsError("$.prompt", "prompt is required")
    if (typeof record.value.prompt !== "string" && !Array.isArray(record.value.prompt)) return paramsError("$.prompt", "prompt must be a string or array")
    const options = record.value.options
    if (typeof options !== "object" || options === null || Array.isArray(options)) return paramsError("$.options", "options must be an object")
    const optionRecord = options as Record<string, unknown>
    if (typeof optionRecord.harnessId !== "string" || optionRecord.harnessId.length < 1) return paramsError("$.options.harnessId", "options.harnessId must be a non-empty string")
    if (typeof optionRecord.cwd !== "string" || optionRecord.cwd.length < 1) return paramsError("$.options.cwd", "options.cwd must be a non-empty string")
    return record
}

const providerParams = { validateParams: validateStringParams("providerId") }
const executionIdParams = { validateParams: validateStringParams("executionId") }

function providerId(params: unknown): string {
    return requiredString(params, "providerId")
}

function bridgeFor(registry: RuntimeNodeAgentBridgeRegistry, params: unknown): RuntimeNodeServerProtocolAgentBridge {
    const id = providerId(params)
    const bridge = registry.bridges.get(id)
    if (!bridge) throw new Error(`Agent provider ${id} is not connected in server-protocol mode`)
    return bridge
}

function requireCapability(bridge: RuntimeNodeServerProtocolAgentBridge, capability: keyof AgentProviderCapabilities): void {
    if (!bridgeCapabilities(bridge)[capability]) {
        throw new RuntimeHandlerError("unsupported_capability", `Agent provider ${bridge.providerId} does not support ${capability}`)
    }
}

function requireRequestId(params: unknown): RuntimeRequestId {
    const value = asRecord(params).requestId
    if ((typeof value !== "string" || value.length < 1) && typeof value !== "number") throw new Error("requestId is required")
    return value
}

function approvalResponse(params: unknown): unknown {
    const record = asRecord(params)
    if ("response" in record) return record.response
    if ("result" in record) return record.result
    if (typeof record.decision === "string") return { decision: record.decision }
    throw new Error("response is required")
}

function optionalThreadId(params: unknown): string | undefined {
    const record = asRecord(params)
    const threadId = typeof record.threadId === "string" && record.threadId.length > 0 ? record.threadId : undefined
    const goalId = typeof record.goalId === "string" && record.goalId.length > 0 ? record.goalId : undefined
    return threadId ?? goalId
}

function requireThreadGoalId(params: unknown): string {
    const id = optionalThreadId(params)
    if (!id) throw new Error("threadId or goalId is required")
    return id
}

function normalizeTokenBudget(value: unknown): number | null | undefined {
    if (value === null) return null
    if (typeof value === "number" && Number.isFinite(value)) return value
    return undefined
}

function normalizeGoalStatus(status: unknown): AgentThreadGoalStatus | undefined {
    if (
        status === "active" ||
        status === "paused" ||
        status === "blocked" ||
        status === "usageLimited" ||
        status === "budgetLimited" ||
        status === "complete"
    ) {
        return status
    }
    return undefined
}

function threadGoalSetParams(params: unknown, patch: Partial<AgentGoalSetParams> = {}): AgentGoalSetParams {
    const record = asRecord(params)
    const tokenBudget = "tokenBudget" in record ? normalizeTokenBudget(record.tokenBudget) : undefined
    return {
        providerId: providerId(params),
        threadId: requireThreadGoalId(params),
        objective: typeof record.objective === "string" ? record.objective : undefined,
        status: normalizeGoalStatus(record.status),
        ...(tokenBudget !== undefined ? { tokenBudget } : {}),
        ...patch,
    }
}

function requiredString(params: unknown, key: string): string {
    const value = asRecord(params)[key]
    if (typeof value !== "string" || value.length < 1) throw new Error(`${key} is required`)
    return value
}

function optionalString(value: unknown): string | undefined {
    return typeof value === "string" && value.length > 0 ? value : undefined
}

function optionalPositiveInteger(value: unknown): number | undefined {
    return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined
}

function isHarnessId(value: string): value is HarnessId {
    return value === "claude-code" || value === "codex"
}

function streamEvent(executionId: string, harnessId: HarnessId, event: { type: string } & Record<string, unknown>): RuntimeNodeAgentStreamEvent {
    return {
        id: randomUUID(),
        direction: "execution",
        executionId,
        harnessId,
        ...event,
    }
}

function runtimeIdForExecution(executionId: string): string {
    return `agent:${executionId}`
}

function runtimeSegment(value: string): string {
    return value.replace(/[^A-Za-z0-9_.-]/g, "_")
}

function serverProtocolTurnRuntimeId(providerId: string, threadId: string, turnId: string): string {
    return `agent-turn:${runtimeSegment(providerId)}:${runtimeSegment(threadId)}:${runtimeSegment(turnId)}`
}

function turnIdFromValue(value: unknown): string | undefined {
    const record = asRecord(value)
    if (typeof record.turnId === "string" && record.turnId.length > 0) return record.turnId
    if (typeof record.id === "string" && record.id.length > 0) return record.id
    const turn = asRecord(record.turn)
    if (typeof turn.id === "string" && turn.id.length > 0) return turn.id
    return undefined
}

function threadIdFromValue(value: unknown): string | undefined {
    const record = asRecord(value)
    if (typeof record.threadId === "string" && record.threadId.length > 0) return record.threadId
    const thread = asRecord(record.thread)
    if (typeof thread.id === "string" && thread.id.length > 0) return thread.id
    return undefined
}

function createOrUpdateServerProtocolTurnRuntime(
    server: RuntimeServer,
    args: { providerId: string; threadId: string; turnId: string; status: "running" | RuntimeNodeAgentSettledStatus; error?: string }
): void {
    const runtimeId = serverProtocolTurnRuntimeId(args.providerId, args.threadId, args.turnId)
    const current = server.supervisor.get(runtimeId)
    const terminal = args.status !== "running"
    const runtime =
        current ??
        server.supervisor.create({
            runtimeId,
            kind: "agent",
            status: args.status,
            scope: {
                ownerType: "agent-server-turn",
                ownerId: args.threadId,
                labels: {
                    providerId: args.providerId,
                    threadId: args.threadId,
                    turnId: args.turnId,
                },
            },
            nativeId: args.turnId,
            ...(args.error ? { error: args.error } : {}),
            ...(terminal ? { exitedAt: new Date().toISOString() } : {}),
        })

    const updated = current
        ? server.supervisor.update(runtimeId, {
              status: args.status,
              ...(args.error ? { error: args.error } : {}),
              ...(terminal ? { exitedAt: new Date().toISOString() } : {}),
          })
        : runtime
    if (!updated) return
    if (!current) {
        server.notify("runtime/created", updated)
        return
    }
    server.notify(args.status === "completed" ? "runtime/completed" : args.status === "stopped" ? "runtime/stopped" : args.status === "failed" ? "runtime/failed" : "runtime/updated", updated)
}

function latestServerProtocolTurnRuntime(server: RuntimeServer, providerId: string, threadId: string) {
    return server.supervisor
        .list({ ownerType: "agent-server-turn", ownerId: threadId })
        .filter((runtime) => runtime.scope.labels?.providerId === providerId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
}

export function notifyRuntimeNodeAgentBridgeEvent(server: RuntimeServer, method: string, params: unknown): void {
    const record = asRecord(params)
    const providerId = optionalString(record.providerId)
    const threadId = threadIdFromValue(params)
    const turnId = turnIdFromValue(params)
    if (providerId && threadId && turnId && method === "agent/turn/started") {
        createOrUpdateServerProtocolTurnRuntime(server, { providerId, threadId, turnId, status: "running" })
    } else if (providerId && threadId && (method === "agent/turn/completed" || method === "agent/turn/failed")) {
        const targetTurnId = turnId ?? latestServerProtocolTurnRuntime(server, providerId, threadId)?.nativeId
        if (targetTurnId) {
            createOrUpdateServerProtocolTurnRuntime(server, {
                providerId,
                threadId,
                turnId: targetTurnId,
                status: method === "agent/turn/completed" ? "completed" : "failed",
                error: typeof record.error === "string" ? record.error : undefined,
            })
        }
    }
    server.notify(method, params)
}

export function registerRuntimeNodeServerProtocolAgentBridge(
    bridge: RuntimeNodeServerProtocolAgentBridge,
    registry: RuntimeNodeAgentBridgeRegistry = defaultServerProtocolBridgeRegistry
): () => void {
    registry.bridges.set(bridge.providerId, bridge)
    return () => {
        if (registry.bridges.get(bridge.providerId) === bridge) registry.bridges.delete(bridge.providerId)
    }
}

export function createRuntimeNodeHarnessAgentExecutor(): RuntimeNodeAgentExecutor {
    const registry = new HarnessRegistry()
    const active = new Map<
        string,
        {
            abortController: AbortController
            sessionId?: string
            status: "running" | RuntimeNodeAgentSettledStatus
        }
    >()

    registry.register(new ClaudeCodeHarness())
    registry.register(new CodexHarness())

    function settle(executionId: string, status: RuntimeNodeAgentSettledStatus, callbacks?: RuntimeNodeAgentStartCallbacks, error?: string): void {
        const execution = active.get(executionId)
        if (!execution || execution.status !== "running") return
        execution.status = status
        callbacks?.onSettled?.({ executionId, status, sessionId: execution.sessionId, error })
    }

    return {
        providers() {
            return [providerSummary("claude-code", "Claude Code"), providerSummary("codex", "Codex")]
        },
        async status(providerId) {
            if (providerId) {
                if (!isHarnessId(providerId)) return null
                const harness = registry.get(providerId)
                return harness ? harness.checkInstallStatus() : null
            }
            const statusMap = await registry.checkAllInstallStatus()
            return Object.fromEntries(statusMap.entries())
        },
        models(providerId) {
            if (providerId) {
                if (!isHarnessId(providerId)) return null
                const harness = registry.get(providerId)
                return harness ? { providerId, ...harness.models() } : null
            }
            return registry.getAll().map((harness) => ({ providerId: harness.id, ...harness.models() }))
        },
        async listSessions(params) {
            const limit = params.limit
            if (params.providerId) {
                if (!isHarnessId(params.providerId)) return []
                const harness = registry.get(params.providerId)
                return harness ? harness.listSessions({ cwd: params.cwd, limit }) : []
            }
            const entries = await Promise.all(
                registry.getAll().map(async (harness) => ({
                    providerId: harness.id,
                    sessions: await harness.listSessions({ cwd: params.cwd, limit }),
                }))
            )
            return entries
        },
        async readSession(params) {
            if (!isHarnessId(params.providerId)) return null
            const harness = registry.get(params.providerId)
            return harness ? harness.getSessionEvents(params.sessionId, { cwd: params.cwd }) : null
        },
        async activeSession(params) {
            if (!isHarnessId(params.providerId)) return { active: false }
            const harness = registry.get(params.providerId)
            return { active: harness ? await harness.isSessionActive(params.sessionId) : false }
        },
        async start(params, callbacks) {
            if (!isHarnessId(params.harnessId)) return { ok: false, error: `Unknown harness: ${params.harnessId}` }
            const harnessId = params.harnessId
            const harness = registry.get(harnessId)
            if (!harness) return { ok: false, error: `Unknown harness: ${harnessId}` }

            const abortController = new AbortController()
            active.set(params.executionId, { abortController, status: "running" })

            const query: HarnessQuery = {
                prompt: params.prompt as string | PromptPart[],
                cwd: params.cwd,
                mode: params.mode ?? "yolo",
                model: params.model ? getModelFullId(params.model, harnessId) : undefined,
                thinking: params.thinking,
                fastMode: params.fastMode,
                appendSystemPrompt: params.appendSystemPrompt,
                resumeSessionId: params.resumeSessionId,
                forkSession: params.forkSession,
                processLabel: params.processLabel,
                additionalDirectories: params.additionalDirectories,
                env: params.env,
                mcpServers: params.mcpServerConfigs,
                onSpawn: (pid) => {
                    callbacks?.onSpawn?.({
                        executionId: params.executionId,
                        pid,
                        pgid: process.platform === "win32" ? undefined : pid,
                        processLabel: params.processLabel,
                        processStartedAt: new Date().toISOString(),
                    })
                },
                signal: abortController.signal,
            }

            void (async () => {
                try {
                    for await (const harnessEvent of harness.query(query) as AsyncGenerator<HarnessEvent<unknown>>) {
                        const execution = active.get(params.executionId)
                        if (!execution) return

                        if (harnessEvent.type === "session_started") {
                            execution.sessionId = harnessEvent.sessionId
                            callbacks?.onEvent?.(streamEvent(params.executionId, harnessId, { type: "session_started", sessionId: harnessEvent.sessionId }))
                            continue
                        }

                        if (harnessEvent.type === "message") {
                            callbacks?.onEvent?.(streamEvent(params.executionId, harnessId, { type: "raw_message", message: harnessEvent.message }))
                            continue
                        }

                        if (harnessEvent.type === "stderr") {
                            callbacks?.onEvent?.(streamEvent(params.executionId, harnessId, { type: "stderr", data: harnessEvent.data }))
                            continue
                        }

                        if (harnessEvent.type === "complete") {
                            callbacks?.onEvent?.(streamEvent(params.executionId, harnessId, { type: "complete", usage: harnessEvent.usage }))
                            settle(params.executionId, "completed", callbacks)
                            continue
                        }

                        if (harnessEvent.type === "error") {
                            callbacks?.onEvent?.(
                                streamEvent(params.executionId, harnessId, {
                                    type: "error",
                                    error: harnessEvent.error,
                                    code: harnessEvent.code,
                                })
                            )
                            settle(params.executionId, harnessEvent.code === "aborted" ? "stopped" : "failed", callbacks, harnessEvent.error)
                        }
                    }

                    settle(params.executionId, "completed", callbacks)
                } catch (error) {
                    const stopped = abortController.signal.aborted
                    const message = error instanceof Error ? error.message : "Agent execution failed"
                    callbacks?.onEvent?.(
                        streamEvent(params.executionId, harnessId, {
                            type: "error",
                            error: message,
                            code: stopped ? "aborted" : "unknown",
                        })
                    )
                    settle(params.executionId, stopped ? "stopped" : "failed", callbacks, message)
                }
            })()

            return { ok: true }
        },
        interrupt(executionId) {
            const execution = active.get(executionId)
            if (!execution) return { ok: false, error: "No active agent execution" }
            execution.abortController.abort()
            return { ok: true }
        },
    }
}

export function registerRuntimeNodeAgentModule(
    server: RuntimeServer,
    executor: RuntimeNodeAgentExecutor = createRuntimeNodeHarnessAgentExecutor(),
    options: RuntimeNodeAgentModuleOptions = {}
): void {
    const bridgeRegistry = options.bridgeRegistry ?? defaultServerProtocolBridgeRegistry

    server.registerNotification("agent/event")
    server.registerNotification("agent/thread/started")
    server.registerNotification("agent/thread/resumed")
    server.registerNotification("agent/turn/started")
    server.registerNotification("agent/turn/delta")
    server.registerNotification("agent/turn/completed")
    server.registerNotification("agent/turn/failed")
    server.registerNotification("agent/approval/requested")
    server.registerNotification("agent/goal/updated")
    server.registerNotification("agent/goal/cleared")
    server.registerAgentProviderResolver(() => [...executor.providers(), ...[...bridgeRegistry.bridges.values()].map(bridgeSummary)])

    server.register("agent/provider/list", () => server.capabilities().agentProviders)
    server.register("agent/provider/status", async (params) => {
        const providerId = optionalString(asRecord(params).providerId)
        const bridge = providerId ? bridgeRegistry.bridges.get(providerId) : undefined
        if (bridge) {
            return {
                providerId,
                connected: true,
                state: "available",
                capabilities: bridgeCapabilities(bridge),
                detail: bridge.status ? await bridge.status() : undefined,
            }
        }
        const status = await executor.status(providerId)
        const providerKnown = providerId ? executor.providers().some((provider) => provider.providerId === providerId) : true
        return { providerId: providerId ?? "all", connected: providerKnown && status !== null, state: providerKnown && status ? "available" : "unavailable", status: providerKnown ? status : null }
    })
    server.register("agent/provider/read", (params) => {
        const id = providerId(params)
        return server.capabilities().agentProviders.find((provider) => provider.providerId === id) ?? null
    }, providerParams)
    server.register("agent/model/list", async (params) => {
        const record = asRecord(params)
        const id = optionalString(record.providerId)
        const bridge = id ? bridgeRegistry.bridges.get(id) : undefined
        if (bridge) {
            if (!bridge.listModels) throw new RuntimeHandlerError("unsupported_capability", `Agent provider ${id} does not support model listing`)
            return bridge.listModels({ providerId: bridge.providerId })
        }
        return executor.models?.(id) ?? []
    })
    server.register("agent/serverProtocol/list", () =>
        [...bridgeRegistry.bridges.values()].map((bridge) => ({
            providerId: bridge.providerId,
            label: bridge.label ?? bridge.providerId,
            connected: true,
            capabilities: bridgeCapabilities(bridge),
        }))
    )
    server.register("agent/provider/connect", async (params) => {
        const bridge = bridgeFor(bridgeRegistry, params)
        await bridge.connect?.()
        return { ok: true }
    }, providerParams)
    server.register("agent/provider/disconnect", async (params) => {
        const bridge = bridgeFor(bridgeRegistry, params)
        await bridge.disconnect?.()
        return { ok: true }
    }, providerParams)
    server.register("agent/approval/list", (params) => {
        const bridge = bridgeFor(bridgeRegistry, params)
        requireCapability(bridge, "approvals")
        return bridge.pendingServerRequestList?.() ?? []
    }, providerParams)
    server.register("agent/approval/respond", (params) => {
        const bridge = bridgeFor(bridgeRegistry, params)
        requireCapability(bridge, "approvals")
        if (!bridge.resolveServerRequest) throw new Error(`Agent provider ${providerId(params)} does not support approval responses`)
        const requestId = requireRequestId(params)
        if (!bridge.resolveServerRequest(requestId, approvalResponse(params))) throw new Error(`Approval request ${String(requestId)} is not pending`)
        return { ok: true }
    }, {
        validateParams(params) {
            const provider = validateStringParams("providerId")(params)
            if (!provider.ok) return provider
            return validateRequestIdParams(params)
        },
    })
    server.register("agent/approval/reject", (params) => {
        const bridge = bridgeFor(bridgeRegistry, params)
        requireCapability(bridge, "approvals")
        if (!bridge.rejectServerRequest) throw new Error(`Agent provider ${providerId(params)} does not support approval rejection`)
        const requestId = requireRequestId(params)
        const record = asRecord(params)
        const message = typeof record.message === "string" && record.message.length > 0 ? record.message : "Approval request rejected"
        if (!bridge.rejectServerRequest(requestId, new RuntimeHandlerError("approval_rejected", message))) throw new Error(`Approval request ${String(requestId)} is not pending`)
        return { ok: true }
    }, {
        validateParams(params) {
            const provider = validateStringParams("providerId")(params)
            if (!provider.ok) return provider
            return validateRequestIdParams(params)
        },
    })
    server.register("agent/thread/start", (params) => {
        const bridge = bridgeFor(bridgeRegistry, params)
        requireCapability(bridge, "sessions")
        return bridge.startThread(params as AgentThreadStartParams)
    }, providerParams)
    server.register("agent/thread/resume", (params) => {
        const bridge = bridgeFor(bridgeRegistry, params)
        requireCapability(bridge, "sessions")
        return bridge.resumeThread(params as AgentThreadResumeParams)
    }, { validateParams: validateStringParams("providerId", "threadId") })
    server.register("agent/turn/start", async (params) => {
        const bridge = bridgeFor(bridgeRegistry, params)
        requireCapability(bridge, "execution")
        const record = asRecord(params)
        const currentProviderId = providerId(params)
        const threadId = requiredString(params, "threadId")
        const result = await bridge.startTurn(params as AgentTurnStartParams)
        const turnId = turnIdFromValue(result) ?? optionalString(record.turnId) ?? randomUUID()
        createOrUpdateServerProtocolTurnRuntime(server, { providerId: currentProviderId, threadId, turnId, status: "running" })
        return result
    }, { validateParams: validateStringParams("providerId", "threadId", "input") })
    server.register("agent/turn/steer", (params) => {
        const bridge = bridgeFor(bridgeRegistry, params)
        requireCapability(bridge, "steering")
        if (!bridge.steerTurn) throw new Error(`Agent provider ${providerId(params)} does not support steering`)
        return bridge.steerTurn(params as AgentTurnSteerParams)
    }, { validateParams: validateStringParams("providerId", "threadId", "input") })
    server.register("agent/turn/replay", (params) => {
        const bridge = bridgeFor(bridgeRegistry, params)
        requireCapability(bridge, "streaming")
        if (!bridge.replayTurn) throw new RuntimeHandlerError("unsupported_capability", `Agent provider ${providerId(params)} does not support turn replay`)
        return bridge.replayTurn(params as AgentTurnSteerParams)
    }, { validateParams: validateStringParams("providerId", "threadId", "input") })
    server.register("agent/turn/interrupt", async (params) => {
        const bridge = bridgeFor(bridgeRegistry, params)
        requireCapability(bridge, "interrupt")
        const result = await bridge.interruptTurn(params as AgentTurnInterruptParams)
        const currentProviderId = providerId(params)
        const threadId = requiredString(params, "threadId")
        const turnId = turnIdFromValue(result) ?? latestServerProtocolTurnRuntime(server, currentProviderId, threadId)?.nativeId
        if (turnId) createOrUpdateServerProtocolTurnRuntime(server, { providerId: currentProviderId, threadId, turnId, status: "stopped" })
        return result
    }, { validateParams: validateStringParams("providerId", "threadId") })
    server.register("agent/session/list", (params) => {
        const record = asRecord(params)
        const id = optionalString(record.providerId)
        const bridge = id ? bridgeRegistry.bridges.get(id) : undefined
        const sessionParams = { providerId: id, cwd: optionalString(record.cwd), limit: optionalPositiveInteger(record.limit) }
        if (bridge) {
            if (!bridge.listSessions) throw new RuntimeHandlerError("unsupported_capability", `Agent provider ${id} does not support session listing`)
            return bridge.listSessions({ ...sessionParams, providerId: bridge.providerId })
        }
        return executor.listSessions?.(sessionParams) ?? []
    })
    server.register("agent/session/read", (params) => {
        const record = asRecord(params)
        const id = requiredString(params, "providerId")
        const bridge = bridgeRegistry.bridges.get(id)
        const sessionParams = { providerId: id, sessionId: requiredString(params, "sessionId"), cwd: optionalString(record.cwd) }
        if (bridge) {
            if (!bridge.readSession) throw new RuntimeHandlerError("unsupported_capability", `Agent provider ${id} does not support session reads`)
            return bridge.readSession(sessionParams)
        }
        return executor.readSession?.(sessionParams) ?? null
    }, { validateParams: validateStringParams("providerId", "sessionId") })
    server.register("agent/session/active", (params) => {
        const id = requiredString(params, "providerId")
        const bridge = bridgeRegistry.bridges.get(id)
        const sessionParams = { providerId: id, sessionId: requiredString(params, "sessionId") }
        if (bridge) {
            if (!bridge.activeSession) throw new RuntimeHandlerError("unsupported_capability", `Agent provider ${id} does not support active-session checks`)
            return bridge.activeSession(sessionParams)
        }
        return executor.activeSession?.(sessionParams) ?? { active: false }
    }, { validateParams: validateStringParams("providerId", "sessionId") })
    server.register("agent/goal/set", (params) => {
        const bridge = bridgeFor(bridgeRegistry, params)
        requireCapability(bridge, "goals")
        return bridge.setGoal(params as AgentGoalSetParams)
    }, { validateParams: validateThreadGoalIdParams })
    server.register("agent/goal/get", (params) => {
        const bridge = bridgeFor(bridgeRegistry, params)
        requireCapability(bridge, "goals")
        return bridge.getGoal(params as AgentGoalGetParams)
    }, { validateParams: validateStringParams("providerId", "threadId") })
    server.register("agent/goal/clear", (params) => {
        const bridge = bridgeFor(bridgeRegistry, params)
        requireCapability(bridge, "goals")
        return bridge.clearGoal(params as AgentGoalClearParams)
    }, { validateParams: validateStringParams("providerId", "threadId") })
    server.register("agent/goal/create", (params) => {
        const bridge = bridgeFor(bridgeRegistry, params)
        requireCapability(bridge, "goals")
        const record = asRecord(params)
        const createParams = params as AgentGoalCreateParams
        if (!createParams.threadId) throw new Error("threadId is required for server-protocol goals")
        return bridge.setGoal({
            providerId: bridge.providerId,
            threadId: createParams.threadId,
            objective: createParams.objective,
            tokenBudget: normalizeTokenBudget(record.tokenBudget) ?? undefined,
            status: "active",
        })
    }, { validateParams: validateStringParams("providerId", "threadId", "objective") })
    server.register("agent/goal/read", (params) => {
        const bridge = bridgeFor(bridgeRegistry, params)
        requireCapability(bridge, "goals")
        return bridge.getGoal({
            providerId: bridge.providerId,
            threadId: requireThreadGoalId(params),
        })
    }, { validateParams: validateThreadGoalIdParams })
    server.register("agent/goal/update", (params) => {
        const bridge = bridgeFor(bridgeRegistry, params)
        requireCapability(bridge, "goals")
        return bridge.setGoal(threadGoalSetParams(params as AgentGoalUpdateParams))
    }, { validateParams: validateThreadGoalIdParams })
    server.register("agent/goal/complete", (params) => {
        const bridge = bridgeFor(bridgeRegistry, params)
        requireCapability(bridge, "goals")
        return bridge.setGoal(threadGoalSetParams(params, { status: "complete" }))
    }, { validateParams: validateThreadGoalIdParams })
    server.register("agent/goal/block", (params) => {
        const bridge = bridgeFor(bridgeRegistry, params)
        requireCapability(bridge, "goals")
        return bridge.setGoal(threadGoalSetParams(params, { status: "blocked" }))
    }, { validateParams: validateThreadGoalIdParams })
    server.register("agent/execution/start", async (params, context) => {
        const executionId = requiredString(params, "executionId")
        const record = asRecord(params)
        const options = asRecord(record.options)
        const harnessId = requiredString(options, "harnessId")

        const runtime = server.supervisor.create({
            runtimeId: runtimeIdForExecution(executionId),
            kind: "agent",
            status: "running",
            scope: {
                ownerType: "agent",
                ownerId: executionId,
                rootPath: optionalString(options.cwd),
            },
            nativeId: executionId,
        })
        server.notify("runtime/created", runtime)

        const result = await executor.start(
            {
                executionId,
                harnessId,
                prompt: record.prompt as string | unknown[],
                cwd: requiredString(options, "cwd"),
                mode: options.mode === "read-only" ? "read-only" : "yolo",
                model: optionalString(options.model),
                thinking:
                    options.thinking === "low" || options.thinking === "med" || options.thinking === "high" || options.thinking === "max"
                        ? options.thinking
                        : undefined,
                fastMode: typeof options.fastMode === "boolean" ? options.fastMode : undefined,
                appendSystemPrompt: optionalString(options.appendSystemPrompt),
                resumeSessionId: optionalString(options.resumeSessionId),
                forkSession: typeof options.forkSession === "boolean" ? options.forkSession : undefined,
                processLabel: optionalString(options.processLabel),
                additionalDirectories: Array.isArray(options.additionalDirectories)
                    ? options.additionalDirectories.filter((item): item is string => typeof item === "string")
                    : undefined,
                env: typeof options.env === "object" && options.env !== null && !Array.isArray(options.env) ? (options.env as Record<string, string>) : undefined,
                mcpServerConfigs:
                    typeof options.mcpServerConfigs === "object" && options.mcpServerConfigs !== null && !Array.isArray(options.mcpServerConfigs)
                        ? (options.mcpServerConfigs as Record<string, McpServerConfig>)
                        : undefined,
            },
            {
                onSpawn(info) {
                    const updated = server.supervisor.update(runtime.runtimeId, {
                        pid: info.pid,
                        pgid: info.pgid,
                        processLabel: info.processLabel,
                        processStartedAt: info.processStartedAt,
                    })
                    server.notify("runtime/updated", updated)
                },
                onEvent(event) {
                    server.supervisor.touchByOwner("agent", executionId)
                    context.server.notify("agent/event", event)
                },
                onSettled(settled) {
                    const status = settled.status === "completed" ? "completed" : settled.status === "stopped" ? "stopped" : "failed"
                    const updated = server.supervisor.update(runtimeIdForExecution(executionId), {
                        status,
                        error: settled.error,
                    })
                    server.notify(status === "completed" ? "runtime/completed" : status === "stopped" ? "runtime/stopped" : "runtime/failed", updated)
                },
            }
        )
        if (!result.ok) {
            const failed = server.supervisor.update(runtimeIdForExecution(executionId), {
                status: "failed",
                error: result.error ?? "Agent execution failed",
            })
            server.notify("runtime/failed", failed)
        }
        return result
    }, { validateParams: validateAgentExecutionStartParams })
    server.register("agent/execution/interrupt", (params) => executor.interrupt(requiredString(params, "executionId")), executionIdParams)
    server.registerRuntimeStopHandler(async (runtime) => {
        if (runtime.kind !== "agent" || runtime.scope.ownerType !== "agent") return false
        const executionId = runtime.nativeId ?? runtime.scope.ownerId
        if (!executionId) return false
        const result = await executor.interrupt(executionId)
        if (!result.ok) throw new RuntimeHandlerError("stop_failed", result.error ?? "Failed to stop agent execution", { runtimeId: runtime.runtimeId })
        return true
    })
    if (executor.reconnect) {
        server.register("agent/execution/reconnect", (params, context) =>
            executor.reconnect?.(requiredString(params, "executionId"), {
                onEvent(event) {
                    context.server.notify("agent/event", event)
                },
            }), executionIdParams
        )
    }
    if (executor.respondTool) {
        server.register("agent/tool/respond", (params) => {
            const record = asRecord(params)
            return executor.respondTool?.({
                executionId: requiredString(params, "executionId"),
                callId: requiredString(params, "callId"),
                result: record.result,
                error: optionalString(record.error),
            })
        }, { validateParams: validateStringParams("executionId", "callId") })
    }
    if (executor.clearBuffer) {
        server.register("agent/execution/buffer/clear", (params) => executor.clearBuffer?.(requiredString(params, "executionId")), executionIdParams)
    }
    if (executor.structuredQuery) {
        server.register("agent/query/structured", (params) => {
            const record = asRecord(params)
            const options = asRecord(record.options)
            const outputSchema = asRecord(record.outputSchema)
            return executor.structuredQuery?.({
                prompt: record.prompt as string | unknown[],
                options,
                outputSchema,
            })
        })
    }
    if (executor.deleteSession) {
        server.register("agent/session/delete", (params) => {
            const record = asRecord(params)
            return executor.deleteSession?.({
                harnessId: requiredString(params, "harnessId"),
                sessionId: requiredString(params, "sessionId"),
                cwd: optionalString(record.cwd),
            })
        }, { validateParams: validateStringParams("harnessId", "sessionId") })
    }
}
