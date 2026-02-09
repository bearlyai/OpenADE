import cx from "classnames"
import { observer } from "mobx-react"
import { type ReactNode, useCallback, useEffect, useRef } from "react"
import { useHotkeys } from "react-hotkeys-hook"
import { EnvironmentSetupView } from "../components/EnvironmentSetupView"
import { EventLog } from "../components/EventLog"
import { InputBar } from "../components/InputBar"
import { TRAY_SHORTCUTS, getTrayConfig, matchShortcutToTray } from "../components/tray"
import { ScrollArea } from "../components/ui/ScrollArea"
import { Z_INDEX } from "../constants"
import type { TaskModel } from "../store/TaskModel"
import { useCodeStore } from "../store/context"

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

    // Initialize file browser and content search with the task's working directory
    // For worktree tasks this is the worktree dir, for head tasks it's repo.path
    const taskWorkingDir = taskModel.environment?.taskWorkingDir
    useEffect(() => {
        if (taskWorkingDir) {
            codeStore.fileBrowser.setWorkingDir(taskWorkingDir)
            codeStore.contentSearch.setWorkingDir(taskWorkingDir)
        }
    }, [taskWorkingDir])

    const handleSetupComplete = useCallback(() => {
        taskModel.refreshGitState()
    }, [taskModel])

    // Show environment setup UI if needed
    if (taskModel.needsEnvironmentSetup) {
        return <EnvironmentSetupView taskModel={taskModel} onComplete={handleSetupComplete} />
    }

    return (
        <div className="h-full relative">
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
                fileMentionsDir={taskWorkingDir ?? null}
                slashCommandsDir={taskWorkingDir ?? null}
                unsubmittedComments={codeStore.comments.getUnsubmittedComments(taskId)}
                selectedModel={codeStore.model}
                onModelChange={(m) => codeStore.setModel(m)}
                hideTray={codeStore.personalSettingsStore?.settings.current.devHideTray}
            />
        </div>
    )
})
