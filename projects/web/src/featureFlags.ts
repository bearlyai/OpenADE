function enabledFlag(value: string | boolean | undefined): boolean {
    if (typeof value === "boolean") return value
    if (!value) return false
    return ["1", "true", "yes", "on"].includes(value.toLowerCase())
}

export const isCompanionFeatureEnabled = enabledFlag(import.meta.env.VITE_OPENADE_ENABLE_COMPANION)
