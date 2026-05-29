function enabledFlag(value: string | boolean | undefined, fallback = false): boolean {
    if (typeof value === "boolean") return value
    if (!value) return fallback
    return ["1", "true", "yes", "on"].includes(value.toLowerCase())
}

export const isCompanionFeatureEnabled = enabledFlag(import.meta.env.VITE_OPENADE_ENABLE_COMPANION, import.meta.env.DEV)
