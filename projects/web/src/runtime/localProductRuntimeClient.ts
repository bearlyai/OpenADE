import type { OpenADECoreRolloutReason, OpenADECoreRolloutSource, OpenADECoreRolloutState, OpenADECoreRuntimeEndpoint } from "../../../electron/src/preload-api"
import type { RuntimeClientLike } from "../../../openade-client/src"
import { RuntimeClient, type RuntimeClientOptions } from "../../../runtime-client/src"
import type { RuntimeNotification } from "../../../runtime-protocol/src"
import { localRuntimeClient } from "./localRuntimeClient"

const DESKTOP_CLIENT_NAME = "OpenADE Desktop"
const DESKTOP_CLIENT_PLATFORM = "desktop"
const DESKTOP_PROTOCOL_VERSION = 1

export type LocalProductRuntimeSource = "core-websocket" | "electron-ipc"

export interface LocalProductRuntime {
    source: LocalProductRuntimeSource
    client: RuntimeClientLike
}

type LocalProductRuntimeNotificationListener = (notification: RuntimeNotification) => void

const productRuntimeNotificationListeners = new Set<LocalProductRuntimeNotificationListener>()
let productRuntimeNotificationBinding: { runtime: LocalProductRuntime; unsubscribe: () => void } | null = null

function isRuntimeEndpoint(value: unknown): value is OpenADECoreRuntimeEndpoint {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false
    const record = value as Record<string, unknown>
    if (typeof record.url !== "string" || typeof record.token !== "string") return false
    try {
        const url = new URL(record.url)
        return url.protocol === "ws:" || url.protocol === "wss:"
    } catch {
        return false
    }
}

function isCoreRolloutReason(value: string): value is OpenADECoreRolloutReason {
    return (
        value === "managed-core" ||
        value === "legacy-yjs-migration-accepted" ||
        value === "external-endpoint" ||
        value === "disabled" ||
        value === "legacy-yjs-documents" ||
        value === "development-default-off" ||
        value === "missing-core-binary" ||
        value === "invalid-managed-command" ||
        value === "invalid-external-endpoint" ||
        value === "unconfigured"
    )
}

function isCoreRolloutSource(value: string): value is OpenADECoreRolloutSource {
    return value === "managed" || value === "external" || value === "legacy-ipc"
}

function isCoreRolloutState(value: unknown): value is OpenADECoreRolloutState {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false
    const record = value as Record<string, unknown>
    return (
        (record.status === "connected" || record.status === "legacy-ipc") &&
        typeof record.source === "string" &&
        isCoreRolloutSource(record.source) &&
        typeof record.reason === "string" &&
        isCoreRolloutReason(record.reason) &&
        typeof record.automatic === "boolean" &&
        typeof record.legacyYjsDocumentsPresent === "boolean" &&
        typeof record.legacyYjsMigrationAccepted === "boolean"
    )
}

export function runtimeClientOptionsForCoreEndpoint(endpoint: OpenADECoreRuntimeEndpoint): RuntimeClientOptions {
    return {
        url: endpoint.url,
        token: endpoint.token,
        clientName: DESKTOP_CLIENT_NAME,
        clientPlatform: DESKTOP_CLIENT_PLATFORM,
        protocolVersion: DESKTOP_PROTOCOL_VERSION,
        reconnect: true,
    }
}

export function resolveCoreRuntimeEndpoint(): OpenADECoreRuntimeEndpoint | null {
    if (typeof window === "undefined") return null
    const endpoint = window.openadeAPI?.core?.runtimeEndpoint
    return isRuntimeEndpoint(endpoint) ? endpoint : null
}

export function resolveCoreMigrationRuntimeEndpoint(): OpenADECoreRuntimeEndpoint | null {
    if (typeof window === "undefined") return null
    const endpoint = window.openadeAPI?.core?.migrationRuntimeEndpoint
    return isRuntimeEndpoint(endpoint) ? endpoint : null
}

export function resolveCoreRolloutState(): OpenADECoreRolloutState | null {
    if (typeof window === "undefined") return null
    const state = window.openadeAPI?.core?.rolloutState
    return isCoreRolloutState(state) ? state : null
}

export function createLocalProductRuntimeClient(endpoint: OpenADECoreRuntimeEndpoint | null = resolveCoreRuntimeEndpoint()): LocalProductRuntime {
    if (!endpoint) {
        return {
            source: "electron-ipc",
            client: localRuntimeClient,
        }
    }

    return {
        source: "core-websocket",
        client: new RuntimeClient(runtimeClientOptionsForCoreEndpoint(endpoint)),
    }
}

function coreEndpointKey(endpoint: OpenADECoreRuntimeEndpoint): string {
    return `${endpoint.url}\n${endpoint.token}`
}

const initialCoreEndpoint = resolveCoreRuntimeEndpoint()

export const localProductRuntime = createLocalProductRuntimeClient(initialCoreEndpoint)

let selectedCoreRuntime: { key: string; runtime: LocalProductRuntime } | null =
    initialCoreEndpoint && localProductRuntime.source === "core-websocket"
        ? {
              key: coreEndpointKey(initialCoreEndpoint),
              runtime: localProductRuntime,
          }
        : null

function bindProductRuntimeNotifications(runtime: LocalProductRuntime): void {
    if (productRuntimeNotificationListeners.size === 0) {
        productRuntimeNotificationBinding?.unsubscribe()
        productRuntimeNotificationBinding = null
        return
    }

    if (productRuntimeNotificationBinding?.runtime === runtime) return

    productRuntimeNotificationBinding?.unsubscribe()
    productRuntimeNotificationBinding = {
        runtime,
        unsubscribe: runtime.client.subscribe((notification) => {
            for (const listener of Array.from(productRuntimeNotificationListeners)) {
                listener(notification)
            }
        }),
    }
}

function subscribeToSelectedProductRuntimeNotifications(listener: LocalProductRuntimeNotificationListener): () => void {
    productRuntimeNotificationListeners.add(listener)
    bindProductRuntimeNotifications(selectedLocalProductRuntime())
    return () => {
        productRuntimeNotificationListeners.delete(listener)
        if (productRuntimeNotificationListeners.size === 0) {
            productRuntimeNotificationBinding?.unsubscribe()
            productRuntimeNotificationBinding = null
        }
    }
}

export function selectedLocalProductRuntime(): LocalProductRuntime {
    const endpoint = resolveCoreRuntimeEndpoint()
    if (!endpoint) {
        const staleCoreRuntime = selectedCoreRuntime
        selectedCoreRuntime = null
        const runtime: LocalProductRuntime = {
            source: "electron-ipc",
            client: localRuntimeClient,
        }
        bindProductRuntimeNotifications(runtime)
        void staleCoreRuntime?.runtime.client.close()
        return runtime
    }

    const key = coreEndpointKey(endpoint)
    if (selectedCoreRuntime?.key !== key) {
        const staleCoreRuntime = selectedCoreRuntime
        selectedCoreRuntime = { key, runtime: createLocalProductRuntimeClient(endpoint) }
        bindProductRuntimeNotifications(selectedCoreRuntime.runtime)
        void staleCoreRuntime?.runtime.client.close()
    }
    bindProductRuntimeNotifications(selectedCoreRuntime.runtime)
    return selectedCoreRuntime.runtime
}

function currentSelectedLocalProductRuntimeClient(): RuntimeClientLike {
    return selectedLocalProductRuntime().client
}

export function selectedLocalProductRuntimeClient(): RuntimeClientLike {
    return currentSelectedLocalProductRuntimeClient()
}

export const localProductRuntimeClient: RuntimeClientLike = {
    get capabilities() {
        return currentSelectedLocalProductRuntimeClient().capabilities
    },
    connect() {
        return currentSelectedLocalProductRuntimeClient().connect()
    },
    request<T>(method: string, params?: unknown): Promise<T> {
        return currentSelectedLocalProductRuntimeClient().request<T>(method, params)
    },
    requestWithOptions<T>(
        method: string,
        params: unknown | undefined,
        options: Parameters<NonNullable<RuntimeClientLike["requestWithOptions"]>>[2]
    ): Promise<T> {
        const client = currentSelectedLocalProductRuntimeClient()
        if (client.requestWithOptions) return client.requestWithOptions<T>(method, params, options)
        return client.request<T>(method, params)
    },
    hasMethod(method: string): boolean {
        return currentSelectedLocalProductRuntimeClient().hasMethod(method)
    },
    subscribe(listener) {
        return subscribeToSelectedProductRuntimeNotifications(listener)
    },
    close() {
        return currentSelectedLocalProductRuntimeClient().close()
    },
}

export const localProductRuntimeNotificationSource = {
    subscribe(listener: (notification: RuntimeNotification) => void): () => void {
        return subscribeToSelectedProductRuntimeNotifications(listener)
    },
}
