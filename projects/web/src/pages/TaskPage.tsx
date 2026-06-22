import cx from "classnames"
import { observer } from "mobx-react"
import { type ReactNode, useCallback, useEffect } from "react"
import { useHotkeys } from "react-hotkeys-hook"
import { EnvironmentSetupView } from "../components/EnvironmentSetupView"
import { EventLog } from "../components/EventLog"
import { ImageDropOverlay } from "../components/ImageDropOverlay"
import { InputBar } from "../components/InputBar"
import { TRAY_SHORTCUTS, getTrayConfig, matchShortcutToTray } from "../components/tray"
import { ShortcutBadge } from "../components/ui"
import { ScrollArea } from "../components/ui/ScrollArea"
import { Z_INDEX } from "../constants"
import { useImageDropZone } from "../hooks/useImageDropZone"
import { useShortcutHintsVisible } from "../hooks/useShortcutHintsVisible"
import { OPENADE_METHOD, type OpenADEMethod } from "../../../openade-client/src"
import { useTaskThreadScroll } from "../shell/task/useTaskThreadScroll"
import type { TaskModel } from "../store/TaskModel"
import { useCodeStore } from "../store/context"
import type { ImagePersistencePayload } from "../utils/imageAttachment"
import { isEventFromTerminal } from "../utils/keyboardShortcuts"

const TASK_OPEN_GIT_REFRESH_DELAY_MS = 500

function scheduleTaskGitRefresh(refresh: () => void): () => void {
    let timeoutId: number | null = window.setTimeout(() => {
        timeoutId = null
        refresh()
    }, TASK_OPEN_GIT_REFRESH_DELAY_MS)

    return () => {
        if (timeoutId !== null) window.clearTimeout(timeoutId)
    }
}

function InputWrapper({ trayOpen, onClose, children }: { trayOpen: boolean; onClose: () => void; children: ReactNode }) {
    return (
        <>
            <div className={cx("absolute inset-0 transition-all duration-150", trayOpen ? "brightness-50 blur-sm" : "")}>{children}</div>
            {trayOpen && <div className="absolute inset-0" style={{ zIndex: Z_INDEX.INPUT_BAR_TRAY - 1 }} onClick={onClose} />}
        </>
    )
}

interface TaskPageProps {
    workspaceId: string
    taskId: string
    taskModel: TaskModel
}

export const TaskPage = observer(({ workspaceId, taskId, taskModel }: TaskPageProps) => {
    const codeStore = useCodeStore()
    const productRuntimeOwnsTaskRoute = codeStore.shouldUseRuntimeProductTaskRoute()

    return (
        <TaskPageContent
            workspaceId={workspaceId}
            taskId={taskId}
            taskModel={taskModel}
            productRuntimeOwnsTaskRoute={productRuntimeOwnsTaskRoute}
        />
    )
})

interface TaskPageContentProps extends TaskPageProps {
    productRuntimeOwnsTaskRoute: boolean
}

const TaskPageContent = observer(({ workspaceId, taskId, taskModel, productRuntimeOwnsTaskRoute }: TaskPageContentProps) => {
    const codeStore = useCodeStore()
    const showKeyboardHints = useShortcutHintsVisible()
    const { input, tray } = taskModel
    const rawTask = codeStore.tasks.getTask(taskId)
    const events = rawTask?.events ?? []
    const canPersistTaskViewed = codeStore.canUseProductMethod(OPENADE_METHOD.taskMetadataUpdate)
    const canReadTaskDetails = codeStore.canUseProductMethod(OPENADE_METHOD.taskRead)
    const canReadMcpServers = !productRuntimeOwnsTaskRoute || codeStore.canUseProductMethod(OPENADE_METHOD.settingsMcpServersRead)
    const canUseFileMentions = productRuntimeOwnsTaskRoute ? codeStore.canUseProductMethod(OPENADE_METHOD.projectFilesFuzzySearch) : true
    const canUseSlashCommands = productRuntimeOwnsTaskRoute ? codeStore.canUseProductMethod(OPENADE_METHOD.projectSdkCapabilitiesRead) : true
    const canResolveSmartEditorWorkingDir = productRuntimeOwnsTaskRoute ? canUseFileMentions || canUseSlashCommands : true
    const { viewportRef: scrollViewportRef } = useTaskThreadScroll({
        changeKey: `${taskId}:${events.length}`,
        resetKey: taskId,
        mode: "always",
    })

    const scrollByPage = useCallback((direction: 1 | -1) => {
        const viewport = scrollViewportRef.current
        if (!viewport) return

        viewport.scrollBy({
            top: direction * viewport.clientHeight * 0.8,
            behavior: "smooth",
        })
    }, [])
    const canUseTaskRouteMethodAfterConnect = useCallback(
        async (method: OpenADEMethod): Promise<boolean> => {
            if (codeStore.usesCoreOwnedProductRuntime()) return codeStore.canUseProductMethodAfterConnect(method)
            return codeStore.canUseProductMethod(method)
        },
        [codeStore]
    )

    // Tray keyboard shortcuts - single handler that dispatches based on key
    useHotkeys(
        TRAY_SHORTCUTS,
        (event) => {
            const trayType = matchShortcutToTray(event)
            if (trayType) {
                const config = getTrayConfig(trayType)
                if (config?.isVisible && !config.isVisible(tray)) return
                tray.toggle(trayType)
            }
        },
        {
            preventDefault: true,
            enableOnContentEditable: true,
            enableOnFormTags: true,
            ignoreEventWhen: isEventFromTerminal,
        }
    )
    useEffect(() => {
        const handleScrollShortcut = (event: KeyboardEvent) => {
            const direction = event.code === "BracketLeft" ? -1 : event.code === "BracketRight" ? 1 : null
            if (direction === null || !event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || isEventFromTerminal(event)) return

            event.preventDefault()
            scrollByPage(direction)
        }

        window.addEventListener("keydown", handleScrollShortcut, true)
        return () => window.removeEventListener("keydown", handleScrollShortcut, true)
    }, [scrollByPage])
    useHotkeys("escape", () => tray.close(), {
        enabled: tray.isOpen,
        enableOnContentEditable: true,
        enableOnFormTags: true,
        ignoreEventWhen: isEventFromTerminal,
    })

    // Get SmartEditorManager for this task
    const editorManager = codeStore.smartEditors.getManager(`task-${taskId}`, workspaceId)

    // Mark task as viewed when navigating to it
    useEffect(() => {
        if (productRuntimeOwnsTaskRoute) {
            codeStore.tasks.markTaskViewed(taskId, { defer: true })
            return
        }

        if (canPersistTaskViewed) codeStore.tasks.markTaskViewed(taskId, { defer: false })
    }, [taskId, productRuntimeOwnsTaskRoute, canPersistTaskViewed, codeStore.tasks])

    // Legacy path keeps the existing eager status refresh; runtime/Core sessions keep task open on task DTOs only.
    useEffect(() => {
        if (productRuntimeOwnsTaskRoute) return
        return scheduleTaskGitRefresh(() => {
            void taskModel.refreshGitState()
        })
    }, [taskModel, productRuntimeOwnsTaskRoute])

    useEffect(() => {
        if (productRuntimeOwnsTaskRoute) return
        if (taskModel.needsEnvironmentSetup) return

        let cancelled = false
        void taskModel
            .loadEnvironment()
            .then((environment) => {
                if (cancelled || !environment?.taskWorkingDir) return
                taskModel.fileBrowser.setWorkingDir(environment.taskWorkingDir)
                taskModel.contentSearch.setWorkingDir(environment.taskWorkingDir)
            })
            .catch((err) => {
                if (!cancelled) console.warn("[TaskPage] Failed to load task environment:", err)
            })

        return () => {
            cancelled = true
        }
    }, [taskModel, taskModel.needsEnvironmentSetup, productRuntimeOwnsTaskRoute])

    // Legacy path refreshes git on focus. Runtime/Core sessions refresh from explicit tray/user actions.
    useEffect(() => {
        if (productRuntimeOwnsTaskRoute) return
        let cancelScheduledRefresh: (() => void) | null = null
        const handleFocus = () => {
            cancelScheduledRefresh?.()
            cancelScheduledRefresh = scheduleTaskGitRefresh(() => {
                void taskModel.refreshGitState()
                cancelScheduledRefresh = null
            })
        }
        window.addEventListener("focus", handleFocus)
        return () => {
            window.removeEventListener("focus", handleFocus)
            cancelScheduledRefresh?.()
        }
    }, [taskModel, productRuntimeOwnsTaskRoute])

    // Poll git status every 20s while task is working
    useEffect(() => {
        if (productRuntimeOwnsTaskRoute) return
        if (!taskModel.isWorking) return

        const interval = setInterval(() => {
            taskModel.refreshGitState()
        }, 20_000)

        return () => clearInterval(interval)
    }, [taskModel, taskModel.isWorking, productRuntimeOwnsTaskRoute])

    // Update file browser and content search when the task's working directory becomes available
    // (may load late for worktree tasks during environment setup)
    const taskWorkingDir = taskModel.environment?.taskWorkingDir
    const taskWorkingDirHint = taskModel.taskWorkingDirHint
    const resolveTaskWorkingDir = useCallback(() => taskModel.ensureTaskWorkingDirHint(), [taskModel])
    const resolveSdkCapabilities = useCallback(() => taskModel.sdkCapabilities, [taskModel])
    useEffect(() => {
        if (productRuntimeOwnsTaskRoute) return
        if (taskWorkingDir) {
            taskModel.fileBrowser.setWorkingDir(taskWorkingDir)
            taskModel.contentSearch.setWorkingDir(taskWorkingDir)
        }
    }, [taskWorkingDir, taskModel, productRuntimeOwnsTaskRoute])

    const handleSetupComplete = useCallback(() => {
        if (productRuntimeOwnsTaskRoute) return
        taskModel.refreshGitState()
    }, [taskModel, productRuntimeOwnsTaskRoute])

    const handleRequestFullHistory = useCallback(() => {
        if (!productRuntimeOwnsTaskRoute) return
        void (async () => {
            if (!(await canUseTaskRouteMethodAfterConnect(OPENADE_METHOD.taskRead))) return
            await codeStore.loadRuntimeProductTask(workspaceId, taskId, { hydrateSessionEvents: true })
        })().catch((err) => {
            console.warn("[TaskPage] Failed to hydrate task history:", err)
        })
    }, [codeStore, workspaceId, taskId, productRuntimeOwnsTaskRoute, canUseTaskRouteMethodAfterConnect])
    const requestFullHistory = productRuntimeOwnsTaskRoute && canReadTaskDetails ? handleRequestFullHistory : undefined

    const canAttachImages = input.canAttachImages
    const persistImage = useCallback((payload: ImagePersistencePayload) => input.persistImage(payload), [input])

    // Page-level drop zone for images
    const { isDragOver, dragHandlers } = useImageDropZone(canAttachImages ? editorManager : null, persistImage)

    // Show environment setup UI if needed
    if (taskModel.needsEnvironmentSetup) {
        return <EnvironmentSetupView taskModel={taskModel} onComplete={handleSetupComplete} />
    }

    return (
        <div className="h-full relative" data-openade-surface="desktop-classic-task" {...dragHandlers}>
            {isDragOver && <ImageDropOverlay />}
            <InputWrapper trayOpen={tray.isOpen} onClose={() => tray.close()}>
                <ScrollArea viewportRef={scrollViewportRef} viewportClassName="pb-56">
                    <EventLog taskId={taskId} events={events} isLoading={false} onRequestFullHistory={requestFullHistory} />
                </ScrollArea>
            </InputWrapper>
            {showKeyboardHints && (
                <div className="absolute right-4 top-1/2 flex -translate-y-1/2 flex-col gap-1" style={{ zIndex: Z_INDEX.INPUT_BAR - 1 }} aria-hidden>
                    <ShortcutBadge label="[" visible variant="floating" />
                    <ShortcutBadge label="]" visible variant="floating" />
                </div>
            )}
            <InputBar
                input={input}
                editorManager={editorManager}
                tray={tray}
                gitStatus={taskModel.gitStatus}
                pullRequest={taskModel.pullRequest}
                fileMentionsDir={canUseFileMentions ? taskWorkingDirHint : null}
                slashCommandsDir={canUseSlashCommands ? taskWorkingDirHint : null}
                resolveWorkingDir={canResolveSmartEditorWorkingDir ? resolveTaskWorkingDir : undefined}
                resolveSdkCapabilities={canUseSlashCommands ? resolveSdkCapabilities : undefined}
                unsubmittedComments={codeStore.comments.getUnsubmittedComments(taskId)}
                selectedModel={taskModel.model}
                onModelChange={(m) => taskModel.setModel(m)}
                thinking={taskModel.thinking}
                onThinkingChange={(t) => taskModel.setThinking(t)}
                fastMode={taskModel.fastMode}
                onFastModeChange={(enabled) => taskModel.setFastMode(enabled)}
                harnessId={taskModel.harnessId}
                allowHarnessSwitch={false}
                hideTray={codeStore.personalSettingsStore?.settings.current.devHideTray}
                enabledMcpServerIds={canReadMcpServers ? taskModel.enabledMcpServerIds : undefined}
                onMcpServerIdsChange={canReadMcpServers ? (ids) => taskModel.setEnabledMcpServerIds(ids) : undefined}
                autoFocusKey={taskId}
            />
        </div>
    )
})
