import {
    type RuntimeCapabilities,
    type RuntimeInitializeResult,
    type RuntimeMessage,
    type RuntimeNotification,
    type RuntimeRequest,
    type RuntimeRequestId,
    isRuntimeNotification,
    validateRuntimeResponse,
} from "../../runtime-protocol/src"

export type RuntimeClientStatus = "connecting" | "connected" | "reconnecting" | "disconnected"

export class RuntimeClientError extends Error {
    constructor(
        readonly code: string,
        message: string,
        readonly data?: unknown
    ) {
        super(message)
        this.name = "RuntimeClientError"
    }
}

export interface RuntimeClientOptions {
    url: string
    token: string
    clientName?: string
    clientVersion?: string
    clientPlatform?: "desktop" | "mobile" | "web" | "cli" | "unknown"
    protocolVersion?: number
    onStatus?: (status: RuntimeClientStatus) => void
    reconnect?: boolean
}

export interface RuntimeRequestOptions {
    requestId?: RuntimeRequestId
}

type NotificationListener = (notification: RuntimeNotification) => void

export interface RuntimeLocalTransport {
    connect(): Promise<unknown> | unknown
    disconnect(): Promise<unknown> | unknown
    request(request: RuntimeRequest): Promise<unknown> | unknown
    onMessage(listener: (message: RuntimeMessage) => void): () => void
}

export interface RuntimeLocalClientOptions {
    clientName?: string
    clientVersion?: string
    clientPlatform?: "desktop" | "mobile" | "web" | "cli" | "unknown"
    protocolVersion?: number
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => globalThis.setTimeout(resolve, ms))
}

export class RuntimeClient {
    private socket: WebSocket | null = null
    private nextId = 1
    private retryMs = 1000
    private stopped = false
    private connecting: Promise<void> | null = null
    private lastStatus: RuntimeClientStatus | null = null
    private lastCursor: string | null = null
    private initializeResult: RuntimeInitializeResult | null = null
    private readonly pending = new Map<RuntimeRequestId, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
    private readonly listeners = new Set<NotificationListener>()

    constructor(private readonly options: RuntimeClientOptions) {}

    get capabilities(): RuntimeCapabilities | null {
        return this.initializeResult?.capabilities ?? null
    }

    hasMethod(method: string): boolean {
        return this.capabilities?.methods.includes(method) === true
    }

    async request<T>(method: string, params?: unknown): Promise<T> {
        return this.requestWithOptions<T>(method, params)
    }

    async requestWithOptions<T>(method: string, params?: unknown, options: RuntimeRequestOptions = {}): Promise<T> {
        await this.connect()

        const socket = this.socket
        if (!socket || socket.readyState !== WebSocket.OPEN) throw new Error("Runtime socket is not connected")

        return this.sendRequest<T>(socket, method, params, options)
    }

    private sendRequest<T>(socket: WebSocket, method: string, params?: unknown, options: RuntimeRequestOptions = {}): Promise<T> {
        const id = options.requestId ?? this.nextId++
        const message = params === undefined ? { id, method } : { id, method, params }

        return new Promise<T>((resolve, reject) => {
            this.pending.set(id, {
                resolve: (value) => resolve(value as T),
                reject,
            })
            try {
                socket.send(JSON.stringify(message))
            } catch (error) {
                this.pending.delete(id)
                reject(error instanceof Error ? error : new Error("Runtime socket send failed"))
            }
        })
    }

    subscribe(listener: NotificationListener): () => void {
        this.listeners.add(listener)
        this.connectQuietly()
        return () => {
            this.listeners.delete(listener)
        }
    }

    close(): void {
        this.stopped = true
        this.socket?.close()
        this.socket = null
        this.initializeResult = null
        for (const pending of this.pending.values()) {
            pending.reject(new Error("Runtime socket closed"))
        }
        this.pending.clear()
        this.emitStatus("disconnected")
    }

    async connect(): Promise<void> {
        if (this.socket?.readyState === WebSocket.OPEN) return
        if (this.connecting) return this.connecting

        this.stopped = false
        this.connecting = this.openLoop()
        try {
            await this.connecting
        } finally {
            this.connecting = null
        }
    }

    private connectQuietly(): void {
        void this.connect().catch(() => undefined)
    }

    private async openLoop(): Promise<void> {
        while (!this.stopped) {
            this.emitStatus(this.lastStatus === "disconnected" || this.lastStatus === "reconnecting" || this.retryMs > 1000 ? "reconnecting" : "connecting")
            try {
                await this.openOnce()
                this.retryMs = 1000
                return
            } catch (error) {
                if (!this.options.reconnect || (error instanceof RuntimeClientError && error.code === "unsupported_protocol_version")) throw error
                this.emitStatus("reconnecting")
                await delay(this.retryMs)
                this.retryMs = Math.min(this.retryMs * 2, 15_000)
            }
        }
    }

    private openOnce(): Promise<void> {
        return new Promise((resolve, reject) => {
            const socket = new WebSocket(this.options.url, [`bearer.${this.options.token}`])
            this.socket = socket
            let settled = false
            let initialized = false

            const settleOpen = (callback: () => void) => {
                if (settled) return
                settled = true
                callback()
            }

            const reconnectAfterClose = () => {
                if (this.stopped || !this.options.reconnect) return
                this.emitStatus("reconnecting")
                globalThis.setTimeout(() => {
                    this.connectQuietly()
                }, 0)
            }

            const rejectOpen = (error: Error) => {
                settleOpen(() => {
                    if (this.socket === socket) this.socket = null
                    reject(error)
                })
            }

            socket.onopen = () => {
                void this.initializeSocket(socket).then(
                    () => {
                        initialized = true
                        settleOpen(resolve)
                    },
                    (error) => {
                        socket.close()
                        rejectOpen(error instanceof Error ? error : new Error("Runtime socket initialization failed"))
                    }
                )
            }
            socket.onmessage = (event) => this.handleMessage(String(event.data))
            socket.onerror = () => {
                rejectOpen(new Error("Runtime socket failed"))
            }
            socket.onclose = () => {
                if (this.socket === socket) this.socket = null
                if (this.socket === null) this.initializeResult = null
                for (const pending of this.pending.values()) {
                    pending.reject(new Error("Runtime socket disconnected"))
                }
                this.pending.clear()
                if (!initialized) {
                    rejectOpen(new Error("Runtime socket closed before initialization"))
                } else if (!this.stopped && this.options.reconnect) {
                    reconnectAfterClose()
                } else {
                    this.emitStatus("disconnected")
                }
            }
        })
    }

    private async initializeSocket(socket: WebSocket): Promise<void> {
        this.initializeResult = await this.sendRequest<RuntimeInitializeResult>(socket, "initialize", {
            clientName: this.options.clientName ?? "Runtime Client",
            clientPlatform: this.options.clientPlatform ?? "unknown",
            ...(this.options.clientVersion ? { clientVersion: this.options.clientVersion } : {}),
            protocolVersion: this.options.protocolVersion ?? 1,
        })
        if (this.lastCursor) {
            await this.sendRequest(socket, "subscription/update", { methods: ["*"], cursor: this.lastCursor })
        }
        this.emitStatus("connected")
    }

    private emitStatus(status: RuntimeClientStatus): void {
        if (this.lastStatus === status) return
        this.lastStatus = status
        this.options.onStatus?.(status)
    }

    private handleMessage(raw: string): void {
        let message: unknown
        try {
            message = JSON.parse(raw)
        } catch {
            return
        }

        const response = validateRuntimeResponse(message)
        if (response.ok) {
            const pending = this.pending.get(response.value.id)
            if (!pending) return
            this.pending.delete(response.value.id)
            if (response.value.error) {
                pending.reject(new RuntimeClientError(response.value.error.code, response.value.error.message, response.value.error.data))
            } else {
                pending.resolve(response.value.result)
            }
            return
        }

        if (isRuntimeNotification(message)) {
            if (typeof message.cursor === "string") this.lastCursor = message.cursor
            for (const listener of this.listeners) {
                listener(message)
            }
        }
    }
}

export class RuntimeLocalClient {
    private nextId = 1
    private connected = false
    private connecting: Promise<void> | null = null
    private disposeMessageListener: (() => void) | null = null
    private initializeResult: RuntimeInitializeResult | null = null
    private readonly listeners = new Set<NotificationListener>()

    constructor(
        private readonly transport: RuntimeLocalTransport,
        private readonly options: RuntimeLocalClientOptions = {}
    ) {}

    get capabilities(): RuntimeCapabilities | null {
        return this.initializeResult?.capabilities ?? null
    }

    hasMethod(method: string): boolean {
        return this.capabilities?.methods.includes(method) === true
    }

    async request<T>(method: string, params?: unknown): Promise<T> {
        await this.connect()
        return this.requestRaw<T>(method, params)
    }

    async requestWithOptions<T>(method: string, params?: unknown, options: RuntimeRequestOptions = {}): Promise<T> {
        await this.connect()
        return this.requestRaw<T>(method, params, options)
    }

    private async requestRaw<T>(method: string, params?: unknown, options: RuntimeRequestOptions = {}): Promise<T> {
        const id = options.requestId ?? this.nextId++
        const request: RuntimeRequest = params === undefined ? { id, method } : { id, method, params }
        const response = validateRuntimeResponse(await this.transport.request(request))
        if (!response.ok) throw new RuntimeClientError(response.error.code, response.error.message, { path: response.error.path })
        if (response.value.error) throw new RuntimeClientError(response.value.error.code, response.value.error.message, response.value.error.data)
        return response.value.result as T
    }

    async connect(): Promise<void> {
        if (this.connected) return
        if (this.connecting) return this.connecting
        this.connecting = this.connectOnce()
        try {
            await this.connecting
        } finally {
            this.connecting = null
        }
    }

    private async connectOnce(): Promise<void> {
        await this.transport.connect()
        const disposeMessageListener = this.transport.onMessage((message) => {
            if (!isRuntimeNotification(message)) return
            for (const listener of this.listeners) listener(message)
        })
        this.disposeMessageListener = disposeMessageListener
        try {
            this.initializeResult = await this.requestRaw<RuntimeInitializeResult>("initialize", {
                clientName: this.options.clientName ?? "Runtime Local Client",
                clientPlatform: this.options.clientPlatform ?? "desktop",
                ...(this.options.clientVersion ? { clientVersion: this.options.clientVersion } : {}),
                protocolVersion: this.options.protocolVersion ?? 1,
            })
            this.connected = true
        } catch (error) {
            disposeMessageListener()
            if (this.disposeMessageListener === disposeMessageListener) this.disposeMessageListener = null
            this.initializeResult = null
            this.connected = false
            await this.transport.disconnect()
            throw error
        }
    }

    subscribe(listener: NotificationListener): () => void {
        this.listeners.add(listener)
        void this.connect()
        return () => {
            this.listeners.delete(listener)
        }
    }

    async close(): Promise<void> {
        this.disposeMessageListener?.()
        this.disposeMessageListener = null
        this.connected = false
        this.connecting = null
        this.initializeResult = null
        this.listeners.clear()
        await this.transport.disconnect()
    }
}
