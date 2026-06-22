import { Base64 } from "js-base64"
import { PtyHandle, type PtyOutputEvent } from "../electronAPI/pty"
import type { TerminalRuntimeSession } from "./terminalSession"

type TerminalEventName = "output" | "exit"
type TerminalOutputHandler = (data: string) => void
type TerminalExitHandler = () => void

export class RawPtyTerminalSession implements TerminalRuntimeSession {
    private readonly outputHandlers = new Map<TerminalOutputHandler, (chunk: unknown) => void>()

    private constructor(private readonly handle: PtyHandle) {}

    static async connect(ptyId: string, cwd: string, cols: number, rows: number): Promise<RawPtyTerminalSession | null> {
        const { handle, found } = await PtyHandle.reconnect(ptyId)
        if (found && handle) return new RawPtyTerminalSession(handle)

        const spawned = await PtyHandle.spawn({ ptyId, cwd, cols, rows })
        return spawned ? new RawPtyTerminalSession(spawned) : null
    }

    get exited(): boolean {
        return this.handle.exited
    }

    on(event: "output", handler: TerminalOutputHandler): void
    on(event: "exit", handler: TerminalExitHandler): void
    on(event: TerminalEventName, handler: TerminalOutputHandler | TerminalExitHandler): void {
        if (event === "output") {
            const outputHandler = handler as TerminalOutputHandler
            const wrapped = (chunk: unknown) => {
                const { data } = chunk as PtyOutputEvent
                outputHandler(Base64.decode(data))
            }
            this.outputHandlers.set(outputHandler, wrapped)
            this.handle.on("output", wrapped)
            return
        }

        this.handle.on("exit", handler as TerminalExitHandler)
    }

    async write(data: string): Promise<void> {
        await this.handle.write(data)
    }

    async resize(cols: number, rows: number): Promise<void> {
        await this.handle.resize(cols, rows)
    }

    async kill(): Promise<void> {
        await this.handle.kill()
    }

    cleanup(): void {
        this.handle.cleanup()
    }
}
