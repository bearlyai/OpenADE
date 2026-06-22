function enabledFlag(value: string | boolean | undefined, fallback = false): boolean {
    if (typeof value === "boolean") return value
    if (!value) return fallback
    return ["1", "true", "yes", "on"].includes(value.toLowerCase())
}

export const isCompanionFeatureEnabled = enabledFlag(import.meta.env.VITE_OPENADE_ENABLE_COMPANION, import.meta.env.DEV)
export const isRuntimeBackedProductStoreEnabled = enabledFlag(import.meta.env.VITE_OPENADE_ENABLE_RUNTIME_PRODUCT_STORE, true)
export const areDesktopFallbackChunksEnabled = import.meta.env.VITE_OPENADE_ENABLE_DESKTOP_FALLBACK_CHUNKS !== "false"
