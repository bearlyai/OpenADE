import { act, createElement, type ReactElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { OpenADETask } from "../../../../openade-module/src"
import { TaskComposer } from "./TaskComposer"
import { TaskProductPanel, openADETaskComments, type OpenADETaskCommentView, type TaskReviewType } from "./TaskProductPanel"
import type { TaskCommandType } from "./taskCommands"

const task: OpenADETask = {
    id: "task-1",
    repoId: "repo-1",
    slug: "task-1",
    title: "Shared shell task",
    description: "",
    deviceEnvironments: [],
    queuedTurns: [
        {
            id: "queued-1",
            type: "do",
            input: "queued work",
            status: "queued",
            createdAt: "2026-05-31T00:00:00.000Z",
            updatedAt: "2026-05-31T00:00:00.000Z",
        },
    ],
    closed: false,
    events: [],
    comments: [
        {
            id: "comment-1",
            body: "Legacy body comment",
            createdBy: { id: "user-1" },
            createdAt: "2026-05-31T00:00:00.000Z",
        },
        {
            id: "comment-2",
            content: "Structured comment",
            author: { email: "person@example.com" },
        },
        { content: "missing id is ignored" },
    ],
}

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
    const button = Array.from(container.querySelectorAll("button")).find((item): item is HTMLButtonElement => item.textContent?.includes(text) === true)
    if (!button) throw new Error(`Missing button: ${text}`)
    return button
}

function textareaByPlaceholder(container: HTMLElement, text: string): HTMLTextAreaElement {
    const textarea = Array.from(container.querySelectorAll("textarea")).find((item): item is HTMLTextAreaElement => item.placeholder === text)
    if (!textarea) throw new Error(`Missing textarea: ${text}`)
    return textarea
}

function lastButton(container: HTMLElement): HTMLButtonElement {
    const button = Array.from(container.querySelectorAll("button")).at(-1)
    if (!(button instanceof HTMLButtonElement)) throw new Error("Missing last button")
    return button
}

describe("shared task shell controls", () => {
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

    it("normalizes old and current task comment DTO shapes", () => {
        expect(openADETaskComments(task)).toEqual<OpenADETaskCommentView[]>([
            {
                id: "comment-1",
                content: "Legacy body comment",
                createdAt: "2026-05-31T00:00:00.000Z",
                authorLabel: "user-1",
            },
            {
                id: "comment-2",
                content: "Structured comment",
                authorLabel: "person@example.com",
            },
        ])
    })

    it("renders task metadata, comments, queued turns, and product actions from a real OpenADE task DTO", () => {
        const actions: string[] = []
        render(
            createElement(TaskProductPanel, {
                task,
                titleDraft: "Shared shell task",
                comments: openADETaskComments(task),
                commentDraft: "new comment",
                editingCommentId: null,
                editingCommentDraft: "",
                reviewInstructions: "",
                taskChanges: { repoId: "repo-1", taskId: "task-1", files: [], fromTreeish: "HEAD", toTreeish: "" },
                taskGitLog: { repoId: "repo-1", taskId: "task-1", commits: [], hasMore: false },
                taskChangesLoading: false,
                taskDiff: null,
                taskDiffActionPath: null,
                isSubmitting: false,
                onTitleChange: (value) => actions.push(`title:${value}`),
                onSaveTitle: () => actions.push("save-title"),
                onToggleClosed: () => actions.push("toggle-closed"),
                onDeleteTask: () => actions.push("delete-task"),
                onCommentDraftChange: (value) => actions.push(`comment-draft:${value}`),
                onCreateComment: () => actions.push("create-comment"),
                onStartEditComment: (comment) => actions.push(`edit-comment:${comment.id}`),
                onEditingCommentDraftChange: (value) => actions.push(`editing-comment:${value}`),
                onSaveComment: (commentId) => actions.push(`save-comment:${commentId}`),
                onCancelEditComment: () => actions.push("cancel-edit-comment"),
                onDeleteComment: (commentId) => actions.push(`delete-comment:${commentId}`),
                onCancelQueuedTurn: (queuedTurnId) => actions.push(`cancel-turn:${queuedTurnId}`),
                onReviewInstructionsChange: (value) => actions.push(`review-instructions:${value}`),
                onStartReview: (reviewType: TaskReviewType) => actions.push(`review:${reviewType}`),
                onRefreshTaskGit: () => actions.push("refresh-git"),
                onReadTaskDiff: (file) => actions.push(`diff:${file.path}`),
            })
        )

        expect(container.textContent).toContain("Legacy body comment")
        expect(container.textContent).toContain("Structured comment")
        expect(container.textContent).toContain("queued work")

        act(() => buttonByText(container, "Close").click())
        act(() => buttonByText(container, "Cancel").click())
        act(() => buttonByText(container, "Review Work").click())
        act(() => buttonByText(container, "Add").click())

        expect(actions).toEqual(["toggle-closed", "cancel-turn:queued-1", "review:work", "create-comment"])
    })

    it("keeps composer command enablement consistent while a task is running", () => {
        const commandTypes: TaskCommandType[] = []
        const actions: string[] = []
        render(
            createElement(TaskComposer, {
                input: "ship it",
                commandType: "plan",
                isLoading: false,
                isSubmitting: false,
                isOnline: true,
                isRunning: true,
                onInputChange: (value) => actions.push(`input:${value}`),
                onCommandTypeChange: (value) => commandTypes.push(value),
                onSend: () => actions.push("send"),
                onAbort: () => actions.push("abort"),
            })
        )

        const textarea = container.querySelector("textarea")
        expect(textarea?.placeholder).toBe("Only Do and Ask can be queued while running")
        expect(buttonByText(container, "Plan").disabled).toBe(true)
        expect(buttonByText(container, "Ask").disabled).toBe(false)
        expect(lastButton(container).disabled).toBe(true)

        act(() => buttonByText(container, "Ask").click())
        expect(commandTypes).toEqual(["ask"])
    })

    it("renders offline composer state without dispatching sends", () => {
        const actions: string[] = []
        render(
            createElement(TaskComposer, {
                input: "ship it",
                commandType: "do",
                isLoading: false,
                isSubmitting: false,
                isOnline: false,
                isRunning: false,
                onInputChange: (value) => actions.push(`input:${value}`),
                onCommandTypeChange: (value) => actions.push(`mode:${value}`),
                onSend: () => actions.push("send"),
                onAbort: () => actions.push("abort"),
            })
        )

        expect(container.querySelector("textarea")?.placeholder).toBe("Offline")
        expect(buttonByText(container, "Do").disabled).toBe(false)
        expect(lastButton(container).disabled).toBe(true)
        expect(textareaByPlaceholder(container, "Offline").value).toBe("ship it")
        expect(actions).toEqual([])
    })
})
