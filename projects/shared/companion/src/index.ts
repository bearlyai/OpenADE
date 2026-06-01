import type {
    OpenADEProject,
    OpenADEQueuedTurn,
    OpenADEProjectFileReadRequest,
    OpenADEProjectFileReadResult,
    OpenADEProjectFilesTreeRequest,
    OpenADEProjectFilesTreeResult,
    OpenADEProjectProcessListRequest,
    OpenADEProjectProcessListResult,
    OpenADEProjectProcessReconnectRequest,
    OpenADEProjectProcessReconnectResult,
    OpenADEProjectProcessStartRequest,
    OpenADEProjectProcessStartResult,
    OpenADEProjectProcessStopRequest,
    OpenADEProjectProcessStopResult,
    OpenADEProjectSearchRequest,
    OpenADEProjectSearchResult,
    OpenADESnapshot,
    OpenADETask,
    OpenADETaskChangesReadRequest,
    OpenADETaskChangesReadResult,
    OpenADETaskDiffReadRequest,
    OpenADETaskDiffReadResult,
    OpenADETaskGitCommitRequest,
    OpenADETaskGitCommitResult,
    OpenADETaskGitLogRequest,
    OpenADETaskGitLogResult,
    OpenADETaskImageReadRequest,
    OpenADETaskImageReadResult,
    OpenADETaskTerminalMutationResult,
    OpenADETaskTerminalReconnectRequest,
    OpenADETaskTerminalReconnectResult,
    OpenADETaskTerminalResizeRequest,
    OpenADETaskTerminalStartRequest,
    OpenADETaskTerminalStartResult,
    OpenADETaskTerminalStopRequest,
    OpenADETaskTerminalWriteRequest,
    OpenADETaskSnapshotIndexReadRequest,
    OpenADETaskSnapshotIndexReadResult,
    OpenADETaskSnapshotPatchReadRequest,
    OpenADETaskSnapshotPatchReadResult,
    OpenADETaskSnapshotPatchSliceReadRequest,
    OpenADETaskSnapshotPatchSliceReadResult,
    OpenADETaskPreview,
    OpenADETurnStartRequest,
    OpenADETurnStartResult,
} from "../../../openade-module/src/types"

export type RemotePlatform = "ios" | "android" | "web" | "unknown"
export type KeepAwakeMode = "off" | "while_tasks_running" | "while_companion_enabled"

export type RemoteTurnStartRequest = OpenADETurnStartRequest
export type RemoteTurnStartResult = OpenADETurnStartResult
export type RemoteQueuedTurn = OpenADEQueuedTurn
export type RemoteProjectFilesTreeRequest = OpenADEProjectFilesTreeRequest
export type RemoteProjectFilesTreeResult = OpenADEProjectFilesTreeResult
export type RemoteProjectFileReadRequest = OpenADEProjectFileReadRequest
export type RemoteProjectFileReadResult = OpenADEProjectFileReadResult
export type RemoteProjectSearchRequest = OpenADEProjectSearchRequest
export type RemoteProjectSearchResult = OpenADEProjectSearchResult
export type RemoteProjectProcessListRequest = OpenADEProjectProcessListRequest
export type RemoteProjectProcessListResult = OpenADEProjectProcessListResult
export type RemoteProjectProcessStartRequest = OpenADEProjectProcessStartRequest
export type RemoteProjectProcessStartResult = OpenADEProjectProcessStartResult
export type RemoteProjectProcessReconnectRequest = OpenADEProjectProcessReconnectRequest
export type RemoteProjectProcessReconnectResult = OpenADEProjectProcessReconnectResult
export type RemoteProjectProcessStopRequest = OpenADEProjectProcessStopRequest
export type RemoteProjectProcessStopResult = OpenADEProjectProcessStopResult
export type RemoteTaskChangesReadRequest = OpenADETaskChangesReadRequest
export type RemoteTaskChangesReadResult = OpenADETaskChangesReadResult
export type RemoteTaskDiffReadRequest = OpenADETaskDiffReadRequest
export type RemoteTaskDiffReadResult = OpenADETaskDiffReadResult
export type RemoteTaskGitCommitRequest = OpenADETaskGitCommitRequest
export type RemoteTaskGitCommitResult = OpenADETaskGitCommitResult
export type RemoteTaskGitLogRequest = OpenADETaskGitLogRequest
export type RemoteTaskGitLogResult = OpenADETaskGitLogResult
export type RemoteTaskTerminalStartRequest = OpenADETaskTerminalStartRequest
export type RemoteTaskTerminalStartResult = OpenADETaskTerminalStartResult
export type RemoteTaskTerminalReconnectRequest = OpenADETaskTerminalReconnectRequest
export type RemoteTaskTerminalReconnectResult = OpenADETaskTerminalReconnectResult
export type RemoteTaskTerminalWriteRequest = OpenADETaskTerminalWriteRequest
export type RemoteTaskTerminalResizeRequest = OpenADETaskTerminalResizeRequest
export type RemoteTaskTerminalStopRequest = OpenADETaskTerminalStopRequest
export type RemoteTaskTerminalMutationResult = OpenADETaskTerminalMutationResult
export type RemoteTaskImageReadRequest = OpenADETaskImageReadRequest
export type RemoteTaskImageReadResult = OpenADETaskImageReadResult
export type RemoteTaskSnapshotPatchReadRequest = OpenADETaskSnapshotPatchReadRequest
export type RemoteTaskSnapshotPatchReadResult = OpenADETaskSnapshotPatchReadResult
export type RemoteTaskSnapshotIndexReadRequest = OpenADETaskSnapshotIndexReadRequest
export type RemoteTaskSnapshotIndexReadResult = OpenADETaskSnapshotIndexReadResult
export type RemoteTaskSnapshotPatchSliceReadRequest = OpenADETaskSnapshotPatchSliceReadRequest
export type RemoteTaskSnapshotPatchSliceReadResult = OpenADETaskSnapshotPatchSliceReadResult

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
    | { type: "task_changed"; repoId: string; taskId: string; previewChanged?: boolean; at: string }
    | { type: "working_tasks"; taskIds: string[]; at: string }
    | { type: "devices_changed"; at: string }
