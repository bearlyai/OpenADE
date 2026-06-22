/**
 * PersonalSettingsStore Bootstrap
 *
 * Handles connection setup for PersonalSettingsStore using the local storage driver.
 */

import { action, makeObservable, observable, runInAction } from "mobx"
import type { OpenADEPersonalSettingsReplaceRequest } from "../../../openade-module/src"
import { type PersonalSettingsStore, createPersonalSettingsStore } from "./personalSettingsStore"
import { getStorageDriver, type YObjectHandle } from "./storage"

// ============================================================================
// Connection
// ============================================================================

export interface PersonalSettingsStoreConnection {
    store: PersonalSettingsStore
    sync: () => Promise<void>
    disconnect: () => void
}

export interface ProductPersonalSettingsAccess {
    readPersonalSettings(): Promise<{ settings: PersonalSettingsStore["settings"]["current"] }>
    replacePersonalSettings(params: OpenADEPersonalSettingsReplaceRequest): Promise<{ settings: PersonalSettingsStore["settings"]["current"] }>
    canReadPersonalSettings?(): boolean
    canReplacePersonalSettings?(): boolean
}

const DEFAULT_PERSONAL_SETTINGS: PersonalSettingsStore["settings"]["current"] = {
    envVars: {},
    theme: "system",
    renderMarkdownMessages: true,
}

function normalizeSettings(settings: PersonalSettingsStore["settings"]["current"] | undefined): PersonalSettingsStore["settings"]["current"] {
    return {
        ...DEFAULT_PERSONAL_SETTINGS,
        ...(settings ?? {}),
        envVars: settings?.envVars ?? {},
        theme: settings?.theme ?? "system",
        renderMarkdownMessages: settings?.renderMarkdownMessages ?? true,
    }
}

function cloneSettings(settings: PersonalSettingsStore["settings"]["current"]): PersonalSettingsStore["settings"]["current"] {
    return structuredClone(settings)
}

function createProductSettingsHandle(
    initial: PersonalSettingsStore["settings"]["current"],
    persist: (settings: PersonalSettingsStore["settings"]["current"]) => void
): YObjectHandle<PersonalSettingsStore["settings"]["current"]> {
    const subscribers = new Set<() => void>()
    const handle: YObjectHandle<PersonalSettingsStore["settings"]["current"]> = {
        current: normalizeSettings(initial),
        get() {
            return this.current
        },
        set(partial) {
            const next = normalizeSettings({ ...this.current, ...partial })
            this.current = next
            for (const callback of subscribers) callback()
            persist(cloneSettings(next))
        },
        update(recipe) {
            const draft = cloneSettings(this.current)
            recipe(draft)
            const next = normalizeSettings(draft)
            this.current = next
            for (const callback of subscribers) callback()
            persist(cloneSettings(next))
        },
        subscribe(callback) {
            subscribers.add(callback)
            return () => {
                subscribers.delete(callback)
            }
        },
    }

    makeObservable(handle, {
        current: observable.ref,
        set: action,
        update: action,
    })

    return handle
}

/**
 * Connects to the PersonalSettingsStore using local storage.
 */
export async function connectPersonalSettingsStore(): Promise<PersonalSettingsStoreConnection> {
    const storage = getStorageDriver()
    const { doc, sync, disconnect } = await storage.getYDoc("code:personal_settings")

    const store = createPersonalSettingsStore(doc)

    return {
        store,
        sync,
        disconnect,
    }
}

export async function connectProductPersonalSettingsStore(access: ProductPersonalSettingsAccess): Promise<PersonalSettingsStoreConnection> {
    let disconnected = false
    let persistQueue: Promise<void> = Promise.resolve()
    const readResult = access.canReadPersonalSettings?.() === false ? { settings: DEFAULT_PERSONAL_SETTINGS } : await access.readPersonalSettings()
    let initialReadFresh = true
    const handle = createProductSettingsHandle(normalizeSettings(readResult.settings), (settings) => {
        if (disconnected) return
        if (access.canReplacePersonalSettings?.() === false) return
        persistQueue = persistQueue
            .then(async () => {
                if (disconnected) return
                if (access.canReplacePersonalSettings?.() === false) return
                const result = await access.replacePersonalSettings({ settings })
                runInAction(() => {
                    if (!disconnected) handle.current = normalizeSettings(result.settings)
                })
            })
            .catch((err) => {
                console.error("[PersonalSettingsStore] Runtime settings persist failed:", err)
            })
    })

    return {
        store: { settings: handle },
        sync: async () => {
            if (access.canReadPersonalSettings?.() === false) return
            if (initialReadFresh) {
                initialReadFresh = false
                return
            }
            const result = await access.readPersonalSettings()
            runInAction(() => {
                if (!disconnected) handle.current = normalizeSettings(result.settings)
            })
        },
        disconnect: () => {
            disconnected = true
        },
    }
}
