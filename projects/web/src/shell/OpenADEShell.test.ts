import { type ComponentProps, type ReactElement, act, createElement } from "react"
import { type Root, createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { OpenADEProject, OpenADESnapshot, OpenADETaskPreview } from "../../../openade-module/src"
import { OpenADEShell } from "./OpenADEShell"

const taskPreview: OpenADETaskPreview = {
    id: "task-1",
    slug: "task-1",
    title: "Runtime task",
    createdAt: "2026-06-01T00:00:00.000Z",
}

const project: OpenADEProject = {
    id: "repo-1",
    name: "Runtime Repo",
    path: "/tmp/runtime-repo",
    tasks: [taskPreview],
}

const snapshot: OpenADESnapshot = {
    server: {
        version: "test",
        hostName: "Runtime Host",
        theme: { setting: "system", className: "code-theme-black", label: "Black" },
    },
    repos: [project],
    workingTaskIds: ["task-1"],
}

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
    const button = Array.from(container.querySelectorAll("button")).find((item): item is HTMLButtonElement => item.textContent?.includes(text) === true)
    if (!button) throw new Error(`Missing button: ${text}`)
    return button
}

function buttonByExactText(container: HTMLElement, text: string): HTMLButtonElement {
    const button = Array.from(container.querySelectorAll("button")).find((item): item is HTMLButtonElement => item.textContent?.trim() === text)
    if (!button) throw new Error(`Missing button: ${text}`)
    return button
}

function createProps(actions: string[] = []): ComponentProps<typeof OpenADEShell> {
    return {
        className: "code-theme code-theme-black flex bg-base-100 text-base-content flex-col overflow-hidden",
        screen: "projects",
        host: "Local Desktop",
        status: { label: "Connected", tone: "ok" },
        isLoading: false,
        isSubmitting: false,
        isOnline: true,
        error: null,
        notice: null,
        connectionWarning: null,
        sessions: [{ id: "session-1", host: "Local Desktop", snapshot, isActive: true }],
        showArchivedProjects: false,
        selectedRepo: project,
        selectedTask: taskPreview,
        visibleRepos: [project],
        workingTaskIds: snapshot.workingTaskIds,
        projectFiles: null,
        projectFilesLoading: false,
        projectFileRead: null,
        projectFileActionPath: null,
        projectSearchQuery: "",
        projectSearchResult: null,
        projectSearchLoading: false,
        projectProcesses: null,
        projectProcessesLoading: false,
        projectProcessActionId: null,
        projectProcessOutput: null,
        task: null,
        input: "",
        commandType: "do",
        taskTitleDraft: taskPreview.title,
        commentDraft: "",
        editingCommentId: null,
        editingCommentDraft: "",
        reviewInstructions: "",
        taskChanges: null,
        taskGitLog: null,
        taskChangesLoading: false,
        taskDiff: null,
        taskDiffActionPath: null,
        newTaskRepoId: project.id,
        newTaskMode: "do",
        newTaskTitle: "",
        newTaskPrompt: "",
        configs: [{ id: "session-1", host: "Local Desktop", baseUrl: "http://127.0.0.1:17373" }],
        activeConfigId: "session-1",
        settingsConfig: { id: "session-1", host: "Local Desktop", baseUrl: "http://127.0.0.1:17373" },
        snapshot,
        themeSetting: "desktop",
        onBack: () => actions.push("back"),
        onRefresh: () => actions.push("refresh"),
        onNavigate: (screen) => actions.push(`nav:${screen}`),
        onToggleArchivedProjects: () => actions.push("toggle-archived"),
        onSelectProject: (configId, repoId) => actions.push(`select-project:${configId}:${repoId}`),
        onAddHost: () => actions.push("add-host"),
        onSelectTask: (taskId) => actions.push(`select-task:${taskId}`),
        onNewTask: () => actions.push("new-task"),
        onRefreshProjectProcesses: () => actions.push("refresh-processes"),
        onStartProjectProcess: (definitionId) => actions.push(`start-process:${definitionId}`),
        onReconnectProjectProcess: (processId) => actions.push(`output-process:${processId}`),
        onStopProjectProcess: (processId) => actions.push(`stop-process:${processId}`),
        onRefreshProjectFiles: () => actions.push("refresh-files"),
        onReadProjectFile: (path) => actions.push(`read-file:${path}`),
        onProjectSearchQueryChange: (value) => actions.push(`search-query:${value}`),
        onSearchProject: () => actions.push("search-project"),
        onInputChange: (value) => actions.push(`input:${value}`),
        onCommandTypeChange: (value) => actions.push(`command:${value}`),
        onTaskTitleChange: (value) => actions.push(`title:${value}`),
        onSaveTaskTitle: () => actions.push("save-title"),
        onToggleTaskClosed: () => actions.push("toggle-closed"),
        onDeleteTask: () => actions.push("delete-task"),
        onCommentDraftChange: (value) => actions.push(`comment:${value}`),
        onCreateComment: () => actions.push("create-comment"),
        onStartEditComment: (comment) => actions.push(`start-edit:${comment.id}`),
        onEditingCommentDraftChange: (value) => actions.push(`edit-comment:${value}`),
        onSaveComment: (commentId) => actions.push(`save-comment:${commentId}`),
        onCancelEditComment: () => actions.push("cancel-edit-comment"),
        onDeleteComment: (commentId) => actions.push(`delete-comment:${commentId}`),
        onCancelQueuedTurn: (queuedTurnId) => actions.push(`cancel-queued:${queuedTurnId}`),
        onReviewInstructionsChange: (value) => actions.push(`review-instructions:${value}`),
        onStartReview: (reviewType) => actions.push(`start-review:${reviewType}`),
        onRefreshTaskGit: () => actions.push("refresh-task-git"),
        onReadTaskDiff: (file) => actions.push(`read-diff:${file.path}`),
        onSendTaskInput: () => actions.push("send-task-input"),
        onAbortTask: () => actions.push("abort-task"),
        onNewTaskRepoChange: (repoId) => actions.push(`new-task-repo:${repoId}`),
        onNewTaskModeChange: (value) => actions.push(`new-task-mode:${value}`),
        onNewTaskTitleChange: (value) => actions.push(`new-task-title:${value}`),
        onNewTaskPromptChange: (value) => actions.push(`new-task-prompt:${value}`),
        onCreateTask: () => actions.push("create-task"),
        onSelectHost: (configId) => actions.push(`select-host:${configId}`),
        onRemoveHost: (configId) => actions.push(`remove-host:${configId}`),
        onForget: () => actions.push("forget"),
        onSelfRevoke: () => actions.push("self-revoke"),
        onThemeChange: (value) => actions.push(`theme:${value}`),
    }
}

describe("OpenADEShell", () => {
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

    it("composes shared shell chrome with real project session DTOs", () => {
        const actions: string[] = []
        render(createElement(OpenADEShell, createProps(actions)))

        expect(container.textContent).toContain("Projects")
        expect(container.textContent).toContain("Local Desktop")
        expect(container.textContent).toContain("Connected")
        expect(container.textContent).toContain("Runtime Repo")
        expect(container.textContent).toContain("1 running")

        act(() => buttonByText(container, "Settings").click())
        act(() => buttonByExactText(container, "Session").click())
        act(() => buttonByText(container, "Runtime Repo").click())

        expect(actions).toEqual(["nav:settings", "add-host", "select-project:session-1:repo-1"])
    })

    it("keeps settings navigation and device actions inside the shared shell", () => {
        const actions: string[] = []
        render(createElement(OpenADEShell, { ...createProps(actions), screen: "settings" }))

        expect(container.textContent).toContain("Settings")
        expect(container.textContent).toContain("Revoke This Device")
        expect(container.textContent).toContain("Matching desktop: Black")

        act(() => buttonByText(container, "Manage Sessions").click())
        act(() => buttonByText(container, "Revoke This Device").click())

        expect(actions).toEqual(["nav:sessions", "self-revoke"])
    })
})
