import { FitAddon } from "@xterm/addon-fit"
import { Terminal as XTerm } from "@xterm/xterm"
import { Base64 } from "js-base64"
import { RotateCcw } from "lucide-react"
import { useCallback, useEffect, useRef } from "react"
import { twMerge } from "tailwind-merge"
import "@xterm/xterm/css/xterm.css"
import { PtyHandle, type PtyOutputEvent } from "../electronAPI/pty"
import { useTerminalTheme } from "../hooks/useTerminalTheme"
import { DEFAULT_TERMINAL_THEME } from "../themes/terminalThemes"

interface TerminalInstance {
    terminal: XTerm
    fitAddon: FitAddon
    ptyHandle: PtyHandle | null
    containerEl: HTMLDivElement | null
    lastEscapeTime: number
}

const DOUBLE_ESCAPE_THRESHOLD_MS = 300

// Global map of terminal instances keyed by ptyId
const terminalInstances = new Map<string, TerminalInstance>()

interface TerminalProps {
    ptyId: string
    cwd: string
    className?: string
    onClose?: () => void
}

export function Terminal({ ptyId, cwd, className, onClose }: TerminalProps) {
    const containerRef = useRef<HTMLDivElement>(null)
    const onCloseRef = useRef(onClose)
    onCloseRef.current = onClose

    // Get terminal theme from CSS variable (updates when UI theme changes)
    const terminalTheme = useTerminalTheme(containerRef)

    const handleRestart = useCallback(async () => {
        const instance = terminalInstances.get(ptyId)
        if (!instance) return

        // Kill existing PTY and wait for exit event to avoid race condition
        // where the old PTY's exit event marks the new handle as exited
        if (instance.ptyHandle) {
            const oldHandle = instance.ptyHandle
            instance.ptyHandle = null

            if (!oldHandle.exited) {
                await new Promise<void>((resolve) => {
                    oldHandle.on("exit", () => resolve())
                    oldHandle.kill()
                })
            } else {
                oldHandle.cleanup()
            }
        }

        // Clear terminal
        instance.terminal.clear()

        // Get current dimensions
        const cols = instance.terminal.cols
        const rows = instance.terminal.rows

        // Spawn new PTY
        const handle = await PtyHandle.spawn({ ptyId, cwd, cols, rows })
        if (handle) {
            instance.ptyHandle = handle

            handle.on("output", (chunk: unknown) => {
                const { data } = chunk as PtyOutputEvent
                const decoded = Base64.decode(data)
                instance.terminal.write(decoded)
            })

            handle.on("exit", () => {
                instance.terminal.write("\r\n[Process exited]\r\n")
            })
        }
    }, [ptyId, cwd])

    useEffect(() => {
        let mounted = true
        const container = containerRef.current
        if (!container) return

        async function setup() {
            if (!mounted || !container) return

            // Check if we already have an instance
            let instance = terminalInstances.get(ptyId)

            if (instance) {
                // Re-mount existing terminal to this container
                if (instance.containerEl !== container) {
                    // Move terminal to new container
                    container.innerHTML = ""
                    const termElement = instance.terminal.element
                    if (termElement) {
                        container.appendChild(termElement)
                    }
                    instance.containerEl = container
                }
                // Focus terminal when opened
                instance.terminal.focus()
                return
            }

            // Create new terminal instance
            const terminal = new XTerm({
                cursorBlink: true,
                cursorStyle: "bar",
                fontSize: 13,
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                theme: DEFAULT_TERMINAL_THEME,
            })

            const fitAddon = new FitAddon()
            terminal.loadAddon(fitAddon)
            terminal.open(container)
            fitAddon.fit()

            instance = {
                terminal,
                fitAddon,
                ptyHandle: null,
                containerEl: container,
                lastEscapeTime: 0,
            }
            terminalInstances.set(ptyId, instance)

            // Send user input to PTY
            terminal.onData((data) => {
                const inst = terminalInstances.get(ptyId)
                inst?.ptyHandle?.write(data)
            })

            // Double-Escape to unfocus terminal and close tray
            // In xterm.js: return true = process key normally, return false = prevent key
            terminal.attachCustomKeyEventHandler((event: KeyboardEvent) => {
                if (event.key === "Escape" && event.type === "keydown") {
                    const now = Date.now()
                    const inst = terminalInstances.get(ptyId)
                    if (inst && now - inst.lastEscapeTime < DOUBLE_ESCAPE_THRESHOLD_MS) {
                        terminal.blur()
                        onCloseRef.current?.()
                        inst.lastEscapeTime = 0
                        return false // Prevent this escape from going to terminal
                    }
                    if (inst) {
                        inst.lastEscapeTime = now
                    }
                }
                return true // Allow all other keys to be processed normally
            })

            // Try to reconnect to existing PTY
            const { handle, found } = await PtyHandle.reconnect(ptyId)

            if (found && handle) {
                instance.ptyHandle = handle

                handle.on("output", (chunk: unknown) => {
                    const { data } = chunk as PtyOutputEvent
                    const decoded = Base64.decode(data)
                    terminal.write(decoded)
                })

                handle.on("exit", () => {
                    terminal.write("\r\n[Process exited]\r\n")
                })
            } else {
                // Spawn new PTY with fitted dimensions
                const newHandle = await PtyHandle.spawn({ ptyId, cwd, cols: terminal.cols, rows: terminal.rows })
                if (newHandle) {
                    instance.ptyHandle = newHandle

                    newHandle.on("output", (chunk: unknown) => {
                        const { data } = chunk as PtyOutputEvent
                        const decoded = Base64.decode(data)
                        terminal.write(decoded)
                    })

                    newHandle.on("exit", () => {
                        terminal.write("\r\n[Process exited]\r\n")
                    })
                }
            }

            // Sync PTY dimensions when terminal resizes
            terminal.onResize(({ cols, rows }) => {
                const inst = terminalInstances.get(ptyId)
                inst?.ptyHandle?.resize(cols, rows)
            })

            // Set up resize observer for fit addon
            const resizeObserver = new ResizeObserver(() => {
                fitAddon.fit()
            })
            resizeObserver.observe(container)

            // Focus terminal when opened
            terminal.focus()
        }

        setup()

        return () => {
            mounted = false
        }
    }, [ptyId, cwd])

    // Update terminal theme when UI theme changes
    useEffect(() => {
        const instance = terminalInstances.get(ptyId)
        if (instance) {
            instance.terminal.options.theme = terminalTheme
        }
    }, [ptyId, terminalTheme])

    return (
        <div className={twMerge("flex flex-col h-full bg-base-100", className)}>
            <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-base-200">
                <span className="text-xs text-muted font-medium flex items-center gap-1.5">
                    Terminal
                    <span className="text-muted/50">·</span>
                    <span className="text-muted/50 flex items-center gap-0.5">
                        <kbd className="px-1 bg-base-300 text-[10px]">esc</kbd>
                        <kbd className="px-1 bg-base-300 text-[10px]">esc</kbd>
                        to close
                    </span>
                </span>
                <button
                    type="button"
                    onClick={handleRestart}
                    className="btn flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-muted hover:text-base-content transition-colors"
                    title="Restart terminal"
                >
                    <RotateCcw size="1em" />
                    Restart
                </button>
            </div>
            <div ref={containerRef} className="flex-1 min-h-0 p-2" style={{ backgroundColor: terminalTheme.background }} />
        </div>
    )
}
