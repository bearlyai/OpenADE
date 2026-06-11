import type { RuntimeNotification } from "../../../runtime-protocol/src"
import type { PairRequest, RemoteDeviceSelfRevokeResult } from "../../../shared/companion/src"
import { RuntimeClientError } from "../../../runtime-client/src"
import {
    buildPairingTarget,
    defaultKernelSessionConstructors,
    KernelSessionManager,
    kernelSessionHasMethod,
    type KernelRealtimeConnectionStatus,
    type KernelRuntimeClientLike,
    type KernelSessionConfig,
    type KernelSessionConstructors,
    type KernelSessionEntry,
} from "../kernel/session"
import { KernelSessionConfigStore, type KernelSessionConfigInput } from "../kernel/sessionStore"
import { OpenADEProductStore, type OpenADEProductClient } from "../kernel/productStore"

export type { PairingTarget } from "../kernel/session"
export { buildPairingTarget, parsePairingCode } from "../kernel/session"

export interface RemoteConfig extends KernelSessionConfig {}

export const REMOTE_CONFIG_STORAGE_KEY = "openade-companion-config"
export type RemoteRealtimeConnectionStatus = KernelRealtimeConnectionStatus

type RemoteClientConstructors = KernelSessionConstructors<KernelRuntimeClientLike, OpenADEProductClient>

const remoteSessionDefaults = {
    clientName: "OpenADE Companion",
    clientPlatform: "mobile" as const,
    protocolVersion: 1,
    reconnect: true,
}
let remoteSessionManager = new KernelSessionManager<KernelRuntimeClientLike, OpenADEProductClient>(defaultKernelSessionConstructors, remoteSessionDefaults)
const remoteProductStores = new Map<string, { openade: OpenADEProductClient; store: OpenADEProductStore }>()

function clearRuntimeClientCache(): void {
    for (const entry of remoteProductStores.values()) {
        entry.store.destroy()
    }
    remoteProductStores.clear()
    remoteSessionManager.clear()
}

export function __setRemoteClientConstructorsForTest(constructors: RemoteClientConstructors): () => void {
    const previous = remoteSessionManager
    clearRuntimeClientCache()
    remoteSessionManager = new KernelSessionManager<KernelRuntimeClientLike, OpenADEProductClient>(constructors, remoteSessionDefaults)
    return () => {
        clearRuntimeClientCache()
        remoteSessionManager = previous
    }
}

export function remoteErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof RuntimeClientError && error.code === "unsupported_protocol_version") {
        return "Desktop update required. Update OpenADE on your desktop, then reconnect this app."
    }
    return error instanceof Error ? error.message : fallback
}

function notifyConfigSaved(value: string | null): void {
    window.dispatchEvent(new CustomEvent("openade-companion-config", { detail: value }))
}

function remoteConfigStore(): KernelSessionConfigStore {
    return new KernelSessionConfigStore({ storage: window.localStorage, storageKey: REMOTE_CONFIG_STORAGE_KEY, onChange: notifyConfigSaved })
}

export function loadRemoteConfigs(): RemoteConfig[] {
    return remoteConfigStore().loadConfigs()
}

export function loadRemoteConfig(): RemoteConfig | null {
    return remoteConfigStore().loadActive()
}

export function saveRemoteConfig(config: KernelSessionConfigInput): RemoteConfig {
    return remoteConfigStore().save(config)
}

export function activateRemoteConfig(configId: string): RemoteConfig | null {
    return remoteConfigStore().activate(configId)
}

export function removeRemoteConfig(configId: string): RemoteConfig | null {
    return remoteConfigStore().remove(configId)
}

export function clearRemoteConfig(): void {
    remoteConfigStore().clear()
}

function isTransientRuntimeReadError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error)
    return /Runtime socket (closed|disconnected|failed|is not connected)|WebSocket/i.test(message)
}

export async function retryRemoteRead<T>(read: () => Promise<T>): Promise<T> {
    try {
        return await read()
    } catch (error) {
        if (!isTransientRuntimeReadError(error)) throw error
        await new Promise<void>((resolve) => window.setTimeout(resolve, 250))
        return read()
    }
}

function runtimeEntry(
    config: RemoteConfig,
    onStatus?: (status: RemoteRealtimeConnectionStatus) => void
): { entry: KernelSessionEntry<KernelRuntimeClientLike, OpenADEProductClient>; removeStatus: () => void } {
    return remoteSessionManager.session(config, onStatus)
}

export function getRemoteProductStore(config: RemoteConfig): OpenADEProductStore {
    const { entry } = runtimeEntry(config)
    const cached = remoteProductStores.get(config.id)
    if (cached?.openade === entry.openade) return cached.store
    cached?.store.destroy()

    const store = new OpenADEProductStore(entry.openade)
    remoteProductStores.set(config.id, { openade: entry.openade, store })
    return store
}

export function remoteHasRuntimeMethods(config: RemoteConfig, methods: string[]): boolean {
    const { entry } = runtimeEntry(config)
    return methods.every((method) => kernelSessionHasMethod(entry, method))
}

export async function pairRemote(baseUrl: string, token: string): Promise<RemoteConfig> {
    const target = buildPairingTarget(baseUrl, token)
    const body: PairRequest = {
        token: target.token,
        deviceName: navigator.userAgent.includes("iPhone") ? "iPhone" : "Companion",
        platform: navigator.userAgent.includes("Android") ? "android" : navigator.userAgent.includes("iPhone") ? "ios" : "web",
    }
    const response = await fetch(`${target.baseUrl}/v1/pair`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    })
    if (!response.ok) throw new Error(await response.text())
    const result = (await response.json()) as { deviceToken: string }
    return saveRemoteConfig({ baseUrl: target.baseUrl, token: result.deviceToken, host: target.host, hostId: target.hostId })
}

export function selfRevokeRemoteDevice(config: RemoteConfig): Promise<RemoteDeviceSelfRevokeResult> {
    return runtimeEntry(config).entry.runtime.request("remote/device/selfRevoke")
}

export function subscribeRemoteChanges(
    config: RemoteConfig,
    onEvent: (notification: RuntimeNotification) => void,
    onStatus?: (status: RemoteRealtimeConnectionStatus) => void
): () => void {
    const { entry, removeStatus } = runtimeEntry(config, onStatus)
    const unsubscribe = entry.openade.subscribeToChanges((notification) => {
        onEvent(notification)
    })

    return () => {
        unsubscribe()
        removeStatus()
    }
}
