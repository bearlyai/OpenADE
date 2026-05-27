import type { OpenADEProject, OpenADESnapshot, OpenADETask, OpenADETaskPreview, OpenADETurnStartRequest } from "../../../openade-module/src/types"

export type RemotePlatform = "ios" | "android" | "web" | "unknown"
export type KeepAwakeMode = "off" | "while_tasks_running" | "while_companion_enabled"

export type RemoteTurnStartRequest = OpenADETurnStartRequest

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

export type RemoteTaskPreview = OpenADETaskPreview
export type RemoteRepo = OpenADEProject
export type RemoteSnapshot = OpenADESnapshot
export type RemoteTask = OpenADETask

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
    | { type: "task_changed"; repoId: string; taskId: string; at: string }
    | { type: "working_tasks"; taskIds: string[]; at: string }
    | { type: "devices_changed"; at: string }
