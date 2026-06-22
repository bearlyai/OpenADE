import { observer } from "mobx-react"
import { type Ref, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { OPENADE_METHOD, OPENADE_NOTIFICATION } from "../../../openade-client/src"
import type {
    OpenADECronDefinitionsReadResult,
    OpenADECronInstallState,
    OpenADECronInstallStateReadResult,
    OpenADEHyperPlanStrategy,
    OpenADEIsolationStrategy,
    OpenADEMCPServer,
    OpenADEPersonalSettings,
    OpenADEProject,
    OpenADEProjectFileReadResult,
    OpenADEProjectFilesFuzzySearchResult,
    OpenADEProjectFilesTreeResult,
    OpenADEProjectGitBranchesReadResult,
    OpenADEProjectGitInfoResult,
    OpenADEProjectGitSummaryReadResult,
    OpenADEProjectProcessInstance,
    OpenADEProjectProcessListResult,
    OpenADEProjectProcessReconnectResult,
    OpenADEProjectProcessStartResult,
    OpenADEProjectProcessStopResult,
    OpenADEProjectSearchResult,
    OpenADERepoPathInspectResult,
    OpenADESnapshot,
    OpenADESnapshotPatchFile,
    OpenADETask,
    OpenADETaskChangesReadResult,
    OpenADETaskDiffReadResult,
    OpenADETaskFilePairReadResult,
    OpenADETaskGitChangedFile,
    OpenADETaskGitCommitFilePatchResult,
    OpenADETaskGitCommitFilesResult,
    OpenADETaskGitFileAtTreeishResult,
    OpenADETaskGitLogEntry,
    OpenADETaskGitLogResult,
    OpenADETaskGitScopesReadResult,
    OpenADETaskGitSummaryResult,
    OpenADETaskPreview,
    OpenADETaskResourceInventoryReadResult,
    OpenADETaskSnapshotPatchReadResult,
    OpenADETurnStartRequest,
} from "../../../openade-module/src"
import type { RuntimeNotification } from "../../../runtime-protocol/src"
import { SmartEditor, type SmartEditorManagerContract, type SmartEditorRef, type SmartEditorSdkCapabilitiesContract } from "../components/SmartEditor"
import type { TaskTerminalProductAccess } from "../components/terminalSession"
import { DEFAULT_HARNESS_ID, MODEL_REGISTRY, getDefaultModelForHarness } from "../constants"
import type { HarnessId } from "../harness/harnessEventTypes"
import { getVisibleModelEntries, getVisibleModelId } from "../modelVisibility"
import { ACTION_PROMPTS } from "../prompts/actionPrompts"
import { type OpenADEThemeSetting, isOpenADEThemeSetting } from "../shell/OpenADESessionScreens"
import { OpenADEShell, type OpenADEShellScreen } from "../shell/OpenADEShell"
import { RemotePairingScreen } from "../shell/RemotePairingScreen"
import { type OpenADEShellCapabilities, buildOpenADEShellCapabilities } from "../shell/capabilities"
import type { ProjectUpdateInput } from "../shell/project/ProjectTasksScreen"
import type { NewTaskDraftView, NewTaskPendingCreationView } from "../shell/task/NewTaskScreen"
import type { TaskComposerImageAttachment } from "../shell/task/TaskComposer"
import type { TaskImageLoader, TaskSnapshotPatchView } from "../shell/task/TaskEventThread"
import { type TaskHyperPlanPresetId, buildTaskHyperPlanStrategy } from "../shell/task/TaskHyperPlanPicker"
import { TaskMcpPicker } from "../shell/task/TaskMcpPicker"
import type { OpenADETaskCommentView, TaskReviewType } from "../shell/task/TaskProductPanel"
import { isolationStrategyForBranchCapability } from "../shell/task/isolationStrategy"
import { canQueueTaskCommandWhileRunning } from "../shell/task/taskCommands"
import type { TaskImageAttachment, TaskSnapshotBlock } from "../shell/task/taskEventPresentation"
import { taskHasActivePlan, taskHasRetryableLastAction } from "../shell/task/taskPlanState"
import type { ThinkingLevel } from "../store/TaskModel"
import { imagePersistencePayloadToWriteRequest, processImageBlob } from "../utils/imageAttachment"
import {
    type PairingTarget,
    type RemoteConfig,
    type RemoteRealtimeConnectionStatus,
    activateRemoteConfig,
    buildPairingTarget,
    clearRemoteConfig,
    getRemoteProductStore,
    getRemoteRuntimeCapabilities,
    getRemoteRuntimeCapabilitiesAfterConnect,
    loadRemoteConfig,
    loadRemoteConfigs,
    pairRemote,
    parsePairingCode,
    remoteErrorMessage,
    removeRemoteConfig,
    retryRemoteRead,
    saveRemoteConfig,
    selfRevokeRemoteDevice,
    subscribeRemoteChanges,
} from "./client"
import { remoteRefreshPlan } from "./refreshPolicy"
import { nextRemoteRefreshDelay } from "./refreshQueue"
import { RemoteSdkCapabilitiesManager, type RemoteSmartEditorFileAccess, RemoteSmartEditorManager } from "./remoteSmartEditorManagers"
import { REMOTE_STATUS_GRACE_MS, isRemoteRealtimeOnline, shouldDelayRemoteStatusDisplay, statusCopy } from "./status"
import { beginRemoteSubmission, finishRemoteSubmission } from "./submission"

type CommandType = OpenADETurnStartRequest["type"]
type PendingConnection = PairingTarget & { mode: "pair" | "manual" }
type RemoteScreen = OpenADEShellScreen
type SnapshotRefreshOptions = {
    repairNavigation?: boolean
    bypassCache?: boolean
}
type TaskRefreshOptions = {
    hydrateSessionEvents?: boolean
    eventLimit?: number
    bypassCache?: boolean
}
type PendingTaskRefresh = {
    repoId: string
    taskId: string
    eventId?: string
    eventStatus?: string
}
type PendingProjectTaskListRefresh = {
    repoId: string
    repairNavigation: boolean
}
interface RemoteNewTaskDraft {
    id: string
    configId: string
    repoId: string
    createdAt: string
    title: string
    prompt: string
    mode: CommandType
    isolationStrategy: OpenADEIsolationStrategy
    hyperplanPresetId: TaskHyperPlanPresetId
    createMore: boolean
    mcpServerIds: string[]
    harnessId: HarnessId
    modelId: string
    thinking: ThinkingLevel
    fastMode: boolean
    images: TaskComposerImageAttachment[]
}
type RemoteNewTaskCreationPhase = "creating_task" | "starting_turn" | "completed"

interface RemoteNewTaskSubmission {
    title: string
    prompt: string
    mode: CommandType
    isolationStrategy: OpenADEIsolationStrategy
    harnessId: HarnessId
    modelId: string
    thinking: ThinkingLevel
    fastMode: boolean
    mcpServerIds: string[]
    images: TaskComposerImageAttachment[]
    hyperplanStrategy: OpenADEHyperPlanStrategy | null
    createMore: boolean
}

interface RemoteNewTaskPendingCreation extends RemoteNewTaskSubmission {
    id: string
    configId: string
    repoId: string
    createdAt: string
    phase: RemoteNewTaskCreationPhase
    taskId: string | null
    error: string | null
}

interface RemoteNewTaskPreference {
    createMore: boolean
    sourceBranch: string | null
}

type RemoteTaskEventStatus = "in_progress" | "completed" | "error" | "stopped"

interface RemoteTaskRepeatState {
    id: string
    configId: string
    repoId: string
    taskId: string
    input: string
    images: TaskComposerImageAttachment["attachment"][]
    harnessId: HarnessId
    modelId: string
    thinking: ThinkingLevel
    fastMode: boolean
    mcpServerIds: string[]
    stopOnText: string
    maxRuns: number
    iterationCount: number
    waitingEventId: string | null
    advancingEventId: string | null
}

export const REMOTE_THEME_STORAGE_KEY = "openade-companion-theme"
const REMOTE_NEW_TASK_DRAFTS_STORAGE_KEY = "openade:remote:newTaskDrafts:v1"
const REMOTE_NEW_TASK_PREFERENCES_STORAGE_KEY = "openade:remote:newTaskPreferences:v1"
const REMOTE_LIGHTWEIGHT_TASK_EVENT_LIMIT = 12
const MAX_REMOTE_NEW_TASK_DRAFTS = 20
const remoteDraftDateTimeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" })
const REMOTE_TASK_CREATED_BY = {
    id: "remote-companion",
    email: "remote-companion@openade.local",
}

function sameProjectProcessScope(current: OpenADEProjectProcessListResult, result: { repoId: string; taskId?: string }): boolean {
    return current.repoId === result.repoId && current.taskId === result.taskId
}

function projectProcessesWithStartedInstance(
    current: OpenADEProjectProcessListResult | null,
    result: OpenADEProjectProcessStartResult
): OpenADEProjectProcessListResult | null {
    if (!current || !sameProjectProcessScope(current, result)) return current

    const definition = current.processes.find((candidate) => candidate.id === result.definitionId)
    const instance: OpenADEProjectProcessInstance = {
        processId: result.processId,
        definitionId: result.definitionId,
        repoId: result.repoId,
        ...(result.taskId !== undefined ? { taskId: result.taskId } : {}),
        cwd: definition?.cwd ?? current.searchRoot,
        completed: false,
        exitCode: null,
        signal: null,
    }

    return {
        ...current,
        instances: [...current.instances.filter((candidate) => candidate.processId !== result.processId), instance],
    }
}

function projectProcessesWithoutStoppedInstance(
    current: OpenADEProjectProcessListResult | null,
    result: OpenADEProjectProcessStopResult
): OpenADEProjectProcessListResult | null {
    if (!current || !result.ok || !sameProjectProcessScope(current, result)) return current
    return {
        ...current,
        instances: current.instances.filter((candidate) => candidate.processId !== result.processId),
    }
}

function cronInstallationsWithEnabledState(
    current: Record<string, OpenADECronInstallState>,
    cronId: string,
    enabled: boolean,
    now: string
): Record<string, OpenADECronInstallState> {
    const existing = current[cronId]
    return {
        ...current,
        [cronId]: {
            cronId,
            enabled,
            installedAt: existing?.installedAt ?? now,
            ...(existing?.lastRunAt ? { lastRunAt: existing.lastRunAt } : {}),
            ...(existing?.lastTaskId ? { lastTaskId: existing.lastTaskId } : {}),
        },
    }
}

function loadOpenADEThemeSetting(): OpenADEThemeSetting {
    const value = window.localStorage.getItem(REMOTE_THEME_STORAGE_KEY)
    return isOpenADEThemeSetting(value) ? value : "desktop"
}

function saveOpenADEThemeSetting(value: OpenADEThemeSetting): void {
    window.localStorage.setItem(REMOTE_THEME_STORAGE_KEY, value)
}

interface RemoteAppProps {
    scanPairingCode?: () => Promise<string | null>
}

function parseDeepLinkParams(): {
    baseUrl?: string
    token?: string
    hostId?: string
} {
    const search = new URLSearchParams(window.location.search)
    const hashSearch = window.location.hash.includes("?") ? new URLSearchParams(window.location.hash.slice(window.location.hash.indexOf("?") + 1)) : null
    return {
        baseUrl: search.get("baseUrl") ?? hashSearch?.get("baseUrl") ?? undefined,
        token: search.get("token") ?? hashSearch?.get("token") ?? undefined,
        hostId: search.get("hostId") ?? hashSearch?.get("hostId") ?? undefined,
    }
}

function looksLikePairingCode(value: string): boolean {
    const raw = value.trim()
    if (!raw) return false
    if (raw.startsWith("{")) return raw.includes("token")
    try {
        return new URL(raw).searchParams.has("token")
    } catch {
        return false
    }
}

function formatHost(config: RemoteConfig | null): string {
    return config?.host ?? "OpenADE"
}

function fallbackSnapshotServer(config: RemoteConfig): OpenADESnapshot["server"] {
    return {
        version: "unknown",
        hostName: formatHost(config),
        theme: { setting: "system", className: "code-theme-black", label: "Black" },
    }
}

function snapshotFromProjectList(config: RemoteConfig, repos: OpenADEProject[], current: OpenADESnapshot | null): OpenADESnapshot {
    return {
        server: current?.server ?? fallbackSnapshotServer(config),
        repos,
        workingTaskIds: current?.workingTaskIds ?? [],
    }
}

async function workingTaskIdsFromRuntimeList(config: RemoteConfig): Promise<string[]> {
    const runtimes = await getRemoteProductStore(config).listRuntimes({
        ownerType: "openade-task",
        statuses: ["starting", "running"],
    })
    return runtimes.flatMap((runtime) => (runtime.scope.ownerId ? [runtime.scope.ownerId] : []))
}

async function workingTaskIdsForProjectProjection(
    config: RemoteConfig,
    capabilities: OpenADEShellCapabilities,
    current: OpenADESnapshot | null
): Promise<string[]> {
    if (!capabilities.taskRuntimeCapabilities.canReadWorkingTasks) return current?.workingTaskIds ?? []
    return workingTaskIdsFromRuntimeList(config)
}

function isUnavailableOpenADEMethod(error: unknown, method: string): boolean {
    return error instanceof Error && error.message === `OpenADE runtime method unavailable: ${method}`
}

function isTransientRemoteRefreshError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error)
    return /Runtime socket (closed|disconnected|failed|is not connected)|WebSocket/i.test(message)
}

function newClientRequestId(prefix: string): string {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `${prefix}-${crypto.randomUUID()}`
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function settingsHarnessId(settings: OpenADEPersonalSettings): HarnessId {
    const harnessIds = Object.keys(MODEL_REGISTRY) as HarnessId[]
    return settings.newTaskHarnessId && harnessIds.includes(settings.newTaskHarnessId as HarnessId)
        ? (settings.newTaskHarnessId as HarnessId)
        : DEFAULT_HARNESS_ID
}

function settingsModelId(settings: OpenADEPersonalSettings, harnessId: HarnessId): string {
    const modelId = settings.newTaskModelId
    const visibleModelId = modelId ? getVisibleModelId(modelId, harnessId) : null
    if (visibleModelId && getVisibleModelEntries(harnessId).some((model) => model.id === visibleModelId)) return visibleModelId
    return getVisibleModelId(getDefaultModelForHarness(harnessId), harnessId)
}

function remoteImageMediaType(image: TaskImageAttachment, value?: string): string {
    if (value?.startsWith("image/")) return value
    if (image.mediaType?.startsWith("image/")) return image.mediaType
    return image.ext === "jpg" ? "image/jpeg" : `image/${image.ext}`
}

function remoteSnapshotPatchFileKey(file: Pick<OpenADESnapshotPatchFile, "path" | "oldPath" | "patchStart" | "patchEnd">): string {
    return `${file.path}:${file.oldPath ?? ""}:${file.patchStart}:${file.patchEnd}`
}

function remoteSnapshotPatchFileLabel(file: Pick<OpenADESnapshotPatchFile, "path" | "oldPath">): string {
    return file.oldPath && file.oldPath !== file.path ? `${file.oldPath} -> ${file.path}` : file.path
}

function remoteSnapshotPatchActionId(eventId: string, file: Pick<OpenADESnapshotPatchFile, "patchStart" | "patchEnd">): string {
    return `${eventId}:${file.patchStart}:${file.patchEnd}`
}

function shellCapabilitiesForRemoteConfig(config: RemoteConfig | null) {
    return buildOpenADEShellCapabilities(getRemoteRuntimeCapabilities(config))
}

function activeRemoteConfigForHandler(renderConfig: RemoteConfig | null, currentConfig: RemoteConfig | null): RemoteConfig | null {
    if (!renderConfig || !currentConfig || renderConfig.id !== currentConfig.id) return null
    return currentConfig
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

function sameRemoteTaskRepeatRun(current: RemoteTaskRepeatState | null, repeat: Pick<RemoteTaskRepeatState, "id">): current is RemoteTaskRepeatState {
    return current?.id === repeat.id
}

function repeatMaxRuns(value: number): number {
    return Math.max(1, Number.isFinite(value) ? Math.floor(value) : 1)
}

function remoteTaskEventStatus(event: Record<string, unknown> | null): RemoteTaskEventStatus | null {
    if (!event) return null
    const status = event.status
    return status === "in_progress" || status === "completed" || status === "error" || status === "stopped" ? status : null
}

function remoteTaskEventById(task: OpenADETask | null, eventId: string | null): Record<string, unknown> | null {
    if (!task || !eventId) return null
    for (const event of task.events) {
        if (isRecord(event) && event.id === eventId) return event
    }
    return null
}

function remoteTaskActionFailed(event: Record<string, unknown> | null): boolean {
    if (!event || event.type !== "action") return false
    const result = isRecord(event.result) ? event.result : null
    return result?.success === false
}

function unknownContainsText(value: unknown, needle: string): boolean {
    if (typeof value === "string") return value.toLowerCase().includes(needle)
    if (Array.isArray(value)) return value.some((item) => unknownContainsText(item, needle))
    if (isRecord(value)) return Object.values(value).some((item) => unknownContainsText(item, needle))
    return false
}

function remoteTaskActionOutputContainsText(event: Record<string, unknown> | null, stopOnText: string): boolean {
    const needle = stopOnText.trim().toLowerCase()
    if (!needle || !event || event.type !== "action") return false
    const execution = isRecord(event.execution) ? event.execution : null
    const events = Array.isArray(execution?.events) ? execution.events : []
    return unknownContainsText(events, needle)
}

function isRemoteNewTaskCommandType(value: unknown): value is CommandType {
    return value === "do" || value === "plan" || value === "ask" || value === "hyperplan"
}

function isTaskHyperPlanPresetId(value: unknown): value is TaskHyperPlanPresetId {
    return value === "ensemble" || value === "peer-review" || value === "cross-review"
}

function isThinkingLevel(value: unknown): value is ThinkingLevel {
    return value === "low" || value === "med" || value === "high" || value === "max"
}

function isHarnessId(value: unknown): value is HarnessId {
    return typeof value === "string" && Object.prototype.hasOwnProperty.call(MODEL_REGISTRY, value)
}

function parseRemoteDraftIsolationStrategy(value: unknown): OpenADEIsolationStrategy {
    if (!isRecord(value)) return { type: "head" }
    if (value.type === "worktree" && typeof value.sourceBranch === "string") return { type: "worktree", sourceBranch: value.sourceBranch }
    return { type: "head" }
}

function parseRemoteNewTaskDraft(value: unknown): RemoteNewTaskDraft | null {
    if (!isRecord(value)) return null
    const { id, configId, repoId, createdAt, title, prompt, mode } = value
    if (
        typeof id !== "string" ||
        typeof configId !== "string" ||
        typeof repoId !== "string" ||
        typeof createdAt !== "string" ||
        typeof title !== "string" ||
        typeof prompt !== "string" ||
        !isRemoteNewTaskCommandType(mode)
    ) {
        return null
    }

    const harnessId = isHarnessId(value.harnessId) ? value.harnessId : DEFAULT_HARNESS_ID
    const modelId = typeof value.modelId === "string" ? value.modelId : getDefaultModelForHarness(harnessId)
    const mcpServerIds = Array.isArray(value.mcpServerIds) ? value.mcpServerIds.filter((serverId): serverId is string => typeof serverId === "string") : []

    return {
        id,
        configId,
        repoId,
        createdAt,
        title,
        prompt,
        mode,
        isolationStrategy: parseRemoteDraftIsolationStrategy(value.isolationStrategy),
        hyperplanPresetId: isTaskHyperPlanPresetId(value.hyperplanPresetId) ? value.hyperplanPresetId : "ensemble",
        createMore: value.createMore === true,
        mcpServerIds,
        harnessId,
        modelId,
        thinking: isThinkingLevel(value.thinking) ? value.thinking : "max",
        fastMode: value.fastMode === true,
        images: [],
    }
}

function loadRemoteNewTaskDrafts(): RemoteNewTaskDraft[] {
    const raw = window.localStorage.getItem(REMOTE_NEW_TASK_DRAFTS_STORAGE_KEY)
    if (!raw) return []
    try {
        const parsed: unknown = JSON.parse(raw)
        if (!Array.isArray(parsed)) return []
        return parsed
            .flatMap((item) => {
                const draft = parseRemoteNewTaskDraft(item)
                return draft ? [draft] : []
            })
            .slice(0, MAX_REMOTE_NEW_TASK_DRAFTS)
    } catch {
        return []
    }
}

function remoteNewTaskDraftCanPersist(draft: RemoteNewTaskDraft): boolean {
    return draft.title.trim().length > 0 || draft.prompt.trim().length > 0
}

function remoteNewTaskDraftStorageValue(draft: RemoteNewTaskDraft): Omit<RemoteNewTaskDraft, "images"> {
    return {
        id: draft.id,
        configId: draft.configId,
        repoId: draft.repoId,
        createdAt: draft.createdAt,
        title: draft.title,
        prompt: draft.prompt,
        mode: draft.mode,
        isolationStrategy: draft.isolationStrategy,
        hyperplanPresetId: draft.hyperplanPresetId,
        createMore: draft.createMore,
        mcpServerIds: draft.mcpServerIds,
        harnessId: draft.harnessId,
        modelId: draft.modelId,
        thinking: draft.thinking,
        fastMode: draft.fastMode,
    }
}

function saveRemoteNewTaskDrafts(drafts: RemoteNewTaskDraft[]): void {
    try {
        const persistedDrafts = drafts.filter(remoteNewTaskDraftCanPersist).map(remoteNewTaskDraftStorageValue)
        if (persistedDrafts.length === 0) {
            window.localStorage.removeItem(REMOTE_NEW_TASK_DRAFTS_STORAGE_KEY)
            return
        }
        window.localStorage.setItem(REMOTE_NEW_TASK_DRAFTS_STORAGE_KEY, JSON.stringify(persistedDrafts))
    } catch {
        // Draft persistence is best-effort; keep the in-memory draft state usable if storage is full or blocked.
    }
}

function remoteNewTaskPreferenceKey(configId: string, repoId: string): string {
    return `${configId}\0${repoId}`
}

function parseRemoteNewTaskPreferences(value: unknown): Record<string, RemoteNewTaskPreference> {
    if (!isRecord(value)) return {}
    const preferences: Record<string, RemoteNewTaskPreference> = {}
    for (const [key, preference] of Object.entries(value)) {
        if (!isRecord(preference)) continue
        const sourceBranch = typeof preference.sourceBranch === "string" && preference.sourceBranch.length > 0 ? preference.sourceBranch : null
        preferences[key] = {
            createMore: preference.createMore === true,
            sourceBranch,
        }
    }
    return preferences
}

function loadRemoteNewTaskPreferences(): Record<string, RemoteNewTaskPreference> {
    const raw = window.localStorage.getItem(REMOTE_NEW_TASK_PREFERENCES_STORAGE_KEY)
    if (!raw) return {}
    try {
        return parseRemoteNewTaskPreferences(JSON.parse(raw))
    } catch {
        return {}
    }
}

function readRemoteNewTaskPreference(configId: string, repoId: string): RemoteNewTaskPreference {
    return loadRemoteNewTaskPreferences()[remoteNewTaskPreferenceKey(configId, repoId)] ?? { createMore: false, sourceBranch: null }
}

function writeRemoteNewTaskPreference(configId: string, repoId: string, patch: Partial<RemoteNewTaskPreference>): RemoteNewTaskPreference {
    const preferences = loadRemoteNewTaskPreferences()
    const key = remoteNewTaskPreferenceKey(configId, repoId)
    const next = {
        ...(preferences[key] ?? { createMore: false, sourceBranch: null }),
        ...patch,
    }
    preferences[key] = next
    try {
        window.localStorage.setItem(REMOTE_NEW_TASK_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences))
    } catch {
        // Preference persistence is best-effort; current UI state still updates.
    }
    return next
}

function copyTaskComposerImageAttachments(images: readonly TaskComposerImageAttachment[]): TaskComposerImageAttachment[] {
    return images.map((image) => ({ attachment: { ...image.attachment }, dataUrl: image.dataUrl }))
}

function revokeTaskComposerImageAttachments(images: readonly TaskComposerImageAttachment[]): void {
    for (const image of images) URL.revokeObjectURL(image.dataUrl)
}

function remoteNewTaskDraftPreview(draft: RemoteNewTaskDraft): string {
    const title = draft.title.trim()
    if (title) return title
    const prompt = draft.prompt.trim().replace(/\s+/g, " ")
    if (!prompt && draft.images.length > 0) return draft.images.length === 1 ? "1 image" : `${draft.images.length} images`
    return prompt || "Untitled draft"
}

function remoteNewTaskDraftCreatedAtLabel(createdAt: string): string {
    const date = new Date(createdAt)
    if (Number.isNaN(date.getTime())) return createdAt
    return remoteDraftDateTimeFormat.format(date)
}

function remoteNewTaskDraftView(draft: RemoteNewTaskDraft): NewTaskDraftView {
    return {
        id: draft.id,
        createdAtLabel: remoteNewTaskDraftCreatedAtLabel(draft.createdAt),
        preview: remoteNewTaskDraftPreview(draft),
        imageCount: draft.images.length,
    }
}

function remoteNewTaskCreationPreview(creation: Pick<RemoteNewTaskSubmission, "title" | "prompt">): string {
    const title = creation.title.trim()
    if (title) return title
    const prompt = creation.prompt.trim().replace(/\s+/g, " ")
    return prompt.length > 96 ? `${prompt.slice(0, 96)}...` : prompt || "Untitled task"
}

function remoteNewTaskCreationPhaseLabel(creation: RemoteNewTaskPendingCreation): string {
    if (creation.phase === "completed") return "Ready"
    if (creation.phase === "creating_task") return "Creating task"
    return creation.isolationStrategy.type === "worktree" ? "Creating workspace" : "Starting task"
}

function remoteNewTaskPendingCreationView(creation: RemoteNewTaskPendingCreation, canReadTask: boolean): NewTaskPendingCreationView {
    return {
        id: creation.id,
        preview: remoteNewTaskCreationPreview(creation),
        phaseLabel: remoteNewTaskCreationPhaseLabel(creation),
        sourceBranch: creation.isolationStrategy.type === "worktree" ? creation.isolationStrategy.sourceBranch : undefined,
        error: creation.error,
        isComplete: creation.phase === "completed",
        canOpen: creation.taskId !== null && canReadTask,
        canCancel: creation.error === null && creation.phase !== "completed",
    }
}

function runtimeNotificationParams(notification: RuntimeNotification): Record<string, unknown> {
    return isRecord(notification.params) ? notification.params : {}
}

function acceptedActionStartKey(repoId: string, taskId: string, eventId: string): string {
    return `${repoId}\0${taskId}\0${eventId}`
}

function taskCommitFileActionKey(commit: string, filePath: string, oldPath?: string): string {
    return `${commit}\0${oldPath ?? ""}\0${filePath}`
}

function useSmoothedRemoteStatus(rawStatus: RemoteRealtimeConnectionStatus): RemoteRealtimeConnectionStatus {
    const [visibleStatus, setVisibleStatus] = useState(rawStatus)

    useEffect(() => {
        if (!shouldDelayRemoteStatusDisplay(visibleStatus, rawStatus)) {
            setVisibleStatus(rawStatus)
            return
        }

        const timeout = window.setTimeout(() => setVisibleStatus(rawStatus), REMOTE_STATUS_GRACE_MS)
        return () => window.clearTimeout(timeout)
    }, [rawStatus, visibleStatus])

    return visibleStatus
}

const RemoteSmartEditorInput = observer(function RemoteSmartEditorInput({
    manager,
    editorRef,
    value,
    placeholder,
    disabled,
    fileMentionsDir,
    slashCommandsDir,
    sdkCapabilities,
    onValueChange,
}: {
    manager: SmartEditorManagerContract
    editorRef?: Ref<SmartEditorRef>
    value: string
    placeholder: string
    disabled: boolean
    fileMentionsDir: string | null
    slashCommandsDir: string | null
    sdkCapabilities?: SmartEditorSdkCapabilitiesContract
    onValueChange: (value: string) => void
}) {
    const editorValue = manager.value
    const lastParentValueRef = useRef(value)

    useEffect(() => {
        if (value === lastParentValueRef.current) return
        lastParentValueRef.current = value
        if (manager.value !== value) manager.setTextContent(value)
    }, [manager, value])

    useEffect(() => {
        if (editorValue === value) return
        lastParentValueRef.current = editorValue
        onValueChange(editorValue)
    }, [editorValue, onValueChange, value])

    return (
        <SmartEditor
            ref={editorRef}
            manager={manager}
            ariaLabel="Task input"
            fileMentionsDir={fileMentionsDir}
            slashCommandsDir={slashCommandsDir}
            sdkCapabilities={sdkCapabilities}
            disabled={disabled}
            placeholder={placeholder}
            enableImagePasteDrop={false}
            className="min-h-12 max-h-28 min-w-0 flex-1 overflow-y-auto border border-border bg-base-200 p-2 text-sm"
            editorClassName="min-h-10"
        />
    )
})

export function RemoteApp({ scanPairingCode }: RemoteAppProps = {}) {
    const initialParams = useMemo(parseDeepLinkParams, [])
    const [configs, setConfigs] = useState<RemoteConfig[]>(() => loadRemoteConfigs())
    const [config, setConfig] = useState<RemoteConfig | null>(() => loadRemoteConfig())
    const [isAddingHost, setIsAddingHost] = useState(() => loadRemoteConfig() === null)
    const [screen, setScreen] = useState<RemoteScreen>("projects")
    const [baseUrl, setBaseUrl] = useState(initialParams.baseUrl ?? "")
    const [pairToken, setPairToken] = useState(initialParams.token ?? "")
    const [pairHostId, setPairHostId] = useState<string | undefined>(initialParams.hostId)
    const [pendingConnection, setPendingConnection] = useState<PendingConnection | null>(null)
    const [snapshot, setSnapshot] = useState<OpenADESnapshot | null>(null)
    const [sessionSnapshots, setSessionSnapshots] = useState<Record<string, OpenADESnapshot>>({})
    const [projectFiles, setProjectFiles] = useState<OpenADEProjectFilesTreeResult | null>(null)
    const [projectFilesLoading, setProjectFilesLoading] = useState(false)
    const [projectFileRead, setProjectFileRead] = useState<OpenADEProjectFileReadResult | null>(null)
    const [projectFileActionPath, setProjectFileActionPath] = useState<string | null>(null)
    const [projectFileSearchQuery, setProjectFileSearchQuery] = useState("")
    const [projectFileSearchResult, setProjectFileSearchResult] = useState<OpenADEProjectFilesFuzzySearchResult | null>(null)
    const [projectFileSearchLoading, setProjectFileSearchLoading] = useState(false)
    const [projectSearchQuery, setProjectSearchQuery] = useState("")
    const [projectSearchResult, setProjectSearchResult] = useState<OpenADEProjectSearchResult | null>(null)
    const [projectSearchLoading, setProjectSearchLoading] = useState(false)
    const [projectGitInfo, setProjectGitInfo] = useState<OpenADEProjectGitInfoResult | null>(null)
    const [projectGitBranches, setProjectGitBranches] = useState<OpenADEProjectGitBranchesReadResult | null>(null)
    const [projectGitSummary, setProjectGitSummary] = useState<OpenADEProjectGitSummaryReadResult | null>(null)
    const [projectGitLoading, setProjectGitLoading] = useState(false)
    const [projectCronDefinitions, setProjectCronDefinitions] = useState<OpenADECronDefinitionsReadResult | null>(null)
    const [projectCronInstallState, setProjectCronInstallState] = useState<OpenADECronInstallStateReadResult | null>(null)
    const [projectCronDefinitionsLoading, setProjectCronDefinitionsLoading] = useState(false)
    const [projectCronInstallStateLoading, setProjectCronInstallStateLoading] = useState(false)
    const [projectCronInstallActionId, setProjectCronInstallActionId] = useState<string | null>(null)
    const [projectProcesses, setProjectProcesses] = useState<OpenADEProjectProcessListResult | null>(null)
    const [projectProcessesLoading, setProjectProcessesLoading] = useState(false)
    const [projectProcessActionId, setProjectProcessActionId] = useState<string | null>(null)
    const [projectProcessOutput, setProjectProcessOutput] = useState<OpenADEProjectProcessReconnectResult | null>(null)
    const [taskChanges, setTaskChanges] = useState<OpenADETaskChangesReadResult | null>(null)
    const [taskGitLog, setTaskGitLog] = useState<OpenADETaskGitLogResult | null>(null)
    const [taskGitSummary, setTaskGitSummary] = useState<OpenADETaskGitSummaryResult | null>(null)
    const [taskGitScopes, setTaskGitScopes] = useState<OpenADETaskGitScopesReadResult | null>(null)
    const [taskChangesLoading, setTaskChangesLoading] = useState(false)
    const [taskDiff, setTaskDiff] = useState<OpenADETaskDiffReadResult | null>(null)
    const [taskDiffActionPath, setTaskDiffActionPath] = useState<string | null>(null)
    const [taskFilePair, setTaskFilePair] = useState<OpenADETaskFilePairReadResult | null>(null)
    const [taskFilePairActionPath, setTaskFilePairActionPath] = useState<string | null>(null)
    const [taskCommitFiles, setTaskCommitFiles] = useState<OpenADETaskGitCommitFilesResult | null>(null)
    const [taskCommitFilesActionSha, setTaskCommitFilesActionSha] = useState<string | null>(null)
    const [taskCommitPatch, setTaskCommitPatch] = useState<OpenADETaskGitCommitFilePatchResult | null>(null)
    const [taskCommitPatchActionKey, setTaskCommitPatchActionKey] = useState<string | null>(null)
    const [taskTreeishFile, setTaskTreeishFile] = useState<OpenADETaskGitFileAtTreeishResult | null>(null)
    const [taskTreeishFileActionKey, setTaskTreeishFileActionKey] = useState<string | null>(null)
    const [taskResources, setTaskResources] = useState<OpenADETaskResourceInventoryReadResult | null>(null)
    const [taskResourcesLoading, setTaskResourcesLoading] = useState(false)
    const [taskSnapshotPatches, setTaskSnapshotPatches] = useState<Record<string, TaskSnapshotPatchView>>({})
    const [taskSnapshotPatchActionId, setTaskSnapshotPatchActionId] = useState<string | null>(null)
    const [showArchivedProjects, setShowArchivedProjects] = useState(false)
    const [themeSetting, setThemeSetting] = useState<OpenADEThemeSetting>(() => loadOpenADEThemeSetting())
    const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null)
    const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
    const [task, setTask] = useState<OpenADETask | null>(null)
    const [input, setInput] = useState("")
    const [taskImageAttachments, setTaskImageAttachments] = useState<TaskComposerImageAttachment[]>([])
    const [taskImageAttachLoading, setTaskImageAttachLoading] = useState(false)
    const [taskRepeatState, setTaskRepeatState] = useState<RemoteTaskRepeatState | null>(null)
    const [taskRepeatStopOnText, setTaskRepeatStopOnText] = useState("")
    const [taskRepeatMaxRuns, setTaskRepeatMaxRuns] = useState(100)
    const [commandType, setCommandType] = useState<CommandType>("do")
    const [taskTitleDraft, setTaskTitleDraft] = useState("")
    const [commentDraft, setCommentDraft] = useState("")
    const [editingCommentId, setEditingCommentId] = useState<string | null>(null)
    const [editingCommentDraft, setEditingCommentDraft] = useState("")
    const [reviewInstructions, setReviewInstructions] = useState("")
    const [newTaskRepoId, setNewTaskRepoId] = useState<string | null>(null)
    const [newTaskMode, setNewTaskMode] = useState<CommandType>("do")
    const [newTaskTitle, setNewTaskTitle] = useState("")
    const [newTaskPrompt, setNewTaskPrompt] = useState("")
    const [newTaskImageAttachments, setNewTaskImageAttachments] = useState<TaskComposerImageAttachment[]>([])
    const [newTaskImageAttachLoading, setNewTaskImageAttachLoading] = useState(false)
    const [newTaskIsolationStrategy, setNewTaskIsolationStrategy] = useState<OpenADEIsolationStrategy>({ type: "head" })
    const [newTaskBranches, setNewTaskBranches] = useState<OpenADEProjectGitBranchesReadResult | null>(null)
    const [newTaskBranchesLoading, setNewTaskBranchesLoading] = useState(false)
    const [newTaskMcpServerIds, setNewTaskMcpServerIds] = useState<string[]>([])
    const [newTaskCreateMore, setNewTaskCreateMore] = useState(false)
    const [newTaskPreferredSourceBranch, setNewTaskPreferredSourceBranch] = useState<string | null>(null)
    const [newTaskDrafts, setNewTaskDrafts] = useState<RemoteNewTaskDraft[]>(() => loadRemoteNewTaskDrafts())
    const [newTaskPendingCreations, setNewTaskPendingCreations] = useState<RemoteNewTaskPendingCreation[]>([])
    const [taskHyperplanPresetId, setTaskHyperplanPresetId] = useState<TaskHyperPlanPresetId>("ensemble")
    const [newTaskHyperplanPresetId, setNewTaskHyperplanPresetId] = useState<TaskHyperPlanPresetId>("ensemble")
    const [mcpServers, setMcpServers] = useState<OpenADEMCPServer[]>([])
    const [mcpServersLoaded, setMcpServersLoaded] = useState(false)
    const [mcpServersLoading, setMcpServersLoading] = useState(false)
    const [mcpServerActionId, setMcpServerActionId] = useState<string | null>(null)
    const [personalSettings, setPersonalSettings] = useState<OpenADEPersonalSettings | null>(null)
    const [personalSettingsLoading, setPersonalSettingsLoading] = useState(false)
    const [personalSettingsActionLoading, setPersonalSettingsActionLoading] = useState(false)
    const [agentHarnessId, setAgentHarnessId] = useState<HarnessId>(DEFAULT_HARNESS_ID)
    const [agentModelId, setAgentModelId] = useState(() => getDefaultModelForHarness(DEFAULT_HARNESS_ID))
    const [agentThinking, setAgentThinking] = useState<ThinkingLevel>("max")
    const [agentFastMode, setAgentFastMode] = useState(false)
    const [isLoading, setIsLoading] = useState(false)
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [rawConnectionStatus, setRawConnectionStatus] = useState<RemoteRealtimeConnectionStatus>("disconnected")
    const [error, setError] = useState<string | null>(null)
    const [notice, setNotice] = useState<string | null>(null)
    const taskComposerEditorRef = useRef<SmartEditorRef>(null)
    const newTaskComposerEditorRef = useRef<SmartEditorRef>(null)
    const selectedRepoIdRef = useRef<string | null>(null)
    const selectedTaskIdRef = useRef<string | null>(null)
    const newTaskRepoIdRef = useRef<string | null>(newTaskRepoId)
    const screenRef = useRef<RemoteScreen>(screen)
    const configRef = useRef<RemoteConfig | null>(config)
    const snapshotRef = useRef<OpenADESnapshot | null>(snapshot)
    const newTaskDraftsRef = useRef<RemoteNewTaskDraft[]>(newTaskDrafts)
    const newTaskPendingCreationsRef = useRef<RemoteNewTaskPendingCreation[]>(newTaskPendingCreations)
    const snapshotRefreshTimerRef = useRef<number | null>(null)
    const snapshotRefreshRepairsNavigationRef = useRef(false)
    const taskRefreshTimerRef = useRef<number | null>(null)
    const taskRefreshInFlightRef = useRef(false)
    const taskRefreshPendingRef = useRef<PendingTaskRefresh | null>(null)
    const projectTaskListRefreshTimerRef = useRef<number | null>(null)
    const projectTaskListRefreshInFlightRef = useRef(false)
    const projectTaskListRefreshPendingRef = useRef(new Map<string, PendingProjectTaskListRefresh>())
    const lastTaskRefreshAtRef = useRef(0)
    const submitLockRef = useRef(false)
    const submitTokenRef = useRef(0)
    const acceptedActionStartNotificationsRef = useRef(new Map<string, number>())
    const acceptedMutationNotificationsRef = useRef(new Map<string, number>())

    const finishSubmissionToken = (token: number) => {
        if (submitTokenRef.current !== token) return
        finishRemoteSubmission(submitLockRef, {
            setSubmitting: setIsSubmitting,
            setLoading: setIsLoading,
        })
    }

    const cancelSubmission = () => {
        submitTokenRef.current += 1
        if (!submitLockRef.current) return
        finishRemoteSubmission(submitLockRef, {
            setSubmitting: setIsSubmitting,
            setLoading: setIsLoading,
        })
    }

    const setScreenState = (nextScreen: RemoteScreen) => {
        if (screenRef.current !== nextScreen) cancelSubmission()
        screenRef.current = nextScreen
        setScreen(nextScreen)
    }

    const setActiveRemoteConfig = (nextConfig: RemoteConfig | null) => {
        configRef.current = nextConfig
        setConfig(nextConfig)
    }

    const isActiveRemoteConfig = (nextConfig: RemoteConfig): boolean => configRef.current?.id === nextConfig.id

    const setSelectedRepoState = (nextRepoId: string | null) => {
        if (selectedRepoIdRef.current !== nextRepoId) cancelSubmission()
        selectedRepoIdRef.current = nextRepoId
        setSelectedRepoId(nextRepoId)
    }

    const setSelectedTaskState = (nextTaskId: string | null) => {
        if (selectedTaskIdRef.current !== nextTaskId) cancelSubmission()
        selectedTaskIdRef.current = nextTaskId
        setSelectedTaskId(nextTaskId)
    }

    const setNewTaskRepoState = (nextRepoId: string | null) => {
        newTaskRepoIdRef.current = nextRepoId
        setNewTaskRepoId(nextRepoId)
    }

    const selectNewTaskRepo = (nextRepoId: string | null) => {
        const previousRepoId = newTaskRepoIdRef.current
        setNewTaskRepoState(nextRepoId)
        if (previousRepoId !== nextRepoId) {
            setNewTaskBranches(null)
            setNewTaskBranchesLoading(false)
            setNewTaskIsolationStrategy({ type: "head" })
            clearNewTaskImageAttachments()
        }
    }

    const handleAgentHarnessChange = (harnessId: HarnessId) => {
        setAgentHarnessId(harnessId)
        setAgentModelId(getDefaultModelForHarness(harnessId))
    }

    const applyPersonalSettingsAgentDefaults = (settings: OpenADEPersonalSettings) => {
        const harnessId = settingsHarnessId(settings)
        setAgentHarnessId(harnessId)
        setAgentModelId(settingsModelId(settings, harnessId))
    }

    const cleanupAcceptedActionStartNotifications = () => {
        const nowMs = Date.now()
        for (const [key, expiresAt] of acceptedActionStartNotificationsRef.current) {
            if (expiresAt <= nowMs) acceptedActionStartNotificationsRef.current.delete(key)
        }
    }

    const trackAcceptedActionStartNotification = (repoId: string, taskId: string, eventId: string) => {
        cleanupAcceptedActionStartNotifications()
        acceptedActionStartNotificationsRef.current.set(acceptedActionStartKey(repoId, taskId, eventId), Date.now() + 2_000)
    }

    const cleanupAcceptedMutationNotifications = () => {
        const nowMs = Date.now()
        for (const [clientRequestId, expiresAt] of acceptedMutationNotificationsRef.current) {
            if (expiresAt <= nowMs) acceptedMutationNotificationsRef.current.delete(clientRequestId)
        }
    }

    const trackAcceptedMutationNotification = (clientRequestId: string) => {
        cleanupAcceptedMutationNotifications()
        acceptedMutationNotificationsRef.current.set(clientRequestId, Date.now() + 2_000)
    }

    const consumeAcceptedMutationNotification = (notification: RuntimeNotification): boolean => {
        const params = runtimeNotificationParams(notification)
        const clientRequestId = typeof params.clientRequestId === "string" ? params.clientRequestId : ""
        if (!clientRequestId) return false

        cleanupAcceptedMutationNotifications()
        return acceptedMutationNotificationsRef.current.has(clientRequestId)
    }

    const consumeAcceptedActionStartNotification = (notification: RuntimeNotification): boolean => {
        if (notification.method !== OPENADE_NOTIFICATION.taskUpdated) return false
        const params = runtimeNotificationParams(notification)
        const repoId = typeof params.repoId === "string" ? params.repoId : ""
        const taskId = typeof params.taskId === "string" ? params.taskId : ""
        const eventId = typeof params.eventId === "string" ? params.eventId : ""
        if (!repoId || !taskId || !eventId || params.eventStatus !== "in_progress") return false

        cleanupAcceptedActionStartNotifications()
        const key = acceptedActionStartKey(repoId, taskId, eventId)
        if (!acceptedActionStartNotificationsRef.current.has(key)) return false
        acceptedActionStartNotificationsRef.current.delete(key)
        return true
    }

    const cancelPendingAcceptedActionStartRefresh = (repoId: string, taskId: string, eventId: string) => {
        const pending = taskRefreshPendingRef.current
        if (!pending || pending.repoId !== repoId || pending.taskId !== taskId || pending.eventId !== eventId || pending.eventStatus !== "in_progress") return

        if (taskRefreshTimerRef.current) window.clearTimeout(taskRefreshTimerRef.current)
        taskRefreshTimerRef.current = null
        taskRefreshPendingRef.current = null
        acceptedActionStartNotificationsRef.current.delete(acceptedActionStartKey(repoId, taskId, eventId))
    }

    const pendingTaskRefreshFromNotification = (
        notification: RuntimeNotification,
        repoId: string | undefined | null,
        taskId: string | undefined | null
    ): PendingTaskRefresh | null => {
        if (!repoId || !taskId) return null
        const params = runtimeNotificationParams(notification)
        return {
            repoId,
            taskId,
            eventId: typeof params.eventId === "string" ? params.eventId : undefined,
            eventStatus: typeof params.eventStatus === "string" ? params.eventStatus : undefined,
        }
    }

    const visibleRepos = snapshot?.repos.filter((repo) => showArchivedProjects || !repo.archived) ?? []
    const selectedRepo = selectedRepoId ? (snapshot?.repos.find((repo) => repo.id === selectedRepoId) ?? null) : null
    const selectedTask = selectedRepo?.tasks.find((item) => item.id === selectedTaskId) ?? null
    const selectedTaskIsRunning = Boolean(selectedTask && snapshot?.workingTaskIds.includes(selectedTask.id))
    const desktopThemeClass = snapshot?.server.theme?.className ?? "code-theme-black"
    const themeClass = themeSetting === "desktop" ? desktopThemeClass : themeSetting
    const rootClass = `code-theme ${themeClass} flex bg-base-100 text-base-content flex-col overflow-hidden`
    const connectionStatus = useSmoothedRemoteStatus(rawConnectionStatus)
    const status = statusCopy(connectionStatus)
    const isOnline = isRemoteRealtimeOnline(connectionStatus)
    const shellCapabilities = buildOpenADEShellCapabilities(getRemoteRuntimeCapabilities(config))
    const { projectFileCapabilities, settingsCapabilities, taskDirectoryCapabilities, taskTurnCapabilities, projectSdkCapabilities } = shellCapabilities
    const taskReadGranted = taskDirectoryCapabilities.canRead
    const taskTurnStartGranted = taskTurnCapabilities.canStart
    const taskQueuedTurnEnqueueGranted = taskTurnCapabilities.canEnqueue
    const mcpServerCapabilities = settingsCapabilities.mcpServers
    const personalSettingsCapabilities = settingsCapabilities.personalSettings
    const taskCanUseSdkCapabilities = (selectedTaskIsRunning ? taskQueuedTurnEnqueueGranted : taskTurnStartGranted) && projectSdkCapabilities.canRead
    const newTaskCanUseSdkCapabilities = taskTurnStartGranted && projectSdkCapabilities.canRead
    const newTaskComposerRepoId = newTaskRepoId ?? selectedRepo?.id ?? null
    const visibleNewTaskDrafts = useMemo<NewTaskDraftView[]>(() => {
        if (!config || !newTaskComposerRepoId) return []
        return newTaskDrafts
            .filter((draft) => draft.configId === config.id && draft.repoId === newTaskComposerRepoId)
            .map((draft) => remoteNewTaskDraftView(draft))
    }, [config, newTaskComposerRepoId, newTaskDrafts])
    const visibleNewTaskPendingCreations = useMemo<NewTaskPendingCreationView[]>(() => {
        if (!config || !newTaskComposerRepoId) return []
        return newTaskPendingCreations
            .filter((creation) => creation.configId === config.id && creation.repoId === newTaskComposerRepoId)
            .map((creation) => remoteNewTaskPendingCreationView(creation, taskReadGranted))
    }, [config, newTaskComposerRepoId, newTaskPendingCreations, taskReadGranted])
    const newTaskHasDraftableContent = newTaskTitle.trim().length > 0 || newTaskPrompt.trim().length > 0 || newTaskImageAttachments.length > 0
    const canStashNewTaskDraft = Boolean(config && newTaskComposerRepoId && newTaskHasDraftableContent)
    const canRestoreNewTaskDraft = newTaskImageAttachments.length === 0
    useEffect(() => {
        if (!config || !newTaskComposerRepoId) {
            setNewTaskPreferredSourceBranch(null)
            return
        }
        const preference = readRemoteNewTaskPreference(config.id, newTaskComposerRepoId)
        setNewTaskCreateMore(preference.createMore)
        setNewTaskPreferredSourceBranch(preference.sourceBranch)
    }, [config?.id, newTaskComposerRepoId])
    const updateNewTaskDrafts = useCallback((updater: (current: RemoteNewTaskDraft[]) => RemoteNewTaskDraft[]) => {
        setNewTaskDrafts((current) => {
            const updated = updater(current)
            const next = updated.slice(0, MAX_REMOTE_NEW_TASK_DRAFTS)
            for (const dropped of updated.slice(MAX_REMOTE_NEW_TASK_DRAFTS)) revokeTaskComposerImageAttachments(dropped.images)
            saveRemoteNewTaskDrafts(next)
            return next
        })
    }, [])
    const taskEditorManager = useMemo(() => {
        if (!config || !selectedRepoId || !selectedTaskId) return null
        const repoId = selectedRepoId
        const taskId = selectedTaskId
        const renderConfig = config
        const fileAccess: RemoteSmartEditorFileAccess = {
            getContext: () => {
                const currentConfig = activeRemoteConfigForHandler(renderConfig, configRef.current)
                if (!currentConfig || !shellCapabilitiesForRemoteConfig(currentConfig).projectFileCapabilities.canSearch) return null
                if (screenRef.current !== "task") return null
                if (selectedRepoIdRef.current !== repoId || selectedTaskIdRef.current !== taskId) return null
                return { repoId, taskId }
            },
            fuzzySearchProjectFiles: (args) => {
                const currentConfig = activeRemoteConfigForHandler(renderConfig, configRef.current)
                if (!currentConfig || !shellCapabilitiesForRemoteConfig(currentConfig).projectFileCapabilities.canSearch) return Promise.resolve(null)
                if (screenRef.current !== "task") return Promise.resolve(null)
                if (selectedRepoIdRef.current !== repoId || selectedTaskIdRef.current !== taskId) return Promise.resolve(null)
                if (args.repoId !== repoId || args.taskId !== taskId) return Promise.resolve(null)
                return getRemoteProductStore(currentConfig).fuzzySearchProjectFiles(args)
            },
        }
        return new RemoteSmartEditorManager(`remote-task-${taskId}`, repoId, fileAccess)
    }, [config, projectFileCapabilities.canSearch, selectedRepoId, selectedTaskId])
    const newTaskEditorManager = useMemo(() => {
        if (!config || !newTaskComposerRepoId) return null
        const repoId = newTaskComposerRepoId
        const renderConfig = config
        const fileAccess: RemoteSmartEditorFileAccess = {
            getContext: () => {
                const currentConfig = activeRemoteConfigForHandler(renderConfig, configRef.current)
                if (!currentConfig || !shellCapabilitiesForRemoteConfig(currentConfig).projectFileCapabilities.canSearch) return null
                if (screenRef.current !== "new_task") return null
                if ((newTaskRepoIdRef.current ?? selectedRepoIdRef.current) !== repoId) return null
                return { repoId }
            },
            fuzzySearchProjectFiles: (args) => {
                const currentConfig = activeRemoteConfigForHandler(renderConfig, configRef.current)
                if (!currentConfig || !shellCapabilitiesForRemoteConfig(currentConfig).projectFileCapabilities.canSearch) return Promise.resolve(null)
                if (screenRef.current !== "new_task") return Promise.resolve(null)
                if ((newTaskRepoIdRef.current ?? selectedRepoIdRef.current) !== repoId) return Promise.resolve(null)
                if (args.repoId !== repoId || args.taskId !== undefined) return Promise.resolve(null)
                return getRemoteProductStore(currentConfig).fuzzySearchProjectFiles(args)
            },
        }
        return new RemoteSmartEditorManager(`remote-new-task-${repoId}`, repoId, fileAccess)
    }, [config, newTaskComposerRepoId, projectFileCapabilities.canSearch])
    const taskSdkCapabilities = useMemo(() => {
        if (!config || !selectedRepoId || !taskCanUseSdkCapabilities) return undefined
        const repoId = selectedRepoId
        const taskId = selectedTaskId ?? undefined
        const renderConfig = config
        return new RemoteSdkCapabilitiesManager(async () => {
            const currentConfig = activeRemoteConfigForHandler(renderConfig, configRef.current)
            if (!currentConfig || !shellCapabilitiesForRemoteConfig(currentConfig).projectSdkCapabilities.canRead) return null
            if (selectedRepoIdRef.current !== repoId || selectedTaskIdRef.current !== (taskId ?? null)) return null
            const result = await getRemoteProductStore(currentConfig).readProjectSdkCapabilities({
                repoId,
                taskId,
                harnessId: agentHarnessId,
            })
            return {
                slash_commands: result.slash_commands,
                skills: result.skills,
                plugins: result.plugins,
                cachedAt: result.cachedAt ?? Date.now(),
            }
        })
    }, [agentHarnessId, config, selectedRepoId, selectedTaskId, taskCanUseSdkCapabilities])
    const newTaskSdkCapabilities = useMemo(() => {
        if (!config || !newTaskComposerRepoId || !newTaskCanUseSdkCapabilities) return undefined
        const repoId = newTaskComposerRepoId
        const renderConfig = config
        return new RemoteSdkCapabilitiesManager(async () => {
            const currentConfig = activeRemoteConfigForHandler(renderConfig, configRef.current)
            if (!currentConfig || !shellCapabilitiesForRemoteConfig(currentConfig).projectSdkCapabilities.canRead) return null
            if ((newTaskRepoIdRef.current ?? selectedRepoIdRef.current) !== repoId) return null
            const result = await getRemoteProductStore(currentConfig).readProjectSdkCapabilities({
                repoId,
                harnessId: agentHarnessId,
            })
            return {
                slash_commands: result.slash_commands,
                skills: result.skills,
                plugins: result.plugins,
                cachedAt: result.cachedAt ?? Date.now(),
            }
        })
    }, [agentHarnessId, config, newTaskCanUseSdkCapabilities, newTaskComposerRepoId])
    const loadTaskImage = useCallback<TaskImageLoader>(
        async (image) => {
            const currentConfig = configRef.current
            const currentTask = task
            if (!currentConfig || !currentTask) return null
            if (!shellCapabilitiesForRemoteConfig(currentConfig).taskImageCapabilities.canRead) return null
            const result = await retryRemoteRead(() =>
                getRemoteProductStore(currentConfig).readTaskImage({
                    repoId: currentTask.repoId,
                    taskId: currentTask.id,
                    imageId: image.id,
                    ext: image.ext,
                })
            )
            if (!result.data) return null
            return `data:${remoteImageMediaType(image, result.mediaType)};base64,${result.data}`
        },
        [task]
    )

    const clearTaskImageAttachments = () => {
        setTaskImageAttachments((current) => {
            revokeTaskComposerImageAttachments(current)
            return []
        })
    }

    const clearNewTaskImageAttachments = () => {
        setNewTaskImageAttachments((current) => {
            revokeTaskComposerImageAttachments(current)
            return []
        })
    }

    const handleAttachTaskImage = useCallback(
        (file: File) => {
            const activeScope = activeTaskScopeForHandler(config, selectedRepo?.id, selectedTaskId)
            if (!activeScope) return
            const currentConfig = activeScope.config
            const repoId = activeScope.repoId
            const taskId = activeScope.taskId
            const currentCapabilities = shellCapabilitiesForRemoteConfig(currentConfig)
            const currentTaskIsRunning = taskIsRunningFromCurrentSnapshot(taskId)
            const currentCanSubmit = currentTaskIsRunning
                ? currentCapabilities.taskTurnCapabilities.canEnqueue && canQueueTaskCommandWhileRunning(commandType)
                : currentCapabilities.taskTurnCapabilities.canStart
            if (!currentCapabilities.taskImageCapabilities.canWrite || !currentCanSubmit) return
            setTaskImageAttachLoading(true)
            setError(null)
            void processImageBlob(file, {
                persistImage: async (payload) => {
                    await getRemoteProductStore(currentConfig).writeTaskImage(imagePersistencePayloadToWriteRequest(payload), {
                        clientRequestId: newClientRequestId("remote-task-image-write"),
                    })
                },
            })
                .then((processed) => {
                    if (!isActiveTaskScope(currentConfig, repoId, taskId)) {
                        URL.revokeObjectURL(processed.dataUrl)
                        return
                    }
                    setTaskImageAttachments((current) => [...current, { attachment: processed.attachment, dataUrl: processed.dataUrl }])
                })
                .catch((err) => {
                    if (isActiveTaskScope(currentConfig, repoId, taskId)) setError(remoteErrorMessage(err, "Unable to attach image"))
                })
                .finally(() => {
                    if (matchesCurrentTaskSelection(currentConfig, repoId, taskId)) setTaskImageAttachLoading(false)
                })
        },
        [commandType, config, selectedRepo?.id, selectedTaskId]
    )

    const handleAttachNewTaskImage = useCallback(
        (file: File) => {
            const activeScope = activeNewTaskScopeForHandler(config, newTaskRepoId ?? selectedRepo?.id ?? null)
            if (!activeScope) return
            const currentConfig = activeScope.config
            const repoId = activeScope.repoId
            const currentCapabilities = shellCapabilitiesForRemoteConfig(currentConfig)
            if (!currentCapabilities.taskImageCapabilities.canWrite || !currentCapabilities.taskTurnCapabilities.canStart) return
            setNewTaskImageAttachLoading(true)
            setError(null)
            void processImageBlob(file, {
                persistImage: async (payload) => {
                    await getRemoteProductStore(currentConfig).writeTaskImage(imagePersistencePayloadToWriteRequest(payload), {
                        clientRequestId: newClientRequestId("remote-new-task-image-write"),
                    })
                },
            })
                .then((processed) => {
                    if (!isActiveNewTaskScope(currentConfig, repoId)) {
                        URL.revokeObjectURL(processed.dataUrl)
                        return
                    }
                    setNewTaskImageAttachments((current) => [...current, { attachment: processed.attachment, dataUrl: processed.dataUrl }])
                })
                .catch((err) => {
                    if (isActiveNewTaskScope(currentConfig, repoId)) setError(remoteErrorMessage(err, "Unable to attach image"))
                })
                .finally(() => {
                    if (matchesCurrentNewTaskSelection(currentConfig, repoId)) setNewTaskImageAttachLoading(false)
                })
        },
        [config, newTaskRepoId, selectedRepo?.id]
    )

    const handleRemoveTaskImage = (imageId: string) => {
        setTaskImageAttachments((current) => {
            const removed = current.find((item) => item.attachment.id === imageId)
            if (removed) revokeTaskComposerImageAttachments([removed])
            return current.filter((item) => item.attachment.id !== imageId)
        })
    }

    const handleRemoveNewTaskImage = (imageId: string) => {
        setNewTaskImageAttachments((current) => {
            const removed = current.find((item) => item.attachment.id === imageId)
            if (removed) revokeTaskComposerImageAttachments([removed])
            return current.filter((item) => item.attachment.id !== imageId)
        })
    }

    const buildCurrentNewTaskDraft = (configId: string, repoId: string): RemoteNewTaskDraft | null => {
        const images = copyTaskComposerImageAttachments(newTaskImageAttachments)
        if (!newTaskTitle.trim() && !newTaskPrompt.trim() && images.length === 0) return null
        const currentCapabilities = shellCapabilitiesForRemoteConfig(configRef.current)
        const harnessId = agentHarnessId
        return {
            id: newClientRequestId("remote-new-task-draft"),
            configId,
            repoId,
            createdAt: new Date().toISOString(),
            title: newTaskTitle,
            prompt: newTaskPrompt,
            mode: isRemoteNewTaskCommandType(newTaskMode) ? newTaskMode : "do",
            isolationStrategy: isolationStrategyForBranchCapability(newTaskIsolationStrategy, currentCapabilities.projectGitCapabilities.canReadBranches),
            hyperplanPresetId: newTaskHyperplanPresetId,
            createMore: newTaskCreateMore,
            mcpServerIds: [...newTaskMcpServerIds],
            harnessId,
            modelId: getVisibleModelId(agentModelId, harnessId),
            thinking: agentThinking,
            fastMode: agentFastMode,
            images,
        }
    }

    const resetNewTaskDraftFields = () => {
        setNewTaskTitle("")
        setNewTaskPrompt("")
        setNewTaskMode("do")
        setNewTaskIsolationStrategy({ type: "head" })
        setNewTaskBranches(null)
        setNewTaskMcpServerIds([])
        setNewTaskHyperplanPresetId("ensemble")
    }

    const persistNewTaskPreference = (patch: Partial<RemoteNewTaskPreference>) => {
        const currentConfig = configRef.current
        const repoId = newTaskRepoIdRef.current ?? selectedRepoIdRef.current
        if (!currentConfig || !repoId) return null
        return writeRemoteNewTaskPreference(currentConfig.id, repoId, patch)
    }

    const handleNewTaskCreateMoreChange = (value: boolean) => {
        setNewTaskCreateMore(value)
        persistNewTaskPreference({ createMore: value })
    }

    const handleNewTaskIsolationStrategyChange = (strategy: OpenADEIsolationStrategy) => {
        const visibleStrategy = isolationStrategyForBranchCapability(
            strategy,
            shellCapabilitiesForRemoteConfig(configRef.current).projectGitCapabilities.canReadBranches
        )
        setNewTaskIsolationStrategy(visibleStrategy)
        if (visibleStrategy.type !== "worktree") return

        setNewTaskPreferredSourceBranch(visibleStrategy.sourceBranch)
        persistNewTaskPreference({ sourceBranch: visibleStrategy.sourceBranch })
    }

    const restoreNewTaskDraft = (draft: RemoteNewTaskDraft) => {
        selectNewTaskRepo(draft.repoId)
        setNewTaskTitle(draft.title)
        setNewTaskPrompt(draft.prompt)
        setNewTaskMode(draft.mode)
        setNewTaskIsolationStrategy(draft.isolationStrategy)
        setNewTaskHyperplanPresetId(draft.hyperplanPresetId)
        handleNewTaskCreateMoreChange(draft.createMore)
        if (draft.isolationStrategy.type === "worktree") {
            setNewTaskPreferredSourceBranch(draft.isolationStrategy.sourceBranch)
            persistNewTaskPreference({ sourceBranch: draft.isolationStrategy.sourceBranch })
        }
        setNewTaskMcpServerIds(draft.mcpServerIds)
        setAgentHarnessId(draft.harnessId)
        setAgentModelId(getVisibleModelId(draft.modelId, draft.harnessId))
        setAgentThinking(draft.thinking)
        setAgentFastMode(draft.fastMode)
        setNewTaskImageAttachments(copyTaskComposerImageAttachments(draft.images))
    }

    const handleStashNewTaskDraft = () => {
        const activeScope = activeNewTaskScopeForHandler(config, newTaskComposerRepoId)
        if (!activeScope) return
        const draft = buildCurrentNewTaskDraft(activeScope.config.id, activeScope.repoId)
        if (!draft) return
        updateNewTaskDrafts((current) => [draft, ...current.filter((candidate) => candidate.id !== draft.id)])
        setNewTaskImageAttachments([])
        resetNewTaskDraftFields()
    }

    const handleRestoreNewTaskDraft = (draftId: string) => {
        if (newTaskImageAttachments.length > 0) return
        const targetDraft = newTaskDrafts.find((draft) => draft.id === draftId)
        if (!targetDraft || targetDraft.configId !== config?.id || targetDraft.repoId !== newTaskComposerRepoId) return
        const currentRepoId = newTaskRepoId ?? selectedRepo?.id ?? null
        const currentDraft = currentRepoId ? buildCurrentNewTaskDraft(targetDraft.configId, currentRepoId) : null
        updateNewTaskDrafts((current) => {
            const withoutTarget = current.filter((draft) => draft.id !== draftId)
            return currentDraft ? [currentDraft, ...withoutTarget] : withoutTarget
        })
        restoreNewTaskDraft(targetDraft)
    }

    const handleDeleteNewTaskDraft = (draftId: string) => {
        updateNewTaskDrafts((current) => {
            for (const draft of current) {
                if (draft.id === draftId) revokeTaskComposerImageAttachments(draft.images)
            }
            return current.filter((draft) => draft.id !== draftId)
        })
    }

    const taskTerminalProductAccess = useMemo<TaskTerminalProductAccess | null>(() => {
        if (!config || !selectedRepoId || !selectedTaskId) return null
        const capabilities = shellCapabilities.taskTerminalCapabilities
        if (!capabilities.canStart && !capabilities.canReconnect) return null
        const repoId = selectedRepoId
        const taskId = selectedTaskId
        const renderConfig = config
        const deniedStartResult = { repoId, taskId, terminalId: "", ok: false, error: "terminal start is not permitted" }
        const deniedReconnectResult = { repoId, taskId, terminalId: "", found: false, output: [], outputCount: 0 }
        const deniedMutationResult = (terminalId: string) => ({ repoId, taskId, terminalId, ok: false })
        const activeTerminalConfig = () => {
            const currentConfig = activeRemoteConfigForHandler(renderConfig, configRef.current)
            if (!currentConfig || selectedRepoIdRef.current !== repoId || selectedTaskIdRef.current !== taskId) return null
            return currentConfig
        }
        return {
            repoId,
            taskId,
            capabilities,
            startTaskTerminal: (args) => {
                const currentConfig = activeTerminalConfig()
                if (!currentConfig || !shellCapabilitiesForRemoteConfig(currentConfig).taskTerminalCapabilities.canStart)
                    return Promise.resolve(deniedStartResult)
                return getRemoteProductStore(currentConfig).startTaskTerminal({ repoId, taskId, ...args })
            },
            reconnectTaskTerminal: (args) => {
                const currentConfig = activeTerminalConfig()
                if (!currentConfig || !shellCapabilitiesForRemoteConfig(currentConfig).taskTerminalCapabilities.canReconnect)
                    return Promise.resolve({ ...deniedReconnectResult, terminalId: args.terminalId ?? "" })
                return getRemoteProductStore(currentConfig).reconnectTaskTerminal({ repoId, taskId, ...args })
            },
            writeTaskTerminal: (args) => {
                const currentConfig = activeTerminalConfig()
                if (!currentConfig || !shellCapabilitiesForRemoteConfig(currentConfig).taskTerminalCapabilities.canWrite)
                    return Promise.resolve(deniedMutationResult(args.terminalId))
                return getRemoteProductStore(currentConfig).writeTaskTerminal({ repoId, taskId, ...args })
            },
            resizeTaskTerminal: (args) => {
                const currentConfig = activeTerminalConfig()
                if (!currentConfig || !shellCapabilitiesForRemoteConfig(currentConfig).taskTerminalCapabilities.canResize)
                    return Promise.resolve(deniedMutationResult(args.terminalId))
                return getRemoteProductStore(currentConfig).resizeTaskTerminal({ repoId, taskId, ...args })
            },
            stopTaskTerminal: (args) => {
                const currentConfig = activeTerminalConfig()
                if (!currentConfig || !shellCapabilitiesForRemoteConfig(currentConfig).taskTerminalCapabilities.canStop)
                    return Promise.resolve(deniedMutationResult(args.terminalId))
                return getRemoteProductStore(currentConfig).stopTaskTerminal({ repoId, taskId, ...args })
            },
        }
    }, [config, selectedRepoId, selectedTaskId, shellCapabilities.taskTerminalCapabilities])

    useLayoutEffect(() => {
        selectedRepoIdRef.current = selectedRepoId
        selectedTaskIdRef.current = selectedTaskId
        screenRef.current = screen
        configRef.current = config
        snapshotRef.current = snapshot
        newTaskDraftsRef.current = newTaskDrafts
        newTaskPendingCreationsRef.current = newTaskPendingCreations
    }, [selectedRepoId, selectedTaskId, screen, config, snapshot, newTaskDrafts, newTaskPendingCreations])

    useEffect(() => {
        return () => {
            if (snapshotRefreshTimerRef.current) window.clearTimeout(snapshotRefreshTimerRef.current)
            if (taskRefreshTimerRef.current) window.clearTimeout(taskRefreshTimerRef.current)
            if (projectTaskListRefreshTimerRef.current) window.clearTimeout(projectTaskListRefreshTimerRef.current)
            projectTaskListRefreshPendingRef.current.clear()
            acceptedActionStartNotificationsRef.current.clear()
            acceptedMutationNotificationsRef.current.clear()
            for (const draft of newTaskDraftsRef.current) revokeTaskComposerImageAttachments(draft.images)
        }
    }, [])

    const syncConfigs = () => {
        setConfigs(loadRemoteConfigs())
    }

    const resetRemoteView = () => {
        snapshotRef.current = null
        setSnapshot(null)
        setSelectedRepoState(null)
        setSelectedTaskState(null)
        setTask(null)
        clearTaskImageAttachments()
        clearNewTaskImageAttachments()
        setNewTaskRepoState(null)
        setNewTaskIsolationStrategy({ type: "head" })
        setNewTaskBranches(null)
        setNewTaskBranchesLoading(false)
        setNewTaskMcpServerIds([])
        setMcpServers([])
        setMcpServersLoaded(false)
        setMcpServersLoading(false)
        setRawConnectionStatus("disconnected")
        acceptedActionStartNotificationsRef.current.clear()
        acceptedMutationNotificationsRef.current.clear()
        setScreenState("projects")
    }

    useEffect(() => {
        const updateFromUrl = () => {
            const params = parseDeepLinkParams()
            if (params.baseUrl) setBaseUrl(params.baseUrl)
            if (params.token) setPairToken(params.token)
            if (params.hostId) setPairHostId(params.hostId)
        }
        window.addEventListener("openade-pairing-url", updateFromUrl)
        return () => window.removeEventListener("openade-pairing-url", updateFromUrl)
    }, [])

    const applySnapshotResult = (nextConfig: RemoteConfig, next: OpenADESnapshot, options: SnapshotRefreshOptions = {}): OpenADESnapshot => {
        setSessionSnapshots((current) => ({ ...current, [nextConfig.id]: next }))
        if (!isActiveRemoteConfig(nextConfig)) return next

        const currentRepoId = selectedRepoIdRef.current
        const currentTaskId = selectedTaskIdRef.current
        const shouldRepairNavigation = options.repairNavigation === true
        const nextRepoId = currentRepoId && next.repos.some((repo) => repo.id === currentRepoId) ? currentRepoId : null
        const nextRepo = next.repos.find((repo) => repo.id === nextRepoId) ?? null

        snapshotRef.current = next
        setSnapshot(next)
        if (nextRepoId || shouldRepairNavigation) setSelectedRepoState(nextRepoId)
        {
            const currentNewTaskRepoId = newTaskRepoIdRef.current
            const nextNewTaskRepoId =
                currentNewTaskRepoId && next.repos.some((repo) => repo.id === currentNewTaskRepoId)
                    ? currentNewTaskRepoId
                    : (nextRepoId ?? next.repos.find((repo) => !repo.archived)?.id ?? next.repos[0]?.id ?? null)
            selectNewTaskRepo(nextNewTaskRepoId)
        }

        if (currentRepoId && !nextRepoId && shouldRepairNavigation) {
            setSelectedTaskState(null)
            setTask(null)
            if (screenRef.current === "project" || screenRef.current === "task") setScreenState("projects")
        } else if (currentTaskId && !nextRepo?.tasks.some((item) => item.id === currentTaskId) && shouldRepairNavigation) {
            setSelectedTaskState(null)
            setTask(null)
            if (screenRef.current === "task") setScreenState(nextRepoId ? "project" : "projects")
        }

        return next
    }

    const applyProjectTaskListResult = (
        nextConfig: RemoteConfig,
        repoId: string,
        tasks: OpenADETaskPreview[],
        options: SnapshotRefreshOptions = {}
    ): OpenADESnapshot | null => {
        if (!isActiveRemoteConfig(nextConfig)) return snapshotRef.current
        const current = snapshotRef.current ?? getRemoteProductStore(nextConfig).snapshot
        if (!current || !current.repos.some((repo) => repo.id === repoId)) return current
        return applySnapshotResult(
            nextConfig,
            {
                ...current,
                repos: current.repos.map((repo) => (repo.id === repoId ? { ...repo, tasks } : repo)),
            },
            options
        )
    }

    const applyWorkingTaskIdsResult = (nextConfig: RemoteConfig, taskIds: string[]): OpenADESnapshot | null => {
        if (!isActiveRemoteConfig(nextConfig)) return snapshotRef.current
        const current = snapshotRef.current ?? getRemoteProductStore(nextConfig).snapshot
        if (!current) return null
        return applySnapshotResult(nextConfig, {
            ...current,
            workingTaskIds: taskIds,
        })
    }

    const refreshSnapshot = async (nextConfig = config, options: SnapshotRefreshOptions = {}): Promise<OpenADESnapshot | null> => {
        if (!nextConfig) return null
        try {
            const next = await retryRemoteRead(() =>
                getRemoteProductStore(nextConfig).refreshSnapshot({
                    bypassCache: options.bypassCache === true,
                })
            )
            return applySnapshotResult(nextConfig, next, options)
        } catch (err) {
            if (isUnavailableOpenADEMethod(err, OPENADE_METHOD.snapshotRead)) return snapshotRef.current ?? getRemoteProductStore(nextConfig).snapshot
            throw err
        }
    }

    const refreshProjectProjection = async (nextConfig = config, options: SnapshotRefreshOptions = {}): Promise<OpenADESnapshot | null> => {
        if (!nextConfig) return null
        const currentCapabilities = shellCapabilitiesForRemoteConfig(nextConfig)
        const store = getRemoteProductStore(nextConfig)
        const current = snapshotRef.current ?? store.snapshot
        const initializedCapabilities =
            currentCapabilities.projectDirectoryCapabilities.canReadSnapshot || currentCapabilities.projectDirectoryCapabilities.canReadProjects
                ? currentCapabilities
                : buildOpenADEShellCapabilities(await getRemoteRuntimeCapabilitiesAfterConnect(nextConfig))
        const canReadSnapshot = initializedCapabilities.projectDirectoryCapabilities.canReadSnapshot
        const canReadProjects = initializedCapabilities.projectDirectoryCapabilities.canReadProjects
        const readProjectListProjection = async (baseSnapshot: OpenADESnapshot | null): Promise<OpenADESnapshot | null> => {
            const projectionCapabilities = shellCapabilitiesForRemoteConfig(nextConfig)
            const [repos, workingTaskIds] = await Promise.all([
                retryRemoteRead(() =>
                    store.listProjects({
                        bypassCache: options.bypassCache === true,
                    })
                ),
                retryRemoteRead(() => workingTaskIdsForProjectProjection(nextConfig, projectionCapabilities, baseSnapshot)),
            ])
            return applySnapshotResult(
                nextConfig,
                {
                    ...snapshotFromProjectList(nextConfig, repos, baseSnapshot),
                    workingTaskIds,
                },
                options
            )
        }

        if (canReadProjects) {
            try {
                return await readProjectListProjection(current)
            } catch (err) {
                if (!canReadSnapshot && isUnavailableOpenADEMethod(err, OPENADE_METHOD.projectList)) return current
                if (!canReadSnapshot) throw err
                if (!isUnavailableOpenADEMethod(err, OPENADE_METHOD.projectList)) throw err
                // Fall through to snapshot for older runtimes whose advertised project-list capability is stale.
            }
        }

        if (canReadSnapshot) {
            try {
                const snapshotResult = await refreshSnapshot(nextConfig, options)
                if (snapshotResult) return snapshotResult
            } catch (err) {
                if (isUnavailableOpenADEMethod(err, OPENADE_METHOD.snapshotRead)) return current
                throw err
            }
        }

        return current
    }

    const refreshProjectTaskList = async (
        nextConfig = config,
        repoId: string | null | undefined = selectedRepoIdRef.current,
        options: SnapshotRefreshOptions = {}
    ): Promise<OpenADETaskPreview[] | null> => {
        if (!nextConfig || !repoId) return null
        if (!isActiveRemoteConfig(nextConfig)) return null
        if (!shellCapabilitiesForRemoteConfig(nextConfig).taskDirectoryCapabilities.canList) return null
        const tasks = await retryRemoteRead(() =>
            getRemoteProductStore(nextConfig).listTasks(repoId, {
                bypassCache: options.bypassCache === true,
            })
        )
        applyProjectTaskListResult(nextConfig, repoId, tasks, options)
        return tasks
    }

    const syncCachedProductState = (nextConfig: RemoteConfig, repoId: string, taskId: string): boolean => {
        if (!isActiveRemoteConfig(nextConfig)) return false
        const store = getRemoteProductStore(nextConfig)
        if (store.snapshot) applySnapshotResult(nextConfig, store.snapshot)
        const cachedTask = store.getCachedTask(repoId, taskId)
        if (!cachedTask) return false
        if (isActiveTaskScope(nextConfig, repoId, taskId)) setTask(cachedTask)
        return true
    }

    const refreshTask = async (
        nextConfig = config,
        repoId: string | null | undefined = selectedRepoIdRef.current ?? selectedRepo?.id,
        taskId: string | null | undefined = selectedTaskIdRef.current,
        options: TaskRefreshOptions = { hydrateSessionEvents: false }
    ) => {
        if (!nextConfig || !repoId || !taskId) return
        if (!isActiveRemoteConfig(nextConfig)) return
        if (!shellCapabilitiesForRemoteConfig(nextConfig).taskDirectoryCapabilities.canRead) return
        const hydrateSessionEvents = options.hydrateSessionEvents ?? false
        const taskOptions =
            hydrateSessionEvents === true
                ? { hydrateSessionEvents }
                : { hydrateSessionEvents, eventLimit: options.eventLimit ?? REMOTE_LIGHTWEIGHT_TASK_EVENT_LIMIT }
        const nextTask = await retryRemoteRead(() => {
            const store = getRemoteProductStore(nextConfig)
            return options.bypassCache === true ? store.refreshTask(repoId, taskId, taskOptions) : store.getTask(repoId, taskId, taskOptions)
        })
        if (isActiveTaskScope(nextConfig, repoId, taskId)) setTask(nextTask)
        return nextTask
    }

    const refreshTaskProjection = async (
        nextConfig = config,
        repoId: string | null | undefined = selectedRepoIdRef.current ?? selectedRepo?.id,
        taskId: string | null | undefined = selectedTaskIdRef.current,
        options: SnapshotRefreshOptions = {}
    ): Promise<void> => {
        if (!nextConfig || !repoId || !taskId) return
        const [taskList] = await Promise.all([
            refreshProjectTaskList(nextConfig, repoId, {
                repairNavigation: options.repairNavigation,
                bypassCache: options.bypassCache === true,
            }),
            refreshTask(nextConfig, repoId, taskId, {
                hydrateSessionEvents: false,
                bypassCache: true,
            }),
        ])
        if (!taskList) {
            await refreshProjectProjection(nextConfig, {
                repairNavigation: options.repairNavigation,
                bypassCache: true,
            })
        }
    }

    const refreshProjectProcesses = async (nextConfig = config, repoId: string | null | undefined = selectedRepoIdRef.current) => {
        if (!nextConfig || !isActiveRemoteConfig(nextConfig)) return null
        if (!repoId) {
            setProjectProcesses(null)
            setProjectProcessOutput(null)
            return null
        }
        if (!isActiveProjectPanelScope(nextConfig, repoId)) return null
        const nextCapabilities = shellCapabilitiesForRemoteConfig(nextConfig).projectProcessCapabilities
        if (!nextCapabilities.canRead) {
            setProjectProcesses(null)
            setProjectProcessOutput(null)
            return null
        }
        setProjectProcessesLoading(true)
        try {
            const result = await retryRemoteRead(() => getRemoteProductStore(nextConfig).listProjectProcesses({ repoId }))
            if (isActiveProjectPanelScope(nextConfig, repoId)) setProjectProcesses(result)
            return result
        } finally {
            if (isActiveProjectPanelScope(nextConfig, repoId)) setProjectProcessesLoading(false)
        }
    }

    const refreshProjectFiles = async (nextConfig = config, repoId: string | null | undefined = selectedRepoIdRef.current) => {
        if (!nextConfig || !isActiveRemoteConfig(nextConfig)) return null
        if (!repoId) {
            setProjectFiles(null)
            return null
        }
        if (!isActiveProjectPanelScope(nextConfig, repoId)) return null
        const nextCapabilities = shellCapabilitiesForRemoteConfig(nextConfig).projectFileCapabilities
        if (!nextCapabilities.canList) {
            setProjectFiles(null)
            setProjectFileRead(null)
            return null
        }
        setProjectFilesLoading(true)
        try {
            const result = await retryRemoteRead(() =>
                getRemoteProductStore(nextConfig).listProjectFiles({
                    repoId,
                    maxDepth: 2,
                    maxEntries: 40,
                })
            )
            if (isActiveProjectPanelScope(nextConfig, repoId)) setProjectFiles(result)
            return result
        } finally {
            if (isActiveProjectPanelScope(nextConfig, repoId)) setProjectFilesLoading(false)
        }
    }

    const refreshProjectGit = async (nextConfig = config, repoId: string | null | undefined = selectedRepoIdRef.current) => {
        if (!nextConfig || !isActiveRemoteConfig(nextConfig)) return null
        if (!repoId) {
            setProjectGitInfo(null)
            setProjectGitBranches(null)
            setProjectGitSummary(null)
            return null
        }
        if (!isActiveProjectPanelScope(nextConfig, repoId)) return null
        const nextCapabilities = shellCapabilitiesForRemoteConfig(nextConfig).projectGitCapabilities
        const canReadAnyGit = nextCapabilities.canReadInfo || nextCapabilities.canReadBranches || nextCapabilities.canReadSummary
        if (!canReadAnyGit) {
            setProjectGitInfo(null)
            setProjectGitBranches(null)
            setProjectGitSummary(null)
            return null
        }
        setProjectGitLoading(true)
        try {
            const store = getRemoteProductStore(nextConfig)
            const result = await retryRemoteRead(() =>
                Promise.all([
                    nextCapabilities.canReadInfo ? store.readProjectGitInfo({ repoId }) : Promise.resolve(null),
                    nextCapabilities.canReadBranches ? store.readProjectGitBranches({ repoId }) : Promise.resolve(null),
                    nextCapabilities.canReadSummary ? store.readProjectGitSummary({ repoId }, { bypassCache: true }) : Promise.resolve(null),
                ])
            )
            if (isActiveProjectPanelScope(nextConfig, repoId)) {
                setProjectGitInfo(result[0])
                setProjectGitBranches(result[1])
                setProjectGitSummary(result[2])
            }
            return result
        } finally {
            if (isActiveProjectPanelScope(nextConfig, repoId)) setProjectGitLoading(false)
        }
    }

    const refreshNewTaskBranches = async (repoId = newTaskRepoIdRef.current ?? selectedRepoIdRef.current, nextConfig = config) => {
        if (!nextConfig || !isActiveRemoteConfig(nextConfig)) return null
        if (!shellCapabilitiesForRemoteConfig(nextConfig).projectGitCapabilities.canReadBranches) {
            setNewTaskBranches(null)
            setNewTaskIsolationStrategy({ type: "head" })
            return null
        }
        if (!repoId) {
            setNewTaskBranches(null)
            setNewTaskIsolationStrategy({ type: "head" })
            return null
        }
        setNewTaskBranchesLoading(true)
        try {
            const result = await retryRemoteRead(() => getRemoteProductStore(nextConfig).readProjectGitBranches({ repoId }))
            const currentRepoId = newTaskRepoIdRef.current ?? selectedRepoIdRef.current
            if (isActiveRemoteConfig(nextConfig) && currentRepoId === repoId) setNewTaskBranches(result)
            return result
        } finally {
            if (isActiveRemoteConfig(nextConfig)) setNewTaskBranchesLoading(false)
        }
    }

    const refreshProjectCronInstallState = async (nextConfig = config, repoId: string | null | undefined = selectedRepoIdRef.current) => {
        if (!nextConfig || !isActiveRemoteConfig(nextConfig)) return null
        if (!repoId) {
            setProjectCronInstallState(null)
            return null
        }
        if (!isActiveProjectPanelScope(nextConfig, repoId)) return null
        if (!shellCapabilitiesForRemoteConfig(nextConfig).projectCronCapabilities.canReadInstallState) {
            setProjectCronInstallState(null)
            return null
        }
        setProjectCronInstallStateLoading(true)
        try {
            const result = await retryRemoteRead(() => getRemoteProductStore(nextConfig).readCronInstallState({ repoId }))
            if (isActiveProjectPanelScope(nextConfig, repoId)) setProjectCronInstallState(result)
            return result
        } finally {
            if (isActiveProjectPanelScope(nextConfig, repoId)) setProjectCronInstallStateLoading(false)
        }
    }

    const refreshProjectCronDefinitions = async (nextConfig = config, repoId: string | null | undefined = selectedRepoIdRef.current) => {
        if (!nextConfig || !isActiveRemoteConfig(nextConfig)) return null
        if (!repoId) {
            setProjectCronDefinitions(null)
            setProjectCronInstallState(null)
            return null
        }
        if (!isActiveProjectPanelScope(nextConfig, repoId)) return null
        const nextCapabilities = shellCapabilitiesForRemoteConfig(nextConfig)
        if (!nextCapabilities.projectCronCapabilities.canRead) {
            setProjectCronDefinitions(null)
            setProjectCronInstallState(null)
            return null
        }
        setProjectCronDefinitionsLoading(true)
        try {
            const result = await retryRemoteRead(() => getRemoteProductStore(nextConfig).readCronDefinitions({ repoId }))
            if (isActiveProjectPanelScope(nextConfig, repoId)) setProjectCronDefinitions(result)
            if (nextCapabilities.projectCronCapabilities.canReadInstallState) {
                await refreshProjectCronInstallState(nextConfig, repoId)
            }
            return result
        } finally {
            if (isActiveProjectPanelScope(nextConfig, repoId)) setProjectCronDefinitionsLoading(false)
        }
    }

    const refreshTaskGit = async (
        nextConfig = config,
        repoId: string | null | undefined = selectedRepoIdRef.current,
        taskId: string | null | undefined = selectedTaskIdRef.current
    ) => {
        if (!nextConfig || !isActiveRemoteConfig(nextConfig)) return null
        if (!repoId || !taskId) {
            if (screenRef.current === "task") {
                setTaskChanges(null)
                setTaskGitLog(null)
                setTaskGitSummary(null)
                setTaskGitScopes(null)
            }
            return null
        }
        if (!isActiveTaskScope(nextConfig, repoId, taskId)) return null
        const nextCapabilities = shellCapabilitiesForRemoteConfig(nextConfig).taskGitCapabilities
        const canReadAnyTaskGit =
            nextCapabilities.canReadChanges || nextCapabilities.canReadLog || nextCapabilities.canReadSummary || nextCapabilities.canReadScopes
        if (!canReadAnyTaskGit) {
            setTaskChanges(null)
            setTaskGitLog(null)
            setTaskGitSummary(null)
            setTaskGitScopes(null)
            return null
        }
        setTaskChangesLoading(true)
        try {
            const [changes, gitLog, gitSummary, gitScopes] = await retryRemoteRead(() => {
                const store = getRemoteProductStore(nextConfig)
                return Promise.all([
                    nextCapabilities.canReadChanges ? store.readTaskChanges({ repoId, taskId }) : Promise.resolve(null),
                    nextCapabilities.canReadLog ? store.readTaskGitLog({ repoId, taskId, limit: 5 }) : Promise.resolve(null),
                    nextCapabilities.canReadSummary ? store.readTaskGitSummary({ repoId, taskId }, { bypassCache: true }) : Promise.resolve(null),
                    nextCapabilities.canReadScopes ? store.readTaskGitScopes({ repoId, taskId }) : Promise.resolve(null),
                ])
            })
            if (isActiveTaskScope(nextConfig, repoId, taskId)) {
                setTaskChanges(changes)
                setTaskGitLog(gitLog)
                setTaskGitSummary(gitSummary)
                setTaskGitScopes(gitScopes)
            }
            return { changes, gitLog, gitSummary, gitScopes }
        } finally {
            if (isActiveTaskScope(nextConfig, repoId, taskId)) setTaskChangesLoading(false)
        }
    }

    const runBackgroundRefresh = async (work: () => Promise<void>, fallback: string) => {
        try {
            await work()
        } catch (err) {
            if (!isTransientRemoteRefreshError(err)) setError(remoteErrorMessage(err, fallback))
        }
    }

    const loadMcpServers = async (nextConfig = config) => {
        const currentConfig = activeRemoteConfigForHandler(nextConfig, configRef.current)
        if (!currentConfig || !shellCapabilitiesForRemoteConfig(currentConfig).settingsCapabilities.mcpServers.canRead) {
            setMcpServers([])
            setMcpServersLoaded(false)
            setMcpServersLoading(false)
            return null
        }
        setMcpServersLoading(true)
        try {
            const result = await retryRemoteRead(() => getRemoteProductStore(currentConfig).readMcpServers())
            if (configRef.current?.id === currentConfig.id) {
                setMcpServers(result.servers)
                setMcpServersLoaded(true)
            }
            return result
        } finally {
            if (configRef.current?.id === currentConfig.id) setMcpServersLoading(false)
        }
    }

    const loadPersonalSettings = async (nextConfig = config) => {
        const currentConfig = activeRemoteConfigForHandler(nextConfig, configRef.current)
        if (!currentConfig || !shellCapabilitiesForRemoteConfig(currentConfig).settingsCapabilities.personalSettings.canRead) {
            setPersonalSettings(null)
            setPersonalSettingsLoading(false)
            return null
        }
        setPersonalSettingsLoading(true)
        try {
            const result = await retryRemoteRead(() => getRemoteProductStore(currentConfig).readPersonalSettings())
            if (configRef.current?.id === currentConfig.id) {
                setPersonalSettings(result.settings)
                applyPersonalSettingsAgentDefaults(result.settings)
            }
            return result
        } finally {
            if (configRef.current?.id === currentConfig.id) setPersonalSettingsLoading(false)
        }
    }

    useEffect(() => {
        if (!config || !mcpServerCapabilities.canRead) {
            setMcpServers([])
            setMcpServersLoaded(false)
            setMcpServersLoading(false)
            return
        }
        if (screen !== "settings") return
        const currentConfig = config
        void runBackgroundRefresh(async () => {
            await loadMcpServers(currentConfig)
        }, "Unable to load connectors")
    }, [config, mcpServerCapabilities.canRead, screen])

    useEffect(() => {
        if (mcpServerCapabilities.canRead && shellCapabilities.taskRecordCapabilities.canCreate) return
        if (newTaskMcpServerIds.length > 0) setNewTaskMcpServerIds([])
    }, [mcpServerCapabilities.canRead, newTaskMcpServerIds.length, shellCapabilities.taskRecordCapabilities.canCreate])

    useEffect(() => {
        if (!config || !personalSettingsCapabilities.canRead) {
            setPersonalSettings(null)
            setPersonalSettingsLoading(false)
            return
        }
        if (screen !== "settings" && screen !== "new_task") return
        const currentConfig = config
        void runBackgroundRefresh(async () => {
            await loadPersonalSettings(currentConfig)
        }, "Unable to load preferences")
    }, [config, personalSettingsCapabilities.canRead, screen])

    const scheduleSnapshotRefresh = (delayMs = 300, options: SnapshotRefreshOptions = {}) => {
        snapshotRefreshRepairsNavigationRef.current = snapshotRefreshRepairsNavigationRef.current || options.repairNavigation === true
        if (snapshotRefreshTimerRef.current) window.clearTimeout(snapshotRefreshTimerRef.current)
        snapshotRefreshTimerRef.current = window.setTimeout(() => {
            const repairNavigation = snapshotRefreshRepairsNavigationRef.current
            snapshotRefreshRepairsNavigationRef.current = false
            void runBackgroundRefresh(async () => {
                await refreshProjectProjection(configRef.current, {
                    repairNavigation,
                    bypassCache: options.bypassCache === true,
                })
            }, "Unable to refresh projects")
        }, delayMs)
    }

    const cancelPendingTaskRefresh = (repoId?: string, taskId?: string) => {
        const pending = taskRefreshPendingRef.current
        if (!pending) return
        if (repoId && pending.repoId !== repoId) return
        if (taskId && pending.taskId !== taskId) return

        if (taskRefreshTimerRef.current) window.clearTimeout(taskRefreshTimerRef.current)
        taskRefreshTimerRef.current = null
        taskRefreshPendingRef.current = null
    }

    const runQueuedTaskRefresh = async () => {
        taskRefreshTimerRef.current = null
        const pending = taskRefreshPendingRef.current
        taskRefreshPendingRef.current = null
        if (!pending) return

        taskRefreshInFlightRef.current = true
        try {
            await runBackgroundRefresh(async () => {
                await refreshTask(configRef.current, pending.repoId, pending.taskId, {
                    hydrateSessionEvents: false,
                    bypassCache: true,
                })
            }, "Unable to refresh task")
        } finally {
            lastTaskRefreshAtRef.current = Date.now()
            taskRefreshInFlightRef.current = false
            const nextPending = taskRefreshPendingRef.current
            if (nextPending) scheduleTaskRefresh(nextPending)
        }
    }

    const scheduleTaskRefresh = (pending: PendingTaskRefresh | null, delayMs = 150) => {
        if (!pending) return
        taskRefreshPendingRef.current = pending
        if (taskRefreshTimerRef.current || taskRefreshInFlightRef.current) return
        taskRefreshTimerRef.current = window.setTimeout(
            () => {
                void runQueuedTaskRefresh()
            },
            nextRemoteRefreshDelay({
                now: Date.now(),
                lastRefreshAt: lastTaskRefreshAtRef.current,
                requestedDelayMs: delayMs,
            })
        )
    }

    const runQueuedProjectTaskListRefresh = async () => {
        projectTaskListRefreshTimerRef.current = null
        const pending = [...projectTaskListRefreshPendingRef.current.values()]
        projectTaskListRefreshPendingRef.current.clear()
        if (pending.length === 0) return

        projectTaskListRefreshInFlightRef.current = true
        try {
            await runBackgroundRefresh(async () => {
                const currentConfig = configRef.current
                if (!currentConfig) return
                const currentCapabilities = shellCapabilitiesForRemoteConfig(currentConfig)
                for (const item of pending) {
                    if (!currentCapabilities.taskDirectoryCapabilities.canList) {
                        await refreshProjectProjection(currentConfig, {
                            repairNavigation: item.repairNavigation,
                            bypassCache: true,
                        })
                        continue
                    }
                    const tasks = await refreshProjectTaskList(currentConfig, item.repoId, {
                        repairNavigation: item.repairNavigation,
                        bypassCache: true,
                    })
                    if (!tasks)
                        await refreshProjectProjection(currentConfig, {
                            repairNavigation: item.repairNavigation,
                            bypassCache: true,
                        })
                }
            }, "Unable to refresh project tasks")
        } finally {
            projectTaskListRefreshInFlightRef.current = false
            if (projectTaskListRefreshPendingRef.current.size > 0) scheduleProjectTaskListRefresh(null)
        }
    }

    const scheduleProjectTaskListRefresh = (pending: PendingProjectTaskListRefresh | null, delayMs = 150) => {
        if (pending) {
            const existing = projectTaskListRefreshPendingRef.current.get(pending.repoId)
            projectTaskListRefreshPendingRef.current.set(pending.repoId, {
                repoId: pending.repoId,
                repairNavigation: existing?.repairNavigation === true || pending.repairNavigation,
            })
        }
        if (projectTaskListRefreshTimerRef.current || projectTaskListRefreshInFlightRef.current) return
        projectTaskListRefreshTimerRef.current = window.setTimeout(() => {
            void runQueuedProjectTaskListRefresh()
        }, delayMs)
    }

    const refreshAll = async (options: SnapshotRefreshOptions = {}) => {
        const currentConfig = activeRemoteConfigForHandler(config, configRef.current)
        if (!currentConfig) return
        setError(null)
        setIsLoading(true)
        try {
            const repoId = selectedRepoIdRef.current
            const taskId = selectedTaskIdRef.current
            const bypassCache = options.bypassCache === true
            const [nextSnapshot] = await Promise.all([
                refreshProjectProjection(currentConfig, { bypassCache }),
                taskId ? refreshTask(currentConfig, repoId, taskId, { hydrateSessionEvents: false, bypassCache }) : Promise.resolve(),
            ])
            if (!taskId && selectedTaskIdRef.current) {
                await refreshTask(currentConfig, selectedRepoIdRef.current ?? nextSnapshot?.repos[0]?.id, selectedTaskIdRef.current, {
                    hydrateSessionEvents: false,
                    bypassCache,
                })
            }
        } catch (err) {
            if (isActiveRemoteConfig(currentConfig)) setError(remoteErrorMessage(err, "Unable to refresh"))
        } finally {
            if (isActiveRemoteConfig(currentConfig)) setIsLoading(false)
        }
    }

    useEffect(() => {
        if (!config) return
        void refreshAll()
        return subscribeRemoteChanges(
            config,
            (notification) => {
                if (consumeAcceptedMutationNotification(notification)) return
                const params = runtimeNotificationParams(notification)
                const plan = remoteRefreshPlan(notification, selectedTaskIdRef.current)
                const repairNavigation = notification.method === OPENADE_NOTIFICATION.repoDeleted || notification.method === OPENADE_NOTIFICATION.taskDeleted
                const taskWasDeleted = notification.method === OPENADE_NOTIFICATION.taskDeleted
                const repoId = typeof params.repoId === "string" ? params.repoId : undefined
                const taskId = typeof params.taskId === "string" ? params.taskId : undefined
                const bridgeEventType = typeof params.type === "string" ? params.type : undefined
                if (
                    notification.method === OPENADE_NOTIFICATION.taskDeleted ||
                    notification.method === OPENADE_NOTIFICATION.repoDeleted ||
                    (notification.method === OPENADE_NOTIFICATION.snapshotChanged && bridgeEventType === "task_deleted")
                ) {
                    cancelPendingTaskRefresh(repoId, taskId)
                }
                if (plan.type === "snapshot") {
                    scheduleSnapshotRefresh(300, { repairNavigation, bypassCache: true })
                } else if (plan.type === "task") {
                    if (consumeAcceptedActionStartNotification(notification)) return
                    const pending = pendingTaskRefreshFromNotification(notification, plan.repoId ?? selectedRepoIdRef.current, plan.taskId)
                    scheduleTaskRefresh(pending, pending?.eventId && pending.eventStatus === "in_progress" ? 500 : 150)
                } else if (plan.type === "snapshot-and-task") {
                    scheduleSnapshotRefresh(300, { repairNavigation, bypassCache: true })
                    if (!taskWasDeleted) {
                        scheduleTaskRefresh(
                            pendingTaskRefreshFromNotification(notification, plan.repoId ?? selectedRepoIdRef.current, plan.taskId ?? selectedTaskIdRef.current)
                        )
                    }
                } else if (plan.type === "project-task-list") {
                    const currentConfig = configRef.current
                    const repoId = plan.repoId ?? selectedRepoIdRef.current
                    if (currentConfig && repoId && shellCapabilitiesForRemoteConfig(currentConfig).taskDirectoryCapabilities.canList) {
                        scheduleProjectTaskListRefresh({ repoId, repairNavigation })
                    } else {
                        scheduleSnapshotRefresh(300, {
                            repairNavigation,
                            bypassCache: true,
                        })
                    }
                } else if (plan.type === "working-tasks") {
                    const currentConfig = configRef.current
                    if (currentConfig) applyWorkingTaskIdsResult(currentConfig, plan.taskIds)
                }
            },
            setRawConnectionStatus
        )
    }, [config])

    useEffect(() => {
        if (!config || screen !== "task" || !selectedRepoId || !selectedTaskId) return
        let disposed = false
        if (syncCachedProductState(config, selectedRepoId, selectedTaskId)) return
        setIsLoading(true)
        void refreshTask(config, selectedRepoId, selectedTaskId, {
            hydrateSessionEvents: false,
        })
            .catch((err) => {
                if (!disposed && isActiveTaskScope(config, selectedRepoId, selectedTaskId) && !isTransientRemoteRefreshError(err))
                    setError(remoteErrorMessage(err, "Unable to load task"))
            })
            .finally(() => {
                if (!disposed && isActiveTaskScope(config, selectedRepoId, selectedTaskId)) setIsLoading(false)
            })
        return () => {
            disposed = true
            setIsLoading(false)
        }
    }, [config, screen, selectedRepoId, selectedTaskId])

    useEffect(() => {
        setTaskChanges(null)
        setTaskGitLog(null)
        setTaskGitSummary(null)
        setTaskGitScopes(null)
        setTaskChangesLoading(false)
        setTaskDiff(null)
        setTaskDiffActionPath(null)
        setTaskFilePair(null)
        setTaskFilePairActionPath(null)
        setTaskCommitFiles(null)
        setTaskCommitFilesActionSha(null)
        setTaskCommitPatch(null)
        setTaskCommitPatchActionKey(null)
        setTaskTreeishFile(null)
        setTaskTreeishFileActionKey(null)
        setTaskResources(null)
        setTaskResourcesLoading(false)
        setTaskSnapshotPatches({})
        setTaskSnapshotPatchActionId(null)
    }, [config, screen, selectedRepoId, selectedTaskId])

    useEffect(() => {
        setProjectProcesses(null)
        setProjectProcessesLoading(false)
        setProjectProcessActionId(null)
        setProjectProcessOutput(null)
        setProjectFiles(null)
        setProjectFilesLoading(false)
        setProjectFileRead(null)
        setProjectFileActionPath(null)
        setProjectFileSearchResult(null)
        setProjectFileSearchLoading(false)
        setProjectSearchResult(null)
        setProjectSearchLoading(false)
        setProjectGitInfo(null)
        setProjectGitBranches(null)
        setProjectGitSummary(null)
        setProjectGitLoading(false)
        setProjectCronDefinitions(null)
        setProjectCronDefinitionsLoading(false)
        setProjectCronInstallState(null)
        setProjectCronInstallStateLoading(false)
        setProjectCronInstallActionId(null)
        if (!config || screen !== "project" || !selectedRepoId) {
            return
        }
        void runBackgroundRefresh(async () => {
            await refreshProjectTaskList(config, selectedRepoId, {
                bypassCache: true,
            })
        }, "Unable to load project details")
    }, [config, screen, selectedRepoId])

    useEffect(() => {
        const nextTitle = task?.title ?? selectedTask?.title ?? ""
        setTaskTitleDraft(nextTitle)
        setCommentDraft("")
        setEditingCommentId(null)
        setEditingCommentDraft("")
        setReviewInstructions("")
        setTaskResources(null)
        setTaskResourcesLoading(false)
    }, [task?.id, selectedTask?.id])

    useEffect(() => {
        if ((commandType === "revise" || commandType === "run_plan") && !taskHasActivePlan(task)) setCommandType("do")
    }, [commandType, task])

    const handleSelectProject = async (configId: string, repoId: string) => {
        const nextConfig = config?.id === configId ? config : activateRemoteConfig(configId)
        if (!nextConfig) return
        syncConfigs()
        setActiveRemoteConfig(nextConfig)
        setIsAddingHost(false)
        setSelectedRepoState(repoId)
        setSelectedTaskState(null)
        setTask(null)
        clearTaskImageAttachments()
        selectNewTaskRepo(repoId)
        setProjectProcessOutput(null)
        setProjectGitInfo(null)
        setProjectGitBranches(null)
        setProjectGitSummary(null)
        setProjectGitLoading(false)
        setProjectCronDefinitions(null)
        setProjectCronDefinitionsLoading(false)
        setScreenState("project")
        const nextSnapshot = sessionSnapshots[configId] ?? (await refreshProjectProjection(nextConfig))
        if (nextSnapshot) setSnapshot(nextSnapshot)
    }

    const handleSelectTask = (taskId: string) => {
        setTask(null)
        clearTaskImageAttachments()
        setSelectedTaskState(taskId)
        setScreenState("task")
    }

    const beginConnection = (mode: PendingConnection["mode"], nextBaseUrl = baseUrl, nextToken = pairToken) => {
        setError(null)
        try {
            setPendingConnection({
                ...buildPairingTarget(nextBaseUrl.replace(/\/$/, ""), nextToken, pairHostId),
                mode,
            })
        } catch (err) {
            setError(err instanceof Error ? err.message : "Invalid pairing target")
        }
    }

    const applyPairingText = (value: string): boolean => {
        if (!looksLikePairingCode(value)) return false
        try {
            const target = parsePairingCode(value)
            setBaseUrl(target.baseUrl)
            setPairToken(target.token)
            setPairHostId(target.hostId)
            setPendingConnection({ ...target, mode: "pair" })
            setError(null)
            return true
        } catch (err) {
            setError(err instanceof Error ? err.message : "Invalid pairing link")
            return false
        }
    }

    const handleBaseUrlChange = (value: string) => {
        if (applyPairingText(value)) return
        setPairHostId(undefined)
        setPairToken("")
        setBaseUrl(value)
    }

    const handleSubmitPairingLink = () => {
        if (applyPairingText(baseUrl)) return
        beginConnection("pair")
    }

    const confirmConnection = async () => {
        if (!pendingConnection) return
        setIsLoading(true)
        setError(null)
        try {
            const next =
                pendingConnection.mode === "pair"
                    ? await pairRemote(pendingConnection.baseUrl, pendingConnection.token, pendingConnection.hostId)
                    : saveRemoteConfig({
                          baseUrl: pendingConnection.baseUrl,
                          token: pendingConnection.token,
                          host: pendingConnection.host,
                          hostId: pendingConnection.hostId,
                      })
            syncConfigs()
            resetRemoteView()
            setActiveRemoteConfig(next)
            setIsAddingHost(false)
            setBaseUrl("")
            setPairToken("")
            setPairHostId(undefined)
            setPendingConnection(null)
            await refreshProjectProjection(next)
        } catch (err) {
            setError(remoteErrorMessage(err, "Connection failed"))
        } finally {
            setIsLoading(false)
        }
    }

    const handleScan = async () => {
        if (!scanPairingCode) return
        setError(null)
        try {
            const raw = await scanPairingCode()
            if (!raw) return
            const target = parsePairingCode(raw)
            setBaseUrl(target.baseUrl)
            setPairToken(target.token)
            setPairHostId(target.hostId)
            setPendingConnection({ ...target, mode: "pair" })
        } catch (err) {
            setError(err instanceof Error ? err.message : "Unable to scan pairing QR")
        }
    }

    const beginSubmission = (): number | null => {
        const began = beginRemoteSubmission(submitLockRef, {
            setSubmitting: setIsSubmitting,
            setLoading: setIsLoading,
        })
        if (!began) return null
        submitTokenRef.current += 1
        return submitTokenRef.current
    }

    const activeProjectScopeForHandler = (
        renderConfig: RemoteConfig | null = config,
        renderRepoId: string | null | undefined = selectedRepoId
    ): { config: RemoteConfig; repoId: string } | null => {
        const currentConfig = activeRemoteConfigForHandler(renderConfig, configRef.current)
        if (!currentConfig || !renderRepoId || selectedRepoIdRef.current !== renderRepoId) return null
        return { config: currentConfig, repoId: renderRepoId }
    }

    const activeProjectPanelScopeForHandler = (
        renderConfig: RemoteConfig | null = config,
        renderRepoId: string | null | undefined = selectedRepoId
    ): { config: RemoteConfig; repoId: string } | null => {
        const projectScope = activeProjectScopeForHandler(renderConfig, renderRepoId)
        if (!projectScope || screenRef.current !== "project") return null
        return projectScope
    }

    const activeTaskScopeForHandler = (
        renderConfig: RemoteConfig | null = config,
        renderRepoId: string | null | undefined = selectedRepoId,
        renderTaskId: string | null | undefined = selectedTaskId
    ): { config: RemoteConfig; repoId: string; taskId: string } | null => {
        const projectScope = activeProjectScopeForHandler(renderConfig, renderRepoId)
        if (screenRef.current !== "task" || !projectScope || !renderTaskId || selectedTaskIdRef.current !== renderTaskId) return null
        return { ...projectScope, taskId: renderTaskId }
    }

    const activeReadableTaskScopeForHandler = (
        renderConfig: RemoteConfig | null = config,
        renderRepoId: string | null | undefined = selectedRepoId,
        renderTaskId: string | null | undefined = selectedTaskId
    ): ({ config: RemoteConfig; repoId: string; taskId: string } & { capabilities: ReturnType<typeof shellCapabilitiesForRemoteConfig> }) | null => {
        const activeScope = activeTaskScopeForHandler(renderConfig, renderRepoId, renderTaskId)
        if (!activeScope) return null
        const capabilities = shellCapabilitiesForRemoteConfig(activeScope.config)
        if (!capabilities.taskDirectoryCapabilities.canRead) return null
        return { ...activeScope, capabilities }
    }

    const activeNewTaskScopeForHandler = (
        renderConfig: RemoteConfig | null = config,
        renderRepoId: string | null | undefined = newTaskRepoId ?? selectedRepoId
    ): { config: RemoteConfig; repoId: string } | null => {
        const currentConfig = activeRemoteConfigForHandler(renderConfig, configRef.current)
        if (!currentConfig || screenRef.current !== "new_task" || !renderRepoId) return null
        if ((newTaskRepoIdRef.current ?? selectedRepoIdRef.current) !== renderRepoId) return null
        return { config: currentConfig, repoId: renderRepoId }
    }

    const isActiveProjectScope = (nextConfig: RemoteConfig, repoId: string): boolean => isActiveRemoteConfig(nextConfig) && selectedRepoIdRef.current === repoId

    const isActiveProjectsScope = (nextConfig: RemoteConfig): boolean => screenRef.current === "projects" && isActiveRemoteConfig(nextConfig)

    const isActiveSettingsScope = (nextConfig: RemoteConfig): boolean => screenRef.current === "settings" && isActiveRemoteConfig(nextConfig)

    const isActiveProjectPanelScope = (nextConfig: RemoteConfig, repoId: string): boolean =>
        screenRef.current === "project" && isActiveProjectScope(nextConfig, repoId)

    const isActiveTaskScope = (nextConfig: RemoteConfig, repoId: string, taskId: string): boolean =>
        screenRef.current === "task" && isActiveProjectScope(nextConfig, repoId) && selectedTaskIdRef.current === taskId

    const isActiveNewTaskScope = (nextConfig: RemoteConfig, repoId: string): boolean =>
        screenRef.current === "new_task" && isActiveRemoteConfig(nextConfig) && (newTaskRepoIdRef.current ?? selectedRepoIdRef.current) === repoId

    const matchesCurrentTaskSelection = (nextConfig: RemoteConfig, repoId: string, taskId: string): boolean =>
        isActiveRemoteConfig(nextConfig) && selectedRepoIdRef.current === repoId && selectedTaskIdRef.current === taskId

    const matchesCurrentNewTaskSelection = (nextConfig: RemoteConfig, repoId: string): boolean =>
        isActiveRemoteConfig(nextConfig) && (newTaskRepoIdRef.current ?? selectedRepoIdRef.current) === repoId

    const setTaskScopedError = (nextConfig: RemoteConfig, repoId: string, taskId: string, error: unknown, fallback: string) => {
        if (isActiveTaskScope(nextConfig, repoId, taskId)) setError(remoteErrorMessage(error, fallback))
    }

    const setNewTaskScopedError = (nextConfig: RemoteConfig, repoId: string, error: unknown, fallback: string) => {
        if (isActiveNewTaskScope(nextConfig, repoId)) setError(remoteErrorMessage(error, fallback))
    }

    const setNewTaskPendingCreationRows = (updater: (current: RemoteNewTaskPendingCreation[]) => RemoteNewTaskPendingCreation[]) => {
        setNewTaskPendingCreations((current) => {
            const next = updater(current)
            newTaskPendingCreationsRef.current = next
            return next
        })
    }

    const getNewTaskPendingCreation = (creationId: string): RemoteNewTaskPendingCreation | null =>
        newTaskPendingCreationsRef.current.find((creation) => creation.id === creationId) ?? null

    const updateNewTaskPendingCreation = (creationId: string, patch: Partial<Pick<RemoteNewTaskPendingCreation, "phase" | "error" | "taskId">>) => {
        setNewTaskPendingCreationRows((current) => current.map((creation) => (creation.id === creationId ? { ...creation, ...patch } : creation)))
    }

    const removeNewTaskPendingCreation = (creationId: string) => {
        setNewTaskPendingCreationRows((current) => current.filter((creation) => creation.id !== creationId))
    }

    const buildNewTaskSubmission = (
        currentCapabilities: ReturnType<typeof shellCapabilitiesForRemoteConfig>,
        modeOverride?: CommandType
    ): RemoteNewTaskSubmission | null => {
        if (!newTaskPrompt.trim()) return null
        const submittedMode = modeOverride ?? newTaskMode
        const submittedHarnessId = agentHarnessId
        const submittedModelId = agentModelId
        const submittedHyperPlanStrategy =
            currentCapabilities.taskTurnCapabilities.canStart && submittedMode === "hyperplan"
                ? buildTaskHyperPlanStrategy(newTaskHyperplanPresetId, {
                      harnessId: submittedHarnessId,
                      modelId: submittedModelId,
                  })
                : null
        if (currentCapabilities.taskTurnCapabilities.canStart && submittedMode === "hyperplan" && !submittedHyperPlanStrategy) return null
        return {
            title: newTaskTitle,
            prompt: newTaskPrompt,
            mode: submittedMode,
            isolationStrategy: isolationStrategyForBranchCapability(newTaskIsolationStrategy, currentCapabilities.projectGitCapabilities.canReadBranches),
            harnessId: submittedHarnessId,
            modelId: submittedModelId,
            thinking: agentThinking,
            fastMode: agentFastMode,
            mcpServerIds: currentCapabilities.settingsCapabilities.mcpServers.canRead ? [...newTaskMcpServerIds] : [],
            images:
                currentCapabilities.taskImageCapabilities.canWrite && currentCapabilities.taskTurnCapabilities.canStart
                    ? newTaskImageAttachments.map((item) => ({ attachment: item.attachment, dataUrl: item.dataUrl }))
                    : [],
            hyperplanStrategy: submittedHyperPlanStrategy,
            createMore: newTaskCreateMore,
        }
    }

    const taskIsRunningFromCurrentSnapshot = (taskId: string): boolean => snapshotRef.current?.workingTaskIds.includes(taskId) === true

    const stopTaskRepeatRun = (repeat: Pick<RemoteTaskRepeatState, "id">, nextNotice?: string) => {
        setTaskRepeatState((current) => (sameRemoteTaskRepeatRun(current, repeat) ? null : current))
        if (nextNotice) setNotice(nextNotice)
    }

    const startRemoteTaskRepeatIteration = async (repeat: RemoteTaskRepeatState, submissionToken: number | null = null) => {
        const currentConfig = configRef.current
        if (!currentConfig || currentConfig.id !== repeat.configId || !isActiveTaskScope(currentConfig, repeat.repoId, repeat.taskId)) {
            stopTaskRepeatRun(repeat)
            if (submissionToken !== null) finishSubmissionToken(submissionToken)
            return
        }

        const currentCapabilities = shellCapabilitiesForRemoteConfig(currentConfig)
        if (
            !currentCapabilities.taskDirectoryCapabilities.canRead ||
            !currentCapabilities.taskTurnCapabilities.canStart ||
            taskIsRunningFromCurrentSnapshot(repeat.taskId) ||
            !repeat.input.trim()
        ) {
            stopTaskRepeatRun(repeat)
            if (submissionToken !== null) finishSubmissionToken(submissionToken)
            return
        }

        try {
            const store = getRemoteProductStore(currentConfig)
            const submittedMcpServerIds = currentCapabilities.settingsCapabilities.mcpServers.canRead ? repeat.mcpServerIds : []
            const submittedImages = currentCapabilities.taskImageCapabilities.canWrite ? repeat.images : []
            const result = await store.startTurn({
                repoId: repeat.repoId,
                type: "do",
                input: repeat.input,
                inTaskId: repeat.taskId,
                harnessId: repeat.harnessId,
                modelId: repeat.modelId,
                thinking: repeat.thinking,
                fastMode: repeat.fastMode,
                enabledMcpServerIds: submittedMcpServerIds.length > 0 ? submittedMcpServerIds : undefined,
                images: submittedImages.length > 0 ? submittedImages : undefined,
                label: "Repeat",
                includeComments: false,
            })
            if (!isActiveTaskScope(currentConfig, repeat.repoId, repeat.taskId)) return
            if (!result.eventId) {
                stopTaskRepeatRun(repeat, result.queued ? "Repeat queued; loop stopped until the task is idle." : "Repeat stopped: no event was created.")
                return
            }
            setTaskRepeatState((current) =>
                sameRemoteTaskRepeatRun(current, repeat)
                    ? {
                          ...current,
                          iterationCount: current.iterationCount + 1,
                          waitingEventId: result.eventId ?? null,
                          advancingEventId: null,
                      }
                    : current
            )
            trackAcceptedActionStartNotification(repeat.repoId, result.taskId, result.eventId)
            cancelPendingAcceptedActionStartRefresh(repeat.repoId, result.taskId, result.eventId)
            if (!syncCachedProductState(currentConfig, repeat.repoId, result.taskId)) {
                await refreshTaskProjection(currentConfig, repeat.repoId, result.taskId, { bypassCache: true })
            }
        } catch (err) {
            stopTaskRepeatRun(repeat)
            setTaskScopedError(currentConfig, repeat.repoId, repeat.taskId, err, "Repeat failed")
        } finally {
            if (submissionToken !== null) finishSubmissionToken(submissionToken)
        }
    }

    const handleStartTaskRepeat = () => {
        const activeScope = activeTaskScopeForHandler(config, selectedRepo?.id, task?.id)
        if (!activeScope || !selectedRepo || selectedRepo.id !== activeScope.repoId || !task || task.id !== activeScope.taskId || task.unavailableReason) return
        const currentCapabilities = shellCapabilitiesForRemoteConfig(activeScope.config)
        if (!currentCapabilities.taskDirectoryCapabilities.canRead || !currentCapabilities.taskTurnCapabilities.canStart) return
        if (taskIsRunningFromCurrentSnapshot(activeScope.taskId)) return
        const submittedInput = input.trim()
        if (!submittedInput) return
        const submissionToken = beginSubmission()
        if (submissionToken === null) return

        const repeat: RemoteTaskRepeatState = {
            id: newClientRequestId("remote-task-repeat"),
            configId: activeScope.config.id,
            repoId: activeScope.repoId,
            taskId: activeScope.taskId,
            input: submittedInput,
            images: currentCapabilities.taskImageCapabilities.canWrite ? taskImageAttachments.map((item) => item.attachment) : [],
            harnessId: agentHarnessId,
            modelId: agentModelId,
            thinking: agentThinking,
            fastMode: agentFastMode,
            mcpServerIds: currentCapabilities.settingsCapabilities.mcpServers.canRead ? (task.enabledMcpServerIds ?? []) : [],
            stopOnText: taskRepeatStopOnText,
            maxRuns: taskRepeatMaxRuns,
            iterationCount: 0,
            waitingEventId: null,
            advancingEventId: null,
        }
        setError(null)
        setNotice(null)
        setTaskRepeatState(repeat)
        void startRemoteTaskRepeatIteration(repeat, submissionToken)
    }

    const handleStopTaskRepeat = () => {
        setTaskRepeatState(null)
    }

    useEffect(() => {
        if (!taskRepeatState) return
        if (
            config?.id !== taskRepeatState.configId ||
            screen !== "task" ||
            selectedRepoId !== taskRepeatState.repoId ||
            selectedTaskId !== taskRepeatState.taskId
        ) {
            setTaskRepeatState(null)
        }
    }, [config?.id, screen, selectedRepoId, selectedTaskId, taskRepeatState])

    useEffect(() => {
        if (!taskRepeatState || !taskRepeatState.waitingEventId) return
        if (!task || task.id !== taskRepeatState.taskId || task.repoId !== taskRepeatState.repoId) return
        if (
            config?.id !== taskRepeatState.configId ||
            screen !== "task" ||
            selectedRepoId !== taskRepeatState.repoId ||
            selectedTaskId !== taskRepeatState.taskId
        )
            return
        if (selectedTaskIsRunning || taskRepeatState.advancingEventId === taskRepeatState.waitingEventId) return

        const completedEvent = remoteTaskEventById(task, taskRepeatState.waitingEventId)
        const status = remoteTaskEventStatus(completedEvent)
        if (!status || status === "in_progress") return

        if (status === "error" || status === "stopped" || remoteTaskActionFailed(completedEvent)) {
            stopTaskRepeatRun(taskRepeatState, "Repeat stopped after the last run did not complete successfully.")
            return
        }

        if (taskRepeatState.iterationCount >= taskRepeatState.maxRuns) {
            stopTaskRepeatRun(taskRepeatState)
            return
        }

        if (remoteTaskActionOutputContainsText(completedEvent, taskRepeatState.stopOnText)) {
            stopTaskRepeatRun(taskRepeatState, `Repeat stopped: found "${taskRepeatState.stopOnText.trim()}".`)
            return
        }

        const nextRepeat = { ...taskRepeatState, advancingEventId: taskRepeatState.waitingEventId }
        setTaskRepeatState((current) =>
            sameRemoteTaskRepeatRun(current, taskRepeatState) ? { ...current, advancingEventId: taskRepeatState.waitingEventId } : current
        )
        void startRemoteTaskRepeatIteration(nextRepeat)
    }, [config?.id, screen, selectedRepoId, selectedTaskId, selectedTaskIsRunning, task, taskRepeatState])

    const handleRunInTask = async () => {
        const activeScope = activeTaskScopeForHandler(config, selectedRepo?.id, selectedTaskId)
        if (!activeScope || !selectedRepo || selectedRepo.id !== activeScope.repoId || !input.trim()) return
        const currentConfig = activeScope.config
        const repoId = activeScope.repoId
        const taskId = activeScope.taskId
        const submittedInput = input
        const submittedType = commandType
        if ((submittedType === "revise" || submittedType === "run_plan") && !taskHasActivePlan(task)) return
        const currentCapabilities = shellCapabilitiesForRemoteConfig(currentConfig)
        if (!currentCapabilities.taskDirectoryCapabilities.canRead) return
        const currentTaskIsRunning = taskIsRunningFromCurrentSnapshot(taskId)
        const canStartSubmittedTurn = !currentTaskIsRunning && currentCapabilities.taskTurnCapabilities.canStart
        const canEnqueueSubmittedTurn =
            currentTaskIsRunning && currentCapabilities.taskTurnCapabilities.canEnqueue && canQueueTaskCommandWhileRunning(submittedType)
        if (!canStartSubmittedTurn && !canEnqueueSubmittedTurn) return
        const submittedHarnessId = agentHarnessId
        const submittedModelId = agentModelId
        const submittedThinking = agentThinking
        const submittedFastMode = agentFastMode
        const submittedMcpServerIds = currentCapabilities.settingsCapabilities.mcpServers.canRead ? (task?.enabledMcpServerIds ?? []) : []
        const submittedImages = currentCapabilities.taskImageCapabilities.canWrite ? taskImageAttachments.map((item) => item.attachment) : []
        const submittedHyperPlanStrategy =
            submittedType === "hyperplan"
                ? buildTaskHyperPlanStrategy(taskHyperplanPresetId, {
                      harnessId: submittedHarnessId,
                      modelId: submittedModelId,
                  })
                : null
        if (submittedType === "hyperplan" && !submittedHyperPlanStrategy) return
        const submissionToken = beginSubmission()
        if (submissionToken === null) return
        setError(null)
        setNotice(null)
        const submittedTaskId = task?.unavailableReason ? undefined : taskId
        try {
            const store = getRemoteProductStore(currentConfig)
            if (canEnqueueSubmittedTurn && selectedTask?.id === taskId) {
                const clientRequestId = newClientRequestId("remote-queued-turn-enqueue")
                trackAcceptedMutationNotification(clientRequestId)
                await store.enqueueQueuedTurn(
                    {
                        repoId,
                        taskId,
                        type: submittedType,
                        input: submittedInput,
                        harnessId: submittedHarnessId,
                        modelId: submittedModelId,
                        thinking: submittedThinking,
                        fastMode: submittedFastMode,
                        enabledMcpServerIds: submittedMcpServerIds.length > 0 ? submittedMcpServerIds : undefined,
                        images: submittedImages.length > 0 ? submittedImages : undefined,
                        hyperplanStrategy: submittedHyperPlanStrategy ?? undefined,
                    },
                    { clientRequestId }
                )
                if (!isActiveTaskScope(currentConfig, repoId, taskId)) return
                setInput("")
                clearTaskImageAttachments()
                setNotice("Queued. It will run after the current turn finishes.")
                return
            }

            const result = await store.startTurn({
                repoId,
                type: submittedType,
                input: submittedInput,
                inTaskId: submittedTaskId,
                harnessId: submittedHarnessId,
                modelId: submittedModelId,
                thinking: submittedThinking,
                fastMode: submittedFastMode,
                enabledMcpServerIds: submittedMcpServerIds.length > 0 ? submittedMcpServerIds : undefined,
                images: submittedImages.length > 0 ? submittedImages : undefined,
                hyperplanStrategy: submittedHyperPlanStrategy ?? undefined,
            })
            if (!isActiveTaskScope(currentConfig, repoId, taskId)) return
            setInput("")
            clearTaskImageAttachments()
            setSelectedTaskState(result.taskId)
            if (result.eventId) {
                trackAcceptedActionStartNotification(repoId, result.taskId, result.eventId)
                cancelPendingAcceptedActionStartRefresh(repoId, result.taskId, result.eventId)
            }
            setScreenState("task")
            if (!syncCachedProductState(currentConfig, repoId, result.taskId)) {
                await refreshTaskProjection(currentConfig, repoId, result.taskId, { bypassCache: true })
            }
            if (result.queued) setNotice("Queued. It will run after the current turn finishes.")
        } catch (err) {
            setTaskScopedError(currentConfig, repoId, taskId, err, "Run failed")
        } finally {
            finishSubmissionToken(submissionToken)
        }
    }

    const handleCommitAndPushTask = async () => {
        const activeScope = activeTaskScopeForHandler(config, selectedRepo?.id, task?.id)
        if (!activeScope || !selectedRepo || selectedRepo.id !== activeScope.repoId || !task || task.id !== activeScope.taskId || task.unavailableReason) return
        const { config: currentConfig, repoId, taskId } = activeScope
        const currentCapabilities = shellCapabilitiesForRemoteConfig(currentConfig)
        if (!currentCapabilities.taskDirectoryCapabilities.canRead || !currentCapabilities.taskTurnCapabilities.canStart) return
        if (taskIsRunningFromCurrentSnapshot(taskId)) return
        const submittedInput = input.trim() || undefined
        const submittedHarnessId = agentHarnessId
        const submittedModelId = agentModelId
        const submittedThinking = agentThinking
        const submittedFastMode = agentFastMode
        const submissionToken = beginSubmission()
        if (submissionToken === null) return
        setError(null)
        setNotice(null)
        try {
            const store = getRemoteProductStore(currentConfig)
            let currentTaskGitSummary = taskGitSummary
            if (currentCapabilities.taskGitCapabilities.canReadSummary) {
                currentTaskGitSummary = await retryRemoteRead(() => store.readTaskGitSummary({ repoId, taskId }, { bypassCache: true }))
                if (!isActiveTaskScope(currentConfig, repoId, taskId)) return
                setTaskGitSummary(currentTaskGitSummary)
                if (!currentTaskGitSummary.hasChanges && (currentTaskGitSummary.ahead ?? 0) <= 0) {
                    setNotice("Nothing to commit or push")
                    return
                }
            }
            const submittedMcpServerIds = currentCapabilities.settingsCapabilities.mcpServers.canRead ? (task.enabledMcpServerIds ?? []) : []
            const submittedImages = currentCapabilities.taskImageCapabilities.canWrite ? taskImageAttachments.map((item) => item.attachment) : []
            const hasGhCli = projectGitInfo?.isGitRepo === true ? projectGitInfo.hasGhCli : false
            const branch = currentTaskGitSummary?.branch || "HEAD"
            const result = await store.startTurn({
                repoId,
                type: "do",
                input: ACTION_PROMPTS.commitAndPush(submittedInput, hasGhCli, branch),
                inTaskId: taskId,
                harnessId: submittedHarnessId,
                modelId: submittedModelId,
                thinking: submittedThinking,
                fastMode: submittedFastMode,
                enabledMcpServerIds: submittedMcpServerIds.length > 0 ? submittedMcpServerIds : undefined,
                images: submittedImages.length > 0 ? submittedImages : undefined,
                label: "Commit & Push",
                includeComments: false,
            })
            if (!isActiveTaskScope(currentConfig, repoId, taskId)) return
            setInput("")
            clearTaskImageAttachments()
            setSelectedTaskState(result.taskId)
            if (result.eventId) {
                trackAcceptedActionStartNotification(repoId, result.taskId, result.eventId)
                cancelPendingAcceptedActionStartRefresh(repoId, result.taskId, result.eventId)
            }
            setScreenState("task")
            if (!syncCachedProductState(currentConfig, repoId, result.taskId)) {
                await refreshTaskProjection(currentConfig, repoId, result.taskId, { bypassCache: true })
            }
        } catch (err) {
            setTaskScopedError(currentConfig, repoId, taskId, err, "Unable to start Commit & Push")
        } finally {
            finishSubmissionToken(submissionToken)
        }
    }

    const handleRetryTask = async () => {
        const activeScope = activeTaskScopeForHandler(config, selectedRepo?.id, task?.id)
        if (!activeScope || !selectedRepo || selectedRepo.id !== activeScope.repoId || !task || task.id !== activeScope.taskId || task.unavailableReason) return
        const { config: currentConfig, repoId, taskId } = activeScope
        const currentCapabilities = shellCapabilitiesForRemoteConfig(currentConfig)
        if (!currentCapabilities.taskDirectoryCapabilities.canRead) return
        if (!currentCapabilities.taskTurnCapabilities.canStart || taskIsRunningFromCurrentSnapshot(taskId) || !taskHasRetryableLastAction(task)) return
        const submissionToken = beginSubmission()
        if (submissionToken === null) return
        setError(null)
        setNotice(null)
        const submittedHarnessId = agentHarnessId
        const submittedModelId = agentModelId
        const submittedThinking = agentThinking
        const submittedFastMode = agentFastMode
        const submittedMcpServerIds = currentCapabilities.settingsCapabilities.mcpServers.canRead ? (task.enabledMcpServerIds ?? []) : []
        try {
            const store = getRemoteProductStore(currentConfig)
            const result = await store.startTurn({
                repoId,
                type: "do",
                input: ACTION_PROMPTS.retry,
                inTaskId: taskId,
                harnessId: submittedHarnessId,
                modelId: submittedModelId,
                thinking: submittedThinking,
                fastMode: submittedFastMode,
                enabledMcpServerIds: submittedMcpServerIds.length > 0 ? submittedMcpServerIds : undefined,
                label: "Retry",
                includeComments: false,
            })
            if (!isActiveTaskScope(currentConfig, repoId, taskId)) return
            setSelectedTaskState(result.taskId)
            if (result.eventId) {
                trackAcceptedActionStartNotification(repoId, result.taskId, result.eventId)
                cancelPendingAcceptedActionStartRefresh(repoId, result.taskId, result.eventId)
            }
            setScreenState("task")
            if (!syncCachedProductState(currentConfig, repoId, result.taskId)) {
                await refreshTaskProjection(currentConfig, repoId, result.taskId, { bypassCache: true })
            }
        } catch (err) {
            setTaskScopedError(currentConfig, repoId, taskId, err, "Retry failed")
        } finally {
            finishSubmissionToken(submissionToken)
        }
    }

    const runNewTaskSubmission = async ({
        currentConfig,
        repoId,
        submission,
        pendingId,
        submissionToken,
        existingTaskId = null,
    }: {
        currentConfig: RemoteConfig
        repoId: string
        submission: RemoteNewTaskSubmission
        pendingId: string
        submissionToken: number | null
        existingTaskId?: string | null
    }) => {
        const currentCapabilities = shellCapabilitiesForRemoteConfig(currentConfig)
        const submittedIsolationStrategy = isolationStrategyForBranchCapability(
            submission.isolationStrategy,
            currentCapabilities.projectGitCapabilities.canReadBranches
        )
        const submittedMcpServerIds = currentCapabilities.settingsCapabilities.mcpServers.canRead ? submission.mcpServerIds : []
        updateNewTaskPendingCreation(pendingId, { phase: existingTaskId ? "starting_turn" : "creating_task", taskId: existingTaskId, error: null })
        try {
            const store = getRemoteProductStore(currentConfig)
            let taskId = existingTaskId
            if (!taskId) {
                const createClientRequestId = newClientRequestId("remote-task-create")
                trackAcceptedMutationNotification(createClientRequestId)
                const created = await store.createTask(
                    {
                        repoId,
                        input: submission.prompt,
                        title: submission.title.trim() || undefined,
                        createdBy: REMOTE_TASK_CREATED_BY,
                        deviceId: currentConfig.hostId ?? currentConfig.id,
                        isolationStrategy: submittedIsolationStrategy,
                        enabledMcpServerIds: submittedMcpServerIds.length > 0 ? submittedMcpServerIds : undefined,
                    },
                    { clientRequestId: createClientRequestId }
                )
                if (!getNewTaskPendingCreation(pendingId)) return
                taskId = created.taskId
                updateNewTaskPendingCreation(pendingId, { phase: "starting_turn", taskId })
            }
            if (!taskId) return
            const started = currentCapabilities.taskTurnCapabilities.canStart
                ? await store.startTurn({
                      repoId,
                      inTaskId: taskId,
                      type: submission.mode,
                      input: submission.prompt,
                      harnessId: submission.harnessId,
                      modelId: submission.modelId,
                      thinking: submission.thinking,
                      fastMode: submission.fastMode,
                      enabledMcpServerIds: submittedMcpServerIds.length > 0 ? submittedMcpServerIds : undefined,
                      images: submission.images.length > 0 ? submission.images.map((item) => item.attachment) : undefined,
                      hyperplanStrategy: submission.hyperplanStrategy ?? undefined,
                  })
                : null
            if (!getNewTaskPendingCreation(pendingId)) return
            const activeNewTaskScope = isActiveNewTaskScope(currentConfig, repoId)
            if (!activeNewTaskScope) {
                updateNewTaskPendingCreation(pendingId, { phase: "completed", taskId, error: null })
                return
            }
            if (!submission.createMore) {
                removeNewTaskPendingCreation(pendingId)
                setNewTaskPrompt("")
                setNewTaskTitle("")
                clearNewTaskImageAttachments()
                setNewTaskMcpServerIds([])
                setNewTaskIsolationStrategy({ type: "head" })
                setNewTaskBranches(null)
                setSelectedRepoState(repoId)
                setSelectedTaskState(taskId)
            }
            if (started?.eventId) {
                trackAcceptedActionStartNotification(repoId, taskId, started.eventId)
                cancelPendingAcceptedActionStartRefresh(repoId, taskId, started.eventId)
            }
            if (submission.createMore) {
                updateNewTaskPendingCreation(pendingId, { phase: "completed", taskId, error: null })
                setScreenState("new_task")
                setNotice(currentCapabilities.taskTurnCapabilities.canStart ? "Task created and started." : "Task created.")
            } else {
                setScreenState("task")
            }
            if (!submission.createMore && !syncCachedProductState(currentConfig, repoId, taskId)) {
                await refreshTask(currentConfig, repoId, taskId, {
                    hydrateSessionEvents: false,
                })
            }
            if (!submission.createMore && !currentCapabilities.taskTurnCapabilities.canStart) setNotice("Task created.")
        } catch (err) {
            if (!getNewTaskPendingCreation(pendingId)) return
            const message = remoteErrorMessage(err, "Task creation failed")
            updateNewTaskPendingCreation(pendingId, { error: message })
            setNewTaskScopedError(currentConfig, repoId, err, "Task creation failed")
        } finally {
            if (submissionToken !== null) finishSubmissionToken(submissionToken)
        }
    }

    const handleCreateTask = async (modeOverride?: CommandType) => {
        const activeScope = activeNewTaskScopeForHandler(config, newTaskRepoId ?? selectedRepo?.id ?? null)
        if (!activeScope) return
        const currentConfig = activeScope.config
        const repoId = activeScope.repoId
        const currentCapabilities = shellCapabilitiesForRemoteConfig(currentConfig)
        if (!currentCapabilities.taskRecordCapabilities.canCreate) return
        const submission = buildNewTaskSubmission(currentCapabilities, modeOverride)
        if (!submission) return
        const pendingId = newClientRequestId("remote-new-task-pending")
        setNewTaskPendingCreationRows((current) => [
            {
                ...submission,
                id: pendingId,
                configId: currentConfig.id,
                repoId,
                createdAt: new Date().toISOString(),
                phase: "creating_task",
                taskId: null,
                error: null,
            },
            ...current,
        ])
        setError(null)
        setNotice(null)
        if (submission.createMore) {
            setNewTaskPrompt("")
            setNewTaskTitle("")
            clearNewTaskImageAttachments()
            setNewTaskMcpServerIds([])
            setNewTaskIsolationStrategy({ type: "head" })
            setNewTaskBranches(null)
            void runNewTaskSubmission({ currentConfig, repoId, submission, pendingId, submissionToken: null })
            return
        }

        const submissionToken = beginSubmission()
        if (submissionToken === null) {
            removeNewTaskPendingCreation(pendingId)
            return
        }
        await runNewTaskSubmission({ currentConfig, repoId, submission, pendingId, submissionToken })
    }

    const handleRetryNewTaskPendingCreation = async (pendingId: string) => {
        const pendingCreation = getNewTaskPendingCreation(pendingId)
        if (!pendingCreation || pendingCreation.error === null || pendingCreation.phase === "completed") return
        const currentConfig = activeRemoteConfigForHandler(config, configRef.current)
        if (!currentConfig || currentConfig.id !== pendingCreation.configId) return
        const currentCapabilities = shellCapabilitiesForRemoteConfig(currentConfig)
        if (!currentCapabilities.taskRecordCapabilities.canCreate) return
        setError(null)
        setNotice(null)
        if (pendingCreation.createMore) {
            void runNewTaskSubmission({
                currentConfig,
                repoId: pendingCreation.repoId,
                submission: pendingCreation,
                pendingId,
                submissionToken: null,
                existingTaskId: pendingCreation.taskId,
            })
            return
        }

        const submissionToken = beginSubmission()
        if (submissionToken === null) return
        await runNewTaskSubmission({
            currentConfig,
            repoId: pendingCreation.repoId,
            submission: pendingCreation,
            pendingId,
            submissionToken,
            existingTaskId: pendingCreation.taskId,
        })
    }

    const handleOpenNewTaskPendingCreation = async (pendingId: string) => {
        const pendingCreation = getNewTaskPendingCreation(pendingId)
        if (!pendingCreation?.taskId) return
        const currentConfig = activeRemoteConfigForHandler(config, configRef.current)
        if (!currentConfig || currentConfig.id !== pendingCreation.configId) return
        if (!shellCapabilitiesForRemoteConfig(currentConfig).taskDirectoryCapabilities.canRead) return
        removeNewTaskPendingCreation(pendingId)
        setSelectedRepoState(pendingCreation.repoId)
        setSelectedTaskState(pendingCreation.taskId)
        setScreenState("task")
        if (!syncCachedProductState(currentConfig, pendingCreation.repoId, pendingCreation.taskId)) {
            await refreshTask(currentConfig, pendingCreation.repoId, pendingCreation.taskId, {
                hydrateSessionEvents: false,
            })
        }
    }

    const handleCancelNewTaskPendingCreation = (pendingId: string) => {
        const pendingCreation = getNewTaskPendingCreation(pendingId)
        removeNewTaskPendingCreation(pendingId)
        if (pendingCreation && !pendingCreation.createMore) cancelSubmission()
    }

    const handleDismissNewTaskPendingCreation = (pendingId: string) => {
        removeNewTaskPendingCreation(pendingId)
    }

    const handleCreateProject = async ({
        name,
        path,
    }: {
        name: string
        path: string
    }): Promise<boolean> => {
        const currentConfig = activeRemoteConfigForHandler(config, configRef.current)
        if (!currentConfig || !shellCapabilitiesForRemoteConfig(currentConfig).projectRecordCapabilities.canCreate) return false
        if (!name.trim() || !path.trim()) return false
        const submissionToken = beginSubmission()
        if (submissionToken === null) return false
        setError(null)
        setNotice(null)
        const projectName = name.trim()
        const projectPath = path.trim()
        try {
            const store = getRemoteProductStore(currentConfig)
            const created = await store.createRepo(
                {
                    name: projectName,
                    path: projectPath,
                    createdBy: REMOTE_TASK_CREATED_BY,
                },
                { clientRequestId: newClientRequestId("remote-repo-create") }
            )
            if (!isActiveProjectsScope(currentConfig)) return true
            const nextSnapshot = store.snapshot
            if (nextSnapshot) {
                applySnapshotResult(currentConfig, nextSnapshot)
            } else if (snapshotRef.current) {
                await refreshProjectProjection(currentConfig, { bypassCache: true })
            } else {
                await refreshProjectProjection(currentConfig, { bypassCache: true })
            }
            setSelectedRepoState(created.repoId)
            setSelectedTaskState(null)
            setTask(null)
            selectNewTaskRepo(created.repoId)
            setScreenState("project")
            setNotice("Project added.")
            return true
        } catch (err) {
            if (isActiveProjectsScope(currentConfig)) setError(remoteErrorMessage(err, "Unable to add project"))
            return false
        } finally {
            finishSubmissionToken(submissionToken)
        }
    }

    const handleInspectProjectPath = async (path: string): Promise<OpenADERepoPathInspectResult | null> => {
        const currentConfig = activeRemoteConfigForHandler(config, configRef.current)
        if (!currentConfig || !shellCapabilitiesForRemoteConfig(currentConfig).projectRecordCapabilities.canInspectPath) return null
        const projectPath = path.trim()
        if (!projectPath) return null
        try {
            return await getRemoteProductStore(currentConfig).inspectRepoPath({ path: projectPath })
        } catch (err) {
            if (isActiveProjectsScope(currentConfig)) setError(remoteErrorMessage(err, "Unable to inspect project path"))
            return null
        }
    }

    const handleUpdateProject = async (input: ProjectUpdateInput): Promise<boolean> => {
        if (!input.repoId) return false
        const activeScope = activeProjectPanelScopeForHandler(config, input.repoId)
        if (!activeScope || !shellCapabilitiesForRemoteConfig(activeScope.config).projectRecordCapabilities.canUpdate) return false
        const currentConfig = activeScope.config
        const update: ProjectUpdateInput = { repoId: input.repoId }
        if (input.name !== undefined) {
            const name = input.name.trim()
            if (!name) return false
            update.name = name
        }
        if (input.path !== undefined) {
            const path = input.path.trim()
            if (!path) return false
            update.path = path
        }
        if (input.archived !== undefined) update.archived = input.archived
        if (update.name === undefined && update.path === undefined && update.archived === undefined) return false
        const submissionToken = beginSubmission()
        if (submissionToken === null) return false
        setError(null)
        setNotice(null)
        try {
            const store = getRemoteProductStore(currentConfig)
            await store.updateRepo(update, {
                clientRequestId: newClientRequestId("remote-repo-update"),
            })
            if (!isActiveProjectPanelScope(currentConfig, update.repoId)) return true
            const nextSnapshot = store.snapshot
            if (nextSnapshot) {
                applySnapshotResult(currentConfig, nextSnapshot, { repairNavigation: true })
            } else if (snapshotRef.current) {
                await refreshProjectProjection(currentConfig, {
                    repairNavigation: true,
                    bypassCache: true,
                })
            } else {
                await refreshProjectProjection(currentConfig, {
                    repairNavigation: true,
                    bypassCache: true,
                })
            }
            setNotice(update.archived === true ? "Project archived." : update.archived === false ? "Project reopened." : "Project updated.")
            return true
        } catch (err) {
            if (isActiveProjectPanelScope(currentConfig, update.repoId)) setError(remoteErrorMessage(err, "Unable to update project"))
            return false
        } finally {
            finishSubmissionToken(submissionToken)
        }
    }

    const handleDeleteProject = async (repoId: string): Promise<boolean> => {
        if (!repoId) return false
        const activeScope = activeProjectPanelScopeForHandler(config, repoId)
        if (!activeScope || !shellCapabilitiesForRemoteConfig(activeScope.config).projectRecordCapabilities.canDelete) return false
        const currentConfig = activeScope.config
        if (!window.confirm("Delete this project?")) return false
        const submissionToken = beginSubmission()
        if (submissionToken === null) return false
        setError(null)
        setNotice(null)
        try {
            const store = getRemoteProductStore(currentConfig)
            await store.deleteRepo({ repoId }, { clientRequestId: newClientRequestId("remote-repo-delete") })
            if (!isActiveProjectPanelScope(currentConfig, repoId)) return true
            const nextSnapshot = store.snapshot
            if (nextSnapshot) {
                applySnapshotResult(currentConfig, nextSnapshot, { repairNavigation: true })
            } else if (snapshotRef.current) {
                await refreshProjectProjection(currentConfig, {
                    repairNavigation: true,
                    bypassCache: true,
                })
            } else {
                await refreshProjectProjection(currentConfig, {
                    repairNavigation: true,
                    bypassCache: true,
                })
            }
            if (selectedRepoIdRef.current === repoId) {
                setSelectedRepoState(null)
                setSelectedTaskState(null)
                setTask(null)
                setScreenState("projects")
            }
            setNotice("Project deleted.")
            return true
        } catch (err) {
            if (isActiveProjectPanelScope(currentConfig, repoId)) setError(remoteErrorMessage(err, "Unable to delete project"))
            return false
        } finally {
            finishSubmissionToken(submissionToken)
        }
    }

    const handleAbort = async () => {
        const activeScope = activeReadableTaskScopeForHandler()
        if (!activeScope || !activeScope.capabilities.taskTurnCapabilities.canInterrupt) return
        const { config: currentConfig, repoId, taskId } = activeScope
        setError(null)
        try {
            await getRemoteProductStore(currentConfig).interruptTurn(taskId)
            if (!isActiveTaskScope(currentConfig, repoId, taskId)) return
            await refreshAll()
        } catch (err) {
            if (isActiveTaskScope(currentConfig, repoId, taskId)) setError(remoteErrorMessage(err, "Unable to interrupt task"))
        }
    }

    const handleRefreshTaskGit = async () => {
        const activeScope = activeTaskScopeForHandler()
        if (!activeScope) return
        const currentTaskGitCapabilities = shellCapabilitiesForRemoteConfig(activeScope.config).taskGitCapabilities
        if (
            !currentTaskGitCapabilities.canReadChanges &&
            !currentTaskGitCapabilities.canReadLog &&
            !currentTaskGitCapabilities.canReadSummary &&
            !currentTaskGitCapabilities.canReadScopes
        ) {
            return
        }
        setError(null)
        try {
            await refreshTaskGit(activeScope.config, activeScope.repoId, activeScope.taskId)
        } catch (err) {
            if (isActiveTaskScope(activeScope.config, activeScope.repoId, activeScope.taskId))
                setError(remoteErrorMessage(err, "Unable to refresh task changes"))
        }
    }

    const handleReadTaskDiff = async (file: OpenADETaskGitChangedFile) => {
        const activeScope = activeTaskScopeForHandler()
        if (!activeScope || !shellCapabilitiesForRemoteConfig(activeScope.config).taskGitCapabilities.canReadDiff) return
        const { config: currentConfig, repoId, taskId } = activeScope
        setError(null)
        setTaskDiffActionPath(file.path)
        try {
            const result = await retryRemoteRead(() =>
                getRemoteProductStore(currentConfig).readTaskDiff({
                    repoId,
                    taskId,
                    filePath: file.path,
                    oldPath: file.oldPath,
                    contextLines: 3,
                    allowTruncation: true,
                })
            )
            if (isActiveTaskScope(currentConfig, repoId, taskId)) setTaskDiff(result)
        } catch (err) {
            if (isActiveTaskScope(currentConfig, repoId, taskId)) setError(remoteErrorMessage(err, "Unable to read task diff"))
        } finally {
            if (isActiveTaskScope(currentConfig, repoId, taskId)) setTaskDiffActionPath(null)
        }
    }

    const handleReadTaskFilePair = async (file: OpenADETaskGitChangedFile) => {
        const activeScope = activeTaskScopeForHandler()
        if (!activeScope || !shellCapabilitiesForRemoteConfig(activeScope.config).taskGitCapabilities.canReadFilePair) return
        const { config: currentConfig, repoId, taskId } = activeScope
        setError(null)
        setTaskFilePairActionPath(file.path)
        try {
            const result = await retryRemoteRead(() =>
                getRemoteProductStore(currentConfig).readTaskFilePair({
                    repoId,
                    taskId,
                    filePath: file.path,
                    oldPath: file.oldPath,
                })
            )
            if (isActiveTaskScope(currentConfig, repoId, taskId)) setTaskFilePair(result)
        } catch (err) {
            if (isActiveTaskScope(currentConfig, repoId, taskId)) setError(remoteErrorMessage(err, "Unable to read file pair"))
        } finally {
            if (isActiveTaskScope(currentConfig, repoId, taskId)) setTaskFilePairActionPath(null)
        }
    }

    const handleReadTaskCommitFiles = async (commit: OpenADETaskGitLogEntry) => {
        const activeScope = activeTaskScopeForHandler()
        if (!activeScope || !shellCapabilitiesForRemoteConfig(activeScope.config).taskGitCapabilities.canReadCommitFiles) return
        const { config: currentConfig, repoId, taskId } = activeScope
        setError(null)
        setTaskCommitFilesActionSha(commit.sha)
        setTaskCommitPatch(null)
        setTaskTreeishFile(null)
        try {
            const result = await retryRemoteRead(() =>
                getRemoteProductStore(currentConfig).readTaskGitCommitFiles({
                    repoId,
                    taskId,
                    commit: commit.sha,
                })
            )
            if (isActiveTaskScope(currentConfig, repoId, taskId)) setTaskCommitFiles(result)
        } catch (err) {
            if (isActiveTaskScope(currentConfig, repoId, taskId)) setError(remoteErrorMessage(err, "Unable to read commit files"))
        } finally {
            if (isActiveTaskScope(currentConfig, repoId, taskId)) setTaskCommitFilesActionSha(null)
        }
    }

    const handleReadTaskCommitFilePatch = async (file: OpenADETaskGitChangedFile) => {
        const activeScope = activeTaskScopeForHandler()
        if (!activeScope || !shellCapabilitiesForRemoteConfig(activeScope.config).taskGitCapabilities.canReadCommitFilePatch) return
        if (!taskCommitFiles) return
        const { config: currentConfig, repoId, taskId } = activeScope
        const commit = taskCommitFiles.commit
        const key = taskCommitFileActionKey(commit, file.path, file.oldPath)
        setError(null)
        setTaskCommitPatchActionKey(key)
        try {
            const result = await retryRemoteRead(() =>
                getRemoteProductStore(currentConfig).readTaskGitCommitFilePatch({
                    repoId,
                    taskId,
                    commit,
                    filePath: file.path,
                    oldPath: file.oldPath,
                    contextLines: 3,
                    allowTruncation: true,
                })
            )
            if (isActiveTaskScope(currentConfig, repoId, taskId)) setTaskCommitPatch(result)
        } catch (err) {
            if (isActiveTaskScope(currentConfig, repoId, taskId)) setError(remoteErrorMessage(err, "Unable to read commit patch"))
        } finally {
            if (isActiveTaskScope(currentConfig, repoId, taskId)) setTaskCommitPatchActionKey(null)
        }
    }

    const handleReadTaskCommitFileAtTreeish = async (file: OpenADETaskGitChangedFile) => {
        const activeScope = activeTaskScopeForHandler()
        if (!activeScope || !shellCapabilitiesForRemoteConfig(activeScope.config).taskGitCapabilities.canReadFileAtTreeish) return
        if (!taskCommitFiles) return
        const { config: currentConfig, repoId, taskId } = activeScope
        const treeish = taskCommitFiles.commit
        const key = taskCommitFileActionKey(treeish, file.path, file.oldPath)
        setError(null)
        setTaskTreeishFileActionKey(key)
        try {
            const result = await retryRemoteRead(() =>
                getRemoteProductStore(currentConfig).readTaskGitFileAtTreeish({
                    repoId,
                    taskId,
                    treeish,
                    filePath: file.path,
                })
            )
            if (isActiveTaskScope(currentConfig, repoId, taskId)) setTaskTreeishFile(result)
        } catch (err) {
            if (isActiveTaskScope(currentConfig, repoId, taskId)) setError(remoteErrorMessage(err, "Unable to read commit file"))
        } finally {
            if (isActiveTaskScope(currentConfig, repoId, taskId)) setTaskTreeishFileActionKey(null)
        }
    }

    const handleCommitTaskGit = async (message: string) => {
        const activeScope = activeTaskScopeForHandler()
        if (!activeScope) return
        const currentShellCapabilities = shellCapabilitiesForRemoteConfig(activeScope.config)
        const currentTaskGitCapabilities = currentShellCapabilities.taskGitCapabilities
        if (!currentShellCapabilities.taskCanCommitGit) return
        if (!message.trim()) return
        const submissionToken = beginSubmission()
        if (submissionToken === null) return
        const { config: currentConfig, repoId, taskId } = activeScope
        setError(null)
        setNotice(null)
        try {
            const result = await getRemoteProductStore(currentConfig).commitTaskGit(
                {
                    repoId,
                    taskId,
                    message: message.trim(),
                },
                { clientRequestId: newClientRequestId("remote-task-git-commit") }
            )
            if (!isActiveTaskScope(currentConfig, repoId, taskId)) return
            setNotice(result.committed ? `Committed ${result.sha?.slice(0, 8) ?? "changes"}` : "Nothing to commit")
            if (
                currentTaskGitCapabilities.canReadChanges ||
                currentTaskGitCapabilities.canReadLog ||
                currentTaskGitCapabilities.canReadSummary ||
                currentTaskGitCapabilities.canReadScopes
            ) {
                await refreshTaskGit(currentConfig, repoId, taskId)
            }
        } catch (err) {
            if (isActiveTaskScope(currentConfig, repoId, taskId)) setError(remoteErrorMessage(err, "Unable to commit task changes"))
        } finally {
            finishSubmissionToken(submissionToken)
        }
    }

    const handleRefreshTaskResources = async () => {
        const activeScope = activeTaskScopeForHandler()
        if (!activeScope || !shellCapabilitiesForRemoteConfig(activeScope.config).taskResourceCapabilities.canRead) return
        const { config: currentConfig, repoId, taskId } = activeScope
        setError(null)
        setTaskResourcesLoading(true)
        try {
            const result = await retryRemoteRead(() =>
                getRemoteProductStore(currentConfig).readTaskResourceInventory({
                    repoId,
                    taskId,
                })
            )
            if (isActiveTaskScope(currentConfig, repoId, taskId)) setTaskResources(result)
        } catch (err) {
            if (isActiveTaskScope(currentConfig, repoId, taskId)) setError(remoteErrorMessage(err, "Unable to read task resources"))
        } finally {
            if (isActiveTaskScope(currentConfig, repoId, taskId)) setTaskResourcesLoading(false)
        }
    }

    const handleLoadTaskSnapshotPatch = async (block: TaskSnapshotBlock) => {
        const activeScope = activeTaskScopeForHandler()
        const currentCapabilities = shellCapabilitiesForRemoteConfig(activeScope?.config ?? null)
        if (!activeScope || !currentCapabilities.taskSnapshotPatchCapabilities.canRead) return
        const { config: currentConfig, repoId, taskId } = activeScope
        setError(null)
        setTaskSnapshotPatchActionId(block.id)
        try {
            if (currentCapabilities.taskSnapshotPatchCapabilities.canReadSlice) {
                const result = await retryRemoteRead(() =>
                    getRemoteProductStore(currentConfig).readTaskSnapshotIndex({
                        repoId,
                        taskId,
                        eventId: block.id,
                    })
                )
                if (isActiveTaskScope(currentConfig, repoId, taskId)) {
                    setTaskSnapshotPatches((current) => ({
                        ...current,
                        [block.id]: {
                            eventId: result.eventId,
                            patchFileId: result.patchFileId,
                            index: result.index,
                            slices: current[block.id]?.slices,
                        },
                    }))
                }
                return
            }
            const result: OpenADETaskSnapshotPatchReadResult = await retryRemoteRead(() =>
                getRemoteProductStore(currentConfig).readTaskSnapshotPatch({
                    repoId,
                    taskId,
                    eventId: block.id,
                })
            )
            if (isActiveTaskScope(currentConfig, repoId, taskId)) {
                setTaskSnapshotPatches((current) => ({
                    ...current,
                    [block.id]: {
                        eventId: result.eventId,
                        patchFileId: result.patchFileId,
                        patch: result.patch,
                    },
                }))
            }
        } catch (err) {
            if (isActiveTaskScope(currentConfig, repoId, taskId)) setError(remoteErrorMessage(err, "Unable to read snapshot patch"))
        } finally {
            if (isActiveTaskScope(currentConfig, repoId, taskId)) setTaskSnapshotPatchActionId(null)
        }
    }

    const handleLoadTaskSnapshotPatchSlice = async (block: TaskSnapshotBlock, file: OpenADESnapshotPatchFile) => {
        const activeScope = activeTaskScopeForHandler()
        if (!activeScope || !shellCapabilitiesForRemoteConfig(activeScope.config).taskSnapshotPatchCapabilities.canReadSlice) return
        const { config: currentConfig, repoId, taskId } = activeScope
        const actionId = remoteSnapshotPatchActionId(block.id, file)
        setError(null)
        setTaskSnapshotPatchActionId(actionId)
        try {
            const result = await retryRemoteRead(() =>
                getRemoteProductStore(currentConfig).readTaskSnapshotPatchSlice({
                    repoId,
                    taskId,
                    eventId: block.id,
                    start: file.patchStart,
                    end: file.patchEnd,
                })
            )
            const sliceKey = remoteSnapshotPatchFileKey(file)
            if (isActiveTaskScope(currentConfig, repoId, taskId)) {
                setTaskSnapshotPatches((current) => {
                    const existing = current[block.id] ?? { eventId: result.eventId }
                    return {
                        ...current,
                        [block.id]: {
                            ...existing,
                            eventId: result.eventId,
                            patchFileId: result.patchFileId ?? existing.patchFileId,
                            slices: {
                                ...existing.slices,
                                [sliceKey]: {
                                    filePath: remoteSnapshotPatchFileLabel(file),
                                    patch: result.patch,
                                },
                            },
                        },
                    }
                })
            }
        } catch (err) {
            if (isActiveTaskScope(currentConfig, repoId, taskId)) setError(remoteErrorMessage(err, "Unable to read snapshot patch file"))
        } finally {
            if (isActiveTaskScope(currentConfig, repoId, taskId)) setTaskSnapshotPatchActionId(null)
        }
    }

    const handleRefreshProjectProcesses = async () => {
        const activeScope = activeProjectPanelScopeForHandler()
        if (!activeScope || !shellCapabilitiesForRemoteConfig(activeScope.config).projectProcessCapabilities.canRead) return
        setError(null)
        try {
            await refreshProjectProcesses(activeScope.config, activeScope.repoId)
        } catch (err) {
            if (isActiveProjectPanelScope(activeScope.config, activeScope.repoId)) setError(remoteErrorMessage(err, "Unable to refresh processes"))
        }
    }

    const handleRefreshProjectFiles = async () => {
        const activeScope = activeProjectPanelScopeForHandler()
        if (!activeScope || !shellCapabilitiesForRemoteConfig(activeScope.config).projectFileCapabilities.canList) return
        setError(null)
        try {
            await refreshProjectFiles(activeScope.config, activeScope.repoId)
        } catch (err) {
            if (isActiveProjectPanelScope(activeScope.config, activeScope.repoId)) setError(remoteErrorMessage(err, "Unable to refresh files"))
        }
    }

    const handleRefreshProjectGit = async () => {
        const activeScope = activeProjectPanelScopeForHandler()
        if (!activeScope) return
        const currentProjectGitCapabilities = shellCapabilitiesForRemoteConfig(activeScope.config).projectGitCapabilities
        if (!currentProjectGitCapabilities.canReadInfo && !currentProjectGitCapabilities.canReadBranches && !currentProjectGitCapabilities.canReadSummary)
            return
        setError(null)
        try {
            await refreshProjectGit(activeScope.config, activeScope.repoId)
        } catch (err) {
            if (isActiveProjectPanelScope(activeScope.config, activeScope.repoId)) setError(remoteErrorMessage(err, "Unable to refresh git"))
        }
    }

    const handleRefreshProjectCronDefinitions = async () => {
        const activeScope = activeProjectPanelScopeForHandler()
        if (!activeScope || !shellCapabilitiesForRemoteConfig(activeScope.config).projectCronCapabilities.canRead) return
        setError(null)
        try {
            await refreshProjectCronDefinitions(activeScope.config, activeScope.repoId)
        } catch (err) {
            if (isActiveProjectPanelScope(activeScope.config, activeScope.repoId)) setError(remoteErrorMessage(err, "Unable to refresh crons"))
        }
    }

    const handleRefreshProjectCronInstallState = async () => {
        const activeScope = activeProjectPanelScopeForHandler()
        if (!activeScope || !shellCapabilitiesForRemoteConfig(activeScope.config).projectCronCapabilities.canReadInstallState) return
        setError(null)
        try {
            await refreshProjectCronInstallState(activeScope.config, activeScope.repoId)
        } catch (err) {
            if (isActiveProjectPanelScope(activeScope.config, activeScope.repoId)) setError(remoteErrorMessage(err, "Unable to refresh cron state"))
        }
    }

    const handleSetProjectCronEnabled = async (cronId: string, enabled: boolean) => {
        const activeScope = activeProjectPanelScopeForHandler()
        if (!activeScope) return
        const { config: currentConfig, repoId } = activeScope
        const currentShellCapabilities = shellCapabilitiesForRemoteConfig(currentConfig)
        const currentCronCapabilities = currentShellCapabilities.projectCronCapabilities
        if (!currentCronCapabilities.canReadInstallState || !currentCronCapabilities.canReplaceInstallState) return
        setError(null)
        setProjectCronInstallActionId(cronId)
        try {
            const currentState = projectCronInstallState ?? (await refreshProjectCronInstallState(currentConfig, repoId))
            if (!currentState) return
            if (!isActiveProjectPanelScope(currentConfig, repoId)) return

            const result = await getRemoteProductStore(currentConfig).replaceCronInstallState(
                {
                    repoId,
                    installations: cronInstallationsWithEnabledState(currentState.installations, cronId, enabled, new Date().toISOString()),
                },
                { clientRequestId: newClientRequestId("remote-cron-install-state") }
            )
            if (isActiveProjectPanelScope(currentConfig, repoId)) setProjectCronInstallState(result)
        } catch (err) {
            if (isActiveProjectPanelScope(currentConfig, repoId)) setError(remoteErrorMessage(err, enabled ? "Unable to enable cron" : "Unable to pause cron"))
        } finally {
            if (isActiveProjectPanelScope(currentConfig, repoId)) setProjectCronInstallActionId(null)
        }
    }

    const handleRunProjectCron = async (cronId: string) => {
        const activeScope = activeProjectPanelScopeForHandler()
        const cronCapabilities = activeScope ? shellCapabilitiesForRemoteConfig(activeScope.config).projectCronCapabilities : null
        if (!activeScope || !cronCapabilities?.canRead || !cronCapabilities.canRun) return
        const { config: currentConfig, repoId } = activeScope
        setError(null)
        setProjectCronInstallActionId(cronId)
        try {
            const result = await getRemoteProductStore(currentConfig).runCron(
                {
                    repoId,
                    cronId,
                },
                { clientRequestId: newClientRequestId("remote-cron-run") }
            )
            const installation = result.installation
            if (isActiveProjectPanelScope(currentConfig, result.repoId) && installation) {
                setProjectCronInstallState((current) => ({
                    repoId: result.repoId,
                    installations: {
                        ...(current?.installations ?? {}),
                        [result.cronId]: installation,
                    },
                }))
            }
            if (!isActiveProjectPanelScope(currentConfig, result.repoId)) return
            setNotice("Cron started")
            await refreshProjectTaskList(currentConfig, result.repoId, {
                bypassCache: true,
            })
        } catch (err) {
            if (isActiveProjectPanelScope(currentConfig, repoId)) setError(remoteErrorMessage(err, "Unable to run cron"))
        } finally {
            if (isActiveProjectPanelScope(currentConfig, repoId)) setProjectCronInstallActionId(null)
        }
    }

    const handleReadProjectFile = async (filePath: string) => {
        const activeScope = activeProjectPanelScopeForHandler()
        if (!activeScope || !shellCapabilitiesForRemoteConfig(activeScope.config).projectFileCapabilities.canRead) return
        const { config: currentConfig, repoId } = activeScope
        setError(null)
        setProjectFileActionPath(filePath)
        try {
            const result = await retryRemoteRead(() =>
                getRemoteProductStore(currentConfig).readProjectFile({
                    repoId,
                    path: filePath,
                    maxBytes: 64 * 1024,
                })
            )
            if (isActiveProjectPanelScope(currentConfig, repoId)) setProjectFileRead(result)
        } catch (err) {
            if (isActiveProjectPanelScope(currentConfig, repoId)) setError(remoteErrorMessage(err, "Unable to read file"))
        } finally {
            if (isActiveProjectPanelScope(currentConfig, repoId)) setProjectFileActionPath(null)
        }
    }

    const handleWriteProjectFile = async (filePath: string, content: string) => {
        const activeScope = activeProjectPanelScopeForHandler()
        const fileCapabilities = activeScope ? shellCapabilitiesForRemoteConfig(activeScope.config).projectFileCapabilities : null
        if (!activeScope || !fileCapabilities?.canRead || !fileCapabilities.canWrite) return
        const { config: currentConfig, repoId } = activeScope
        setError(null)
        setProjectFileActionPath(filePath)
        try {
            const result = await getRemoteProductStore(currentConfig).writeProjectFile(
                {
                    repoId,
                    path: filePath,
                    content,
                    encoding: "utf8",
                },
                { clientRequestId: newClientRequestId("remote-project-file-write") }
            )
            if (isActiveProjectPanelScope(currentConfig, repoId)) {
                setProjectFileRead({
                    repoId: result.repoId,
                    taskId: result.taskId,
                    path: result.path,
                    encoding: "utf8",
                    size: result.size,
                    tooLarge: false,
                    content,
                })
            }
        } catch (err) {
            if (isActiveProjectPanelScope(currentConfig, repoId)) setError(remoteErrorMessage(err, "Unable to write file"))
        } finally {
            if (isActiveProjectPanelScope(currentConfig, repoId)) setProjectFileActionPath(null)
        }
    }

    const handleSearchProjectFiles = async () => {
        const activeScope = activeProjectPanelScopeForHandler()
        if (!activeScope || !shellCapabilitiesForRemoteConfig(activeScope.config).projectFileCapabilities.canSearch) return
        if (!projectFileSearchQuery.trim()) return
        const { config: currentConfig, repoId } = activeScope
        const query = projectFileSearchQuery.trim()
        setError(null)
        setProjectFileSearchLoading(true)
        try {
            const result = await retryRemoteRead(() =>
                getRemoteProductStore(currentConfig).fuzzySearchProjectFiles({
                    repoId,
                    query,
                    limit: 25,
                })
            )
            if (isActiveProjectPanelScope(currentConfig, repoId)) setProjectFileSearchResult(result)
        } catch (err) {
            if (isActiveProjectPanelScope(currentConfig, repoId)) setError(remoteErrorMessage(err, "Unable to find files"))
        } finally {
            if (isActiveProjectPanelScope(currentConfig, repoId)) setProjectFileSearchLoading(false)
        }
    }

    const handleSearchProject = async () => {
        const activeScope = activeProjectPanelScopeForHandler()
        if (!activeScope || !shellCapabilitiesForRemoteConfig(activeScope.config).projectSearchCapabilities.canSearch) return
        if (!projectSearchQuery.trim()) return
        const { config: currentConfig, repoId } = activeScope
        const query = projectSearchQuery.trim()
        setError(null)
        setProjectSearchLoading(true)
        try {
            const result = await retryRemoteRead(() =>
                getRemoteProductStore(currentConfig).searchProject({
                    repoId,
                    query,
                    limit: 25,
                })
            )
            if (isActiveProjectPanelScope(currentConfig, repoId)) setProjectSearchResult(result)
        } catch (err) {
            if (isActiveProjectPanelScope(currentConfig, repoId)) setError(remoteErrorMessage(err, "Unable to search files"))
        } finally {
            if (isActiveProjectPanelScope(currentConfig, repoId)) setProjectSearchLoading(false)
        }
    }

    const handleStartProjectProcess = async (definitionId: string) => {
        const activeScope = activeProjectPanelScopeForHandler()
        const processCapabilities = activeScope ? shellCapabilitiesForRemoteConfig(activeScope.config).projectProcessCapabilities : null
        if (!activeScope || !processCapabilities?.canRead || !processCapabilities.canStart) return
        const { config: currentConfig, repoId } = activeScope
        setError(null)
        setProjectProcessActionId(definitionId)
        try {
            const result = await getRemoteProductStore(currentConfig).startProjectProcess({
                repoId,
                definitionId,
                clientRequestId: newClientRequestId("remote-process-start"),
            })
            if (isActiveProjectPanelScope(currentConfig, repoId)) setProjectProcesses((current) => projectProcessesWithStartedInstance(current, result))
        } catch (err) {
            if (isActiveProjectPanelScope(currentConfig, repoId)) setError(remoteErrorMessage(err, "Unable to start process"))
        } finally {
            if (isActiveProjectPanelScope(currentConfig, repoId)) setProjectProcessActionId(null)
        }
    }

    const handleReconnectProjectProcess = async (processId: string) => {
        const activeScope = activeProjectPanelScopeForHandler()
        const processCapabilities = activeScope ? shellCapabilitiesForRemoteConfig(activeScope.config).projectProcessCapabilities : null
        if (!activeScope || !processCapabilities?.canRead || !processCapabilities.canReconnect) return
        const { config: currentConfig, repoId } = activeScope
        setError(null)
        setProjectProcessActionId(processId)
        try {
            const result = await retryRemoteRead(() =>
                getRemoteProductStore(currentConfig).reconnectProjectProcess({
                    repoId,
                    processId,
                })
            )
            if (isActiveProjectPanelScope(currentConfig, repoId)) setProjectProcessOutput(result)
        } catch (err) {
            if (isActiveProjectPanelScope(currentConfig, repoId)) setError(remoteErrorMessage(err, "Unable to read process output"))
        } finally {
            if (isActiveProjectPanelScope(currentConfig, repoId)) setProjectProcessActionId(null)
        }
    }

    const handleStopProjectProcess = async (processId: string) => {
        const activeScope = activeProjectPanelScopeForHandler()
        const processCapabilities = activeScope ? shellCapabilitiesForRemoteConfig(activeScope.config).projectProcessCapabilities : null
        if (!activeScope || !processCapabilities?.canRead || !processCapabilities.canStop) return
        const { config: currentConfig, repoId } = activeScope
        setError(null)
        setProjectProcessActionId(processId)
        try {
            const result = await getRemoteProductStore(currentConfig).stopProjectProcess({
                repoId,
                processId,
                clientRequestId: newClientRequestId("remote-process-stop"),
            })
            if (isActiveProjectPanelScope(currentConfig, repoId)) {
                setProjectProcesses((current) => projectProcessesWithoutStoppedInstance(current, result))
                setProjectProcessOutput((current) =>
                    current && current.processId === result.processId && result.ok
                        ? {
                              ...current,
                              completed: true,
                          }
                        : current
                )
            }
        } catch (err) {
            if (isActiveProjectPanelScope(currentConfig, repoId)) setError(remoteErrorMessage(err, "Unable to stop process"))
        } finally {
            if (isActiveProjectPanelScope(currentConfig, repoId)) setProjectProcessActionId(null)
        }
    }

    const syncTaskAfterAcceptedMutation = async (mutationConfig: RemoteConfig, repoId: string | undefined | null, taskId: string | undefined | null) => {
        if (!repoId || !taskId || !isActiveTaskScope(mutationConfig, repoId, taskId)) return
        const currentConfig = mutationConfig
        if (syncCachedProductState(currentConfig, repoId, taskId)) return
        await refreshTaskProjection(currentConfig, repoId, taskId, { repairNavigation: true, bypassCache: true })
    }

    const handleTaskMcpServerIdsChange = async (serverIds: string[]) => {
        const activeScope = activeReadableTaskScopeForHandler()
        if (
            !activeScope ||
            !activeScope.capabilities.settingsCapabilities.mcpServers.canRead ||
            !activeScope.capabilities.taskRecordCapabilities.canUpdateMetadata
        )
            return
        const { config: currentConfig, repoId, taskId } = activeScope
        const clientRequestId = newClientRequestId("remote-task-mcp")
        setError(null)
        setTask((current) => (current && current.id === taskId ? { ...current, enabledMcpServerIds: serverIds } : current))
        try {
            trackAcceptedMutationNotification(clientRequestId)
            await getRemoteProductStore(currentConfig).updateTaskMetadata({
                taskId,
                enabledMcpServerIds: serverIds,
                clientRequestId,
            })
            await syncTaskAfterAcceptedMutation(currentConfig, repoId, taskId)
        } catch (err) {
            setTaskScopedError(currentConfig, repoId, taskId, err, "Unable to update task connectors")
        }
    }

    const handleSaveTaskTitle = async () => {
        const activeScope = activeReadableTaskScopeForHandler()
        if (!activeScope || !activeScope.capabilities.taskRecordCapabilities.canUpdateMetadata) return
        if (!taskTitleDraft.trim()) return
        const { config: currentConfig, repoId, taskId } = activeScope
        const clientRequestId = newClientRequestId("remote-task-title")
        setError(null)
        try {
            trackAcceptedMutationNotification(clientRequestId)
            await getRemoteProductStore(currentConfig).updateTaskMetadata({
                taskId,
                title: taskTitleDraft.trim(),
                clientRequestId,
            })
            await syncTaskAfterAcceptedMutation(currentConfig, repoId, taskId)
        } catch (err) {
            setTaskScopedError(currentConfig, repoId, taskId, err, "Unable to update task title")
        }
    }

    const handleGenerateTaskTitle = async () => {
        const activeScope = activeReadableTaskScopeForHandler()
        if (!activeScope || !activeScope.capabilities.taskRecordCapabilities.canGenerateTitle) return
        const submissionToken = beginSubmission()
        if (submissionToken === null) return
        const { config: currentConfig, repoId, taskId } = activeScope
        const clientRequestId = newClientRequestId("remote-task-title-generate")
        setError(null)
        setNotice(null)
        try {
            trackAcceptedMutationNotification(clientRequestId)
            const result = await getRemoteProductStore(currentConfig).generateTaskTitle(
                {
                    repoId,
                    taskId,
                    harnessId: agentHarnessId,
                },
                { clientRequestId }
            )
            if (!isActiveTaskScope(currentConfig, repoId, taskId)) return
            setTaskTitleDraft(result.title)
            await syncTaskAfterAcceptedMutation(currentConfig, repoId, taskId)
        } catch (err) {
            setTaskScopedError(currentConfig, repoId, taskId, err, "Unable to generate task title")
        } finally {
            finishSubmissionToken(submissionToken)
        }
    }

    const handlePrepareTaskEnvironment = async () => {
        const activeScope = activeReadableTaskScopeForHandler()
        if (!activeScope || !activeScope.capabilities.taskRecordCapabilities.canPrepareEnvironment) return
        const submissionToken = beginSubmission()
        if (submissionToken === null) return
        const { config: currentConfig, repoId, taskId } = activeScope
        const clientRequestId = newClientRequestId("remote-task-environment-prepare")
        setError(null)
        setNotice(null)
        try {
            trackAcceptedMutationNotification(clientRequestId)
            await getRemoteProductStore(currentConfig).prepareTaskEnvironment({ repoId, taskId }, { clientRequestId })
            await syncTaskAfterAcceptedMutation(currentConfig, repoId, taskId)
        } catch (err) {
            setTaskScopedError(currentConfig, repoId, taskId, err, "Unable to prepare task environment")
        } finally {
            finishSubmissionToken(submissionToken)
        }
    }

    const handleToggleTaskClosed = async () => {
        const activeScope = activeReadableTaskScopeForHandler()
        if (!activeScope || !activeScope.capabilities.taskRecordCapabilities.canUpdateMetadata) return
        const { config: currentConfig, repoId, taskId } = activeScope
        const clientRequestId = newClientRequestId("remote-task-closed")
        setError(null)
        try {
            trackAcceptedMutationNotification(clientRequestId)
            await getRemoteProductStore(currentConfig).updateTaskMetadata({
                taskId,
                closed: !(task?.closed ?? selectedTask?.closed ?? false),
                clientRequestId,
            })
            await syncTaskAfterAcceptedMutation(currentConfig, repoId, taskId)
        } catch (err) {
            setTaskScopedError(currentConfig, repoId, taskId, err, "Unable to update task")
        }
    }

    const handleCancelPlan = async (planEventId: string) => {
        const activeScope = activeReadableTaskScopeForHandler()
        if (!activeScope || !activeScope.capabilities.taskRecordCapabilities.canUpdateMetadata) return
        if (!planEventId) return
        const { config: currentConfig, repoId, taskId } = activeScope
        const clientRequestId = newClientRequestId("remote-task-cancel-plan")
        setError(null)
        setTask((current) => (current && current.id === taskId ? { ...current, cancelledPlanEventId: planEventId } : current))
        try {
            trackAcceptedMutationNotification(clientRequestId)
            await getRemoteProductStore(currentConfig).updateTaskMetadata({
                taskId,
                cancelledPlanEventId: planEventId,
                clientRequestId,
            })
            await syncTaskAfterAcceptedMutation(currentConfig, repoId, taskId)
        } catch (err) {
            setTaskScopedError(currentConfig, repoId, taskId, err, "Unable to cancel plan")
        }
    }

    const handleDeleteTask = async () => {
        const activeScope = activeReadableTaskScopeForHandler()
        if (!activeScope || !activeScope.capabilities.taskRecordCapabilities.canDelete) return
        if (!window.confirm("Delete this task?")) return
        const { config: currentConfig, repoId, taskId } = activeScope
        setError(null)
        try {
            await getRemoteProductStore(currentConfig).deleteTask({
                repoId,
                taskId,
                options: {
                    deleteSnapshots: false,
                    deleteImages: false,
                    deleteSessions: false,
                    deleteWorktrees: false,
                },
            })
            if (!isActiveTaskScope(currentConfig, repoId, taskId)) return
            setSelectedTaskState(null)
            setTask(null)
            setScreenState("project")
            const taskList = await refreshProjectTaskList(currentConfig, repoId, {
                repairNavigation: true,
                bypassCache: true,
            })
            if (!taskList) await refreshProjectProjection(currentConfig, { repairNavigation: true, bypassCache: true })
        } catch (err) {
            setTaskScopedError(currentConfig, repoId, taskId, err, "Unable to delete task")
        }
    }

    const handleCreateComment = async () => {
        const activeScope = activeReadableTaskScopeForHandler()
        if (!activeScope || !activeScope.capabilities.taskCommentCapabilities.canCreate) return
        if (!commentDraft.trim()) return
        const { config: currentConfig, repoId, taskId } = activeScope
        const clientRequestId = newClientRequestId("remote-comment")
        setError(null)
        try {
            trackAcceptedMutationNotification(clientRequestId)
            await getRemoteProductStore(currentConfig).createComment({
                taskId,
                content: commentDraft.trim(),
                source: { type: "companion" },
                selectedText: { text: "", linesBefore: "", linesAfter: "" },
                author: { id: "companion", email: "companion@openade.local" },
                clientRequestId,
            })
            setCommentDraft("")
            await syncTaskAfterAcceptedMutation(currentConfig, repoId, taskId)
        } catch (err) {
            setTaskScopedError(currentConfig, repoId, taskId, err, "Unable to create comment")
        }
    }

    const handleStartEditComment = (comment: OpenADETaskCommentView) => {
        const activeScope = activeReadableTaskScopeForHandler()
        if (!activeScope || !activeScope.capabilities.taskCommentCapabilities.canEdit) return
        setEditingCommentId(comment.id)
        setEditingCommentDraft(comment.content)
    }

    const handleSaveComment = async (commentId: string) => {
        const activeScope = activeReadableTaskScopeForHandler()
        if (!activeScope || !activeScope.capabilities.taskCommentCapabilities.canEdit) return
        if (!editingCommentDraft.trim()) return
        const { config: currentConfig, repoId, taskId } = activeScope
        const clientRequestId = newClientRequestId("remote-comment-edit")
        setError(null)
        try {
            trackAcceptedMutationNotification(clientRequestId)
            await getRemoteProductStore(currentConfig).editComment({
                taskId,
                commentId,
                content: editingCommentDraft.trim(),
                clientRequestId,
            })
            setEditingCommentId(null)
            setEditingCommentDraft("")
            await syncTaskAfterAcceptedMutation(currentConfig, repoId, taskId)
        } catch (err) {
            setTaskScopedError(currentConfig, repoId, taskId, err, "Unable to edit comment")
        }
    }

    const handleDeleteComment = async (commentId: string) => {
        const activeScope = activeReadableTaskScopeForHandler()
        if (!activeScope || !activeScope.capabilities.taskCommentCapabilities.canDelete) return
        const { config: currentConfig, repoId, taskId } = activeScope
        const clientRequestId = newClientRequestId("remote-comment-delete")
        setError(null)
        try {
            trackAcceptedMutationNotification(clientRequestId)
            await getRemoteProductStore(currentConfig).deleteComment({
                taskId,
                commentId,
                clientRequestId,
            })
            if (editingCommentId === commentId) {
                setEditingCommentId(null)
                setEditingCommentDraft("")
            }
            await syncTaskAfterAcceptedMutation(currentConfig, repoId, taskId)
        } catch (err) {
            setTaskScopedError(currentConfig, repoId, taskId, err, "Unable to delete comment")
        }
    }

    const handleCancelQueuedTurn = async (queuedTurnId: string) => {
        const activeScope = activeReadableTaskScopeForHandler()
        if (!activeScope || !activeScope.capabilities.queuedTurnCapabilities.canCancel) return
        const { config: currentConfig, repoId, taskId } = activeScope
        const clientRequestId = newClientRequestId("remote-queued-turn-cancel")
        setError(null)
        try {
            trackAcceptedMutationNotification(clientRequestId)
            await getRemoteProductStore(currentConfig).cancelQueuedTurn({
                repoId,
                taskId,
                queuedTurnId,
                clientRequestId,
            })
            await syncTaskAfterAcceptedMutation(currentConfig, repoId, taskId)
        } catch (err) {
            setTaskScopedError(currentConfig, repoId, taskId, err, "Unable to cancel queued turn")
        }
    }

    const handleReorderQueuedTurns = async (queuedTurnIds: string[]) => {
        const activeScope = activeReadableTaskScopeForHandler()
        if (!activeScope || !activeScope.capabilities.queuedTurnCapabilities.canReorder) return
        if (queuedTurnIds.length === 0) return
        const { config: currentConfig, repoId, taskId } = activeScope
        const clientRequestId = newClientRequestId("remote-queued-turn-reorder")
        setError(null)
        try {
            trackAcceptedMutationNotification(clientRequestId)
            await getRemoteProductStore(currentConfig).reorderQueuedTurns({
                repoId,
                taskId,
                queuedTurnIds,
                clientRequestId,
            })
            await syncTaskAfterAcceptedMutation(currentConfig, repoId, taskId)
        } catch (err) {
            setTaskScopedError(currentConfig, repoId, taskId, err, "Unable to reorder queued turns")
        }
    }

    const handleStartReview = async (reviewType: TaskReviewType) => {
        const activeScope = activeReadableTaskScopeForHandler()
        if (!activeScope || !activeScope.capabilities.taskReviewCapabilities.canStart) return
        const submissionToken = beginSubmission()
        if (submissionToken === null) return
        setError(null)
        setNotice(null)
        const { config: currentConfig, repoId, taskId } = activeScope
        try {
            const result = await getRemoteProductStore(currentConfig).startReview({
                repoId,
                taskId,
                reviewType,
                harnessId: agentHarnessId,
                modelId: agentModelId,
                thinking: agentThinking,
                fastMode: agentFastMode,
                customInstructions: reviewInstructions.trim() || undefined,
                clientRequestId: newClientRequestId(`remote-review-${reviewType}`),
            })
            if (!isActiveTaskScope(currentConfig, repoId, taskId)) return
            setReviewInstructions("")
            setSelectedTaskState(result.taskId)
            if (result.eventId) {
                trackAcceptedActionStartNotification(repoId, result.taskId, result.eventId)
                cancelPendingAcceptedActionStartRefresh(repoId, result.taskId, result.eventId)
            }
            setScreenState("task")
            if (!syncCachedProductState(currentConfig, repoId, result.taskId)) {
                await refreshTaskProjection(currentConfig, repoId, result.taskId, { bypassCache: true })
            }
        } catch (err) {
            setTaskScopedError(currentConfig, repoId, taskId, err, "Unable to start review")
        } finally {
            finishSubmissionToken(submissionToken)
        }
    }

    const handleForget = () => {
        if (!config) {
            clearRemoteConfig()
            setConfigs([])
            setIsAddingHost(true)
            return
        }
        const next = removeRemoteConfig(config.id)
        syncConfigs()
        resetRemoteView()
        setActiveRemoteConfig(next)
        setIsAddingHost(next === null)
    }

    const handleSelfRevoke = async () => {
        const currentConfig = activeRemoteConfigForHandler(config, configRef.current)
        if (!currentConfig) return
        if (!shellCapabilitiesForRemoteConfig(currentConfig).settingsCapabilities.canSelfRevoke) return
        if (!window.confirm("Revoke this device?")) return
        setError(null)
        setIsLoading(true)
        try {
            await selfRevokeRemoteDevice(currentConfig)
            handleForget()
        } catch (err) {
            setError(remoteErrorMessage(err, "Unable to revoke this device"))
        } finally {
            setIsLoading(false)
        }
    }

    const handleSelectHost = (configId: string) => {
        const next = activateRemoteConfig(configId)
        if (!next) return
        syncConfigs()
        resetRemoteView()
        setActiveRemoteConfig(next)
        setIsAddingHost(false)
    }

    const handleRemoveHost = (configId: string) => {
        const next = removeRemoteConfig(configId)
        syncConfigs()
        if (config?.id === configId) {
            resetRemoteView()
            setActiveRemoteConfig(next)
            setIsAddingHost(next === null)
        }
    }

    const handleAddHost = () => {
        setError(null)
        setBaseUrl("")
        setPairToken("")
        setPairHostId(undefined)
        setPendingConnection(null)
        setIsAddingHost(true)
    }

    const handleThemeChange = (value: OpenADEThemeSetting) => {
        setThemeSetting(value)
        saveOpenADEThemeSetting(value)
    }

    const handlePersonalSettingsChange = async (nextSettings: OpenADEPersonalSettings) => {
        const currentConfig = activeRemoteConfigForHandler(config, configRef.current)
        const settingsCapabilities = currentConfig ? shellCapabilitiesForRemoteConfig(currentConfig).settingsCapabilities : null
        if (!currentConfig || !settingsCapabilities?.personalSettings.canRead || !settingsCapabilities.personalSettings.canReplace) return
        const previousSettings = personalSettings
        setError(null)
        setNotice(null)
        setPersonalSettings(nextSettings)
        setPersonalSettingsActionLoading(true)
        try {
            const result = await getRemoteProductStore(currentConfig).replacePersonalSettings(
                { settings: nextSettings },
                { clientRequestId: newClientRequestId("remote-personal-settings") }
            )
            if (configRef.current?.id === currentConfig.id) {
                setPersonalSettings(result.settings)
                applyPersonalSettingsAgentDefaults(result.settings)
                if (isActiveSettingsScope(currentConfig)) setNotice("Preferences updated.")
            }
        } catch (err) {
            if (configRef.current?.id === currentConfig.id) {
                setPersonalSettings(previousSettings)
                if (isActiveSettingsScope(currentConfig)) setError(remoteErrorMessage(err, "Unable to update preferences"))
            }
        } finally {
            if (configRef.current?.id === currentConfig.id) setPersonalSettingsActionLoading(false)
        }
    }

    const handleMcpServerChange = async (nextServer: OpenADEMCPServer) => {
        const currentConfig = activeRemoteConfigForHandler(config, configRef.current)
        const settingsCapabilities = currentConfig ? shellCapabilitiesForRemoteConfig(currentConfig).settingsCapabilities : null
        if (!currentConfig || !settingsCapabilities?.mcpServers.canRead || !settingsCapabilities.mcpServers.canUpsert) return
        const previousServers = mcpServers
        setError(null)
        setNotice(null)
        setMcpServerActionId(nextServer.id)
        setMcpServers((current) =>
            current.some((server) => server.id === nextServer.id)
                ? current.map((server) => (server.id === nextServer.id ? nextServer : server))
                : [...current, nextServer]
        )
        setMcpServersLoaded(true)
        try {
            const result = await getRemoteProductStore(currentConfig).upsertMcpServer(
                { server: nextServer },
                { clientRequestId: newClientRequestId("remote-mcp-server") }
            )
            if (configRef.current?.id === currentConfig.id) {
                setMcpServers((current) =>
                    current.some((server) => server.id === result.server.id)
                        ? current.map((server) => (server.id === result.server.id ? result.server : server))
                        : [...current, result.server]
                )
                if (isActiveSettingsScope(currentConfig)) setNotice("Connector updated.")
            }
        } catch (err) {
            if (configRef.current?.id === currentConfig.id) {
                setMcpServers(previousServers)
                if (isActiveSettingsScope(currentConfig)) setError(remoteErrorMessage(err, "Unable to update connector"))
            }
        } finally {
            if (configRef.current?.id === currentConfig.id) setMcpServerActionId(null)
        }
    }

    const handleMcpServerDelete = async (serverId: string) => {
        const currentConfig = activeRemoteConfigForHandler(config, configRef.current)
        const settingsCapabilities = currentConfig ? shellCapabilitiesForRemoteConfig(currentConfig).settingsCapabilities : null
        if (!currentConfig || !settingsCapabilities?.mcpServers.canRead || !settingsCapabilities.mcpServers.canDelete) return
        const server = mcpServers.find((candidate) => candidate.id === serverId)
        if (!server) return
        if (!window.confirm(`Delete connector ${server.name}?`)) return
        const previousServers = mcpServers
        setError(null)
        setNotice(null)
        setMcpServerActionId(serverId)
        setMcpServers((current) => current.filter((candidate) => candidate.id !== serverId))
        setMcpServersLoaded(true)
        try {
            await getRemoteProductStore(currentConfig).deleteMcpServer({ serverId }, { clientRequestId: newClientRequestId("remote-mcp-server-delete") })
            if (configRef.current?.id === currentConfig.id && isActiveSettingsScope(currentConfig)) setNotice("Connector deleted.")
        } catch (err) {
            if (configRef.current?.id === currentConfig.id) {
                setMcpServers(previousServers)
                if (isActiveSettingsScope(currentConfig)) setError(remoteErrorMessage(err, "Unable to delete connector"))
            }
        } finally {
            if (configRef.current?.id === currentConfig.id) setMcpServerActionId(null)
        }
    }

    if (!config || isAddingHost) {
        return (
            <RemotePairingScreen
                canScan={Boolean(scanPairingCode)}
                baseUrl={baseUrl}
                pendingConnection={pendingConnection}
                isLoading={isLoading}
                error={error}
                canCancel={Boolean(config)}
                onBaseUrlChange={handleBaseUrlChange}
                onScan={handleScan}
                onSubmitPairingLink={handleSubmitPairingLink}
                onConfirm={confirmConnection}
                onCancelPending={() => setPendingConnection(null)}
                onCancelAdd={() => setIsAddingHost(false)}
            />
        )
    }

    const snapshotsBySession = snapshot ? { ...sessionSnapshots, [config.id]: snapshot } : sessionSnapshots

    const handleBack = () => {
        if (screen === "task") {
            setSelectedTaskState(null)
            setTask(null)
            setScreenState("project")
            return
        }
        if (screen === "project") {
            setSelectedRepoState(null)
        }
        setScreenState("projects")
    }

    const taskMcpControl =
        mcpServerCapabilities.canRead && shellCapabilities.taskRecordCapabilities.canUpdateMetadata ? (
            <TaskMcpPicker
                servers={mcpServers}
                selectedServerIds={task?.enabledMcpServerIds ?? []}
                disabled={isSubmitting}
                loaded={mcpServersLoaded}
                loading={mcpServersLoading}
                onLoad={() => {
                    void loadMcpServers()
                }}
                onSelectionChange={handleTaskMcpServerIdsChange}
            />
        ) : undefined
    const newTaskMcpControl =
        mcpServerCapabilities.canRead && shellCapabilities.taskRecordCapabilities.canCreate ? (
            <TaskMcpPicker
                servers={mcpServers}
                selectedServerIds={newTaskMcpServerIds}
                disabled={isSubmitting}
                loaded={mcpServersLoaded}
                loading={mcpServersLoading}
                onLoad={() => {
                    void loadMcpServers()
                }}
                onSelectionChange={setNewTaskMcpServerIds}
            />
        ) : undefined
    const taskComposerEditor =
        taskEditorManager && selectedRepoId ? (
            <RemoteSmartEditorInput
                manager={taskEditorManager}
                editorRef={taskComposerEditorRef}
                value={input}
                placeholder="Send to OpenADE"
                disabled={isSubmitting}
                fileMentionsDir={projectFileCapabilities.canSearch ? (selectedRepo?.path ?? selectedRepoId) : null}
                slashCommandsDir={taskSdkCapabilities ? (selectedRepo?.path ?? selectedRepoId) : null}
                sdkCapabilities={taskSdkCapabilities}
                onValueChange={setInput}
            />
        ) : undefined
    const newTaskComposerEditor =
        newTaskEditorManager && newTaskComposerRepoId ? (
            <RemoteSmartEditorInput
                manager={newTaskEditorManager}
                editorRef={newTaskComposerEditorRef}
                value={newTaskPrompt}
                placeholder="What should OpenADE do?"
                disabled={isSubmitting}
                fileMentionsDir={
                    projectFileCapabilities.canSearch ? (visibleRepos.find((repo) => repo.id === newTaskComposerRepoId)?.path ?? newTaskComposerRepoId) : null
                }
                slashCommandsDir={
                    newTaskSdkCapabilities ? (visibleRepos.find((repo) => repo.id === newTaskComposerRepoId)?.path ?? newTaskComposerRepoId) : null
                }
                sdkCapabilities={newTaskSdkCapabilities}
                onValueChange={setNewTaskPrompt}
            />
        ) : undefined
    const remoteCanReadProjectDirectory =
        shellCapabilities.projectDirectoryCapabilities.canReadSnapshot || shellCapabilities.projectDirectoryCapabilities.canReadProjects
    const remoteCanReadAnyProjectGit =
        shellCapabilities.projectGitCapabilities.canReadInfo ||
        shellCapabilities.projectGitCapabilities.canReadBranches ||
        shellCapabilities.projectGitCapabilities.canReadSummary
    const remoteCanReadAnyTaskGit =
        shellCapabilities.taskGitCapabilities.canReadChanges ||
        shellCapabilities.taskGitCapabilities.canReadLog ||
        shellCapabilities.taskGitCapabilities.canReadSummary ||
        shellCapabilities.taskGitCapabilities.canReadScopes
    const remoteCanReadTask = shellCapabilities.taskDirectoryCapabilities.canRead
    const remoteCanSubmitTaskInput = selectedTaskIsRunning
        ? remoteCanReadTask && shellCapabilities.taskTurnCapabilities.canEnqueue && canQueueTaskCommandWhileRunning(commandType)
        : remoteCanReadTask && shellCapabilities.taskTurnCapabilities.canStart
    const remoteCanOpenNewTask = remoteCanReadProjectDirectory && shellCapabilities.taskRecordCapabilities.canCreate
    const visibleTaskRepeatState =
        taskRepeatState && config.id === taskRepeatState.configId && selectedRepoId === taskRepeatState.repoId && selectedTaskId === taskRepeatState.taskId
            ? {
                  stopOnText: taskRepeatState.stopOnText,
                  maxRuns: taskRepeatState.maxRuns,
                  iterationCount: taskRepeatState.iterationCount,
                  onStopOnTextChange: (value: string) => {
                      setTaskRepeatStopOnText(value)
                      setTaskRepeatState((current) => (sameRemoteTaskRepeatRun(current, taskRepeatState) ? { ...current, stopOnText: value } : current))
                  },
                  onMaxRunsChange: (value: number) => {
                      const maxRuns = repeatMaxRuns(value)
                      setTaskRepeatMaxRuns(maxRuns)
                      setTaskRepeatState((current) => (sameRemoteTaskRepeatRun(current, taskRepeatState) ? { ...current, maxRuns } : current))
                  },
              }
            : undefined

    return (
        <OpenADEShell
            className={rootClass}
            screen={screen}
            host={formatHost(config)}
            status={status}
            isLoading={isLoading}
            isSubmitting={isSubmitting}
            isOnline={isOnline}
            error={error}
            notice={notice}
            connectionWarning={connectionStatus !== "connected" ? status.label : null}
            sessions={configs.map((item) => ({
                id: item.id,
                host: item.host,
                snapshot: snapshotsBySession[item.id] ?? null,
                isActive: item.id === config.id,
            }))}
            showArchivedProjects={showArchivedProjects}
            shellCapabilities={shellCapabilities}
            projectActionLoading={isSubmitting}
            selectedRepo={selectedRepo}
            selectedTask={selectedTask}
            visibleRepos={visibleRepos}
            workingTaskIds={snapshot?.workingTaskIds ?? []}
            projectFiles={projectFiles}
            projectFilesLoading={projectFilesLoading}
            projectFileRead={projectFileRead}
            projectFileActionPath={projectFileActionPath}
            projectFileSearchQuery={projectFileSearchQuery}
            projectFileSearchResult={projectFileSearchResult}
            projectFileSearchLoading={projectFileSearchLoading}
            projectSearchQuery={projectSearchQuery}
            projectSearchResult={projectSearchResult}
            projectSearchLoading={projectSearchLoading}
            projectGitInfo={projectGitInfo}
            projectGitBranches={projectGitBranches}
            projectGitSummary={projectGitSummary}
            projectGitLoading={projectGitLoading}
            projectCronDefinitions={projectCronDefinitions}
            projectCronInstallState={projectCronInstallState}
            projectCronDefinitionsLoading={projectCronDefinitionsLoading}
            projectCronInstallStateLoading={projectCronInstallStateLoading}
            projectCronInstallActionId={projectCronInstallActionId}
            projectProcesses={projectProcesses}
            projectProcessesLoading={projectProcessesLoading}
            projectProcessActionId={projectProcessActionId}
            projectProcessOutput={projectProcessOutput}
            task={task}
            input={input}
            commandType={commandType}
            taskTitleDraft={taskTitleDraft}
            commentDraft={commentDraft}
            editingCommentId={editingCommentId}
            editingCommentDraft={editingCommentDraft}
            reviewInstructions={reviewInstructions}
            taskChanges={taskChanges}
            taskGitLog={taskGitLog}
            taskGitSummary={taskGitSummary}
            taskGitScopes={taskGitScopes}
            taskChangesLoading={taskChangesLoading}
            taskDiff={taskDiff}
            taskDiffActionPath={taskDiffActionPath}
            taskFilePair={taskFilePair}
            taskFilePairActionPath={taskFilePairActionPath}
            taskCommitFiles={taskCommitFiles}
            taskCommitFilesActionSha={taskCommitFilesActionSha}
            taskCommitPatch={taskCommitPatch}
            taskCommitPatchActionKey={taskCommitPatchActionKey}
            taskTreeishFile={taskTreeishFile}
            taskTreeishFileActionKey={taskTreeishFileActionKey}
            taskResources={taskResources}
            taskResourcesLoading={taskResourcesLoading}
            taskTerminalProductAccess={taskTerminalProductAccess}
            taskAgentControls={{
                harnessId: agentHarnessId,
                allowHarnessSwitch: true,
                selectedModel: agentModelId,
                thinking: agentThinking,
                fastMode: agentFastMode,
                onHarnessChange: handleAgentHarnessChange,
                onModelChange: setAgentModelId,
                onThinkingChange: setAgentThinking,
                onFastModeChange: setAgentFastMode,
                mcpControl: taskMcpControl,
            }}
            taskHyperplanPresetId={taskHyperplanPresetId}
            taskImageAttachments={taskImageAttachments}
            taskImageAttachLoading={taskImageAttachLoading}
            taskRepeatState={visibleTaskRepeatState}
            taskComposerEditor={taskComposerEditor}
            onFocusTaskInputShortcut={() => taskComposerEditorRef.current?.focusEnd()}
            newTaskRepoId={newTaskRepoId ?? selectedRepo?.id ?? null}
            newTaskMode={newTaskMode}
            newTaskTitle={newTaskTitle}
            newTaskPrompt={newTaskPrompt}
            newTaskIsolationStrategy={newTaskIsolationStrategy}
            newTaskBranches={newTaskBranches}
            newTaskBranchesLoading={newTaskBranchesLoading}
            newTaskPreferredSourceBranch={newTaskPreferredSourceBranch}
            newTaskAgentControls={{
                harnessId: agentHarnessId,
                allowHarnessSwitch: true,
                selectedModel: agentModelId,
                thinking: agentThinking,
                fastMode: agentFastMode,
                onHarnessChange: handleAgentHarnessChange,
                onModelChange: setAgentModelId,
                onThinkingChange: setAgentThinking,
                onFastModeChange: setAgentFastMode,
                mcpControl: newTaskMcpControl,
            }}
            newTaskHyperplanPresetId={newTaskHyperplanPresetId}
            newTaskImageAttachments={newTaskImageAttachments}
            newTaskImageAttachLoading={newTaskImageAttachLoading}
            newTaskComposerEditor={newTaskComposerEditor}
            onFocusNewTaskInputShortcut={() => newTaskComposerEditorRef.current?.focusEnd()}
            newTaskDrafts={visibleNewTaskDrafts}
            newTaskPendingCreations={visibleNewTaskPendingCreations}
            newTaskCanStashDraft={canStashNewTaskDraft}
            newTaskCanRestoreDraft={canRestoreNewTaskDraft}
            newTaskCreateMore={newTaskCreateMore}
            configs={configs}
            activeConfigId={config.id}
            settingsConfig={config}
            settingsProductData={{
                personalSettings,
                personalSettingsLoading,
                personalSettingsActionLoading,
                mcpServers,
                mcpServersLoading,
                mcpServerActionId,
            }}
            snapshot={snapshot}
            themeSetting={themeSetting}
            loadTaskImage={loadTaskImage}
            taskSnapshotPatches={taskSnapshotPatches}
            taskSnapshotPatchActionId={taskSnapshotPatchActionId}
            onBack={handleBack}
            onRefresh={() => {
                void refreshAll({ bypassCache: true })
            }}
            onNavigate={setScreenState}
            onToggleArchivedProjects={() => setShowArchivedProjects((value) => !value)}
            onSelectSession={handleSelectHost}
            onSelectProject={remoteCanReadProjectDirectory ? handleSelectProject : undefined}
            onCreateProject={shellCapabilities.projectRecordCapabilities.canCreate ? handleCreateProject : undefined}
            onInspectProjectPath={shellCapabilities.projectRecordCapabilities.canInspectPath ? handleInspectProjectPath : undefined}
            onUpdateProject={shellCapabilities.projectRecordCapabilities.canUpdate ? handleUpdateProject : undefined}
            onDeleteProject={shellCapabilities.projectRecordCapabilities.canDelete ? handleDeleteProject : undefined}
            onAddHost={handleAddHost}
            onSelectTask={shellCapabilities.taskDirectoryCapabilities.canRead ? handleSelectTask : undefined}
            onNewTask={
                remoteCanOpenNewTask
                    ? () => {
                          selectNewTaskRepo(selectedRepo?.id ?? visibleRepos[0]?.id ?? null)
                          setScreenState("new_task")
                      }
                    : undefined
            }
            onRefreshProjectProcesses={shellCapabilities.projectProcessCapabilities.canRead ? handleRefreshProjectProcesses : undefined}
            onStartProjectProcess={
                shellCapabilities.projectProcessCapabilities.canRead && shellCapabilities.projectProcessCapabilities.canStart
                    ? handleStartProjectProcess
                    : undefined
            }
            onReconnectProjectProcess={
                shellCapabilities.projectProcessCapabilities.canRead && shellCapabilities.projectProcessCapabilities.canReconnect
                    ? handleReconnectProjectProcess
                    : undefined
            }
            onStopProjectProcess={
                shellCapabilities.projectProcessCapabilities.canRead && shellCapabilities.projectProcessCapabilities.canStop
                    ? handleStopProjectProcess
                    : undefined
            }
            onRefreshProjectFiles={shellCapabilities.projectFileCapabilities.canList ? handleRefreshProjectFiles : undefined}
            onReadProjectFile={shellCapabilities.projectFileCapabilities.canRead ? handleReadProjectFile : undefined}
            onProjectFileSearchQueryChange={setProjectFileSearchQuery}
            onSearchProjectFiles={shellCapabilities.projectFileCapabilities.canSearch ? handleSearchProjectFiles : undefined}
            onWriteProjectFile={
                shellCapabilities.projectFileCapabilities.canRead && shellCapabilities.projectFileCapabilities.canWrite ? handleWriteProjectFile : undefined
            }
            onProjectSearchQueryChange={setProjectSearchQuery}
            onSearchProject={shellCapabilities.projectSearchCapabilities.canSearch ? handleSearchProject : undefined}
            onRefreshProjectGit={remoteCanReadAnyProjectGit ? handleRefreshProjectGit : undefined}
            onRefreshProjectCronDefinitions={shellCapabilities.projectCronCapabilities.canRead ? handleRefreshProjectCronDefinitions : undefined}
            onRefreshProjectCronInstallState={shellCapabilities.projectCronCapabilities.canReadInstallState ? handleRefreshProjectCronInstallState : undefined}
            onSetProjectCronEnabled={
                shellCapabilities.projectCronCapabilities.canReadInstallState && shellCapabilities.projectCronCapabilities.canReplaceInstallState
                    ? handleSetProjectCronEnabled
                    : undefined
            }
            onRunProjectCron={
                shellCapabilities.projectCronCapabilities.canRead && shellCapabilities.projectCronCapabilities.canRun ? handleRunProjectCron : undefined
            }
            onInputChange={setInput}
            onCommandTypeChange={setCommandType}
            onAttachTaskImage={
                remoteCanReadTask && shellCapabilities.taskImageCapabilities.canWrite && remoteCanSubmitTaskInput ? handleAttachTaskImage : undefined
            }
            onRemoveTaskImage={
                remoteCanReadTask && shellCapabilities.taskImageCapabilities.canWrite && remoteCanSubmitTaskInput ? handleRemoveTaskImage : undefined
            }
            onTaskTitleChange={setTaskTitleDraft}
            onSaveTaskTitle={remoteCanReadTask && shellCapabilities.taskRecordCapabilities.canUpdateMetadata ? handleSaveTaskTitle : undefined}
            onGenerateTaskTitle={remoteCanReadTask && shellCapabilities.taskRecordCapabilities.canGenerateTitle ? handleGenerateTaskTitle : undefined}
            onPrepareTaskEnvironment={
                remoteCanReadTask && shellCapabilities.taskRecordCapabilities.canPrepareEnvironment ? handlePrepareTaskEnvironment : undefined
            }
            onToggleTaskClosed={remoteCanReadTask && shellCapabilities.taskRecordCapabilities.canUpdateMetadata ? handleToggleTaskClosed : undefined}
            onDeleteTask={remoteCanReadTask && shellCapabilities.taskRecordCapabilities.canDelete ? handleDeleteTask : undefined}
            onCancelPlan={remoteCanReadTask && shellCapabilities.taskRecordCapabilities.canUpdateMetadata ? handleCancelPlan : undefined}
            onCommentDraftChange={setCommentDraft}
            onCreateComment={remoteCanReadTask && shellCapabilities.taskCommentCapabilities.canCreate ? handleCreateComment : undefined}
            onStartEditComment={remoteCanReadTask && shellCapabilities.taskCommentCapabilities.canEdit ? handleStartEditComment : undefined}
            onEditingCommentDraftChange={setEditingCommentDraft}
            onSaveComment={remoteCanReadTask && shellCapabilities.taskCommentCapabilities.canEdit ? handleSaveComment : undefined}
            onCancelEditComment={() => {
                setEditingCommentId(null)
                setEditingCommentDraft("")
            }}
            onDeleteComment={remoteCanReadTask && shellCapabilities.taskCommentCapabilities.canDelete ? handleDeleteComment : undefined}
            onCancelQueuedTurn={remoteCanReadTask && shellCapabilities.queuedTurnCapabilities.canCancel ? handleCancelQueuedTurn : undefined}
            onReorderQueuedTurns={remoteCanReadTask && shellCapabilities.queuedTurnCapabilities.canReorder ? handleReorderQueuedTurns : undefined}
            onReviewInstructionsChange={setReviewInstructions}
            onStartReview={remoteCanReadTask && shellCapabilities.taskReviewCapabilities.canStart ? handleStartReview : undefined}
            onRefreshTaskGit={remoteCanReadAnyTaskGit ? handleRefreshTaskGit : undefined}
            onReadTaskDiff={shellCapabilities.taskGitCapabilities.canReadDiff ? handleReadTaskDiff : undefined}
            onReadTaskFilePair={shellCapabilities.taskGitCapabilities.canReadFilePair ? handleReadTaskFilePair : undefined}
            onReadTaskCommitFiles={shellCapabilities.taskGitCapabilities.canReadCommitFiles ? handleReadTaskCommitFiles : undefined}
            onReadTaskCommitFilePatch={shellCapabilities.taskGitCapabilities.canReadCommitFilePatch ? handleReadTaskCommitFilePatch : undefined}
            onReadTaskCommitFileAtTreeish={shellCapabilities.taskGitCapabilities.canReadFileAtTreeish ? handleReadTaskCommitFileAtTreeish : undefined}
            onCommitTaskGit={shellCapabilities.taskCanCommitGit ? handleCommitTaskGit : undefined}
            onCommitAndPushTask={
                remoteCanReadTask && shellCapabilities.taskTurnCapabilities.canStart && !selectedTaskIsRunning ? handleCommitAndPushTask : undefined
            }
            onStartTaskRepeat={
                remoteCanReadTask && shellCapabilities.taskTurnCapabilities.canStart && !selectedTaskIsRunning ? handleStartTaskRepeat : undefined
            }
            onStopTaskRepeat={taskRepeatState ? handleStopTaskRepeat : undefined}
            onRefreshTaskResources={shellCapabilities.taskResourceCapabilities.canRead ? handleRefreshTaskResources : undefined}
            onLoadTaskSnapshotPatch={shellCapabilities.taskSnapshotPatchCapabilities.canRead ? handleLoadTaskSnapshotPatch : undefined}
            onLoadTaskSnapshotPatchSlice={shellCapabilities.taskSnapshotPatchCapabilities.canReadSlice ? handleLoadTaskSnapshotPatchSlice : undefined}
            onSendTaskInput={remoteCanSubmitTaskInput ? handleRunInTask : undefined}
            onAbortTask={remoteCanReadTask && shellCapabilities.taskTurnCapabilities.canInterrupt ? handleAbort : undefined}
            onRetryTask={remoteCanReadTask && shellCapabilities.taskTurnCapabilities.canStart && !selectedTaskIsRunning ? handleRetryTask : undefined}
            onTaskHyperplanPresetChange={setTaskHyperplanPresetId}
            onNewTaskRepoChange={selectNewTaskRepo}
            onNewTaskModeChange={setNewTaskMode}
            onNewTaskTitleChange={setNewTaskTitle}
            onNewTaskPromptChange={setNewTaskPrompt}
            onNewTaskIsolationStrategyChange={handleNewTaskIsolationStrategyChange}
            onRefreshNewTaskBranches={
                shellCapabilities.projectGitCapabilities.canReadBranches
                    ? () => {
                          void refreshNewTaskBranches()
                      }
                    : undefined
            }
            onNewTaskHyperplanPresetChange={setNewTaskHyperplanPresetId}
            onStashNewTaskDraft={handleStashNewTaskDraft}
            onRestoreNewTaskDraft={handleRestoreNewTaskDraft}
            onDeleteNewTaskDraft={handleDeleteNewTaskDraft}
            onRetryNewTaskPendingCreation={handleRetryNewTaskPendingCreation}
            onOpenNewTaskPendingCreation={(creationId) => {
                void handleOpenNewTaskPendingCreation(creationId)
            }}
            onCancelNewTaskPendingCreation={handleCancelNewTaskPendingCreation}
            onDismissNewTaskPendingCreation={handleDismissNewTaskPendingCreation}
            onNewTaskCreateMoreChange={handleNewTaskCreateMoreChange}
            onAttachNewTaskImage={
                shellCapabilities.taskImageCapabilities.canWrite && shellCapabilities.taskTurnCapabilities.canStart ? handleAttachNewTaskImage : undefined
            }
            onRemoveNewTaskImage={
                shellCapabilities.taskImageCapabilities.canWrite && shellCapabilities.taskTurnCapabilities.canStart ? handleRemoveNewTaskImage : undefined
            }
            onCreateTask={remoteCanOpenNewTask ? handleCreateTask : undefined}
            onSelectHost={handleSelectHost}
            onRemoveHost={handleRemoveHost}
            onForget={handleForget}
            onSelfRevoke={shellCapabilities.settingsCapabilities.canSelfRevoke ? handleSelfRevoke : undefined}
            onThemeChange={handleThemeChange}
            onPersonalSettingsChange={
                shellCapabilities.settingsCapabilities.personalSettings.canRead && shellCapabilities.settingsCapabilities.personalSettings.canReplace
                    ? handlePersonalSettingsChange
                    : undefined
            }
            onMcpServerChange={
                shellCapabilities.settingsCapabilities.mcpServers.canRead && shellCapabilities.settingsCapabilities.mcpServers.canUpsert
                    ? handleMcpServerChange
                    : undefined
            }
            onMcpServerDelete={
                shellCapabilities.settingsCapabilities.mcpServers.canRead && shellCapabilities.settingsCapabilities.mcpServers.canDelete
                    ? handleMcpServerDelete
                    : undefined
            }
        />
    )
}
