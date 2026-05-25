export type RemotePlatform = "ios" | "android" | "web" | "unknown"
export type KeepAwakeMode = "off" | "while_tasks_running" | "while_companion_enabled"

export interface RemoteRunRequest {
    repoId: string
    type: "plan" | "do" | "ask" | "hyperplan"
    input: string
    appendSystemPrompt?: string
    inTaskId?: string | null
    isolationStrategy?: { type: "head" } | { type: "worktree"; sourceBranch: string }
    enabledMcpServerIds?: string[]
    harnessId?: string
    thinking?: "low" | "med" | "high" | "max"
    fastMode?: boolean
    title?: string
}

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

export interface RemoteTaskPreview {
    id: string
    slug: string
    title: string
    closed?: boolean
    createdAt: string
    lastEvent?: {
        type: "action" | "setup_environment" | "snapshot"
        status: "in_progress" | "completed" | "error" | "stopped"
        sourceType?: "plan" | "revise" | "run_plan" | "do" | "ask" | "hyperplan" | "review"
        sourceLabel: string
        at: string
    }
    lastViewedAt?: string
    lastEventAt?: string
}

export interface RemoteRepo {
    id: string
    name: string
    path: string
    archived?: boolean
    tasks: RemoteTaskPreview[]
}

export interface RemoteSnapshot {
    server: {
        version: string
        hostName: string
        theme: {
            setting: string
            className: string
            label?: string
        }
    }
    repos: RemoteRepo[]
    workingTaskIds: string[]
}

export interface RemoteTask {
    id: string
    repoId: string
    slug: string
    title: string
    description: string
    closed?: boolean
    unavailableReason?: string
    events: unknown[]
    comments: unknown[]
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

export type CompanionRequest =
    | { id: string; method: "getSnapshot"; params?: undefined }
    | { id: string; method: "getTask"; params: { repoId: string; taskId: string } }
    | { id: string; method: "run"; params: RemoteRunRequest }
    | { id: string; method: "abort"; params: { taskId: string } }

export type CompanionResponse =
    | { id: string; ok: true; result: unknown }
    | { id: string; ok: false; error: string }

export type CompanionEvent =
    | { type: "snapshot_changed"; at: string }
    | { type: "task_changed"; repoId: string; taskId: string; at: string }
    | { type: "working_tasks"; taskIds: string[]; at: string }
    | { type: "devices_changed"; at: string }
