import { spawn, type ChildProcess } from "node:child_process"
import http from "node:http"
import https from "node:https"
import WebSocket from "ws"
import type {
    AgentGoalClearParams,
    AgentGoalGetParams,
    AgentGoalSetParams,
    AgentThreadResumeParams,
    AgentThreadStartParams,
    AgentTurnInterruptParams,
    AgentTurnSteerParams,
    AgentTurnStartParams,
    RuntimeRequestId,
} from "../../runtime-protocol/src"
import { RuntimeHandlerError } from "../../runtime/src"
import type { RuntimeNodeServerProtocolAgentBridge } from "./agents"

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

type CodexJsonRpcRequest = {
    id: RuntimeRequestId
    method: string
    params?: unknown
}

type CodexJsonRpcNotification = {
    method: string
    params?: unknown
}

type CodexJsonRpcResponse = {
    id: RuntimeRequestId
    result?: unknown
    error?: {
        code: number
        message: string
        data?: unknown
    }
}

type PendingRequest = {
    method: string
    resolve(value: unknown): void
    reject(error: Error): void
    timeout: ReturnType<typeof setTimeout>
}

type PendingServerRequest = {
    request: CodexJsonRpcRequest
    resolve(value: unknown): void
    reject(error: Error): void
    timeout: ReturnType<typeof setTimeout>
}

export interface RuntimeNodeCodexManagedAppServerProcessOptions {
    command: string
    args: string[]
    cwd?: string
    env?: Record<string, string>
    readyProbeUrl?: string
    readyTimeoutMs?: number
    killOnDisconnect?: boolean
}

export interface RuntimeNodeCodexAppServerBridgeOptions {
    providerId?: string
    label?: string
    websocketUrl: string
    authToken?: string
    clientName?: string
    clientVersion?: string
    experimentalApi?: boolean
    requestTimeoutMs?: number
    serverRequestTimeoutMs?: number
    managedProcess?: RuntimeNodeCodexManagedAppServerProcessOptions
    onNotification?(method: string, params: unknown): void
    onServerRequest?(request: CodexJsonRpcRequest): Promise<unknown> | unknown
}

export type RuntimeNodeCodexAppServerBridgeStatus = {
    state: "connected" | "connecting" | "disconnected"
    websocketUrl: string
    serverVersion?: string
    lastError?: string
    pendingServerRequestCount: number
    managedProcess?: {
        command: string
        pid?: number
        running: boolean
    }
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {}
}

function optionalRecordField(record: Record<string, unknown>, key: string): unknown {
    return record[key] === undefined ? undefined : record[key]
}

function omitUndefined(record: Record<string, unknown>): Record<string, unknown> {
    const output: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(record)) {
        if (value !== undefined) output[key] = value
    }
    return output
}

function textInput(input: string): JsonValue[] {
    return [{ type: "text", text: input }]
}

function normalizeTurnId(params: AgentTurnInterruptParams | AgentTurnSteerParams): string {
    const record = params as unknown as Record<string, unknown>
    const turnId = typeof record.turnId === "string" && record.turnId ? record.turnId : undefined
    const expectedTurnId = typeof record.expectedTurnId === "string" && record.expectedTurnId ? record.expectedTurnId : undefined
    const resolved = turnId ?? expectedTurnId
    if (!resolved) throw new RuntimeHandlerError("missing_turn_id", "Codex server-protocol turn control requires turnId")
    return resolved
}

function authHeaders(authToken?: string): Record<string, string> | undefined {
    return authToken ? { Authorization: `Bearer ${authToken}` } : undefined
}

function redactUrl(rawUrl: string): string {
    try {
        const url = new URL(rawUrl)
        if (url.username) url.username = "redacted"
        if (url.password) url.password = "redacted"
        for (const key of [...url.searchParams.keys()]) {
            if (/token|key|secret|password|auth/i.test(key)) url.searchParams.set(key, "redacted")
        }
        return url.toString()
    } catch {
        return rawUrl.replace(/([?&][^=]*(?:token|key|secret|password|auth)[^=]*=)[^&\s]*/gi, "$1redacted")
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

function readyUrlFromWebsocketUrl(websocketUrl: string): string | undefined {
    try {
        const url = new URL(websocketUrl)
        if (url.protocol === "ws:") url.protocol = "http:"
        else if (url.protocol === "wss:") url.protocol = "https:"
        else return undefined
        url.pathname = "/readyz"
        url.search = ""
        url.hash = ""
        return url.toString()
    } catch {
        return undefined
    }
}

function probeReady(url: string): Promise<boolean> {
    return new Promise((resolve) => {
        const parsed = new URL(url)
        const client = parsed.protocol === "https:" ? https : http
        const request = client.request(parsed, { method: "GET", timeout: 1000 }, (response) => {
            response.resume()
            resolve((response.statusCode ?? 0) >= 200 && (response.statusCode ?? 0) < 300)
        })
        request.once("timeout", () => {
            request.destroy()
            resolve(false)
        })
        request.once("error", () => resolve(false))
        request.end()
    })
}

export class RuntimeNodeCodexAppServerBridge implements RuntimeNodeServerProtocolAgentBridge {
    readonly providerId: string
    readonly label: string
    readonly capabilities = {
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

    private socket: WebSocket | null = null
    private connecting: Promise<void> | null = null
    private nextRequestId = 1
    private readonly pending = new Map<RuntimeRequestId, PendingRequest>()
    private readonly pendingServerRequests = new Map<RuntimeRequestId, PendingServerRequest>()
    private managedProcess: ChildProcess | null = null
    private startingManagedProcess: Promise<void> | null = null
    private serverVersion: string | undefined
    private lastError: string | undefined

    constructor(private readonly options: RuntimeNodeCodexAppServerBridgeOptions) {
        this.providerId = options.providerId ?? "codex-server"
        this.label = options.label ?? "Codex Server Protocol"
    }

    async connect(): Promise<void> {
        await this.ensureConnected()
    }

    async disconnect(): Promise<void> {
        const socket = this.socket
        this.socket = null
        this.connecting = null
        if (socket && socket.readyState === WebSocket.OPEN) socket.close()
        if (this.managedProcess && this.options.managedProcess?.killOnDisconnect !== false) this.managedProcess.kill("SIGTERM")
        this.rejectPending(new Error("Codex app-server bridge disconnected"))
        this.rejectPendingServerRequests(new Error("Codex app-server bridge disconnected"))
    }

    status(): RuntimeNodeCodexAppServerBridgeStatus {
        return {
            state: this.socket?.readyState === WebSocket.OPEN ? "connected" : this.connecting ? "connecting" : "disconnected",
            websocketUrl: redactUrl(this.options.websocketUrl),
            serverVersion: this.serverVersion,
            lastError: this.lastError,
            pendingServerRequestCount: this.pendingServerRequests.size,
            managedProcess: this.options.managedProcess
                ? {
                      command: this.options.managedProcess.command,
                      pid: this.managedProcess?.pid,
                      running: !!this.managedProcess && this.managedProcess.exitCode === null,
                  }
                : undefined,
        }
    }

    pendingServerRequestList(): Array<{ requestId: RuntimeRequestId; method: string; params?: unknown }> {
        return [...this.pendingServerRequests.values()].map(({ request }) => ({
            requestId: request.id,
            method: request.method,
            params: request.params,
        }))
    }

    resolveServerRequest(requestId: RuntimeRequestId, result: unknown): boolean {
        const pending = this.pendingServerRequests.get(requestId)
        if (!pending) return false
        this.pendingServerRequests.delete(requestId)
        clearTimeout(pending.timeout)
        pending.resolve(result)
        return true
    }

    rejectServerRequest(requestId: RuntimeRequestId, error: Error): boolean {
        const pending = this.pendingServerRequests.get(requestId)
        if (!pending) return false
        this.pendingServerRequests.delete(requestId)
        clearTimeout(pending.timeout)
        pending.reject(error)
        return true
    }

    async startThread(params: AgentThreadStartParams): Promise<unknown> {
        return this.request("thread/start", {
            cwd: params.cwd,
            model: params.model,
            approvalPolicy: params.approvalPolicy,
            sandbox: params.sandbox,
            config: params.config,
            baseInstructions: params.baseInstructions,
            developerInstructions: params.developerInstructions,
            ephemeral: params.ephemeral,
        })
    }

    async resumeThread(params: AgentThreadResumeParams): Promise<unknown> {
        return this.request("thread/resume", {
            threadId: params.threadId,
            cwd: params.cwd,
            model: params.model,
            approvalPolicy: params.approvalPolicy,
            sandbox: params.sandbox,
            config: params.config,
            baseInstructions: params.baseInstructions,
            developerInstructions: params.developerInstructions,
        })
    }

    async startTurn(params: AgentTurnStartParams): Promise<unknown> {
        return this.request("turn/start", {
            threadId: params.threadId,
            input: textInput(params.input),
            cwd: params.cwd,
            approvalPolicy: params.approvalPolicy,
            approvalsReviewer: params.approvalsReviewer,
        })
    }

    async steerTurn(params: AgentTurnSteerParams): Promise<unknown> {
        return this.request("turn/steer", {
            threadId: params.threadId,
            expectedTurnId: normalizeTurnId(params),
            input: textInput(params.input),
        })
    }

    async interruptTurn(params: AgentTurnInterruptParams): Promise<unknown> {
        return this.request("turn/interrupt", {
            threadId: params.threadId,
            turnId: normalizeTurnId(params),
        })
    }

    async setGoal(params: AgentGoalSetParams): Promise<unknown> {
        const record = params as unknown as Record<string, unknown>
        return this.request("thread/goal/set", {
            threadId: params.threadId,
            objective: optionalRecordField(record, "objective"),
            status: optionalRecordField(record, "status"),
            tokenBudget: optionalRecordField(record, "tokenBudget"),
        })
    }

    async getGoal(params: AgentGoalGetParams): Promise<unknown> {
        return this.request("thread/goal/get", { threadId: params.threadId })
    }

    async clearGoal(params: AgentGoalClearParams): Promise<unknown> {
        return this.request("thread/goal/clear", { threadId: params.threadId })
    }

    private async ensureConnected(): Promise<void> {
        if (this.socket?.readyState === WebSocket.OPEN) return
        if (this.connecting) return this.connecting
        this.connecting = this.open()
            .catch((error) => {
                this.lastError = error instanceof Error ? error.message : "Failed to connect to Codex app-server"
                throw error
            })
            .finally(() => {
                this.connecting = null
            })
        return this.connecting
    }

    private async open(): Promise<void> {
        await this.ensureManagedProcess()
        await new Promise<void>((resolve, reject) => {
            const socket = new WebSocket(this.options.websocketUrl, {
                headers: authHeaders(this.options.authToken),
                maxPayload: 128 << 20,
            })
            let settled = false
            const fail = (error: Error) => {
                if (settled) return
                settled = true
                this.socket = null
                reject(error)
            }
            const onOpen = async () => {
                if (settled) return
                this.socket = socket
                try {
                    const initialized = await this.initialize()
                    this.serverVersion = asRecord(initialized).userAgent?.toString().split("/")[1]?.split(/\s+/)[0]
                    settled = true
                    resolve()
                } catch (error) {
                    fail(error instanceof Error ? error : new Error("Codex app-server initialize failed"))
                }
            }

            socket.once("open", () => {
                void onOpen()
            })
            socket.once("error", (error) => fail(error instanceof Error ? error : new Error("Codex app-server connection failed")))
            socket.on("message", (data) => this.handleSocketMessage(data.toString()))
            socket.on("close", () => {
                if (!settled) fail(new Error("Codex app-server closed before initialize completed"))
                if (this.socket === socket) this.socket = null
                this.rejectPending(new Error("Codex app-server connection closed"))
                this.rejectPendingServerRequests(new Error("Codex app-server connection closed"))
            })
        })
    }

    private async ensureManagedProcess(): Promise<void> {
        const options = this.options.managedProcess
        if (!options) return
        if (this.managedProcess && this.managedProcess.exitCode === null) return
        if (this.startingManagedProcess) return this.startingManagedProcess
        this.startingManagedProcess = this.startManagedProcess(options).finally(() => {
            this.startingManagedProcess = null
        })
        return this.startingManagedProcess
    }

    private async startManagedProcess(options: RuntimeNodeCodexManagedAppServerProcessOptions): Promise<void> {
        const child = spawn(options.command, options.args, {
            cwd: options.cwd,
            env: { ...process.env, ...options.env },
            stdio: "ignore",
            detached: false,
        })
        this.managedProcess = child
        child.once("exit", (code, signal) => {
            if (this.managedProcess === child) this.managedProcess = null
            if (code !== 0 && signal !== "SIGTERM") this.lastError = `Codex app-server process exited with ${code ?? signal ?? "unknown status"}`
        })
        child.once("error", (error) => {
            if (this.managedProcess === child) this.managedProcess = null
            this.lastError = error.message
        })

        const readyUrl = options.readyProbeUrl ?? readyUrlFromWebsocketUrl(this.options.websocketUrl)
        if (!readyUrl) {
            await sleep(250)
            return
        }

        const startedAt = Date.now()
        const timeoutMs = options.readyTimeoutMs ?? 10_000
        while (Date.now() - startedAt < timeoutMs) {
            if (await probeReady(readyUrl)) return
            if (child.exitCode !== null) break
            await sleep(100)
        }
        child.kill("SIGTERM")
        throw new RuntimeHandlerError("provider_start_failed", "Codex app-server process did not become ready")
    }

    private async initialize(): Promise<unknown> {
        const result = await this.request("initialize", {
            clientInfo: {
                name: this.options.clientName ?? "runtime-node",
                title: this.options.clientName ?? "Runtime Node",
                version: this.options.clientVersion ?? "0.1.0",
            },
            capabilities: {
                experimentalApi: this.options.experimentalApi ?? true,
                requestAttestation: false,
            },
        })
        this.sendNotification("initialized")
        return result
    }

    private request(method: string, params?: unknown): Promise<unknown> {
        return this.ensureConnected().then(
            () =>
                new Promise<unknown>((resolve, reject) => {
                    const id = `${this.providerId}-${this.nextRequestId++}`
                    const timeout = setTimeout(() => {
                        this.pending.delete(id)
                        reject(new RuntimeHandlerError("provider_timeout", `Codex app-server request ${method} timed out`))
                    }, this.options.requestTimeoutMs ?? 30_000)
                    this.pending.set(id, { method, resolve, reject, timeout })
                    this.sendRequest({ id, method, params: params === undefined ? undefined : omitUndefined(asRecord(params)) })
                })
        )
    }

    private sendRequest(request: CodexJsonRpcRequest): void {
        this.send(request)
    }

    private sendNotification(method: string, params?: unknown): void {
        this.send(params === undefined ? { method } : { method, params })
    }

    private send(message: CodexJsonRpcRequest | CodexJsonRpcNotification | CodexJsonRpcResponse): void {
        const socket = this.socket
        if (!socket || socket.readyState !== WebSocket.OPEN) throw new RuntimeHandlerError("provider_disconnected", "Codex app-server is not connected")
        socket.send(JSON.stringify(message))
    }

    private handleSocketMessage(raw: string): void {
        let message: unknown
        try {
            message = JSON.parse(raw)
        } catch (error) {
            this.lastError = error instanceof Error ? error.message : "Codex app-server sent invalid JSON"
            return
        }

        const record = asRecord(message)
        if ("id" in record && ("result" in record || "error" in record)) {
            this.handleResponse(record as CodexJsonRpcResponse)
            return
        }

        if ("id" in record && typeof record.method === "string") {
            void this.handleServerRequest(record as CodexJsonRpcRequest)
            return
        }

        if (typeof record.method === "string") this.handleNotification(record as CodexJsonRpcNotification)
    }

    private handleResponse(response: CodexJsonRpcResponse): void {
        const pending = this.pending.get(response.id)
        if (!pending) return
        this.pending.delete(response.id)
        clearTimeout(pending.timeout)
        if (response.error) pending.reject(new RuntimeHandlerError(`provider_${response.error.code}`, response.error.message, response.error.data))
        else pending.resolve(response.result)
    }

    private async handleServerRequest(request: CodexJsonRpcRequest): Promise<void> {
        try {
            const result = this.options.onServerRequest ? await this.options.onServerRequest(request) : await this.queueServerRequest(request)
            this.send({ id: request.id, result })
        } catch (error) {
            this.send({
                id: request.id,
                error: {
                    code: -32000,
                    message: error instanceof Error ? error.message : `Codex app-server request ${request.method} failed`,
                },
            })
        }
    }

    private queueServerRequest(request: CodexJsonRpcRequest): Promise<unknown> {
        if (this.pendingServerRequests.has(request.id)) throw new RuntimeHandlerError("duplicate_provider_request", `Codex app-server reused request id ${String(request.id)}`)
        return new Promise<unknown>((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pendingServerRequests.delete(request.id)
                reject(new RuntimeHandlerError("provider_request_timeout", `Codex app-server request ${request.method} timed out waiting for the runtime client`))
            }, this.options.serverRequestTimeoutMs ?? 30 * 60 * 1000)
            this.pendingServerRequests.set(request.id, { request, resolve, reject, timeout })
            this.options.onNotification?.("agent/approval/requested", {
                providerId: this.providerId,
                requestId: request.id,
                method: request.method,
                params: request.params,
            })
        })
    }

    private handleNotification(notification: CodexJsonRpcNotification): void {
        const params = notification.params
        switch (notification.method) {
            case "thread/goal/updated":
                this.options.onNotification?.("agent/goal/updated", { providerId: this.providerId, ...asRecord(params) })
                break
            case "thread/goal/cleared":
                this.options.onNotification?.("agent/goal/cleared", { providerId: this.providerId, ...asRecord(params) })
                break
            case "turn/started":
                this.options.onNotification?.("agent/turn/started", { providerId: this.providerId, ...asRecord(params) })
                break
            case "turn/completed":
                this.options.onNotification?.("agent/turn/completed", { providerId: this.providerId, ...asRecord(params) })
                break
            case "error":
                this.options.onNotification?.("agent/turn/failed", { providerId: this.providerId, ...asRecord(params) })
                break
            case "item/agentMessage/delta":
            case "item/plan/delta":
            case "item/reasoningSummaryText/delta":
            case "item/reasoningText/delta":
            case "item/completed":
            case "turn/diff/updated":
            case "turn/plan/updated":
                this.options.onNotification?.("agent/turn/delta", { providerId: this.providerId, method: notification.method, params })
                break
            default:
                this.options.onNotification?.("agent/event", { providerId: this.providerId, method: notification.method, params })
        }
    }

    private rejectPending(error: Error): void {
        for (const [id, pending] of this.pending) {
            this.pending.delete(id)
            clearTimeout(pending.timeout)
            pending.reject(error)
        }
    }

    private rejectPendingServerRequests(error: Error): void {
        for (const [id, pending] of this.pendingServerRequests) {
            this.pendingServerRequests.delete(id)
            clearTimeout(pending.timeout)
            pending.reject(error)
        }
    }
}

export function createRuntimeNodeCodexAppServerBridge(options: RuntimeNodeCodexAppServerBridgeOptions): RuntimeNodeCodexAppServerBridge {
    return new RuntimeNodeCodexAppServerBridge(options)
}
