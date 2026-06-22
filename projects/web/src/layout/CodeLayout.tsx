import NiceModal from "@ebay/nice-modal-react"
import { Code, Loader2 } from "lucide-react"
import { observer } from "mobx-react"
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react"
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

function scheduleAfterNextPaint(callback: () => void): () => void {
    let cancelled = false
    let firstFrame: number | null = null
    let secondFrame: number | null = null
    let fallbackTimer: number | null = null

    const run = () => {
        if (!cancelled) callback()
    }

    if (typeof window.requestAnimationFrame === "function") {
        firstFrame = window.requestAnimationFrame(() => {
            firstFrame = null
            secondFrame = window.requestAnimationFrame(run)
        })
    } else {
        fallbackTimer = window.setTimeout(run, 0)
    }

    return () => {
        cancelled = true
        if (firstFrame !== null) window.cancelAnimationFrame(firstFrame)
        if (secondFrame !== null) window.cancelAnimationFrame(secondFrame)
        if (fallbackTimer !== null) window.clearTimeout(fallbackTimer)
    }
}

export const CodeLayout = observer(({ children, isCodeModuleAvailable, workspaceId, taskId, title, icon, navbarRight }: CodeLayoutProps) => {
    const codeStore = useCodeStore()
    const [hasInitialized, setHasInitialized] = useState(() => codeStore.storeInitialized)
    const lastTaskLoadKeyRef = useRef<string | null>(null)
    const productRuntimeOwnsTaskRoute = codeStore.shouldUseRuntimeProductTaskRoute()
    const runtimeTaskRouteLoadKey = workspaceId && taskId && productRuntimeOwnsTaskRoute ? `runtime-product\0${workspaceId}\0${taskId}` : null
    const [runtimeTaskRouteLoadSettledKey, setRuntimeTaskRouteLoadSettledKey] = useState<string | null>(null)
    const [runtimeTaskRoutePostPaintReadyKey, setRuntimeTaskRoutePostPaintReadyKey] = useState<string | null>(null)
    const [runtimeTaskRouteCheapShellInitializedKey, setRuntimeTaskRouteCheapShellInitializedKey] = useState<string | null>(null)
    const canRenderRuntimeTaskRouteWhileInitializing = Boolean(
        workspaceId &&
            taskId &&
            productRuntimeOwnsTaskRoute &&
            (codeStore.hasProductTaskModelSource(taskId) || codeStore.canUseRuntimeProductTaskRouteModelSource())
    )
    const deferAppShellInitForRuntimeTaskRead =
        runtimeTaskRouteLoadKey !== null && runtimeTaskRouteLoadSettledKey !== runtimeTaskRouteLoadKey
    const deferAppShellInitForRuntimeTaskPaint =
        runtimeTaskRouteLoadKey !== null &&
        runtimeTaskRouteLoadSettledKey === runtimeTaskRouteLoadKey &&
        runtimeTaskRoutePostPaintReadyKey !== runtimeTaskRouteLoadKey
    const deferAppShellInitForRuntimeTask = deferAppShellInitForRuntimeTaskRead || deferAppShellInitForRuntimeTaskPaint
    const initializeOnlyCheapShellForRuntimeTask =
        runtimeTaskRouteLoadKey !== null &&
        productRuntimeOwnsTaskRoute &&
        runtimeTaskRouteLoadSettledKey === runtimeTaskRouteLoadKey &&
        runtimeTaskRoutePostPaintReadyKey === runtimeTaskRouteLoadKey &&
        runtimeTaskRouteCheapShellInitializedKey !== runtimeTaskRouteLoadKey
    const keepBroadAppShellInitDeferredForRuntimeTask =
        runtimeTaskRouteLoadKey !== null &&
        productRuntimeOwnsTaskRoute &&
        runtimeTaskRouteCheapShellInitializedKey === runtimeTaskRouteLoadKey

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

    // Legacy task lists use a loaded marker. Runtime/Core task routes render from product DTOs instead.
    useEffect(() => {
        if (!workspaceId || productRuntimeOwnsTaskRoute) return
        codeStore.tasks.ensureTasksLoaded(workspaceId)
    }, [workspaceId, productRuntimeOwnsTaskRoute, codeStore.tasks])

    // Load TaskStore when taskId changes
    useEffect(() => {
        if (!workspaceId || !taskId) return
        if (!hasInitialized && !productRuntimeOwnsTaskRoute) return

        const loadTask = async () => {
            const useRuntimeProductTaskRoute = codeStore.shouldUseRuntimeProductTaskRoute()
            const loadMode = useRuntimeProductTaskRoute ? "runtime-product" : "legacy"
            const taskLoadKey = `${loadMode}\0${workspaceId}\0${taskId}`
            if (lastTaskLoadKeyRef.current === taskLoadKey) return
            lastTaskLoadKeyRef.current = taskLoadKey

            let loadedThroughRuntimeProduct = false
            try {
                if (useRuntimeProductTaskRoute) {
                    loadedThroughRuntimeProduct = true
                    await codeStore.loadRuntimeProductTaskForRoute(workspaceId, taskId)
                    return
                }
                await codeStore.getTaskStore(workspaceId, taskId)
            } catch (err) {
                if (!loadedThroughRuntimeProduct && lastTaskLoadKeyRef.current === taskLoadKey) lastTaskLoadKeyRef.current = null
                console.error("[CodeLayout] Failed to load task:", err)
            } finally {
                if (loadedThroughRuntimeProduct && lastTaskLoadKeyRef.current === taskLoadKey) {
                    setRuntimeTaskRouteLoadSettledKey(taskLoadKey)
                }
            }
        }

        void loadTask()
    }, [workspaceId, taskId, hasInitialized, productRuntimeOwnsTaskRoute, codeStore, codeStore.runtimeProductStoreStatus])

    // Initialize route shell state, repos, capabilities, and platform info as needed.
    // Keep this after the task-route effect so direct Core task URLs start their lightweight task read first.
    useEffect(() => {
        if (deferAppShellInitForRuntimeTask) return
        if (keepBroadAppShellInitDeferredForRuntimeTask) return
        if (codeStore.storeInitialized) {
            setHasInitialized(true)
            return
        }

        let cancelled = false
        const init = async () => {
            // Initialize independent app-shell reads together so cold task opens are not serialized behind startup probes.
            try {
                if (initializeOnlyCheapShellForRuntimeTask) {
                    try {
                        await codeStore.initializeRuntimeTaskRouteShell()
                    } finally {
                        if (!cancelled) setRuntimeTaskRouteCheapShellInitializedKey(runtimeTaskRouteLoadKey)
                    }
                    return
                }

                const runtimeOwnsProductState = codeStore.shouldUseRuntimeProductAPI() || codeStore.usesCoreOwnedProductRuntime()
                const initializeProductState = runtimeOwnsProductState
                    ? codeStore.initializeStores()
                    : productRuntimeOwnsTaskRoute
                      ? codeStore.initializeRuntimeTaskRouteShell()
                      : codeStore.repos.loadRepos()
                await Promise.all([initCodeModuleCapabilities(), fetchPlatformInfo(), initializeProductState])
            } catch (err) {
                console.warn("[CodeLayout] Failed to initialize app shell:", err)
            } finally {
                if (!cancelled) setHasInitialized(true)
            }
        }
        void init()
        return () => {
            cancelled = true
        }
    }, [
        codeStore,
        codeStore.storeInitialized,
        deferAppShellInitForRuntimeTask,
        initializeOnlyCheapShellForRuntimeTask,
        keepBroadAppShellInitDeferredForRuntimeTask,
        productRuntimeOwnsTaskRoute,
        runtimeTaskRouteLoadKey,
    ])

    useEffect(() => {
        if (runtimeTaskRouteLoadKey === null || runtimeTaskRouteLoadSettledKey !== runtimeTaskRouteLoadKey) return
        if (runtimeTaskRoutePostPaintReadyKey === runtimeTaskRouteLoadKey) return
        return scheduleAfterNextPaint(() => {
            setRuntimeTaskRoutePostPaintReadyKey(runtimeTaskRouteLoadKey)
        })
    }, [runtimeTaskRouteLoadKey, runtimeTaskRouteLoadSettledKey, runtimeTaskRoutePostPaintReadyKey])

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

    const waitingForInitialRepoLoad = !codeStore.storeInitialized && codeStore.repos.reposLoading && !canRenderRuntimeTaskRouteWhileInitializing
    const waitingForInitialTaskList = !codeStore.storeInitialized && !tasksLoaded && !canRenderRuntimeTaskRouteWhileInitializing

    // Show loading state only for the initial store/task-list load. Background repo refreshes must not blank initialized task routes.
    if ((!hasInitialized && !canRenderRuntimeTaskRouteWhileInitializing) || waitingForInitialRepoLoad || waitingForInitialTaskList) {
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
