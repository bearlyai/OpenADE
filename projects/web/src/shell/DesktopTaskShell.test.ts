import { act, createElement, type ReactElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { OpenADETask } from "../../../openade-module/src"
import { DesktopTaskShell } from "./DesktopTaskShell"
import type { OpenADETaskCommentView } from "./task/TaskProductPanel"
import type { TaskCommandType } from "./task/taskCommands"

const task: OpenADETask = {
    id: "task-1",
    repoId: "repo-1",
    slug: "task-1",
    title: "Desktop shared task",
    description: "",
    deviceEnvironments: [],
    closed: false,
    events: [
        {
            id: "event-1",
            type: "action",
            status: "completed",
            createdAt: "2026-06-01T00:00:00.000Z",
            userInput: "Desktop runtime work",
            source: { type: "do", userLabel: "Do" },
            execution: { harnessId: "codex", executionId: "exec-1", modelId: "codex-test", events: [] },
            result: { success: true },
        },
    ],
    comments: [],
}

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
    const button = Array.from(container.querySelectorAll("button")).find((item): item is HTMLButtonElement => item.textContent?.includes(text) === true)
    if (!button) throw new Error(`Missing button: ${text}`)
    return button
}

describe("DesktopTaskShell", () => {
    let container: HTMLDivElement
    let root: Root

    beforeEach(() => {
        ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
        container = document.createElement("div")
        document.body.appendChild(container)
        root = createRoot(container)
    })

    afterEach(() => {
        act(() => root.unmount())
        container.remove()
    })

    function render(element: ReactElement): void {
        act(() => {
            root.render(element)
        })
    }

    it("frames the shared task screen with desktop notices and a medium-supplied composer", async () => {
        const actions: string[] = []
        const commandTypes: TaskCommandType[] = []
        render(
            createElement(DesktopTaskShell, {
                error: "Recoverable desktop error",
                notice: "Runtime mutation saved",
                isDragOver: false,
                task,
                preview: null,
                isRunning: false,
                input: "",
                commandType: "do",
                titleDraft: task.title,
                commentDraft: "",
                editingCommentId: null,
                editingCommentDraft: "",
                reviewInstructions: "",
                taskChanges: { repoId: "repo-1", taskId: "task-1", files: [], fromTreeish: "HEAD", toTreeish: "" },
                taskGitLog: { repoId: "repo-1", taskId: "task-1", commits: [], hasMore: false },
                taskChangesLoading: false,
                taskDiff: null,
                taskDiffActionPath: null,
                isLoading: false,
                isSubmitting: false,
                isOnline: true,
                composer: createElement("button", { type: "button", className: "btn", onClick: () => actions.push("rich-composer") }, "Desktop rich composer"),
                onInputChange: (value) => actions.push(`input:${value}`),
                onCommandTypeChange: (value) => commandTypes.push(value),
                onTitleChange: (value) => actions.push(`title:${value}`),
                onSaveTitle: () => actions.push("save-title"),
                onToggleClosed: () => actions.push("toggle-closed"),
                onDeleteTask: () => actions.push("delete-task"),
                onCommentDraftChange: (value) => actions.push(`comment:${value}`),
                onCreateComment: () => actions.push("create-comment"),
                onStartEditComment: (comment: OpenADETaskCommentView) => actions.push(`edit:${comment.id}`),
                onEditingCommentDraftChange: (value) => actions.push(`editing:${value}`),
                onSaveComment: (commentId) => actions.push(`save-comment:${commentId}`),
                onCancelEditComment: () => actions.push("cancel-edit"),
                onDeleteComment: (commentId) => actions.push(`delete-comment:${commentId}`),
                onCancelQueuedTurn: (queuedTurnId) => actions.push(`cancel-queued:${queuedTurnId}`),
                onReviewInstructionsChange: (value) => actions.push(`review-instructions:${value}`),
                onStartReview: (reviewType) => actions.push(`review:${reviewType}`),
                onRefreshTaskGit: () => actions.push("refresh-git"),
                onReadTaskDiff: (file) => actions.push(`diff:${file.path}`),
                onSend: () => actions.push("send"),
                onAbort: () => actions.push("abort"),
            })
        )
        await act(async () => {
            await new Promise((resolve) => window.setTimeout(resolve, 0))
        })

        expect(container.textContent).toContain("Recoverable desktop error")
        expect(container.textContent).toContain("Runtime mutation saved")
        const titleInput = Array.from(container.querySelectorAll("input")).find((input) => input.value === "Desktop shared task")
        expect(titleInput).toBeInstanceOf(HTMLInputElement)
        expect(container.textContent).toContain("Desktop runtime work")
        expect(container.textContent).toContain("Desktop rich composer")

        act(() => buttonByText(container, "Desktop rich composer").click())
        act(() => buttonByText(container, "Close").click())

        expect(actions).toEqual(["rich-composer", "toggle-closed"])
        expect(commandTypes).toEqual([])
    })
})
