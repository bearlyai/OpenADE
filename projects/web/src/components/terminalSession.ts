import type {
    OpenADETaskTerminalMutationResult,
    OpenADETaskTerminalOutputChunk,
    OpenADETaskTerminalReconnectResult,
    OpenADETaskTerminalStartResult,
} from "../../../openade-module/src"
import { areDesktopFallbackChunksEnabled } from "../featureFlags"

type TerminalEventName = "output" | "exit"
type TerminalOutputHandler = (data: string) => void
type TerminalExitHandler = () => void

export interface TerminalRuntimeSession {
    readonly exited: boolean
    on(event: "output", handler: TerminalOutputHandler): void
    on(event: "exit", handler: TerminalExitHandler): void
    write(data: string): Promise<void>
    resize(cols: number, rows: number): Promise<void>
    kill(): Promise<void>
    cleanup(): void
}

export interface TaskTerminalCapabilities {
    canStart: boolean
    canReconnect: boolean
    canWrite: boolean
    canResize: boolean
    canStop: boolean
}

export interface TaskTerminalProductAccess {
    repoId: string
    taskId: string
    capabilities: TaskTerminalCapabilities
    startTaskTerminal(args: { cols: number; rows: number }): Promise<OpenADETaskTerminalStartResult>
    reconnectTaskTerminal(args: { terminalId?: string }): Promise<OpenADETaskTerminalReconnectResult>
    writeTaskTerminal(args: { terminalId: string; data: string }): Promise<OpenADETaskTerminalMutationResult>
    resizeTaskTerminal(args: { terminalId: string; cols: number; rows: number }): Promise<OpenADETaskTerminalMutationResult>
    stopTaskTerminal(args: { terminalId: string }): Promise<OpenADETaskTerminalMutationResult>
}

interface ProductSessionOptions {
    pollIntervalMs?: number
}

const DEFAULT_PRODUCT_TERMINAL_POLL_MS = 400

export class ProductTaskTerminalSession implements TerminalRuntimeSession {
    private readonly outputHandlers = new Set<TerminalOutputHandler>()
    private readonly exitHandlers = new Set<TerminalExitHandler>()
    private pendingOutput: string[] = []
    private outputCount = 0
    private pollTimer: ReturnType<typeof setInterval> | null = null
    private pollInFlight = false
    private _exited = false

    private constructor(
        private readonly access: TaskTerminalProductAccess,
        private terminalId: string,
        private readonly pollIntervalMs: number
    ) {}

    static async connect(
        access: TaskTerminalProductAccess,
        cols: number,
        rows: number,
        options: ProductSessionOptions = {}
    ): Promise<ProductTaskTerminalSession | null> {
        const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_PRODUCT_TERMINAL_POLL_MS
        if (access.capabilities.canReconnect) {
            const reconnected = await access.reconnectTaskTerminal({})
            if (reconnected.found) {
                const session = new ProductTaskTerminalSession(access, reconnected.terminalId, pollIntervalMs)
                session.applyReconnectResult(reconnected)
                session.startPolling()
                return session
            }
        }

        if (!access.capabilities.canStart) return null
        const started = await access.startTaskTerminal({ cols, rows })
        if (!started.ok) return null

        const session = new ProductTaskTerminalSession(access, started.terminalId, pollIntervalMs)
        session.startPolling()
        return session
    }

    get exited(): boolean {
        return this._exited
    }

    on(event: "output", handler: TerminalOutputHandler): void
    on(event: "exit", handler: TerminalExitHandler): void
    on(event: TerminalEventName, handler: TerminalOutputHandler | TerminalExitHandler): void {
        if (event === "output") {
            const outputHandler = handler as TerminalOutputHandler
            this.outputHandlers.add(outputHandler)
            if (this.pendingOutput.length > 0) {
                for (const chunk of this.pendingOutput) outputHandler(chunk)
                this.pendingOutput = []
            }
            return
        }

        this.exitHandlers.add(handler as TerminalExitHandler)
        if (this._exited) {
            const exitHandler = handler as TerminalExitHandler
            exitHandler()
        }
    }

    async write(data: string): Promise<void> {
        if (this._exited || !this.access.capabilities.canWrite) return
        await this.access.writeTaskTerminal({ terminalId: this.terminalId, data })
    }

    async resize(cols: number, rows: number): Promise<void> {
        if (this._exited || !this.access.capabilities.canResize) return
        await this.access.resizeTaskTerminal({ terminalId: this.terminalId, cols, rows })
    }

    async kill(): Promise<void> {
        if (this._exited || !this.access.capabilities.canStop) return
        await this.access.stopTaskTerminal({ terminalId: this.terminalId })
        this.markExited()
    }

    cleanup(): void {
        if (this.pollTimer) clearInterval(this.pollTimer)
        this.pollTimer = null
    }

    async pollOnce(): Promise<void> {
        if (this._exited || this.pollInFlight || !this.access.capabilities.canReconnect) return
        this.pollInFlight = true
        try {
            this.applyReconnectResult(await this.access.reconnectTaskTerminal({ terminalId: this.terminalId }))
        } finally {
            this.pollInFlight = false
        }
    }

    private startPolling(): void {
        if (this.pollIntervalMs <= 0 || this._exited || this.pollTimer || !this.access.capabilities.canReconnect) return
        this.pollTimer = setInterval(() => {
            void this.pollOnce()
        }, this.pollIntervalMs)
    }

    private applyReconnectResult(result: OpenADETaskTerminalReconnectResult): void {
        this.terminalId = result.terminalId
        this.appendNewOutput(result.output ?? [], result.outputCount ?? result.output?.length ?? 0)
        if (result.exited) this.markExited()
    }

    private appendNewOutput(chunks: OpenADETaskTerminalOutputChunk[], totalCount: number): void {
        if (totalCount < this.outputCount) this.outputCount = 0
        const newChunkCount = Math.max(0, totalCount - this.outputCount)
        const newChunks = chunks.slice(Math.max(0, chunks.length - newChunkCount))
        this.outputCount = Math.max(this.outputCount, totalCount)
        for (const chunk of newChunks) this.emitOutput(chunk.data)
    }

    private emitOutput(data: string): void {
        if (this.outputHandlers.size === 0) {
            this.pendingOutput.push(data)
            return
        }
        for (const handler of this.outputHandlers) handler(data)
    }

    private markExited(): void {
        if (this._exited) return
        this._exited = true
        this.cleanup()
        for (const handler of this.exitHandlers) handler()
    }
}

export async function createTerminalSession(params: {
    ptyId: string
    cwd: string
    cols: number
    rows: number
    productAccess?: TaskTerminalProductAccess | null
}): Promise<TerminalRuntimeSession | null> {
    if (params.productAccess) return ProductTaskTerminalSession.connect(params.productAccess, params.cols, params.rows)
    if (!areDesktopFallbackChunksEnabled) return null
    const { RawPtyTerminalSession } = await import("./rawPtyTerminalSession")
    return RawPtyTerminalSession.connect(params.ptyId, params.cwd, params.cols, params.rows)
}
