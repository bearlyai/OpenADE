import { act, createElement, type ReactElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { OpenADETask, OpenADETaskResourceInventory } from "../../../../openade-module/src"
import type { TaskTerminalProductAccess } from "../../components/terminalSession"
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
        {
            id: "queued-2",
            type: "ask",
            input: "queued question",
            status: "queued",
            createdAt: "2026-05-31T00:00:01.000Z",
            updatedAt: "2026-05-31T00:00:01.000Z",
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

const taskResources: OpenADETaskResourceInventory = {
    repoId: "repo-1",
    taskId: "task-1",
    taskTitle: "Shared shell task",
    isRunning: true,
    snapshotIds: ["snapshot-1"],
    images: [{ id: "image-1", ext: "png" }],
    sessions: [{ sessionId: "session-1", harnessId: "claude-code" }],
    worktree: {
        slug: "task-1",
        branchName: "openade/task-1",
        sourceBranch: "main",
        branchMerged: false,
    },
}

const fullTaskGitCapabilities = {
    canRead: true,
    canReadDiff: true,
    canReadFilePair: true,
    canReadCommitFiles: true,
    canReadCommitFilePatch: true,
    canReadFileAtTreeish: true,
    canCommit: true,
}

const fullTaskProductCapabilities = {
    canUpdateMetadata: true,
    canGenerateTitle: true,
    canPrepareEnvironment: true,
    canStartReview: true,
    canCreateComment: true,
    canEditComment: true,
    canDeleteComment: true,
    canCancelQueuedTurn: true,
    canReorderQueuedTurns: true,
}

const taskTerminalProductAccess = {
    repoId: "repo-1",
    taskId: "task-1",
    startTaskTerminal: async () => ({ repoId: "repo-1", taskId: "task-1", terminalId: "terminal-1", ok: true }),
    reconnectTaskTerminal: async () => ({ repoId: "repo-1", taskId: "task-1", terminalId: "terminal-1", found: false }),
    writeTaskTerminal: async (args) => ({ repoId: "repo-1", taskId: "task-1", terminalId: args.terminalId, ok: true }),
    resizeTaskTerminal: async (args) => ({ repoId: "repo-1", taskId: "task-1", terminalId: args.terminalId, ok: true }),
    stopTaskTerminal: async (args) => ({ repoId: "repo-1", taskId: "task-1", terminalId: args.terminalId, ok: true }),
} satisfies TaskTerminalProductAccess

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
    const button = Array.from(container.querySelectorAll("button")).find((item): item is HTMLButtonElement => item.textContent?.includes(text) === true)
    if (!button) throw new Error(`Missing button: ${text}`)
    return button
}

function queryButtonByText(container: HTMLElement, text: string): HTMLButtonElement | null {
    return Array.from(container.querySelectorAll("button")).find((item): item is HTMLButtonElement => item.textContent?.includes(text) === true) ?? null
}

function textareaByPlaceholder(container: HTMLElement, text: string): HTMLTextAreaElement {
    const textarea = Array.from(container.querySelectorAll("textarea")).find((item): item is HTMLTextAreaElement => item.placeholder === text)
    if (!textarea) throw new Error(`Missing textarea: ${text}`)
    return textarea
}

function buttonByLabel(container: HTMLElement, label: string): HTMLButtonElement {
    const button = Array.from(container.querySelectorAll("button")).find((item): item is HTMLButtonElement => item.getAttribute("aria-label") === label)
    if (!button) throw new Error(`Missing button: ${label}`)
    return button
}

function inputByPlaceholder(container: HTMLElement, placeholder: string): HTMLInputElement {
    const input = Array.from(container.querySelectorAll("input")).find((item): item is HTMLInputElement => item.placeholder === placeholder)
    if (!input) throw new Error(`Missing input: ${placeholder}`)
    return input
}

function typeInto(element: HTMLInputElement, value: string): void {
    act(() => {
        const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value")
        descriptor?.set?.call(element, value)
        element.dispatchEvent(new Event("input", { bubbles: true }))
        element.dispatchEvent(new Event("change", { bubbles: true }))
    })
}

function queryButtonByLabel(container: HTMLElement, label: string): HTMLButtonElement | null {
    return Array.from(container.querySelectorAll("button")).find((item): item is HTMLButtonElement => item.getAttribute("aria-label") === label) ?? null
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
                taskChanges: {
                    repoId: "repo-1",
                    taskId: "task-1",
                    files: [{ path: "src/app.ts", status: "modified" }],
                    fromTreeish: "HEAD",
                    toTreeish: "",
                },
                taskGitLog: {
                    repoId: "repo-1",
                    taskId: "task-1",
                    commits: [
                        {
                            sha: "0123456789abcdef",
                            shortSha: "0123456",
                            message: "Initial shell commit",
                            author: "OpenADE",
                            date: "2026-05-31T00:00:00.000Z",
                            relativeDate: "today",
                            parentCount: 1,
                        },
                    ],
                    hasMore: false,
                },
                taskGitSummary: {
                    repoId: "repo-1",
                    taskId: "task-1",
                    branch: "feature/shared-shell",
                    headCommit: "1234567890abcdef",
                    ahead: 2,
                    hasChanges: true,
                    staged: {
                        files: [],
                        stats: { filesChanged: 0, insertions: 0, deletions: 0 },
                    },
                    unstaged: {
                        files: [{ path: "src/app.ts", status: "modified" }],
                        stats: { filesChanged: 1, insertions: 1, deletions: 0 },
                    },
                    untracked: [],
                },
                taskGitScopes: {
                    repoId: "repo-1",
                    taskId: "task-1",
                    defaultBranch: "main",
                    scopes: [
                        { id: "branch:main", type: "branch", name: "main", ref: "main", isDefault: true, isRemote: false },
                        {
                            id: "worktree:shared-shell",
                            type: "worktree",
                            worktreeId: "shared-shell",
                            branch: "feature/shared-shell",
                            head: "1234567890abcdef",
                            label: "shared-shell",
                        },
                    ],
                },
                taskChangesLoading: false,
                taskDiff: null,
                taskDiffActionPath: null,
                taskFilePair: {
                    repoId: "repo-1",
                    taskId: "task-1",
                    filePath: "src/app.ts",
                    fromTreeish: "HEAD",
                    toTreeish: "",
                    before: "before code",
                    after: "after code",
                },
                taskFilePairActionPath: null,
                taskCommitFiles: {
                    repoId: "repo-1",
                    taskId: "task-1",
                    commit: "0123456789abcdef",
                    files: [{ path: "src/app.ts", status: "modified" }],
                },
                taskCommitFilesActionSha: null,
                taskCommitPatch: {
                    repoId: "repo-1",
                    taskId: "task-1",
                    commit: "0123456789abcdef",
                    filePath: "src/app.ts",
                    patch: "diff --git a/src/app.ts b/src/app.ts\n+commit code\n",
                    truncated: false,
                    heavy: false,
                    stats: { insertions: 1, deletions: 0, changedLines: 1, hunkCount: 1 },
                },
                taskCommitPatchActionKey: null,
                taskTreeishFile: {
                    repoId: "repo-1",
                    taskId: "task-1",
                    treeish: "0123456789abcdef",
                    filePath: "src/app.ts",
                    content: "commit file content",
                    exists: true,
                },
                taskTreeishFileActionKey: null,
                taskResources,
                taskResourcesLoading: false,
                taskTerminalProductAccess,
                taskGitCapabilities: fullTaskGitCapabilities,
                taskProductCapabilities: fullTaskProductCapabilities,
                canReadTaskResources: true,
                canDeleteTask: true,
                isSubmitting: false,
                onTitleChange: (value) => actions.push(`title:${value}`),
                onSaveTitle: () => actions.push("save-title"),
                onGenerateTitle: () => actions.push("generate-title"),
                onPrepareEnvironment: () => actions.push("prepare-environment"),
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
                onReorderQueuedTurns: (queuedTurnIds) => actions.push(`reorder-turns:${queuedTurnIds.join(",")}`),
                onReviewInstructionsChange: (value) => actions.push(`review-instructions:${value}`),
                onStartReview: (reviewType: TaskReviewType) => actions.push(`review:${reviewType}`),
                onRefreshTaskGit: () => actions.push("refresh-git"),
                onReadTaskDiff: (file) => actions.push(`diff:${file.path}`),
                onReadTaskFilePair: (file) => actions.push(`file-pair:${file.path}`),
                onReadTaskCommitFiles: (commit) => actions.push(`commit-files:${commit.sha}`),
                onReadTaskCommitFilePatch: (file) => actions.push(`commit-patch:${file.path}`),
                onReadTaskCommitFileAtTreeish: (file) => actions.push(`commit-file:${file.path}`),
                onCommitTaskGit: (message) => actions.push(`commit:${message}`),
                onRefreshTaskResources: () => actions.push("refresh-resources"),
            })
        )

        expect(container.textContent).toContain("Legacy body comment")
        expect(container.textContent).toContain("Structured comment")
        expect(container.textContent).toContain("queued work")
        expect(container.textContent).toContain("queued question")
        expect(container.textContent).toContain("feature/shared-shell")
        expect(container.textContent).toContain("1 changed file")
        expect(container.textContent).toContain("shared-shell")
        expect(container.textContent).toContain("before code")
        expect(container.textContent).toContain("after code")
        expect(container.textContent).toContain("Initial shell commit")
        expect(container.textContent).toContain("commit code")
        expect(container.textContent).toContain("commit file content")
        expect(container.textContent).toContain("Open Terminal")
        expect(container.textContent).toContain("1 patch")
        expect(container.textContent).toContain("openade/task-1")

        typeInto(inputByPlaceholder(container, "Commit message"), "Shared shell commit")
        act(() => buttonByText(container, "Close").click())
        act(() => buttonByText(container, "Generate").click())
        act(() => buttonByText(container, "Prepare Environment").click())
        act(() => buttonByLabel(container, "Refresh task resources").click())
        act(() => buttonByText(container, "Commit").click())
        act(() => buttonByText(container, "Files").click())
        act(() => buttonByLabel(container, "Load files for commit 0123456").click())
        act(() => buttonByLabel(container, "Read patch for src/app.ts at commit 01234567").click())
        act(() => buttonByLabel(container, "View src/app.ts at commit 01234567").click())
        act(() => buttonByLabel(container, "Move queued turn down").click())
        act(() => buttonByText(container, "Cancel").click())
        act(() => buttonByText(container, "Review Work").click())
        act(() => buttonByText(container, "Add").click())

        expect(actions).toEqual([
            "toggle-closed",
            "generate-title",
            "prepare-environment",
            "refresh-resources",
            "commit:Shared shell commit",
            "file-pair:src/app.ts",
            "commit-files:0123456789abcdef",
            "commit-patch:src/app.ts",
            "commit-file:src/app.ts",
            "reorder-turns:queued-2,queued-1",
            "cancel-turn:queued-1",
            "review:work",
            "create-comment",
        ])
    })

    it("hides task delete when the shell lacks delete capability", () => {
        render(
            createElement(TaskProductPanel, {
                task,
                titleDraft: task.title,
                comments: openADETaskComments(task),
                commentDraft: "",
                editingCommentId: null,
                editingCommentDraft: "",
                reviewInstructions: "",
                taskChanges: null,
                taskGitLog: null,
                taskGitSummary: null,
                taskGitScopes: null,
                taskChangesLoading: false,
                taskDiff: null,
                taskDiffActionPath: null,
                taskFilePair: null,
                taskFilePairActionPath: null,
                taskCommitFiles: null,
                taskCommitFilesActionSha: null,
                taskCommitPatch: null,
                taskCommitPatchActionKey: null,
                taskTreeishFile: null,
                taskTreeishFileActionKey: null,
                taskResources: null,
                taskResourcesLoading: false,
                taskTerminalProductAccess: null,
                taskGitCapabilities: fullTaskGitCapabilities,
                taskProductCapabilities: fullTaskProductCapabilities,
                canReadTaskResources: true,
                canDeleteTask: false,
                isSubmitting: false,
                onTitleChange: () => undefined,
                onSaveTitle: () => undefined,
                onGenerateTitle: () => undefined,
                onPrepareEnvironment: () => undefined,
                onToggleClosed: () => undefined,
                onDeleteTask: () => {
                    throw new Error("delete should be unavailable")
                },
                onCommentDraftChange: () => undefined,
                onCreateComment: () => undefined,
                onStartEditComment: () => undefined,
                onEditingCommentDraftChange: () => undefined,
                onSaveComment: () => undefined,
                onCancelEditComment: () => undefined,
                onDeleteComment: () => undefined,
                onCancelQueuedTurn: () => undefined,
                onReorderQueuedTurns: () => undefined,
                onReviewInstructionsChange: () => undefined,
                onStartReview: () => undefined,
                onRefreshTaskGit: () => undefined,
                onReadTaskDiff: () => undefined,
                onReadTaskFilePair: () => undefined,
                onReadTaskCommitFiles: () => undefined,
                onReadTaskCommitFilePatch: () => undefined,
                onReadTaskCommitFileAtTreeish: () => undefined,
                onCommitTaskGit: () => undefined,
                onRefreshTaskResources: () => undefined,
            })
        )

        expect(container.textContent).toContain("Close")
        expect(Array.from(container.querySelectorAll("button")).some((button) => button.getAttribute("aria-label") === "Delete task")).toBe(false)
    })

    it("hides mutation controls when runtime product capabilities are absent", () => {
        render(
            createElement(TaskProductPanel, {
                task,
                titleDraft: task.title,
                comments: openADETaskComments(task),
                commentDraft: "blocked comment",
                editingCommentId: "comment-1",
                editingCommentDraft: "edited comment",
                reviewInstructions: "review this",
                taskChanges: null,
                taskGitLog: null,
                taskGitSummary: null,
                taskGitScopes: null,
                taskChangesLoading: false,
                taskDiff: null,
                taskDiffActionPath: null,
                taskFilePair: null,
                taskFilePairActionPath: null,
                taskCommitFiles: null,
                taskCommitFilesActionSha: null,
                taskCommitPatch: null,
                taskCommitPatchActionKey: null,
                taskTreeishFile: null,
                taskTreeishFileActionKey: null,
                taskResources: null,
                taskResourcesLoading: false,
                taskTerminalProductAccess: null,
                taskGitCapabilities: {
                    canRead: false,
                    canReadDiff: false,
                    canReadFilePair: false,
                    canReadCommitFiles: false,
                    canReadCommitFilePatch: false,
                    canReadFileAtTreeish: false,
                    canCommit: false,
                },
                taskProductCapabilities: {
                    canUpdateMetadata: false,
                    canGenerateTitle: false,
                    canPrepareEnvironment: false,
                    canStartReview: false,
                    canCreateComment: false,
                    canEditComment: false,
                    canDeleteComment: false,
                    canCancelQueuedTurn: false,
                    canReorderQueuedTurns: false,
                },
                canReadTaskResources: false,
                canDeleteTask: false,
                isSubmitting: false,
                onTitleChange: () => undefined,
                onSaveTitle: () => {
                    throw new Error("save title should be unavailable")
                },
                onGenerateTitle: () => {
                    throw new Error("generate title should be unavailable")
                },
                onPrepareEnvironment: () => {
                    throw new Error("prepare environment should be unavailable")
                },
                onToggleClosed: () => {
                    throw new Error("close should be unavailable")
                },
                onDeleteTask: () => {
                    throw new Error("delete should be unavailable")
                },
                onCommentDraftChange: () => undefined,
                onCreateComment: () => {
                    throw new Error("create comment should be unavailable")
                },
                onStartEditComment: () => {
                    throw new Error("edit should be unavailable")
                },
                onEditingCommentDraftChange: () => undefined,
                onSaveComment: () => {
                    throw new Error("save comment should be unavailable")
                },
                onCancelEditComment: () => undefined,
                onDeleteComment: () => {
                    throw new Error("delete comment should be unavailable")
                },
                onCancelQueuedTurn: () => {
                    throw new Error("cancel queued turn should be unavailable")
                },
                onReorderQueuedTurns: () => {
                    throw new Error("reorder queued turns should be unavailable")
                },
                onReviewInstructionsChange: () => undefined,
                onStartReview: () => {
                    throw new Error("review should be unavailable")
                },
                onRefreshTaskGit: () => undefined,
                onReadTaskDiff: () => undefined,
                onReadTaskFilePair: () => undefined,
                onReadTaskCommitFiles: () => undefined,
                onReadTaskCommitFilePatch: () => undefined,
                onReadTaskCommitFileAtTreeish: () => undefined,
                onCommitTaskGit: () => {
                    throw new Error("commit should be unavailable")
                },
                onRefreshTaskResources: () => undefined,
            })
        )

        expect(container.textContent).toContain("queued work")
        expect(container.textContent).toContain("Legacy body comment")
        expect(queryButtonByText(container, "Save")).toBeNull()
        expect(queryButtonByText(container, "Generate")).toBeNull()
        expect(queryButtonByText(container, "Prepare Environment")).toBeNull()
        expect(queryButtonByText(container, "Close")).toBeNull()
        expect(queryButtonByText(container, "Review Work")).toBeNull()
        expect(queryButtonByText(container, "Add")).toBeNull()
        expect(queryButtonByText(container, "Edit")).toBeNull()
        expect(queryButtonByText(container, "Delete")).toBeNull()
        expect(queryButtonByText(container, "Cancel")).toBeNull()
        expect(queryButtonByLabel(container, "Move queued turn down")).toBeNull()
        const titleInput = container.querySelector('input[aria-label="Task title"]')
        expect(titleInput instanceof HTMLInputElement ? titleInput.disabled : false).toBe(true)
        expect(titleInput instanceof HTMLInputElement ? titleInput.value : "").toBe("Shared shell task")
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
