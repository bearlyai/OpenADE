import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type {
    OpenADECronDefinitionsReadResult,
    OpenADEProjectFileReadResult,
    OpenADEProjectFilesFuzzySearchResult,
    OpenADEProjectFilesTreeResult,
    OpenADEProjectGitBranchesReadResult,
    OpenADEProjectGitInfoResult,
    OpenADEProjectGitSummaryReadResult,
    OpenADEProjectProcessListResult,
    OpenADEProjectProcessReconnectResult,
    OpenADEProjectSearchResult,
    OpenADESnapshot,
    OpenADETask,
    OpenADETaskChangesReadResult,
    OpenADETaskDiffReadResult,
    OpenADETaskFilePairReadResult,
    OpenADETaskGitChangedFile,
    OpenADETaskGitCommitFilePatchResult,
    OpenADETaskGitCommitFilesResult,
    OpenADETaskGitFileAtTreeishResult,
    OpenADETaskGitLogResult,
    OpenADETaskGitLogEntry,
    OpenADETaskGitScopesReadResult,
    OpenADETaskGitSummaryResult,
    OpenADETaskPreview,
    OpenADETaskResourceInventoryReadResult,
    OpenADESnapshotPatchFile,
    OpenADETaskSnapshotPatchReadResult,
    OpenADETurnStartRequest,
} from "../../../openade-module/src"
import type { RuntimeNotification } from "../../../runtime-protocol/src"
import { DEFAULT_HARNESS_ID, getDefaultModelForHarness } from "../constants"
import type { HarnessId } from "../electronAPI/harnessEventTypes"
import { type OpenADEThemeSetting, isOpenADEThemeSetting } from "../shell/OpenADESessionScreens"
import { OpenADEShell, type OpenADEShellScreen } from "../shell/OpenADEShell"
import { RemotePairingScreen } from "../shell/RemotePairingScreen"
import type { TaskTerminalProductAccess } from "../components/terminalSession"
import type { TaskImageLoader, TaskSnapshotPatchView } from "../shell/task/TaskEventThread"
import type { TaskGitCapabilities } from "../shell/task/TaskGitPanel"
import type { OpenADETaskCommentView, TaskProductCapabilities, TaskReviewType } from "../shell/task/TaskProductPanel"
import type { TaskImageAttachment, TaskSnapshotBlock } from "../shell/task/taskEventPresentation"
import { canQueueTaskCommandWhileRunning } from "../shell/task/taskCommands"
import type { ThinkingLevel } from "../store/TaskModel"
import type {
    ProjectCronCapabilities,
    ProjectFileCapabilities,
    ProjectGitCapabilities,
    ProjectProcessCapabilities,
    ProjectSearchCapabilities,
} from "../shell/project/ProjectHostPanels"
import {
    type PairingTarget,
    type RemoteConfig,
    type RemoteRealtimeConnectionStatus,
    activateRemoteConfig,
    buildPairingTarget,
    clearRemoteConfig,
    getRemoteProductStore,
    loadRemoteConfig,
    loadRemoteConfigs,
    pairRemote,
    parsePairingCode,
    remoteHasRuntimeMethods,
    remoteErrorMessage,
    removeRemoteConfig,
    retryRemoteRead,
    saveRemoteConfig,
    selfRevokeRemoteDevice,
    subscribeRemoteChanges,
} from "./client"
import { remoteRefreshPlan } from "./refreshPolicy"
import { nextRemoteRefreshDelay } from "./refreshQueue"
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
    bypassCache?: boolean
}
type PendingTaskRefresh = {
    repoId: string
    taskId: string
    eventId?: string
    eventStatus?: string
}

export const REMOTE_THEME_STORAGE_KEY = "openade-companion-theme"
const TASK_LIST_METHOD = "openade/task/list"
const TASK_TERMINAL_METHODS = [
    "openade/task/terminal/start",
    "openade/task/terminal/reconnect",
    "openade/task/terminal/write",
    "openade/task/terminal/resize",
    "openade/task/terminal/stop",
]
const PROJECT_PROCESS_LIST_METHOD = "openade/project/process/list"
const PROJECT_PROCESS_START_METHOD = "openade/project/process/start"
const PROJECT_PROCESS_RECONNECT_METHOD = "openade/project/process/reconnect"
const PROJECT_PROCESS_STOP_METHOD = "openade/project/process/stop"
const PROJECT_FILES_TREE_METHOD = "openade/project/files/tree"
const PROJECT_FILES_FUZZY_SEARCH_METHOD = "openade/project/files/fuzzySearch"
const PROJECT_FILE_READ_METHOD = "openade/project/file/read"
const PROJECT_FILE_WRITE_METHOD = "openade/project/file/write"
const PROJECT_SEARCH_METHOD = "openade/project/search"
const PROJECT_GIT_METHODS = ["openade/project/git/info/read", "openade/project/git/branches/read", "openade/project/git/summary/read"]
const PROJECT_CRON_DEFINITIONS_METHOD = "openade/cron/definitions/read"
const TASK_GIT_BASE_METHODS = ["openade/task/changes/read", "openade/task/git/log", "openade/task/git/summary/read", "openade/task/git/scopes/read"]
const TASK_DIFF_METHOD = "openade/task/diff/read"
const TASK_FILE_PAIR_METHOD = "openade/task/filePair/read"
const TASK_COMMIT_FILES_METHOD = "openade/task/git/commit/files/read"
const TASK_FILE_AT_TREEISH_METHOD = "openade/task/git/fileAtTreeish/read"
const TASK_COMMIT_FILE_PATCH_METHOD = "openade/task/git/commit/filePatch/read"
const TASK_GIT_COMMIT_METHOD = "openade/task/git/commit"
const TASK_RESOURCE_INVENTORY_METHOD = "openade/task/resourceInventory/read"
const TASK_IMAGE_READ_METHOD = "openade/task/image/read"
const TASK_SNAPSHOT_PATCH_READ_METHOD = "openade/task/snapshot/patch/read"
const TASK_SNAPSHOT_INDEX_READ_METHOD = "openade/task/snapshot/index/read"
const TASK_SNAPSHOT_PATCH_SLICE_READ_METHOD = "openade/task/snapshot/patch/readSlice"
const TASK_CREATE_METHOD = "openade/task/create"
const TASK_DELETE_METHOD = "openade/task/delete"
const TURN_START_METHOD = "openade/turn/start"
const TURN_INTERRUPT_METHOD = "openade/turn/interrupt"
const REVIEW_START_METHOD = "openade/review/start"
const TASK_METADATA_UPDATE_METHOD = "openade/task/metadata/update"
const TASK_TITLE_GENERATE_METHOD = "openade/task/title/generate"
const TASK_ENVIRONMENT_PREPARE_METHOD = "openade/task/environment/prepare"
const COMMENT_CREATE_METHOD = "openade/comment/create"
const COMMENT_EDIT_METHOD = "openade/comment/edit"
const COMMENT_DELETE_METHOD = "openade/comment/delete"
const QUEUED_TURN_ENQUEUE_METHOD = "openade/queued-turn/enqueue"
const QUEUED_TURN_CANCEL_METHOD = "openade/queued-turn/cancel"
const QUEUED_TURN_REORDER_METHOD = "openade/queued-turn/reorder"
const REMOTE_DEVICE_SELF_REVOKE_METHOD = "remote/device/selfRevoke"
const REMOTE_TASK_CREATED_BY = { id: "remote-companion", email: "remote-companion@openade.local" }

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

function parseDeepLinkParams(): { baseUrl?: string; token?: string } {
    const search = new URLSearchParams(window.location.search)
    const hashSearch = window.location.hash.includes("?") ? new URLSearchParams(window.location.hash.slice(window.location.hash.indexOf("?") + 1)) : null
    return {
        baseUrl: search.get("baseUrl") ?? hashSearch?.get("baseUrl") ?? undefined,
        token: search.get("token") ?? hashSearch?.get("token") ?? undefined,
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

function isTransientRemoteRefreshError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error)
    return /Runtime socket (closed|disconnected|failed|is not connected)|WebSocket/i.test(message)
}

function newClientRequestId(prefix: string): string {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `${prefix}-${crypto.randomUUID()}`
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
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

function runtimeNotificationParams(notification: RuntimeNotification): Record<string, unknown> {
    return typeof notification.params === "object" && notification.params !== null && !Array.isArray(notification.params)
        ? (notification.params as Record<string, unknown>)
        : {}
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

export function RemoteApp({ scanPairingCode }: RemoteAppProps = {}) {
    const initialParams = useMemo(parseDeepLinkParams, [])
    const [configs, setConfigs] = useState<RemoteConfig[]>(() => loadRemoteConfigs())
    const [config, setConfig] = useState<RemoteConfig | null>(() => loadRemoteConfig())
    const [isAddingHost, setIsAddingHost] = useState(() => loadRemoteConfig() === null)
    const [screen, setScreen] = useState<RemoteScreen>("projects")
    const [baseUrl, setBaseUrl] = useState(initialParams.baseUrl ?? "")
    const [pairToken, setPairToken] = useState(initialParams.token ?? "")
    const [pairHostId, setPairHostId] = useState<string | undefined>()
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
    const [projectCronDefinitionsLoading, setProjectCronDefinitionsLoading] = useState(false)
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
    const [agentHarnessId, setAgentHarnessId] = useState<HarnessId>(DEFAULT_HARNESS_ID)
    const [agentModelId, setAgentModelId] = useState(() => getDefaultModelForHarness(DEFAULT_HARNESS_ID))
    const [agentThinking, setAgentThinking] = useState<ThinkingLevel>("max")
    const [agentFastMode, setAgentFastMode] = useState(false)
    const [isLoading, setIsLoading] = useState(false)
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [rawConnectionStatus, setRawConnectionStatus] = useState<RemoteRealtimeConnectionStatus>("disconnected")
    const [error, setError] = useState<string | null>(null)
    const [notice, setNotice] = useState<string | null>(null)
    const selectedRepoIdRef = useRef<string | null>(null)
    const selectedTaskIdRef = useRef<string | null>(null)
    const screenRef = useRef<RemoteScreen>(screen)
    const configRef = useRef<RemoteConfig | null>(config)
    const snapshotRef = useRef<OpenADESnapshot | null>(snapshot)
    const snapshotRefreshTimerRef = useRef<number | null>(null)
    const snapshotRefreshRepairsNavigationRef = useRef(false)
    const taskRefreshTimerRef = useRef<number | null>(null)
    const sessionRefreshTimerRef = useRef<number | null>(null)
    const taskRefreshInFlightRef = useRef(false)
    const taskRefreshPendingRef = useRef<PendingTaskRefresh | null>(null)
    const lastTaskRefreshAtRef = useRef(0)
    const submitLockRef = useRef(false)
    const acceptedActionStartNotificationsRef = useRef(new Map<string, number>())
    const acceptedMutationNotificationsRef = useRef(new Map<string, number>())

    const setScreenState = (nextScreen: RemoteScreen) => {
        screenRef.current = nextScreen
        setScreen(nextScreen)
    }

    const setSelectedRepoState = (nextRepoId: string | null) => {
        selectedRepoIdRef.current = nextRepoId
        setSelectedRepoId(nextRepoId)
    }

    const setSelectedTaskState = (nextTaskId: string | null) => {
        selectedTaskIdRef.current = nextTaskId
        setSelectedTaskId(nextTaskId)
    }

    const handleAgentHarnessChange = (harnessId: HarnessId) => {
        setAgentHarnessId(harnessId)
        setAgentModelId(getDefaultModelForHarness(harnessId))
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
        if (notification.method !== "openade/task/updated") return false
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
    const desktopThemeClass = snapshot?.server.theme?.className ?? "code-theme-black"
    const themeClass = themeSetting === "desktop" ? desktopThemeClass : themeSetting
    const rootClass = `code-theme ${themeClass} flex bg-base-100 text-base-content flex-col overflow-hidden`
    const connectionStatus = useSmoothedRemoteStatus(rawConnectionStatus)
    const status = statusCopy(connectionStatus)
    const isOnline = isRemoteRealtimeOnline(connectionStatus)
    const projectProcessCapabilities = useMemo<ProjectProcessCapabilities>(() => {
        if (!config) {
            return {
                canRead: false,
                canStart: false,
                canReconnect: false,
                canStop: false,
            }
        }
        return {
            canRead: remoteHasRuntimeMethods(config, [PROJECT_PROCESS_LIST_METHOD]),
            canStart: remoteHasRuntimeMethods(config, [PROJECT_PROCESS_START_METHOD]),
            canReconnect: remoteHasRuntimeMethods(config, [PROJECT_PROCESS_RECONNECT_METHOD]),
            canStop: remoteHasRuntimeMethods(config, [PROJECT_PROCESS_STOP_METHOD]),
        }
    }, [config, connectionStatus])
    const projectFileCapabilities = useMemo<ProjectFileCapabilities>(
        () => ({
            canList: config ? remoteHasRuntimeMethods(config, [PROJECT_FILES_TREE_METHOD]) : false,
            canRead: config ? remoteHasRuntimeMethods(config, [PROJECT_FILE_READ_METHOD]) : false,
            canSearch: config ? remoteHasRuntimeMethods(config, [PROJECT_FILES_FUZZY_SEARCH_METHOD]) : false,
            canWrite: config ? remoteHasRuntimeMethods(config, [PROJECT_FILE_WRITE_METHOD]) : false,
        }),
        [config, connectionStatus]
    )
    const projectSearchCapabilities = useMemo<ProjectSearchCapabilities>(
        () => ({
            canSearch: config ? remoteHasRuntimeMethods(config, [PROJECT_SEARCH_METHOD]) : false,
            canOpenFile: config ? remoteHasRuntimeMethods(config, [PROJECT_FILE_READ_METHOD]) : false,
        }),
        [config, connectionStatus]
    )
    const projectGitCapabilities = useMemo<ProjectGitCapabilities>(
        () => ({
            canRead: config ? remoteHasRuntimeMethods(config, PROJECT_GIT_METHODS) : false,
        }),
        [config, connectionStatus]
    )
    const projectCronCapabilities = useMemo<ProjectCronCapabilities>(
        () => ({
            canRead: config ? remoteHasRuntimeMethods(config, [PROJECT_CRON_DEFINITIONS_METHOD]) : false,
        }),
        [config, connectionStatus]
    )
    const taskGitCapabilities = useMemo<TaskGitCapabilities>(
        () => ({
            canRead: config ? remoteHasRuntimeMethods(config, TASK_GIT_BASE_METHODS) : false,
            canReadDiff: config ? remoteHasRuntimeMethods(config, [TASK_DIFF_METHOD]) : false,
            canReadFilePair: config ? remoteHasRuntimeMethods(config, [TASK_FILE_PAIR_METHOD]) : false,
            canReadCommitFiles: config ? remoteHasRuntimeMethods(config, [TASK_COMMIT_FILES_METHOD]) : false,
            canReadCommitFilePatch: config ? remoteHasRuntimeMethods(config, [TASK_COMMIT_FILE_PATCH_METHOD]) : false,
            canReadFileAtTreeish: config ? remoteHasRuntimeMethods(config, [TASK_FILE_AT_TREEISH_METHOD]) : false,
            canCommit: config ? remoteHasRuntimeMethods(config, [TASK_GIT_COMMIT_METHOD]) : false,
        }),
        [config, connectionStatus]
    )
    const taskCanReadResources = useMemo(() => (config ? remoteHasRuntimeMethods(config, [TASK_RESOURCE_INVENTORY_METHOD]) : false), [config, connectionStatus])
    const taskCanReadSnapshotPatch = useMemo(() => {
        if (!config) return false
        return (
            remoteHasRuntimeMethods(config, [TASK_SNAPSHOT_PATCH_READ_METHOD]) ||
            remoteHasRuntimeMethods(config, [TASK_SNAPSHOT_INDEX_READ_METHOD, TASK_SNAPSHOT_PATCH_SLICE_READ_METHOD])
        )
    }, [config, connectionStatus])
    const taskCanReadSnapshotPatchSlice = useMemo(
        () => (config ? remoteHasRuntimeMethods(config, [TASK_SNAPSHOT_INDEX_READ_METHOD, TASK_SNAPSHOT_PATCH_SLICE_READ_METHOD]) : false),
        [config, connectionStatus]
    )
    const taskCanReadImages = useMemo(() => (config ? remoteHasRuntimeMethods(config, [TASK_IMAGE_READ_METHOD]) : false), [config, connectionStatus])
    const taskCanCreate = useMemo(() => (config ? remoteHasRuntimeMethods(config, [TASK_CREATE_METHOD]) : false), [config, connectionStatus])
    const taskCanDelete = useMemo(() => (config ? remoteHasRuntimeMethods(config, [TASK_DELETE_METHOD]) : false), [config, connectionStatus])
    const projectTaskListCanRead = useMemo(() => (config ? remoteHasRuntimeMethods(config, [TASK_LIST_METHOD]) : false), [config, connectionStatus])
    const taskCanStartTurn = useMemo(() => (config ? remoteHasRuntimeMethods(config, [TURN_START_METHOD]) : false), [config, connectionStatus])
    const taskCanEnqueueQueuedTurn = useMemo(() => (config ? remoteHasRuntimeMethods(config, [QUEUED_TURN_ENQUEUE_METHOD]) : false), [config, connectionStatus])
    const taskCanInterrupt = useMemo(() => (config ? remoteHasRuntimeMethods(config, [TURN_INTERRUPT_METHOD]) : false), [config, connectionStatus])
    const settingsCanSelfRevoke = useMemo(
        () => (config ? remoteHasRuntimeMethods(config, [REMOTE_DEVICE_SELF_REVOKE_METHOD]) : false),
        [config, connectionStatus]
    )
    const taskProductCapabilities = useMemo<TaskProductCapabilities>(
        () => ({
            canUpdateMetadata: config ? remoteHasRuntimeMethods(config, [TASK_METADATA_UPDATE_METHOD]) : false,
            canGenerateTitle: config ? remoteHasRuntimeMethods(config, [TASK_TITLE_GENERATE_METHOD]) : false,
            canPrepareEnvironment: config ? remoteHasRuntimeMethods(config, [TASK_ENVIRONMENT_PREPARE_METHOD]) : false,
            canStartReview: config ? remoteHasRuntimeMethods(config, [REVIEW_START_METHOD]) : false,
            canCreateComment: config ? remoteHasRuntimeMethods(config, [COMMENT_CREATE_METHOD]) : false,
            canEditComment: config ? remoteHasRuntimeMethods(config, [COMMENT_EDIT_METHOD]) : false,
            canDeleteComment: config ? remoteHasRuntimeMethods(config, [COMMENT_DELETE_METHOD]) : false,
            canCancelQueuedTurn: config ? remoteHasRuntimeMethods(config, [QUEUED_TURN_CANCEL_METHOD]) : false,
            canReorderQueuedTurns: config ? remoteHasRuntimeMethods(config, [QUEUED_TURN_REORDER_METHOD]) : false,
        }),
        [config, connectionStatus]
    )
    const loadTaskImage = useCallback<TaskImageLoader>(
        async (image) => {
            const currentConfig = configRef.current
            const currentTask = task
            if (!currentConfig || !currentTask) return null
            if (!remoteHasRuntimeMethods(currentConfig, [TASK_IMAGE_READ_METHOD])) return null
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
    const taskTerminalProductAccess = useMemo<TaskTerminalProductAccess | null>(() => {
        if (!config || !selectedRepoId || !selectedTaskId) return null
        if (!remoteHasRuntimeMethods(config, TASK_TERMINAL_METHODS)) return null
        const repoId = selectedRepoId
        const taskId = selectedTaskId
        const store = getRemoteProductStore(config)
        return {
            repoId,
            taskId,
            startTaskTerminal: (args) => store.startTaskTerminal({ repoId, taskId, ...args }),
            reconnectTaskTerminal: (args) => store.reconnectTaskTerminal({ repoId, taskId, ...args }),
            writeTaskTerminal: (args) => store.writeTaskTerminal({ repoId, taskId, ...args }),
            resizeTaskTerminal: (args) => store.resizeTaskTerminal({ repoId, taskId, ...args }),
            stopTaskTerminal: (args) => store.stopTaskTerminal({ repoId, taskId, ...args }),
        }
    }, [config, connectionStatus, selectedRepoId, selectedTaskId])

    useEffect(() => {
        selectedRepoIdRef.current = selectedRepoId
        selectedTaskIdRef.current = selectedTaskId
        screenRef.current = screen
        configRef.current = config
        snapshotRef.current = snapshot
    }, [selectedRepoId, selectedTaskId, screen, config, snapshot])

    useEffect(() => {
        return () => {
            if (snapshotRefreshTimerRef.current) window.clearTimeout(snapshotRefreshTimerRef.current)
            if (taskRefreshTimerRef.current) window.clearTimeout(taskRefreshTimerRef.current)
            if (sessionRefreshTimerRef.current) window.clearTimeout(sessionRefreshTimerRef.current)
            acceptedActionStartNotificationsRef.current.clear()
            acceptedMutationNotificationsRef.current.clear()
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
        setRawConnectionStatus("disconnected")
        acceptedActionStartNotificationsRef.current.clear()
        acceptedMutationNotificationsRef.current.clear()
        setScreenState("projects")
    }

    const configsKey = configs.map((item) => `${item.id}:${item.baseUrl}`).join("|")

    useEffect(() => {
        const updateFromUrl = () => {
            const params = parseDeepLinkParams()
            if (params.baseUrl) setBaseUrl(params.baseUrl)
            if (params.token) setPairToken(params.token)
        }
        window.addEventListener("openade-pairing-url", updateFromUrl)
        return () => window.removeEventListener("openade-pairing-url", updateFromUrl)
    }, [])

    const applySnapshotResult = (nextConfig: RemoteConfig, next: OpenADESnapshot, options: SnapshotRefreshOptions = {}): OpenADESnapshot => {
        const currentRepoId = selectedRepoIdRef.current
        const currentTaskId = selectedTaskIdRef.current
        const shouldRepairNavigation = options.repairNavigation === true
        const nextRepoId = currentRepoId && next.repos.some((repo) => repo.id === currentRepoId) ? currentRepoId : null
        const nextRepo = next.repos.find((repo) => repo.id === nextRepoId) ?? null

        setSessionSnapshots((current) => ({ ...current, [nextConfig.id]: next }))
        snapshotRef.current = next
        setSnapshot(next)
        if (nextRepoId || shouldRepairNavigation) setSelectedRepoState(nextRepoId)
        setNewTaskRepoId((current) => {
            if (current && next.repos.some((repo) => repo.id === current)) return current
            return nextRepoId ?? next.repos.find((repo) => !repo.archived)?.id ?? next.repos[0]?.id ?? null
        })

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

    const refreshSnapshot = async (nextConfig = config, options: SnapshotRefreshOptions = {}): Promise<OpenADESnapshot | null> => {
        if (!nextConfig) return null
        const next = await retryRemoteRead(() =>
            getRemoteProductStore(nextConfig).refreshSnapshot({
                bypassCache: options.bypassCache === true,
            })
        )
        return applySnapshotResult(nextConfig, next, options)
    }

    const refreshProjectTaskList = async (
        nextConfig = config,
        repoId: string | null | undefined = selectedRepoIdRef.current,
        options: SnapshotRefreshOptions = {}
    ): Promise<OpenADETaskPreview[] | null> => {
        if (!projectTaskListCanRead) return null
        if (!nextConfig || !repoId) return null
        const tasks = await retryRemoteRead(() => getRemoteProductStore(nextConfig).listTasks(repoId, { bypassCache: options.bypassCache === true }))
        applyProjectTaskListResult(nextConfig, repoId, tasks, options)
        return tasks
    }

    const syncCachedProductState = (nextConfig: RemoteConfig, repoId: string, taskId: string): boolean => {
        const store = getRemoteProductStore(nextConfig)
        if (store.snapshot) applySnapshotResult(nextConfig, store.snapshot)
        const cachedTask = store.getCachedTask(repoId, taskId)
        if (!cachedTask) return false
        if (selectedTaskIdRef.current === taskId) setTask(cachedTask)
        return true
    }

    const refreshSessionSnapshots = async () => {
        const entries = await Promise.all(
            configs.map(async (item) => {
                try {
                    return [item.id, await retryRemoteRead(() => getRemoteProductStore(item).refreshSnapshot())] as const
                } catch {
                    return [item.id, null] as const
                }
            })
        )
        setSessionSnapshots((current) => {
            const next = { ...current }
            for (const [id, value] of entries) {
                if (value) next[id] = value
            }
            return next
        })
    }

    const refreshTask = async (
        nextConfig = config,
        repoId: string | null | undefined = selectedRepoIdRef.current ?? selectedRepo?.id,
        taskId: string | null | undefined = selectedTaskIdRef.current,
        options: TaskRefreshOptions = { hydrateSessionEvents: false }
    ) => {
        if (!nextConfig || !repoId || !taskId) return
        const taskOptions = {
            hydrateSessionEvents: options.hydrateSessionEvents ?? false,
        }
        const nextTask = await retryRemoteRead(() => {
            const store = getRemoteProductStore(nextConfig)
            return options.bypassCache === true ? store.refreshTask(repoId, taskId, taskOptions) : store.getTask(repoId, taskId, taskOptions)
        })
        if (selectedTaskIdRef.current === taskId) setTask(nextTask)
        return nextTask
    }

    const refreshProjectProcesses = async (nextConfig = config, repoId: string | null | undefined = selectedRepoIdRef.current) => {
        if (!projectProcessCapabilities.canRead) {
            setProjectProcesses(null)
            setProjectProcessOutput(null)
            return null
        }
        if (!nextConfig || !repoId) {
            setProjectProcesses(null)
            setProjectProcessOutput(null)
            return null
        }
        setProjectProcessesLoading(true)
        try {
            const result = await retryRemoteRead(() => getRemoteProductStore(nextConfig).listProjectProcesses({ repoId }))
            if (selectedRepoIdRef.current === repoId) setProjectProcesses(result)
            return result
        } finally {
            setProjectProcessesLoading(false)
        }
    }

    const refreshProjectFiles = async (nextConfig = config, repoId: string | null | undefined = selectedRepoIdRef.current) => {
        if (!projectFileCapabilities.canList) {
            setProjectFiles(null)
            setProjectFileRead(null)
            return null
        }
        if (!nextConfig || !repoId) {
            setProjectFiles(null)
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
            if (selectedRepoIdRef.current === repoId) setProjectFiles(result)
            return result
        } finally {
            setProjectFilesLoading(false)
        }
    }

    const refreshProjectGit = async (nextConfig = config, repoId: string | null | undefined = selectedRepoIdRef.current) => {
        if (!projectGitCapabilities.canRead) {
            setProjectGitInfo(null)
            setProjectGitBranches(null)
            setProjectGitSummary(null)
            return null
        }
        if (!nextConfig || !repoId) {
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
                    store.readProjectGitInfo({ repoId }),
                    store.readProjectGitBranches({ repoId }),
                    store.readProjectGitSummary({ repoId }, { bypassCache: true }),
                ])
            )
            if (selectedRepoIdRef.current === repoId) {
                setProjectGitInfo(result[0])
                setProjectGitBranches(result[1])
                setProjectGitSummary(result[2])
            }
            return result
        } finally {
            setProjectGitLoading(false)
        }
    }

    const refreshProjectCronDefinitions = async (nextConfig = config, repoId: string | null | undefined = selectedRepoIdRef.current) => {
        if (!projectCronCapabilities.canRead) {
            setProjectCronDefinitions(null)
            return null
        }
        if (!nextConfig || !repoId) {
            setProjectCronDefinitions(null)
            return null
        }
        setProjectCronDefinitionsLoading(true)
        try {
            const result = await retryRemoteRead(() => getRemoteProductStore(nextConfig).readCronDefinitions({ repoId }))
            if (selectedRepoIdRef.current === repoId) setProjectCronDefinitions(result)
            return result
        } finally {
            setProjectCronDefinitionsLoading(false)
        }
    }

    const refreshTaskGit = async (
        nextConfig = config,
        repoId: string | null | undefined = selectedRepoIdRef.current,
        taskId: string | null | undefined = selectedTaskIdRef.current
    ) => {
        if (!taskGitCapabilities.canRead) {
            setTaskChanges(null)
            setTaskGitLog(null)
            setTaskGitSummary(null)
            setTaskGitScopes(null)
            return null
        }
        if (!nextConfig || !repoId || !taskId) {
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
                    store.readTaskChanges({ repoId, taskId }),
                    store.readTaskGitLog({ repoId, taskId, limit: 5 }),
                    store.readTaskGitSummary({ repoId, taskId }, { bypassCache: true }),
                    store.readTaskGitScopes({ repoId, taskId }),
                ])
            })
            if (selectedRepoIdRef.current === repoId && selectedTaskIdRef.current === taskId) {
                setTaskChanges(changes)
                setTaskGitLog(gitLog)
                setTaskGitSummary(gitSummary)
                setTaskGitScopes(gitScopes)
            }
            return { changes, gitLog, gitSummary, gitScopes }
        } finally {
            setTaskChangesLoading(false)
        }
    }

    const runBackgroundRefresh = async (work: () => Promise<void>, fallback: string) => {
        try {
            await work()
        } catch (err) {
            if (!isTransientRemoteRefreshError(err)) setError(remoteErrorMessage(err, fallback))
        }
    }

    const scheduleSnapshotRefresh = (delayMs = 300, options: SnapshotRefreshOptions = {}) => {
        snapshotRefreshRepairsNavigationRef.current = snapshotRefreshRepairsNavigationRef.current || options.repairNavigation === true
        if (snapshotRefreshTimerRef.current) window.clearTimeout(snapshotRefreshTimerRef.current)
        snapshotRefreshTimerRef.current = window.setTimeout(() => {
            const repairNavigation = snapshotRefreshRepairsNavigationRef.current
            snapshotRefreshRepairsNavigationRef.current = false
            void runBackgroundRefresh(async () => {
                await refreshSnapshot(configRef.current, {
                    repairNavigation,
                    bypassCache: options.bypassCache === true,
                })
            }, "Unable to refresh projects")
        }, delayMs)
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

    const scheduleSessionSnapshotsRefresh = (delayMs = 1200) => {
        if (sessionRefreshTimerRef.current) window.clearTimeout(sessionRefreshTimerRef.current)
        sessionRefreshTimerRef.current = window.setTimeout(() => {
            void runBackgroundRefresh(refreshSessionSnapshots, "Unable to refresh sessions")
        }, delayMs)
    }

    const refreshAll = async () => {
        if (!config) return
        setError(null)
        setIsLoading(true)
        try {
            const repoId = selectedRepoIdRef.current
            const taskId = selectedTaskIdRef.current
            const [nextSnapshot] = await Promise.all([
                refreshSnapshot(config),
                taskId ? refreshTask(config, repoId, taskId, { hydrateSessionEvents: false }) : Promise.resolve(),
            ])
            if (!taskId && selectedTaskIdRef.current) {
                await refreshTask(config, selectedRepoIdRef.current ?? nextSnapshot?.repos[0]?.id, selectedTaskIdRef.current, { hydrateSessionEvents: false })
            }
        } catch (err) {
            setError(remoteErrorMessage(err, "Unable to refresh"))
        } finally {
            setIsLoading(false)
        }
    }

    useEffect(() => {
        if (!config) return
        void refreshAll()
        return subscribeRemoteChanges(
            config,
            (notification) => {
                if (consumeAcceptedMutationNotification(notification)) return
                const plan = remoteRefreshPlan(notification, selectedTaskIdRef.current)
                const repairNavigation = notification.method === "openade/repo/deleted" || notification.method === "openade/task/deleted"
                const taskWasDeleted = notification.method === "openade/task/deleted"
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
                } else if (plan.type === "sessions" && screenRef.current === "sessions") {
                    scheduleSessionSnapshotsRefresh()
                }
            },
            setRawConnectionStatus
        )
    }, [config])

    useEffect(() => {
        if (!config || screen !== "task" || !selectedRepoId || !selectedTaskId) return
        setIsLoading(true)
        void refreshTask(config, selectedRepoId, selectedTaskId, {
            hydrateSessionEvents: false,
        })
            .catch((err) => {
                if (!isTransientRemoteRefreshError(err)) setError(remoteErrorMessage(err, "Unable to load task"))
            })
            .finally(() => setIsLoading(false))
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
        setTaskSnapshotPatches({})
        setTaskSnapshotPatchActionId(null)
    }, [config, screen, selectedRepoId, selectedTaskId])

    useEffect(() => {
        if (!config || screen !== "project" || !selectedRepoId) {
            setProjectProcesses(null)
            setProjectProcessesLoading(false)
            setProjectProcessOutput(null)
            setProjectFiles(null)
            setProjectFilesLoading(false)
            setProjectFileRead(null)
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
            return
        }
        setProjectProcessOutput(null)
        void runBackgroundRefresh(async () => {
            await refreshProjectTaskList(config, selectedRepoId, { bypassCache: true })
        }, "Unable to load project details")
    }, [config, screen, selectedRepoId])

    useEffect(() => {
        if (configs.length === 0) return
        void refreshSessionSnapshots()
    }, [configsKey])

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

    const handleSelectProject = async (configId: string, repoId: string) => {
        const nextConfig = config?.id === configId ? config : activateRemoteConfig(configId)
        if (!nextConfig) return
        syncConfigs()
        setConfig(nextConfig)
        setIsAddingHost(false)
        setSelectedRepoState(repoId)
        setSelectedTaskState(null)
        setTask(null)
        setNewTaskRepoId(repoId)
        setProjectProcessOutput(null)
        setProjectGitInfo(null)
        setProjectGitBranches(null)
        setProjectGitSummary(null)
        setProjectGitLoading(false)
        setProjectCronDefinitions(null)
        setProjectCronDefinitionsLoading(false)
        setScreenState("project")
        const nextSnapshot = sessionSnapshots[configId] ?? (await refreshSnapshot(nextConfig))
        if (nextSnapshot) setSnapshot(nextSnapshot)
    }

    const handleSelectTask = (taskId: string) => {
        setTask(null)
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
                    ? await pairRemote(pendingConnection.baseUrl, pendingConnection.token)
                    : saveRemoteConfig({
                          baseUrl: pendingConnection.baseUrl,
                          token: pendingConnection.token,
                          host: pendingConnection.host,
                          hostId: pendingConnection.hostId,
                      })
            syncConfigs()
            resetRemoteView()
            setConfig(next)
            setIsAddingHost(false)
            setBaseUrl("")
            setPairToken("")
            setPairHostId(undefined)
            setPendingConnection(null)
            await refreshSnapshot(next)
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

    const beginSubmission = () => {
        return beginRemoteSubmission(submitLockRef, {
            setSubmitting: setIsSubmitting,
            setLoading: setIsLoading,
        })
    }

    const finishSubmission = () => {
        finishRemoteSubmission(submitLockRef, {
            setSubmitting: setIsSubmitting,
            setLoading: setIsLoading,
        })
    }

    const handleRunInTask = async () => {
        if (!config || !selectedRepo || !input.trim()) return
        const submittedInput = input
        const submittedType = commandType
        const selectedTaskIsRunning = Boolean(selectedTask && snapshot?.workingTaskIds.includes(selectedTask.id))
        const canStartSubmittedTurn = !selectedTaskIsRunning && taskCanStartTurn
        const canEnqueueSubmittedTurn = selectedTaskIsRunning && taskCanEnqueueQueuedTurn && canQueueTaskCommandWhileRunning(submittedType)
        if (!canStartSubmittedTurn && !canEnqueueSubmittedTurn) return
        if (!beginSubmission()) return
        setError(null)
        setNotice(null)
        const submittedTaskId = task?.unavailableReason ? undefined : selectedTaskId
        const submittedHarnessId = agentHarnessId
        const submittedModelId = agentModelId
        const submittedThinking = agentThinking
        const submittedFastMode = agentFastMode
        try {
            const store = getRemoteProductStore(config)
            if (canEnqueueSubmittedTurn && selectedTask) {
                const clientRequestId = newClientRequestId("remote-queued-turn-enqueue")
                trackAcceptedMutationNotification(clientRequestId)
                await store.enqueueQueuedTurn(
                    {
                        repoId: selectedRepo.id,
                        taskId: selectedTask.id,
                        type: submittedType,
                        input: submittedInput,
                        harnessId: submittedHarnessId,
                        modelId: submittedModelId,
                        thinking: submittedThinking,
                        fastMode: submittedFastMode,
                    },
                    { clientRequestId }
                )
                setInput("")
                setNotice("Queued. It will run after the current turn finishes.")
                return
            }

            const result = await store.startTurn({
                repoId: selectedRepo.id,
                type: submittedType,
                input: submittedInput,
                inTaskId: submittedTaskId,
                harnessId: submittedHarnessId,
                modelId: submittedModelId,
                thinking: submittedThinking,
                fastMode: submittedFastMode,
            })
            setInput("")
            setSelectedTaskState(result.taskId)
            if (result.eventId) {
                trackAcceptedActionStartNotification(selectedRepo.id, result.taskId, result.eventId)
                cancelPendingAcceptedActionStartRefresh(selectedRepo.id, result.taskId, result.eventId)
            }
            setScreenState("task")
            if (!syncCachedProductState(config, selectedRepo.id, result.taskId)) {
                await refreshSnapshot(config)
                await refreshTask(config, selectedRepo.id, result.taskId, {
                    hydrateSessionEvents: false,
                })
            }
            if (result.queued) setNotice("Queued. It will run after the current turn finishes.")
        } catch (err) {
            setError(remoteErrorMessage(err, "Run failed"))
        } finally {
            finishSubmission()
        }
    }

    const handleCreateTask = async () => {
        const repoId = newTaskRepoId ?? selectedRepo?.id
        if (!taskCanCreate) return
        if (!config || !repoId || !newTaskPrompt.trim()) return
        if (!beginSubmission()) return
        setError(null)
        setNotice(null)
        const submittedTitle = newTaskTitle
        const submittedPrompt = newTaskPrompt
        const submittedMode = newTaskMode
        const submittedHarnessId = agentHarnessId
        const submittedModelId = agentModelId
        const submittedThinking = agentThinking
        const submittedFastMode = agentFastMode
        try {
            const store = getRemoteProductStore(config)
            const createClientRequestId = newClientRequestId("remote-task-create")
            trackAcceptedMutationNotification(createClientRequestId)
            const created = await store.createTask(
                {
                    repoId,
                    input: submittedPrompt,
                    title: submittedTitle.trim() || undefined,
                    createdBy: REMOTE_TASK_CREATED_BY,
                    deviceId: config.hostId ?? config.id,
                    isolationStrategy: { type: "head" },
                },
                { clientRequestId: createClientRequestId }
            )
            const started = taskCanStartTurn
                ? await store.startTurn({
                      repoId,
                      inTaskId: created.taskId,
                      type: submittedMode,
                      input: submittedPrompt,
                      harnessId: submittedHarnessId,
                      modelId: submittedModelId,
                      thinking: submittedThinking,
                      fastMode: submittedFastMode,
                  })
                : null
            setNewTaskPrompt("")
            setNewTaskTitle("")
            setSelectedRepoState(repoId)
            setSelectedTaskState(created.taskId)
            if (started?.eventId) {
                trackAcceptedActionStartNotification(repoId, created.taskId, started.eventId)
                cancelPendingAcceptedActionStartRefresh(repoId, created.taskId, started.eventId)
            }
            setScreenState("task")
            if (!syncCachedProductState(config, repoId, created.taskId)) {
                await refreshTask(config, repoId, created.taskId, {
                    hydrateSessionEvents: false,
                })
            }
            if (!taskCanStartTurn) setNotice("Task created.")
        } catch (err) {
            setError(remoteErrorMessage(err, "Task creation failed"))
        } finally {
            finishSubmission()
        }
    }

    const handleAbort = async () => {
        if (!taskCanInterrupt) return
        if (!config || !selectedTaskId) return
        await getRemoteProductStore(config).interruptTurn(selectedTaskId)
        await refreshAll()
    }

    const handleRefreshTaskGit = async () => {
        if (!taskGitCapabilities.canRead) return
        setError(null)
        try {
            await refreshTaskGit()
        } catch (err) {
            setError(remoteErrorMessage(err, "Unable to refresh task changes"))
        }
    }

    const handleReadTaskDiff = async (file: OpenADETaskGitChangedFile) => {
        if (!taskGitCapabilities.canReadDiff) return
        if (!config || !selectedRepoId || !selectedTaskId) return
        setError(null)
        setTaskDiffActionPath(file.path)
        try {
            const result = await retryRemoteRead(() =>
                getRemoteProductStore(config).readTaskDiff({
                    repoId: selectedRepoId,
                    taskId: selectedTaskId,
                    filePath: file.path,
                    oldPath: file.oldPath,
                    contextLines: 3,
                    allowTruncation: true,
                })
            )
            setTaskDiff(result)
        } catch (err) {
            setError(remoteErrorMessage(err, "Unable to read task diff"))
        } finally {
            setTaskDiffActionPath(null)
        }
    }

    const handleReadTaskFilePair = async (file: OpenADETaskGitChangedFile) => {
        if (!taskGitCapabilities.canReadFilePair) return
        if (!config || !selectedRepoId || !selectedTaskId) return
        setError(null)
        setTaskFilePairActionPath(file.path)
        try {
            const result = await retryRemoteRead(() =>
                getRemoteProductStore(config).readTaskFilePair({
                    repoId: selectedRepoId,
                    taskId: selectedTaskId,
                    filePath: file.path,
                    oldPath: file.oldPath,
                })
            )
            setTaskFilePair(result)
        } catch (err) {
            setError(remoteErrorMessage(err, "Unable to read file pair"))
        } finally {
            setTaskFilePairActionPath(null)
        }
    }

    const handleReadTaskCommitFiles = async (commit: OpenADETaskGitLogEntry) => {
        if (!taskGitCapabilities.canReadCommitFiles) return
        if (!config || !selectedRepoId || !selectedTaskId) return
        const repoId = selectedRepoId
        const taskId = selectedTaskId
        setError(null)
        setTaskCommitFilesActionSha(commit.sha)
        setTaskCommitPatch(null)
        setTaskTreeishFile(null)
        try {
            const result = await retryRemoteRead(() =>
                getRemoteProductStore(config).readTaskGitCommitFiles({
                    repoId,
                    taskId,
                    commit: commit.sha,
                })
            )
            if (selectedRepoIdRef.current === repoId && selectedTaskIdRef.current === taskId) setTaskCommitFiles(result)
        } catch (err) {
            setError(remoteErrorMessage(err, "Unable to read commit files"))
        } finally {
            setTaskCommitFilesActionSha(null)
        }
    }

    const handleReadTaskCommitFilePatch = async (file: OpenADETaskGitChangedFile) => {
        if (!taskGitCapabilities.canReadCommitFilePatch) return
        if (!config || !selectedRepoId || !selectedTaskId || !taskCommitFiles) return
        const repoId = selectedRepoId
        const taskId = selectedTaskId
        const commit = taskCommitFiles.commit
        const key = taskCommitFileActionKey(commit, file.path, file.oldPath)
        setError(null)
        setTaskCommitPatchActionKey(key)
        try {
            const result = await retryRemoteRead(() =>
                getRemoteProductStore(config).readTaskGitCommitFilePatch({
                    repoId,
                    taskId,
                    commit,
                    filePath: file.path,
                    oldPath: file.oldPath,
                    contextLines: 3,
                    allowTruncation: true,
                })
            )
            if (selectedRepoIdRef.current === repoId && selectedTaskIdRef.current === taskId) setTaskCommitPatch(result)
        } catch (err) {
            setError(remoteErrorMessage(err, "Unable to read commit patch"))
        } finally {
            setTaskCommitPatchActionKey(null)
        }
    }

    const handleReadTaskCommitFileAtTreeish = async (file: OpenADETaskGitChangedFile) => {
        if (!taskGitCapabilities.canReadFileAtTreeish) return
        if (!config || !selectedRepoId || !selectedTaskId || !taskCommitFiles) return
        const repoId = selectedRepoId
        const taskId = selectedTaskId
        const treeish = taskCommitFiles.commit
        const key = taskCommitFileActionKey(treeish, file.path, file.oldPath)
        setError(null)
        setTaskTreeishFileActionKey(key)
        try {
            const result = await retryRemoteRead(() =>
                getRemoteProductStore(config).readTaskGitFileAtTreeish({
                    repoId,
                    taskId,
                    treeish,
                    filePath: file.path,
                })
            )
            if (selectedRepoIdRef.current === repoId && selectedTaskIdRef.current === taskId) setTaskTreeishFile(result)
        } catch (err) {
            setError(remoteErrorMessage(err, "Unable to read commit file"))
        } finally {
            setTaskTreeishFileActionKey(null)
        }
    }

    const handleCommitTaskGit = async (message: string) => {
        if (!taskGitCapabilities.canCommit) return
        if (!config || !selectedRepoId || !selectedTaskId || !message.trim()) return
        if (!beginSubmission()) return
        const repoId = selectedRepoId
        const taskId = selectedTaskId
        setError(null)
        setNotice(null)
        try {
            const result = await getRemoteProductStore(config).commitTaskGit(
                {
                    repoId,
                    taskId,
                    message: message.trim(),
                },
                { clientRequestId: newClientRequestId("remote-task-git-commit") }
            )
            setNotice(result.committed ? `Committed ${result.sha?.slice(0, 8) ?? "changes"}` : "Nothing to commit")
            if (taskGitCapabilities.canRead) await refreshTaskGit(config, repoId, taskId)
        } catch (err) {
            setError(remoteErrorMessage(err, "Unable to commit task changes"))
        } finally {
            finishSubmission()
        }
    }

    const handleRefreshTaskResources = async () => {
        if (!taskCanReadResources) return
        if (!config || !selectedRepoId || !selectedTaskId) return
        setError(null)
        setTaskResourcesLoading(true)
        try {
            const result = await retryRemoteRead(() =>
                getRemoteProductStore(config).readTaskResourceInventory({
                    repoId: selectedRepoId,
                    taskId: selectedTaskId,
                })
            )
            setTaskResources(result)
        } catch (err) {
            setError(remoteErrorMessage(err, "Unable to read task resources"))
        } finally {
            setTaskResourcesLoading(false)
        }
    }

    const handleLoadTaskSnapshotPatch = async (block: TaskSnapshotBlock) => {
        if (!taskCanReadSnapshotPatch) return
        if (!config || !selectedRepoId || !selectedTaskId) return
        setError(null)
        setTaskSnapshotPatchActionId(block.id)
        try {
            if (remoteHasRuntimeMethods(config, [TASK_SNAPSHOT_INDEX_READ_METHOD, TASK_SNAPSHOT_PATCH_SLICE_READ_METHOD])) {
                const result = await retryRemoteRead(() =>
                    getRemoteProductStore(config).readTaskSnapshotIndex({
                        repoId: selectedRepoId,
                        taskId: selectedTaskId,
                        eventId: block.id,
                    })
                )
                setTaskSnapshotPatches((current) => ({
                    ...current,
                    [block.id]: {
                        eventId: result.eventId,
                        patchFileId: result.patchFileId,
                        index: result.index,
                        slices: current[block.id]?.slices,
                    },
                }))
                return
            }
            const result: OpenADETaskSnapshotPatchReadResult = await retryRemoteRead(() =>
                getRemoteProductStore(config).readTaskSnapshotPatch({
                    repoId: selectedRepoId,
                    taskId: selectedTaskId,
                    eventId: block.id,
                })
            )
            setTaskSnapshotPatches((current) => ({
                ...current,
                [block.id]: {
                    eventId: result.eventId,
                    patchFileId: result.patchFileId,
                    patch: result.patch,
                },
            }))
        } catch (err) {
            setError(remoteErrorMessage(err, "Unable to read snapshot patch"))
        } finally {
            setTaskSnapshotPatchActionId(null)
        }
    }

    const handleLoadTaskSnapshotPatchSlice = async (block: TaskSnapshotBlock, file: OpenADESnapshotPatchFile) => {
        if (!taskCanReadSnapshotPatchSlice) return
        if (!config || !selectedRepoId || !selectedTaskId) return
        const actionId = remoteSnapshotPatchActionId(block.id, file)
        setError(null)
        setTaskSnapshotPatchActionId(actionId)
        try {
            const result = await retryRemoteRead(() =>
                getRemoteProductStore(config).readTaskSnapshotPatchSlice({
                    repoId: selectedRepoId,
                    taskId: selectedTaskId,
                    eventId: block.id,
                    start: file.patchStart,
                    end: file.patchEnd,
                })
            )
            const sliceKey = remoteSnapshotPatchFileKey(file)
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
        } catch (err) {
            setError(remoteErrorMessage(err, "Unable to read snapshot patch file"))
        } finally {
            setTaskSnapshotPatchActionId(null)
        }
    }

    const handleRefreshProjectProcesses = async () => {
        if (!projectProcessCapabilities.canRead) return
        setError(null)
        try {
            await refreshProjectProcesses()
        } catch (err) {
            setError(remoteErrorMessage(err, "Unable to refresh processes"))
        }
    }

    const handleRefreshProjectFiles = async () => {
        if (!projectFileCapabilities.canList) return
        setError(null)
        try {
            await refreshProjectFiles()
        } catch (err) {
            setError(remoteErrorMessage(err, "Unable to refresh files"))
        }
    }

    const handleRefreshProjectGit = async () => {
        if (!projectGitCapabilities.canRead) return
        setError(null)
        try {
            await refreshProjectGit()
        } catch (err) {
            setError(remoteErrorMessage(err, "Unable to refresh git"))
        }
    }

    const handleRefreshProjectCronDefinitions = async () => {
        if (!projectCronCapabilities.canRead) return
        setError(null)
        try {
            await refreshProjectCronDefinitions()
        } catch (err) {
            setError(remoteErrorMessage(err, "Unable to refresh crons"))
        }
    }

    const handleReadProjectFile = async (filePath: string) => {
        if (!projectFileCapabilities.canRead) return
        if (!config || !selectedRepoId) return
        setError(null)
        setProjectFileActionPath(filePath)
        try {
            const result = await retryRemoteRead(() =>
                getRemoteProductStore(config).readProjectFile({
                    repoId: selectedRepoId,
                    path: filePath,
                    maxBytes: 64 * 1024,
                })
            )
            setProjectFileRead(result)
        } catch (err) {
            setError(remoteErrorMessage(err, "Unable to read file"))
        } finally {
            setProjectFileActionPath(null)
        }
    }

    const handleWriteProjectFile = async (filePath: string, content: string) => {
        if (!projectFileCapabilities.canWrite) return
        if (!config || !selectedRepoId) return
        setError(null)
        setProjectFileActionPath(filePath)
        try {
            const result = await getRemoteProductStore(config).writeProjectFile(
                {
                    repoId: selectedRepoId,
                    path: filePath,
                    content,
                    encoding: "utf8",
                },
                { clientRequestId: newClientRequestId("remote-project-file-write") }
            )
            setProjectFileRead({
                repoId: result.repoId,
                taskId: result.taskId,
                path: result.path,
                encoding: "utf8",
                size: result.size,
                tooLarge: false,
                content,
            })
            await refreshProjectFiles(config, selectedRepoId)
        } catch (err) {
            setError(remoteErrorMessage(err, "Unable to write file"))
        } finally {
            setProjectFileActionPath(null)
        }
    }

    const handleSearchProjectFiles = async () => {
        if (!projectFileCapabilities.canSearch) return
        if (!config || !selectedRepoId || !projectFileSearchQuery.trim()) return
        setError(null)
        setProjectFileSearchLoading(true)
        try {
            const result = await retryRemoteRead(() =>
                getRemoteProductStore(config).fuzzySearchProjectFiles({
                    repoId: selectedRepoId,
                    query: projectFileSearchQuery.trim(),
                    limit: 25,
                })
            )
            if (selectedRepoIdRef.current === selectedRepoId) setProjectFileSearchResult(result)
        } catch (err) {
            setError(remoteErrorMessage(err, "Unable to find files"))
        } finally {
            setProjectFileSearchLoading(false)
        }
    }

    const handleSearchProject = async () => {
        if (!projectSearchCapabilities.canSearch) return
        if (!config || !selectedRepoId || !projectSearchQuery.trim()) return
        setError(null)
        setProjectSearchLoading(true)
        try {
            const result = await retryRemoteRead(() =>
                getRemoteProductStore(config).searchProject({
                    repoId: selectedRepoId,
                    query: projectSearchQuery.trim(),
                    limit: 25,
                })
            )
            if (selectedRepoIdRef.current === selectedRepoId) setProjectSearchResult(result)
        } catch (err) {
            setError(remoteErrorMessage(err, "Unable to search files"))
        } finally {
            setProjectSearchLoading(false)
        }
    }

    const handleStartProjectProcess = async (definitionId: string) => {
        if (!projectProcessCapabilities.canStart) return
        if (!config || !selectedRepoId) return
        setError(null)
        setProjectProcessActionId(definitionId)
        try {
            await getRemoteProductStore(config).startProjectProcess({
                repoId: selectedRepoId,
                definitionId,
                clientRequestId: newClientRequestId("remote-process-start"),
            })
            await refreshProjectProcesses(config, selectedRepoId)
        } catch (err) {
            setError(remoteErrorMessage(err, "Unable to start process"))
        } finally {
            setProjectProcessActionId(null)
        }
    }

    const handleReconnectProjectProcess = async (processId: string) => {
        if (!projectProcessCapabilities.canReconnect) return
        if (!config || !selectedRepoId) return
        const repoId = selectedRepoId
        setError(null)
        setProjectProcessActionId(processId)
        try {
            const result = await retryRemoteRead(() =>
                getRemoteProductStore(config).reconnectProjectProcess({
                    repoId,
                    processId,
                })
            )
            if (selectedRepoIdRef.current === repoId) setProjectProcessOutput(result)
            await refreshProjectProcesses(config, repoId)
        } catch (err) {
            setError(remoteErrorMessage(err, "Unable to read process output"))
        } finally {
            setProjectProcessActionId(null)
        }
    }

    const handleStopProjectProcess = async (processId: string) => {
        if (!projectProcessCapabilities.canStop) return
        if (!config || !selectedRepoId) return
        setError(null)
        setProjectProcessActionId(processId)
        try {
            await getRemoteProductStore(config).stopProjectProcess({
                repoId: selectedRepoId,
                processId,
                clientRequestId: newClientRequestId("remote-process-stop"),
            })
            await refreshProjectProcesses(config, selectedRepoId)
        } catch (err) {
            setError(remoteErrorMessage(err, "Unable to stop process"))
        } finally {
            setProjectProcessActionId(null)
        }
    }

    const syncTaskAfterAcceptedMutation = async (repoId: string | undefined | null, taskId: string | undefined | null) => {
        if (!config || !repoId || !taskId) return
        if (syncCachedProductState(config, repoId, taskId)) return
        await Promise.all([refreshSnapshot(config, { repairNavigation: true }), refreshTask(config, repoId, taskId, { hydrateSessionEvents: false })])
    }

    const handleSaveTaskTitle = async () => {
        if (!taskProductCapabilities.canUpdateMetadata) return
        if (!config || !selectedRepoId || !selectedTaskId || !taskTitleDraft.trim()) return
        const repoId = selectedRepoId
        const taskId = selectedTaskId
        const clientRequestId = newClientRequestId("remote-task-title")
        setError(null)
        try {
            trackAcceptedMutationNotification(clientRequestId)
            await getRemoteProductStore(config).updateTaskMetadata({
                taskId,
                title: taskTitleDraft.trim(),
                clientRequestId,
            })
            await syncTaskAfterAcceptedMutation(repoId, taskId)
        } catch (err) {
            setError(remoteErrorMessage(err, "Unable to update task title"))
        }
    }

    const handleGenerateTaskTitle = async () => {
        if (!taskProductCapabilities.canGenerateTitle) return
        if (!config || !selectedRepoId || !selectedTaskId) return
        if (!beginSubmission()) return
        const repoId = selectedRepoId
        const taskId = selectedTaskId
        const clientRequestId = newClientRequestId("remote-task-title-generate")
        setError(null)
        setNotice(null)
        try {
            trackAcceptedMutationNotification(clientRequestId)
            const result = await getRemoteProductStore(config).generateTaskTitle(
                {
                    repoId,
                    taskId,
                    harnessId: agentHarnessId,
                },
                { clientRequestId }
            )
            setTaskTitleDraft(result.title)
            await syncTaskAfterAcceptedMutation(repoId, taskId)
        } catch (err) {
            setError(remoteErrorMessage(err, "Unable to generate task title"))
        } finally {
            finishSubmission()
        }
    }

    const handlePrepareTaskEnvironment = async () => {
        if (!taskProductCapabilities.canPrepareEnvironment) return
        if (!config || !selectedRepoId || !selectedTaskId) return
        if (!beginSubmission()) return
        const repoId = selectedRepoId
        const taskId = selectedTaskId
        const clientRequestId = newClientRequestId("remote-task-environment-prepare")
        setError(null)
        setNotice(null)
        try {
            trackAcceptedMutationNotification(clientRequestId)
            await getRemoteProductStore(config).prepareTaskEnvironment({ repoId, taskId }, { clientRequestId })
            await syncTaskAfterAcceptedMutation(repoId, taskId)
        } catch (err) {
            setError(remoteErrorMessage(err, "Unable to prepare task environment"))
        } finally {
            finishSubmission()
        }
    }

    const handleToggleTaskClosed = async () => {
        if (!taskProductCapabilities.canUpdateMetadata) return
        if (!config || !selectedRepoId || !selectedTaskId) return
        const repoId = selectedRepoId
        const taskId = selectedTaskId
        const clientRequestId = newClientRequestId("remote-task-closed")
        setError(null)
        try {
            trackAcceptedMutationNotification(clientRequestId)
            await getRemoteProductStore(config).updateTaskMetadata({
                taskId,
                closed: !(task?.closed ?? selectedTask?.closed ?? false),
                clientRequestId,
            })
            await syncTaskAfterAcceptedMutation(repoId, taskId)
        } catch (err) {
            setError(remoteErrorMessage(err, "Unable to update task"))
        }
    }

    const handleDeleteTask = async () => {
        if (!taskCanDelete) return
        if (!config || !selectedRepoId || !selectedTaskId) return
        if (!window.confirm("Delete this task?")) return
        setError(null)
        try {
            await getRemoteProductStore(config).deleteTask({
                repoId: selectedRepoId,
                taskId: selectedTaskId,
                options: {
                    deleteSnapshots: false,
                    deleteImages: false,
                    deleteSessions: false,
                    deleteWorktrees: false,
                },
            })
            setSelectedTaskState(null)
            setTask(null)
            setScreenState("project")
            const taskList = await refreshProjectTaskList(config, selectedRepoId, {
                repairNavigation: true,
                bypassCache: true,
            })
            if (!taskList) await refreshSnapshot(config, { repairNavigation: true })
        } catch (err) {
            setError(remoteErrorMessage(err, "Unable to delete task"))
        }
    }

    const handleCreateComment = async () => {
        if (!taskProductCapabilities.canCreateComment) return
        if (!config || !selectedRepoId || !selectedTaskId || !commentDraft.trim()) return
        const repoId = selectedRepoId
        const taskId = selectedTaskId
        const clientRequestId = newClientRequestId("remote-comment")
        setError(null)
        try {
            trackAcceptedMutationNotification(clientRequestId)
            await getRemoteProductStore(config).createComment({
                taskId,
                content: commentDraft.trim(),
                source: { type: "companion" },
                selectedText: { text: "", linesBefore: "", linesAfter: "" },
                author: { id: "companion", email: "companion@openade.local" },
                clientRequestId,
            })
            setCommentDraft("")
            await syncTaskAfterAcceptedMutation(repoId, taskId)
        } catch (err) {
            setError(remoteErrorMessage(err, "Unable to create comment"))
        }
    }

    const handleStartEditComment = (comment: OpenADETaskCommentView) => {
        if (!taskProductCapabilities.canEditComment) return
        setEditingCommentId(comment.id)
        setEditingCommentDraft(comment.content)
    }

    const handleSaveComment = async (commentId: string) => {
        if (!taskProductCapabilities.canEditComment) return
        if (!config || !selectedRepoId || !selectedTaskId || !editingCommentDraft.trim()) return
        const repoId = selectedRepoId
        const taskId = selectedTaskId
        const clientRequestId = newClientRequestId("remote-comment-edit")
        setError(null)
        try {
            trackAcceptedMutationNotification(clientRequestId)
            await getRemoteProductStore(config).editComment({
                taskId,
                commentId,
                content: editingCommentDraft.trim(),
                clientRequestId,
            })
            setEditingCommentId(null)
            setEditingCommentDraft("")
            await syncTaskAfterAcceptedMutation(repoId, taskId)
        } catch (err) {
            setError(remoteErrorMessage(err, "Unable to edit comment"))
        }
    }

    const handleDeleteComment = async (commentId: string) => {
        if (!taskProductCapabilities.canDeleteComment) return
        if (!config || !selectedRepoId || !selectedTaskId) return
        const repoId = selectedRepoId
        const taskId = selectedTaskId
        const clientRequestId = newClientRequestId("remote-comment-delete")
        setError(null)
        try {
            trackAcceptedMutationNotification(clientRequestId)
            await getRemoteProductStore(config).deleteComment({
                taskId,
                commentId,
                clientRequestId,
            })
            if (editingCommentId === commentId) {
                setEditingCommentId(null)
                setEditingCommentDraft("")
            }
            await syncTaskAfterAcceptedMutation(repoId, taskId)
        } catch (err) {
            setError(remoteErrorMessage(err, "Unable to delete comment"))
        }
    }

    const handleCancelQueuedTurn = async (queuedTurnId: string) => {
        if (!taskProductCapabilities.canCancelQueuedTurn) return
        if (!config || !selectedRepoId || !selectedTaskId) return
        const repoId = selectedRepoId
        const taskId = selectedTaskId
        const clientRequestId = newClientRequestId("remote-queued-turn-cancel")
        setError(null)
        try {
            trackAcceptedMutationNotification(clientRequestId)
            await getRemoteProductStore(config).cancelQueuedTurn({
                repoId,
                taskId,
                queuedTurnId,
                clientRequestId,
            })
            await syncTaskAfterAcceptedMutation(repoId, taskId)
        } catch (err) {
            setError(remoteErrorMessage(err, "Unable to cancel queued turn"))
        }
    }

    const handleReorderQueuedTurns = async (queuedTurnIds: string[]) => {
        if (!taskProductCapabilities.canReorderQueuedTurns) return
        if (!config || !selectedRepoId || !selectedTaskId || queuedTurnIds.length === 0) return
        const repoId = selectedRepoId
        const taskId = selectedTaskId
        const clientRequestId = newClientRequestId("remote-queued-turn-reorder")
        setError(null)
        try {
            trackAcceptedMutationNotification(clientRequestId)
            await getRemoteProductStore(config).reorderQueuedTurns({
                repoId,
                taskId,
                queuedTurnIds,
                clientRequestId,
            })
            await syncTaskAfterAcceptedMutation(repoId, taskId)
        } catch (err) {
            setError(remoteErrorMessage(err, "Unable to reorder queued turns"))
        }
    }

    const handleStartReview = async (reviewType: TaskReviewType) => {
        if (!taskProductCapabilities.canStartReview) return
        if (!config || !selectedRepoId || !selectedTaskId) return
        if (!beginSubmission()) return
        setError(null)
        setNotice(null)
        const repoId = selectedRepoId
        const taskId = selectedTaskId
        try {
            const result = await getRemoteProductStore(config).startReview({
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
            setReviewInstructions("")
            setSelectedTaskState(result.taskId)
            if (result.eventId) {
                trackAcceptedActionStartNotification(repoId, result.taskId, result.eventId)
                cancelPendingAcceptedActionStartRefresh(repoId, result.taskId, result.eventId)
            }
            setScreenState("task")
            if (!syncCachedProductState(config, repoId, result.taskId)) {
                await refreshSnapshot(config)
                await refreshTask(config, repoId, result.taskId, {
                    hydrateSessionEvents: false,
                })
            }
        } catch (err) {
            setError(remoteErrorMessage(err, "Unable to start review"))
        } finally {
            finishSubmission()
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
        setConfig(next)
        setIsAddingHost(next === null)
    }

    const handleSelfRevoke = async () => {
        if (!settingsCanSelfRevoke) return
        if (!config) return
        if (!window.confirm("Revoke this device?")) return
        setError(null)
        setIsLoading(true)
        try {
            await selfRevokeRemoteDevice(config)
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
        setConfig(next)
        setIsAddingHost(false)
    }

    const handleRemoveHost = (configId: string) => {
        const next = removeRemoteConfig(configId)
        syncConfigs()
        if (config?.id === configId) {
            resetRemoteView()
            setConfig(next)
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
            projectGitCapabilities={projectGitCapabilities}
            projectCronDefinitions={projectCronDefinitions}
            projectCronDefinitionsLoading={projectCronDefinitionsLoading}
            projectCronCapabilities={projectCronCapabilities}
            projectProcesses={projectProcesses}
            projectProcessesLoading={projectProcessesLoading}
            projectProcessActionId={projectProcessActionId}
            projectProcessOutput={projectProcessOutput}
            projectFileCapabilities={projectFileCapabilities}
            projectSearchCapabilities={projectSearchCapabilities}
            projectProcessCapabilities={projectProcessCapabilities}
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
            taskGitCapabilities={taskGitCapabilities}
            taskProductCapabilities={taskProductCapabilities}
            taskCanReadResources={taskCanReadResources}
            taskCanDelete={taskCanDelete}
            taskCanStartTurn={taskCanStartTurn}
            taskCanEnqueueQueuedTurn={taskCanEnqueueQueuedTurn}
            taskCanInterrupt={taskCanInterrupt}
            taskCanReadSnapshotPatch={taskCanReadSnapshotPatch}
            taskCanReadSnapshotPatchSlice={taskCanReadSnapshotPatchSlice}
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
            }}
            newTaskRepoId={newTaskRepoId ?? selectedRepo?.id ?? null}
            newTaskMode={newTaskMode}
            newTaskTitle={newTaskTitle}
            newTaskPrompt={newTaskPrompt}
            newTaskCanCreate={taskCanCreate}
            newTaskCanStartTurn={taskCanStartTurn}
            newTaskAgentControls={
                taskCanStartTurn
                    ? {
                          harnessId: agentHarnessId,
                          allowHarnessSwitch: true,
                          selectedModel: agentModelId,
                          thinking: agentThinking,
                          fastMode: agentFastMode,
                          onHarnessChange: handleAgentHarnessChange,
                          onModelChange: setAgentModelId,
                          onThinkingChange: setAgentThinking,
                          onFastModeChange: setAgentFastMode,
                      }
                    : undefined
            }
            configs={configs}
            activeConfigId={config.id}
            settingsConfig={config}
            snapshot={snapshot}
            themeSetting={themeSetting}
            settingsCanSelfRevoke={settingsCanSelfRevoke}
            loadTaskImage={taskCanReadImages ? loadTaskImage : undefined}
            taskSnapshotPatches={taskSnapshotPatches}
            taskSnapshotPatchActionId={taskSnapshotPatchActionId}
            onBack={handleBack}
            onRefresh={refreshAll}
            onNavigate={setScreenState}
            onToggleArchivedProjects={() => setShowArchivedProjects((value) => !value)}
            onSelectProject={handleSelectProject}
            onAddHost={handleAddHost}
            onSelectTask={handleSelectTask}
            onNewTask={() => {
                setNewTaskRepoId(selectedRepo?.id ?? visibleRepos[0]?.id ?? null)
                setScreenState("new_task")
            }}
            onRefreshProjectProcesses={handleRefreshProjectProcesses}
            onStartProjectProcess={handleStartProjectProcess}
            onReconnectProjectProcess={handleReconnectProjectProcess}
            onStopProjectProcess={handleStopProjectProcess}
            onRefreshProjectFiles={handleRefreshProjectFiles}
            onReadProjectFile={handleReadProjectFile}
            onProjectFileSearchQueryChange={setProjectFileSearchQuery}
            onSearchProjectFiles={handleSearchProjectFiles}
            onWriteProjectFile={handleWriteProjectFile}
            onProjectSearchQueryChange={setProjectSearchQuery}
            onSearchProject={handleSearchProject}
            onRefreshProjectGit={handleRefreshProjectGit}
            onRefreshProjectCronDefinitions={handleRefreshProjectCronDefinitions}
            onInputChange={setInput}
            onCommandTypeChange={setCommandType}
            onTaskTitleChange={setTaskTitleDraft}
            onSaveTaskTitle={handleSaveTaskTitle}
            onGenerateTaskTitle={handleGenerateTaskTitle}
            onPrepareTaskEnvironment={handlePrepareTaskEnvironment}
            onToggleTaskClosed={handleToggleTaskClosed}
            onDeleteTask={handleDeleteTask}
            onCommentDraftChange={setCommentDraft}
            onCreateComment={handleCreateComment}
            onStartEditComment={handleStartEditComment}
            onEditingCommentDraftChange={setEditingCommentDraft}
            onSaveComment={handleSaveComment}
            onCancelEditComment={() => {
                setEditingCommentId(null)
                setEditingCommentDraft("")
            }}
            onDeleteComment={handleDeleteComment}
            onCancelQueuedTurn={handleCancelQueuedTurn}
            onReorderQueuedTurns={handleReorderQueuedTurns}
            onReviewInstructionsChange={setReviewInstructions}
            onStartReview={handleStartReview}
            onRefreshTaskGit={handleRefreshTaskGit}
            onReadTaskDiff={handleReadTaskDiff}
            onReadTaskFilePair={handleReadTaskFilePair}
            onReadTaskCommitFiles={handleReadTaskCommitFiles}
            onReadTaskCommitFilePatch={handleReadTaskCommitFilePatch}
            onReadTaskCommitFileAtTreeish={handleReadTaskCommitFileAtTreeish}
            onCommitTaskGit={handleCommitTaskGit}
            onRefreshTaskResources={handleRefreshTaskResources}
            onLoadTaskSnapshotPatch={handleLoadTaskSnapshotPatch}
            onLoadTaskSnapshotPatchSlice={handleLoadTaskSnapshotPatchSlice}
            onSendTaskInput={handleRunInTask}
            onAbortTask={handleAbort}
            onNewTaskRepoChange={setNewTaskRepoId}
            onNewTaskModeChange={setNewTaskMode}
            onNewTaskTitleChange={setNewTaskTitle}
            onNewTaskPromptChange={setNewTaskPrompt}
            onCreateTask={handleCreateTask}
            onSelectHost={handleSelectHost}
            onRemoveHost={handleRemoveHost}
            onForget={handleForget}
            onSelfRevoke={handleSelfRevoke}
            onThemeChange={handleThemeChange}
        />
    )
}
