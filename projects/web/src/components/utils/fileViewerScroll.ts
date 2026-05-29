export function scrollFileViewerToLine(container: HTMLElement | null, lineNumber: number): boolean {
    if (!container || !Number.isInteger(lineNumber) || lineNumber < 1) return false

    const selector = `[data-line="${lineNumber}"]`
    for (const host of Array.from(container.querySelectorAll("*"))) {
        const lineEl = host.shadowRoot?.querySelector(selector)
        if (lineEl) {
            lineEl.scrollIntoView({ block: "center", behavior: "instant" })
            return true
        }
    }

    return false
}
