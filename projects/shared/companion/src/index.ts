export type RemotePlatform = "ios" | "android" | "web" | "unknown"
export type KeepAwakeMode = "off" | "while_tasks_running" | "while_companion_enabled"

export interface PairRequest {
    token: string
    deviceName: string
    platform: RemotePlatform
}

export interface RemoteDevice {
    id: string
    name: string
    platform: RemotePlatform
    pairedAt: string
    lastSeenAt?: string
    revokedAt?: string
}

export interface RemoteDeviceListResult {
    devices: RemoteDevice[]
}

export interface RemoteDeviceRevokeRequest {
    deviceId: string
}

export interface RemoteDeviceRevokeResult {
    ok: true
    revoked: boolean
    devices: RemoteDevice[]
}

export interface RemoteDeviceDropAllResult {
    ok: true
    devices: RemoteDevice[]
}

export interface RemoteDeviceSelfRevokeResult {
    ok: true
    revoked: boolean
}

export interface PairingPayload {
    url: string
    token: string
    hostId: string
    expiresAt: string
}

export interface CompanionState {
    enabled: boolean
    port: number
    boundUrls: string[]
    keepAwakeMode: KeepAwakeMode
    pairing?: PairingPayload
    devices: RemoteDevice[]
}

export type CompanionEvent =
    | { type: "snapshot_changed"; at: string }
    | { type: "task_changed"; repoId: string; taskId: string; previewChanged?: boolean; at: string }
    | { type: "working_tasks"; taskIds: string[]; at: string }
    | { type: "devices_changed"; at: string }
