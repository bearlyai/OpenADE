import { act, createElement, type ReactElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { CompanionState, RemoteDevice } from "../../../shared/companion/src"
import { type RuntimeConnection, RuntimeServer } from "../../../runtime/src"
import { type RuntimeMessage, validateRuntimeRequest } from "../../../runtime-protocol/src"
import { CompanionTab } from "../components/settings/CompanionTab"
import { dropAllCompanionDevices, getCompanionState, revokeCompanionDevice } from "./companion"
import { localRuntimeClient } from "../runtime/localRuntimeClient"
import { CodeStore } from "../store/store"

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null
}

function staleCompanionState(): CompanionState {
    return {
        enabled: true,
        port: 7823,
        boundUrls: ["http://127.0.0.1:7823"],
        keepAwakeMode: "off",
        devices: [
            {
                id: "legacy-ipc-device",
                name: "Legacy IPC Device",
                platform: "unknown",
                pairedAt: "2026-06-01T00:00:00.000Z",
            },
        ],
    }
}

function installRuntimeBackedOpenADEApi(server: RuntimeServer): () => void {
    const previous = window.openadeAPI
    const listeners = new Set<(message: unknown) => void>()
    let disposeConnection: (() => void) | null = null
    const connection: RuntimeConnection = {
        id: "companion-settings-runtime-test",
        send(message: RuntimeMessage) {
            for (const listener of listeners) listener(message)
        },
    }
    const noopUnsubscribe = () => undefined

    window.openadeAPI = {
        app: {
            quit: async () => undefined,
            openUrl: async () => undefined,
            applyUpdate: async () => undefined,
            forceEnableDevTools: async () => undefined,
            isWindowedWithFrame: async () => false,
            setTerminalKeyboardCapture: async () => undefined,
            onUpdateAvailable: () => noopUnsubscribe,
            onUpdateError: () => noopUnsubscribe,
            onFocusInputShortcut: () => noopUnsubscribe,
            retryUpdateCheck: async () => undefined,
        },
        window: {
            isPinned: async () => false,
            isAutoHide: async () => false,
            action: async () => undefined,
            frameEnabled: async () => true,
            setFrameColors: async () => undefined,
            findInPage: async () => null,
        },
        settings: {
            getDeviceConfig: async () => null,
            setDeviceId: async () => null,
            setTelemetryDisabled: async () => undefined,
        },
        shell: {
            selectDirectory: async () => ({ canceled: true }),
            openUrl: async () => undefined,
            openPath: async () => undefined,
        },
        codeWindowFrame: {
            enabled: async () => true,
            setColors: async () => undefined,
        },
        notifications: {
            getState: async () => null,
            shouldShow: async () => false,
        },
        companion: {
            getState: async () => staleCompanionState(),
            setEnabled: async () => staleCompanionState(),
            setKeepAwakeMode: async () => staleCompanionState(),
            startPairing: async () => ({
                url: "http://127.0.0.1:7823",
                token: "test-pairing-token",
                hostId: "host-1",
                expiresAt: "2026-06-01T00:02:00.000Z",
            }),
        },
        runtime: {
            connect: async () => {
                disposeConnection?.()
                disposeConnection = server.connect(connection)
                return null
            },
            disconnect: async () => {
                disposeConnection?.()
                disposeConnection = null
                return null
            },
            request: async (rawRequest: unknown) => {
                const request = validateRuntimeRequest(rawRequest)
                if (!request.ok) throw new Error(request.error.message)
                return server.handleRequest(request.value, connection, { requireInitialized: true })
            },
            onMessage: (cb: (message: unknown) => void) => {
                listeners.add(cb)
                return () => listeners.delete(cb)
            },
        },
    }

    return () => {
        disposeConnection?.()
        disposeConnection = null
        window.openadeAPI = previous
    }
}

interface DeviceRuntimeHarness {
    server: RuntimeServer
    revokedDeviceIds: string[]
    currentDevices(): RemoteDevice[]
}

function createDeviceRuntimeHarness(): DeviceRuntimeHarness {
    const server = new RuntimeServer({ serverName: "companion-settings-test" })
    let devices: RemoteDevice[] = [
        {
            id: "device-1",
            name: "Runtime Phone",
            platform: "ios",
            pairedAt: "2026-06-01T00:00:00.000Z",
            lastSeenAt: "2026-06-01T00:01:00.000Z",
        },
        {
            id: "device-2",
            name: "Runtime Tablet",
            platform: "web",
            pairedAt: "2026-06-01T00:00:30.000Z",
        },
    ]
    const revokedDeviceIds: string[] = []

    server.register("remote/device/list", () => ({ devices }))
    server.register("remote/device/revoke", (params) => {
        if (!isRecord(params) || typeof params.deviceId !== "string") throw new Error("deviceId is required")
        revokedDeviceIds.push(params.deviceId)
        devices = devices.map((device) => (device.id === params.deviceId ? { ...device, revokedAt: "2026-06-01T00:03:00.000Z" } : device))
        return { ok: true, revoked: true, devices }
    })
    server.register("remote/device/dropAll", () => {
        devices = devices.map((device) => ({ ...device, revokedAt: device.revokedAt ?? "2026-06-01T00:04:00.000Z" }))
        return { ok: true, devices }
    })

    return {
        server,
        revokedDeviceIds,
        currentDevices: () => devices,
    }
}

function buttonByTitle(container: HTMLElement, title: string, index = 0): HTMLButtonElement {
    const button = Array.from(container.querySelectorAll(`button[title="${title}"]`))[index]
    if (!(button instanceof HTMLButtonElement)) throw new Error(`Missing button with title: ${title}`)
    return button
}

function requireContainer(container: HTMLDivElement | null): HTMLDivElement {
    if (!container) throw new Error("Test container is not mounted")
    return container
}

async function waitForElement<T extends Element>(find: () => T | null, label: string): Promise<T> {
    for (let attempt = 0; attempt < 50; attempt++) {
        const element = find()
        if (element) return element
        await act(async () => {
            await new Promise((resolve) => window.setTimeout(resolve, 10))
        })
    }
    throw new Error(`Timed out waiting for ${label}`)
}

describe("companion Electron API wrappers", () => {
    let cleanupOpenADEApi: (() => void) | null = null
    let container: HTMLDivElement | null = null
    let root: Root | null = null

    beforeEach(async () => {
        ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
        await localRuntimeClient.close()
    })

    afterEach(async () => {
        if (root) {
            act(() => root?.unmount())
            root = null
        }
        container?.remove()
        container = null
        await localRuntimeClient.close()
        cleanupOpenADEApi?.()
        cleanupOpenADEApi = null
    })

    function render(element: ReactElement): void {
        container = document.createElement("div")
        document.body.appendChild(container)
        root = createRoot(container)
        act(() => {
            root?.render(element)
        })
    }

    it("reads and mutates paired devices through the trusted local runtime", async () => {
        const harness = createDeviceRuntimeHarness()
        cleanupOpenADEApi = installRuntimeBackedOpenADEApi(harness.server)

        await expect(getCompanionState()).resolves.toMatchObject({
            devices: [
                { id: "device-1", name: "Runtime Phone" },
                { id: "device-2", name: "Runtime Tablet" },
            ],
        })

        const afterRevoke = await revokeCompanionDevice("device-1")
        expect(afterRevoke.devices.find((device) => device.id === "device-1")?.revokedAt).toBe("2026-06-01T00:03:00.000Z")
        expect(afterRevoke.devices.find((device) => device.id === "device-2")?.revokedAt).toBeUndefined()
        expect(harness.revokedDeviceIds).toEqual(["device-1"])

        await expect(dropAllCompanionDevices()).resolves.toMatchObject({
            devices: [
                { id: "device-1", revokedAt: "2026-06-01T00:03:00.000Z" },
                { id: "device-2", revokedAt: "2026-06-01T00:04:00.000Z" },
            ],
        })
    })

    it("renders desktop device settings from runtime devices and routes revoke actions through runtime", async () => {
        const harness = createDeviceRuntimeHarness()
        cleanupOpenADEApi = installRuntimeBackedOpenADEApi(harness.server)
        const store = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
        })

        render(createElement(CompanionTab, { store }))

        await waitForElement(() => (container?.textContent?.includes("Runtime Phone") ? container : null), "runtime device list")
        expect(container?.textContent).toContain("Runtime Tablet")
        expect(container?.textContent).not.toContain("Legacy IPC Device")

        await act(async () => {
            buttonByTitle(requireContainer(container), "Revoke").click()
        })
        await waitForElement(
            () => (buttonByTitle(requireContainer(container), "Revoke").disabled ? buttonByTitle(requireContainer(container), "Revoke") : null),
            "revoked device disabled button"
        )
        expect(harness.revokedDeviceIds).toEqual(["device-1"])
        expect(harness.currentDevices().find((device) => device.id === "device-2")?.revokedAt).toBeUndefined()

        await act(async () => {
            buttonByTitle(requireContainer(container), "Drop all").click()
        })
        await waitForElement(
            () => (harness.currentDevices().every((device) => !!device.revokedAt) ? buttonByTitle(requireContainer(container), "Drop all") : null),
            "all devices revoked"
        )
    })
})
