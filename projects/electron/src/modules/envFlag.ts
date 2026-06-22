export function envFlag(value: string | undefined, fallback = false): boolean {
    if (!value) return fallback
    const normalized = value.trim().toLowerCase()
    if (!normalized) return fallback
    return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on"
}
