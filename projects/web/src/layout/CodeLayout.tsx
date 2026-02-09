import NiceModal from "@ebay/nice-modal-react"
import { Code, Loader2 } from "lucide-react"
import { observer } from "mobx-react"
import { type ReactNode, useCallback, useEffect, useState } from "react"
import { useHotkeys } from "react-hotkeys-hook"
import { SettingsModal, type SettingsTab } from "../components/settings/SettingsModal"
import { setLastViewed, setWorkspaceLastViewed } from "../constants"
import { initCodeModuleCapabilities } from "../electronAPI/capabilities"
import { fetchPlatformInfo } from "../electronAPI/platform"
import { processApi } from "../electronAPI/process"
import { ptyApi } from "../electronAPI/pty"
import { DesktopRequiredPage } from "../pages/DesktopRequiredPage"
import { useCodeStore } from "../store/context"
import { CodeAppLayout } from "./CodeAppLayout"
export interface CodeLayoutProps {
    children: ReactNode
    isCodeModuleAvailable: boolean
    workspaceId?: string
    taskId?: string
    title: string
    icon: ReactNode
    navbarRight?: ReactNode
}

export const CodeLayout = observer(({ children, isCodeModuleAvailable, workspaceId, taskId, title, icon, navbarRight }: CodeLayoutProps) => {
    const codeStore = useCodeStore()
    const [hasInitialized, setHasInitialized] = useState(false)
    const [hasReconnected, setHasReconnected] = useState(false)

    // Gate access to desktop app with code modules only
    if (!isCodeModuleAvailable) {
        return (
            <CodeAppLayout
                navbar={{
                    title: "Code",
                    icon: <Code size="1.25rem" className="text-muted" />,
                    right: null,
                }}
            >
                <DesktopRequiredPage />
            </CodeAppLayout>
        )
    }

    // Load repos on mount and initialize capabilities + platform info
    useEffect(() => {
        const init = async () => {
            // Initialize code module capabilities and platform info early (caches for subsequent calls)
            await initCodeModuleCapabilities()
            await fetchPlatformInfo()
            await codeStore.repos.loadRepos()
            setHasInitialized(true)
        }
        init()
    }, [])

    // Ensure tasks are loaded when workspace changes
    useEffect(() => {
        if (workspaceId) {
            codeStore.tasks.ensureTasksLoaded(workspaceId)
        }
    }, [workspaceId])

    // Load TaskStore when taskId changes
    useEffect(() => {
        if (!workspaceId || !taskId || !hasInitialized) return

        const loadTask = async () => {
            try {
                await codeStore.getTaskStore(workspaceId, taskId)
            } catch (err) {
                console.error("[CodeLayout] Failed to load TaskStore:", err)
            }
        }

        loadTask()
    }, [workspaceId, taskId, hasInitialized])

    // Check if tasks are loaded for the current workspace
    const tasksLoaded = !workspaceId || codeStore.tasks.loadedRepoIds.has(workspaceId)

    const handleOpenSettings = useCallback(
        (tab?: SettingsTab) => {
            NiceModal.show(SettingsModal, { store: codeStore, initialTab: tab })
        },
        [codeStore]
    )

    // Keyboard shortcut: Cmd/Ctrl+, to open settings
    useHotkeys(
        "mod+comma",
        (e) => {
            e.preventDefault()
            handleOpenSettings()
        },
        { enableOnFormTags: ["INPUT", "TEXTAREA", "SELECT"] },
        [handleOpenSettings]
    )

    // Cleanup stale in-progress events on mount (mark as error if process died)
    useEffect(() => {
        if (!hasInitialized) return
        if (hasReconnected) return

        const cleanupStaleEvents = async () => {
            if (!codeStore.repoStore) {
                setHasReconnected(true)
                return
            }

            // Find tasks with in-progress events from RepoStore previews
            const staleTasks: Array<{ taskId: string; repoId: string }> = []
            for (const repo of codeStore.repoStore.repos.all()) {
                for (const preview of repo.tasks) {
                    if (preview.lastEvent?.status === "in_progress") {
                        staleTasks.push({ taskId: preview.id, repoId: repo.id })
                    }
                }
            }

            for (const { taskId, repoId } of staleTasks) {
                // Clear any stale working state first (in case of prior crash)
                codeStore.setTaskWorking(taskId, false)

                try {
                    const taskStore = await codeStore.getTaskStore(repoId, taskId)
                    const events = taskStore.events.all()
                    const lastEvent = events[events.length - 1]
                    if (lastEvent?.status === "in_progress") {
                        codeStore.events.errorEvent(taskId, lastEvent.id)
                    }
                } catch (err) {
                    console.error(`[cleanup] failed to cleanup task ${taskId}:`, err)
                }
            }

            setHasReconnected(true)
        }

        cleanupStaleEvents()
    }, [hasInitialized, hasReconnected])

    // Prevent page reload when tasks are running, and cleanup processes/PTYs on unload
    useEffect(() => {
        const handleBeforeUnload = (event: BeforeUnloadEvent) => {
            // Kill all processes and PTYs when page unloads
            processApi.killAll()
            ptyApi.killAll()

            if (codeStore.isWorking) {
                event.preventDefault()
                event.returnValue = ""
            }
        }

        window.addEventListener("beforeunload", handleBeforeUnload)
        return () => window.removeEventListener("beforeunload", handleBeforeUnload)
    }, [])

    // Track last viewed workspace/task for sidebar navigation
    useEffect(() => {
        if (workspaceId) {
            setLastViewed({ workspaceId, taskId })
            setWorkspaceLastViewed(workspaceId, { taskId })
        }
    }, [workspaceId, taskId])

    // Show loading state
    if (!hasInitialized || codeStore.repos.reposLoading || !tasksLoaded || !hasReconnected) {
        return (
            <CodeAppLayout
                navbar={{
                    title: "Code",
                    icon: <Code size="1.25rem" className="text-muted" />,
                    right: null,
                }}
            >
                <div className="flex flex-col items-center justify-center h-full text-muted">
                    <Loader2 size="2rem" className="animate-spin mb-4 opacity-50" />
                    <div className="text-sm">Loading...</div>
                </div>
            </CodeAppLayout>
        )
    }

    return (
        <CodeAppLayout
            navbar={{
                title,
                icon,
                right: navbarRight,
            }}
        >
            {children}
        </CodeAppLayout>
    )
})
