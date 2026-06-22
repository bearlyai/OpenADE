import { act, type ComponentProps, createElement, type ReactElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { OpenADETask, OpenADETaskResourceInventory } from "../../../../openade-module/src"
import type { TaskTerminalProductAccess } from "../../components/terminalSession"
import { resetMetaKeyPressed } from "../../hooks/useMetaKeyPressed"
import { TaskComposer } from "./TaskComposer"
import { TaskGitPanel } from "./TaskGitPanel"
import { TaskProductPanel, openADETaskComments, type OpenADETaskCommentView, type TaskReviewType } from "./TaskProductPanel"
import { TaskScreen } from "./TaskScreen"
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

const taskWithActivePlan: OpenADETask = {
    ...task,
    events: [
        {
            id: "event-plan",
            type: "action",
            status: "completed",
            createdAt: "2026-05-31T00:00:02.000Z",
            userInput: "Plan the work",
            source: { type: "plan", userLabel: "Plan" },
        },
    ],
}

const taskWithCompletedAction: OpenADETask = {
    ...task,
    events: [
        {
            id: "event-completed",
            type: "action",
            status: "completed",
            createdAt: "2026-05-31T00:00:03.000Z",
            userInput: "Ship the work",
            source: { type: "do", userLabel: "Do" },
        },
    ],
}

const taskWithFailedAction: OpenADETask = {
    ...task,
    events: [
        {
            id: "event-error",
            type: "action",
            status: "error",
            createdAt: "2026-05-31T00:00:03.000Z",
            userInput: "Try the work",
            source: { type: "do", userLabel: "Do" },
        },
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
    canReadChanges: true,
    canReadLog: true,
    canReadSummary: true,
    canReadScopes: true,
    canReadDiff: true,
    canReadFilePair: true,
    canReadCommitFiles: true,
    canReadCommitFilePatch: true,
    canReadFileAtTreeish: true,
}

const taskTerminalProductAccess = {
    repoId: "repo-1",
    taskId: "task-1",
    capabilities: {
        canStart: true,
        canReconnect: true,
        canWrite: true,
        canResize: true,
        canStop: true,
    },
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

function queryButtonByExactText(container: HTMLElement, text: string): HTMLButtonElement | null {
    return Array.from(container.querySelectorAll("button")).find((item): item is HTMLButtonElement => item.textContent?.trim() === text) ?? null
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

function shortcutBadgeTexts(container: HTMLElement): string[] {
    return Array.from(container.querySelectorAll("kbd"))
        .map((badge) => badge.textContent?.trim() ?? "")
        .filter((text) => text.length > 0)
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
        resetMetaKeyPressed()
    })

    function render(element: ReactElement): void {
        act(() => {
            root.render(element)
        })
    }

    function taskProductPanelElement(overrides: Partial<ComponentProps<typeof TaskProductPanel>> = {}): ReactElement {
        return createElement(TaskProductPanel, {
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
            isRunning: false,
            isSubmitting: false,
            onTitleChange: () => undefined,
            onSaveTitle: () => undefined,
            onGenerateTitle: () => undefined,
            onPrepareEnvironment: () => undefined,
            onToggleClosed: () => undefined,
            onDeleteTask: () => undefined,
            onCancelPlan: () => undefined,
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
            ...overrides,
        })
    }

    function taskScreenElement(overrides: Partial<ComponentProps<typeof TaskScreen>> = {}): ReactElement {
        return createElement(TaskScreen, {
            task,
            preview: null,
            isRunning: false,
            input: "ship it",
            commandType: "do",
            titleDraft: task.title,
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
            taskTurnCapabilities: { canStart: true, canEnqueue: false, canInterrupt: true },
            isLoading: false,
            isSubmitting: false,
            isOnline: true,
            onInputChange: () => undefined,
            onCommandTypeChange: () => undefined,
            onTitleChange: () => undefined,
            onSaveTitle: () => undefined,
            onGenerateTitle: () => undefined,
            onPrepareEnvironment: () => undefined,
            onToggleClosed: () => undefined,
            onDeleteTask: () => undefined,
            onCancelPlan: () => undefined,
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
            onSend: () => undefined,
            onAbort: () => undefined,
            ...overrides,
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
                isRunning: false,
                isSubmitting: false,
                onTitleChange: (value) => actions.push(`title:${value}`),
                onSaveTitle: () => actions.push("save-title"),
                onGenerateTitle: () => actions.push("generate-title"),
                onPrepareEnvironment: () => actions.push("prepare-environment"),
                onToggleClosed: () => actions.push("toggle-closed"),
                onDeleteTask: () => actions.push("delete-task"),
                onCancelPlan: (planEventId) => actions.push(`cancel-plan:${planEventId}`),
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
                isRunning: false,
                isSubmitting: false,
                onTitleChange: () => undefined,
                onSaveTitle: () => undefined,
                onGenerateTitle: () => undefined,
                onPrepareEnvironment: () => undefined,
                onToggleClosed: () => undefined,
                onDeleteTask: undefined,
                onCancelPlan: () => undefined,
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

    it("cancels an already-open comment editor when edit capability disappears", () => {
        const actions: string[] = []
        render(
            taskProductPanelElement({
                editingCommentId: "comment-1",
                editingCommentDraft: "edited comment",
                onCancelEditComment: () => actions.push("cancel-edit-comment"),
            })
        )

        expect(container.querySelector('textarea[aria-label="Edit comment"]')).toBeInstanceOf(HTMLTextAreaElement)
        expect(actions).toEqual([])

        render(
            taskProductPanelElement({
                editingCommentId: "comment-1",
                editingCommentDraft: "edited comment",
                onStartEditComment: undefined,
                onEditingCommentDraftChange: undefined,
                onSaveComment: undefined,
                onCancelEditComment: () => actions.push("cancel-edit-comment"),
            })
        )

        expect(container.querySelector('textarea[aria-label="Edit comment"]')).toBeNull()
        expect(actions).toEqual(["cancel-edit-comment"])
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
                    canReadChanges: false,
                    canReadLog: false,
                    canReadSummary: false,
                    canReadScopes: false,
                    canReadDiff: false,
                    canReadFilePair: false,
                    canReadCommitFiles: false,
                    canReadCommitFilePatch: false,
                    canReadFileAtTreeish: false,
                },
                isRunning: false,
                isSubmitting: false,
                onTitleChange: undefined,
                onSaveTitle: undefined,
                onGenerateTitle: undefined,
                onPrepareEnvironment: undefined,
                onToggleClosed: undefined,
                onDeleteTask: undefined,
                onCancelPlan: undefined,
                onCommentDraftChange: undefined,
                onCreateComment: undefined,
                onStartEditComment: undefined,
                onEditingCommentDraftChange: undefined,
                onSaveComment: undefined,
                onCancelEditComment: () => undefined,
                onDeleteComment: undefined,
                onCancelQueuedTurn: undefined,
                onReorderQueuedTurns: undefined,
                onReviewInstructionsChange: undefined,
                onStartReview: undefined,
                onRefreshTaskGit: () => undefined,
                onReadTaskDiff: () => undefined,
                onReadTaskFilePair: () => undefined,
                onReadTaskCommitFiles: () => undefined,
                onReadTaskCommitFilePatch: () => undefined,
                onReadTaskCommitFileAtTreeish: () => undefined,
                onCommitTaskGit: undefined,
                onRefreshTaskResources: undefined,
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

    it("keeps task product actions unavailable when handlers are withheld", () => {
        render(
            taskProductPanelElement({
                task: taskWithActivePlan,
                comments: openADETaskComments(taskWithActivePlan),
                commentDraft: "blocked comment",
                editingCommentId: "comment-1",
                editingCommentDraft: "edited comment",
                reviewInstructions: "review this",
                taskChanges: {
                    repoId: "repo-1",
                    taskId: "task-1",
                    files: [{ path: "src/app.ts", status: "modified" }],
                    fromTreeish: "HEAD",
                    toTreeish: "",
                },
                taskGitSummary: {
                    repoId: "repo-1",
                    taskId: "task-1",
                    branch: "feature/shared-shell",
                    headCommit: "1234567890abcdef",
                    ahead: 0,
                    hasChanges: true,
                    staged: { files: [], stats: { filesChanged: 0, insertions: 0, deletions: 0 } },
                    unstaged: { files: [{ path: "src/app.ts", status: "modified" }], stats: { filesChanged: 1, insertions: 1, deletions: 0 } },
                    untracked: [],
                },
                taskResources,
                onTitleChange: undefined,
                onSaveTitle: undefined,
                onGenerateTitle: undefined,
                onPrepareEnvironment: undefined,
                onToggleClosed: undefined,
                onDeleteTask: undefined,
                onCancelPlan: undefined,
                onCommentDraftChange: undefined,
                onCreateComment: undefined,
                onStartEditComment: undefined,
                onEditingCommentDraftChange: undefined,
                onSaveComment: undefined,
                onDeleteComment: undefined,
                onCancelQueuedTurn: undefined,
                onReorderQueuedTurns: undefined,
                onReviewInstructionsChange: undefined,
                onStartReview: undefined,
                onRefreshTaskGit: undefined,
                onReadTaskDiff: undefined,
                onReadTaskFilePair: undefined,
                onCommitTaskGit: undefined,
                onRefreshTaskResources: undefined,
            })
        )

        expect(container.textContent).toContain("feature/shared-shell")
        expect(container.textContent).toContain("src/app.ts")
        expect(container.textContent).toContain("Legacy body comment")
        expect(queryButtonByText(container, "Save")).toBeNull()
        expect(queryButtonByText(container, "Generate")).toBeNull()
        expect(queryButtonByText(container, "Prepare Environment")).toBeNull()
        expect(queryButtonByText(container, "Close")).toBeNull()
        expect(queryButtonByText(container, "Cancel Plan")).toBeNull()
        expect(queryButtonByText(container, "Review Work")).toBeNull()
        expect(queryButtonByText(container, "Add")).toBeNull()
        expect(queryButtonByText(container, "Edit")).toBeNull()
        expect(queryButtonByText(container, "Delete")).toBeNull()
        expect(queryButtonByText(container, "Cancel")).toBeNull()
        expect(queryButtonByText(container, "Refresh")).toBeNull()
        expect(queryButtonByText(container, "Commit")).toBeNull()
        expect(queryButtonByText(container, "Files")).toBeNull()
        expect(queryButtonByLabel(container, "Move queued turn down")).toBeNull()
        expect(queryButtonByLabel(container, "Load task resources")).toBeNull()

        const titleInput = container.querySelector('input[aria-label="Task title"]')
        expect(titleInput instanceof HTMLInputElement ? titleInput.disabled : false).toBe(true)
        expect(buttonByText(container, "src/app.ts").disabled).toBe(true)
    })

    it("filters stale task resource inventory when resource read capability disappears", () => {
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
                taskResources,
                taskResourcesLoading: false,
                taskTerminalProductAccess: null,
                taskGitCapabilities: {
                    canReadChanges: false,
                    canReadLog: false,
                    canReadSummary: false,
                    canReadScopes: false,
                    canReadDiff: false,
                    canReadFilePair: false,
                    canReadCommitFiles: false,
                    canReadCommitFilePatch: false,
                    canReadFileAtTreeish: false,
                },
                isRunning: false,
                isSubmitting: false,
                onTitleChange: () => undefined,
                onSaveTitle: () => undefined,
                onGenerateTitle: () => undefined,
                onPrepareEnvironment: () => undefined,
                onToggleClosed: () => undefined,
                onDeleteTask: undefined,
                onCancelPlan: () => undefined,
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
                onRefreshTaskResources: undefined,
            })
        )

        expect(container.textContent).toContain("Resources")
        expect(container.textContent).toContain("Prepare Environment")
        expect(queryButtonByLabel(container, "Load task resources")).toBeNull()
        expect(container.textContent).not.toContain("1 patch")
        expect(container.textContent).not.toContain("1 image")
        expect(container.textContent).not.toContain("1 session")
        expect(container.textContent).not.toContain("openade/task-1")
    })

    it("closes an open terminal when terminal access disappears", async () => {
        render(taskProductPanelElement({ taskTerminalProductAccess }))

        act(() => buttonByText(container, "Open Terminal").click())
        expect(container.textContent).toContain("Hide Terminal")

        render(taskProductPanelElement({ taskTerminalProductAccess: null }))
        expect(container.textContent).not.toContain("Terminal")

        await act(async () => {
            await Promise.resolve()
        })

        render(taskProductPanelElement({ taskTerminalProductAccess }))
        expect(container.textContent).toContain("Open Terminal")
        expect(container.textContent).not.toContain("Hide Terminal")
    })

    it("exposes cancel plan only for active plans with metadata write capability", () => {
        const actions: string[] = []
        render(
            createElement(TaskProductPanel, {
                task: taskWithActivePlan,
                titleDraft: task.title,
                comments: openADETaskComments(taskWithActivePlan),
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
                isRunning: false,
                isSubmitting: false,
                onTitleChange: () => undefined,
                onSaveTitle: () => undefined,
                onGenerateTitle: () => undefined,
                onPrepareEnvironment: () => undefined,
                onToggleClosed: () => undefined,
                onDeleteTask: undefined,
                onCancelPlan: (planEventId) => actions.push(`cancel-plan:${planEventId}`),
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
                onRefreshTaskResources: undefined,
            })
        )

        act(() => {
            window.dispatchEvent(new KeyboardEvent("keydown", { key: "Meta", metaKey: true, bubbles: true }))
        })

        expect(shortcutBadgeTexts(container)).toEqual(expect.arrayContaining(["8", "9"]))
        expect(buttonByText(container, "Cancel Plan").getAttribute("aria-keyshortcuts")).toBe("Meta+8")

        act(() => buttonByText(container, "Cancel Plan").click())
        act(() => {
            window.dispatchEvent(new KeyboardEvent("keydown", { code: "Digit8", key: "8", metaKey: true, bubbles: true }))
        })

        expect(actions).toEqual(["cancel-plan:event-plan", "cancel-plan:event-plan"])

        render(taskProductPanelElement({ task: taskWithActivePlan, comments: openADETaskComments(taskWithActivePlan), isRunning: true }))

        expect(queryButtonByText(container, "Cancel Plan")).toBeNull()

        act(() => {
            window.dispatchEvent(new KeyboardEvent("keydown", { code: "Digit8", key: "8", metaKey: true, bubbles: true }))
        })

        expect(actions).toEqual(["cancel-plan:event-plan", "cancel-plan:event-plan"])
    })

    it("uses the desktop close shortcut only when close is available", () => {
        const actions: string[] = []
        render(
            taskProductPanelElement({
                onToggleClosed: () => actions.push("toggle-closed"),
            })
        )

        act(() => {
            window.dispatchEvent(new KeyboardEvent("keydown", { key: "Meta", metaKey: true, bubbles: true }))
        })

        expect(shortcutBadgeTexts(container)).toContain("9")
        expect(buttonByText(container, "Close").getAttribute("aria-keyshortcuts")).toBe("Meta+9")

        act(() => {
            window.dispatchEvent(new KeyboardEvent("keydown", { code: "Digit9", key: "9", metaKey: true, bubbles: true }))
        })

        expect(actions).toEqual(["toggle-closed"])

        render(
            taskProductPanelElement({
                isRunning: true,
                onToggleClosed: () => actions.push("hidden-toggle"),
            })
        )

        expect(queryButtonByText(container, "Close")).toBeNull()

        act(() => {
            window.dispatchEvent(new KeyboardEvent("keydown", { code: "Digit9", key: "9", metaKey: true, bubbles: true }))
        })

        expect(actions).toEqual(["toggle-closed"])
    })

    it("renders task git panel for partial read capabilities", () => {
        const actions: string[] = []
        render(
            createElement(TaskGitPanel, {
                changes: null,
                gitLog: null,
                gitSummary: {
                    repoId: "repo-1",
                    taskId: "task-1",
                    branch: "feature/task-git",
                    headCommit: "abcdef1234567890",
                    ahead: 0,
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
                gitScopes: null,
                loading: false,
                diff: null,
                actionPath: null,
                filePair: null,
                filePairActionPath: null,
                commitFiles: null,
                commitFilesActionSha: null,
                commitPatch: null,
                commitPatchActionKey: null,
                treeishFile: null,
                treeishFileActionKey: null,
                capabilities: {
                    canReadChanges: false,
                    canReadLog: false,
                    canReadSummary: true,
                    canReadScopes: false,
                    canReadDiff: false,
                    canReadFilePair: false,
                    canReadCommitFiles: false,
                    canReadCommitFilePatch: false,
                    canReadFileAtTreeish: false,
                },
                onRefresh: () => actions.push("refresh"),
                onReadDiff: () => actions.push("diff"),
                onReadFilePair: () => actions.push("file-pair"),
                onReadCommitFiles: () => actions.push("commit-files"),
                onReadCommitFilePatch: () => actions.push("commit-patch"),
                onReadCommitFileAtTreeish: () => actions.push("commit-file"),
                onCommit: () => actions.push("commit"),
            })
        )

        expect(container.textContent).toContain("feature/task-git")
        expect(container.textContent).toContain("abcdef12")
        expect(container.textContent).toContain("1 changed file")
        expect(container.textContent).not.toContain("No changes.")
        act(() => buttonByText(container, "Refresh").click())
        expect(actions).toEqual(["refresh"])

        render(
            createElement(TaskGitPanel, {
                changes: null,
                gitLog: null,
                gitSummary: null,
                gitScopes: null,
                loading: false,
                diff: null,
                actionPath: null,
                filePair: null,
                filePairActionPath: null,
                commitFiles: null,
                commitFilesActionSha: null,
                commitPatch: null,
                commitPatchActionKey: null,
                treeishFile: null,
                treeishFileActionKey: null,
                capabilities: {
                    canReadChanges: false,
                    canReadLog: false,
                    canReadSummary: false,
                    canReadScopes: false,
                    canReadDiff: false,
                    canReadFilePair: false,
                    canReadCommitFiles: false,
                    canReadCommitFilePatch: false,
                    canReadFileAtTreeish: false,
                },
                onRefresh: () => actions.push("denied-refresh"),
                onReadDiff: () => actions.push("denied-diff"),
                onReadFilePair: () => actions.push("denied-file-pair"),
                onReadCommitFiles: () => actions.push("denied-commit-files"),
                onReadCommitFilePatch: () => actions.push("denied-commit-patch"),
                onReadCommitFileAtTreeish: () => actions.push("denied-commit-file"),
                onCommit: () => actions.push("denied-commit"),
            })
        )

        expect(container.textContent).not.toContain("Changes")
    })

    it("drops task git commit drafts when commit capability disappears", () => {
        const commits: string[] = []
        const gitSummary = {
            repoId: "repo-1",
            taskId: "task-1",
            branch: "feature/task-git",
            headCommit: "abcdef1234567890",
            ahead: 0,
            hasChanges: true,
            staged: { files: [], stats: { filesChanged: 0, insertions: 0, deletions: 0 } },
            unstaged: { files: [{ path: "src/app.ts", status: "modified" as const }], stats: { filesChanged: 1, insertions: 1, deletions: 0 } },
            untracked: [],
        }
        const renderWithCommitHandler = (canCommit: boolean) =>
            render(
                createElement(TaskGitPanel, {
                    changes: null,
                    gitLog: null,
                    gitSummary,
                    gitScopes: null,
                    loading: false,
                    diff: null,
                    actionPath: null,
                    filePair: null,
                    filePairActionPath: null,
                    commitFiles: null,
                    commitFilesActionSha: null,
                    commitPatch: null,
                    commitPatchActionKey: null,
                    treeishFile: null,
                    treeishFileActionKey: null,
                    capabilities: fullTaskGitCapabilities,
                    onRefresh: () => undefined,
                    onReadDiff: () => undefined,
                    onReadFilePair: () => undefined,
                    onReadCommitFiles: () => undefined,
                    onReadCommitFilePatch: () => undefined,
                    onReadCommitFileAtTreeish: () => undefined,
                    onCommit: canCommit ? (message) => commits.push(message) : undefined,
                })
            )

        renderWithCommitHandler(true)
        typeInto(inputByPlaceholder(container, "Commit message"), "stale commit")

        renderWithCommitHandler(false)
        expect(queryButtonByText(container, "Commit")).toBeNull()

        renderWithCommitHandler(true)
        const reopenedInput = inputByPlaceholder(container, "Commit message")
        expect(reopenedInput.value).toBe("")

        typeInto(reopenedInput, "fresh commit")
        act(() => buttonByText(container, "Commit").click())
        expect(commits).toEqual(["fresh commit"])
    })

    it("hides stale task git payloads when matching capabilities disappear", () => {
        render(
            createElement(TaskGitPanel, {
                changes: {
                    repoId: "repo-1",
                    taskId: "task-1",
                    files: [{ path: "src/stale.ts", status: "modified" }],
                    fromTreeish: "HEAD",
                    toTreeish: "",
                },
                gitLog: {
                    repoId: "repo-1",
                    taskId: "task-1",
                    commits: [
                        {
                            sha: "feedfacecafebeef",
                            shortSha: "feedfac",
                            message: "Stale commit",
                            author: "OpenADE",
                            date: "2026-05-31T00:00:00.000Z",
                            relativeDate: "today",
                            parentCount: 1,
                        },
                    ],
                    hasMore: false,
                },
                gitSummary: {
                    repoId: "repo-1",
                    taskId: "task-1",
                    branch: "feature/stale-summary",
                    headCommit: "abcdef1234567890",
                    ahead: 1,
                    hasChanges: true,
                    staged: { files: [], stats: { filesChanged: 0, insertions: 0, deletions: 0 } },
                    unstaged: { files: [{ path: "src/stale.ts", status: "modified" }], stats: { filesChanged: 1, insertions: 1, deletions: 0 } },
                    untracked: [],
                },
                gitScopes: {
                    repoId: "repo-1",
                    taskId: "task-1",
                    defaultBranch: "main",
                    scopes: [{ id: "branch:main", type: "branch", name: "main", ref: "main", isDefault: true, isRemote: false }],
                },
                loading: false,
                diff: {
                    repoId: "repo-1",
                    taskId: "task-1",
                    filePath: "src/stale.ts",
                    fromTreeish: "HEAD",
                    toTreeish: "",
                    patch: "diff --git a/src/stale.ts b/src/stale.ts\n+stale\n",
                    truncated: false,
                    heavy: false,
                    stats: { insertions: 1, deletions: 0, changedLines: 1, hunkCount: 1 },
                },
                actionPath: null,
                filePair: {
                    repoId: "repo-1",
                    taskId: "task-1",
                    filePath: "src/stale.ts",
                    fromTreeish: "HEAD",
                    toTreeish: "",
                    before: "stale before",
                    after: "stale after",
                },
                filePairActionPath: null,
                commitFiles: {
                    repoId: "repo-1",
                    taskId: "task-1",
                    commit: "feedfacecafebeef",
                    files: [{ path: "src/stale.ts", status: "modified" }],
                },
                commitFilesActionSha: null,
                commitPatch: {
                    repoId: "repo-1",
                    taskId: "task-1",
                    commit: "feedfacecafebeef",
                    filePath: "src/stale.ts",
                    patch: "stale commit patch",
                    truncated: false,
                    heavy: false,
                    stats: { insertions: 1, deletions: 0, changedLines: 1, hunkCount: 1 },
                },
                commitPatchActionKey: null,
                treeishFile: {
                    repoId: "repo-1",
                    taskId: "task-1",
                    treeish: "feedfacecafebeef",
                    filePath: "src/stale.ts",
                    content: "stale treeish content",
                    exists: true,
                },
                treeishFileActionKey: null,
                capabilities: {
                    canReadChanges: true,
                    canReadLog: false,
                    canReadSummary: false,
                    canReadScopes: false,
                    canReadDiff: false,
                    canReadFilePair: false,
                    canReadCommitFiles: false,
                    canReadCommitFilePatch: false,
                    canReadFileAtTreeish: false,
                },
                onRefresh: () => undefined,
                onReadDiff: undefined,
                onReadFilePair: undefined,
                onReadCommitFiles: undefined,
                onReadCommitFilePatch: undefined,
                onReadCommitFileAtTreeish: undefined,
                onCommit: undefined,
            })
        )

        expect(container.textContent).toContain("src/stale.ts")
        expect(container.textContent).not.toContain("feature/stale-summary")
        expect(container.textContent).not.toContain("Stale commit")
        expect(container.textContent).not.toContain("diff --git")
        expect(container.textContent).not.toContain("stale before")
        expect(container.textContent).not.toContain("stale commit patch")
        expect(container.textContent).not.toContain("stale treeish content")
        expect(queryButtonByText(container, "Files")).toBeNull()
        expect(queryButtonByText(container, "Commit")).toBeNull()
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
        expect(textarea?.placeholder).toBe("Only Do, Ask, and HyperPlan can be queued while running")
        expect(buttonByText(container, "Plan").disabled).toBe(true)
        expect(buttonByText(container, "Ask").disabled).toBe(false)
        expect(buttonByText(container, "HyperPlan").disabled).toBe(false)
        expect(lastButton(container).disabled).toBe(true)

        act(() => buttonByText(container, "Ask").click())
        expect(commandTypes).toEqual(["ask"])
    })

    it("uses desktop-style shortcuts for visible existing-task composer commands", () => {
        const commandTypes: TaskCommandType[] = []
        render(taskScreenElement({ onCommandTypeChange: (value) => commandTypes.push(value) }))

        expect(shortcutBadgeTexts(container)).toEqual([])

        act(() => {
            window.dispatchEvent(new KeyboardEvent("keydown", { key: "Meta", metaKey: true, bubbles: true }))
        })

        expect(shortcutBadgeTexts(container)).toEqual(expect.arrayContaining(["1", "2", "3", "4"]))
        expect(buttonByText(container, "Do").getAttribute("aria-keyshortcuts")).toBe("Meta+1")
        expect(buttonByText(container, "HyperPlan").getAttribute("aria-keyshortcuts")).toBe("Meta+4")

        act(() => {
            window.dispatchEvent(new KeyboardEvent("keydown", { code: "Digit3", key: "3", metaKey: true, bubbles: true }))
        })

        expect(commandTypes).toEqual(["ask"])
    })

    it("prioritizes the desktop Review shortcut over HyperPlan when action history is present", () => {
        const commandTypes: TaskCommandType[] = []
        const reviewTypes: TaskReviewType[] = []
        render(
            taskScreenElement({
                task: taskWithCompletedAction,
                onCommandTypeChange: (value) => commandTypes.push(value),
                onStartReview: (reviewType) => reviewTypes.push(reviewType),
            })
        )

        expect(queryButtonByExactText(container, "Review")?.getAttribute("aria-keyshortcuts")).toBe("Meta+4")
        expect(queryButtonByExactText(container, "HyperPlan")?.getAttribute("aria-keyshortcuts")).toBeNull()

        act(() => {
            window.dispatchEvent(new KeyboardEvent("keydown", { code: "Digit4", key: "4", metaKey: true, bubbles: true }))
        })

        expect(reviewTypes).toEqual(["work"])
        expect(commandTypes).toEqual([])
    })

    it("exposes the desktop Commit & Push action from the shared task screen", () => {
        const actions: string[] = []
        render(taskScreenElement({ onCommitAndPush: () => actions.push("commit-and-push") }))

        const commitAndPushButton = buttonByText(container, "Commit & Push")
        expect(commitAndPushButton.getAttribute("aria-keyshortcuts")).toBe("Meta+7")

        act(() => {
            window.dispatchEvent(new KeyboardEvent("keydown", { key: "Meta", metaKey: true, bubbles: true }))
        })
        expect(shortcutBadgeTexts(container)).toContain("7")

        act(() => {
            window.dispatchEvent(new KeyboardEvent("keydown", { code: "Digit7", key: "7", metaKey: true, bubbles: true }))
        })
        expect(actions).toEqual(["commit-and-push"])
    })

    it("exposes desktop Close and Reopen actions from the shared task screen", () => {
        const actions: string[] = []
        render(taskScreenElement({ onToggleClosed: () => actions.push("toggle-closed") }))

        const closeButton = buttonByLabel(container, "Close task from composer")
        expect(closeButton.getAttribute("aria-keyshortcuts")).toBe("Meta+9")
        act(() => closeButton.click())

        render(taskScreenElement({ task: { ...task, closed: true }, onToggleClosed: () => actions.push("toggle-closed") }))

        const reopenButton = buttonByLabel(container, "Reopen task from composer")
        expect(reopenButton.getAttribute("aria-keyshortcuts")).toBe("Meta+9")
        act(() => reopenButton.click())

        expect(actions).toEqual(["toggle-closed", "toggle-closed"])
    })

    it("exposes desktop Repeat controls from the shared task screen", () => {
        const actions: string[] = []
        render(taskScreenElement({ onStartRepeat: () => actions.push("repeat-start") }))

        expect(buttonByText(container, "Repeat").getAttribute("aria-keyshortcuts")).toBe("Meta+6")

        act(() => {
            window.dispatchEvent(new KeyboardEvent("keydown", { code: "Digit6", key: "6", metaKey: true, bubbles: true }))
        })
        expect(actions).toEqual(["repeat-start"])

        render(
            taskScreenElement({
                repeatState: {
                    stopOnText: "done",
                    maxRuns: 3,
                    iterationCount: 2,
                    onStopOnTextChange: (value) => actions.push(`stop-text:${value}`),
                    onMaxRunsChange: (value) => actions.push(`max-runs:${value}`),
                },
                onStopRepeat: () => actions.push("repeat-stop"),
            })
        )

        expect(inputByPlaceholder(container, "optional").value).toBe("done")
        expect(container.textContent).toContain("#2")
        expect(buttonByLabel(container, "Stop repeat").getAttribute("aria-keyshortcuts")).toBe("Meta+8")

        act(() => {
            window.dispatchEvent(new KeyboardEvent("keydown", { code: "Digit8", key: "8", metaKey: true, bubbles: true }))
        })
        expect(actions).toEqual(["repeat-start", "repeat-stop"])
    })

    it("uses active-plan desktop command visibility and shortcuts", () => {
        const commandTypes: TaskCommandType[] = []
        const reviewTypes: TaskReviewType[] = []
        const actions: string[] = []
        render(
            taskScreenElement({
                task: taskWithActivePlan,
                commandType: "run_plan",
                onCommandTypeChange: (value) => commandTypes.push(value),
                onStartReview: (reviewType) => reviewTypes.push(reviewType),
                onCancelPlan: (planEventId) => actions.push(`cancel-plan:${planEventId}`),
            })
        )

        expect(queryButtonByExactText(container, "Do")).toBeNull()
        expect(queryButtonByExactText(container, "Plan")).toBeNull()
        expect(queryButtonByExactText(container, "HyperPlan")).toBeNull()
        expect(queryButtonByExactText(container, "Run Plan")?.getAttribute("aria-keyshortcuts")).toBe("Meta+1")
        expect(queryButtonByExactText(container, "Revise Plan")?.getAttribute("aria-keyshortcuts")).toBe("Meta+2")
        expect(buttonByLabel(container, "Cancel active plan from composer").getAttribute("aria-keyshortcuts")).toBe("Meta+8")
        const reviewPlanShortcutButtons = Array.from(container.querySelectorAll("button")).filter(
            (button): button is HTMLButtonElement => button.textContent?.trim() === "Review Plan" && button.getAttribute("aria-keyshortcuts") === "Meta+4"
        )
        expect(reviewPlanShortcutButtons).toHaveLength(1)

        act(() => {
            window.dispatchEvent(new KeyboardEvent("keydown", { code: "Digit1", key: "1", metaKey: true, bubbles: true }))
        })
        act(() => {
            window.dispatchEvent(new KeyboardEvent("keydown", { code: "Digit2", key: "2", metaKey: true, bubbles: true }))
        })
        act(() => {
            window.dispatchEvent(new KeyboardEvent("keydown", { code: "Digit4", key: "4", metaKey: true, bubbles: true }))
        })
        act(() => buttonByLabel(container, "Cancel active plan from composer").click())

        expect(commandTypes).toEqual(["run_plan", "revise"])
        expect(reviewTypes).toEqual(["plan"])
        expect(actions).toEqual(["cancel-plan:event-plan"])
    })

    it("ignores existing-task command shortcuts when submit capability is absent", () => {
        const commandTypes: TaskCommandType[] = []
        render(
            taskScreenElement({
                taskTurnCapabilities: { canStart: false, canEnqueue: false, canInterrupt: true },
                onCommandTypeChange: (value) => commandTypes.push(value),
            })
        )

        expect(queryButtonByExactText(container, "Do")).toBeNull()

        act(() => {
            window.dispatchEvent(new KeyboardEvent("keydown", { code: "Digit2", key: "2", metaKey: true, bubbles: true }))
        })

        expect(commandTypes).toEqual([])
    })

    it("uses the desktop retry shortcut only when retry is available", () => {
        const actions: string[] = []
        render(
            taskScreenElement({
                task: taskWithFailedAction,
                onRetry: () => actions.push("retry"),
            })
        )

        act(() => {
            window.dispatchEvent(new KeyboardEvent("keydown", { key: "Meta", metaKey: true, bubbles: true }))
        })

        expect(shortcutBadgeTexts(container)).toContain("5")
        expect(buttonByLabel(container, "Retry failed action").getAttribute("aria-keyshortcuts")).toBe("Meta+5")

        act(() => {
            window.dispatchEvent(new KeyboardEvent("keydown", { code: "Digit5", key: "5", metaKey: true, bubbles: true }))
        })

        expect(actions).toEqual(["retry"])

        render(
            taskScreenElement({
                task: taskWithFailedAction,
                taskTurnCapabilities: { canStart: false, canEnqueue: false, canInterrupt: true },
                onRetry: undefined,
            })
        )

        expect(queryButtonByLabel(container, "Retry failed action")).toBeNull()

        act(() => {
            window.dispatchEvent(new KeyboardEvent("keydown", { code: "Digit5", key: "5", metaKey: true, bubbles: true }))
        })

        expect(actions).toEqual(["retry"])
    })

    it("uses the desktop abort shortcut only when abort is available", () => {
        const actions: string[] = []
        render(
            taskScreenElement({
                isRunning: true,
                taskTurnCapabilities: { canStart: false, canEnqueue: true, canInterrupt: true },
                onAbort: () => actions.push("abort"),
            })
        )

        act(() => {
            window.dispatchEvent(new KeyboardEvent("keydown", { key: "Meta", metaKey: true, bubbles: true }))
        })

        expect(shortcutBadgeTexts(container)).toContain("8")
        expect(buttonByLabel(container, "Abort task").getAttribute("aria-keyshortcuts")).toBe("Meta+8")

        act(() => {
            window.dispatchEvent(new KeyboardEvent("keydown", { code: "Digit8", key: "8", metaKey: true, bubbles: true }))
        })

        expect(actions).toEqual(["abort"])

        render(
            taskScreenElement({
                isRunning: true,
                taskTurnCapabilities: { canStart: false, canEnqueue: true, canInterrupt: false },
                onAbort: undefined,
            })
        )

        expect(queryButtonByLabel(container, "Abort task")).toBeNull()

        act(() => {
            window.dispatchEvent(new KeyboardEvent("keydown", { code: "Digit8", key: "8", metaKey: true, bubbles: true }))
        })

        expect(actions).toEqual(["abort"])
    })

    it("focuses the fallback task textarea with the desktop focus shortcut", () => {
        render(taskScreenElement({ input: "ship it" }))

        const textarea = container.querySelector("textarea[aria-label='Task input']")
        if (!(textarea instanceof HTMLTextAreaElement)) throw new Error("Missing task input textarea")
        expect(document.activeElement).not.toBe(textarea)

        act(() => {
            window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyL", key: "l", metaKey: true, bubbles: true }))
        })

        expect(document.activeElement).toBe(textarea)
        expect(textarea.selectionStart).toBe("ship it".length)
        expect(textarea.selectionEnd).toBe("ship it".length)
    })

    it("delegates the desktop focus shortcut to custom composer editors", () => {
        const actions: string[] = []
        render(
            createElement(TaskComposer, {
                input: "ship it",
                commandType: "do",
                isLoading: false,
                isSubmitting: false,
                isOnline: true,
                isRunning: false,
                editor: createElement("div", { role: "textbox" }, "Rich editor"),
                onFocusInputShortcut: () => actions.push("focus"),
                onInputChange: () => undefined,
                onCommandTypeChange: () => undefined,
                onSend: () => undefined,
                onAbort: () => undefined,
            })
        )

        act(() => {
            window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyL", key: "l", metaKey: true, bubbles: true }))
        })

        expect(actions).toEqual(["focus"])
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

    it("renders image attachment controls only when enabled", () => {
        const actions: string[] = []
        render(
            createElement(TaskComposer, {
                input: "ship it",
                commandType: "do",
                isLoading: false,
                isSubmitting: false,
                isOnline: true,
                isRunning: false,
                imageAttachments: [
                    {
                        attachment: {
                            id: "image-1",
                            ext: "png",
                            mediaType: "image/png",
                            originalWidth: 10,
                            originalHeight: 8,
                            resizedWidth: 10,
                            resizedHeight: 8,
                        },
                        dataUrl: "blob:image-1",
                    },
                ],
                onInputChange: (value) => actions.push(`input:${value}`),
                onCommandTypeChange: (value) => actions.push(`mode:${value}`),
                onRemoveImage: (imageId) => actions.push(`remove:${imageId}`),
                onSend: () => actions.push("send"),
                onAbort: () => actions.push("abort"),
            })
        )

        expect(container.querySelector("[aria-label='Attach image']")).toBeNull()
        expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:image-1")

        act(() => buttonByLabel(container, "Remove image").click())
        expect(actions).toEqual(["remove:image-1"])

        render(
            createElement(TaskComposer, {
                input: "ship it",
                commandType: "do",
                isLoading: false,
                isSubmitting: false,
                isOnline: true,
                isRunning: false,
                onAttachImage: (file) => actions.push(`attach:${file.name}`),
                onInputChange: (value) => actions.push(`input:${value}`),
                onCommandTypeChange: (value) => actions.push(`mode:${value}`),
                onSend: () => actions.push("send"),
            })
        )

        const input = container.querySelector("input[type='file']")
        if (!(input instanceof HTMLInputElement)) throw new Error("Missing file input")
        Object.defineProperty(input, "files", {
            value: [new File(["image"], "screen.png", { type: "image/png" })],
            configurable: true,
        })
        act(() => input.dispatchEvent(new Event("change", { bubbles: true })))

        expect(buttonByLabel(container, "Attach image").disabled).toBe(false)
        expect(actions).toContain("attach:screen.png")
    })

    it("accepts dropped images through the shared task screen", () => {
        const files: File[] = []
        render(taskScreenElement({ onAttachImage: (file) => files.push(file) }))

        const screen = container.firstElementChild
        if (!(screen instanceof HTMLElement)) throw new Error("Missing task screen")
        const transfer = new DataTransfer()
        const image = new File(["png"], "shot.png", { type: "image/png" })
        const text = new File(["text"], "notes.txt", { type: "text/plain" })
        transfer.items.add(image)
        transfer.items.add(text)

        act(() => {
            screen.dispatchEvent(new DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer: transfer }))
        })
        expect(container.textContent).toContain("Drop images here")

        act(() => {
            screen.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }))
        })

        expect(files).toEqual([image])
        expect(container.textContent).not.toContain("Drop images here")
    })
})
