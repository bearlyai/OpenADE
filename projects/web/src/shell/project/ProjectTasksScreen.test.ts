import { act, createElement, type ReactElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { OpenADEProject } from "../../../../openade-module/src"
import { ProjectTasksScreen } from "./ProjectTasksScreen"

const project: OpenADEProject = {
    id: "repo-1",
    name: "Runtime Project",
    path: "/tmp/runtime-project",
    tasks: [
        {
            id: "task-1",
            slug: "task-1",
            title: "Running task",
            createdAt: "2026-05-31T00:00:00.000Z",
            lastEvent: {
                type: "action",
                status: "in_progress",
                sourceLabel: "Do",
                sourceType: "do",
                at: "2026-05-31T00:01:00.000Z",
            },
        },
    ],
}

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
    const button = Array.from(container.querySelectorAll("button")).find((item): item is HTMLButtonElement => item.textContent?.includes(text) === true)
    if (!button) throw new Error(`Missing button: ${text}`)
    return button
}

function queryButtonByText(container: HTMLElement, text: string): HTMLButtonElement | null {
    return Array.from(container.querySelectorAll("button")).find((item): item is HTMLButtonElement => item.textContent?.includes(text) === true) ?? null
}

function buttonByLabel(container: HTMLElement, label: string): HTMLButtonElement {
    const button = Array.from(container.querySelectorAll("button")).find((item): item is HTMLButtonElement => item.getAttribute("aria-label") === label)
    if (!button) throw new Error(`Missing button: ${label}`)
    return button
}

function textareaByLabel(container: HTMLElement, label: string): HTMLTextAreaElement {
    const textarea = Array.from(container.querySelectorAll("textarea")).find((item): item is HTMLTextAreaElement => item.getAttribute("aria-label") === label)
    if (!textarea) throw new Error(`Missing textarea: ${label}`)
    return textarea
}

function typeInto(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
    act(() => {
        const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value")
        descriptor?.set?.call(element, value)
        element.dispatchEvent(new Event("input", { bubbles: true }))
        element.dispatchEvent(new Event("change", { bubbles: true }))
    })
}

const fullFileCapabilities = { canList: true, canRead: true, canSearch: true, canWrite: true }
const fullSearchCapabilities = { canSearch: true, canOpenFile: true }
const fullGitCapabilities = { canRead: true }
const fullCronCapabilities = { canRead: true }
const fullProcessCapabilities = {
    canRead: true,
    canStart: true,
    canReconnect: true,
    canStop: true,
}

describe("ProjectTasksScreen", () => {
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

    it("renders project host panels and task rows from OpenADE DTOs", () => {
        const actions: string[] = []
        render(
            createElement(ProjectTasksScreen, {
                repo: project,
                workingTaskIds: ["task-1"],
                files: {
                    repoId: "repo-1",
                    path: "",
                    entries: [{ path: "README.md", name: "README.md", type: "file", size: 20 }],
                    truncated: false,
                },
                filesLoading: false,
                fileRead: { repoId: "repo-1", path: "README.md", encoding: "utf8", size: 20, tooLarge: false, content: "readme content" },
                fileActionPath: null,
                fileSearchQuery: "read",
                fileSearchResult: { repoId: "repo-1", results: ["README.md"], truncated: false, source: "filesystem" },
                fileSearchLoading: false,
                searchQuery: "readme",
                searchResult: {
                    repoId: "repo-1",
                    matches: [{ path: "README.md", line: 1, content: "readme content", matchStart: 0, matchEnd: 6 }],
                    truncated: false,
                },
                searchLoading: false,
                gitInfo: {
                    repoId: "repo-1",
                    isGitRepo: true,
                    repoRoot: "/tmp/runtime-project",
                    relativePath: "",
                    mainBranch: "main",
                    hasGhCli: true,
                },
                gitBranches: {
                    repoId: "repo-1",
                    defaultBranch: "main",
                    branches: [
                        { name: "main", isDefault: true, isRemote: false },
                        { name: "feature/runtime", isDefault: false, isRemote: false },
                    ],
                },
                gitSummary: {
                    repoId: "repo-1",
                    branch: "feature/runtime",
                    headCommit: "1234567890abcdef",
                    ahead: 1,
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
                gitLoading: false,
                cronDefinitions: {
                    repoId: "repo-1",
                    repoRoot: "/tmp/runtime-project",
                    searchRoot: "/tmp/runtime-project",
                    isWorktree: false,
                    configs: [
                        {
                            relativePath: "openade.toml",
                            crons: [
                                {
                                    id: "openade.toml::Nightly",
                                    name: "Nightly",
                                    schedule: "0 1 * * *",
                                    type: "do",
                                    prompt: "Run nightly checks",
                                    harness: "codex",
                                    isolation: "head",
                                },
                            ],
                        },
                    ],
                    errors: [],
                },
                cronDefinitionsLoading: false,
                processes: {
                    repoId: "repo-1",
                    repoRoot: "/tmp/runtime-project",
                    searchRoot: "/tmp/runtime-project",
                    isWorktree: false,
                    processes: [
                        { id: "proc-1", name: "Dev Server", command: "npm start", type: "task", configPath: "openade.toml", cwd: "/tmp/runtime-project" },
                    ],
                    instances: [
                        {
                            processId: "proc-running",
                            definitionId: "proc-1",
                            repoId: "repo-1",
                            cwd: "/tmp/runtime-project",
                            completed: false,
                            exitCode: null,
                            signal: null,
                        },
                    ],
                    errors: [],
                },
                processesLoading: false,
                processActionId: null,
                processOutput: {
                    repoId: "repo-1",
                    processId: "proc-running",
                    found: true,
                    completed: false,
                    output: [
                        { type: "stdout", data: "dev server ready\n", timestamp: 1 },
                        { type: "stderr", data: "watch warning\n", timestamp: 2 },
                    ],
                },
                fileCapabilities: fullFileCapabilities,
                searchCapabilities: fullSearchCapabilities,
                gitCapabilities: fullGitCapabilities,
                cronCapabilities: fullCronCapabilities,
                processCapabilities: fullProcessCapabilities,
                canCreateTask: true,
                onSelectTask: (taskId) => actions.push(`task:${taskId}`),
                onNewTask: () => actions.push("new-task"),
                onRefreshFiles: () => actions.push("refresh-files"),
                onReadFile: (path) => actions.push(`file:${path}`),
                onFileSearchQueryChange: (value) => actions.push(`file-search-query:${value}`),
                onSearchFiles: () => actions.push("file-search"),
                onWriteFile: (path, content) => actions.push(`write-file:${path}:${content}`),
                onSearchQueryChange: (value) => actions.push(`search-query:${value}`),
                onSearch: () => actions.push("search"),
                onRefreshGit: () => actions.push("refresh-git"),
                onRefreshCronDefinitions: () => actions.push("refresh-crons"),
                onRefreshProcesses: () => actions.push("refresh-processes"),
                onStartProcess: (definitionId) => actions.push(`start-process:${definitionId}`),
                onReconnectProcess: (processId) => actions.push(`output-process:${processId}`),
                onStopProcess: (processId) => actions.push(`stop-process:${processId}`),
            })
        )

        expect(container.textContent).toContain("Runtime Project")
        expect(container.textContent).toContain("README.md")
        expect(container.textContent).toContain("Find")
        expect(container.textContent).toContain("feature/runtime")
        expect(container.textContent).toContain("1 changed file")
        expect(container.textContent).toContain("Nightly")
        expect(container.textContent).toContain("0 1 * * *")
        expect(container.textContent).toContain("Dev Server")
        expect(container.textContent).toContain("dev server ready")
        expect(container.textContent).toContain("watch warning")
        expect(container.textContent).toContain("Running task")
        expect(textareaByLabel(container, "File contents").value).toBe("readme content")

        act(() => buttonByText(container, "New").click())
        act(() => buttonByText(container, "Refresh").click())
        act(() => buttonByLabel(container, "Refresh project crons").click())
        act(() => buttonByText(container, "Find").click())
        act(() => buttonByText(container, "README.md").click())
        typeInto(textareaByLabel(container, "File contents"), "updated readme content")
        act(() => buttonByText(container, "Save").click())
        act(() => buttonByText(container, "Output").click())
        act(() => buttonByText(container, "Stop").click())
        act(() => buttonByText(container, "Running task").click())

        expect(actions).toEqual([
            "new-task",
            "refresh-git",
            "refresh-crons",
            "file-search",
            "file:README.md",
            "write-file:README.md:updated readme content",
            "output-process:proc-running",
            "stop-process:proc-running",
            "task:task-1",
        ])
    })

    it("keeps process output available while hiding denied start and stop controls", () => {
        const actions: string[] = []
        render(
            createElement(ProjectTasksScreen, {
                repo: project,
                workingTaskIds: [],
                files: null,
                filesLoading: false,
                fileRead: null,
                fileActionPath: null,
                fileSearchQuery: "",
                fileSearchResult: null,
                fileSearchLoading: false,
                searchQuery: "",
                searchResult: null,
                searchLoading: false,
                gitInfo: null,
                gitBranches: null,
                gitSummary: null,
                gitLoading: false,
                cronDefinitions: null,
                cronDefinitionsLoading: false,
                processes: {
                    repoId: "repo-1",
                    repoRoot: "/tmp/runtime-project",
                    searchRoot: "/tmp/runtime-project",
                    isWorktree: false,
                    processes: [
                        {
                            id: "proc-running-def",
                            name: "Running Server",
                            command: "npm run dev",
                            type: "daemon",
                            configPath: "openade.toml",
                            cwd: "/tmp/runtime-project",
                        },
                        {
                            id: "proc-stopped-def",
                            name: "Stopped Worker",
                            command: "npm run worker",
                            type: "task",
                            configPath: "openade.toml",
                            cwd: "/tmp/runtime-project",
                        },
                    ],
                    instances: [
                        {
                            processId: "proc-running",
                            definitionId: "proc-running-def",
                            repoId: "repo-1",
                            cwd: "/tmp/runtime-project",
                            completed: false,
                            exitCode: null,
                            signal: null,
                        },
                    ],
                    errors: [],
                },
                processesLoading: false,
                processActionId: null,
                processOutput: null,
                fileCapabilities: fullFileCapabilities,
                searchCapabilities: fullSearchCapabilities,
                gitCapabilities: fullGitCapabilities,
                cronCapabilities: fullCronCapabilities,
                processCapabilities: {
                    canRead: true,
                    canStart: false,
                    canReconnect: true,
                    canStop: false,
                },
                canCreateTask: true,
                onSelectTask: (taskId) => actions.push(`task:${taskId}`),
                onNewTask: () => actions.push("new-task"),
                onRefreshFiles: () => actions.push("refresh-files"),
                onReadFile: (path) => actions.push(`file:${path}`),
                onFileSearchQueryChange: (value) => actions.push(`file-search-query:${value}`),
                onSearchFiles: () => actions.push("file-search"),
                onWriteFile: (path, content) => actions.push(`write-file:${path}:${content}`),
                onSearchQueryChange: (value) => actions.push(`search-query:${value}`),
                onSearch: () => actions.push("search"),
                onRefreshGit: () => actions.push("refresh-git"),
                onRefreshCronDefinitions: () => actions.push("refresh-crons"),
                onRefreshProcesses: () => actions.push("refresh-processes"),
                onStartProcess: (definitionId) => actions.push(`start-process:${definitionId}`),
                onReconnectProcess: (processId) => actions.push(`output-process:${processId}`),
                onStopProcess: (processId) => actions.push(`stop-process:${processId}`),
            })
        )

        expect(container.textContent).toContain("Running Server")
        expect(container.textContent).toContain("Stopped Worker")
        expect(buttonByText(container, "Output")).toBeTruthy()
        expect(Array.from(container.querySelectorAll("button")).some((button) => button.textContent?.includes("Start"))).toBe(false)
        expect(Array.from(container.querySelectorAll("button")).some((button) => button.textContent?.includes("Stop"))).toBe(false)

        act(() => buttonByText(container, "Output").click())

        expect(actions).toEqual(["output-process:proc-running"])
    })

    it("hides project task creation when turn start is not granted", () => {
        render(
            createElement(ProjectTasksScreen, {
                repo: project,
                workingTaskIds: [],
                files: null,
                filesLoading: false,
                fileRead: null,
                fileActionPath: null,
                fileSearchQuery: "",
                fileSearchResult: null,
                fileSearchLoading: false,
                searchQuery: "",
                searchResult: null,
                searchLoading: false,
                gitInfo: null,
                gitBranches: null,
                gitSummary: null,
                gitLoading: false,
                cronDefinitions: null,
                cronDefinitionsLoading: false,
                processes: null,
                processesLoading: false,
                processActionId: null,
                processOutput: null,
                fileCapabilities: fullFileCapabilities,
                searchCapabilities: fullSearchCapabilities,
                gitCapabilities: fullGitCapabilities,
                cronCapabilities: fullCronCapabilities,
                processCapabilities: fullProcessCapabilities,
                canCreateTask: false,
                onSelectTask: () => undefined,
                onNewTask: () => {
                    throw new Error("new task should be unavailable")
                },
                onRefreshFiles: () => undefined,
                onReadFile: () => undefined,
                onFileSearchQueryChange: () => undefined,
                onSearchFiles: () => undefined,
                onWriteFile: () => undefined,
                onSearchQueryChange: () => undefined,
                onSearch: () => undefined,
                onRefreshGit: () => undefined,
                onRefreshCronDefinitions: () => undefined,
                onRefreshProcesses: () => undefined,
                onStartProcess: () => undefined,
                onReconnectProcess: () => undefined,
                onStopProcess: () => undefined,
            })
        )

        expect(container.textContent).toContain("Runtime Project")
        expect(queryButtonByText(container, "New")).toBeNull()
    })
})
