import { type ReactElement, act, createElement } from "react"
import { type Root, createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { OpenADEClient } from "../../openade-client/src"
import type { OpenADETask, OpenADETurnStartRequest } from "../../openade-module/src"
import { type RuntimeClientOptions, RuntimeLocalClient, type RuntimeLocalTransport } from "../../runtime-client/src"
import type { RuntimeMessage, RuntimeRequest } from "../../runtime-protocol/src"
import { RuntimeServer, type RuntimeConnection } from "../../runtime/src"
import { REMOTE_CONFIG_STORAGE_KEY, __setRemoteClientConstructorsForTest } from "../../web/src/remote/client"
import { App } from "./App"

const now = "2026-06-11T00:00:00.000Z"

const updaterMock = vi.hoisted(() => ({
    notifyAppReady: vi.fn<() => Promise<void>>(),
    current: vi.fn<() => Promise<{ bundle: { version: string } }>>(),
    download: vi.fn<() => Promise<{ id: string }>>(),
    next: vi.fn<() => Promise<void>>(),
}))

const secureStorageMock = vi.hoisted(() => ({
    get: vi.fn<(args: { key: string }) => Promise<{ value: string }>>(),
    set: vi.fn<(args: { key: string; value: string }) => Promise<void>>(),
    remove: vi.fn<(args: { key: string }) => Promise<void>>(),
}))

const barcodeScannerMock = vi.hoisted(() => ({
    isSupported: vi.fn<() => Promise<{ supported: boolean }>>(),
    requestPermissions: vi.fn<() => Promise<{ camera: "granted" | "limited" | "denied" }>>(),
    scan: vi.fn<() => Promise<{ barcodes: Array<{ rawValue?: string }> }>>(),
}))

vi.mock("@capgo/capacitor-updater", () => ({
    CapacitorUpdater: updaterMock,
}))

vi.mock("@capacitor/core", () => ({
    Capacitor: {
        isNativePlatform: () => false,
    },
}))

vi.mock("capacitor-secure-storage-plugin", () => ({
    SecureStoragePlugin: secureStorageMock,
}))

vi.mock("@capacitor-mlkit/barcode-scanning", () => ({
    BarcodeFormat: {
        QrCode: "QrCode",
    },
    BarcodeScanner: barcodeScannerMock,
}))

function createRuntimeLocalTransport(server: RuntimeServer): RuntimeLocalTransport {
    const listeners = new Set<(message: RuntimeMessage) => void>()
    let dispose: (() => void) | null = null
    const connection: RuntimeConnection = {
        id: `mobile-shell-test-${Math.random().toString(36).slice(2)}`,
        send(message) {
            for (const listener of listeners) listener(message)
        },
    }
    return {
        connect() {
            dispose = server.connect(connection)
        },
        disconnect() {
            dispose?.()
            dispose = null
        },
        request(request: RuntimeRequest) {
            return server.handleRequest(request, connection, { requireInitialized: true })
        },
        onMessage(listener: (message: RuntimeMessage) => void) {
            listeners.add(listener)
            return () => listeners.delete(listener)
        },
    }
}

interface MobileSnapshotRuntimeOptions {
    registerTurnStart?: boolean
}

function createMobileSnapshotRuntimeConstructors(options: MobileSnapshotRuntimeOptions = {}): {
    RuntimeClient: new (options: RuntimeClientOptions) => RuntimeLocalClient
    OpenADEClient: typeof OpenADEClient
    turnStarts: OpenADETurnStartRequest[]
} {
    const registerTurnStart = options.registerTurnStart ?? true
    const server = new RuntimeServer({
        serverName: "mobile-shared-shell-test-runtime",
        protocolVersion: 1,
    })
    const turnStarts: OpenADETurnStartRequest[] = []
    const task: OpenADETask = {
        id: "task-mobile",
        repoId: "repo-mobile",
        slug: "task-mobile",
        title: "Mobile runtime task",
        description: "OpenADE mobile shared shell task",
        createdBy: { id: "mobile-test", email: "mobile-test@openade.local" },
        createdAt: now,
        updatedAt: now,
        isolationStrategy: { type: "head" },
        deviceEnvironments: [],
        comments: [],
        events: [
            {
                id: "event-mobile-1",
                type: "action",
                status: "completed",
                createdAt: now,
                completedAt: now,
                userInput: "Initial mobile task",
                source: { type: "do", userLabel: "Do" },
                execution: {
                    harnessId: "codex",
                    executionId: "mobile-exec-1",
                    modelId: "gpt-5-codex",
                    events: [],
                },
                includesCommentIds: [],
                result: { success: true },
            },
        ],
    }
    const taskPreview = {
        id: task.id,
        slug: task.slug,
        title: task.title,
        createdAt: now,
        closed: false,
        lastEvent: {
            type: "action",
            status: "completed",
            sourceType: "do",
            sourceLabel: "Do",
            at: now,
        },
        lastEventAt: now,
    }
    server.register("openade/snapshot/read", () => ({
        server: {
            version: "test",
            hostName: "Mobile Test Desktop",
            theme: { setting: "system", className: "code-theme-clean", label: "Clean" },
        },
        repos: [
            {
                id: "repo-mobile",
                name: "Mobile Runtime Repo",
                path: "/tmp/mobile-runtime-repo",
                tasks: [taskPreview],
            },
        ],
        workingTaskIds: [],
    }))
    server.register("openade/task/read", () => structuredClone(task))
    if (registerTurnStart) {
        server.register("openade/turn/start", (params) => {
            const request = params as OpenADETurnStartRequest
            turnStarts.push(structuredClone(request))
            const eventId = `event-mobile-${task.events.length + 1}`
            const completedAt = "2026-06-11T00:01:00.000Z"
            task.events.push({
                id: eventId,
                type: "action",
                status: "completed",
                createdAt: completedAt,
                completedAt,
                userInput: request.input,
                source: { type: request.type, userLabel: "Do" },
                execution: {
                    harnessId: request.harnessId ?? "codex",
                    executionId: "mobile-exec-2",
                    modelId: request.modelId ?? "gpt-5-codex",
                    events: [],
                },
                includesCommentIds: [],
                result: { success: true },
            })
            task.updatedAt = completedAt
            return {
                taskId: task.id,
                eventId,
                executionId: "mobile-exec-2",
                createdAt: completedAt,
                task: structuredClone(task),
                preview: { ...taskPreview, lastEventAt: completedAt },
            }
        })
    }
    server.registerNotification("openade/snapshotChanged")

    class MobileRuntimeClient extends RuntimeLocalClient {
        private readonly onStatus?: RuntimeClientOptions["onStatus"]
        private didReportConnected = false

        constructor(options: RuntimeClientOptions) {
            super(createRuntimeLocalTransport(server), {
                clientName: options.clientName,
                clientVersion: options.clientVersion,
                clientPlatform: options.clientPlatform,
                protocolVersion: options.protocolVersion,
            })
            this.onStatus = options.onStatus
        }

        override async connect(): Promise<void> {
            await super.connect()
            if (this.didReportConnected) return
            this.didReportConnected = true
            this.onStatus?.("connected")
        }

        override async close(): Promise<void> {
            this.didReportConnected = false
            await super.close()
            this.onStatus?.("disconnected")
        }
    }

    return { RuntimeClient: MobileRuntimeClient, OpenADEClient, turnStarts }
}

function savedMobileSession(): string {
    return JSON.stringify({
        version: 2,
        activeId: "mobile-session",
        configs: [
            {
                id: "mobile-session",
                baseUrl: "http://100.64.1.10:7823",
                token: "token-1",
                host: "100.64.1.10:7823",
                savedAt: now,
                lastUsedAt: now,
            },
        ],
    })
}

async function waitForText(container: HTMLElement, text: string): Promise<void> {
    const deadline = performance.now() + 1_000
    while (performance.now() < deadline) {
        if (container.textContent?.includes(text)) return
        await act(async () => {
            await new Promise((resolve) => window.setTimeout(resolve, 10))
        })
    }
    throw new Error(`Missing text: ${text}`)
}

async function drainAsyncReactWork(): Promise<void> {
    await Promise.resolve()
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    await Promise.resolve()
}

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
    const button = Array.from(container.querySelectorAll("button")).find((candidate) => candidate.textContent?.includes(text))
    if (!(button instanceof HTMLButtonElement)) throw new Error(`Missing button: ${text}`)
    return button
}

function queryButtonByExactText(container: HTMLElement, text: string): HTMLButtonElement | null {
    return Array.from(container.querySelectorAll("button")).find((candidate): candidate is HTMLButtonElement => candidate.textContent?.trim() === text) ?? null
}

async function clickButton(container: HTMLElement, text: string): Promise<void> {
    await act(async () => {
        buttonByText(container, text).dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
    })
}

function taskInputElement(container: HTMLElement): HTMLElement {
    const input = container.querySelector('[contenteditable="true"][aria-label="Task input"]')
    if (!(input instanceof HTMLElement)) throw new Error("Missing shared SmartEditor task input")
    return input
}

function disabledTaskTextarea(container: HTMLElement): HTMLTextAreaElement {
    const textarea = container.querySelector('textarea[aria-label="Task input"]')
    if (!(textarea instanceof HTMLTextAreaElement)) throw new Error("Missing disabled shared task input")
    return textarea
}

async function typeIntoTaskInput(element: HTMLElement, value: string): Promise<void> {
    await act(async () => {
        element.focus()
        document.execCommand("selectAll")
        document.execCommand("insertText", false, value)
        element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }))
        await Promise.resolve()
    })
}

function sendTaskInputButton(container: HTMLElement): HTMLButtonElement {
    const button = container.querySelector('button[aria-label="Send task input"]')
    if (!(button instanceof HTMLButtonElement)) throw new Error("Missing shared composer send button")
    return button
}

interface StoredMobileSession {
    activeId: string
    configs: Array<{
        baseUrl: string
        token: string
        host: string
    }>
}

describe("OpenADE mobile shell", () => {
    let container: HTMLDivElement
    let root: Root
    let restoreClientConstructors: (() => void) | undefined

    beforeEach(() => {
        ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
        localStorage.clear()
        vi.clearAllMocks()
        updaterMock.notifyAppReady.mockResolvedValue()
        updaterMock.current.mockResolvedValue({ bundle: { version: "local" } })
        updaterMock.download.mockResolvedValue({ id: "bundle-1" })
        updaterMock.next.mockResolvedValue()
        secureStorageMock.get.mockRejectedValue(new Error("no saved config"))
        secureStorageMock.set.mockResolvedValue()
        secureStorageMock.remove.mockResolvedValue()
        barcodeScannerMock.isSupported.mockResolvedValue({ supported: true })
        barcodeScannerMock.requestPermissions.mockResolvedValue({ camera: "granted" })
        barcodeScannerMock.scan.mockResolvedValue({ barcodes: [{ rawValue: "http://127.0.0.1:7823/pair?token=test" }] })
        container = document.createElement("div")
        document.body.appendChild(container)
        root = createRoot(container)
    })

    afterEach(async () => {
        await act(async () => {
            await drainAsyncReactWork()
            root.unmount()
            await drainAsyncReactWork()
        })
        restoreClientConstructors?.()
        restoreClientConstructors = undefined
        container.remove()
    })

    function render(element: ReactElement): void {
        act(() => {
            root.render(element)
        })
    }

    it("renders the shared remote shell after secure-storage hydration", async () => {
        render(createElement(App))

        await waitForText(container, "Companion")
        expect(container.textContent).toContain("OpenADE")
        expect(updaterMock.notifyAppReady).toHaveBeenCalledTimes(1)
        expect(secureStorageMock.get).toHaveBeenCalledWith({ key: REMOTE_CONFIG_STORAGE_KEY })
    })

    it("mirrors shared remote session config changes into secure storage", async () => {
        render(createElement(App))
        await waitForText(container, "Companion")

        window.dispatchEvent(new CustomEvent<string | null>("openade-companion-config", { detail: "stored-session-json" }))
        window.dispatchEvent(new CustomEvent<string | null>("openade-companion-config", { detail: null }))

        expect(secureStorageMock.set).toHaveBeenCalledWith({ key: REMOTE_CONFIG_STORAGE_KEY, value: "stored-session-json" })
        expect(secureStorageMock.remove).toHaveBeenCalledWith({ key: REMOTE_CONFIG_STORAGE_KEY })
    })

    it("hydrates a saved mobile session into the shared runtime-backed shell", async () => {
        secureStorageMock.get.mockResolvedValue({ value: savedMobileSession() })
        restoreClientConstructors = __setRemoteClientConstructorsForTest(createMobileSnapshotRuntimeConstructors())

        render(createElement(App))

        await waitForText(container, "Mobile Runtime Repo")
        await waitForText(container, "Online")
        expect(secureStorageMock.get).toHaveBeenCalledWith({ key: REMOTE_CONFIG_STORAGE_KEY })
    })

    it("inherits shared shell denials from mobile runtime capabilities", async () => {
        secureStorageMock.get.mockResolvedValue({ value: savedMobileSession() })
        const runtime = createMobileSnapshotRuntimeConstructors({ registerTurnStart: false })
        restoreClientConstructors = __setRemoteClientConstructorsForTest(runtime)

        render(createElement(App))

        await waitForText(container, "Mobile Runtime Repo")
        await clickButton(container, "Mobile Runtime Repo")
        expect(queryButtonByExactText(container, "New")).toBeNull()

        await clickButton(container, "Mobile runtime task")
        await waitForText(container, "Initial mobile task")
        expect(disabledTaskTextarea(container).disabled).toBe(true)

        expect(sendTaskInputButton(container).disabled).toBe(true)
        expect(runtime.turnStarts).toHaveLength(0)
    })

    it("drives the shared rich task composer through the mobile host", async () => {
        secureStorageMock.get.mockResolvedValue({ value: savedMobileSession() })
        const runtime = createMobileSnapshotRuntimeConstructors()
        restoreClientConstructors = __setRemoteClientConstructorsForTest(runtime)

        render(createElement(App))

        await waitForText(container, "Mobile Runtime Repo")
        await clickButton(container, "Mobile Runtime Repo")
        await clickButton(container, "Mobile runtime task")
        await waitForText(container, "Initial mobile task")

        const input = taskInputElement(container)
        await typeIntoTaskInput(input, "Run this from the mobile shared shell")
        await act(async () => {
            sendTaskInputButton(container).dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
        })

        await waitForText(container, "Run this from the mobile shared shell")
        expect(runtime.turnStarts).toHaveLength(1)
        expect(runtime.turnStarts[0]).toMatchObject({
            repoId: "repo-mobile",
            inTaskId: "task-mobile",
            input: "Run this from the mobile shared shell",
            type: "do",
        })
    })

    it("pairs from a native QR scan into the shared runtime-backed shell", async () => {
        restoreClientConstructors = __setRemoteClientConstructorsForTest(createMobileSnapshotRuntimeConstructors())
        barcodeScannerMock.scan.mockResolvedValue({ barcodes: [{ rawValue: "http://100.64.1.10:7823/pair?token=bootstrap" }] })
        const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
            new Response(JSON.stringify({ deviceToken: "token-1" }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            })
        )

        try {
            render(createElement(App))
            await waitForText(container, "Companion")

            await clickButton(container, "Scan QR")
            await waitForText(container, "Connect to 100.64.1.10:7823")

            await clickButton(container, "Connect")
            await waitForText(container, "Mobile Runtime Repo")
            await waitForText(container, "Online")

            expect(fetchSpy).toHaveBeenCalledWith(
                "http://100.64.1.10:7823/v1/pair",
                expect.objectContaining({
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                })
            )
            const savedConfigCall = secureStorageMock.set.mock.calls.find(([args]) => args.key === REMOTE_CONFIG_STORAGE_KEY)
            expect(savedConfigCall).toBeDefined()
            const savedSession = JSON.parse(savedConfigCall?.[0].value ?? "{}") as StoredMobileSession
            expect(savedSession.activeId).toBeTruthy()
            expect(savedSession.configs[0]).toMatchObject({
                baseUrl: "http://100.64.1.10:7823",
                token: "token-1",
                host: "100.64.1.10:7823",
            })
        } finally {
            fetchSpy.mockRestore()
        }
    })
})
