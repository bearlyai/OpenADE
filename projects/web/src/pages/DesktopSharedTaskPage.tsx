import { observer } from "mobx-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { useHotkeys } from "react-hotkeys-hook"
import type {
    OpenADETaskChangesReadResult,
    OpenADETaskDiffReadResult,
    OpenADETaskGitChangedFile,
    OpenADETaskGitLogResult,
    OpenADETurnStartRequest,
} from "../../../openade-module/src"
import { EnvironmentSetupView } from "../components/EnvironmentSetupView"
import { InputBar } from "../components/InputBar"
import { TRAY_SHORTCUTS, getTrayConfig, matchShortcutToTray } from "../components/tray"
import { useImageDropZone } from "../hooks/useImageDropZone"
import { ACTION_PROMPTS } from "../prompts/prompts"
import { localOpenADEClient } from "../runtime/localOpenADEClient"
import { useCodeNavigate } from "../routing"
import { DesktopTaskShell } from "../shell/DesktopTaskShell"
import type { TaskImageLoader } from "../shell/task/TaskEventThread"
import type { OpenADETaskCommentView, TaskReviewType } from "../shell/task/TaskProductPanel"
import type { TaskCommandType } from "../shell/task/taskCommands"
import type { TaskImageAttachment } from "../shell/task/taskEventPresentation"
import { useCodeStore } from "../store/context"
import { isEventFromTerminal } from "../utils/keyboardShortcuts"

interface DesktopSharedTaskPageProps {
    workspaceId: string
    taskId: string
}

function desktopClientRequestId(prefix: string): string {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `${prefix}-${crypto.randomUUID()}`
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function desktopErrorMessage(err: unknown, fallback: string): string {
    if (err instanceof Error && err.message.trim()) return err.message
    return fallback
}

function imageMediaType(image: TaskImageAttachment, value?: string): string {
    if (value?.startsWith("image/")) return value
    if (image.mediaType?.startsWith("image/")) return image.mediaType
    return image.ext === "jpg" ? "image/jpeg" : `image/${image.ext}`
}

type RichTurnOptions = Pick<OpenADETurnStartRequest, "appendSystemPrompt" | "includeComments" | "label">

export const DesktopSharedTaskPage = observer(({ workspaceId, taskId }: DesktopSharedTaskPageProps) => {
    const codeStore = useCodeStore()
    const navigate = useCodeNavigate()
    const submitLockRef = useRef(false)
    const task = codeStore.getCachedRuntimeProductOpenADETask(taskId)
    const preview = codeStore.getRuntimeProductTaskPreviewDto(workspaceId, taskId)
    const taskModel = codeStore.tasks.getTaskModel(taskId)
    const editorManager = codeStore.smartEditors.getManager(`task-${taskId}`, workspaceId)
    const isRunning = codeStore.isTaskRunning(taskId) || Boolean(codeStore.runtimeProductSnapshot?.workingTaskIds.includes(taskId))
    const isOnline = codeStore.runtimeProductStoreStatus === "ready"
    const taskWorkingDir = taskModel?.environment?.taskWorkingDir ?? null
    const { isDragOver, dragHandlers } = useImageDropZone(editorManager)

    const [input, setInput] = useState("")
    const [commandType, setCommandType] = useState<TaskCommandType>("do")
    const [titleDraft, setTitleDraft] = useState(task?.title ?? preview?.title ?? "")
    const [commentDraft, setCommentDraft] = useState("")
    const [editingCommentId, setEditingCommentId] = useState<string | null>(null)
    const [editingCommentDraft, setEditingCommentDraft] = useState("")
    const [reviewInstructions, setReviewInstructions] = useState("")
    const [taskChanges, setTaskChanges] = useState<OpenADETaskChangesReadResult | null>(null)
    const [taskGitLog, setTaskGitLog] = useState<OpenADETaskGitLogResult | null>(null)
    const [taskChangesLoading, setTaskChangesLoading] = useState(false)
    const [taskDiff, setTaskDiff] = useState<OpenADETaskDiffReadResult | null>(null)
    const [taskDiffActionPath, setTaskDiffActionPath] = useState<string | null>(null)
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [notice, setNotice] = useState<string | null>(null)

    const refreshTask = useCallback(
        async (options: { hydrateSessionEvents?: boolean } = { hydrateSessionEvents: false }) => {
            await Promise.all([codeStore.refreshRuntimeProductSnapshot(), codeStore.refreshRuntimeProductTaskForTaskId(taskId, options)])
        },
        [codeStore, taskId]
    )

    const runSubmission = useCallback(async (work: () => Promise<void>, fallback: string) => {
        if (submitLockRef.current) return
        submitLockRef.current = true
        setIsSubmitting(true)
        setError(null)
        setNotice(null)
        try {
            await work()
        } catch (err) {
            setError(desktopErrorMessage(err, fallback))
        } finally {
            submitLockRef.current = false
            setIsSubmitting(false)
        }
    }, [])

    const refreshTaskGit = useCallback(async () => {
        setTaskChangesLoading(true)
        try {
            const [changes, gitLog] = await Promise.all([
                localOpenADEClient.readTaskChanges({ repoId: workspaceId, taskId }),
                localOpenADEClient.readTaskGitLog({ repoId: workspaceId, taskId, limit: 5 }),
            ])
            setTaskChanges(changes)
            setTaskGitLog(gitLog)
        } finally {
            setTaskChangesLoading(false)
        }
    }, [workspaceId, taskId])

    useHotkeys(
        TRAY_SHORTCUTS,
        (event) => {
            const tray = taskModel?.tray
            if (!tray) return
            const trayType = matchShortcutToTray(event)
            if (!trayType) return
            const config = getTrayConfig(trayType)
            if (config?.isVisible && !config.isVisible(tray)) return
            tray.toggle(trayType)
        },
        {
            enabled: Boolean(taskModel),
            preventDefault: true,
            enableOnContentEditable: true,
            enableOnFormTags: true,
            ignoreEventWhen: isEventFromTerminal,
        }
    )

    useHotkeys("escape", () => taskModel?.tray.close(), {
        enabled: taskModel?.tray.isOpen === true,
        enableOnContentEditable: true,
        enableOnFormTags: true,
        ignoreEventWhen: isEventFromTerminal,
    })

    useEffect(() => {
        void codeStore.refreshRuntimeProductTaskForTaskId(taskId, { hydrateSessionEvents: false }).catch((err) => {
            setError(desktopErrorMessage(err, "Unable to load task"))
        })
    }, [codeStore, taskId])

    useEffect(() => {
        void refreshTaskGit().catch((err) => {
            setTaskChanges(null)
            setTaskGitLog(null)
            setError(desktopErrorMessage(err, "Unable to load task changes"))
        })
    }, [refreshTaskGit])

    useEffect(() => {
        codeStore.tasks.markTaskViewed(taskId)
    }, [codeStore, taskId])

    useEffect(() => {
        if (!taskModel) return
        void taskModel.refreshGitState()
    }, [taskModel])

    useEffect(() => {
        if (!taskModel) return
        const handleFocus = () => taskModel.refreshGitState()
        window.addEventListener("focus", handleFocus)
        return () => window.removeEventListener("focus", handleFocus)
    }, [taskModel])

    useEffect(() => {
        if (!taskModel?.isWorking) return
        const interval = setInterval(() => {
            void taskModel.refreshGitState()
        }, 20_000)
        return () => clearInterval(interval)
    }, [taskModel, taskModel?.isWorking])

    useEffect(() => {
        if (!taskModel || !taskWorkingDir) return
        taskModel.fileBrowser.setWorkingDir(taskWorkingDir)
        taskModel.contentSearch.setWorkingDir(taskWorkingDir)
    }, [taskModel, taskWorkingDir])

    useEffect(() => {
        setTitleDraft(task?.title ?? preview?.title ?? "")
        setCommentDraft("")
        setEditingCommentId(null)
        setEditingCommentDraft("")
        setReviewInstructions("")
        setTaskDiff(null)
        setTaskDiffActionPath(null)
    }, [task?.id, preview?.id])

    const loadImage = useCallback<TaskImageLoader>(
        async (image) => {
            const result = await localOpenADEClient.readTaskImage({ repoId: workspaceId, taskId, imageId: image.id, ext: image.ext })
            if (!result.data) return null
            return `data:${imageMediaType(image, result.mediaType)};base64,${result.data}`
        },
        [workspaceId, taskId]
    )

    const handleSaveTitle = () => {
        const title = titleDraft.trim()
        if (!title || title === task?.title) return
        void runSubmission(async () => {
            await localOpenADEClient.updateTaskMetadata({ taskId, title, clientRequestId: desktopClientRequestId("desktop-task-title") })
            await refreshTask()
        }, "Unable to update task title")
    }

    const handleToggleClosed = () => {
        void runSubmission(async () => {
            await localOpenADEClient.updateTaskMetadata({
                taskId,
                closed: !(task?.closed ?? preview?.closed ?? false),
                clientRequestId: desktopClientRequestId("desktop-task-closed"),
            })
            await refreshTask()
        }, "Unable to update task")
    }

    const handleDeleteTask = () => {
        if (!window.confirm("Delete this task?")) return
        void runSubmission(async () => {
            await localOpenADEClient.deleteTask({
                repoId: workspaceId,
                taskId,
                options: { deleteSnapshots: false, deleteImages: false, deleteSessions: false, deleteWorktrees: false },
                clientRequestId: desktopClientRequestId("desktop-task-delete"),
            })
            await codeStore.refreshRuntimeProductSnapshot()
            navigate.go("CodeWorkspace", { workspaceId })
        }, "Unable to delete task")
    }

    const handleCreateComment = () => {
        const content = commentDraft.trim()
        if (!content) return
        void runSubmission(async () => {
            await localOpenADEClient.createComment({
                taskId,
                content,
                source: { type: "desktop-shared-task-screen" },
                selectedText: { text: "", linesBefore: "", linesAfter: "" },
                author: codeStore.currentUser,
                clientRequestId: desktopClientRequestId("desktop-comment"),
            })
            setCommentDraft("")
            await refreshTask()
        }, "Unable to create comment")
    }

    const handleStartEditComment = (comment: OpenADETaskCommentView) => {
        setEditingCommentId(comment.id)
        setEditingCommentDraft(comment.content)
    }

    const handleSaveComment = (commentId: string) => {
        const content = editingCommentDraft.trim()
        if (!content) return
        void runSubmission(async () => {
            await localOpenADEClient.editComment({ taskId, commentId, content, clientRequestId: desktopClientRequestId("desktop-comment-edit") })
            setEditingCommentId(null)
            setEditingCommentDraft("")
            await refreshTask()
        }, "Unable to edit comment")
    }

    const handleDeleteComment = (commentId: string) => {
        void runSubmission(async () => {
            await localOpenADEClient.deleteComment({ taskId, commentId, clientRequestId: desktopClientRequestId("desktop-comment-delete") })
            if (editingCommentId === commentId) {
                setEditingCommentId(null)
                setEditingCommentDraft("")
            }
            await refreshTask()
        }, "Unable to delete comment")
    }

    const handleCancelQueuedTurn = (queuedTurnId: string) => {
        void runSubmission(async () => {
            await localOpenADEClient.cancelQueuedTurn({
                repoId: workspaceId,
                taskId,
                queuedTurnId,
                clientRequestId: desktopClientRequestId("desktop-queued-turn-cancel"),
            })
            await refreshTask()
        }, "Unable to cancel queued turn")
    }

    const handleStartReview = (reviewType: TaskReviewType) => {
        void runSubmission(async () => {
            const result = await localOpenADEClient.startReview({
                repoId: workspaceId,
                taskId,
                reviewType,
                harnessId: taskModel?.harnessId ?? codeStore.defaultHarnessId,
                modelId: taskModel?.model ?? codeStore.defaultModel,
                customInstructions: reviewInstructions.trim() || undefined,
                clientRequestId: desktopClientRequestId(`desktop-review-${reviewType}`),
            })
            setReviewInstructions("")
            await refreshTask()
            if (result.taskId !== taskId) navigate.go("CodeWorkspaceTask", { workspaceId, taskId: result.taskId })
        }, "Unable to start review")
    }

    const handleRefreshTaskGit = () => {
        setError(null)
        void refreshTaskGit().catch((err) => {
            setError(desktopErrorMessage(err, "Unable to refresh task changes"))
        })
    }

    const handleReadTaskDiff = (file: OpenADETaskGitChangedFile) => {
        setTaskDiffActionPath(file.path)
        setError(null)
        void localOpenADEClient
            .readTaskDiff({
                repoId: workspaceId,
                taskId,
                filePath: file.path,
                oldPath: file.oldPath,
                contextLines: 3,
                allowTruncation: true,
            })
            .then(setTaskDiff)
            .catch((err) => setError(desktopErrorMessage(err, "Unable to read task diff")))
            .finally(() => setTaskDiffActionPath(null))
    }

    const handleSend = () => {
        const submittedInput = input.trim()
        if (!submittedInput) return
        void runSubmission(async () => {
            const result = await localOpenADEClient.startTurn({
                repoId: workspaceId,
                type: commandType,
                input: submittedInput,
                inTaskId: task?.unavailableReason ? undefined : taskId,
                enabledMcpServerIds: taskModel?.enabledMcpServerIds,
                harnessId: taskModel?.harnessId ?? codeStore.defaultHarnessId,
                modelId: taskModel?.model ?? codeStore.defaultModel,
                thinking: taskModel?.thinking ?? codeStore.defaultThinking,
                fastMode: taskModel?.fastMode ?? codeStore.defaultFastMode,
                clientRequestId: desktopClientRequestId("desktop-turn"),
            })
            setInput("")
            await refreshTask({ hydrateSessionEvents: false })
            if (result.queued) setNotice("Queued. It will run after the current turn finishes.")
            if (result.taskId !== taskId) navigate.go("CodeWorkspaceTask", { workspaceId, taskId: result.taskId })
        }, "Run failed")
    }

    const handleAbort = () => {
        void runSubmission(async () => {
            await localOpenADEClient.interruptTurn(taskId, { clientRequestId: desktopClientRequestId("desktop-interrupt") })
            await refreshTask()
        }, "Unable to stop task")
    }

    const startRichEditorTurn = async ({
        type,
        userInput,
        images,
        options = {},
    }: {
        type: OpenADETurnStartRequest["type"]
        userInput: string
        images: OpenADETurnStartRequest["images"]
        options?: RichTurnOptions
    }) => {
        if (!taskModel) return
        const result = await localOpenADEClient.startTurn({
            repoId: workspaceId,
            type,
            input: userInput,
            images,
            inTaskId: task?.unavailableReason ? undefined : taskId,
            enabledMcpServerIds: taskModel.enabledMcpServerIds,
            harnessId: taskModel.harnessId,
            modelId: taskModel.model,
            thinking: taskModel.thinking,
            fastMode: taskModel.fastMode,
            clientRequestId: desktopClientRequestId(`desktop-rich-${type}`),
            ...options,
        })
        await refreshTask({ hydrateSessionEvents: false })
        if (result.queued) setNotice("Queued. It will run after the current turn finishes.")
        if (result.taskId !== taskId) navigate.go("CodeWorkspaceTask", { workspaceId, taskId: result.taskId })
    }

    const captureRichEditorInput = () => {
        const value = editorManager.value.trim()
        const images = [...editorManager.pendingImages]
        editorManager.clear()
        return { userInput: value, images }
    }

    const handleRichCommandExecute = async (commandId: string): Promise<boolean> => {
        if (!taskModel) return false

        const startCapturedTurn = async (type: OpenADETurnStartRequest["type"], options?: RichTurnOptions) => {
            const captured = captureRichEditorInput()
            await startRichEditorTurn({ type, userInput: captured.userInput, images: captured.images, options })
        }

        void runSubmission(async () => {
            if (commandId === "do") {
                await startCapturedTurn("do")
            } else if (commandId === "plan") {
                await startCapturedTurn("plan")
            } else if (commandId === "ask") {
                await startCapturedTurn("ask")
            } else if (commandId === "revise") {
                await startCapturedTurn("revise")
            } else if (commandId === "runPlan") {
                await startCapturedTurn("run_plan")
            } else if (commandId === "retry") {
                await startRichEditorTurn({ type: "do", userInput: ACTION_PROMPTS.retry, images: [], options: { label: "Retry", includeComments: false } })
            } else if (commandId === "review" || commandId === "reviewPlan") {
                const customInstructions = editorManager.value.trim()
                await localOpenADEClient.startReview({
                    repoId: workspaceId,
                    taskId,
                    reviewType: commandId === "reviewPlan" ? "plan" : "work",
                    harnessId: taskModel.harnessId,
                    modelId: taskModel.model,
                    customInstructions: customInstructions || undefined,
                    clientRequestId: desktopClientRequestId(`desktop-rich-${commandId}`),
                })
                editorManager.clear()
                await refreshTask()
            } else if (commandId === "stop") {
                await localOpenADEClient.interruptTurn(taskId, { clientRequestId: desktopClientRequestId("desktop-rich-stop") })
                await refreshTask()
            } else if (commandId === "interrupt") {
                const captured = captureRichEditorInput()
                await localOpenADEClient.interruptTurn(taskId, { clientRequestId: desktopClientRequestId("desktop-rich-interrupt") })
                await startRichEditorTurn({ type: "do", userInput: captured.userInput, images: captured.images })
            } else if (commandId === "cancelPlan") {
                const latestPlan = taskModel.getLatestPlanEvent()
                if (latestPlan) {
                    await localOpenADEClient.updateTaskMetadata({
                        taskId,
                        cancelledPlanEventId: latestPlan.id,
                        clientRequestId: desktopClientRequestId("desktop-rich-cancel-plan"),
                    })
                    await refreshTask()
                }
            } else if (commandId === "close" || commandId === "reopen") {
                await localOpenADEClient.updateTaskMetadata({
                    taskId,
                    closed: commandId === "close",
                    clientRequestId: desktopClientRequestId(`desktop-rich-${commandId}`),
                })
                await refreshTask()
            } else if (commandId === "repeat") {
                codeStore.repeat.start(taskId)
            } else if (commandId === "repeatStop") {
                codeStore.repeat.stop()
            } else if (commandId === "commitAndPush") {
                const captured = captureRichEditorInput()
                const branch = taskModel.gitStatus?.branch ?? "HEAD"
                await startRichEditorTurn({
                    type: "do",
                    userInput: ACTION_PROMPTS.commitAndPush(captured.userInput, taskModel.hasGhCli, branch),
                    images: captured.images,
                    options: { label: "Commit & Push", includeComments: false },
                })
            }
        }, "Unable to run command")

        return true
    }

    const handleSetupComplete = () => {
        void taskModel?.refreshGitState()
    }

    const richDesktopComposer = taskModel ? (
        <InputBar
            input={taskModel.input}
            editorManager={editorManager}
            tray={taskModel.tray}
            gitStatus={taskModel.gitStatus}
            pullRequest={taskModel.pullRequest}
            fileMentionsDir={taskWorkingDir}
            slashCommandsDir={taskWorkingDir}
            sdkCapabilities={taskModel.sdkCapabilities}
            unsubmittedComments={codeStore.comments.getUnsubmittedComments(taskId)}
            selectedModel={taskModel.model}
            onModelChange={(modelId) => taskModel.setModel(modelId)}
            thinking={taskModel.thinking}
            onThinkingChange={(level) => taskModel.setThinking(level)}
            fastMode={taskModel.fastMode}
            onFastModeChange={(enabled) => taskModel.setFastMode(enabled)}
            harnessId={taskModel.harnessId}
            allowHarnessSwitch={false}
            hideTray={codeStore.personalSettingsStore?.settings.current.devHideTray}
            enabledMcpServerIds={taskModel.enabledMcpServerIds}
            onMcpServerIdsChange={(serverIds) => taskModel.setEnabledMcpServerIds(serverIds)}
            onCommandExecute={handleRichCommandExecute}
            autoFocusKey={taskId}
        />
    ) : undefined

    if (taskModel?.needsEnvironmentSetup) {
        return <EnvironmentSetupView taskModel={taskModel} onComplete={handleSetupComplete} />
    }

    return (
        <DesktopTaskShell
            error={error}
            notice={notice}
            isDragOver={isDragOver}
            dragHandlers={dragHandlers}
            task={task}
            preview={preview}
            isRunning={isRunning}
            input={input}
            commandType={commandType}
            titleDraft={titleDraft}
            commentDraft={commentDraft}
            editingCommentId={editingCommentId}
            editingCommentDraft={editingCommentDraft}
            reviewInstructions={reviewInstructions}
            taskChanges={taskChanges}
            taskGitLog={taskGitLog}
            taskChangesLoading={taskChangesLoading}
            taskDiff={taskDiff}
            taskDiffActionPath={taskDiffActionPath}
            isLoading={!task}
            isSubmitting={isSubmitting}
            isOnline={isOnline}
            composer={richDesktopComposer}
            messageViewportClassName={richDesktopComposer ? "pb-56" : undefined}
            loadImage={loadImage}
            onInputChange={setInput}
            onCommandTypeChange={setCommandType}
            onTitleChange={setTitleDraft}
            onSaveTitle={handleSaveTitle}
            onToggleClosed={handleToggleClosed}
            onDeleteTask={handleDeleteTask}
            onCommentDraftChange={setCommentDraft}
            onCreateComment={handleCreateComment}
            onStartEditComment={handleStartEditComment}
            onEditingCommentDraftChange={setEditingCommentDraft}
            onSaveComment={handleSaveComment}
            onCancelEditComment={() => {
                setEditingCommentId(null)
                setEditingCommentDraft("")
            }}
            onDeleteComment={handleDeleteComment}
            onCancelQueuedTurn={handleCancelQueuedTurn}
            onReviewInstructionsChange={setReviewInstructions}
            onStartReview={handleStartReview}
            onRefreshTaskGit={handleRefreshTaskGit}
            onReadTaskDiff={handleReadTaskDiff}
            onSend={handleSend}
            onAbort={handleAbort}
        />
    )
})
