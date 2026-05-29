import {
    type AgentProviderSummary,
    type RuntimeCapabilities,
    type RuntimeInitializeResult,
    type RuntimeListParams,
    type RuntimeMessage,
    type RuntimeNotification,
    type RuntimeRecord,
    type RuntimeRequest,
    type RuntimeResponse,
    type RuntimeStopParams,
    type RuntimeValidationResult,
    runtimeError,
    validateAgentProviderIdParams,
    validateRuntimeIdParams,
    validateRuntimeInitializeParams,
    validateRuntimeListParams,
    validateRuntimeRequest,
    validateRuntimeStopParams,
    validateRuntimeSubscriptionUpdateParams,
    type AgentProviderIdParams,
    type RuntimeIdParams,
    type RuntimeInitializeParams,
    type RuntimeSubscriptionUpdateParams,
} from "../../runtime-protocol/src"
import { RuntimeSupervisor, type RuntimeCheckpointStore, type RuntimeLivenessProbe } from "./supervisor"

export interface RuntimeConnection {
    id: string
    permissions?: string[]
    notificationPermissions?: string[]
    metadata?: Record<string, unknown>
    send(message: RuntimeMessage): void
    close?(): void
}

export interface RuntimeHandlerContext {
    connection: RuntimeConnection
    server: RuntimeServer
}

export type RuntimeHandler = (params: unknown, context: RuntimeHandlerContext) => Promise<unknown> | unknown

export type RuntimeStopHandler = (runtime: RuntimeRecord, params: RuntimeStopParams, context: RuntimeHandlerContext) => Promise<boolean> | boolean

export class RuntimeHandlerError extends Error {
    constructor(
        readonly code: string,
        message: string,
        readonly data?: unknown
    ) {
        super(message)
        this.name = "RuntimeHandlerError"
    }
}

export interface RuntimeModule {
    name: string
    register(server: RuntimeServer): void
}

export type RuntimeParamsValidator = (params: unknown) => RuntimeValidationResult<unknown>

export interface RuntimeRegisterOptions {
    validateParams?: RuntimeParamsValidator
}

export interface RuntimeServerOptions {
    serverName: string
    serverVersion?: string
    protocolVersion?: number
    agentProviders?: AgentProviderSummary[]
    checkpointStore?: RuntimeCheckpointStore
    livenessProbe?: RuntimeLivenessProbe
    notificationLogSize?: number
    clientRequestRetentionMs?: number
}

interface ConnectedRuntimeConnection {
    connection: RuntimeConnection
    subscriptions: Set<string>
}

interface RegisteredRuntimeHandler {
    handler: RuntimeHandler
    validateParams?: RuntimeParamsValidator
}

const DEFAULT_NOTIFICATION_LOG_SIZE = 1000
const DEFAULT_CLIENT_REQUEST_RETENTION_MS = 2 * 60 * 1000
const IDEMPOTENT_METHOD_SEGMENTS = new Set([
    "append",
    "block",
    "cancelOAuth",
    "clear",
    "commit",
    "complete",
    "connect",
    "copy",
    "create",
    "delete",
    "disconnect",
    "edit",
    "error",
    "getOrCreate",
    "init",
    "initiateOAuth",
    "interrupt",
    "kill",
    "killAll",
    "reconcile",
    "reconcileRuntime",
    "refreshOAuth",
    "reject",
    "remove",
    "resize",
    "respond",
    "save",
    "set",
    "setup",
    "start",
    "stop",
    "stopped",
    "update",
    "write",
])

function isTerminalRuntimeStatus(status: string | undefined): boolean {
    return status === "completed" || status === "failed" || status === "stopped"
}

function isActiveRuntimeStatus(status: string | undefined): boolean {
    return status === "starting" || status === "running" || status === "orphaned"
}

interface RetainedRuntimeRequest {
    promise: Promise<RuntimeResponse>
    cleanupTimer: ReturnType<typeof setTimeout> | null
}

export class RuntimeServer {
    private readonly handlers = new Map<string, RegisteredRuntimeHandler>()
    private readonly connections = new Map<string, ConnectedRuntimeConnection>()
    private readonly notifications = new Set<string>()
    private readonly runtimeStopHandlers: RuntimeStopHandler[] = []
    private readonly agentProviders: AgentProviderSummary[]
    private readonly agentProviderResolvers = new Set<() => AgentProviderSummary[]>()
    private readonly protocolVersion: number
    private readonly serverName: string
    private readonly serverVersion?: string
    private readonly notificationLogSize: number
    private readonly clientRequestRetentionMs: number
    private readonly notificationLog: RuntimeNotification[] = []
    private readonly initializedConnections = new Set<string>()
    private readonly clientRequests = new Map<string, RetainedRuntimeRequest>()
    private nextNotificationCursor = 1
    readonly supervisor: RuntimeSupervisor

    constructor(options: RuntimeServerOptions) {
        this.serverName = options.serverName
        this.serverVersion = options.serverVersion
        this.protocolVersion = options.protocolVersion ?? 1
        this.notificationLogSize = Math.max(0, Math.floor(options.notificationLogSize ?? DEFAULT_NOTIFICATION_LOG_SIZE))
        this.clientRequestRetentionMs = Math.max(0, Math.floor(options.clientRequestRetentionMs ?? DEFAULT_CLIENT_REQUEST_RETENTION_MS))
        this.agentProviders = options.agentProviders ?? []
        this.supervisor = new RuntimeSupervisor({ checkpointStore: options.checkpointStore, livenessProbe: options.livenessProbe })

        this.register("initialize", (params, context) => this.initialize(params as RuntimeInitializeParams, context), {
            validateParams: validateRuntimeInitializeParams,
        })
        this.register("server/status/read", (_params, context) => this.serverStatus(context))
        this.register("subscription/update", (params, context) => this.updateSubscription(params as RuntimeSubscriptionUpdateParams, context), {
            validateParams: validateRuntimeSubscriptionUpdateParams,
        })
        this.register("agent/provider/list", () => this.agentProviders)
        this.register("agent/provider/status", (params) => this.agentProviderStatus(params as AgentProviderIdParams), {
            validateParams: validateAgentProviderIdParams,
        })
        this.register("runtime/list", (params) => this.listRuntimes(params as RuntimeListParams), {
            validateParams: validateRuntimeListParams,
        })
        this.register("runtime/read", (params) => this.readRuntime(params as RuntimeIdParams), {
            validateParams: validateRuntimeIdParams,
        })
        this.register("runtime/reconcile", (params) => this.reconcileRuntime(params as RuntimeIdParams), {
            validateParams: validateRuntimeIdParams,
        })
        this.register("runtime/stop", (params, context) => this.stopRuntime(params as RuntimeStopParams, context), {
            validateParams: validateRuntimeStopParams,
        })
        this.registerNotification("runtime/created")
        this.registerNotification("runtime/updated")
        this.registerNotification("runtime/completed")
        this.registerNotification("runtime/failed")
        this.registerNotification("runtime/stopped")
        this.registerNotification("connection/lagged")
    }

    register(method: string, handler: RuntimeHandler, options: RuntimeRegisterOptions = {}): void {
        this.handlers.set(method, { handler, validateParams: options.validateParams })
    }

    registerNotification(method: string): void {
        this.notifications.add(method)
    }

    registerRuntimeStopHandler(handler: RuntimeStopHandler): () => void {
        this.runtimeStopHandlers.push(handler)
        return () => {
            const index = this.runtimeStopHandlers.indexOf(handler)
            if (index >= 0) this.runtimeStopHandlers.splice(index, 1)
        }
    }

    registerAgentProviderResolver(resolver: () => AgentProviderSummary[]): () => void {
        this.agentProviderResolvers.add(resolver)
        return () => {
            this.agentProviderResolvers.delete(resolver)
        }
    }

    registerModule(module: RuntimeModule): void {
        module.register(this)
    }

    connect(connection: RuntimeConnection): () => void {
        this.connections.set(connection.id, { connection, subscriptions: new Set(["*"]) })
        return () => {
            this.connections.delete(connection.id)
            this.initializedConnections.delete(connection.id)
        }
    }

    async handleMessage(connection: RuntimeConnection, raw: string): Promise<void> {
        let message: unknown
        try {
            message = JSON.parse(raw)
        } catch (error) {
            connection.send({
                id: "parse-error",
                error: runtimeError("parse_error", error instanceof Error ? error.message : "Invalid JSON"),
            })
            return
        }

        const request = validateRuntimeRequest(message)
        if (!request.ok) {
            const id = typeof (message as { id?: unknown })?.id === "string" || typeof (message as { id?: unknown })?.id === "number" ? (message as { id: string | number }).id : "invalid-message"
            connection.send({
                id,
                error: runtimeError(request.error.code, request.error.message, { path: request.error.path }),
            })
            return
        }

        const response = await this.handleRequest(request.value, connection, { requireInitialized: true })
        connection.send(response)
    }

    async handleRequest(request: RuntimeRequest, connection: RuntimeConnection, options: { requireInitialized?: boolean } = {}): Promise<RuntimeResponse> {
        if (options.requireInitialized && request.method !== "initialize" && !this.initializedConnections.has(connection.id)) {
            return {
                id: request.id,
                error: runtimeError("not_initialized", "Call initialize before invoking runtime methods"),
            }
        }

        const entry = this.handlers.get(request.method)
        if (!entry) {
            return {
                id: request.id,
                error: runtimeError("method_not_found", `Unknown runtime method ${request.method}`),
            }
        }
        if (!this.canInvoke(request.method, connection)) {
            return {
                id: request.id,
                error: runtimeError("permission_denied", `Not allowed to call runtime method ${request.method}`),
            }
        }

        const clientKey = this.clientRequestKey(request, connection)
        if (clientKey) {
            const retained = this.clientRequests.get(clientKey)
            if (retained) return retained.promise.then((response) => this.responseWithId(response, request.id))

            const requestPromise = this.invokeHandler(request, connection, entry).then((response) => {
                if ("error" in response) {
                    this.clientRequests.delete(clientKey)
                    return response
                }
                const retainedEntry = this.clientRequests.get(clientKey)
                if (retainedEntry?.promise === requestPromise && this.clientRequestRetentionMs > 0) {
                    retainedEntry.cleanupTimer = setTimeout(() => {
                        if (this.clientRequests.get(clientKey)?.promise === requestPromise) this.clientRequests.delete(clientKey)
                    }, this.clientRequestRetentionMs)
                } else if (this.clientRequestRetentionMs === 0) {
                    this.clientRequests.delete(clientKey)
                }
                return response
            })
            this.clientRequests.set(clientKey, { promise: requestPromise, cleanupTimer: null })
            return requestPromise
        }

        return this.invokeHandler(request, connection, entry)
    }

    private responseWithId(response: RuntimeResponse, id: RuntimeRequest["id"]): RuntimeResponse {
        return "error" in response ? { id, error: response.error } : { id, result: response.result }
    }

    private async invokeHandler(request: RuntimeRequest, connection: RuntimeConnection, entry: RegisteredRuntimeHandler): Promise<RuntimeResponse> {
        try {
            let params = request.params
            if (entry.validateParams) {
                const validation = entry.validateParams(params)
                if (!validation.ok) {
                    return {
                        id: request.id,
                        error: runtimeError(validation.error.code, validation.error.message, { path: validation.error.path }),
                    }
                }
                params = validation.value
            }
            const result = await entry.handler(params, { connection, server: this })
            if (request.method === "initialize") this.initializedConnections.add(connection.id)
            return { id: request.id, result: result === undefined ? null : result }
        } catch (error) {
            if (error instanceof RuntimeHandlerError) {
                return {
                    id: request.id,
                    error: runtimeError(error.code, error.message, error.data),
                }
            }
            return {
                id: request.id,
                error: runtimeError("handler_error", error instanceof Error ? error.message : "Runtime handler failed"),
            }
        }
    }

    private clientRequestKey(request: RuntimeRequest, connection: RuntimeConnection): string | undefined {
        if (!this.isRetainableMethod(request.method)) return undefined
        const clientRequestId = this.clientRequestId(request.params)
        if (!clientRequestId) return undefined
        const principal = this.clientRequestPrincipal(connection)
        return `${principal}:${request.method}:${clientRequestId}`
    }

    private clientRequestPrincipal(connection: RuntimeConnection): string {
        const explicit = connection.metadata?.clientRequestPrincipal
        if (typeof explicit === "string" && explicit.length > 0) return explicit
        const deviceId = connection.metadata?.deviceId
        if (typeof deviceId === "string" && deviceId.length > 0) return `device:${deviceId}`
        return `connection:${connection.id}`
    }

    private clientRequestId(params: unknown): string | undefined {
        if (typeof params !== "object" || params === null) return undefined
        const clientRequestId = (params as Record<string, unknown>).clientRequestId
        return typeof clientRequestId === "string" && clientRequestId.length > 0 ? clientRequestId : undefined
    }

    private isRetainableMethod(method: string): boolean {
        const segment = method.split("/").at(-1) ?? method
        return IDEMPOTENT_METHOD_SEGMENTS.has(segment)
    }

    notify(method: string, params?: unknown): void {
        const notification = this.recordNotification(method, params)
        for (const entry of this.connections.values()) {
            if (this.matchesSubscription(notification, entry)) {
                entry.connection.send(notification)
            }
        }
    }

    private recordNotification(method: string, params?: unknown): RuntimeNotification {
        const notification: RuntimeNotification = params === undefined ? { method } : { method, params }
        notification.cursor = String(this.nextNotificationCursor++)
        if (this.notificationLogSize > 0) {
            this.notificationLog.push(notification)
            while (this.notificationLog.length > this.notificationLogSize) this.notificationLog.shift()
        }
        return notification
    }

    private matchesPattern(method: string, pattern: string): boolean {
        if (pattern === "*" || pattern === method) return true
        if (pattern.endsWith("/*")) return method.startsWith(pattern.slice(0, -1))
        return false
    }

    private canReceiveNotification(method: string, connection: RuntimeConnection): boolean {
        if (!connection.notificationPermissions || connection.notificationPermissions.length === 0) return true
        return connection.notificationPermissions.some((permission) => this.matchesPattern(method, permission))
    }

    private matchesSubscription(notification: RuntimeNotification, entry: ConnectedRuntimeConnection): boolean {
        return this.canReceiveNotification(notification.method, entry.connection) && (entry.subscriptions.has("*") || entry.subscriptions.has(notification.method))
    }

    private replayNotifications(entry: ConnectedRuntimeConnection, cursor: string | number): void {
        const requested = Number(cursor)
        if (!Number.isFinite(requested)) return

        const oldest = this.notificationLog[0]?.cursor ? Number(this.notificationLog[0].cursor) : null
        if (oldest !== null && requested < oldest - 1) {
            const notification: RuntimeNotification = {
                method: "connection/lagged",
                params: {
                    requestedCursor: String(cursor),
                    oldestCursor: String(oldest),
                },
            }
            if (this.canReceiveNotification(notification.method, entry.connection)) entry.connection.send(notification)
        }

        for (const notification of this.notificationLog) {
            const notificationCursor = Number(notification.cursor)
            if (!Number.isFinite(notificationCursor) || notificationCursor <= requested) continue
            if (this.matchesSubscription(notification, entry)) entry.connection.send(notification)
        }
    }

    capabilities(): RuntimeCapabilities {
        return {
            methods: [...this.handlers.keys()].sort(),
            notifications: [...this.notifications].sort(),
            agentProviders: this.resolvedAgentProviders(),
        }
    }

    private capabilitiesFor(connection: RuntimeConnection): RuntimeCapabilities {
        const canReadProviders = this.canInvoke("agent/provider/list", connection) || this.canInvoke("agent/provider/status", connection)
        return {
            methods: [...this.handlers.keys()].filter((method) => this.canInvoke(method, connection)).sort(),
            notifications: [...this.notifications].filter((method) => this.canReceiveNotification(method, connection)).sort(),
            agentProviders: canReadProviders ? this.resolvedAgentProviders() : [],
        }
    }

    private resolvedAgentProviders(): AgentProviderSummary[] {
        const providers = new Map<string, AgentProviderSummary>()
        for (const provider of this.agentProviders) providers.set(provider.providerId, provider)
        for (const resolve of this.agentProviderResolvers) {
            for (const provider of resolve()) providers.set(provider.providerId, provider)
        }
        return [...providers.values()].sort((a, b) => a.providerId.localeCompare(b.providerId))
    }

    private initialize(params: RuntimeInitializeParams, context: RuntimeHandlerContext): RuntimeInitializeResult {
        const requestedProtocolVersion = params.protocolVersion
        if (typeof requestedProtocolVersion === "number" && requestedProtocolVersion !== this.protocolVersion) {
            throw new RuntimeHandlerError(
                "unsupported_protocol_version",
                `Desktop update required: client protocol ${requestedProtocolVersion} is not compatible with runtime protocol ${this.protocolVersion}.`,
                {
                    clientProtocolVersion: requestedProtocolVersion,
                    serverProtocolVersion: this.protocolVersion,
                }
            )
        }
        return {
            protocolVersion: this.protocolVersion,
            serverName: this.serverName,
            ...(this.serverVersion ? { serverVersion: this.serverVersion } : {}),
            capabilities: this.capabilitiesFor(context.connection),
        }
    }

    private serverStatus(context: RuntimeHandlerContext): RuntimeInitializeResult & { connectionCount: number } {
        return {
            protocolVersion: this.protocolVersion,
            serverName: this.serverName,
            ...(this.serverVersion ? { serverVersion: this.serverVersion } : {}),
            capabilities: this.capabilitiesFor(context.connection),
            connectionCount: this.connections.size,
        }
    }

    private canInvoke(method: string, connection: RuntimeConnection): boolean {
        if (!connection.permissions || connection.permissions.length === 0) return true
        return connection.permissions.some((permission) => this.matchesPattern(method, permission))
    }

    private updateSubscription(params: RuntimeSubscriptionUpdateParams, context: RuntimeHandlerContext): { ok: true } {
        const entry = this.connections.get(context.connection.id)
        if (!entry) return { ok: true }

        const methods = params.methods ?? ["*"]
        entry.subscriptions = new Set(methods.length > 0 ? methods : ["*"])
        const cursor = params.cursor
        if (cursor !== undefined) this.replayNotifications(entry, cursor)
        return { ok: true }
    }

    private agentProviderStatus(params: AgentProviderIdParams): { providerId: string; connected: boolean; state: string } {
        const providerId = params.providerId
        return {
            providerId,
            connected: this.resolvedAgentProviders().some((provider) => provider.providerId === providerId),
            state: this.resolvedAgentProviders().some((provider) => provider.providerId === providerId) ? "available" : "unavailable",
        }
    }

    private listRuntimes(params: RuntimeListParams): RuntimeRecord[] {
        return this.supervisor.list({
            ownerType: params.ownerType,
            ownerId: params.ownerId,
        })
    }

    private readRuntime(params: RuntimeIdParams): RuntimeRecord | null {
        return this.supervisor.get(params.runtimeId) ?? null
    }

    private reconcileRuntime(params: RuntimeIdParams): unknown {
        return this.supervisor.reconcileRuntime(params.runtimeId)
    }

    private async stopRuntime(params: RuntimeStopParams, context: RuntimeHandlerContext): Promise<RuntimeRecord | null> {
        const current = this.supervisor.get(params.runtimeId)
        if (!current) return null

        for (const handler of this.runtimeStopHandlers) {
            if (await handler(current, params, context)) break
        }

        const afterHandler = this.supervisor.get(params.runtimeId)
        if (isTerminalRuntimeStatus(afterHandler?.status)) {
            if (afterHandler?.status === "stopped" || !isActiveRuntimeStatus(current.status)) return afterHandler ?? null
        }

        const stopped = this.supervisor.stop(params.runtimeId, params.reason) ?? null
        if (stopped) this.notify("runtime/stopped", stopped)
        return stopped
    }
}
