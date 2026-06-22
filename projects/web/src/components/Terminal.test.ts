import { createElement } from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi, type Mock } from "vitest"
import type { TaskTerminalCapabilities, TaskTerminalProductAccess, TerminalRuntimeSession } from "./terminalSession"
import { createTerminalSession } from "./terminalSession"
import { Terminal } from "./Terminal"

interface MockTerminalInstance {
    element: HTMLDivElement | null
    cols: number
    rows: number
    options: { theme?: unknown }
    clear: Mock<() => void>
    blur: Mock<() => void>
    focus: Mock<() => void>
    loadAddon(addon: unknown): void
    open(container: HTMLElement): void
    write(data: string): void
    onData(handler: (data: string) => void): void
    onResize(handler: (size: { cols: number; rows: number }) => void): void
    attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean): void
}

interface TestTerminalSession extends TerminalRuntimeSession {
    kill: Mock<() => Promise<void>>
    cleanup: Mock<() => void>
}

class MockTerminalSession implements TestTerminalSession {
    private readonly exitHandlers = new Set<() => void>()
    private _exited = false
    readonly write = vi.fn(async () => undefined)
    readonly resize = vi.fn(async () => undefined)
    readonly kill = vi.fn(async () => {
        if (!this.exitsOnKill) return
        this._exited = true
        for (const handler of this.exitHandlers) handler()
    })
    readonly cleanup = vi.fn()

    constructor(private readonly exitsOnKill: boolean) {}

    get exited(): boolean {
        return this._exited
    }

    on(event: "output", handler: (data: string) => void): void
    on(event: "exit", handler: () => void): void
    on(event: "output" | "exit", handler: ((data: string) => void) | (() => void)): void {
        if (event === "exit") this.exitHandlers.add(handler as () => void)
    }
}

const terminalMockInstances = vi.hoisted((): MockTerminalInstance[] => [])
const createTerminalSessionMock = vi.hoisted(() => vi.fn())

vi.mock("@xterm/xterm", () => ({
    Terminal: class implements MockTerminalInstance {
        element: HTMLDivElement | null = null
        cols = 80
        rows = 24
        options: { theme?: unknown } = {}
        clear = vi.fn()
        blur = vi.fn()
        focus = vi.fn()

        constructor() {
            terminalMockInstances.push(this)
        }

        loadAddon(): void {}

        open(container: HTMLElement): void {
            const element = document.createElement("div")
            this.element = element
            container.appendChild(element)
        }

        write(): void {}

        onData(): void {}

        onResize(): void {}

        attachCustomKeyEventHandler(): void {}
    },
}))

vi.mock("@xterm/addon-fit", () => ({
    FitAddon: class {
        fit = vi.fn()
    },
}))

vi.mock("../electronAPI/app", () => ({
    setTerminalKeyboardCapture: vi.fn(async () => undefined),
}))

vi.mock("../hooks/useTerminalTheme", () => ({
    useTerminalTheme: () => ({ background: "#000000" }),
}))

vi.mock("./terminalSession", async (importOriginal) => {
    const actual = await importOriginal<typeof import("./terminalSession")>()
    return {
        ...actual,
        createTerminalSession: createTerminalSessionMock,
    }
})

function createProductAccess(capabilitiesRef: { current: TaskTerminalCapabilities }, taskId = "task-1"): TaskTerminalProductAccess {
    return {
        repoId: "repo-1",
        taskId,
        get capabilities() {
            return capabilitiesRef.current
        },
        startTaskTerminal: vi.fn(),
        reconnectTaskTerminal: vi.fn(),
        writeTaskTerminal: vi.fn(),
        resizeTaskTerminal: vi.fn(),
        stopTaskTerminal: vi.fn(),
    }
}

function createMockSession(options: { exitsOnKill: boolean }): TestTerminalSession {
    return new MockTerminalSession(options.exitsOnKill)
}

async function renderTerminal(productAccess: TaskTerminalProductAccess): Promise<{
    container: HTMLDivElement
    root: Root
    restoreActEnvironment(): void
}> {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    const previousActEnvironment = (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

    await act(async () => {
        root.render(createElement(Terminal, { ptyId: "pty-1", cwd: "/repo", productAccess }))
    })

    return {
        container,
        root,
        restoreActEnvironment() {
            ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
        },
    }
}

function getRestartButton(container: HTMLElement): HTMLButtonElement {
    const button = Array.from(container.querySelectorAll("button")).find((candidate) => candidate.textContent?.includes("Restart"))
    if (!(button instanceof HTMLButtonElement)) throw new Error("Expected restart button")
    return button
}

describe("Terminal", () => {
    afterEach(() => {
        terminalMockInstances.length = 0
        createTerminalSessionMock.mockReset()
    })

    it("rechecks product terminal restart capabilities before stopping the active session", async () => {
        const capabilitiesRef = {
            current: {
                canStart: true,
                canReconnect: true,
                canWrite: true,
                canResize: true,
                canStop: true,
            },
        }
        const productAccess = createProductAccess(capabilitiesRef, "task-recheck")
        const activeSession = createMockSession({ exitsOnKill: true })
        vi.mocked(createTerminalSession).mockResolvedValue(activeSession)
        const rendered = await renderTerminal(productAccess)

        try {
            await vi.waitFor(() => expect(createTerminalSession).toHaveBeenCalledTimes(1))
            capabilitiesRef.current = { ...capabilitiesRef.current, canStart: false, canStop: false }

            await act(async () => {
                getRestartButton(rendered.container).click()
            })

            expect(activeSession.kill).not.toHaveBeenCalled()
            expect(createTerminalSession).toHaveBeenCalledTimes(1)
            expect(terminalMockInstances[0]?.clear).not.toHaveBeenCalled()
        } finally {
            await act(async () => rendered.root.unmount())
            rendered.container.remove()
            rendered.restoreActEnvironment()
        }
    })

    it("does not clear or replace a product terminal session when stop does not exit", async () => {
        const capabilitiesRef = {
            current: {
                canStart: true,
                canReconnect: true,
                canWrite: true,
                canResize: true,
                canStop: true,
            },
        }
        const productAccess = createProductAccess(capabilitiesRef, "task-denied-stop")
        const activeSession = createMockSession({ exitsOnKill: false })
        const replacementSession = createMockSession({ exitsOnKill: true })
        vi.mocked(createTerminalSession).mockResolvedValueOnce(activeSession).mockResolvedValueOnce(replacementSession)
        const rendered = await renderTerminal(productAccess)

        try {
            await vi.waitFor(() => expect(createTerminalSession).toHaveBeenCalledTimes(1))

            await act(async () => {
                getRestartButton(rendered.container).click()
            })

            expect(activeSession.kill).toHaveBeenCalledTimes(1)
            expect(activeSession.exited).toBe(false)
            expect(createTerminalSession).toHaveBeenCalledTimes(1)
            expect(terminalMockInstances[0]?.clear).not.toHaveBeenCalled()
        } finally {
            await act(async () => rendered.root.unmount())
            rendered.container.remove()
            rendered.restoreActEnvironment()
        }
    })
})
