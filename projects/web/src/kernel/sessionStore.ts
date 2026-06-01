import { buildPairingTarget, type KernelSessionConfig } from "./session"

export interface KernelSessionConfigStoreData {
    version: 2
    activeId?: string
    configs: KernelSessionConfig[]
}

export type KernelSessionConfigInput = Pick<KernelSessionConfig, "baseUrl" | "token"> & Partial<Omit<KernelSessionConfig, "baseUrl" | "token">>

export interface KernelSessionConfigStorage {
    getItem(key: string): string | null
    setItem(key: string, value: string): void
    removeItem(key: string): void
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
    const value = record[key]
    return typeof value === "string" ? value : undefined
}

function kernelSessionConfigId(baseUrl: string, hostId?: string): string {
    if (hostId) return hostId
    return buildPairingTarget(baseUrl, "token").baseUrl
}

export function normalizeKernelSessionConfig(config: KernelSessionConfigInput, now = new Date().toISOString()): KernelSessionConfig {
    const target = buildPairingTarget(config.baseUrl, config.token)
    return {
        id: config.id ?? kernelSessionConfigId(target.baseUrl, config.hostId),
        baseUrl: target.baseUrl,
        token: target.token,
        host: config.host ?? target.host,
        hostId: config.hostId,
        savedAt: config.savedAt ?? now,
        lastUsedAt: config.lastUsedAt ?? now,
    }
}

function inputFromRecord(record: Record<string, unknown>): KernelSessionConfigInput | null {
    const baseUrl = optionalString(record, "baseUrl")
    const token = optionalString(record, "token")
    if (!baseUrl || !token) return null
    return {
        baseUrl,
        token,
        id: optionalString(record, "id"),
        host: optionalString(record, "host"),
        hostId: optionalString(record, "hostId"),
        savedAt: optionalString(record, "savedAt"),
        lastUsedAt: optionalString(record, "lastUsedAt"),
    }
}

function normalizeRecord(record: Record<string, unknown>): KernelSessionConfig | null {
    const input = inputFromRecord(record)
    if (!input) return null
    try {
        return normalizeKernelSessionConfig(input)
    } catch {
        return null
    }
}

export function parseKernelSessionConfigStore(raw: string | null): KernelSessionConfigStoreData {
    if (!raw) return { version: 2, configs: [] }

    try {
        const parsed: unknown = JSON.parse(raw)
        if (!isRecord(parsed)) return { version: 2, configs: [] }

        const configsValue = parsed.configs
        if (Array.isArray(configsValue)) {
            const configs = configsValue
                .map((value) => (isRecord(value) ? normalizeRecord(value) : null))
                .filter((config): config is KernelSessionConfig => config !== null && Boolean(config.token))
            const parsedActiveId = optionalString(parsed, "activeId")
            const activeId = configs.some((config) => config.id === parsedActiveId) ? parsedActiveId : configs[0]?.id
            return { version: 2, activeId, configs }
        }

        const legacyInput = inputFromRecord(parsed)
        if (!legacyInput) return { version: 2, configs: [] }
        const config = normalizeKernelSessionConfig(legacyInput)
        return { version: 2, activeId: config.id, configs: [config] }
    } catch {
        return { version: 2, configs: [] }
    }
}

export class KernelSessionConfigStore {
    constructor(
        private readonly options: {
            storage: KernelSessionConfigStorage
            storageKey: string
            onChange?: (value: string | null) => void
        }
    ) {}

    loadStore(): KernelSessionConfigStoreData {
        return parseKernelSessionConfigStore(this.options.storage.getItem(this.options.storageKey))
    }

    loadConfigs(): KernelSessionConfig[] {
        return this.loadStore().configs
    }

    loadActive(): KernelSessionConfig | null {
        const store = this.loadStore()
        return store.configs.find((config) => config.id === store.activeId) ?? store.configs[0] ?? null
    }

    save(config: KernelSessionConfigInput): KernelSessionConfig {
        const store = this.loadStore()
        const nextConfig = normalizeKernelSessionConfig({ ...config, lastUsedAt: new Date().toISOString() })
        const configs = [nextConfig, ...store.configs.filter((existing) => existing.id !== nextConfig.id)]
        this.persist({ version: 2, activeId: nextConfig.id, configs })
        return nextConfig
    }

    activate(configId: string): KernelSessionConfig | null {
        const store = this.loadStore()
        const config = store.configs.find((entry) => entry.id === configId)
        if (!config) return null
        const nextConfig = { ...config, lastUsedAt: new Date().toISOString() }
        const configs = [nextConfig, ...store.configs.filter((entry) => entry.id !== configId)]
        this.persist({ version: 2, activeId: nextConfig.id, configs })
        return nextConfig
    }

    remove(configId: string): KernelSessionConfig | null {
        const store = this.loadStore()
        const configs = store.configs.filter((config) => config.id !== configId)
        const preferredActiveId = store.activeId === configId ? configs[0]?.id : store.activeId
        const activeId = configs.some((config) => config.id === preferredActiveId) ? preferredActiveId : configs[0]?.id
        this.persist({ version: 2, activeId, configs })
        return configs.find((config) => config.id === activeId) ?? configs[0] ?? null
    }

    clear(): void {
        this.options.storage.removeItem(this.options.storageKey)
        this.options.onChange?.(null)
    }

    private persist(store: KernelSessionConfigStoreData): void {
        const value = JSON.stringify(store)
        this.options.storage.setItem(this.options.storageKey, value)
        this.options.onChange?.(value)
    }
}
