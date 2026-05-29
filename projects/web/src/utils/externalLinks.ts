const EXTERNAL_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:"])
const ABSOLUTE_URL_PATTERN = /^[a-zA-Z][a-zA-Z\d+.-]*:/

export function getExternalUrlToOpen(href: string | null | undefined): string | null {
    const value = href?.trim()
    if (!value || !ABSOLUTE_URL_PATTERN.test(value)) return null

    try {
        const url = new URL(value)
        if (!EXTERNAL_LINK_PROTOCOLS.has(url.protocol)) return null
        return url.href
    } catch {
        return null
    }
}
