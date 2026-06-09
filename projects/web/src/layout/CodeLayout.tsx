import NiceModal from "@ebay/nice-modal-react"
import { Code, Loader2 } from "lucide-react"
import { observer } from "mobx-react"
import { type ReactNode, useCallback, useEffect, useState } from "react"
import { useHotkeys } from "react-hotkeys-hook"
import { SettingsModal, type SettingsTab } from "../components/settings/SettingsModal"
import { setLastViewed, setWorkspaceLastViewed } from "../constants"
import { initCodeModuleCapabilities } from "../electronAPI/capabilities"
import { fetchPlatformInfo } from "../electronAPI/platform"
import { DesktopRequiredPage } from "../pages/DesktopRequiredPage"
import { useCodeStore } from "../store/context"
import { CodeAppLayout } from "./CodeAppLayout"

export interface CodeLayoutProps {
    children: ReactNode
    isCodeModuleAvailable: boolean
    workspaceId?: string
    taskId?: string
    title: string | ReactNode
    icon: ReactNode
    navbarRight?: ReactNode
}

export const CodeLayout = observer(({ children, isCodeModuleAvailable, workspaceId, taskId, title, icon, navbarRight }: CodeLayoutProps) => {
    const codeStore = useCodeStore()
    const [hasInitialized, setHasInitialized] = useState(() => codeStore.storeInitialized)

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
        if (codeStore.storeInitialized) {
            setHasInitialized(true)
            return
        }

        let cancelled = false
        const init = async () => {
            // Initialize independent app-shell reads together so cold task opens are not serialized behind startup probes.
            await Promise.all([initCodeModuleCapabilities(), fetchPlatformInfo(), codeStore.repos.loadRepos()])
            if (!cancelled) setHasInitialized(true)
        }
        void init()
        return () => {
            cancelled = true
        }
    }, [codeStore, codeStore.storeInitialized])

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
                if (codeStore.shouldUseRuntimeProductReads()) {
                    await codeStore.loadRuntimeProductTask(workspaceId, taskId, { hydrateSessionEvents: false })
                    return
                }
                await codeStore.getTaskStore(workspaceId, taskId)
            } catch (err) {
                console.error("[CodeLayout] Failed to load task:", err)
            }
        }

        void loadTask()
    }, [workspaceId, taskId, hasInitialized, codeStore, codeStore.runtimeProductStoreStatus])

    // Check if tasks are loaded for the current workspace
    const tasksLoaded = !workspaceId || codeStore.storeInitialized || codeStore.tasks.loadedRepoIds.has(workspaceId)

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

    // Prevent accidental page reload while runtime-owned work is active.
    useEffect(() => {
        if (window.openadeAPI?.app.activeWorkUnloadBlockerDisabled) return

        const handleBeforeUnload = (event: BeforeUnloadEvent) => {
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
    if (!hasInitialized || codeStore.repos.reposLoading || !tasksLoaded) {
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
