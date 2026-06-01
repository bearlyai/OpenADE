import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type {
    OpenADEProjectFileReadResult,
    OpenADEProjectFilesTreeResult,
    OpenADEProjectProcessListResult,
    OpenADEProjectProcessReconnectResult,
    OpenADEProjectSearchResult,
    OpenADESnapshot,
    OpenADETask,
    OpenADETaskChangesReadResult,
    OpenADETaskDiffReadResult,
    OpenADETaskGitChangedFile,
    OpenADETaskGitLogResult,
    OpenADETurnStartRequest,
} from "../../../openade-module/src"
import { DEFAULT_HARNESS_ID, getDefaultModelForHarness } from "../constants"
import { type OpenADEThemeSetting, isOpenADEThemeSetting } from "../shell/OpenADESessionScreens"
import { OpenADEShell, type OpenADEShellScreen } from "../shell/OpenADEShell"
import { RemotePairingScreen } from "../shell/RemotePairingScreen"
import type { TaskImageLoader } from "../shell/task/TaskEventThread"
import type { OpenADETaskCommentView, TaskReviewType } from "../shell/task/TaskProductPanel"
import type { TaskImageAttachment } from "../shell/task/taskEventPresentation"
import {
    type PairingTarget,
    type RemoteConfig,
    type RemoteRealtimeConnectionStatus,
    abortRemote,
    activateRemoteConfig,
    buildPairingTarget,
    cancelRemoteQueuedTurn,
    clearRemoteConfig,
    createRemoteComment,
    deleteRemoteComment,
    deleteRemoteTask,
    editRemoteComment,
    getSnapshot,
    getTask,
    listRemoteProjectFiles,
    listRemoteProjectProcesses,
    loadRemoteConfig,
    loadRemoteConfigs,
    pairRemote,
    parsePairingCode,
    readRemoteProjectFile,
    readRemoteTaskChanges,
    readRemoteTaskDiff,
    readRemoteTaskGitLog,
    readRemoteTaskImage,
    reconnectRemoteProjectProcess,
    remoteErrorMessage,
    removeRemoteConfig,
    saveRemoteConfig,
    searchRemoteProject,
    selfRevokeRemoteDevice,
    startRemoteProjectProcess,
    startRemoteReview,
    startRemoteTurn,
    stopRemoteProjectProcess,
    subscribeRemoteChanges,
    updateRemoteTaskMetadata,
} from "./client"
import { remoteRefreshPlan } from "./refreshPolicy"
import { nextRemoteRefreshDelay } from "./refreshQueue"
import { REMOTE_STATUS_GRACE_MS, isRemoteRealtimeOnline, shouldDelayRemoteStatusDisplay, statusCopy } from "./status"
import { beginRemoteSubmission, finishRemoteSubmission } from "./submission"

type CommandType = OpenADETurnStartRequest["type"]
type PendingConnection = PairingTarget & { mode: "pair" | "manual" }
type RemoteScreen = OpenADEShellScreen
type SnapshotRefreshOptions = { repairNavigation?: boolean }

export const REMOTE_THEME_STORAGE_KEY = "openade-companion-theme"

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
    const [projectSearchQuery, setProjectSearchQuery] = useState("")
    const [projectSearchResult, setProjectSearchResult] = useState<OpenADEProjectSearchResult | null>(null)
    const [projectSearchLoading, setProjectSearchLoading] = useState(false)
    const [projectProcesses, setProjectProcesses] = useState<OpenADEProjectProcessListResult | null>(null)
    const [projectProcessesLoading, setProjectProcessesLoading] = useState(false)
    const [projectProcessActionId, setProjectProcessActionId] = useState<string | null>(null)
    const [projectProcessOutput, setProjectProcessOutput] = useState<OpenADEProjectProcessReconnectResult | null>(null)
    const [taskChanges, setTaskChanges] = useState<OpenADETaskChangesReadResult | null>(null)
    const [taskGitLog, setTaskGitLog] = useState<OpenADETaskGitLogResult | null>(null)
    const [taskChangesLoading, setTaskChangesLoading] = useState(false)
    const [taskDiff, setTaskDiff] = useState<OpenADETaskDiffReadResult | null>(null)
    const [taskDiffActionPath, setTaskDiffActionPath] = useState<string | null>(null)
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
    const hydratedTaskRefreshTimerRef = useRef<number | null>(null)
    const sessionRefreshTimerRef = useRef<number | null>(null)
    const taskRefreshInFlightRef = useRef(false)
    const taskRefreshPendingRef = useRef<{ repoId: string; taskId: string } | null>(null)
    const lastTaskRefreshAtRef = useRef(0)
    const submitLockRef = useRef(false)

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

    const visibleRepos = snapshot?.repos.filter((repo) => showArchivedProjects || !repo.archived) ?? []
    const selectedRepo = selectedRepoId ? (snapshot?.repos.find((repo) => repo.id === selectedRepoId) ?? null) : null
    const selectedTask = selectedRepo?.tasks.find((item) => item.id === selectedTaskId) ?? null
    const desktopThemeClass = snapshot?.server.theme?.className ?? "code-theme-black"
    const themeClass = themeSetting === "desktop" ? desktopThemeClass : themeSetting
    const rootClass = `code-theme ${themeClass} flex bg-base-100 text-base-content flex-col overflow-hidden`
    const connectionStatus = useSmoothedRemoteStatus(rawConnectionStatus)
    const status = statusCopy(connectionStatus)
    const isOnline = isRemoteRealtimeOnline(connectionStatus)
    const loadTaskImage = useCallback<TaskImageLoader>(
        async (image) => {
            const currentConfig = configRef.current
            const currentTask = task
            if (!currentConfig || !currentTask) return null
            const result = await readRemoteTaskImage(currentConfig, { repoId: currentTask.repoId, taskId: currentTask.id, imageId: image.id, ext: image.ext })
            if (!result.data) return null
            return `data:${remoteImageMediaType(image, result.mediaType)};base64,${result.data}`
        },
        [task]
    )

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
            if (hydratedTaskRefreshTimerRef.current) window.clearTimeout(hydratedTaskRefreshTimerRef.current)
            if (sessionRefreshTimerRef.current) window.clearTimeout(sessionRefreshTimerRef.current)
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

    const refreshSnapshot = async (nextConfig = config, options: SnapshotRefreshOptions = {}): Promise<OpenADESnapshot | null> => {
        if (!nextConfig) return null
        const next = await getSnapshot(nextConfig)
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

    const refreshSessionSnapshots = async () => {
        const entries = await Promise.all(
            configs.map(async (item) => {
                try {
                    return [item.id, await getSnapshot(item)] as const
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
        options: { hydrateSessionEvents?: boolean } = { hydrateSessionEvents: false }
    ) => {
        if (!nextConfig || !repoId || !taskId) return
        const nextTask = await getTask(nextConfig, repoId, taskId, options)
        if (selectedTaskIdRef.current === taskId) setTask(nextTask)
        return nextTask
    }

    const refreshProjectProcesses = async (nextConfig = config, repoId: string | null | undefined = selectedRepoIdRef.current) => {
        if (!nextConfig || !repoId) {
            setProjectProcesses(null)
            setProjectProcessOutput(null)
            return null
        }
        setProjectProcessesLoading(true)
        try {
            const result = await listRemoteProjectProcesses(nextConfig, { repoId })
            if (selectedRepoIdRef.current === repoId) setProjectProcesses(result)
            return result
        } finally {
            setProjectProcessesLoading(false)
        }
    }

    const refreshProjectFiles = async (nextConfig = config, repoId: string | null | undefined = selectedRepoIdRef.current) => {
        if (!nextConfig || !repoId) {
            setProjectFiles(null)
            return null
        }
        setProjectFilesLoading(true)
        try {
            const result = await listRemoteProjectFiles(nextConfig, { repoId, maxDepth: 2, maxEntries: 40 })
            if (selectedRepoIdRef.current === repoId) setProjectFiles(result)
            return result
        } finally {
            setProjectFilesLoading(false)
        }
    }

    const refreshTaskGit = async (
        nextConfig = config,
        repoId: string | null | undefined = selectedRepoIdRef.current,
        taskId: string | null | undefined = selectedTaskIdRef.current
    ) => {
        if (!nextConfig || !repoId || !taskId) {
            setTaskChanges(null)
            setTaskGitLog(null)
            return null
        }
        setTaskChangesLoading(true)
        try {
            const [changes, gitLog] = await Promise.all([
                readRemoteTaskChanges(nextConfig, { repoId, taskId }),
                readRemoteTaskGitLog(nextConfig, { repoId, taskId, limit: 5 }),
            ])
            if (selectedRepoIdRef.current === repoId && selectedTaskIdRef.current === taskId) {
                setTaskChanges(changes)
                setTaskGitLog(gitLog)
            }
            return { changes, gitLog }
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
                await refreshSnapshot(configRef.current, { repairNavigation })
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
                await refreshTask(configRef.current, pending.repoId, pending.taskId, { hydrateSessionEvents: false })
            }, "Unable to refresh task")
        } finally {
            lastTaskRefreshAtRef.current = Date.now()
            taskRefreshInFlightRef.current = false
            const nextPending = taskRefreshPendingRef.current as { repoId: string; taskId: string } | null
            if (nextPending) scheduleTaskRefresh(nextPending.repoId, nextPending.taskId)
        }
    }

    const scheduleTaskRefresh = (repoId: string | undefined | null, taskId: string | undefined | null, delayMs = 150) => {
        if (!repoId || !taskId) return
        taskRefreshPendingRef.current = { repoId, taskId }
        if (taskRefreshTimerRef.current || taskRefreshInFlightRef.current) return
        taskRefreshTimerRef.current = window.setTimeout(
            () => {
                void runQueuedTaskRefresh()
            },
            nextRemoteRefreshDelay({ now: Date.now(), lastRefreshAt: lastTaskRefreshAtRef.current, requestedDelayMs: delayMs })
        )
    }

    const scheduleHydratedTaskRefresh = (repoId: string | undefined | null, taskId: string | undefined | null, delayMs = 700) => {
        if (!repoId || !taskId) return
        if (snapshotRef.current?.workingTaskIds.includes(taskId)) return
        if (hydratedTaskRefreshTimerRef.current) window.clearTimeout(hydratedTaskRefreshTimerRef.current)
        hydratedTaskRefreshTimerRef.current = window.setTimeout(() => {
            void runBackgroundRefresh(async () => {
                await refreshTask(configRef.current, repoId, taskId, { hydrateSessionEvents: true })
            }, "Unable to hydrate task history")
        }, delayMs)
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
            scheduleHydratedTaskRefresh(repoId, taskId)
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
                const plan = remoteRefreshPlan(notification, selectedTaskIdRef.current)
                const repairNavigation = notification.method === "openade/repo/deleted" || notification.method === "openade/task/deleted"
                const taskWasDeleted = notification.method === "openade/task/deleted"
                if (plan.type === "snapshot") {
                    scheduleSnapshotRefresh(300, { repairNavigation })
                } else if (plan.type === "task") {
                    scheduleTaskRefresh(plan.repoId ?? selectedRepoIdRef.current, plan.taskId)
                } else if (plan.type === "snapshot-and-task") {
                    scheduleSnapshotRefresh(300, { repairNavigation })
                    if (!taskWasDeleted) scheduleTaskRefresh(plan.repoId ?? selectedRepoIdRef.current, plan.taskId ?? selectedTaskIdRef.current)
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
        void refreshTask(config, selectedRepoId, selectedTaskId, { hydrateSessionEvents: false })
            .then(() => {
                scheduleHydratedTaskRefresh(selectedRepoId, selectedTaskId)
            })
            .catch((err) => {
                if (!isTransientRemoteRefreshError(err)) setError(remoteErrorMessage(err, "Unable to load task"))
            })
            .finally(() => setIsLoading(false))
    }, [config, screen, selectedRepoId, selectedTaskId])

    useEffect(() => {
        if (!config || screen !== "task" || !selectedRepoId || !selectedTaskId) {
            setTaskChanges(null)
            setTaskGitLog(null)
            setTaskChangesLoading(false)
            setTaskDiff(null)
            setTaskDiffActionPath(null)
            return
        }
        void runBackgroundRefresh(async () => {
            await refreshTaskGit(config, selectedRepoId, selectedTaskId)
        }, "Unable to load task changes")
    }, [config, screen, selectedRepoId, selectedTaskId])

    useEffect(() => {
        if (!config || screen !== "project" || !selectedRepoId) {
            setProjectProcesses(null)
            setProjectProcessesLoading(false)
            setProjectProcessOutput(null)
            setProjectFiles(null)
            setProjectFilesLoading(false)
            setProjectFileRead(null)
            setProjectSearchResult(null)
            setProjectSearchLoading(false)
            return
        }
        setProjectProcessOutput(null)
        void runBackgroundRefresh(async () => {
            await Promise.all([refreshProjectProcesses(config, selectedRepoId), refreshProjectFiles(config, selectedRepoId)])
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
            setPendingConnection({ ...buildPairingTarget(nextBaseUrl.replace(/\/$/, ""), nextToken, pairHostId), mode })
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
        if (!beginSubmission()) return
        setError(null)
        setNotice(null)
        const submittedInput = input
        const submittedType = commandType
        const submittedTaskId = task?.unavailableReason ? undefined : selectedTaskId
        try {
            const result = await startRemoteTurn(config, {
                repoId: selectedRepo.id,
                type: submittedType,
                input: submittedInput,
                inTaskId: submittedTaskId,
            })
            setInput("")
            setSelectedTaskState(result.taskId)
            setScreenState("task")
            await refreshSnapshot(config)
            await refreshTask(config, selectedRepo.id, result.taskId, { hydrateSessionEvents: false })
            if (result.queued) setNotice("Queued. It will run after the current turn finishes.")
        } catch (err) {
            setError(remoteErrorMessage(err, "Run failed"))
        } finally {
            finishSubmission()
        }
    }

    const handleCreateTask = async () => {
        const repoId = newTaskRepoId ?? selectedRepo?.id
        if (!config || !repoId || !newTaskPrompt.trim()) return
        if (!beginSubmission()) return
        setError(null)
        setNotice(null)
        const submittedTitle = newTaskTitle
        const submittedPrompt = newTaskPrompt
        const submittedMode = newTaskMode
        try {
            const result = await startRemoteTurn(config, {
                repoId,
                type: submittedMode,
                input: submittedPrompt,
                title: submittedTitle.trim() || undefined,
            })
            setNewTaskPrompt("")
            setNewTaskTitle("")
            setSelectedRepoState(repoId)
            setSelectedTaskState(result.taskId)
            setScreenState("task")
            await refreshSnapshot(config)
            await refreshTask(config, repoId, result.taskId, { hydrateSessionEvents: false })
        } catch (err) {
            setError(remoteErrorMessage(err, "Task creation failed"))
        } finally {
            finishSubmission()
        }
    }

    const handleAbort = async () => {
        if (!config || !selectedTaskId) return
        await abortRemote(config, selectedTaskId)
        await refreshAll()
    }

    const handleRefreshTaskGit = async () => {
        setError(null)
        try {
            await refreshTaskGit()
        } catch (err) {
            setError(remoteErrorMessage(err, "Unable to refresh task changes"))
        }
    }

    const handleReadTaskDiff = async (file: OpenADETaskGitChangedFile) => {
        if (!config || !selectedRepoId || !selectedTaskId) return
        setError(null)
        setTaskDiffActionPath(file.path)
        try {
            const result = await readRemoteTaskDiff(config, {
                repoId: selectedRepoId,
                taskId: selectedTaskId,
                filePath: file.path,
                oldPath: file.oldPath,
                contextLines: 3,
                allowTruncation: true,
            })
            setTaskDiff(result)
        } catch (err) {
            setError(remoteErrorMessage(err, "Unable to read task diff"))
        } finally {
            setTaskDiffActionPath(null)
        }
    }

    const handleRefreshProjectProcesses = async () => {
        setError(null)
        try {
            await refreshProjectProcesses()
        } catch (err) {
            setError(remoteErrorMessage(err, "Unable to refresh processes"))
        }
    }

    const handleRefreshProjectFiles = async () => {
        setError(null)
        try {
            await refreshProjectFiles()
        } catch (err) {
            setError(remoteErrorMessage(err, "Unable to refresh files"))
        }
    }

    const handleReadProjectFile = async (filePath: string) => {
        if (!config || !selectedRepoId) return
        setError(null)
        setProjectFileActionPath(filePath)
        try {
            const result = await readRemoteProjectFile(config, { repoId: selectedRepoId, path: filePath, maxBytes: 64 * 1024 })
            setProjectFileRead(result)
        } catch (err) {
            setError(remoteErrorMessage(err, "Unable to read file"))
        } finally {
            setProjectFileActionPath(null)
        }
    }

    const handleSearchProject = async () => {
        if (!config || !selectedRepoId || !projectSearchQuery.trim()) return
        setError(null)
        setProjectSearchLoading(true)
        try {
            const result = await searchRemoteProject(config, { repoId: selectedRepoId, query: projectSearchQuery.trim(), limit: 25 })
            if (selectedRepoIdRef.current === selectedRepoId) setProjectSearchResult(result)
        } catch (err) {
            setError(remoteErrorMessage(err, "Unable to search files"))
        } finally {
            setProjectSearchLoading(false)
        }
    }

    const handleStartProjectProcess = async (definitionId: string) => {
        if (!config || !selectedRepoId) return
        setError(null)
        setProjectProcessActionId(definitionId)
        try {
            await startRemoteProjectProcess(config, {
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
        if (!config || !selectedRepoId) return
        const repoId = selectedRepoId
        setError(null)
        setProjectProcessActionId(processId)
        try {
            const result = await reconnectRemoteProjectProcess(config, { repoId, processId })
            if (selectedRepoIdRef.current === repoId) setProjectProcessOutput(result)
            await refreshProjectProcesses(config, repoId)
        } catch (err) {
            setError(remoteErrorMessage(err, "Unable to read process output"))
        } finally {
            setProjectProcessActionId(null)
        }
    }

    const handleStopProjectProcess = async (processId: string) => {
        if (!config || !selectedRepoId) return
        setError(null)
        setProjectProcessActionId(processId)
        try {
            await stopRemoteProjectProcess(config, {
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

    const refreshSelectedTaskAfterMutation = async () => {
        if (!config || !selectedRepoIdRef.current || !selectedTaskIdRef.current) return
        await Promise.all([
            refreshSnapshot(config, { repairNavigation: true }),
            refreshTask(config, selectedRepoIdRef.current, selectedTaskIdRef.current, { hydrateSessionEvents: false }),
        ])
    }

    const handleSaveTaskTitle = async () => {
        if (!config || !selectedTaskId || !taskTitleDraft.trim()) return
        setError(null)
        try {
            await updateRemoteTaskMetadata(config, { taskId: selectedTaskId, title: taskTitleDraft.trim() })
            await refreshSelectedTaskAfterMutation()
        } catch (err) {
            setError(remoteErrorMessage(err, "Unable to update task title"))
        }
    }

    const handleToggleTaskClosed = async () => {
        if (!config || !selectedTaskId) return
        setError(null)
        try {
            await updateRemoteTaskMetadata(config, { taskId: selectedTaskId, closed: !(task?.closed ?? selectedTask?.closed ?? false) })
            await refreshSelectedTaskAfterMutation()
        } catch (err) {
            setError(remoteErrorMessage(err, "Unable to update task"))
        }
    }

    const handleDeleteTask = async () => {
        if (!config || !selectedRepoId || !selectedTaskId) return
        if (!window.confirm("Delete this task?")) return
        setError(null)
        try {
            await deleteRemoteTask(config, {
                repoId: selectedRepoId,
                taskId: selectedTaskId,
                options: { deleteSnapshots: false, deleteImages: false, deleteSessions: false, deleteWorktrees: false },
            })
            setSelectedTaskState(null)
            setTask(null)
            setScreenState("project")
            await refreshSnapshot(config, { repairNavigation: true })
        } catch (err) {
            setError(remoteErrorMessage(err, "Unable to delete task"))
        }
    }

    const handleCreateComment = async () => {
        if (!config || !selectedTaskId || !commentDraft.trim()) return
        setError(null)
        try {
            await createRemoteComment(config, {
                taskId: selectedTaskId,
                content: commentDraft.trim(),
                source: { type: "companion" },
                selectedText: { text: "", linesBefore: "", linesAfter: "" },
                author: { id: "companion", email: "companion@openade.local" },
                clientRequestId: newClientRequestId("remote-comment"),
            })
            setCommentDraft("")
            await refreshSelectedTaskAfterMutation()
        } catch (err) {
            setError(remoteErrorMessage(err, "Unable to create comment"))
        }
    }

    const handleStartEditComment = (comment: OpenADETaskCommentView) => {
        setEditingCommentId(comment.id)
        setEditingCommentDraft(comment.content)
    }

    const handleSaveComment = async (commentId: string) => {
        if (!config || !selectedTaskId || !editingCommentDraft.trim()) return
        setError(null)
        try {
            await editRemoteComment(config, { taskId: selectedTaskId, commentId, content: editingCommentDraft.trim() })
            setEditingCommentId(null)
            setEditingCommentDraft("")
            await refreshSelectedTaskAfterMutation()
        } catch (err) {
            setError(remoteErrorMessage(err, "Unable to edit comment"))
        }
    }

    const handleDeleteComment = async (commentId: string) => {
        if (!config || !selectedTaskId) return
        setError(null)
        try {
            await deleteRemoteComment(config, { taskId: selectedTaskId, commentId })
            if (editingCommentId === commentId) {
                setEditingCommentId(null)
                setEditingCommentDraft("")
            }
            await refreshSelectedTaskAfterMutation()
        } catch (err) {
            setError(remoteErrorMessage(err, "Unable to delete comment"))
        }
    }

    const handleCancelQueuedTurn = async (queuedTurnId: string) => {
        if (!config || !selectedRepoId || !selectedTaskId) return
        setError(null)
        try {
            await cancelRemoteQueuedTurn(config, { repoId: selectedRepoId, taskId: selectedTaskId, queuedTurnId })
            await refreshSelectedTaskAfterMutation()
        } catch (err) {
            setError(remoteErrorMessage(err, "Unable to cancel queued turn"))
        }
    }

    const handleStartReview = async (reviewType: TaskReviewType) => {
        if (!config || !selectedRepoId || !selectedTaskId) return
        if (!beginSubmission()) return
        setError(null)
        setNotice(null)
        try {
            const harnessId = DEFAULT_HARNESS_ID
            const modelId = getDefaultModelForHarness(harnessId)
            const result = await startRemoteReview(config, {
                repoId: selectedRepoId,
                taskId: selectedTaskId,
                reviewType,
                harnessId,
                modelId,
                customInstructions: reviewInstructions.trim() || undefined,
                clientRequestId: newClientRequestId(`remote-review-${reviewType}`),
            })
            setReviewInstructions("")
            setSelectedTaskState(result.taskId)
            setScreenState("task")
            await refreshSelectedTaskAfterMutation()
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
            projectSearchQuery={projectSearchQuery}
            projectSearchResult={projectSearchResult}
            projectSearchLoading={projectSearchLoading}
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
            taskChangesLoading={taskChangesLoading}
            taskDiff={taskDiff}
            taskDiffActionPath={taskDiffActionPath}
            newTaskRepoId={newTaskRepoId ?? selectedRepo?.id ?? null}
            newTaskMode={newTaskMode}
            newTaskTitle={newTaskTitle}
            newTaskPrompt={newTaskPrompt}
            configs={configs}
            activeConfigId={config.id}
            settingsConfig={config}
            snapshot={snapshot}
            themeSetting={themeSetting}
            loadTaskImage={loadTaskImage}
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
            onProjectSearchQueryChange={setProjectSearchQuery}
            onSearchProject={handleSearchProject}
            onInputChange={setInput}
            onCommandTypeChange={setCommandType}
            onTaskTitleChange={setTaskTitleDraft}
            onSaveTaskTitle={handleSaveTaskTitle}
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
            onReviewInstructionsChange={setReviewInstructions}
            onStartReview={handleStartReview}
            onRefreshTaskGit={handleRefreshTaskGit}
            onReadTaskDiff={handleReadTaskDiff}
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
