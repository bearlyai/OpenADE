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
import { useTaskThreadScroll } from "../shell/task/useTaskThreadScroll"
import type { TaskModel } from "../store/TaskModel"
import { useCodeStore } from "../store/context"
import { isEventFromTerminal } from "../utils/keyboardShortcuts"

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
    const showKeyboardHints = useShortcutHintsVisible()
    const { input, tray } = taskModel
    const rawTask = codeStore.tasks.getTask(taskId)
    const events = rawTask?.events ?? []
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
        codeStore.tasks.markTaskViewed(taskId)
    }, [taskId])

    // Initial load of git state
    useEffect(() => {
        taskModel.refreshGitState()
    }, [taskModel])

    // Refresh git state on window focus
    useEffect(() => {
        const handleFocus = () => taskModel.refreshGitState()
        window.addEventListener("focus", handleFocus)
        return () => window.removeEventListener("focus", handleFocus)
    }, [taskModel])

    // Poll git status every 20s while task is working
    useEffect(() => {
        if (!taskModel.isWorking) return

        const interval = setInterval(() => {
            taskModel.refreshGitState()
        }, 20_000)

        return () => clearInterval(interval)
    }, [taskModel, taskModel.isWorking])

    // Update file browser and content search when the task's working directory becomes available
    // (may load late for worktree tasks during environment setup)
    const taskWorkingDir = taskModel.environment?.taskWorkingDir
    useEffect(() => {
        if (taskWorkingDir) {
            taskModel.fileBrowser.setWorkingDir(taskWorkingDir)
            taskModel.contentSearch.setWorkingDir(taskWorkingDir)
        }
    }, [taskWorkingDir, taskModel])

    const handleSetupComplete = useCallback(() => {
        taskModel.refreshGitState()
    }, [taskModel])

    // Page-level drop zone for images
    const { isDragOver, dragHandlers } = useImageDropZone(editorManager)

    // Show environment setup UI if needed
    if (taskModel.needsEnvironmentSetup) {
        return <EnvironmentSetupView taskModel={taskModel} onComplete={handleSetupComplete} />
    }

    return (
        <div className="h-full relative" data-openade-surface="desktop-classic-task" {...dragHandlers}>
            {isDragOver && <ImageDropOverlay />}
            <InputWrapper trayOpen={tray.isOpen} onClose={() => tray.close()}>
                <ScrollArea viewportRef={scrollViewportRef} viewportClassName="pb-56">
                    <EventLog taskId={taskId} events={events} />
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
                fileMentionsDir={taskWorkingDir ?? null}
                slashCommandsDir={taskWorkingDir ?? null}
                sdkCapabilities={taskModel.sdkCapabilities}
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
                enabledMcpServerIds={taskModel.enabledMcpServerIds}
                onMcpServerIdsChange={(ids) => taskModel.setEnabledMcpServerIds(ids)}
                autoFocusKey={taskId}
            />
        </div>
    )
})
