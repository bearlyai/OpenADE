import type { PairRequest, RemoteSnapshot, RemoteTask, RemoteTurnStartRequest } from "../../../shared/companion/src"
import { OpenADEClient } from "../../../openade-client/src"
import { RuntimeClient, RuntimeClientError, type RuntimeClientStatus } from "../../../runtime-client/src"

export interface RemoteConfig {
    id: string
    baseUrl: string
    token: string
    host: string
    hostId?: string
    savedAt: string
    lastUsedAt: string
}

export const REMOTE_CONFIG_STORAGE_KEY = "openade-companion-config"
export type RemoteRealtimeConnectionStatus = RuntimeClientStatus | "lagged"

export interface PairingTarget {
    baseUrl: string
    token: string
    host: string
    hostId?: string
}

interface RemoteConfigStore {
    version: 2
    activeId?: string
    configs: RemoteConfig[]
}

type RemoteConfigInput = Pick<RemoteConfig, "baseUrl" | "token"> & Partial<Omit<RemoteConfig, "baseUrl" | "token">>

interface RuntimeClientEntry {
    client: RuntimeClient
    openade: OpenADEClient
    statusListeners: Set<(status: RuntimeClientStatus) => void>
    url: string
    token: string
}

const runtimeClients = new Map<string, RuntimeClientEntry>()

export function remoteErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof RuntimeClientError && error.code === "unsupported_protocol_version") {
        return "Desktop update required. Update OpenADE on your desktop, then reconnect this app."
    }
    return error instanceof Error ? error.message : fallback
}

function notifyConfigSaved(value: string | null): void {
    window.dispatchEvent(new CustomEvent("openade-companion-config", { detail: value }))
}

function remoteConfigId(baseUrl: string, hostId?: string): string {
    if (hostId) return hostId
    return buildPairingTarget(baseUrl, "token").baseUrl
}

function normalizeRemoteConfig(config: RemoteConfigInput): RemoteConfig {
    const target = buildPairingTarget(config.baseUrl, config.token)
    const now = new Date().toISOString()
    return {
        id: config.id ?? remoteConfigId(target.baseUrl, config.hostId),
        baseUrl: target.baseUrl,
        token: target.token,
        host: config.host ?? target.host,
        hostId: config.hostId,
        savedAt: config.savedAt ?? now,
        lastUsedAt: config.lastUsedAt ?? now,
    }
}

function parseRemoteConfigStore(raw: string | null): RemoteConfigStore {
    if (!raw) return { version: 2, configs: [] }

    try {
        const parsed = JSON.parse(raw) as Partial<RemoteConfigStore> | RemoteConfigInput
        if ("configs" in parsed && Array.isArray(parsed.configs)) {
            const configs = parsed.configs
                .map((config) => {
                    try {
                        return normalizeRemoteConfig(config)
                    } catch {
                        return null
                    }
                })
                .filter((config): config is RemoteConfig => config !== null && Boolean(config.token))
            const activeId = configs.some((config) => config.id === parsed.activeId) ? parsed.activeId : configs[0]?.id
            return { version: 2, activeId, configs }
        }
        if ("baseUrl" in parsed && "token" in parsed && parsed.baseUrl && parsed.token) {
            try {
                const config = normalizeRemoteConfig(parsed)
                return { version: 2, activeId: config.id, configs: [config] }
            } catch {
                return { version: 2, configs: [] }
            }
        }
    } catch {
        return { version: 2, configs: [] }
    }
    return { version: 2, configs: [] }
}

function loadRemoteConfigStore(): RemoteConfigStore {
    return parseRemoteConfigStore(localStorage.getItem(REMOTE_CONFIG_STORAGE_KEY))
}

function persistRemoteConfigStore(store: RemoteConfigStore): void {
    const value = JSON.stringify(store)
    localStorage.setItem(REMOTE_CONFIG_STORAGE_KEY, value)
    notifyConfigSaved(value)
}

export function loadRemoteConfigs(): RemoteConfig[] {
    return loadRemoteConfigStore().configs
}

export function loadRemoteConfig(): RemoteConfig | null {
    const store = loadRemoteConfigStore()
    return store.configs.find((config) => config.id === store.activeId) ?? store.configs[0] ?? null
}

export function saveRemoteConfig(config: RemoteConfigInput): RemoteConfig {
    const store = loadRemoteConfigStore()
    const nextConfig = normalizeRemoteConfig({ ...config, lastUsedAt: new Date().toISOString() })
    const configs = [nextConfig, ...store.configs.filter((existing) => existing.id !== nextConfig.id)]
    persistRemoteConfigStore({ version: 2, activeId: nextConfig.id, configs })
    return nextConfig
}

export function activateRemoteConfig(configId: string): RemoteConfig | null {
    const store = loadRemoteConfigStore()
    const config = store.configs.find((entry) => entry.id === configId)
    if (!config) return null
    const nextConfig = { ...config, lastUsedAt: new Date().toISOString() }
    const configs = [nextConfig, ...store.configs.filter((entry) => entry.id !== configId)]
    persistRemoteConfigStore({ version: 2, activeId: nextConfig.id, configs })
    return nextConfig
}

export function removeRemoteConfig(configId: string): RemoteConfig | null {
    const store = loadRemoteConfigStore()
    const configs = store.configs.filter((config) => config.id !== configId)
    const preferredActiveId = store.activeId === configId ? configs[0]?.id : store.activeId
    const activeId = configs.some((config) => config.id === preferredActiveId) ? preferredActiveId : configs[0]?.id
    persistRemoteConfigStore({ version: 2, activeId, configs })
    return configs.find((config) => config.id === activeId) ?? configs[0] ?? null
}

export function clearRemoteConfig(): void {
    localStorage.removeItem(REMOTE_CONFIG_STORAGE_KEY)
    notifyConfigSaved(null)
}

function isPrivateIpv4(hostname: string): boolean {
    const parts = hostname.split(".").map((part) => Number(part))
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false
    const [a, b] = parts
    return (
        a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
    )
}

function isPrivateIpv6(hostname: string): boolean {
    const host = hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "")
    return host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")
}

function isAllowedCompanionHost(hostname: string): boolean {
    const host = hostname.toLowerCase()
    if (host.includes(":")) return isPrivateIpv6(host)
    return (
        host === "localhost" || isPrivateIpv4(host) || host.endsWith(".local") || host.endsWith(".ts.net") || (!host.includes(".") && /^[a-z0-9-]+$/.test(host))
    )
}

export function buildPairingTarget(baseUrl: string, token: string, hostId?: string): PairingTarget {
    let url: URL
    try {
        url = new URL(baseUrl)
    } catch {
        throw new Error("Pairing URL is invalid")
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Pairing URL must use HTTP or HTTPS")
    if (!isAllowedCompanionHost(url.hostname)) throw new Error(`Refusing to connect to public host ${url.hostname}`)
    if (!token.trim()) throw new Error("Pairing token is required")

    return {
        baseUrl: `${url.protocol}//${url.host}`,
        token: token.trim(),
        host: url.host,
        ...(hostId ? { hostId } : {}),
    }
}

export function parsePairingCode(value: string): PairingTarget {
    const raw = value.trim()
    if (!raw) throw new Error("Pairing QR is empty")

    if (raw.startsWith("{")) {
        const parsed = JSON.parse(raw) as { baseUrl?: string; url?: string; token?: string; hostId?: string }
        return buildPairingTarget(parsed.baseUrl ?? parsed.url ?? "", parsed.token ?? "", parsed.hostId)
    }

    const url = new URL(raw)
    if (url.protocol === "openade:") throw new Error("Deep-link pairing is no longer supported. Scan the HTTP pairing QR.")
    const token = url.searchParams.get("token") ?? ""
    return buildPairingTarget(url.searchParams.get("baseUrl") ?? url.origin, token, url.searchParams.get("hostId") ?? undefined)
}

function runtimeSocketUrl(config: RemoteConfig): string {
    const url = new URL(config.baseUrl)
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
    url.pathname = "/v1/runtime"
    url.search = ""
    return url.toString()
}

function runtimeEntry(config: RemoteConfig, onStatus?: (status: RuntimeClientStatus) => void): { entry: RuntimeClientEntry; removeStatus: () => void } {
    const key = config.id
    const url = runtimeSocketUrl(config)
    let entry = runtimeClients.get(key)
    if (entry && (entry.url !== url || entry.token !== config.token)) {
        entry.client.close()
        runtimeClients.delete(key)
        entry = undefined
    }
    if (!entry) {
        const statusListeners = new Set<(status: RuntimeClientStatus) => void>()
        const runtime = new RuntimeClient({
            url,
            token: config.token,
            clientName: "OpenADE Companion",
            clientPlatform: "mobile",
            protocolVersion: 1,
            reconnect: true,
            onStatus(status) {
                for (const listener of statusListeners) listener(status)
            },
        })
        entry = {
            url,
            token: config.token,
            statusListeners,
            client: runtime,
            openade: new OpenADEClient({
                runtime,
                clientName: "OpenADE Companion",
                clientPlatform: "mobile",
                protocolVersion: 1,
            }),
        }
        runtimeClients.set(key, entry)
    }

    if (!onStatus) return { entry, removeStatus: () => {} }
    entry.statusListeners.add(onStatus)
    return {
        entry,
        removeStatus: () => {
            entry?.statusListeners.delete(onStatus)
        },
    }
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

export function getSnapshot(config: RemoteConfig): Promise<RemoteSnapshot> {
    return runtimeEntry(config).entry.openade.getSnapshot()
}

export function getTask(config: RemoteConfig, repoId: string, taskId: string): Promise<RemoteTask> {
    return runtimeEntry(config).entry.openade.getTask(repoId, taskId)
}

export function startRemoteTurn(config: RemoteConfig, args: RemoteTurnStartRequest): Promise<{ taskId: string }> {
    return runtimeEntry(config).entry.openade.startTurn(args)
}

export function abortRemote(config: RemoteConfig, taskId: string): Promise<void> {
    return runtimeEntry(config).entry.openade.interruptTurn(taskId)
}

export function subscribeRemoteChanges(config: RemoteConfig, onEvent: () => void, onStatus?: (status: RemoteRealtimeConnectionStatus) => void): () => void {
    const { entry, removeStatus } = runtimeEntry(config, onStatus)
    const unsubscribe = entry.openade.subscribeToChanges((notification) => {
        if (notification.method === "connection/lagged") onStatus?.("lagged")
        onEvent()
    })

    return () => {
        unsubscribe()
        removeStatus()
    }
}
