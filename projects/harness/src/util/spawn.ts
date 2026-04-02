import { spawn as nodeSpawn } from "node:child_process"
import { createInterface } from "node:readline"
import type { HarnessEvent } from "../types.js"

export interface SpawnJsonlOptions<M> {
    command: string
    args: string[]
    cwd?: string
    env?: Record<string, string>
    signal: AbortSignal

    /** Optional lines to write to stdin before closing. When set, stdin is piped instead of ignored. */
    stdinLines?: string[]

    /**
     * Called for each line of stdout. Return event(s) to yield, or null to skip.
     */
    parseLine: (line: string) => HarnessEvent<M> | HarnessEvent<M>[] | null

    /**
     * Called when the process exits. Return final event(s) or null.
     */
    onExit?: (code: number | null, stderrAccumulated: string) => HarnessEvent<M> | HarnessEvent<M>[] | null
}

/**
 * Spawns a child process, reads JSONL from stdout, and yields HarnessEvents.
 * Both harnesses use this shared infrastructure.
 */
export async function* spawnJsonl<M>(options: SpawnJsonlOptions<M>): AsyncGenerator<HarnessEvent<M>> {
    const { command, args, cwd, env, signal, parseLine, onExit } = options
    const useProcessGroup = process.platform !== "win32"

    // Check if already aborted
    if (signal.aborted) {
        yield { type: "error", error: "Aborted before start", code: "aborted" }
        return
    }

    const proc = nodeSpawn(command, args, {
        cwd,
        env: env ? { ...process.env, ...env } : undefined,
        stdio: [options.stdinLines ? "pipe" : "ignore", "pipe", "pipe"],
        detached: useProcessGroup,
    })

    // Write stdin lines and close
    if (options.stdinLines && proc.stdin) {
        for (const line of options.stdinLines) {
            proc.stdin.write(line + "\n")
        }
        proc.stdin.end()
    }

    let stderrBuf = ""
    let killed = false
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined

    const sendSignal = (killSignal: NodeJS.Signals): void => {
        if (!proc.pid) return

        try {
            if (useProcessGroup) {
                process.kill(-proc.pid, killSignal)
            } else {
                proc.kill(killSignal)
            }
        } catch {
            // Fallback to direct child kill if group kill fails
            try {
                proc.kill(killSignal)
            } catch {
                // Process already exited
            }
        }
    }

    const killProcess = () => {
        if (killed || !proc.pid) return
        killed = true
        try {
            sendSignal("SIGTERM")
            // Force kill after 5 seconds if still alive
            forceKillTimer = setTimeout(() => {
                try {
                    sendSignal("SIGKILL")
                } catch {
                    // Already dead
                }
            }, 5000)
            // Don't keep the process alive just for this timer
            forceKillTimer.unref()
        } catch {
            // Process already exited
        }
    }

    // Listen for abort signal
    const onAbort = () => killProcess()
    signal.addEventListener("abort", onAbort, { once: true })

    try {
        // Create a queue for events to yield
        const eventQueue: HarnessEvent<M>[] = []
        let resolveWait: (() => void) | null = null
        let done = false

        const pushEvent = (event: HarnessEvent<M>) => {
            eventQueue.push(event)
            if (resolveWait) {
                const r = resolveWait
                resolveWait = null
                r()
            }
        }

        const pushEvents = (events: HarnessEvent<M> | HarnessEvent<M>[] | null) => {
            if (!events) return
            if (Array.isArray(events)) {
                for (const e of events) pushEvent(e)
            } else {
                pushEvent(events)
            }
        }

        // Read stderr in real-time
        if (proc.stderr) {
            proc.stderr.setEncoding("utf-8")
            proc.stderr.on("data", (chunk: string) => {
                stderrBuf += chunk
                // Yield stderr lines in real-time
                const lines = chunk.split("\n")
                for (const line of lines) {
                    const trimmed = line.trim()
                    if (trimmed) {
                        pushEvent({ type: "stderr", data: trimmed })
                    }
                }
            })
        }

        // Read stdout line-by-line
        if (proc.stdout) {
            const rl = createInterface({ input: proc.stdout })

            rl.on("line", (line: string) => {
                if (!line.trim()) return
                try {
                    const result = parseLine(line)
                    pushEvents(result)
                } catch {
                    // Malformed line — skip
                }
            })

            rl.on("close", () => {
                // readline finished — exit handler will finalize
            })
        }

        // Wait for process exit
        const exitPromise = new Promise<{ code: number | null }>((resolve) => {
            proc.on("exit", (code: number | null) => {
                resolve({ code })
            })
            proc.on("error", (err: Error) => {
                pushEvent({ type: "error", error: err.message, code: "process_crashed" })
                resolve({ code: null })
            })
        })

        // Process exit handler
        exitPromise.then(({ code }) => {
            if (forceKillTimer) {
                clearTimeout(forceKillTimer)
                forceKillTimer = undefined
            }
            if (signal.aborted) {
                pushEvent({ type: "error", error: "Aborted", code: "aborted" })
            } else if (onExit) {
                pushEvents(onExit(code, stderrBuf))
            } else if (code !== null && code !== 0) {
                pushEvent({
                    type: "error",
                    error: stderrBuf.trim() || `Process exited with code ${code}`,
                    code: "process_crashed",
                })
            }
            done = true
            if (resolveWait) {
                const r = resolveWait
                resolveWait = null
                r()
            }
        })

        // Yield events as they arrive
        while (true) {
            if (eventQueue.length > 0) {
                yield eventQueue.shift()!
            } else if (done) {
                break
            } else {
                // Wait for new events
                await new Promise<void>((resolve) => {
                    resolveWait = resolve
                })
            }
        }

        // Yield any remaining events
        while (eventQueue.length > 0) {
            yield eventQueue.shift()!
        }
    } finally {
        signal.removeEventListener("abort", onAbort)
        if (forceKillTimer) {
            clearTimeout(forceKillTimer)
            forceKillTimer = undefined
        }
        killProcess()
    }
}
