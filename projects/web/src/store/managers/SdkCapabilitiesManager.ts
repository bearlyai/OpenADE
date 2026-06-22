/**
 * SdkCapabilitiesManager
 *
 * Manages SDK-discovered capabilities (slash commands, skills, plugins)
 * for the current workspace. Fetches from the Electron-side cache which
 * is populated from system:init messages during normal queries and
 * can run a lightweight probe on first access.
 */

import { makeAutoObservable, runInAction } from "mobx"
import { type SdkCapabilities, getSdkCapabilities } from "../../electronAPI/capabilities"

export interface SlashCommandEntry {
    name: string
    type: "slash_command" | "skill"
}

export type SdkCapabilitiesLoader = (cwd: string) => Promise<SdkCapabilities | null>

const SDK_CAPABILITIES_CACHE_TTL_MS = 60_000

interface CachedSdkCapabilitiesLoad {
    expiresAt: number
    result: SdkCapabilities | null
}

interface SdkCapabilitiesLoaderCache {
    results: Map<string, CachedSdkCapabilitiesLoad>
    inFlight: Map<string, Promise<SdkCapabilities | null>>
}

let loaderCaches = new WeakMap<SdkCapabilitiesLoader, SdkCapabilitiesLoaderCache>()

export function resetSdkCapabilitiesManagerCacheForTests(): void {
    loaderCaches = new WeakMap()
}

function cacheForLoader(loader: SdkCapabilitiesLoader): SdkCapabilitiesLoaderCache {
    let cache = loaderCaches.get(loader)
    if (!cache) {
        cache = {
            results: new Map(),
            inFlight: new Map(),
        }
        loaderCaches.set(loader, cache)
    }
    return cache
}

function cloneSdkCapabilities(data: SdkCapabilities | null): SdkCapabilities | null {
    if (!data) return null
    return {
        slash_commands: [...data.slash_commands],
        skills: [...data.skills],
        plugins: data.plugins.map((plugin) => ({ ...plugin })),
        cachedAt: data.cachedAt,
    }
}

async function loadCachedSdkCapabilities(loader: SdkCapabilitiesLoader, cwd: string): Promise<SdkCapabilities | null> {
    const cache = cacheForLoader(loader)
    const cached = cache.results.get(cwd)
    if (cached && cached.expiresAt > Date.now()) return cloneSdkCapabilities(cached.result)

    const inFlight = cache.inFlight.get(cwd)
    if (inFlight) return cloneSdkCapabilities(await inFlight)

    const request = loader(cwd)
        .then((result) => {
            cache.results.set(cwd, {
                result: cloneSdkCapabilities(result),
                expiresAt: Date.now() + SDK_CAPABILITIES_CACHE_TTL_MS,
            })
            return result
        })
        .finally(() => {
            if (cache.inFlight.get(cwd) === request) cache.inFlight.delete(cwd)
        })
    cache.inFlight.set(cwd, request)
    return cloneSdkCapabilities(await request)
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null
}

function stringArrayFromUnknown(value: unknown): string[] {
    if (!Array.isArray(value)) return []
    return value.filter((entry) => typeof entry === "string")
}

function pluginArrayFromUnknown(value: unknown): SdkCapabilities["plugins"] {
    if (!Array.isArray(value)) return []
    const plugins: SdkCapabilities["plugins"] = []
    for (const entry of value) {
        if (!isRecord(entry)) continue
        if (typeof entry.name !== "string" || typeof entry.path !== "string") continue
        plugins.push({ name: entry.name, path: entry.path })
    }
    return plugins
}

function sdkCapabilitiesFromInitMessage(msg: Record<string, unknown>): SdkCapabilities {
    return {
        slash_commands: stringArrayFromUnknown(msg.slash_commands),
        skills: stringArrayFromUnknown(msg.skills),
        plugins: pluginArrayFromUnknown(msg.plugins),
        cachedAt: Date.now(),
    }
}

export class SdkCapabilitiesManager {
    slashCommands: string[] = []
    skills: string[] = []
    plugins: { name: string; path: string }[] = []
    loading = false
    loaded = false
    loadedForCwd: string | null = null
    private loadingForCwd: string | null = null
    private loadRequestId = 0
    private readonly loadSdkCapabilities: SdkCapabilitiesLoader

    constructor(loadSdkCapabilities: SdkCapabilitiesLoader = getSdkCapabilities) {
        this.loadSdkCapabilities = loadSdkCapabilities
        makeAutoObservable<SdkCapabilitiesManager, "loadingForCwd" | "loadRequestId" | "loadSdkCapabilities">(this, {
            loadingForCwd: false,
            loadRequestId: false,
            loadSdkCapabilities: false,
        })
    }

    /**
     * Load capabilities for a working directory.
     * Returns cached data instantly if available, or runs a probe (~1.4s).
     */
    async loadCapabilities(cwd: string): Promise<void> {
        if (this.loadedForCwd === cwd) return
        if (this.loading && this.loadingForCwd === cwd) return

        const requestId = this.loadRequestId + 1
        runInAction(() => {
            this.loadRequestId = requestId
            this.loading = true
            this.loadingForCwd = cwd
        })

        try {
            const result = await loadCachedSdkCapabilities(this.loadSdkCapabilities, cwd)
            runInAction(() => {
                if (this.loadRequestId !== requestId) return
                if (result) this.applyCapabilities(result)
                this.loadedForCwd = cwd
            })
        } catch (err) {
            console.error("[SdkCapabilitiesManager] Failed to load capabilities:", err)
        } finally {
            runInAction(() => {
                if (this.loadRequestId !== requestId) return
                this.loading = false
                this.loaded = true
                this.loadingForCwd = null
            })
        }
    }

    /**
     * Update capabilities directly from a system:init SDK message.
     * Called during streaming to keep the store fresh without an extra IPC call.
     */
    updateFromInitMessage(msg: Record<string, unknown>): void {
        this.applyCapabilities(sdkCapabilitiesFromInitMessage(msg))
    }

    private applyCapabilities(data: SdkCapabilities): void {
        runInAction(() => {
            this.slashCommands = [...data.slash_commands]
            this.skills = [...data.skills]
            this.plugins = data.plugins.map((plugin) => ({ ...plugin }))
        })
    }

    /**
     * Unified list of all available commands for the autocomplete menu.
     * Skills come first, then built-in slash commands.
     */
    get allCommands(): SlashCommandEntry[] {
        const entries: SlashCommandEntry[] = []
        for (const name of this.skills) {
            entries.push({ name, type: "skill" })
        }
        for (const name of this.slashCommands) {
            // Avoid duplicates if a skill and slash_command share the same name
            if (!this.skills.includes(name)) {
                entries.push({ name, type: "slash_command" })
            }
        }
        return entries
    }
}
