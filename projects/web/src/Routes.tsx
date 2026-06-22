import { AlertTriangle, Code, ListTodo, Loader2, RefreshCw, Settings, Sparkles } from "lucide-react"
import { observer } from "mobx-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { Navigate, useParams } from "react-router"
import type { OpenADETaskPreview } from "../../openade-module/src"
import { TaskStatsBar } from "./components/TaskStatsBar"
import { getLastViewed } from "./constants"
import { isCodeModuleAvailable } from "./electronAPI/capabilities"
import { isCompanionFeatureEnabled } from "./featureFlags"
import { CodeLayout, type CodeLayoutProps } from "./layout/CodeLayout"
import { OnboardingPage } from "./pages/OnboardingPage"
import { TaskCreateDraftsMenu, TaskCreatePage } from "./pages/TaskCreatePage"
import { TaskCreationPage } from "./pages/TaskCreationPage"
import { TaskPage } from "./pages/TaskPage"
import { WorkspaceCreatePage } from "./pages/WorkspaceCreatePage"
import { WorkspaceSettingsPage } from "./pages/WorkspaceSettingsPage"
import { RemoteApp } from "./remote/RemoteApp"
import { useCodeNavigate } from "./routing"
import { buildOpenADEShellCapabilitiesFromOpenADEMethods } from "./shell/capabilities"
import { useCodeStore } from "./store/context"

// Wrapper to inject isCodeModuleAvailable prop into CodeLayout
const Layout = (props: Omit<CodeLayoutProps, "isCodeModuleAvailable">) => <CodeLayout {...props} isCodeModuleAvailable={isCodeModuleAvailable()} />

function canUseMissingRepoProjection(codeStore: ReturnType<typeof useCodeStore>): boolean {
    return codeStore.usesCoreOwnedProductRuntime() && (codeStore.shouldUseRuntimeProductAPI() || !codeStore.storeInitialized)
}

function hasCoreProductProjectionError(codeStore: ReturnType<typeof useCodeStore>): boolean {
    return codeStore.usesCoreOwnedProductRuntime() && codeStore.runtimeProductStoreStatus === "error"
}

function CoreProductProjectionError({ codeStore }: { codeStore: ReturnType<typeof useCodeStore> }) {
    const retry = useCallback(() => {
        void codeStore.initializeRuntimeProductStore()
    }, [codeStore])

    return (
        <div className="flex flex-col items-center justify-center h-full text-muted px-6 text-center">
            <AlertTriangle size="2rem" className="mb-3 text-warning" />
            <div className="text-base font-medium text-base-content mb-1">OpenADE Core is unavailable</div>
            <div className="text-sm max-w-md break-words">{codeStore.runtimeProductStoreError ?? "Core product state could not be loaded."}</div>
            <button type="button" className="btn btn-sm mt-4 flex items-center gap-2" onClick={retry}>
                <RefreshCw size="0.9rem" />
                <span>Retry</span>
            </button>
        </div>
    )
}

function useCleanCoreProjectListLoad(codeStore: ReturnType<typeof useCodeStore>, shouldLoad: boolean, loadKey: string): boolean {
    const [loadedProjectKey, setLoadedProjectKey] = useState<string | null>(null)
    const canLoadProjectFromCore = codeStore.shouldUseRuntimeProductAPI()
    const shouldLoadProjectFromCore = shouldLoad && canLoadProjectFromCore && loadedProjectKey !== loadKey

    useEffect(() => {
        if (!shouldLoadProjectFromCore) return
        let active = true
        codeStore
            .loadRuntimeProductProjects()
            .catch((error) => {
                console.warn("[Routes] Failed to load Core workspace projection:", error)
            })
            .finally(() => {
                if (active) setLoadedProjectKey(loadKey)
            })
        return () => {
            active = false
        }
    }, [codeStore, loadKey, shouldLoadProjectFromCore])

    return shouldLoad && loadedProjectKey !== loadKey
}

function useCleanCoreWorkspaceProjectionLoad(codeStore: ReturnType<typeof useCodeStore>, workspaceId: string | undefined, repo: unknown): boolean {
    return useCleanCoreProjectListLoad(codeStore, Boolean(workspaceId && !repo && canUseMissingRepoProjection(codeStore)), workspaceId ?? "workspace")
}

// ==================== Route: /dashboard/code ====================

function getMostRecentTaskId(tasks: OpenADETaskPreview[]): string | undefined {
    const zeroTime = new Date(0).toISOString()
    const openTasks = tasks.filter((t) => !t.closed)
    if (openTasks.length === 0) return undefined
    const sorted = openTasks.sort((a, b) => {
        const aTime = a.lastEvent?.at ?? a.createdAt ?? zeroTime
        const bTime = b.lastEvent?.at ?? b.createdAt ?? zeroTime
        return bTime.localeCompare(aTime)
    })
    return sorted[0]?.id
}

export const CodeBaseRoute = observer(() => {
    const codeStore = useCodeStore()
    const navigate = useCodeNavigate()
    const isLoadingCleanCoreProjects = useCleanCoreProjectListLoad(
        codeStore,
        !codeStore.repos.reposLoading && codeStore.repos.repos.length === 0 && codeStore.shouldUseRuntimeProductProjectListProjection(),
        "base"
    )

    // Wait for repos to load, then redirect
    if (codeStore.repos.reposLoading) {
        return (
            <Layout title="Code" icon={<Code size="1.25rem" className="text-muted" />}>
                <div className="flex flex-col items-center justify-center h-full text-muted">
                    <Loader2 size="2rem" className="animate-spin mb-4 opacity-50" />
                    <div className="text-sm">Loading...</div>
                </div>
            </Layout>
        )
    }

    if (isLoadingCleanCoreProjects) {
        return (
            <Layout title="Code" icon={<Code size="1.25rem" className="text-muted" />}>
                <div className="flex flex-col items-center justify-center h-full text-muted">
                    <Loader2 size="2rem" className="animate-spin mb-4 opacity-50" />
                    <div className="text-sm">Loading...</div>
                </div>
            </Layout>
        )
    }

    if (hasCoreProductProjectionError(codeStore)) {
        return (
            <Layout title="Code" icon={<Code size="1.25rem" className="text-muted" />}>
                <CoreProductProjectionError codeStore={codeStore} />
            </Layout>
        )
    }

    // No workspaces - check if onboarding needed
    const onboardingCompleted = codeStore.personalSettingsStore?.settings.current.onboardingCompleted
    if (codeStore.repos.repos.length === 0 && !onboardingCompleted) {
        return (
            <Layout title="Welcome" icon={<Sparkles size="1.25rem" className="text-primary" />}>
                <OnboardingPage />
            </Layout>
        )
    }

    // No workspaces but onboarding done - go to create
    if (codeStore.repos.repos.length === 0) {
        return <Navigate to={navigate.path("CodeWorkspaceCreate")} replace />
    }

    // Try to restore last viewed workspace/task
    const lastViewed = getLastViewed()
    if (lastViewed) {
        const workspace = codeStore.repos.repos.find((r) => r.id === lastViewed.workspaceId)
        if (workspace) {
            // Validate task exists if specified
            if (lastViewed.taskId) {
                const taskExists = codeStore.getTaskPreviewsForRepo(workspace.id).some((t) => t.id === lastViewed.taskId)
                if (taskExists) {
                    return <Navigate to={navigate.path("CodeWorkspaceTask", { workspaceId: workspace.id, taskId: lastViewed.taskId })} replace />
                }
            }
            // Workspace exists but task doesn't - find most recent task
            const mostRecentTaskId = getMostRecentTaskId(codeStore.getTaskPreviewsForRepo(workspace.id))
            if (mostRecentTaskId) {
                return <Navigate to={navigate.path("CodeWorkspaceTask", { workspaceId: workspace.id, taskId: mostRecentTaskId })} replace />
            }
            // Workspace exists but no tasks - go to task create
            return <Navigate to={navigate.path("CodeWorkspaceTaskCreate", { workspaceId: workspace.id })} replace />
        }
    }

    // Fallback: first workspace + most recent task
    const firstWorkspace = codeStore.repos.repos[0]
    const mostRecentTaskId = getMostRecentTaskId(codeStore.getTaskPreviewsForRepo(firstWorkspace.id))
    if (mostRecentTaskId) {
        return <Navigate to={navigate.path("CodeWorkspaceTask", { workspaceId: firstWorkspace.id, taskId: mostRecentTaskId })} replace />
    }

    // First workspace, no tasks - go to task create
    return <Navigate to={navigate.path("CodeWorkspaceTaskCreate", { workspaceId: firstWorkspace.id })} replace />
})

export const RemoteRoute = () => (isCompanionFeatureEnabled ? <RemoteApp /> : <Navigate to="/dashboard/code" replace />)

// ==================== Route: /dashboard/code/workspace/create ====================

export const CodeWorkspaceCreateRoute = observer(() => {
    return (
        <Layout title="Add Workspace" icon={<Code size="1.25rem" className="text-muted" />}>
            <WorkspaceCreatePage />
        </Layout>
    )
})

// ==================== Route: /dashboard/code/workspace/:workspaceId ====================

export const CodeWorkspaceRoute = observer(() => {
    const codeStore = useCodeStore()
    const { workspaceId } = useParams<{ workspaceId: string }>()
    const navigate = useCodeNavigate()

    const repo = workspaceId ? codeStore.repos.getRepo(workspaceId) : null
    const isLoadingCleanCoreProject = useCleanCoreWorkspaceProjectionLoad(codeStore, workspaceId, repo)

    if (!workspaceId) {
        return <Navigate to={navigate.path("Code")} replace />
    }

    if (!repo && isLoadingCleanCoreProject) {
        return (
            <Layout workspaceId={workspaceId} title="Workspace" icon={<Code size="1.25rem" className="text-muted" />}>
                <div className="flex flex-col items-center justify-center h-full text-muted">
                    <Loader2 size="2rem" className="animate-spin mb-4 opacity-50" />
                    <div className="text-sm">Loading workspace...</div>
                </div>
            </Layout>
        )
    }

    if (!repo && hasCoreProductProjectionError(codeStore)) {
        return (
            <Layout workspaceId={workspaceId} title="Workspace" icon={<Code size="1.25rem" className="text-muted" />}>
                <CoreProductProjectionError codeStore={codeStore} />
            </Layout>
        )
    }

    if (!repo && canUseMissingRepoProjection(codeStore)) {
        return <Navigate to={navigate.path("Code")} replace />
    }

    const mostRecentTaskId = getMostRecentTaskId(codeStore.getTaskPreviewsForRepo(workspaceId))

    return (
        <Layout workspaceId={workspaceId} title={repo?.name ?? "Workspace"} icon={<Code size="1.25rem" className="text-muted" />}>
            <Navigate
                to={
                    mostRecentTaskId
                        ? navigate.path("CodeWorkspaceTask", { workspaceId, taskId: mostRecentTaskId })
                        : navigate.path("CodeWorkspaceTaskCreate", { workspaceId })
                }
                replace
            />
        </Layout>
    )
})

// ==================== Route: /dashboard/code/workspace/:workspaceId/settings ====================

export const CodeWorkspaceSettingsRoute = observer(() => {
    const codeStore = useCodeStore()
    const { workspaceId } = useParams<{ workspaceId: string }>()
    const navigate = useCodeNavigate()

    const repo = workspaceId ? codeStore.repos.getRepo(workspaceId) : null
    const isLoadingCleanCoreProject = useCleanCoreWorkspaceProjectionLoad(codeStore, workspaceId, repo)

    if (!workspaceId) {
        return <Navigate to={navigate.path("Code")} replace />
    }

    if (!repo && isLoadingCleanCoreProject) {
        return (
            <Layout title="Workspace Settings" icon={<Settings size="1.25rem" className="text-muted" />} workspaceId={workspaceId}>
                <div className="flex flex-col items-center justify-center h-full text-muted">
                    <Loader2 size="2rem" className="animate-spin mb-4 opacity-50" />
                    <div className="text-sm">Loading workspace...</div>
                </div>
            </Layout>
        )
    }

    if (!repo && hasCoreProductProjectionError(codeStore)) {
        return (
            <Layout title="Workspace Settings" icon={<Settings size="1.25rem" className="text-muted" />} workspaceId={workspaceId}>
                <CoreProductProjectionError codeStore={codeStore} />
            </Layout>
        )
    }

    if (!repo) {
        return <Navigate to={navigate.path("Code")} replace />
    }

    return (
        <Layout title={`${repo.name} Settings`} icon={<Settings size="1.25rem" className="text-muted" />} workspaceId={workspaceId}>
            <WorkspaceSettingsPage workspaceId={workspaceId} repo={repo} />
        </Layout>
    )
})

// ==================== Route: /dashboard/code/workspace/:workspaceId/task/create ====================

export const CodeWorkspaceTaskCreateRoute = observer(() => {
    const codeStore = useCodeStore()
    const { workspaceId } = useParams<{ workspaceId: string }>()
    const navigate = useCodeNavigate()

    const repo = workspaceId ? codeStore.repos.getRepo(workspaceId) : null

    if (!workspaceId) {
        return <Navigate to={navigate.path("Code")} replace />
    }

    if (!repo && hasCoreProductProjectionError(codeStore)) {
        return (
            <Layout workspaceId={workspaceId} title="New Task" icon={<Code size="1.25rem" className="text-muted" />}>
                <CoreProductProjectionError codeStore={codeStore} />
            </Layout>
        )
    }

    if (!repo && !canUseMissingRepoProjection(codeStore)) {
        return (
            <Layout workspaceId={workspaceId} title="New Task" icon={<Code size="1.25rem" className="text-muted" />}>
                <div className="flex flex-col items-center justify-center h-full text-muted">
                    <Code size="3rem" className="mb-4 opacity-30" />
                    <div className="text-lg font-medium mb-2">Workspace not found</div>
                    <div className="text-sm">Select a workspace from the sidebar or add a new one</div>
                </div>
            </Layout>
        )
    }

    return (
        <Layout
            workspaceId={workspaceId}
            title="New Task"
            icon={<Code size="1.25rem" className="text-muted" />}
            navbarRight={<TaskCreateDraftsMenu workspaceId={workspaceId} />}
        >
            <TaskCreatePage workspaceId={workspaceId} repo={repo ?? null} />
        </Layout>
    )
})

// ==================== Route: /dashboard/code/workspace/:workspaceId/task/create/:creationId ====================

export const CodeWorkspaceTaskCreatingRoute = observer(() => {
    const codeStore = useCodeStore()
    const { workspaceId, creationId } = useParams<{ workspaceId: string; creationId: string }>()
    const navigate = useCodeNavigate()

    const repo = workspaceId ? codeStore.repos.getRepo(workspaceId) : null

    if (!workspaceId || !creationId) {
        return <Navigate to={navigate.path("Code")} replace />
    }

    if (!repo && hasCoreProductProjectionError(codeStore)) {
        return (
            <Layout workspaceId={workspaceId} title="Creating Task" icon={<Loader2 size="1.25rem" className="text-muted animate-spin" />}>
                <CoreProductProjectionError codeStore={codeStore} />
            </Layout>
        )
    }

    if (!repo && !canUseMissingRepoProjection(codeStore)) {
        return (
            <Layout workspaceId={workspaceId} title="Creating Task" icon={<Loader2 size="1.25rem" className="text-muted animate-spin" />}>
                <div className="flex flex-col items-center justify-center h-full text-muted">
                    <Code size="3rem" className="mb-4 opacity-30" />
                    <div className="text-lg font-medium mb-2">Workspace not found</div>
                    <div className="text-sm">Select a workspace from the sidebar or add a new one</div>
                </div>
            </Layout>
        )
    }

    return (
        <Layout workspaceId={workspaceId} title="Creating Task" icon={<Loader2 size="1.25rem" className="text-muted animate-spin" />}>
            <TaskCreationPage workspaceId={workspaceId} creationId={creationId} />
        </Layout>
    )
})

// ==================== Route: /dashboard/code/workspace/:workspaceId/task/:taskId ====================

export const CodeWorkspaceTaskRoute = observer(() => {
    const codeStore = useCodeStore()
    const { workspaceId, taskId } = useParams<{ workspaceId: string; taskId: string }>()
    const navigate = useCodeNavigate()

    const repo = workspaceId ? codeStore.repos.getRepo(workspaceId) : null
    const taskModel = workspaceId && taskId ? codeStore.tasks.getTaskModelForRoute(workspaceId, taskId) : null
    const [taskReadRetrying, setTaskReadRetrying] = useState(false)
    const handleRetryRouteTaskRead = useCallback(() => {
        if (!workspaceId || !taskId || taskReadRetrying) return
        setTaskReadRetrying(true)
        void codeStore
            .loadRuntimeProductTaskForRoute(workspaceId, taskId)
            .catch((error) => {
                console.warn("[Routes] Failed to retry Core task read:", error)
            })
            .finally(() => {
                setTaskReadRetrying(false)
            })
    }, [codeStore, workspaceId, taskId, taskReadRetrying])

    // Redirects
    if (!workspaceId || !taskId) {
        return <Navigate to={navigate.path("Code")} replace />
    }

    // Determine navbar title and icon
    const taskTitle = taskModel?.title || "Task"
    const isTaskClosed = taskModel?.isClosed ?? false
    // Inline title editing
    const [isEditingTitle, setIsEditingTitle] = useState(false)
    const titleInputRef = useRef<HTMLInputElement>(null)
    const titleGenerateButtonRef = useRef<HTMLButtonElement>(null)
    const isRegeneratingTitle = taskId ? codeStore.tasks.regeneratingTitleTaskIds.has(taskId) : false
    const shellCapabilities = buildOpenADEShellCapabilitiesFromOpenADEMethods((method) => codeStore.canUseProductMethod(method))
    const canUpdateTaskMetadata = shellCapabilities.taskRecordCapabilities.canUpdateMetadata
    const canGenerateTaskTitle = shellCapabilities.taskRecordCapabilities.canGenerateTitle
    const canRegenerateTitle = canGenerateTaskTitle && Boolean(taskModel?.description.trim())
    const handleRegenerateTitle = useCallback(() => {
        if (!taskId || isRegeneratingTitle || !canRegenerateTitle) return

        setIsEditingTitle(false)
        codeStore.tasks.regenerateTitle(taskId)
    }, [canRegenerateTitle, codeStore, isRegeneratingTitle, taskId])
    const handleTitleCommit = (nextFocus?: EventTarget | null) => {
        if (nextFocus === titleGenerateButtonRef.current) return

        const value = titleInputRef.current?.value.trim()
        if (value && value !== taskTitle && taskId && canUpdateTaskMetadata) {
            codeStore.tasks.setTaskTitle(taskId, value)
        }
        setIsEditingTitle(false)
    }
    const navbarTitle = taskModel ? (
        <div className="flex items-center gap-1.5 min-w-0">
            {isTaskClosed && <span className="font-mono text-[11px] text-muted flex-shrink-0">[Closed]</span>}
            {isEditingTitle ? (
                <>
                    <input
                        ref={titleInputRef}
                        className="font-medium text-base-content min-w-0 bg-transparent border border-base-300 px-1 outline-none"
                        aria-label="Task title"
                        defaultValue={taskTitle}
                        autoFocus
                        onBlur={(event) => handleTitleCommit(event.relatedTarget)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") handleTitleCommit()
                            if (e.key === "Escape") setIsEditingTitle(false)
                        }}
                    />
                    {canGenerateTaskTitle && (
                        <button
                            ref={titleGenerateButtonRef}
                            type="button"
                            className="btn flex items-center gap-1 px-1.5 py-0.5 text-xs text-muted hover:bg-base-200 hover:text-base-content disabled:opacity-50 flex-shrink-0"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={handleRegenerateTitle}
                            disabled={isRegeneratingTitle || !canRegenerateTitle}
                            title="Generate new title"
                            aria-label="Generate new title"
                        >
                            {isRegeneratingTitle ? <Loader2 size="0.85rem" className="animate-spin" /> : <Sparkles size="0.85rem" />}
                            <span>Generate Title</span>
                        </button>
                    )}
                </>
            ) : (
                <span
                    data-openade-task-route-title="true"
                    data-openade-task-route-can-update-metadata={canUpdateTaskMetadata ? "true" : "false"}
                    data-openade-task-route-can-generate-title={canGenerateTaskTitle ? "true" : "false"}
                    className={`font-medium text-base-content truncate min-w-0${canUpdateTaskMetadata ? " cursor-text" : ""}`}
                    onClick={() => {
                        if (canUpdateTaskMetadata) setIsEditingTitle(true)
                    }}
                >
                    {taskTitle}
                </span>
            )}
        </div>
    ) : (
        taskTitle
    )
    const navbarIcon = <ListTodo size="1.25rem" className="text-muted" />
    const navbarRight = taskModel ? <TaskStatsBar taskModel={taskModel} /> : undefined

    if (!repo && hasCoreProductProjectionError(codeStore)) {
        return (
            <Layout workspaceId={workspaceId} taskId={taskId} title={navbarTitle} icon={navbarIcon} navbarRight={navbarRight}>
                <CoreProductProjectionError codeStore={codeStore} />
            </Layout>
        )
    }

    const canReadTaskWithoutWorkspaceProjection = codeStore.canUseRuntimeProductTaskRouteModelSource()
    const routeTaskReadMissed = codeStore.hasRuntimeProductRouteTaskReadMiss?.(workspaceId, taskId) ?? false
    const routeTaskReadError = codeStore.getRuntimeProductRouteTaskReadError?.(workspaceId, taskId) ?? null
    const hasLoadedTaskSource = codeStore.hasProductTaskModelSource(taskId)

    if (!repo && !canUseMissingRepoProjection(codeStore) && !canReadTaskWithoutWorkspaceProjection) {
        return (
            <Layout workspaceId={workspaceId} taskId={taskId} title={navbarTitle} icon={navbarIcon} navbarRight={navbarRight}>
                <div className="flex flex-col items-center justify-center h-full text-muted">
                    <Code size="3rem" className="mb-4 opacity-30" />
                    <div className="text-lg font-medium mb-2">Workspace not found</div>
                    <div className="text-sm">Select a workspace from the sidebar or add a new one</div>
                </div>
            </Layout>
        )
    }

    if (routeTaskReadMissed && !hasLoadedTaskSource) {
        return (
            <Layout workspaceId={workspaceId} taskId={taskId} title={navbarTitle} icon={navbarIcon} navbarRight={navbarRight}>
                <div className="flex flex-col items-center justify-center h-full text-muted">
                    <ListTodo size="3rem" className="mb-4 opacity-30" />
                    <div className="text-lg font-medium mb-2">Task not found</div>
                    <div className="text-sm">Select a task from the sidebar or create a new one</div>
                </div>
            </Layout>
        )
    }

    if (routeTaskReadError && !hasLoadedTaskSource) {
        return (
            <Layout workspaceId={workspaceId} taskId={taskId} title={navbarTitle} icon={navbarIcon} navbarRight={navbarRight}>
                <div className="flex flex-col items-center justify-center h-full text-muted px-6 text-center">
                    <AlertTriangle size="3rem" className="mb-4 text-warning" />
                    <div className="text-lg font-medium text-base-content mb-2">Task failed to load</div>
                    <div className="text-sm max-w-md break-words">{routeTaskReadError}</div>
                    <button
                        type="button"
                        className="btn btn-sm mt-4 flex items-center gap-2"
                        onClick={handleRetryRouteTaskRead}
                        disabled={taskReadRetrying}
                    >
                        {taskReadRetrying ? <Loader2 size="0.9rem" className="animate-spin" /> : <RefreshCw size="0.9rem" />}
                        <span>{taskReadRetrying ? "Retrying" : "Retry"}</span>
                    </button>
                </div>
            </Layout>
        )
    }

    // Task not loaded yet
    if (!taskModel?.exists) {
        return (
            <Layout workspaceId={workspaceId} taskId={taskId} title={navbarTitle} icon={navbarIcon} navbarRight={navbarRight}>
                <div className="flex flex-col items-center justify-center h-full text-muted">
                    <Loader2 size="2rem" className="animate-spin mb-4 opacity-50" />
                    <div className="text-sm">Loading task...</div>
                </div>
            </Layout>
        )
    }

    return (
        <Layout workspaceId={workspaceId} taskId={taskId} title={navbarTitle} icon={navbarIcon} navbarRight={navbarRight}>
            <TaskPage workspaceId={workspaceId} taskId={taskId} taskModel={taskModel} />
        </Layout>
    )
})
