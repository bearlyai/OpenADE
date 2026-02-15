import type { TaskPreview } from "@/persistence/repoStore"
import { Code, ListTodo, Loader2, RefreshCw, Settings, Sparkles } from "lucide-react"
import { observer } from "mobx-react"
import { useCallback } from "react"
import { Navigate, useParams } from "react-router"
import { TaskStatsBar } from "./components/TaskStatsBar"
import { getLastViewed } from "./constants"
import { isCodeModuleAvailable } from "./electronAPI/capabilities"
import { CodeLayout, type CodeLayoutProps } from "./layout/CodeLayout"
import { OnboardingPage } from "./pages/OnboardingPage"
import { TaskCreatePage } from "./pages/TaskCreatePage"
import { TaskCreationPage } from "./pages/TaskCreationPage"
import { TaskPage } from "./pages/TaskPage"
import { WorkspaceCreatePage } from "./pages/WorkspaceCreatePage"
import { WorkspaceSettingsPage } from "./pages/WorkspaceSettingsPage"
import { useCodeNavigate } from "./routing"
import { useCodeStore } from "./store/context"

// Wrapper to inject isCodeModuleAvailable prop into CodeLayout
const Layout = (props: Omit<CodeLayoutProps, "isCodeModuleAvailable">) => <CodeLayout {...props} isCodeModuleAvailable={isCodeModuleAvailable()} />

// ==================== Route: /dashboard/code ====================

function getMostRecentTaskId(tasks: TaskPreview[]): string | undefined {
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
                const repo = codeStore.repoStore?.repos.get(workspace.id)
                const taskExists = repo?.tasks.some((t) => t.id === lastViewed.taskId)
                if (taskExists) {
                    return <Navigate to={navigate.path("CodeWorkspaceTask", { workspaceId: workspace.id, taskId: lastViewed.taskId })} replace />
                }
            }
            // Workspace exists but task doesn't - find most recent task
            const repo = codeStore.repoStore?.repos.get(workspace.id)
            const mostRecentTaskId = repo ? getMostRecentTaskId(repo.tasks) : undefined
            if (mostRecentTaskId) {
                return <Navigate to={navigate.path("CodeWorkspaceTask", { workspaceId: workspace.id, taskId: mostRecentTaskId })} replace />
            }
            // Workspace exists but no tasks - go to task create
            return <Navigate to={navigate.path("CodeWorkspaceTaskCreate", { workspaceId: workspace.id })} replace />
        }
    }

    // Fallback: first workspace + most recent task
    const firstWorkspace = codeStore.repos.repos[0]
    const firstRepo = codeStore.repoStore?.repos.get(firstWorkspace.id)
    const mostRecentTaskId = firstRepo ? getMostRecentTaskId(firstRepo.tasks) : undefined
    if (mostRecentTaskId) {
        return <Navigate to={navigate.path("CodeWorkspaceTask", { workspaceId: firstWorkspace.id, taskId: mostRecentTaskId })} replace />
    }

    // First workspace, no tasks - go to task create
    return <Navigate to={navigate.path("CodeWorkspaceTaskCreate", { workspaceId: firstWorkspace.id })} replace />
})

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
    const { workspaceId } = useParams<{ workspaceId: string }>()
    const navigate = useCodeNavigate()

    if (!workspaceId) {
        return <Navigate to={navigate.path("Code")} replace />
    }

    // Redirect to task create
    return <Navigate to={navigate.path("CodeWorkspaceTaskCreate", { workspaceId })} replace />
})

// ==================== Route: /dashboard/code/workspace/:workspaceId/settings ====================

export const CodeWorkspaceSettingsRoute = observer(() => {
    const codeStore = useCodeStore()
    const { workspaceId } = useParams<{ workspaceId: string }>()
    const navigate = useCodeNavigate()

    const repo = workspaceId ? codeStore.repos.getRepo(workspaceId) : null

    if (!workspaceId || !repo) {
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

    // Workspace not found
    if (!repo) {
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
        <Layout workspaceId={workspaceId} title="New Task" icon={<Code size="1.25rem" className="text-muted" />}>
            <TaskCreatePage workspaceId={workspaceId} repo={repo} />
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

    if (!repo) {
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
    const taskModel = taskId ? codeStore.tasks.getTaskModel(taskId) : null

    // Redirects
    if (!workspaceId || !taskId) {
        return <Navigate to={navigate.path("Code")} replace />
    }

    // Determine navbar title and icon
    const navbarTitle = taskModel?.title || "Task"
    const navbarIcon = <ListTodo size="1.25rem" className="text-muted" />
    const handleRegenerateTitle = useCallback(() => {
        if (taskId) {
            codeStore.tasks.regenerateTitle(taskId)
        }
    }, [codeStore, taskId])
    const navbarRight = taskModel ? (
        <div className="flex items-center gap-2">
            <button
                type="button"
                className="btn flex items-center justify-center w-7 h-7 text-muted hover:bg-base-200 hover:text-base-content"
                onClick={handleRegenerateTitle}
                title="Regenerate title"
                aria-label="Regenerate title"
            >
                <RefreshCw size="0.85rem" />
            </button>
            <TaskStatsBar taskModel={taskModel} />
        </div>
    ) : undefined

    // Workspace not found
    if (!repo) {
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
