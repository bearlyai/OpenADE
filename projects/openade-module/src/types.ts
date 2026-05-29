export type OpenADETurnType = "plan" | "do" | "ask" | "revise" | "run_plan" | "hyperplan"
export type OpenADEIsolationStrategy = { type: "worktree"; sourceBranch: string } | { type: "head" }
export type OpenADEEventStatus = "in_progress" | "completed" | "error" | "stopped"
export type OpenADEHyperPlanStepPrimitive = "plan" | "review" | "reconcile" | "revise"
export type OpenADEActionEventSource =
    | { type: "plan"; userLabel: string }
    | { type: "revise"; userLabel: string; parentEventId: string }
    | { type: "run_plan"; userLabel: string; planEventId: string }
    | { type: "do"; userLabel: string }
    | { type: "ask"; userLabel: string; origin?: "review_follow_up" }
    | { type: "hyperplan"; userLabel: string; strategyId: string }
    | { type: "review"; userLabel: string; reviewType: "plan" | "work"; userInstructions?: string }

export interface OpenADEGitRefs {
    sha: string
    branch?: string
}

export interface OpenADEUser {
    id: string
    email: string
}

export interface OpenADEClientRequest {
    clientRequestId?: string
}

export interface OpenADETurnStartRequest extends OpenADEClientRequest {
    repoId: string
    type: OpenADETurnType
    input: string
    appendSystemPrompt?: string
    inTaskId?: string | null
    isolationStrategy?: OpenADEIsolationStrategy
    enabledMcpServerIds?: string[]
    harnessId?: string
    modelId?: string
    label?: string
    includeComments?: boolean
    images?: unknown[]
    thinking?: "low" | "med" | "high" | "max"
    fastMode?: boolean
    title?: string
    hyperplanStrategy?: OpenADEHyperPlanStrategy
}

export interface OpenADETurnStartResult {
    taskId: string
    eventId?: string
    queued?: boolean
    queuedTurnId?: string
}

export type OpenADEQueuedTurnStatus = "queued" | "running" | "completed" | "error" | "stopped" | "cancelled"

export interface OpenADEQueuedTurn {
    id: string
    clientRequestId?: string
    type: "do" | "ask"
    input: string
    status: OpenADEQueuedTurnStatus
    createdAt: string
    updatedAt: string
    eventId?: string
    appendSystemPrompt?: string
    enabledMcpServerIds?: string[]
    harnessId?: string
    modelId?: string
    label?: string
    includeComments?: boolean
    images?: unknown[]
    thinking?: "low" | "med" | "high" | "max"
    fastMode?: boolean
}

export interface OpenADEQueuedTurnCancelRequest extends OpenADEClientRequest {
    repoId: string
    taskId: string
    queuedTurnId: string
}

export interface OpenADEQueuedTurnCancelResult {
    taskId: string
    queuedTurnId: string
    cancelled: boolean
}

export interface OpenADETaskReadOptions {
    hydrateSessionEvents?: boolean
}

export interface OpenADETaskReadRequest extends OpenADETaskReadOptions {
    repoId: string
    taskId: string
}

export interface OpenADEReviewStartRequest extends OpenADEClientRequest {
    repoId: string
    taskId: string
    reviewType: "plan" | "work"
    harnessId: string
    modelId: string
    customInstructions?: string
}

export interface OpenADEAgentCouplet {
    harnessId: string
    modelId: string
}

export interface OpenADEHyperPlanStep {
    id: string
    primitive: OpenADEHyperPlanStepPrimitive
    agent: OpenADEAgentCouplet
    inputs: string[]
    resumeStepId?: string
}

export interface OpenADEHyperPlanStrategy {
    id: string
    name: string
    description: string
    steps: OpenADEHyperPlanStep[]
    terminalStepId: string
}

export interface OpenADETaskCreateRequest extends OpenADEClientRequest {
    repoId: string
    input: string
    createdBy: OpenADEUser
    deviceId: string
    title?: string
    taskId?: string
    slug?: string
    createdAt?: string
    isolationStrategy?: OpenADEIsolationStrategy
    enabledMcpServerIds?: string[]
    deviceEnvironment?: OpenADETaskDeviceEnvironment
    setupEvent?: OpenADESetupEnvironmentEventCreateRequest
}

export interface OpenADETaskCreateResult {
    taskId: string
    slug: string
    title: string
    createdAt: string
}

export interface OpenADERepoCreateRequest extends OpenADEClientRequest {
    repoId?: string
    name: string
    path: string
    createdBy: OpenADEUser
    createdAt?: string
}

export interface OpenADERepoCreateResult {
    repoId: string
    createdAt: string
}

export interface OpenADERepoUpdateRequest extends OpenADEClientRequest {
    repoId: string
    name?: string
    path?: string
    archived?: boolean
    updatedAt?: string
}

export interface OpenADERepoDeleteRequest extends OpenADEClientRequest {
    repoId: string
}

export interface OpenADETaskDeleteOptions {
    deleteSnapshots?: boolean
    deleteImages?: boolean
    deleteSessions?: boolean
    deleteWorktrees?: boolean
}

export interface OpenADETaskDeleteRequest extends OpenADEClientRequest {
    repoId: string
    taskId: string
    options?: OpenADETaskDeleteOptions
}

export interface OpenADETaskDeleteResult {
    repoId: string
    taskId: string
    deleted: true
}

export interface OpenADEActionEventCreateRequest extends OpenADEClientRequest {
    taskId: string
    userInput: string
    executionId: string
    harnessId: string
    source: OpenADEActionEventSource
    eventId?: string
    createdAt?: string
    images?: unknown[]
    includesCommentIds?: string[]
    modelId?: string
    fastMode?: boolean
    gitRefsBefore?: OpenADEGitRefs
}

export interface OpenADEActionEventCreateResult {
    eventId: string
    createdAt: string
}

export interface OpenADETaskDeviceEnvironment {
    id: string
    deviceId: string
    worktreeDir?: string
    setupComplete: boolean
    mergeBaseCommit?: string
    createdAt: string
    lastUsedAt: string
}

export interface OpenADESetupEnvironmentEventCreateRequest {
    taskId?: string
    eventId?: string
    worktreeId: string
    deviceId: string
    workingDir: string
    setupOutput?: string
    createdAt?: string
    completedAt?: string
}

export interface OpenADETaskEnvironmentSetupRequest extends OpenADEClientRequest {
    taskId: string
    deviceEnvironment: OpenADETaskDeviceEnvironment
    setupEvent?: OpenADESetupEnvironmentEventCreateRequest
}

export interface OpenADEActionStreamAppendRequest extends OpenADEClientRequest {
    taskId: string
    eventId: string
    streamEvent: Record<string, unknown> & { id: string }
}

export interface OpenADEActionEventCompleteRequest extends OpenADEClientRequest {
    taskId: string
    eventId: string
    success: boolean
    completedAt?: string
}

export interface OpenADEActionEventErrorRequest extends OpenADEClientRequest {
    taskId: string
    eventId: string
    completedAt?: string
}

export interface OpenADEActionEventStoppedRequest extends OpenADEClientRequest {
    taskId: string
    eventId: string
    completedAt?: string
    sessionId?: string
    parentSessionId?: string
}

export interface OpenADEActionEventRuntimeReconcileRequest extends OpenADEClientRequest {
    taskId: string
    eventId?: string
    executionId?: string
    status: "completed" | "failed" | "stopped"
    success?: boolean
    completedAt?: string
}

export interface OpenADEActionEventRuntimeReconcileResult {
    taskId: string
    repoId?: string
    eventId?: string
    status?: OpenADEEventStatus
    changed: boolean
    reason?: string
}

export interface OpenADEActionExecutionUpdateRequest extends OpenADEClientRequest {
    taskId: string
    eventId: string
    sessionId?: string
    parentSessionId?: string
    gitRefsAfter?: OpenADEGitRefs
}

export interface OpenADEHyperPlanSubExecution {
    stepId: string
    primitive: OpenADEHyperPlanStepPrimitive
    harnessId: string
    modelId: string
    executionId: string
    sessionId?: string
    parentSessionId?: string
    status: "in_progress" | "completed" | "error" | "stopped"
    events: Array<Record<string, unknown> & { id: string }>
    resultText?: string
    error?: string
    reconcileLabel?: string
}

export interface OpenADEHyperPlanSubExecutionAddRequest extends OpenADEClientRequest {
    taskId: string
    eventId: string
    subExecution: OpenADEHyperPlanSubExecution
}

export interface OpenADEHyperPlanSubExecutionStreamAppendRequest extends OpenADEClientRequest {
    taskId: string
    eventId: string
    stepId: string
    streamEvent: Record<string, unknown> & { id: string }
}

export interface OpenADEHyperPlanSubExecutionUpdateRequest extends OpenADEClientRequest {
    taskId: string
    eventId: string
    stepId: string
    executionId?: string
    sessionId?: string
    parentSessionId?: string
    status?: "in_progress" | "completed" | "error" | "stopped"
    resultText?: string
    error?: string
    reconcileLabel?: string
}

export interface OpenADEHyperPlanReconcileLabelsSetRequest extends OpenADEClientRequest {
    taskId: string
    eventId: string
    mapping: Array<{ stepId: string; label: string }>
}

export interface OpenADESnapshotChangedFile {
    path: string
    status: "added" | "deleted" | "modified" | "renamed"
    oldPath?: string
}

export interface OpenADESnapshotEventCreateRequest extends OpenADEClientRequest {
    taskId: string
    actionEventId: string
    referenceBranch: string
    mergeBaseCommit: string
    fullPatch: string
    patchFileId?: string
    stats: {
        filesChanged: number
        insertions: number
        deletions: number
    }
    files?: OpenADESnapshotChangedFile[]
    eventId?: string
    createdAt?: string
}

export interface OpenADESnapshotEventCreateResult {
    eventId: string
    createdAt: string
}

export interface OpenADECommentSelectedText {
    text: string
    linesBefore: string
    linesAfter: string
}

export interface OpenADECommentCreateRequest extends OpenADEClientRequest {
    taskId: string
    content: string
    source: Record<string, unknown>
    selectedText: OpenADECommentSelectedText
    author: OpenADEUser
    commentId?: string
    createdAt?: string
}

export interface OpenADECommentCreateResult {
    commentId: string
    createdAt: string
}

export interface OpenADECommentEditRequest extends OpenADEClientRequest {
    taskId: string
    commentId: string
    content: string
    updatedAt?: string
}

export interface OpenADECommentDeleteRequest extends OpenADEClientRequest {
    taskId: string
    commentId: string
    updatedAt?: string
}

export interface OpenADETaskMetadataUpdateRequest extends OpenADEClientRequest {
    taskId: string
    title?: string
    closed?: boolean
    lastViewedAt?: string
    lastEventAt?: string
    cancelledPlanEventId?: string
    usage?: OpenADETaskPreviewUsage
    enabledMcpServerIds?: string[]
    sessionIds?: Record<string, string>
    queuedTurns?: OpenADEQueuedTurn[]
    updatedAt?: string
}

export interface OpenADETaskPreviewUsage {
    usageVersion?: number
    inputTokens: number
    outputTokens: number
    totalCostUsd: number
    eventCount: number
    costByModel: Record<string, number>
    durationMs?: number
}

export interface OpenADETaskPreview {
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
    usage?: OpenADETaskPreviewUsage
    lastViewedAt?: string
    lastEventAt?: string
}

export interface OpenADEProject {
    id: string
    name: string
    path: string
    archived?: boolean
    tasks: OpenADETaskPreview[]
}

export interface OpenADESnapshot {
    server: {
        version: string
        hostName: string
        theme: {
            setting: string
            className: string
            label?: string
        }
    }
    repos: OpenADEProject[]
    workingTaskIds: string[]
}

export interface OpenADETask {
    id: string
    repoId: string
    slug: string
    title: string
    description: string
    isolationStrategy?: OpenADEIsolationStrategy
    enabledMcpServerIds?: string[]
    sessionIds?: Record<string, string>
    queuedTurns?: OpenADEQueuedTurn[]
    cancelledPlanEventId?: string
    deviceEnvironments: OpenADETaskDeviceEnvironment[]
    closed?: boolean
    unavailableReason?: string
    events: unknown[]
    comments: unknown[]
}
