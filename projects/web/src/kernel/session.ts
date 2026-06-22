import {
    OpenADEClient,
    type OpenADEClientOptions,
    type OpenADERemoteMethod,
    type OpenADERemoteRequestForMethod,
    type OpenADERemoteResponseForMethod,
} from "../../../openade-client/src"
import { RuntimeClient, type RuntimeClientOptions, type RuntimeClientStatus } from "../../../runtime-client/src"

export interface PairingTarget {
    baseUrl: string
    token: string
    host: string
    hostId?: string
}

export interface KernelSessionConfig {
    id: string
    baseUrl: string
    token: string
    host: string
    hostId?: string
    savedAt: string
    lastUsedAt: string
}

export type KernelRealtimeConnectionStatus = RuntimeClientStatus | "lagged"
export type KernelRuntimeClientLike = OpenADEClientOptions["runtime"]

export interface KernelSessionConstructors<TRuntime extends KernelRuntimeClientLike, TOpenADE> {
    RuntimeClient: new (options: RuntimeClientOptions) => TRuntime
    OpenADEClient: new (options: OpenADEClientOptions) => TOpenADE
}

export interface KernelSessionDefaults {
    clientName: string
    clientPlatform: RuntimeClientOptions["clientPlatform"]
    protocolVersion?: number
    reconnect?: boolean
}

export interface KernelSessionEntry<TRuntime extends KernelRuntimeClientLike, TOpenADE> {
    runtime: TRuntime
    openade: TOpenADE
    status?: KernelRealtimeConnectionStatus
    url: string
    token: string
}

export function kernelSessionHasMethod(entry: Pick<KernelSessionEntry<KernelRuntimeClientLike, unknown>, "runtime">, method: string): boolean {
    return entry.runtime.hasMethod(method)
}

type KernelRemoteRequestArgs<Method extends OpenADERemoteMethod> = undefined extends OpenADERemoteRequestForMethod<Method>
    ? [params?: OpenADERemoteRequestForMethod<Method>]
    : [params: OpenADERemoteRequestForMethod<Method>]

export async function requestKernelRemoteMethod<Method extends OpenADERemoteMethod>(
    runtime: Pick<KernelRuntimeClientLike, "request" | "connect" | "capabilities">,
    method: Method,
    ...args: KernelRemoteRequestArgs<Method>
): Promise<OpenADERemoteResponseForMethod<Method>> {
    if (!runtime.capabilities) await runtime.connect()
    if (!runtime.capabilities) throw new Error(`Kernel runtime capabilities unavailable for method: ${method}`)
    if (!runtime.capabilities.methods.includes(method)) {
        throw new Error(`Kernel runtime method unavailable: ${method}`)
    }
    return runtime.request(method, ...args)
}

export interface KernelLocalSession {
    runtime: KernelRuntimeClientLike
    openade: OpenADEClient
}

interface MutableKernelSessionEntry<TRuntime extends KernelRuntimeClientLike, TOpenADE> extends KernelSessionEntry<TRuntime, TOpenADE> {
    statusListeners: Set<(status: KernelRealtimeConnectionStatus) => void>
}

export const defaultKernelSessionConstructors: KernelSessionConstructors<RuntimeClient, OpenADEClient> = {
    RuntimeClient,
    OpenADEClient,
}

export function createKernelSessionFromRuntime(runtime: KernelRuntimeClientLike, defaults: Omit<KernelSessionDefaults, "reconnect">): KernelLocalSession {
    return {
        runtime,
        openade: new OpenADEClient({
            runtime,
            clientName: defaults.clientName,
            clientPlatform: defaults.clientPlatform,
            protocolVersion: defaults.protocolVersion ?? 1,
        }),
    }
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

function isAllowedKernelHost(hostname: string): boolean {
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
    if (!isAllowedKernelHost(url.hostname)) throw new Error(`Refusing to connect to public host ${url.hostname}`)
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

export function runtimeSocketUrl(config: Pick<KernelSessionConfig, "baseUrl">): string {
    const url = new URL(config.baseUrl)
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
    url.pathname = "/v1/runtime"
    url.search = ""
    return url.toString()
}

function notifyEntryStatus<TRuntime extends KernelRuntimeClientLike, TOpenADE>(
    entry: MutableKernelSessionEntry<TRuntime, TOpenADE>,
    status: KernelRealtimeConnectionStatus
): void {
    entry.status = status
    for (const listener of entry.statusListeners) listener(status)
}

export class KernelSessionManager<TRuntime extends KernelRuntimeClientLike = RuntimeClient, TOpenADE = OpenADEClient> {
    private readonly sessions = new Map<string, MutableKernelSessionEntry<TRuntime, TOpenADE>>()

    constructor(
        private readonly constructors: KernelSessionConstructors<TRuntime, TOpenADE>,
        private readonly defaults: KernelSessionDefaults
    ) {}

    clear(): void {
        for (const entry of this.sessions.values()) {
            entry.runtime.close()
        }
        this.sessions.clear()
    }

    session(
        config: KernelSessionConfig,
        onStatus?: (status: KernelRealtimeConnectionStatus) => void
    ): { entry: KernelSessionEntry<TRuntime, TOpenADE>; removeStatus: () => void } {
        const key = config.id
        const url = runtimeSocketUrl(config)
        let entry = this.sessions.get(key)
        if (entry && (entry.url !== url || entry.token !== config.token)) {
            entry.runtime.close()
            this.sessions.delete(key)
            entry = undefined
        }
        if (!entry) {
            const statusListeners = new Set<(status: KernelRealtimeConnectionStatus) => void>()
            let createdEntry: MutableKernelSessionEntry<TRuntime, TOpenADE> | null = null
            const runtime = new this.constructors.RuntimeClient({
                url,
                token: config.token,
                clientName: this.defaults.clientName,
                clientPlatform: this.defaults.clientPlatform,
                protocolVersion: this.defaults.protocolVersion ?? 1,
                reconnect: this.defaults.reconnect ?? true,
                onStatus(status) {
                    if (createdEntry) notifyEntryStatus(createdEntry, status)
                },
            })
            entry = {
                url,
                token: config.token,
                statusListeners,
                runtime,
                openade: new this.constructors.OpenADEClient({
                    runtime,
                    clientName: this.defaults.clientName,
                    clientPlatform: this.defaults.clientPlatform,
                    protocolVersion: this.defaults.protocolVersion ?? 1,
                }),
            }
            createdEntry = entry
            this.sessions.set(key, entry)
        }

        if (!onStatus) return { entry, removeStatus: () => {} }
        entry.statusListeners.add(onStatus)
        if (entry.status) {
            const currentStatus = entry.status
            queueMicrotask(() => {
                if (entry?.statusListeners.has(onStatus)) onStatus(currentStatus)
            })
        }
        return {
            entry,
            removeStatus: () => {
                entry?.statusListeners.delete(onStatus)
            },
        }
    }
}
