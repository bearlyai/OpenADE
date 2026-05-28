import {
    Archive,
    ArrowDown,
    ArrowLeft,
    CheckCircle2,
    ChevronRight,
    CircleAlert,
    CircleDot,
    FolderOpen,
    Loader2,
    MessageSquarePlus,
    Plus,
    RefreshCw,
    ScanLine,
    Send,
    Server,
    Settings,
    Square,
    Trash2,
    Wifi,
    WifiOff,
} from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import type { RemoteRepo, RemoteSnapshot, RemoteTask, RemoteTaskPreview, RemoteTurnStartRequest } from "../../../shared/companion/src"
import {
    abortRemote,
    activateRemoteConfig,
    buildPairingTarget,
    clearRemoteConfig,
    getSnapshot,
    getTask,
    loadRemoteConfig,
    loadRemoteConfigs,
    parsePairingCode,
    pairRemote,
    removeRemoteConfig,
    remoteErrorMessage,
    startRemoteTurn,
    saveRemoteConfig,
    subscribeRemoteChanges,
    type PairingTarget,
    type RemoteConfig,
    type RemoteRealtimeConnectionStatus,
} from "./client"
import { taskMessages, type RemoteActivity, type RemoteMessage } from "./messagePresentation"
import { remoteRefreshPlan } from "./refreshPolicy"
import { nextRemoteRefreshDelay } from "./refreshQueue"
import { REMOTE_STATUS_GRACE_MS, isRemoteRealtimeOnline, shouldDelayRemoteStatusDisplay, statusCopy, type RemoteStatusTone } from "./status"
import { beginRemoteSubmission, finishRemoteSubmission } from "./submission"
import { shouldFollowRemoteThread } from "./threadScroll"

type CommandType = RemoteTurnStartRequest["type"]
type PendingConnection = PairingTarget & { mode: "pair" | "manual" }
type RemoteScreen = "projects" | "project" | "task" | "new_task" | "sessions" | "settings"
const themeClasses = {
    "code-theme-light": { label: "Light" },
    "code-theme-bright": { label: "Bright" },
    "code-theme-clean": { label: "Clean" },
    "code-theme-black": { label: "Black" },
    "code-theme-synthwave": { label: "Synthwave" },
    "code-theme-dracula": { label: "Dracula" },
} as const
type ThemeClass = keyof typeof themeClasses
type MobileThemeSetting = "desktop" | ThemeClass

const mobileThemeStorageKey = "openade-companion-theme"

function loadMobileThemeSetting(): MobileThemeSetting {
    const value = window.localStorage.getItem(mobileThemeStorageKey)
    if (value === "desktop") return value
    if (value && value in themeClasses) return value as ThemeClass
    return "desktop"
}

function saveMobileThemeSetting(value: MobileThemeSetting): void {
    window.localStorage.setItem(mobileThemeStorageKey, value)
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

function toneClass(tone: RemoteStatusTone): string {
    if (tone === "ok") return "text-success"
    if (tone === "warn") return "text-warning"
    if (tone === "bad") return "text-error"
    return "text-muted"
}

function formatHost(config: RemoteConfig | null): string {
    return config?.host ?? "OpenADE"
}

function isTransientRemoteRefreshError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error)
    return /Runtime socket (closed|disconnected|failed|is not connected)|WebSocket/i.test(message)
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
    const [snapshot, setSnapshot] = useState<RemoteSnapshot | null>(null)
    const [sessionSnapshots, setSessionSnapshots] = useState<Record<string, RemoteSnapshot>>({})
    const [showArchivedProjects, setShowArchivedProjects] = useState(false)
    const [mobileTheme, setMobileTheme] = useState<MobileThemeSetting>(() => loadMobileThemeSetting())
    const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null)
    const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
    const [task, setTask] = useState<RemoteTask | null>(null)
    const [input, setInput] = useState("")
    const [commandType, setCommandType] = useState<CommandType>("do")
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
    const snapshotRef = useRef<RemoteSnapshot | null>(snapshot)
    const snapshotRefreshTimerRef = useRef<number | null>(null)
    const taskRefreshTimerRef = useRef<number | null>(null)
    const hydratedTaskRefreshTimerRef = useRef<number | null>(null)
    const sessionRefreshTimerRef = useRef<number | null>(null)
    const taskRefreshInFlightRef = useRef(false)
    const taskRefreshPendingRef = useRef<{ repoId: string; taskId: string } | null>(null)
    const lastTaskRefreshAtRef = useRef(0)
    const submitLockRef = useRef(false)

    const visibleRepos = snapshot?.repos.filter((repo) => showArchivedProjects || !repo.archived) ?? []
    const selectedRepo = selectedRepoId ? (snapshot?.repos.find((repo) => repo.id === selectedRepoId) ?? null) : null
    const selectedTask = selectedRepo?.tasks.find((item) => item.id === selectedTaskId) ?? null
    const desktopThemeClass = snapshot?.server.theme?.className ?? "code-theme-black"
    const themeClass = mobileTheme === "desktop" ? desktopThemeClass : mobileTheme
    const rootClass = `code-theme ${themeClass} flex bg-base-100 text-base-content flex-col overflow-hidden`
    const connectionStatus = useSmoothedRemoteStatus(rawConnectionStatus)
    const status = statusCopy(connectionStatus)
    const isOnline = isRemoteRealtimeOnline(connectionStatus)

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
        setSnapshot(null)
        setSelectedRepoId(null)
        setSelectedTaskId(null)
        setTask(null)
        setRawConnectionStatus("disconnected")
        setScreen("projects")
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

    const refreshSnapshot = async (nextConfig = config): Promise<RemoteSnapshot | null> => {
        if (!nextConfig) return null
        const next = await getSnapshot(nextConfig)
        const currentRepoId = selectedRepoIdRef.current
        const currentTaskId = selectedTaskIdRef.current
        const nextRepoId = currentRepoId && next.repos.some((repo) => repo.id === currentRepoId) ? currentRepoId : null
        const nextRepo = next.repos.find((repo) => repo.id === nextRepoId) ?? null

        setSessionSnapshots((current) => ({ ...current, [nextConfig.id]: next }))
        snapshotRef.current = next
        setSnapshot(next)
        setSelectedRepoId(nextRepoId)
        setNewTaskRepoId((current) => current ?? nextRepoId ?? next.repos.find((repo) => !repo.archived)?.id ?? next.repos[0]?.id ?? null)

        if (currentTaskId && !nextRepo?.tasks.some((item) => item.id === currentTaskId)) {
            selectedTaskIdRef.current = null
            setSelectedTaskId(null)
            setTask(null)
            if (screenRef.current === "task") setScreen(nextRepoId ? "project" : "projects")
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

    const runBackgroundRefresh = async (work: () => Promise<void>, fallback: string) => {
        try {
            await work()
        } catch (err) {
            if (!isTransientRemoteRefreshError(err)) setError(remoteErrorMessage(err, fallback))
        }
    }

    const scheduleSnapshotRefresh = (delayMs = 300) => {
        if (snapshotRefreshTimerRef.current) window.clearTimeout(snapshotRefreshTimerRef.current)
        snapshotRefreshTimerRef.current = window.setTimeout(() => {
            void runBackgroundRefresh(async () => {
                await refreshSnapshot(configRef.current)
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
        taskRefreshTimerRef.current = window.setTimeout(() => {
            void runQueuedTaskRefresh()
        }, nextRemoteRefreshDelay({ now: Date.now(), lastRefreshAt: lastTaskRefreshAtRef.current, requestedDelayMs: delayMs }))
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
                if (plan.type === "snapshot") {
                    scheduleSnapshotRefresh()
                } else if (plan.type === "task") {
                    scheduleTaskRefresh(plan.repoId ?? selectedRepoIdRef.current, plan.taskId)
                } else if (plan.type === "snapshot-and-task") {
                    scheduleSnapshotRefresh()
                    scheduleTaskRefresh(plan.repoId ?? selectedRepoIdRef.current, plan.taskId ?? selectedTaskIdRef.current)
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
        if (configs.length === 0) return
        void refreshSessionSnapshots()
    }, [configsKey])

    const handleSelectProject = async (configId: string, repoId: string) => {
        const nextConfig = config?.id === configId ? config : activateRemoteConfig(configId)
        if (!nextConfig) return
        syncConfigs()
        setConfig(nextConfig)
        setIsAddingHost(false)
        selectedRepoIdRef.current = repoId
        selectedTaskIdRef.current = null
        setSelectedRepoId(repoId)
        setSelectedTaskId(null)
        setTask(null)
        setNewTaskRepoId(repoId)
        setScreen("project")
        const nextSnapshot = sessionSnapshots[configId] ?? (await refreshSnapshot(nextConfig))
        if (nextSnapshot) setSnapshot(nextSnapshot)
    }

    const handleSelectTask = (taskId: string) => {
        selectedTaskIdRef.current = taskId
        setTask(null)
        setSelectedTaskId(taskId)
        setScreen("task")
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
            selectedTaskIdRef.current = result.taskId
            setSelectedTaskId(result.taskId)
            setScreen("task")
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
            selectedRepoIdRef.current = repoId
            selectedTaskIdRef.current = result.taskId
            setSelectedRepoId(repoId)
            setSelectedTaskId(result.taskId)
            setScreen("task")
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

    const handleMobileThemeChange = (value: MobileThemeSetting) => {
        setMobileTheme(value)
        saveMobileThemeSetting(value)
    }

    if (!config || isAddingHost) {
        return (
            <ConnectScreen
                scanPairingCode={scanPairingCode}
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

    return (
        <main
            className={rootClass}
            style={{
                width: "100vw",
                maxWidth: "100vw",
                height: "100dvh",
                minHeight: 0,
                paddingTop: "env(safe-area-inset-top)",
                paddingBottom: "env(safe-area-inset-bottom)",
            }}
        >
            <AppHeader
                title={
                    screen === "task"
                        ? (selectedTask?.title ?? "Task")
                        : screen === "project"
                          ? (selectedRepo?.name ?? "Tasks")
                          : screen === "new_task"
                            ? "New Task"
                            : screen === "sessions"
                              ? "Sessions"
                              : screen === "settings"
                                ? "Settings"
                                : "Projects"
                }
                host={formatHost(config)}
                status={status}
                showBack={screen === "project" || screen === "task" || screen === "new_task" || screen === "sessions" || screen === "settings"}
                isLoading={isLoading}
                onBack={() => {
                    if (screen === "task") {
                        selectedTaskIdRef.current = null
                        setSelectedTaskId(null)
                        setTask(null)
                        setScreen("project")
                        return
                    }
                    if (screen === "project") {
                        selectedRepoIdRef.current = null
                        setSelectedRepoId(null)
                    }
                    setScreen("projects")
                }}
                onRefresh={refreshAll}
            />

            {error && <div className="mx-3 mt-3 max-w-full shrink-0 break-words border border-error/30 bg-error/10 p-2 text-xs text-error">{error}</div>}
            {notice && <div className="mx-3 mt-3 max-w-full shrink-0 break-words border border-info/30 bg-info/10 p-2 text-xs text-info">{notice}</div>}
            {connectionStatus !== "connected" && (
                <div className="mx-3 mt-3 flex max-w-full shrink-0 items-center gap-2 overflow-hidden border border-warning/30 bg-warning/10 p-2 text-xs text-warning">
                    <WifiOff size={13} />
                    <span className="truncate">{status.label}</span>
                </div>
            )}

            <section className="min-h-0 w-full max-w-full flex-1 overflow-hidden">
                {screen === "projects" && (
                    <ProjectsScreen
                        configs={configs}
                        snapshots={snapshotsBySession}
                        activeConfigId={config.id}
                        showArchived={showArchivedProjects}
                        onToggleArchived={() => setShowArchivedProjects((value) => !value)}
                        onSelectProject={handleSelectProject}
                        onAdd={handleAddHost}
                    />
                )}
                {screen === "project" && (
                    <ProjectTasksScreen
                        repo={selectedRepo}
                        workingTaskIds={snapshot?.workingTaskIds ?? []}
                        onSelectTask={handleSelectTask}
                        onNewTask={() => {
                            setNewTaskRepoId(selectedRepo?.id ?? visibleRepos[0]?.id ?? null)
                            setScreen("new_task")
                        }}
                    />
                )}
                {screen === "task" && (
                    <TaskScreen
                        task={task}
                        preview={selectedTask}
                        isRunning={Boolean(selectedTaskId && snapshot?.workingTaskIds.includes(selectedTaskId))}
                        input={input}
                        commandType={commandType}
                        isLoading={isLoading}
                        isSubmitting={isSubmitting}
                        isOnline={isOnline}
                        onInputChange={setInput}
                        onCommandTypeChange={setCommandType}
                        onSend={handleRunInTask}
                        onAbort={handleAbort}
                    />
                )}
                {screen === "new_task" && (
                    <NewTaskScreen
                        repos={visibleRepos}
                        repoId={newTaskRepoId ?? selectedRepo?.id ?? null}
                        mode={newTaskMode}
                        title={newTaskTitle}
                        prompt={newTaskPrompt}
                        isLoading={isLoading}
                        isSubmitting={isSubmitting}
                        isOnline={isOnline}
                        onRepoChange={setNewTaskRepoId}
                        onModeChange={setNewTaskMode}
                        onTitleChange={setNewTaskTitle}
                        onPromptChange={setNewTaskPrompt}
                        onCreate={handleCreateTask}
                    />
                )}
                {screen === "sessions" && (
                    <SessionsScreen
                        configs={configs}
                        activeConfigId={config.id}
                        onSelect={handleSelectHost}
                        onRemove={handleRemoveHost}
                        onAdd={handleAddHost}
                    />
                )}
                {screen === "settings" && (
                    <SettingsScreen
                        config={config}
                        snapshot={snapshot}
                        status={status}
                        mobileTheme={mobileTheme}
                        onRefresh={refreshAll}
                        onForget={handleForget}
                        onSessions={() => setScreen("sessions")}
                        onAdd={handleAddHost}
                        onThemeChange={handleMobileThemeChange}
                    />
                )}
            </section>

            <BottomNav active={screen} onNavigate={setScreen} />
        </main>
    )
}

function ConnectScreen({
    scanPairingCode,
    baseUrl,
    pendingConnection,
    isLoading,
    error,
    canCancel,
    onBaseUrlChange,
    onScan,
    onSubmitPairingLink,
    onConfirm,
    onCancelPending,
    onCancelAdd,
}: {
    scanPairingCode?: () => Promise<string | null>
    baseUrl: string
    pendingConnection: PendingConnection | null
    isLoading: boolean
    error: string | null
    canCancel: boolean
    onBaseUrlChange: (value: string) => void
    onScan: () => void
    onSubmitPairingLink: () => void
    onConfirm: () => void
    onCancelPending: () => void
    onCancelAdd: () => void
}) {
    return (
        <main
            className="code-theme code-theme-black flex min-h-[100dvh] w-screen max-w-full items-center justify-center overflow-x-hidden bg-base-100 px-5 py-8 text-base-content"
            style={{ paddingTop: "max(2rem, env(safe-area-inset-top))", paddingBottom: "max(2rem, env(safe-area-inset-bottom))" }}
        >
            <div className="relative mx-auto flex min-h-[min(680px,calc(100dvh-4rem))] w-full max-w-sm flex-col justify-center">
                {canCancel && (
                    <button type="button" onClick={onCancelAdd} className="btn absolute right-0 top-0 h-9 px-2 text-sm text-muted">
                        Cancel
                    </button>
                )}

                <div className="mb-10 flex flex-col items-center text-center">
                    <div className="flex min-w-0 flex-col items-center">
                        <div className="mb-4 flex h-12 w-12 items-center justify-center border border-primary/30 bg-primary text-primary-content">
                            <Wifi size={22} />
                        </div>
                        <div className="text-[2.5rem] font-semibold leading-none tracking-normal text-base-content">OpenADE</div>
                        <div className="mt-2 text-sm font-medium uppercase text-muted">Companion</div>
                    </div>
                </div>

                {error && (
                    <div className="mb-4 flex items-start gap-2 border border-error/30 bg-error/10 p-3 text-sm text-error">
                        <CircleAlert size={16} className="mt-0.5 shrink-0" />
                        <span className="min-w-0 break-words">{error}</span>
                    </div>
                )}

                {pendingConnection ? (
                    <div className="flex flex-col gap-4 border border-border bg-base-200/60 p-4">
                        <div className="flex min-w-0 gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center border border-success/25 bg-success/10 text-success">
                                <CheckCircle2 size={18} />
                            </div>
                            <div className="min-w-0">
                                <div className="truncate text-sm font-semibold text-base-content">Connect to {pendingConnection.host}</div>
                                <div className="mt-1 break-all text-xs text-muted">{pendingConnection.baseUrl}</div>
                            </div>
                        </div>
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={onConfirm}
                                disabled={isLoading}
                                className="btn h-10 flex-1 bg-primary px-3 text-primary-content disabled:opacity-50"
                            >
                                {isLoading ? "Connecting..." : "Connect"}
                            </button>
                            <button
                                type="button"
                                onClick={onCancelPending}
                                disabled={isLoading}
                                className="btn h-10 flex-1 bg-base-300 px-3 text-base-content disabled:opacity-50"
                            >
                                Change
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-col gap-3">
                        {scanPairingCode && (
                            <button
                                type="button"
                                onClick={onScan}
                                disabled={isLoading}
                                className="btn flex h-14 items-center justify-center gap-2 bg-primary px-4 text-base font-semibold text-primary-content disabled:opacity-50"
                            >
                                <ScanLine size={19} />
                                Scan QR
                            </button>
                        )}

                        <div className="flex flex-col gap-2">
                            <input
                                className="input h-[52px] w-full max-w-full border border-border bg-base-200 px-3 text-base"
                                placeholder="Paste pairing link"
                                value={baseUrl}
                                onChange={(event) => onBaseUrlChange(event.target.value)}
                                autoCapitalize="none"
                                autoCorrect="off"
                                inputMode="url"
                            />
                            <button
                                type="button"
                                onClick={onSubmitPairingLink}
                                disabled={isLoading || !baseUrl.trim()}
                                className="btn h-12 bg-base-200 px-4 font-medium text-base-content disabled:opacity-50"
                            >
                                Connect
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </main>
    )
}

function AppHeader({
    title,
    host,
    status,
    showBack,
    isLoading,
    onBack,
    onRefresh,
}: {
    title: string
    host: string
    status: { label: string; tone: "ok" | "warn" | "bad" | "muted" }
    showBack: boolean
    isLoading: boolean
    onBack: () => void
    onRefresh: () => void
}) {
    return (
        <header className="h-14 w-full max-w-full shrink-0 overflow-hidden border-b border-border px-3">
            <div className="flex h-full min-w-0 items-center justify-between gap-2">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                    {showBack && (
                        <button type="button" onClick={onBack} className="btn flex h-9 w-9 shrink-0 items-center justify-center bg-transparent">
                            <ArrowLeft size={17} />
                        </button>
                    )}
                    <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold">{title}</div>
                        <div className="flex min-w-0 items-center gap-1 text-[11px] text-muted">
                            <span className="min-w-0 truncate">{host}</span>
                            <CircleDot size={9} className={toneClass(status.tone)} />
                            <span className={`shrink-0 ${toneClass(status.tone)}`}>{status.label}</span>
                        </div>
                    </div>
                </div>
                <button type="button" onClick={onRefresh} className="btn flex h-9 w-9 shrink-0 items-center justify-center bg-transparent">
                    {isLoading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                </button>
            </div>
        </header>
    )
}

function ProjectsScreen({
    configs,
    snapshots,
    activeConfigId,
    showArchived,
    onToggleArchived,
    onSelectProject,
    onAdd,
}: {
    configs: RemoteConfig[]
    snapshots: Record<string, RemoteSnapshot>
    activeConfigId: string
    showArchived: boolean
    onToggleArchived: () => void
    onSelectProject: (configId: string, repoId: string) => void
    onAdd: () => void
}) {
    if (configs.length === 0) {
        return (
            <div className="w-full max-w-full p-3">
                <div className="border border-border bg-base-200/40 p-3 text-sm text-muted">No sessions.</div>
            </div>
        )
    }

    return (
        <div className="h-full w-full max-w-full overflow-y-auto overflow-x-hidden bg-base-100 p-3">
            <div className="flex w-full max-w-full flex-col gap-3 overflow-hidden">
                <div className="flex gap-2">
                    <button
                        type="button"
                        onClick={onToggleArchived}
                        className={`btn flex h-11 flex-1 items-center justify-center gap-2 border px-3 text-sm ${
                            showArchived ? "border-primary/40 bg-primary/10 text-primary" : "border-border bg-base-200/70 text-base-content"
                        }`}
                    >
                        <Archive size={15} />
                        {showArchived ? "Hide archived" : "Show archived"}
                    </button>
                    <button
                        type="button"
                        onClick={onAdd}
                        className="btn flex h-11 shrink-0 items-center gap-2 border border-border bg-base-200/70 px-3 text-sm text-base-content"
                    >
                        <Plus size={15} />
                        Session
                    </button>
                </div>
                {configs.map((item) => {
                    const sessionSnapshot = snapshots[item.id]
                    const repos = sessionSnapshot?.repos.filter((repo) => showArchived || !repo.archived) ?? []
                    const totalProjects = sessionSnapshot?.repos.length ?? 0
                    const hiddenProjects = Math.max(totalProjects - repos.length, 0)
                    const workingTaskIds = new Set(sessionSnapshot?.workingTaskIds ?? [])
                    const runningProjectCount = repos.filter((repo) => repo.tasks.some((task) => workingTaskIds.has(task.id))).length
                    return (
                        <section key={item.id} className="w-full max-w-full overflow-hidden border border-border bg-base-200/25">
                            <div className="border-b border-border bg-base-200/60 px-3 py-3">
                                <div className="flex min-w-0 items-center justify-between gap-2">
                                    <div className="flex min-w-0 items-center gap-3">
                                        <span className="flex h-9 w-9 shrink-0 items-center justify-center border border-primary/20 bg-primary/10 text-primary">
                                            <Server size={17} />
                                        </span>
                                        <div className="min-w-0">
                                            <div className="text-[10px] font-medium uppercase tracking-wide text-muted">Session</div>
                                            <div className="truncate text-sm font-semibold">{item.host}</div>
                                            <div className="truncate text-xs text-muted">
                                                {repos.length} project{repos.length === 1 ? "" : "s"}
                                                {hiddenProjects > 0 ? `, ${hiddenProjects} hidden` : ""}
                                                {runningProjectCount > 0 ? `, ${runningProjectCount} running` : ""}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-1.5">
                                        {runningProjectCount > 0 && <Loader2 size={13} className="animate-spin text-primary" />}
                                        {item.id === activeConfigId && (
                                            <span className="border border-primary/25 bg-primary/10 px-2 py-1 text-[11px] text-primary">Active</span>
                                        )}
                                    </div>
                                </div>
                            </div>
                            <div className="flex flex-col">
                                {!sessionSnapshot && <div className="px-3 py-3 text-sm text-muted">Loading projects...</div>}
                                {sessionSnapshot && repos.length === 0 && (
                                    <div className="px-3 py-3 text-sm text-muted">{showArchived ? "No projects." : "No active projects."}</div>
                                )}
                                {repos.map((repo) => (
                                    <ProjectRow
                                        key={repo.id}
                                        repo={repo}
                                        runningCount={repo.tasks.filter((task) => workingTaskIds.has(task.id)).length}
                                        onSelect={() => void onSelectProject(item.id, repo.id)}
                                    />
                                ))}
                            </div>
                        </section>
                    )
                })}
            </div>
        </div>
    )
}

function ProjectRow({ repo, runningCount, onSelect }: { repo: RemoteRepo; runningCount: number; onSelect: () => void }) {
    return (
        <button
            type="button"
            onClick={onSelect}
            className="btn group flex w-full min-w-0 items-center gap-3 border-b border-border bg-transparent px-3 py-3 text-left transition-colors last:border-b-0 hover:bg-base-200/70"
        >
            <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center border ${
                    repo.archived ? "border-warning/20 bg-warning/10 text-warning" : "border-info/20 bg-info/10 text-info"
                }`}
            >
                {repo.archived ? <Archive size={16} /> : <FolderOpen size={16} />}
            </span>
            <span className="min-w-0 flex-1">
                <span className="flex w-full min-w-0 items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-base-content">{repo.name}</span>
                    {runningCount > 0 && (
                        <span className="flex shrink-0 items-center gap-1 border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] uppercase text-primary">
                            <Loader2 size={10} className="animate-spin" />
                            {runningCount}
                        </span>
                    )}
                    <span className="shrink-0 text-[11px] text-muted">
                        {repo.tasks.length} task{repo.tasks.length === 1 ? "" : "s"}
                    </span>
                </span>
                <span className="mt-0.5 block max-w-full truncate text-xs text-muted">{repo.path}</span>
            </span>
            {repo.archived && <span className="shrink-0 border border-warning/20 bg-warning/10 px-2 py-1 text-[10px] uppercase text-warning">Archived</span>}
            <ChevronRight size={15} className="shrink-0 text-muted opacity-60 group-hover:text-base-content" />
        </button>
    )
}

function ProjectTasksScreen({
    repo,
    workingTaskIds,
    onSelectTask,
    onNewTask,
}: {
    repo: RemoteRepo | null
    workingTaskIds: string[]
    onSelectTask: (taskId: string) => void
    onNewTask: () => void
}) {
    if (!repo) {
        return (
            <div className="w-full max-w-full p-3">
                <div className="border border-border bg-base-200/40 p-3 text-sm text-muted">Choose a project.</div>
            </div>
        )
    }

    const runningCount = repo.tasks.filter((task) => workingTaskIds.includes(task.id)).length

    return (
        <div className="flex h-full w-full max-w-full flex-col overflow-hidden">
            <div className="min-h-0 w-full max-w-full flex-1 overflow-y-auto overflow-x-hidden p-3">
                <div className="mb-3 overflow-hidden border border-border bg-base-200/25">
                    <div className="flex min-w-0 items-center gap-3 border-b border-border bg-base-200/60 p-3">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center border border-info/20 bg-info/10 text-info">
                            <FolderOpen size={18} />
                        </span>
                        <div className="min-w-0 flex-1">
                            <div className="text-[10px] font-medium uppercase tracking-wide text-muted">Project</div>
                            <div className="truncate text-base font-semibold">{repo.name}</div>
                            <div className="truncate text-xs text-muted">{repo.path}</div>
                        </div>
                        <button
                            type="button"
                            onClick={onNewTask}
                            className="btn flex h-10 shrink-0 items-center gap-1.5 bg-primary px-3 text-sm text-primary-content"
                        >
                            <Plus size={15} />
                            New
                        </button>
                    </div>
                    <div className="flex flex-wrap gap-1.5 px-3 py-2">
                        <span className="border border-border bg-base-100/60 px-2 py-1 text-[11px] text-muted">
                            {repo.tasks.length} task{repo.tasks.length === 1 ? "" : "s"}
                        </span>
                        {runningCount > 0 && (
                            <span className="flex items-center gap-1 border border-primary/20 bg-primary/10 px-2 py-1 text-[11px] text-primary">
                                <Loader2 size={11} className="animate-spin" />
                                {runningCount} running
                            </span>
                        )}
                    </div>
                </div>

                <section className="w-full max-w-full overflow-hidden border border-border bg-base-200/20">
                    <div className="flex items-center justify-between border-b border-border px-3 py-2">
                        <div className="text-xs font-medium uppercase tracking-wide text-muted">Tasks</div>
                        {runningCount > 0 && <div className="text-[11px] text-primary">Live</div>}
                    </div>
                    <div className="flex w-full max-w-full flex-col overflow-hidden">
                        {repo.tasks.length === 0 && <div className="p-3 text-sm text-muted">No tasks yet.</div>}
                        {repo.tasks.map((task) => (
                            <TaskRow key={task.id} task={task} isRunning={workingTaskIds.includes(task.id)} onSelect={() => onSelectTask(task.id)} />
                        ))}
                    </div>
                </section>
            </div>
        </div>
    )
}

function TaskRow({ task, isRunning, onSelect }: { task: RemoteTaskPreview; isRunning: boolean; onSelect: () => void }) {
    const status = task.lastEvent?.status
    const isError = status === "error"
    const statusLabel = isRunning ? "Running" : task.closed ? "Closed" : (task.lastEvent?.sourceLabel ?? "No events")
    const tone = isRunning ? "text-primary" : isError ? "text-error" : task.closed ? "text-muted" : "text-base-content"

    return (
        <button
            type="button"
            onClick={onSelect}
            className="btn group flex w-full min-w-0 max-w-full items-center gap-3 overflow-hidden border-b border-border bg-transparent px-3 py-3 text-left transition-colors last:border-b-0 hover:bg-base-200/70"
        >
            <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center border ${
                    isRunning
                        ? "border-primary/20 bg-primary/10 text-primary"
                        : isError
                          ? "border-error/20 bg-error/10 text-error"
                          : task.closed
                            ? "border-border bg-base-200/60 text-muted"
                            : "border-info/20 bg-info/10 text-info"
                }`}
            >
                {isRunning ? (
                    <Loader2 size={16} className="animate-spin" />
                ) : isError ? (
                    <CircleAlert size={16} />
                ) : task.closed ? (
                    <CheckCircle2 size={16} />
                ) : (
                    <CircleDot size={16} />
                )}
            </span>
            <span className="min-w-0 flex-1">
                <span className="block min-w-0 overflow-hidden truncate whitespace-nowrap text-sm font-semibold text-base-content">{task.title}</span>
                <span className={`mt-0.5 block max-w-full truncate text-xs ${tone}`}>{statusLabel}</span>
            </span>
            <ChevronRight size={15} className="shrink-0 text-muted opacity-60 group-hover:text-base-content" />
        </button>
    )
}

function TaskScreen({
    task,
    preview,
    isRunning,
    input,
    commandType,
    isLoading,
    isSubmitting,
    isOnline,
    onInputChange,
    onCommandTypeChange,
    onSend,
    onAbort,
}: {
    task: RemoteTask | null
    preview: RemoteTaskPreview | null
    isRunning: boolean
    input: string
    commandType: CommandType
    isLoading: boolean
    isSubmitting: boolean
    isOnline: boolean
    onInputChange: (value: string) => void
    onCommandTypeChange: (value: CommandType) => void
    onSend: () => void
    onAbort: () => void
}) {
    const messages = useMemo(() => taskMessages(task), [task])
    return (
        <div className="flex h-full w-full max-w-full flex-col overflow-hidden">
            <TaskMessages task={task} preview={preview} messages={messages} isRunning={isRunning} />
            <Composer
                input={input}
                commandType={commandType}
                isLoading={isLoading}
                isSubmitting={isSubmitting}
                isOnline={isOnline}
                isRunning={isRunning}
                onInputChange={onInputChange}
                onCommandTypeChange={onCommandTypeChange}
                onSend={onSend}
                onAbort={onAbort}
            />
        </div>
    )
}

function TaskMessages({
    task,
    preview,
    messages,
    isRunning,
}: {
    task: RemoteTask | null
    preview: RemoteTaskPreview | null
    messages: RemoteMessage[]
    isRunning: boolean
}) {
    const scrollRef = useRef<HTMLDivElement | null>(null)
    const shouldFollowRef = useRef(true)
    const [showJump, setShowJump] = useState(false)

    const scrollToBottom = () => {
        const el = scrollRef.current
        if (!el) return
        el.scrollTop = el.scrollHeight
        shouldFollowRef.current = true
        setShowJump(false)
    }

    useEffect(() => {
        const el = scrollRef.current
        if (!el) return
        if (shouldFollowRef.current) {
            window.requestAnimationFrame(scrollToBottom)
        } else {
            setShowJump(true)
        }
    }, [messages.length, isRunning])

    const handleScroll = () => {
        const el = scrollRef.current
        if (!el) return
        shouldFollowRef.current = shouldFollowRemoteThread(el.scrollHeight, el.scrollTop, el.clientHeight)
        if (shouldFollowRef.current) setShowJump(false)
    }

    return (
        <div className="relative min-h-0 w-full max-w-full flex-1 overflow-hidden">
            <div ref={scrollRef} onScroll={handleScroll} className="h-full w-full max-w-full overflow-y-auto overflow-x-hidden p-3">
                {preview && (
                    <div className="mb-3 border border-border bg-base-200/25 p-3">
                        <div className="flex min-w-0 items-center gap-2">
                            <span
                                className={`flex h-8 w-8 shrink-0 items-center justify-center border ${
                                    isRunning ? "border-primary/20 bg-primary/10 text-primary" : "border-border bg-base-100/70 text-muted"
                                }`}
                            >
                                {isRunning ? <Loader2 size={15} className="animate-spin" /> : <MessageSquarePlus size={15} />}
                            </span>
                            <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-semibold">{preview.title}</div>
                                <div className="truncate text-xs text-muted">{isRunning ? "Running now" : (preview.lastEvent?.sourceLabel ?? "Thread")}</div>
                            </div>
                        </div>
                    </div>
                )}
                {!task && <div className="text-sm text-muted">Loading task...</div>}
                {task?.unavailableReason && (
                    <div className="mb-3 break-words border border-warning/30 bg-warning/10 p-3 text-sm text-warning">{task.unavailableReason}</div>
                )}
                {messages.length === 0 && (
                    <div className="break-words border border-border bg-base-200/40 p-3 text-sm text-muted">
                        {preview?.title ?? "Task"} has no messages yet.
                    </div>
                )}
                <div className="flex w-full max-w-full flex-col gap-3 overflow-hidden">
                    {messages.map((message) => (
                        <MessageRow key={message.id} message={message} />
                    ))}
                    {isRunning && (
                        <div className="flex items-center gap-2 text-xs text-muted">
                            <Loader2 size={13} className="animate-spin text-primary" />
                            Working
                        </div>
                    )}
                </div>
            </div>
            {showJump && (
                <button
                    type="button"
                    onClick={scrollToBottom}
                    className="btn absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 bg-primary px-3 py-1.5 text-xs text-primary-content shadow-lg"
                >
                    <ArrowDown size={13} />
                    Latest
                </button>
            )}
        </div>
    )
}

function MessageRow({ message }: { message: RemoteMessage }) {
    if (message.kind === "activity") return <ActivityRow message={message} />

    const isUser = message.kind === "user"
    const tone =
        message.kind === "error"
            ? "border-error/30 bg-error/10 text-error"
            : message.kind === "snapshot"
              ? "border-info/30 bg-info/10"
              : message.kind === "tool"
                ? "border-border bg-base-200/50"
                : message.kind === "system"
                  ? "border-border bg-base-200/40"
                  : isUser
                    ? "border-primary/25 bg-primary/10"
                    : "border-border bg-base-200/60"

    return (
        <div className={`flex max-w-full ${isUser ? "justify-end pl-8" : "justify-start"}`}>
            <div className={`${isUser ? "max-w-[92%]" : "max-w-full"} overflow-hidden border p-3 ${tone}`}>
                {(message.title || message.meta || message.status) && (
                    <div className="mb-1 flex flex-wrap items-center gap-2 text-[10px] font-medium uppercase tracking-wide text-muted">
                        {message.title && <span>{message.title}</span>}
                        {message.meta && <span>{message.meta}</span>}
                        {message.status && <span>{message.status}</span>}
                    </div>
                )}
                <div className="whitespace-pre-wrap break-words text-sm leading-relaxed [overflow-wrap:anywhere]">{message.body}</div>
            </div>
        </div>
    )
}

function activityToneClass(tone: RemoteActivity["tone"]): string {
    if (tone === "ok") return "border-success/25 bg-success/10 text-success"
    if (tone === "warn") return "border-warning/25 bg-warning/10 text-warning"
    if (tone === "bad") return "border-error/25 bg-error/10 text-error"
    if (tone === "info") return "border-info/25 bg-info/10 text-info"
    return "border-border bg-base-200/50 text-muted"
}

function ActivityRow({ message }: { message: RemoteMessage }) {
    const items = message.activity ?? []

    return (
        <div className="mr-auto max-w-full overflow-hidden">
            <div className="flex max-w-full flex-wrap gap-1.5">
                {items.length === 0 && <span className="border border-border bg-base-200/50 px-2 py-1 text-[11px] text-muted">{message.body}</span>}
                {items.map((item) => (
                    <span
                        key={item.id}
                        className={`inline-flex max-w-full items-center gap-1 overflow-hidden border px-2 py-1 text-[11px] ${activityToneClass(item.tone)}`}
                    >
                        <span className="shrink-0 font-medium uppercase">{item.label}</span>
                        {item.detail && <span className="min-w-0 truncate normal-case opacity-80">{item.detail}</span>}
                    </span>
                ))}
            </div>
        </div>
    )
}

function Composer({
    input,
    commandType,
    isLoading,
    isSubmitting,
    isOnline,
    isRunning,
    onInputChange,
    onCommandTypeChange,
    onSend,
    onAbort,
}: {
    input: string
    commandType: CommandType
    isLoading: boolean
    isSubmitting: boolean
    isOnline: boolean
    isRunning: boolean
    onInputChange: (value: string) => void
    onCommandTypeChange: (value: CommandType) => void
    onSend: () => void
    onAbort: () => void
}) {
    const canQueueCurrentMode = !isRunning || commandType === "do" || commandType === "ask"
    return (
        <footer className="w-full max-w-full shrink-0 overflow-hidden border-t border-border bg-base-100 p-3">
            <div className="mb-2 flex max-w-full gap-1 overflow-x-auto overscroll-x-contain">
                {(["do", "plan", "ask", "hyperplan"] as CommandType[]).map((type) => (
                    <button
                        key={type}
                        type="button"
                        onClick={() => onCommandTypeChange(type)}
                        disabled={isSubmitting || (isRunning && type !== "do" && type !== "ask")}
                        className={`btn shrink-0 border border-border px-2 py-1 text-xs ${commandType === type ? "bg-primary text-primary-content" : "bg-base-200 text-base-content"}`}
                    >
                        {type}
                    </button>
                ))}
                {isRunning && (
                    <button type="button" onClick={onAbort} className="btn ml-auto flex h-8 w-8 items-center justify-center bg-error/10 text-error">
                        <Square size={14} />
                    </button>
                )}
            </div>
            <div className="flex min-w-0 gap-2">
                <textarea
                    value={input}
                    onChange={(event) => onInputChange(event.target.value)}
                    disabled={isSubmitting}
                    placeholder={isSubmitting ? "Sending..." : !isOnline ? "Offline" : canQueueCurrentMode ? "Send to OpenADE" : "Only Do and Ask can be queued while running"}
                    className="input min-h-12 max-h-28 min-w-0 flex-1 resize-none border border-border bg-base-200 p-2 text-sm"
                />
                <button
                    type="button"
                    onClick={onSend}
                    disabled={!input.trim() || isLoading || isSubmitting || !isOnline || !canQueueCurrentMode}
                    className={`btn flex shrink-0 items-center justify-center gap-1 bg-primary px-2 text-primary-content disabled:opacity-50 ${
                        isSubmitting ? "w-24 text-xs" : "w-12"
                    }`}
                >
                    {isSubmitting ? (
                        <>
                            <Loader2 size={15} className="animate-spin" />
                            Sending
                        </>
                    ) : (
                        <Send size={16} />
                    )}
                </button>
            </div>
        </footer>
    )
}

function NewTaskScreen({
    repos,
    repoId,
    mode,
    title,
    prompt,
    isLoading,
    isSubmitting,
    isOnline,
    onRepoChange,
    onModeChange,
    onTitleChange,
    onPromptChange,
    onCreate,
}: {
    repos: RemoteRepo[]
    repoId: string | null
    mode: CommandType
    title: string
    prompt: string
    isLoading: boolean
    isSubmitting: boolean
    isOnline: boolean
    onRepoChange: (repoId: string) => void
    onModeChange: (mode: CommandType) => void
    onTitleChange: (title: string) => void
    onPromptChange: (prompt: string) => void
    onCreate: () => void
}) {
    const selectedRepo = repos.find((repo) => repo.id === repoId) ?? null

    return (
        <div className="h-full w-full max-w-full overflow-y-auto overflow-x-hidden p-3 pb-20">
            <div className="flex w-full max-w-full flex-col gap-3 overflow-hidden">
                <div className="overflow-hidden border border-border bg-base-200/25">
                    <div className="flex min-w-0 items-center gap-3 border-b border-border bg-base-200/60 p-3">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center border border-primary/20 bg-primary/10 text-primary">
                            <MessageSquarePlus size={18} />
                        </span>
                        <div className="min-w-0">
                            <div className="text-[10px] font-medium uppercase tracking-wide text-muted">New task</div>
                            <div className="truncate text-base font-semibold">{selectedRepo?.name ?? "Choose a project"}</div>
                            <div className="truncate text-xs text-muted">{selectedRepo?.path ?? "Pick where this should run"}</div>
                        </div>
                    </div>
                    <div className="p-3">
                        <label className="flex flex-col gap-1">
                            <span className="text-xs font-medium text-muted">Project</span>
                            <select
                                value={repoId ?? ""}
                                onChange={(event) => onRepoChange(event.target.value)}
                                disabled={isSubmitting}
                                className="input h-11 w-full max-w-full border border-border bg-base-100 px-3 text-sm"
                            >
                                {repos.map((repo) => (
                                    <option key={repo.id} value={repo.id}>
                                        {repo.name}
                                    </option>
                                ))}
                            </select>
                        </label>
                    </div>
                </div>

                <section className="border border-border bg-base-200/20 p-3">
                    <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Mode</div>
                    <div className="grid min-w-0 grid-cols-4 gap-1.5">
                        {(["do", "plan", "ask", "hyperplan"] as CommandType[]).map((type) => (
                            <button
                                key={type}
                                type="button"
                                onClick={() => onModeChange(type)}
                                disabled={isSubmitting}
                                className={`btn min-w-0 overflow-hidden border px-1.5 py-2 text-xs ${
                                    mode === type ? "border-primary bg-primary text-primary-content" : "border-border bg-base-100 text-base-content"
                                }`}
                            >
                                <span className="truncate">{type}</span>
                            </button>
                        ))}
                    </div>
                </section>

                <section className="border border-border bg-base-200/20 p-3">
                    <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Prompt</div>
                    <input
                        value={title}
                        onChange={(event) => onTitleChange(event.target.value)}
                        disabled={isSubmitting}
                        placeholder="Optional title"
                        className="input mb-2 h-11 w-full max-w-full border border-border bg-base-100 px-3 text-base"
                    />
                    <textarea
                        value={prompt}
                        onChange={(event) => onPromptChange(event.target.value)}
                        disabled={isSubmitting}
                        placeholder={isSubmitting ? "Sending..." : "What should OpenADE do?"}
                        className="input min-h-[220px] w-full max-w-full resize-none border border-border bg-base-100 p-3 text-base"
                    />
                </section>
                <button
                    type="button"
                    onClick={onCreate}
                    disabled={!prompt.trim() || !repoId || isLoading || isSubmitting || !isOnline}
                    className="btn flex h-12 items-center justify-center gap-2 bg-primary px-4 font-medium text-primary-content disabled:opacity-50"
                >
                    {isSubmitting || isLoading ? <Loader2 size={16} className="animate-spin" /> : <MessageSquarePlus size={16} />}
                    {isSubmitting ? "Sending..." : "Create Task"}
                </button>
            </div>
        </div>
    )
}

function SessionsScreen({
    configs,
    activeConfigId,
    onSelect,
    onRemove,
    onAdd,
}: {
    configs: RemoteConfig[]
    activeConfigId: string
    onSelect: (configId: string) => void
    onRemove: (configId: string) => void
    onAdd: () => void
}) {
    return (
        <div className="h-full w-full max-w-full overflow-y-auto overflow-x-hidden p-3">
            <div className="flex w-full max-w-full flex-col gap-2 overflow-hidden">
                {configs.map((config) => (
                    <div
                        key={config.id}
                        className={`flex min-w-0 items-center gap-2 overflow-hidden border p-2 ${config.id === activeConfigId ? "border-primary bg-primary/10" : "border-border bg-base-200/40"}`}
                    >
                        <button
                            type="button"
                            onClick={() => onSelect(config.id)}
                            className="btn flex min-w-0 flex-1 items-center gap-3 bg-transparent p-1 text-left"
                        >
                            <Server size={16} className={config.id === activeConfigId ? "shrink-0 text-primary" : "shrink-0 text-muted"} />
                            <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-medium text-base-content">{config.host}</span>
                                <span className="block truncate text-xs text-muted">{config.baseUrl}</span>
                            </span>
                        </button>
                        <button
                            type="button"
                            onClick={() => onRemove(config.id)}
                            className="btn flex h-8 w-8 shrink-0 items-center justify-center bg-transparent text-muted"
                        >
                            <Trash2 size={15} />
                        </button>
                    </div>
                ))}
                <button type="button" onClick={onAdd} className="btn mt-2 flex h-11 items-center justify-center gap-2 bg-base-200 px-3 text-sm">
                    <Plus size={15} />
                    Add OpenADE Session
                </button>
            </div>
        </div>
    )
}

function SettingsScreen({
    config,
    snapshot,
    status,
    mobileTheme,
    onRefresh,
    onForget,
    onSessions,
    onAdd,
    onThemeChange,
}: {
    config: RemoteConfig
    snapshot: RemoteSnapshot | null
    status: { label: string; tone: "ok" | "warn" | "bad" | "muted" }
    mobileTheme: MobileThemeSetting
    onRefresh: () => void
    onForget: () => void
    onSessions: () => void
    onAdd: () => void
    onThemeChange: (value: MobileThemeSetting) => void
}) {
    return (
        <div className="h-full w-full max-w-full overflow-y-auto overflow-x-hidden p-3">
            <div className="flex w-full max-w-full flex-col gap-3 overflow-hidden">
                <div className="border border-border bg-base-200/40 p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium">{config.host}</div>
                            <div className="truncate text-xs text-muted">{config.baseUrl}</div>
                        </div>
                        <span className={`flex shrink-0 items-center gap-1 text-xs ${toneClass(status.tone)}`}>
                            {status.tone === "ok" ? <CheckCircle2 size={13} /> : <CircleAlert size={13} />}
                            {status.label}
                        </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        <button type="button" onClick={onRefresh} className="btn h-10 bg-base-300 px-3 text-sm">
                            Test
                        </button>
                        <button type="button" onClick={onForget} className="btn h-10 bg-error/10 px-3 text-sm text-error">
                            Forget
                        </button>
                    </div>
                </div>
                <div className="border border-border bg-base-200/40 p-3">
                    <div className="mb-2 flex min-w-0 items-center justify-between gap-2">
                        <div className="min-w-0">
                            <div className="text-xs font-medium uppercase tracking-wide text-muted">Mobile theme</div>
                            <div className="mt-1 truncate text-sm">
                                {mobileTheme === "desktop"
                                    ? `Matching desktop: ${snapshot?.server.theme?.label ?? "Desktop"}`
                                    : themeClasses[mobileTheme].label}
                            </div>
                        </div>
                    </div>
                    <select
                        value={mobileTheme}
                        onChange={(event) => onThemeChange(event.target.value as MobileThemeSetting)}
                        className="input h-11 w-full border border-border bg-base-100 px-3 text-sm"
                    >
                        <option value="desktop">Match desktop</option>
                        {(Object.keys(themeClasses) as ThemeClass[]).map((key) => (
                            <option key={key} value={key}>
                                {themeClasses[key].label}
                            </option>
                        ))}
                    </select>
                    <div className="mt-2 text-xs text-muted">Stored on this device. Switch back to Match desktop any time.</div>
                </div>
                <button type="button" onClick={onSessions} className="btn flex h-11 items-center justify-center gap-2 bg-base-200 px-3 text-sm">
                    <Server size={15} />
                    Manage Sessions
                </button>
                <button type="button" onClick={onAdd} className="btn flex h-11 items-center justify-center gap-2 bg-base-200 px-3 text-sm">
                    <Plus size={15} />
                    Add Session
                </button>
            </div>
        </div>
    )
}

function BottomNav({ active, onNavigate }: { active: RemoteScreen; onNavigate: (screen: RemoteScreen) => void }) {
    const items: Array<{ screen: RemoteScreen; label: string; icon: typeof FolderOpen }> = [
        { screen: "projects", label: "Projects", icon: FolderOpen },
        { screen: "new_task", label: "New", icon: MessageSquarePlus },
        { screen: "sessions", label: "Sessions", icon: Server },
        { screen: "settings", label: "Settings", icon: Settings },
    ]

    return (
        <nav className="grid h-14 w-full max-w-full shrink-0 grid-cols-4 overflow-hidden border-t border-border bg-base-100">
            {items.map((item) => {
                const Icon = item.icon
                const selected = active === item.screen || (active === "project" && item.screen === "projects")
                return (
                    <button
                        key={item.screen}
                        type="button"
                        onClick={() => {
                            if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
                            onNavigate(item.screen)
                        }}
                        className={`btn min-w-0 overflow-hidden flex flex-col items-center justify-center gap-0.5 text-[11px] ${selected ? "text-primary" : "text-muted"}`}
                    >
                        <Icon size={17} />
                        <span className="max-w-full truncate">{item.label}</span>
                    </button>
                )
            })}
        </nav>
    )
}
