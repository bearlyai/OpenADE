import cx from "classnames"
import { Paperclip } from "lucide-react"
import { observer } from "mobx-react"
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react"
import { useHotkeys } from "react-hotkeys-hook"
import { EnvironmentSetupView } from "../components/EnvironmentSetupView"
import { EventLog } from "../components/EventLog"
import { InputBar } from "../components/InputBar"
import { TRAY_SHORTCUTS, getTrayConfig, matchShortcutToTray } from "../components/tray"
import { ScrollArea } from "../components/ui/ScrollArea"
import { Z_INDEX } from "../constants"
import type { TaskModel } from "../store/TaskModel"
import { useCodeStore } from "../store/context"
import { processImageBlob } from "../utils/imageAttachment"

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
    const scrollViewportRef = useRef<HTMLDivElement>(null)
    const { input, tray } = taskModel

    const scrollToBottom = useCallback(() => {
        requestAnimationFrame(() => {
            if (scrollViewportRef.current) {
                scrollViewportRef.current.scrollTop = scrollViewportRef.current.scrollHeight
            }
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
        { preventDefault: true }
    )
    useHotkeys("escape", () => tray.close(), { enabled: tray.isOpen })

    const rawTask = codeStore.tasks.getTask(taskId)
    const events = rawTask?.events ?? []

    // Get SmartEditorManager for this task
    const editorManager = codeStore.smartEditors.getManager(`task-${taskId}`, workspaceId)

    // Mark task as viewed when navigating to it
    useEffect(() => {
        codeStore.tasks.markTaskViewed(taskId)
    }, [taskId])

    // Scroll to bottom on initial load
    useEffect(() => {
        scrollToBottom()
    }, [taskId, scrollToBottom])

    // Scroll to bottom when new events are added
    useEffect(() => {
        if (events.length > 0) {
            scrollToBottom()
        }
    }, [events.length, scrollToBottom])

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
    const [isDragOver, setIsDragOver] = useState(false)
    const dragCounter = useRef(0)

    const handleDragEnter = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        dragCounter.current++
        if (e.dataTransfer?.types.includes("Files")) {
            setIsDragOver(true)
        }
    }, [])

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault()
    }, [])

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        dragCounter.current--
        if (dragCounter.current <= 0) {
            dragCounter.current = 0
            setIsDragOver(false)
        }
    }, [])

    const handleDrop = useCallback(
        (e: React.DragEvent) => {
            e.preventDefault()
            dragCounter.current = 0
            setIsDragOver(false)
            const files = e.dataTransfer?.files
            if (!files) return
            for (const file of Array.from(files)) {
                if (file.type.startsWith("image/")) {
                    processImageBlob(file)
                        .then(({ attachment, dataUrl }) => editorManager.addImage(attachment, dataUrl))
                        .catch((err) => console.error("[TaskPage] Failed to process dropped image:", err))
                }
            }
        },
        [editorManager]
    )

    // Show environment setup UI if needed
    if (taskModel.needsEnvironmentSetup) {
        return <EnvironmentSetupView taskModel={taskModel} onComplete={handleSetupComplete} />
    }

    return (
        <div className="h-full relative" onDragEnter={handleDragEnter} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
            {isDragOver && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm pointer-events-none">
                    <div className="rounded-2xl border-2 border-dashed border-primary bg-base-100/90 px-12 py-10 text-center">
                        <Paperclip className="mx-auto mb-3 h-10 w-10 text-primary" />
                        <p className="text-lg font-medium text-base-content">Drop images here</p>
                        <p className="text-sm text-muted mt-1">PNG, JPG, GIF, WebP</p>
                    </div>
                </div>
            )}
            <InputWrapper trayOpen={tray.isOpen} onClose={() => tray.close()}>
                <ScrollArea viewportRef={scrollViewportRef} viewportClassName="pb-56">
                    <EventLog taskId={taskId} events={events} />
                </ScrollArea>
            </InputWrapper>
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
                hideTray={codeStore.personalSettingsStore?.settings.current.devHideTray}
            />
        </div>
    )
})
