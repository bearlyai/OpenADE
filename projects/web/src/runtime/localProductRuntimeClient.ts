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

function isRuntimeEndpoint(value: unknown): value is OpenADECoreRuntimeEndpoint {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false
    const record = value as Record<string, unknown>
    return typeof record.url === "string" && record.url.length > 0 && typeof record.token === "string"
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

export const localProductRuntime = createLocalProductRuntimeClient()
export const localProductRuntimeClient = localProductRuntime.client

export const localProductRuntimeNotificationSource = {
    subscribe(listener: (notification: RuntimeNotification) => void): () => void {
        return localProductRuntimeClient.subscribe(listener)
    },
}
