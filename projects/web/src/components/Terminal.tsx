import { FitAddon } from "@xterm/addon-fit"
import { Terminal as XTerm } from "@xterm/xterm"
import { RotateCcw } from "lucide-react"
import { useCallback, useEffect, useRef } from "react"
import { twMerge } from "tailwind-merge"
import "@xterm/xterm/css/xterm.css"
import { areDesktopFallbackChunksEnabled } from "../featureFlags"
import { useTerminalTheme } from "../hooks/useTerminalTheme"
import { DEFAULT_TERMINAL_THEME } from "../themes/terminalThemes"
import { createTerminalSession, type TaskTerminalProductAccess, type TerminalRuntimeSession } from "./terminalSession"

interface TerminalInstance {
    terminal: XTerm
    fitAddon: FitAddon
    terminalSession: TerminalRuntimeSession | null
    containerEl: HTMLDivElement | null
    lastEscapeTime: number
}

const DOUBLE_ESCAPE_THRESHOLD_MS = 300

// Global map of terminal instances keyed by task terminal scope.
const terminalInstances = new Map<string, TerminalInstance>()

async function setTerminalKeyboardCaptureState(capturesKeyboard: boolean): Promise<void> {
    if (!areDesktopFallbackChunksEnabled) return
    const { setTerminalKeyboardCapture } = await import("../electronAPI/app")
    await setTerminalKeyboardCapture(capturesKeyboard)
}

interface TerminalProps {
    ptyId: string
    cwd: string
    productAccess?: TaskTerminalProductAccess | null
    className?: string
    onClose?: () => void
}

function attachSession(instance: TerminalInstance, session: TerminalRuntimeSession): void {
    instance.terminalSession = session
    session.on("output", (data) => {
        instance.terminal.write(data)
    })
    session.on("exit", () => {
        instance.terminal.write("\r\n[Process exited]\r\n")
    })
}

function canRestartTerminal(productAccess?: TaskTerminalProductAccess | null): boolean {
    return !productAccess || (productAccess.capabilities.canStart && productAccess.capabilities.canStop)
}

async function stopSession(session: TerminalRuntimeSession): Promise<void> {
    if (session.exited) {
        session.cleanup()
        return
    }

    await new Promise<void>((resolve) => {
        let resolved = false
        const done = () => {
            if (resolved) return
            resolved = true
            resolve()
        }
        session.on("exit", done)
        session.kill().finally(done)
    })
}

export function Terminal({ ptyId, cwd, productAccess, className, onClose }: TerminalProps) {
    const containerRef = useRef<HTMLDivElement>(null)
    const onCloseRef = useRef(onClose)
    onCloseRef.current = onClose
    const productAccessRef = useRef(productAccess)
    productAccessRef.current = productAccess

    // Get terminal theme from CSS variable (updates when UI theme changes)
    const terminalTheme = useTerminalTheme(containerRef)
    const terminalKey = productAccess ? `product:${productAccess.repoId}:${productAccess.taskId}` : `raw:${ptyId}`
    const canRestart = canRestartTerminal(productAccess)

    const handleRestart = useCallback(async () => {
        if (!canRestartTerminal(productAccessRef.current)) return
        const instance = terminalInstances.get(terminalKey)
        if (!instance) return

        if (instance.terminalSession) {
            const oldSession = instance.terminalSession
            instance.terminalSession = null
            await stopSession(oldSession)
            if (productAccessRef.current && !oldSession.exited) {
                instance.terminalSession = oldSession
                return
            }
        }

        if (!canRestartTerminal(productAccessRef.current)) return

        // Clear terminal
        instance.terminal.clear()

        // Get current dimensions
        const cols = instance.terminal.cols
        const rows = instance.terminal.rows

        // Create the replacement terminal session.
        const session = await createTerminalSession({ ptyId, cwd, cols, rows, productAccess: productAccessRef.current })
        if (session) attachSession(instance, session)
    }, [terminalKey, ptyId, cwd])

    useEffect(() => {
        let mounted = true
        const container = containerRef.current
        if (!container) return

        let resizeObserver: ResizeObserver | null = null
        const handleFocusIn = () => {
            setTerminalKeyboardCaptureState(true).catch(() => {})
        }
        const handleFocusOut = (event: FocusEvent) => {
            const nextTarget = event.relatedTarget
            if (nextTarget instanceof Node && container.contains(nextTarget)) return
            setTerminalKeyboardCaptureState(false).catch(() => {})
        }

        container.addEventListener("focusin", handleFocusIn)
        container.addEventListener("focusout", handleFocusOut)

        async function setup() {
            if (!mounted || !container) return

            // Check if we already have an instance
            let instance = terminalInstances.get(terminalKey)

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

                // Set up resize observer for the new container
                resizeObserver = new ResizeObserver(() => {
                    instance!.fitAddon.fit()
                })
                resizeObserver.observe(container)

                // Re-fit to new container dimensions
                instance.fitAddon.fit()
                if (!instance.terminalSession || instance.terminalSession.exited) {
                    const session = await createTerminalSession({
                        ptyId,
                        cwd,
                        cols: instance.terminal.cols,
                        rows: instance.terminal.rows,
                        productAccess: productAccessRef.current,
                    })
                    if (session) attachSession(instance, session)
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

            const newInstance: TerminalInstance = {
                terminal,
                fitAddon,
                terminalSession: null,
                containerEl: container,
                lastEscapeTime: 0,
            }
            instance = newInstance
            terminalInstances.set(terminalKey, instance)

            // Send user input to PTY
            terminal.onData((data) => {
                const inst = terminalInstances.get(terminalKey)
                inst?.terminalSession?.write(data)
            })

            // Double-Escape to unfocus terminal and close tray
            // In xterm.js: return true = process key normally, return false = prevent key
            terminal.attachCustomKeyEventHandler((event: KeyboardEvent) => {
                const isMac = navigator.platform.toUpperCase().includes("MAC")
                if (event.key === "Escape" || event.ctrlKey || event.altKey || (!isMac && event.metaKey)) {
                    event.stopPropagation()
                }

                if (event.key === "Escape" && event.type === "keydown") {
                    const now = Date.now()
                    const inst = terminalInstances.get(terminalKey)
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

            const session = await createTerminalSession({
                ptyId,
                cwd,
                cols: terminal.cols,
                rows: terminal.rows,
                productAccess: productAccessRef.current,
            })
            if (session) attachSession(newInstance, session)

            // Sync PTY dimensions when terminal resizes
            terminal.onResize(({ cols, rows }) => {
                const inst = terminalInstances.get(terminalKey)
                inst?.terminalSession?.resize(cols, rows)
            })

            // Set up resize observer for fit addon
            resizeObserver = new ResizeObserver(() => {
                fitAddon.fit()
            })
            resizeObserver.observe(container)

            // Focus terminal when opened
            terminal.focus()
        }

        setup()

        return () => {
            mounted = false
            resizeObserver?.disconnect()
            container.removeEventListener("focusin", handleFocusIn)
            container.removeEventListener("focusout", handleFocusOut)
            setTerminalKeyboardCaptureState(false).catch(() => {})
        }
    }, [terminalKey, ptyId, cwd])

    // Update terminal theme when UI theme changes
    useEffect(() => {
        const instance = terminalInstances.get(terminalKey)
        if (instance) {
            instance.terminal.options.theme = terminalTheme
        }
    }, [terminalKey, terminalTheme])

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
                {canRestart && (
                    <button
                        type="button"
                        onClick={handleRestart}
                        className="btn flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-muted hover:text-base-content transition-colors"
                        title="Restart terminal"
                    >
                        <RotateCcw size="1em" />
                        Restart
                    </button>
                )}
            </div>
            <div className="flex-1 min-h-0 px-2 pt-2" style={{ backgroundColor: terminalTheme.background }}>
                <div ref={containerRef} className="h-full" />
            </div>
        </div>
    )
}
