import os from "node:os"

export interface BindAddress {
    host: string
    label: string
}

function isTailscaleAddress(address: string): boolean {
    const parts = address.split(".").map((part) => Number(part))
    if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) return false
    const [first, second] = parts
    return first === 100 && second >= 64 && second <= 127
}

export function getCompanionBindAddresses(): BindAddress[] {
    const addresses: BindAddress[] = [{ host: "127.0.0.1", label: "Loopback" }]
    const interfaces = os.networkInterfaces()

    for (const [name, entries] of Object.entries(interfaces)) {
        for (const entry of entries ?? []) {
            if (entry.family !== "IPv4" || entry.internal) continue
            if (!isTailscaleAddress(entry.address)) continue
            addresses.push({ host: entry.address, label: name })
        }
    }

    return addresses
}

export function getPublicBaseUrl(port: number, boundUrls: string[]): string {
    const tailscaleUrl = boundUrls.find((url) => url.includes("://100."))
    return tailscaleUrl ?? `http://127.0.0.1:${port}`
}
