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
    executionId?: string
    createdAt?: string
    task?: OpenADETask
    preview?: OpenADETaskPreview
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

export interface OpenADEQueuedTurnEnqueueRequest extends OpenADEClientRequest {
    repoId: string
    taskId: string
    type: "do" | "ask"
    input: string
    queuedTurnId?: string
    createdAt?: string
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

export interface OpenADEQueuedTurnEnqueueResult {
    taskId: string
    queuedTurnId: string
    queued: boolean
    turn: OpenADEQueuedTurn
}

export interface OpenADEQueuedTurnImportLegacyRequest extends OpenADEClientRequest {
    repoId: string
    taskId: string
    turn: OpenADEQueuedTurn
    position?: number
}

export interface OpenADEQueuedTurnImportLegacyResult {
    taskId: string
    queuedTurnId: string
    imported: boolean
    turn: OpenADEQueuedTurn
}

export interface OpenADEQueuedTurnReorderRequest extends OpenADEClientRequest {
    repoId: string
    taskId: string
    queuedTurnIds: string[]
    updatedAt?: string
}

export interface OpenADEQueuedTurnReorderResult {
    taskId: string
    reordered: boolean
    turns: OpenADEQueuedTurn[]
}

export interface OpenADETaskReadOptions {
    hydrateSessionEvents?: boolean
}

export interface OpenADETaskReadRequest extends OpenADETaskReadOptions {
    repoId: string
    taskId: string
}

export interface OpenADETaskTitleGenerateRequest extends OpenADEClientRequest {
    repoId: string
    taskId: string
    harnessId?: string
}

export interface OpenADETaskTitleGenerateResult {
    repoId: string
    taskId: string
    title: string
}

export interface OpenADEReviewStartRequest extends OpenADEClientRequest {
    repoId: string
    taskId: string
    reviewType: "plan" | "work"
    harnessId: string
    modelId: string
    thinking?: "low" | "med" | "high" | "max"
    fastMode?: boolean
    customInstructions?: string
}

export interface OpenADEReviewStartResult {
    taskId: string
    eventId?: string
    executionId?: string
    createdAt?: string
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

export interface OpenADETaskEnvironmentPrepareRequest extends OpenADEClientRequest {
    repoId: string
    taskId: string
}

export interface OpenADETaskEnvironmentPrepareResult {
    repoId: string
    taskId: string
    deviceEnvironment: OpenADETaskDeviceEnvironment
    setupEvent?: OpenADESetupEnvironmentEventCreateRequest
    cwd: string
    rootPath: string
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
    omittedEventCount?: number
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

export interface OpenADEProjectFileReadRequest {
    repoId: string
    taskId?: string
    path: string
    encoding?: "utf8" | "base64"
    maxBytes?: number
}

export interface OpenADEProjectFileReadResult {
    repoId: string
    taskId?: string
    path: string
    encoding: "utf8" | "base64"
    size: number
    tooLarge: boolean
    content: string | null
    isReadable?: boolean
    isBinary?: boolean
    mediaType?: string | null
    previewKind?: "image" | null
}

export interface OpenADEProjectFileWriteRequest extends OpenADEClientRequest {
    repoId: string
    taskId?: string
    path: string
    encoding?: "utf8" | "base64"
    content: string
    createDirs?: boolean
}

export interface OpenADEProjectFileWriteResult {
    repoId: string
    taskId?: string
    path: string
    size: number
}

export interface OpenADEProjectFilesTreeRequest {
    repoId: string
    taskId?: string
    path?: string
    maxDepth?: number
    maxEntries?: number
    includeHidden?: boolean
    includeGenerated?: boolean
}

export interface OpenADEProjectFilesTreeEntry {
    path: string
    name: string
    type: "file" | "directory"
    size?: number
    mtimeMs?: number
}

export interface OpenADEProjectFilesTreeResult {
    repoId: string
    taskId?: string
    path: string
    entries: OpenADEProjectFilesTreeEntry[]
    truncated: boolean
}

export interface OpenADEProjectFilesFuzzySearchRequest {
    repoId: string
    taskId?: string
    query: string
    matchDirs?: boolean
    limit?: number
    includeHidden?: boolean
    includeGenerated?: boolean
}

export interface OpenADEProjectFilesFuzzyTreeChild {
    name: string
    isDir: boolean
    fullPath: string
}

export interface OpenADEProjectFilesFuzzyTreeMatch {
    path: string
    children: OpenADEProjectFilesFuzzyTreeChild[]
}

export interface OpenADEProjectFilesFuzzySearchResult {
    repoId: string
    taskId?: string
    results: string[]
    truncated: boolean
    source: "filesystem"
    treeMatch?: OpenADEProjectFilesFuzzyTreeMatch
}

export interface OpenADEProjectSearchRequest {
    repoId: string
    taskId?: string
    query: string
    limit?: number
    caseSensitive?: boolean
}

export interface OpenADEProjectSearchMatch {
    path: string
    line: number
    content: string
    matchStart: number
    matchEnd: number
}

export interface OpenADEProjectSearchResult {
    repoId: string
    taskId?: string
    matches: OpenADEProjectSearchMatch[]
    truncated: boolean
}

export interface OpenADEProjectGitInfoRequest {
    repoId: string
}

export type OpenADEProjectGitInfoResult =
    | {
          repoId: string
          isGitRepo: true
          repoRoot: string
          relativePath: string
          mainBranch: string
          hasGhCli: boolean
      }
    | {
          repoId: string
          isGitRepo: false
          error?: string
      }

export interface OpenADEProjectGitBranch {
    name: string
    isDefault: boolean
    isRemote: boolean
}

export interface OpenADEProjectGitBranchesReadRequest {
    repoId: string
    includeRemote?: boolean
}

export interface OpenADEProjectGitBranchesReadResult {
    repoId: string
    branches: OpenADEProjectGitBranch[]
    defaultBranch: string
}

export interface OpenADEProjectGitSummaryReadRequest {
    repoId: string
}

export interface OpenADEProjectGitSummaryReadResult extends Omit<OpenADETaskGitSummaryResult, "taskId"> {}

export type OpenADEProcsProcessType = "setup" | "daemon" | "task" | "check"

export interface OpenADEProcsProcessDef {
    id: string
    name: string
    command: string
    workDir?: string
    url?: string
    type: OpenADEProcsProcessType
}

export type OpenADEProcsProcessInput = Omit<OpenADEProcsProcessDef, "id">

export type OpenADEProcsCronTaskType = "plan" | "do" | "ask" | "hyperplan"

export interface OpenADEProcsCronDef {
    id: string
    name: string
    schedule: string
    type: OpenADEProcsCronTaskType
    prompt: string
    appendSystemPrompt?: string
    images?: string[]
    isolation?: "head" | "worktree"
    harness?: string
    inTaskId?: string
    reuseTask?: boolean
}

export type OpenADEProcsCronInput = Omit<OpenADEProcsCronDef, "id">

export interface OpenADECronInstallState {
    cronId: string
    enabled: boolean
    installedAt: string
    lastRunAt?: string
    lastTaskId?: string
}

export interface OpenADECronInstallStateReadRequest {
    repoId: string
}

export interface OpenADECronInstallStateReadResult {
    repoId: string
    installations: Record<string, OpenADECronInstallState>
}

export interface OpenADECronInstallStateReplaceRequest extends OpenADEClientRequest {
    repoId: string
    installations: Record<string, OpenADECronInstallState>
}

export interface OpenADECronInstallStateReplaceResult {
    repoId: string
    installations: Record<string, OpenADECronInstallState>
    replacedInstallations: number
}

export interface OpenADECronDefinitionsConfig {
    relativePath: string
    crons: OpenADEProcsCronDef[]
}

export type OpenADECronDefinitionsConfigError = OpenADEProcsConfigError

export interface OpenADECronDefinitionsReadRequest {
    repoId: string
    taskId?: string
}

export interface OpenADECronDefinitionsReadResult {
    repoId: string
    taskId?: string
    repoRoot: string
    searchRoot: string
    isWorktree: boolean
    worktreeRoot?: string
    configs: OpenADECronDefinitionsConfig[]
    errors: OpenADECronDefinitionsConfigError[]
}

export interface OpenADEProcsConfig {
    relativePath: string
    processes: OpenADEProcsProcessDef[]
    crons: OpenADEProcsCronDef[]
}

export interface OpenADEProcsConfigError {
    relativePath: string
    error: string
    line?: number
}

export interface OpenADEProcsReadResult {
    repoRoot: string
    searchRoot: string
    isWorktree: boolean
    worktreeRoot?: string
    configs: OpenADEProcsConfig[]
    errors: OpenADEProcsConfigError[]
}

export interface OpenADEEditableProcsFile {
    filePath: string
    relativePath: string
    processes: OpenADEProcsProcessInput[]
    crons: OpenADEProcsCronInput[]
    rawContent: string
}

export interface OpenADESaveEditableProcsResult {
    filePath: string
    relativePath: string
    rawContent: string
    readResult?: OpenADEProcsReadResult
}

export type OpenADEProcsRunContext = { type: "repo"; root: string } | { type: "worktree"; root: string }

export type OpenADEProjectProcessType = OpenADEProcsProcessType

export interface OpenADEProjectProcessDefinition extends OpenADEProcsProcessDef {
    configPath: string
    cwd: string
}

export type OpenADEProjectProcessConfigError = OpenADEProcsConfigError

export interface OpenADEProjectProcessOutputChunk {
    type: "stdout" | "stderr"
    data: string
    timestamp: number
}

export interface OpenADEProjectProcessInstance {
    processId: string
    definitionId: string
    repoId: string
    taskId?: string
    cwd: string
    completed: boolean
    exitCode: number | null
    signal: string | null
    error?: string
    pid?: number
}

export interface OpenADEProjectProcessListRequest {
    repoId: string
    taskId?: string
}

export interface OpenADEProjectProcessListResult {
    repoId: string
    taskId?: string
    searchRoot: string
    repoRoot: string
    isWorktree: boolean
    worktreeRoot?: string
    configs?: OpenADEProcsConfig[]
    processes: OpenADEProjectProcessDefinition[]
    errors: OpenADEProjectProcessConfigError[]
    instances: OpenADEProjectProcessInstance[]
}

export interface OpenADEProjectProcessStartRequest extends OpenADEClientRequest {
    repoId: string
    taskId?: string
    definitionId: string
    timeoutMs?: number
}

export interface OpenADEProjectProcessStartResult {
    repoId: string
    taskId?: string
    definitionId: string
    processId: string
    runtimeId?: string
}

export interface OpenADEProjectProcessReconnectRequest {
    repoId: string
    taskId?: string
    processId: string
}

export interface OpenADEProjectProcessReconnectResult {
    repoId: string
    taskId?: string
    processId: string
    found: boolean
    completed?: boolean
    exitCode?: number | null
    signal?: string | null
    error?: string
    outputCount?: number
    output?: OpenADEProjectProcessOutputChunk[]
}

export interface OpenADEProjectProcessStopRequest extends OpenADEClientRequest {
    repoId: string
    taskId?: string
    processId: string
}

export interface OpenADEProjectProcessStopResult {
    repoId: string
    taskId?: string
    processId: string
    ok: boolean
    error?: string
}

export interface OpenADETaskTerminalStartRequest extends OpenADEClientRequest {
    repoId: string
    taskId: string
    cols?: number
    rows?: number
}

export interface OpenADETaskTerminalStartResult {
    repoId: string
    taskId: string
    terminalId: string
    runtimeId?: string
    ok: boolean
    error?: string
}

export interface OpenADETaskTerminalOutputChunk {
    data: string
    timestamp?: number
}

export interface OpenADETaskTerminalReconnectRequest {
    repoId: string
    taskId: string
    terminalId?: string
}

export interface OpenADETaskTerminalReconnectResult {
    repoId: string
    taskId: string
    terminalId: string
    found: boolean
    exited?: boolean
    exitCode?: number | null
    outputCount?: number
    output?: OpenADETaskTerminalOutputChunk[]
}

export interface OpenADETaskTerminalWriteRequest extends OpenADEClientRequest {
    repoId: string
    taskId: string
    terminalId: string
    data: string
}

export interface OpenADETaskTerminalResizeRequest extends OpenADEClientRequest {
    repoId: string
    taskId: string
    terminalId: string
    cols: number
    rows: number
}

export interface OpenADETaskTerminalStopRequest extends OpenADEClientRequest {
    repoId: string
    taskId: string
    terminalId: string
}

export interface OpenADETaskTerminalMutationResult {
    repoId: string
    taskId: string
    terminalId: string
    ok: boolean
}

export interface OpenADETaskImageReference {
    id: string
    ext: string
    mediaType?: string
}

export interface OpenADETaskImageReadRequest {
    repoId: string
    taskId: string
    imageId: string
    ext: string
}

export interface OpenADETaskImageReadResult {
    repoId: string
    taskId: string
    imageId: string
    ext: string
    mediaType?: string
    data: string | null
}

export interface OpenADETaskImageStagedReadRequest {
    imageId: string
    ext: string
}

export interface OpenADETaskImageStagedReadResult {
    imageId: string
    ext: string
    mediaType?: string
    data: string | null
}

export interface OpenADETaskImageWriteRequest extends OpenADEClientRequest {
    imageId: string
    ext: "gif" | "jpeg" | "jpg" | "png" | "webp"
    mediaType: "image/gif" | "image/jpeg" | "image/png" | "image/webp"
    data: string
}

export interface OpenADETaskImageWriteResult {
    imageId: string
    ext: string
    mediaType: string
    size: number
    sha256: string
}

export interface OpenADETaskImageImportLegacyRequest extends OpenADEClientRequest {
    imageId: string
    ext: "gif" | "jpeg" | "jpg" | "png" | "webp"
    mediaType: "image/gif" | "image/jpeg" | "image/png" | "image/webp"
    sourcePath: string
}

export interface OpenADETaskImageImportLegacyResult {
    imageId: string
    ext: string
    mediaType: string
    size: number
    sha256: string
}

export interface OpenADETaskImagesImportLegacyRequest extends OpenADEClientRequest {
    sourceDir: string
}

export interface OpenADETaskImageImportLegacyIssue {
    imageId: string
    ext: string
    code: string
}

export interface OpenADETaskImagesImportLegacyResult {
    scannedTasks: number
    referencedImages: number
    importedImages: number
    alreadyImportedImages: number
    missingImages: OpenADETaskImageImportLegacyIssue[]
    conflictedImages: OpenADETaskImageImportLegacyIssue[]
    failedImages: OpenADETaskImageImportLegacyIssue[]
}

export interface OpenADETaskImagesGCStagedRequest extends OpenADEClientRequest {
    olderThanMs?: number
    dryRun?: boolean
}

export interface OpenADETaskImagesGCStagedResult {
    scannedImages: number
    scannedTasks: number
    referencedImages: number
    eligibleImages: number
    deletedImages: number
    retainedImages: number
    olderThanMs: number
    dryRun: boolean
    failedImages: OpenADETaskImageImportLegacyIssue[]
}

export interface OpenADETaskHarnessSessionsImportLegacyRequest extends OpenADEClientRequest {
    claudeConfigDir?: string
    codexHome?: string
}

export interface OpenADETaskHarnessSessionImportLegacyIssue {
    sessionId: string
    harnessId: string
    code: string
}

export interface OpenADETaskHarnessSessionsImportLegacyResult {
    scannedTasks: number
    referencedSessions: number
    importedSessions: number
    alreadyImportedSessions: number
    missingSessions: OpenADETaskHarnessSessionImportLegacyIssue[]
    conflictedSessions: OpenADETaskHarnessSessionImportLegacyIssue[]
    failedSessions: OpenADETaskHarnessSessionImportLegacyIssue[]
}

export interface OpenADELegacyResourcesImportRequest extends OpenADEClientRequest {
    dataDir?: string
    imageDir?: string
    snapshotDir?: string
    importSessions?: boolean
    claudeConfigDir?: string
    codexHome?: string
}

export type OpenADELegacyResourceImportKind = "images" | "snapshots" | "sessions"

export interface OpenADELegacyResourceImportSkip {
    kind: OpenADELegacyResourceImportKind
    code: string
}

export interface OpenADELegacyResourcesImportResult {
    images: OpenADETaskImagesImportLegacyResult | null
    snapshots: OpenADETaskSnapshotsImportLegacyResult | null
    sessions: OpenADETaskHarnessSessionsImportLegacyResult | null
    skipped: OpenADELegacyResourceImportSkip[]
}

export type OpenADEMCPHealthStatus = "unknown" | "healthy" | "unhealthy" | "needs_auth"

export interface OpenADEMCPOAuthTokens {
    accessToken: string
    refreshToken?: string
    expiresAt?: string
    tokenType: string
}

export interface OpenADEMCPServerBase {
    id: string
    name: string
    enabled: boolean
    presetId?: string
    lastTested?: string
    healthStatus: OpenADEMCPHealthStatus
    createdAt: string
    updatedAt: string
}

export interface OpenADEMCPHTTPServer extends OpenADEMCPServerBase {
    transportType: "http"
    url: string
    headers?: Record<string, string>
    oauthTokens?: OpenADEMCPOAuthTokens
}

export interface OpenADEMCPStdioServer extends OpenADEMCPServerBase {
    transportType: "stdio"
    command: string
    args?: string[]
    envVars?: Record<string, string>
    cwd?: string
}

export type OpenADEMCPServer = OpenADEMCPHTTPServer | OpenADEMCPStdioServer

export interface OpenADEMCPServersReadResult {
    servers: OpenADEMCPServer[]
}

export interface OpenADEMCPServersReplaceRequest extends OpenADEClientRequest {
    servers: OpenADEMCPServer[]
}

export interface OpenADEMCPServersReplaceResult {
    servers: OpenADEMCPServer[]
    replacedServers: number
}

export interface OpenADEMCPServerUpsertRequest extends OpenADEClientRequest {
    server: OpenADEMCPServer
}

export interface OpenADEMCPServerUpsertResult {
    server: OpenADEMCPServer
    created: boolean
}

export interface OpenADEMCPServerDeleteRequest extends OpenADEClientRequest {
    serverId: string
}

export interface OpenADEMCPServerDeleteResult {
    serverId: string
    deleted: boolean
}

export type OpenADEPersonalSettingsThemeSetting =
    | "system"
    | "code-theme-light"
    | "code-theme-bright"
    | "code-theme-clean"
    | "code-theme-black"
    | "code-theme-synthwave"
    | "code-theme-dracula"

export type OpenADEPersonalSettingsTab = "appearance" | "connectors" | "companion" | "system" | "stats" | "dev"

export interface OpenADEPersonalSettings {
    envVars: Record<string, string>
    theme: OpenADEPersonalSettingsThemeSetting
    lastSettingsTab?: OpenADEPersonalSettingsTab
    deviceId?: string
    telemetryDisabled?: boolean
    onboardingCompleted?: boolean
    devHideTray?: boolean
    devForceAllCommands?: boolean
    shortcutHintsHidden?: boolean
    renderMarkdownMessages?: boolean
    lastSeenReleaseVersion?: string
    newTaskHarnessId?: string
    newTaskModelId?: string
    pinnedTaskIds?: string[]
    hyperplanStrategyId?: string
    hyperplanAgents?: OpenADEAgentCouplet[]
    hyperplanReconciler?: OpenADEAgentCouplet
}

export interface OpenADEPersonalSettingsReadResult {
    settings: OpenADEPersonalSettings
}

export interface OpenADEPersonalSettingsReplaceRequest extends OpenADEClientRequest {
    settings: OpenADEPersonalSettings
}

export interface OpenADEPersonalSettingsReplaceResult {
    settings: OpenADEPersonalSettings
}

export type OpenADETaskDiffContextLines = 1 | 3 | 10 | 25 | 100

export interface OpenADETaskGitChangedFile {
    path: string
    status: "added" | "deleted" | "modified" | "renamed"
    oldPath?: string
    binary?: boolean
}

export interface OpenADETaskGitChangeStats {
    filesChanged: number
    insertions: number
    deletions: number
}

export interface OpenADETaskGitSummaryRequest {
    repoId: string
    taskId: string
}

export interface OpenADETaskGitSummaryResult {
    repoId: string
    taskId: string
    branch: string | null
    headCommit: string
    ahead: number | null
    hasChanges: boolean
    staged: {
        files: OpenADETaskGitChangedFile[]
        stats: OpenADETaskGitChangeStats
    }
    unstaged: {
        files: OpenADETaskGitChangedFile[]
        stats: OpenADETaskGitChangeStats
    }
    untracked: OpenADETaskGitChangedFile[]
}

export interface OpenADETaskGitScopesReadRequest {
    repoId: string
    taskId: string
    includeRemote?: boolean
}

export interface OpenADETaskGitBranchScope {
    id: string
    type: "branch"
    name: string
    ref: string
    isDefault: boolean
    isRemote: boolean
}

export interface OpenADETaskGitWorktreeScope {
    id: string
    type: "worktree"
    worktreeId: string
    branch: string
    head: string
    label: string
}

export type OpenADETaskGitScope = OpenADETaskGitBranchScope | OpenADETaskGitWorktreeScope

export interface OpenADETaskGitScopesReadResult {
    repoId: string
    taskId: string
    defaultBranch: string
    scopes: OpenADETaskGitScope[]
}

export interface OpenADETaskChangesReadRequest {
    repoId: string
    taskId: string
    fromTreeish?: string
}

export interface OpenADETaskChangesReadResult {
    repoId: string
    taskId: string
    files: OpenADETaskGitChangedFile[]
    fromTreeish: string
    toTreeish: string
}

export interface OpenADETaskDiffStats {
    insertions: number
    deletions: number
    changedLines: number
    hunkCount: number
}

export interface OpenADETaskDiffReadRequest {
    repoId: string
    taskId: string
    filePath: string
    oldPath?: string
    fromTreeish?: string
    contextLines?: OpenADETaskDiffContextLines
    allowTruncation?: boolean
}

export interface OpenADETaskDiffReadResult {
    repoId: string
    taskId: string
    filePath: string
    oldPath?: string
    fromTreeish: string
    toTreeish: string
    patch: string
    truncated: boolean
    heavy: boolean
    stats: OpenADETaskDiffStats
}

export interface OpenADETaskFilePairReadRequest {
    repoId: string
    taskId: string
    filePath: string
    oldPath?: string
    fromTreeish?: string
}

export interface OpenADETaskFilePairReadResult {
    repoId: string
    taskId: string
    filePath: string
    oldPath?: string
    fromTreeish: string
    toTreeish: string
    before: string
    after: string
    tooLarge?: boolean
}

export interface OpenADETaskGitLogRequest {
    repoId: string
    taskId: string
    scopeId?: string
    ref?: string
    limit?: number
    skip?: number
}

export interface OpenADETaskGitLogEntry {
    sha: string
    shortSha: string
    message: string
    author: string
    date: string
    relativeDate: string
    parentCount: number
}

export interface OpenADETaskGitLogResult {
    repoId: string
    taskId: string
    commits: OpenADETaskGitLogEntry[]
    hasMore: boolean
}

export interface OpenADETaskGitCommitFilesRequest {
    repoId: string
    taskId: string
    commit: string
}

export interface OpenADETaskGitCommitFilesResult {
    repoId: string
    taskId: string
    commit: string
    files: OpenADETaskGitChangedFile[]
}

export interface OpenADETaskGitFileAtTreeishRequest {
    repoId: string
    taskId: string
    treeish: string
    filePath: string
}

export interface OpenADETaskGitFileAtTreeishResult {
    repoId: string
    taskId: string
    treeish: string
    filePath: string
    content: string
    exists: boolean
    tooLarge?: boolean
}

export interface OpenADETaskGitCommitFilePatchRequest {
    repoId: string
    taskId: string
    commit: string
    filePath: string
    oldPath?: string
    contextLines?: OpenADETaskDiffContextLines
    allowTruncation?: boolean
}

export interface OpenADETaskGitCommitFilePatchResult {
    repoId: string
    taskId: string
    commit: string
    filePath: string
    oldPath?: string
    patch: string
    truncated: boolean
    heavy: boolean
    stats: OpenADETaskDiffStats
}

export type OpenADETaskGitCommitStatus = "committed" | "nothing_to_commit" | "failed"

export interface OpenADETaskGitCommitRequest {
    repoId: string
    taskId: string
    message: string
    clientRequestId?: string
}

export interface OpenADETaskGitCommitResult {
    repoId: string
    taskId: string
    committed: boolean
    status: OpenADETaskGitCommitStatus
    sha?: string
    error?: string
}

export interface OpenADESnapshotPatchFile {
    id: string
    path: string
    oldPath?: string
    status: "added" | "deleted" | "modified" | "renamed"
    binary: boolean
    insertions: number
    deletions: number
    changedLines: number
    hunkCount: number
    patchStart: number
    patchEnd: number
}

export interface OpenADESnapshotPatchIndex {
    version: 1
    patchSize: number
    files: OpenADESnapshotPatchFile[]
}

export type OpenADESnapshotEventRecord = Record<string, unknown> & { id: string; type: "snapshot" }

export interface OpenADETaskSnapshotPatchReadRequest {
    repoId: string
    taskId: string
    eventId: string
}

export interface OpenADETaskSnapshotPatchReadResult {
    repoId: string
    taskId: string
    eventId: string
    patchFileId?: string
    patch: string | null
}

export interface OpenADETaskSnapshotIndexReadRequest {
    repoId: string
    taskId: string
    eventId: string
}

export interface OpenADETaskSnapshotIndexReadResult {
    repoId: string
    taskId: string
    eventId: string
    patchFileId?: string
    index: OpenADESnapshotPatchIndex | null
}

export interface OpenADETaskSnapshotPatchSliceReadRequest {
    repoId: string
    taskId: string
    eventId: string
    start: number
    end: number
}

export interface OpenADETaskSnapshotPatchSliceReadResult {
    repoId: string
    taskId: string
    eventId: string
    patchFileId?: string
    patch: string | null
}

export interface OpenADETaskSnapshotsImportLegacyRequest extends OpenADEClientRequest {
    sourceDir: string
}

export interface OpenADESnapshotPatchImportLegacyIssue {
    patchFileId: string
    code: string
}

export interface OpenADETaskSnapshotsImportLegacyResult {
    scannedTasks: number
    referencedPatches: number
    importedPatches: number
    alreadyImportedPatches: number
    missingPatches: OpenADESnapshotPatchImportLegacyIssue[]
    conflictedPatches: OpenADESnapshotPatchImportLegacyIssue[]
    failedPatches: OpenADESnapshotPatchImportLegacyIssue[]
}

export interface OpenADETaskResourceInventoryReadRequest {
    repoId: string
    taskId: string
}

export interface OpenADETaskResourceInventory {
    repoId: string
    taskId: string
    taskTitle: string
    isRunning: boolean
    snapshotIds: string[]
    images: Array<{ id: string; ext: string }>
    sessions: Array<{ sessionId: string; harnessId: string }>
    worktree: {
        slug: string
        branchName: string
        sourceBranch: string
        branchMerged: boolean | null
    } | null
}

export type OpenADETaskResourceInventoryReadResult = OpenADETaskResourceInventory

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

export interface OpenADETaskUsageRecalculateRequest extends OpenADEClientRequest {
    repoId: string
    taskId: string
}

export interface OpenADETaskUsageBackfillRequest extends OpenADEClientRequest {
    repoId?: string
    taskIds?: string[]
    force?: boolean
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

export interface OpenADETaskUsageRecalculateResult {
    usage: OpenADETaskPreviewUsage
}

export interface OpenADETaskUsageBackfillTaskResult {
    repoId: string
    taskId: string
    usage: OpenADETaskPreviewUsage
}

export interface OpenADETaskUsageBackfillResult {
    updatedTasks: number
    skippedTasks: number
    tasks: OpenADETaskUsageBackfillTaskResult[]
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
    createdBy?: OpenADEUser
    createdAt?: string
    updatedAt?: string
    lastViewedAt?: string
    lastEventAt?: string
    closed?: boolean
    pullRequest?: { url: string; number?: number; provider: "github" | "gitlab" | "other" }
    unavailableReason?: string
    events: unknown[]
    comments: unknown[]
}
