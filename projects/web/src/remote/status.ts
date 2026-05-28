import type { RemoteRealtimeConnectionStatus } from "./client"

export type RemoteStatusTone = "ok" | "warn" | "bad" | "muted"
export const REMOTE_STATUS_GRACE_MS = 1200

export function statusCopy(status: RemoteRealtimeConnectionStatus): { label: string; tone: RemoteStatusTone } {
    switch (status) {
        case "connected":
            return { label: "Online", tone: "ok" }
        case "connecting":
            return { label: "Connecting", tone: "muted" }
        case "reconnecting":
            return { label: "Reconnecting", tone: "warn" }
        case "lagged":
            return { label: "Lagged", tone: "warn" }
        case "disconnected":
            return { label: "Offline", tone: "bad" }
    }
}

export function isRemoteRealtimeOnline(status: RemoteRealtimeConnectionStatus): boolean {
    return status === "connected" || status === "lagged"
}

export function shouldDelayRemoteStatusDisplay(current: RemoteRealtimeConnectionStatus, next: RemoteRealtimeConnectionStatus): boolean {
    return isRemoteRealtimeOnline(current) && !isRemoteRealtimeOnline(next)
}
