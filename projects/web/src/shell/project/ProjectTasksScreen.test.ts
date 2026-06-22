import { type ComponentProps, type ReactElement, act, createElement } from "react"
import { type Root, createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { OpenADEProject } from "../../../../openade-module/src"
import { ProjectCronPanel, ProjectFilesPanel, ProjectGitPanel, ProjectProcessesPanel, ProjectSearchPanel } from "./ProjectHostPanels"
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

function buttonByTitle(container: HTMLElement, title: string): HTMLButtonElement {
    const button = Array.from(container.querySelectorAll("button")).find((item): item is HTMLButtonElement => item.getAttribute("title") === title)
    if (!button) throw new Error(`Missing button: ${title}`)
    return button
}

function queryButtonByTitle(container: HTMLElement, title: string): HTMLButtonElement | null {
    return Array.from(container.querySelectorAll("button")).find((item): item is HTMLButtonElement => item.getAttribute("title") === title) ?? null
}

function buttonByLabel(container: HTMLElement, label: string): HTMLButtonElement {
    const button = Array.from(container.querySelectorAll("button")).find((item): item is HTMLButtonElement => item.getAttribute("aria-label") === label)
    if (!button) throw new Error(`Missing button: ${label}`)
    return button
}

function queryButtonByLabel(container: HTMLElement, label: string): HTMLButtonElement | null {
    return Array.from(container.querySelectorAll("button")).find((item): item is HTMLButtonElement => item.getAttribute("aria-label") === label) ?? null
}

function inputByLabel(container: HTMLElement, label: string): HTMLInputElement {
    const input = Array.from(container.querySelectorAll("input")).find((item): item is HTMLInputElement => item.getAttribute("aria-label") === label)
    if (!input) throw new Error(`Missing input: ${label}`)
    return input
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
const fullSearchCapabilities = { canSearch: true }
const fullGitCapabilities = { canReadInfo: true, canReadBranches: true, canReadSummary: true }
const fullCronCapabilities = { canRead: true, canReadInstallState: true, canReplaceInstallState: true, canRun: true }
const fullProcessCapabilities = { canRead: true, canStart: true, canReconnect: true, canStop: true }
const readOnlyProcessCapabilities = { canRead: true, canStart: false, canReconnect: false, canStop: false }

function projectTasksElement(overrides: Partial<ComponentProps<typeof ProjectTasksScreen>> = {}): ReactElement {
    const props: ComponentProps<typeof ProjectTasksScreen> = {
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
        cronInstallState: null,
        cronDefinitionsLoading: false,
        cronInstallStateLoading: false,
        cronInstallActionId: null,
        processes: null,
        processesLoading: false,
        processActionId: null,
        processOutput: null,
        fileCapabilities: fullFileCapabilities,
        searchCapabilities: fullSearchCapabilities,
        gitCapabilities: fullGitCapabilities,
        cronCapabilities: fullCronCapabilities,
        processCapabilities: fullProcessCapabilities,
        projectActionLoading: false,
        onSelectTask: () => undefined,
        onNewTask: () => undefined,
        onRefreshFiles: () => undefined,
        onReadFile: () => undefined,
        onFileSearchQueryChange: () => undefined,
        onSearchFiles: () => undefined,
        onWriteFile: () => undefined,
        onSearchQueryChange: () => undefined,
        onSearch: () => undefined,
        onRefreshGit: () => undefined,
        onRefreshCronDefinitions: () => undefined,
        onRefreshCronInstallState: () => undefined,
        onSetCronEnabled: () => undefined,
        onRunCron: () => undefined,
        onRefreshProcesses: () => undefined,
        onStartProcess: () => undefined,
        onReconnectProcess: () => undefined,
        onStopProcess: () => undefined,
        ...overrides,
    }
    return createElement(ProjectTasksScreen, props)
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

    it("renders project git panel for partial git grants", () => {
        const actions: string[] = []
        render(
            createElement(ProjectGitPanel, {
                info: null,
                branches: null,
                summary: {
                    repoId: "repo-1",
                    branch: "feature/runtime",
                    headCommit: "abcdef1234567890",
                    ahead: 0,
                    hasChanges: true,
                    staged: { files: [], stats: { filesChanged: 0, insertions: 0, deletions: 0 } },
                    unstaged: {
                        files: [
                            {
                                path: "src/app.ts",
                                status: "modified",
                            },
                        ],
                        stats: { filesChanged: 1, insertions: 1, deletions: 0 },
                    },
                    untracked: [{ path: "README.md", status: "added" }],
                },
                loading: false,
                capabilities: { canReadInfo: false, canReadBranches: false, canReadSummary: true },
                onRefresh: () => actions.push("refresh-git"),
            })
        )

        expect(container.textContent).toContain("Git")
        expect(container.textContent).toContain("feature/runtime")
        expect(container.textContent).toContain("abcdef12")
        expect(container.textContent).toContain("2 changed files")

        act(() => buttonByText(container, "Refresh").click())
        expect(actions).toEqual(["refresh-git"])

        render(
            createElement(ProjectGitPanel, {
                info: null,
                branches: null,
                summary: null,
                loading: false,
                capabilities: { canReadInfo: false, canReadBranches: false, canReadSummary: false },
                onRefresh: () => actions.push("hidden-refresh"),
            })
        )

        expect(container.textContent).not.toContain("Git")
        expect(actions).toEqual(["refresh-git"])
    })

    it("filters stale project git DTOs after granular git capabilities disappear", () => {
        render(
            createElement(ProjectGitPanel, {
                info: {
                    repoId: "repo-1",
                    isGitRepo: true,
                    repoRoot: "/tmp/runtime-project",
                    relativePath: "",
                    mainBranch: "stale-main",
                    hasGhCli: true,
                },
                branches: {
                    repoId: "repo-1",
                    defaultBranch: "stale-main",
                    branches: [
                        { name: "stale-main", isDefault: true, isRemote: false },
                        { name: "stale-feature", isDefault: false, isRemote: false },
                    ],
                },
                summary: {
                    repoId: "repo-1",
                    branch: "feature/runtime",
                    headCommit: "abcdef1234567890",
                    ahead: 0,
                    hasChanges: false,
                    staged: { files: [], stats: { filesChanged: 0, insertions: 0, deletions: 0 } },
                    unstaged: { files: [], stats: { filesChanged: 0, insertions: 0, deletions: 0 } },
                    untracked: [],
                },
                loading: false,
                capabilities: { canReadInfo: false, canReadBranches: false, canReadSummary: true },
                onRefresh: () => undefined,
            })
        )

        expect(container.textContent).toContain("feature/runtime")
        expect(container.textContent).toContain("abcdef12")
        expect(container.textContent).not.toContain("stale-main")
        expect(container.textContent).not.toContain("stale-feature")
    })

    it("filters stale project file DTOs after read and search capabilities disappear", () => {
        render(
            createElement(ProjectFilesPanel, {
                files: {
                    repoId: "repo-1",
                    path: "",
                    entries: [{ path: "README.md", name: "README.md", type: "file", size: 20 }],
                    truncated: false,
                },
                loading: false,
                fileRead: {
                    repoId: "repo-1",
                    path: "secret.txt",
                    encoding: "utf8",
                    size: 18,
                    tooLarge: false,
                    content: "stale secret data",
                },
                actionPath: null,
                fileSearchQuery: "secret",
                fileSearchResult: {
                    repoId: "repo-1",
                    results: ["secret.txt"],
                    truncated: false,
                    source: "filesystem",
                },
                fileSearchLoading: false,
                capabilities: { canList: true, canRead: false, canSearch: false, canWrite: false },
                onRefresh: () => undefined,
                onReadFile: undefined,
                onFileSearchQueryChange: () => undefined,
                onSearchFiles: undefined,
                onWriteFile: undefined,
            })
        )

        expect(container.textContent).toContain("README.md")
        expect(container.textContent).not.toContain("stale secret data")
        expect(container.textContent).not.toContain("secret.txt")
        expect(container.querySelector('input[aria-label="Find file"]')).toBeNull()
    })

    it("drops an unsaved project file draft when the file write handler disappears", () => {
        const fileRead = {
            repoId: "repo-1",
            path: "README.md",
            encoding: "utf8" as const,
            size: 14,
            tooLarge: false,
            content: "readme content",
        }
        const renderFilesPanel = (hasWriteHandler: boolean) =>
            render(
                createElement(ProjectFilesPanel, {
                    files: {
                        repoId: "repo-1",
                        path: "",
                        entries: [{ path: "README.md", name: "README.md", type: "file", size: 14 }],
                        truncated: false,
                    },
                    loading: false,
                    fileRead,
                    actionPath: null,
                    fileSearchQuery: "",
                    fileSearchResult: null,
                    fileSearchLoading: false,
                    capabilities: { canList: true, canRead: true, canSearch: false, canWrite: true },
                    onRefresh: () => undefined,
                    onReadFile: () => undefined,
                    onFileSearchQueryChange: () => undefined,
                    onSearchFiles: () => undefined,
                    onWriteFile: hasWriteHandler
                        ? () => {
                              throw new Error("file write should not run from stale draft")
                          }
                        : undefined,
                })
            )

        renderFilesPanel(true)
        typeInto(textareaByLabel(container, "File contents"), "unsaved draft")
        expect(textareaByLabel(container, "File contents").value).toBe("unsaved draft")

        renderFilesPanel(false)
        expect(container.querySelector('textarea[aria-label="File contents"]')).toBeNull()
        expect(container.textContent).toContain("readme content")
        expect(container.textContent).not.toContain("unsaved draft")

        renderFilesPanel(true)
        expect(textareaByLabel(container, "File contents").value).toBe("readme content")
    })

    it("keeps project host actions unavailable when handlers are withheld", () => {
        render(
            createElement("div", null, [
                createElement(ProjectGitPanel, {
                    key: "git",
                    info: null,
                    branches: null,
                    summary: null,
                    loading: false,
                    capabilities: fullGitCapabilities,
                }),
                createElement(ProjectCronPanel, {
                    key: "cron",
                    definitions: {
                        repoId: "repo-1",
                        repoRoot: "/tmp/runtime-project",
                        searchRoot: "/tmp/runtime-project",
                        isWorktree: false,
                        configs: [
                            {
                                relativePath: "openade.toml",
                                crons: [{ id: "openade.toml::Nightly", name: "Nightly", schedule: "0 1 * * *", type: "do", prompt: "Run nightly checks" }],
                            },
                        ],
                        errors: [],
                    },
                    installState: {
                        repoId: "repo-1",
                        installations: {
                            "openade.toml::Nightly": {
                                cronId: "openade.toml::Nightly",
                                enabled: true,
                                installedAt: "2026-05-31T00:00:00.000Z",
                            },
                        },
                    },
                    loading: false,
                    installStateLoading: false,
                    installActionId: null,
                    capabilities: fullCronCapabilities,
                }),
                createElement(ProjectFilesPanel, {
                    key: "files",
                    files: {
                        repoId: "repo-1",
                        path: "",
                        entries: [{ path: "README.md", name: "README.md", type: "file", size: 14 }],
                        truncated: false,
                    },
                    loading: false,
                    fileRead: {
                        repoId: "repo-1",
                        path: "README.md",
                        encoding: "utf8",
                        size: 14,
                        tooLarge: false,
                        content: "readme content",
                    },
                    actionPath: null,
                    fileSearchQuery: "readme",
                    fileSearchResult: { repoId: "repo-1", results: ["README.md"], truncated: false, source: "filesystem" },
                    fileSearchLoading: false,
                    capabilities: fullFileCapabilities,
                    onFileSearchQueryChange: () => undefined,
                }),
                createElement(ProjectSearchPanel, {
                    key: "search",
                    query: "readme",
                    result: {
                        repoId: "repo-1",
                        matches: [{ path: "README.md", line: 1, matchStart: 1, matchEnd: 6, content: "readme content" }],
                        truncated: false,
                    },
                    loading: false,
                    capabilities: fullSearchCapabilities,
                    onQueryChange: () => undefined,
                }),
                createElement(ProjectProcessesPanel, {
                    key: "processes",
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
                    loading: false,
                    actionId: null,
                    output: null,
                    capabilities: fullProcessCapabilities,
                }),
            ])
        )

        expect(queryButtonByText(container, "Load Git")).toBeNull()
        expect(queryButtonByLabel(container, "Refresh project crons")).toBeNull()
        expect(queryButtonByLabel(container, "Refresh cron install state")).toBeNull()
        expect(queryButtonByTitle(container, "Run cron now")).toBeNull()
        expect(queryButtonByText(container, "Pause")).toBeNull()
        expect(queryButtonByText(container, "Load Files")).toBeNull()
        expect(container.querySelector('input[aria-label="Find file"]')).toBeNull()
        expect(queryButtonByText(container, "Save")).toBeNull()
        expect(buttonByText(container, "README.md").disabled).toBe(true)
        expect(buttonByText(container, "Search").disabled).toBe(true)
        expect(queryButtonByText(container, "Load Processes")).toBeNull()
        expect(queryButtonByText(container, "Output")).toBeNull()
        expect(queryButtonByText(container, "Stop")).toBeNull()
        expect(queryButtonByText(container, "Start")).toBeNull()
    })

    it("intersects stale project host handlers with denied capabilities", () => {
        const actions: string[] = []
        render(
            createElement("div", null, [
                createElement(ProjectCronPanel, {
                    key: "cron",
                    definitions: {
                        repoId: "repo-1",
                        repoRoot: "/tmp/runtime-project",
                        searchRoot: "/tmp/runtime-project",
                        isWorktree: false,
                        configs: [
                            {
                                relativePath: "openade.toml",
                                crons: [{ id: "openade.toml::Nightly", name: "Nightly", schedule: "0 1 * * *", type: "do", prompt: "Run nightly checks" }],
                            },
                        ],
                        errors: [],
                    },
                    installState: {
                        repoId: "repo-1",
                        installations: {
                            "openade.toml::Nightly": {
                                cronId: "openade.toml::Nightly",
                                enabled: true,
                                installedAt: "2026-05-31T00:00:00.000Z",
                            },
                        },
                    },
                    loading: false,
                    installStateLoading: true,
                    installActionId: "openade.toml::Nightly",
                    capabilities: { canRead: true, canReadInstallState: false, canReplaceInstallState: false, canRun: false },
                    onRefresh: () => actions.push("refresh-crons"),
                    onRefreshInstallState: () => actions.push("refresh-cron-state"),
                    onSetCronEnabled: (cronId, enabled) => actions.push(`set-cron:${cronId}:${enabled}`),
                    onRunCron: (cronId) => actions.push(`run-cron:${cronId}`),
                }),
                createElement(ProjectFilesPanel, {
                    key: "files",
                    files: {
                        repoId: "repo-1",
                        path: "",
                        entries: [{ path: "README.md", name: "README.md", type: "file", size: 14 }],
                        truncated: false,
                    },
                    loading: false,
                    fileRead: {
                        repoId: "repo-1",
                        path: "README.md",
                        encoding: "utf8",
                        size: 14,
                        tooLarge: false,
                        content: "stale readme content",
                    },
                    actionPath: "README.md",
                    fileSearchQuery: "readme",
                    fileSearchResult: { repoId: "repo-1", results: ["README.md"], truncated: false, source: "filesystem" },
                    fileSearchLoading: true,
                    capabilities: { canList: true, canRead: false, canSearch: false, canWrite: false },
                    onRefresh: () => actions.push("refresh-files"),
                    onReadFile: (path) => actions.push(`read-file:${path}`),
                    onFileSearchQueryChange: (value) => actions.push(`file-query:${value}`),
                    onSearchFiles: () => actions.push("search-files"),
                    onWriteFile: (path) => actions.push(`write-file:${path}`),
                }),
                createElement(ProjectProcessesPanel, {
                    key: "processes",
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
                    loading: false,
                    actionId: "proc-running",
                    output: {
                        repoId: "repo-1",
                        processId: "proc-running",
                        found: true,
                        completed: false,
                        output: [{ type: "stdout", data: "stale process output\n", timestamp: 1 }],
                    },
                    capabilities: readOnlyProcessCapabilities,
                    onRefresh: () => actions.push("refresh-processes"),
                    onStart: (definitionId) => actions.push(`start-process:${definitionId}`),
                    onReconnect: (processId) => actions.push(`output-process:${processId}`),
                    onStop: (processId) => actions.push(`stop-process:${processId}`),
                }),
            ])
        )

        expect(queryButtonByLabel(container, "Refresh cron install state")).toBeNull()
        expect(queryButtonByTitle(container, "Run cron now")).toBeNull()
        expect(queryButtonByText(container, "Pause")).toBeNull()
        expect(container.querySelector('input[aria-label="Find file"]')).toBeNull()
        expect(container.textContent).not.toContain("stale readme content")
        const readmeButton = buttonByText(container, "README.md")
        expect(readmeButton.disabled).toBe(true)
        act(() => readmeButton.click())
        expect(container.textContent).not.toContain("stale process output")
        expect(queryButtonByText(container, "Output")).toBeNull()
        expect(queryButtonByText(container, "Stop")).toBeNull()
        expect(queryButtonByText(container, "Start")).toBeNull()
        expect(actions).toEqual([])
    })

    it("filters stale project process output when reconnect capability disappears", () => {
        render(
            createElement(ProjectProcessesPanel, {
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
                loading: false,
                actionId: null,
                output: {
                    repoId: "repo-1",
                    processId: "proc-running",
                    found: true,
                    completed: false,
                    output: [{ type: "stdout", data: "stale process output\n", timestamp: 1 }],
                },
                capabilities: readOnlyProcessCapabilities,
                onRefresh: () => undefined,
                onStart: undefined,
                onReconnect: undefined,
                onStop: undefined,
            })
        )

        expect(container.textContent).toContain("Dev Server")
        expect(container.textContent).toContain("Running")
        expect(container.textContent).not.toContain("stale process output")
        expect(queryButtonByText(container, "Output")).toBeNull()
    })

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
                cronInstallState: {
                    repoId: "repo-1",
                    installations: {
                        "openade.toml::Nightly": {
                            cronId: "openade.toml::Nightly",
                            enabled: true,
                            installedAt: "2026-05-31T00:00:00.000Z",
                            lastTaskId: "task-last",
                        },
                    },
                },
                cronDefinitionsLoading: false,
                cronInstallStateLoading: false,
                cronInstallActionId: null,
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
                projectActionLoading: false,
                onSelectTask: (taskId) => actions.push(`task:${taskId}`),
                onNewTask: () => actions.push("new-task"),
                onUpdateProject: (input) => {
                    actions.push(`update-project:${input.repoId}:${input.name ?? ""}:${input.path ?? ""}:${input.archived ?? ""}`)
                    return true
                },
                onDeleteProject: (repoId) => {
                    actions.push(`delete-project:${repoId}`)
                    return true
                },
                onRefreshFiles: () => actions.push("refresh-files"),
                onReadFile: (path) => actions.push(`file:${path}`),
                onFileSearchQueryChange: (value) => actions.push(`file-search-query:${value}`),
                onSearchFiles: () => actions.push("file-search"),
                onWriteFile: (path, content) => actions.push(`write-file:${path}:${content}`),
                onSearchQueryChange: (value) => actions.push(`search-query:${value}`),
                onSearch: () => actions.push("search"),
                onRefreshGit: () => actions.push("refresh-git"),
                onRefreshCronDefinitions: () => actions.push("refresh-crons"),
                onRefreshCronInstallState: () => actions.push("refresh-cron-state"),
                onSetCronEnabled: (cronId, enabled) => actions.push(`set-cron:${cronId}:${enabled}`),
                onRunCron: (cronId) => actions.push(`run-cron:${cronId}`),
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
        expect(container.textContent).toContain("Enabled")
        expect(container.textContent).toContain("task-last")
        expect(container.textContent).toContain("Dev Server")
        expect(container.textContent).toContain("dev server ready")
        expect(container.textContent).toContain("watch warning")
        expect(container.textContent).toContain("Running task")
        expect(textareaByLabel(container, "File contents").value).toBe("readme content")

        act(() => buttonByText(container, "New").click())
        act(() => buttonByText(container, "Refresh").click())
        act(() => buttonByLabel(container, "Refresh project crons").click())
        act(() => buttonByLabel(container, "Refresh cron install state").click())
        act(() => buttonByTitle(container, "Run cron now").click())
        act(() => buttonByText(container, "Pause").click())
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
            "refresh-cron-state",
            "run-cron:openade.toml::Nightly",
            "set-cron:openade.toml::Nightly:false",
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
                cronInstallState: null,
                cronDefinitionsLoading: false,
                cronInstallStateLoading: false,
                cronInstallActionId: null,
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
                processCapabilities: fullProcessCapabilities,
                projectActionLoading: false,
                onSelectTask: (taskId) => actions.push(`task:${taskId}`),
                onNewTask: () => actions.push("new-task"),
                onUpdateProject: (input) => {
                    actions.push(`update-project:${input.repoId}:${input.name ?? ""}:${input.path ?? ""}:${input.archived ?? ""}`)
                    return true
                },
                onDeleteProject: (repoId) => {
                    actions.push(`delete-project:${repoId}`)
                    return true
                },
                onRefreshFiles: () => actions.push("refresh-files"),
                onReadFile: (path) => actions.push(`file:${path}`),
                onFileSearchQueryChange: (value) => actions.push(`file-search-query:${value}`),
                onSearchFiles: () => actions.push("file-search"),
                onWriteFile: (path, content) => actions.push(`write-file:${path}:${content}`),
                onSearchQueryChange: (value) => actions.push(`search-query:${value}`),
                onSearch: () => actions.push("search"),
                onRefreshGit: () => actions.push("refresh-git"),
                onRefreshCronDefinitions: () => actions.push("refresh-crons"),
                onRefreshCronInstallState: () => actions.push("refresh-cron-state"),
                onSetCronEnabled: (cronId, enabled) => actions.push(`set-cron:${cronId}:${enabled}`),
                onRunCron: (cronId) => actions.push(`run-cron:${cronId}`),
                onRefreshProcesses: () => actions.push("refresh-processes"),
                onReconnectProcess: (processId) => actions.push(`output-process:${processId}`),
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

    it("hides cron install-state controls when those capabilities are denied", () => {
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
                                },
                            ],
                        },
                    ],
                    errors: [],
                },
                cronInstallState: {
                    repoId: "repo-1",
                    installations: {
                        "openade.toml::Nightly": {
                            cronId: "openade.toml::Nightly",
                            enabled: true,
                            installedAt: "2026-05-31T00:00:00.000Z",
                        },
                    },
                },
                cronDefinitionsLoading: false,
                cronInstallStateLoading: false,
                cronInstallActionId: null,
                processes: null,
                processesLoading: false,
                processActionId: null,
                processOutput: null,
                fileCapabilities: fullFileCapabilities,
                searchCapabilities: fullSearchCapabilities,
                gitCapabilities: fullGitCapabilities,
                cronCapabilities: { canRead: true, canReadInstallState: false, canReplaceInstallState: false, canRun: true },
                processCapabilities: fullProcessCapabilities,
                projectActionLoading: false,
                onSelectTask: (taskId) => actions.push(`task:${taskId}`),
                onNewTask: () => actions.push("new-task"),
                onUpdateProject: (input) => {
                    actions.push(`update-project:${input.repoId}:${input.name ?? ""}:${input.path ?? ""}:${input.archived ?? ""}`)
                    return true
                },
                onDeleteProject: (repoId) => {
                    actions.push(`delete-project:${repoId}`)
                    return true
                },
                onRefreshFiles: () => actions.push("refresh-files"),
                onReadFile: (path) => actions.push(`file:${path}`),
                onFileSearchQueryChange: (value) => actions.push(`file-search-query:${value}`),
                onSearchFiles: () => actions.push("file-search"),
                onWriteFile: (path, content) => actions.push(`write-file:${path}:${content}`),
                onSearchQueryChange: (value) => actions.push(`search-query:${value}`),
                onSearch: () => actions.push("search"),
                onRefreshGit: () => actions.push("refresh-git"),
                onRefreshCronDefinitions: () => actions.push("refresh-crons"),
                onRefreshCronInstallState: () => actions.push("refresh-cron-state"),
                onRefreshProcesses: () => actions.push("refresh-processes"),
                onStartProcess: (definitionId) => actions.push(`start-process:${definitionId}`),
                onReconnectProcess: (processId) => actions.push(`output-process:${processId}`),
                onStopProcess: (processId) => actions.push(`stop-process:${processId}`),
            })
        )

        expect(container.textContent).toContain("Nightly")
        expect(container.textContent).toContain("0 1 * * *")
        expect(container.textContent).not.toContain("Enabled")
        expect(queryButtonByText(container, "State")).toBeNull()
        expect(queryButtonByText(container, "Pause")).toBeNull()
        expect(queryButtonByText(container, "Enable")).toBeNull()
        expect(queryButtonByTitle(container, "Run cron now")).toBeNull()

        act(() => buttonByLabel(container, "Refresh project crons").click())

        expect(actions).toEqual(["refresh-crons"])
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
                cronInstallState: null,
                cronDefinitionsLoading: false,
                cronInstallStateLoading: false,
                cronInstallActionId: null,
                processes: null,
                processesLoading: false,
                processActionId: null,
                processOutput: null,
                fileCapabilities: fullFileCapabilities,
                searchCapabilities: fullSearchCapabilities,
                gitCapabilities: fullGitCapabilities,
                cronCapabilities: fullCronCapabilities,
                processCapabilities: fullProcessCapabilities,
                projectActionLoading: false,
                onSelectTask: () => undefined,
                onRefreshFiles: () => undefined,
                onReadFile: () => undefined,
                onFileSearchQueryChange: () => undefined,
                onSearchFiles: () => undefined,
                onWriteFile: () => undefined,
                onSearchQueryChange: () => undefined,
                onSearch: () => undefined,
                onRefreshGit: () => undefined,
                onRefreshCronDefinitions: () => undefined,
                onRefreshCronInstallState: () => undefined,
                onSetCronEnabled: () => undefined,
                onRunCron: () => undefined,
                onRefreshProcesses: () => undefined,
                onStartProcess: () => undefined,
                onReconnectProcess: () => undefined,
                onStopProcess: () => undefined,
            })
        )

        expect(container.textContent).toContain("Runtime Project")
        expect(queryButtonByText(container, "New")).toBeNull()
    })

    it("disables task rows when task read is unavailable", () => {
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
                cronInstallState: null,
                cronDefinitionsLoading: false,
                cronInstallStateLoading: false,
                cronInstallActionId: null,
                processes: null,
                processesLoading: false,
                processActionId: null,
                processOutput: null,
                fileCapabilities: fullFileCapabilities,
                searchCapabilities: fullSearchCapabilities,
                gitCapabilities: fullGitCapabilities,
                cronCapabilities: fullCronCapabilities,
                processCapabilities: fullProcessCapabilities,
                projectActionLoading: false,
                onSelectTask: undefined,
                onNewTask: () => undefined,
                onRefreshFiles: () => undefined,
                onReadFile: () => undefined,
                onFileSearchQueryChange: () => undefined,
                onSearchFiles: () => undefined,
                onWriteFile: () => undefined,
                onSearchQueryChange: () => undefined,
                onSearch: () => undefined,
                onRefreshGit: () => undefined,
                onRefreshCronDefinitions: () => undefined,
                onRefreshCronInstallState: () => undefined,
                onSetCronEnabled: () => undefined,
                onRunCron: () => undefined,
                onRefreshProcesses: () => undefined,
                onStartProcess: () => undefined,
                onReconnectProcess: () => undefined,
                onStopProcess: () => undefined,
            })
        )

        const taskButton = buttonByText(container, "Running task")
        expect(taskButton.disabled).toBe(true)

        act(() => taskButton.click())

        expect(actions).toEqual([])
    })

    it("drives project management actions only when granted", () => {
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
                cronInstallState: null,
                cronDefinitionsLoading: false,
                cronInstallStateLoading: false,
                cronInstallActionId: null,
                processes: null,
                processesLoading: false,
                processActionId: null,
                processOutput: null,
                fileCapabilities: fullFileCapabilities,
                searchCapabilities: fullSearchCapabilities,
                gitCapabilities: fullGitCapabilities,
                cronCapabilities: fullCronCapabilities,
                processCapabilities: fullProcessCapabilities,
                projectActionLoading: false,
                onSelectTask: (taskId) => actions.push(`task:${taskId}`),
                onNewTask: () => actions.push("new-task"),
                onUpdateProject: (input) => {
                    actions.push(`update-project:${input.repoId}:${input.name ?? ""}:${input.path ?? ""}:${input.archived ?? ""}`)
                    return true
                },
                onDeleteProject: (repoId) => {
                    actions.push(`delete-project:${repoId}`)
                    return true
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
                onRefreshCronInstallState: () => undefined,
                onSetCronEnabled: () => undefined,
                onRunCron: () => undefined,
                onRefreshProcesses: () => undefined,
                onStartProcess: () => undefined,
                onReconnectProcess: () => undefined,
                onStopProcess: () => undefined,
            })
        )

        act(() => buttonByText(container, "Manage").click())
        typeInto(inputByLabel(container, "Project name"), "Renamed Runtime Project")
        typeInto(inputByLabel(container, "Project path"), "/tmp/renamed-runtime-project")
        act(() => buttonByText(container, "Save").click())
        act(() => buttonByText(container, "Archive").click())
        act(() => buttonByText(container, "Delete").click())

        expect(actions).toEqual([
            "update-project:repo-1:Renamed Runtime Project:/tmp/renamed-runtime-project:",
            "update-project:repo-1:::true",
            "delete-project:repo-1",
        ])
    })

    it("hides project management actions when repo mutation capabilities are denied", () => {
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
                cronInstallState: null,
                cronDefinitionsLoading: false,
                cronInstallStateLoading: false,
                cronInstallActionId: null,
                processes: null,
                processesLoading: false,
                processActionId: null,
                processOutput: null,
                fileCapabilities: fullFileCapabilities,
                searchCapabilities: fullSearchCapabilities,
                gitCapabilities: fullGitCapabilities,
                cronCapabilities: fullCronCapabilities,
                processCapabilities: fullProcessCapabilities,
                projectActionLoading: false,
                onSelectTask: () => undefined,
                onNewTask: () => undefined,
                onRefreshFiles: () => undefined,
                onReadFile: () => undefined,
                onFileSearchQueryChange: () => undefined,
                onSearchFiles: () => undefined,
                onWriteFile: () => undefined,
                onSearchQueryChange: () => undefined,
                onSearch: () => undefined,
                onRefreshGit: () => undefined,
                onRefreshCronDefinitions: () => undefined,
                onRefreshCronInstallState: () => undefined,
                onSetCronEnabled: () => undefined,
                onRunCron: () => undefined,
                onRefreshProcesses: () => undefined,
                onStartProcess: () => undefined,
                onReconnectProcess: () => undefined,
                onStopProcess: () => undefined,
            })
        )

        expect(queryButtonByText(container, "Manage")).toBeNull()
    })

    it("closes an already-open project manager when mutation capabilities disappear", () => {
        const actions: string[] = []
        render(
            projectTasksElement({
                onUpdateProject: (input) => {
                    actions.push(`update-project:${input.repoId}`)
                    return true
                },
                onDeleteProject: (repoId) => {
                    actions.push(`delete-project:${repoId}`)
                    return true
                },
            })
        )

        act(() => buttonByText(container, "Manage").click())
        typeInto(inputByLabel(container, "Project name"), "Stale Runtime Project")
        expect(inputByLabel(container, "Project name").value).toBe("Stale Runtime Project")

        render(
            projectTasksElement({
                onUpdateProject: undefined,
                onDeleteProject: undefined,
            })
        )

        expect(queryButtonByText(container, "Manage")).toBeNull()
        expect(container.querySelector('input[aria-label="Project name"]')).toBeNull()
        expect(container.querySelector('input[aria-label="Project path"]')).toBeNull()

        render(
            projectTasksElement({
                onUpdateProject: (input) => {
                    actions.push(`update-project:${input.repoId}`)
                    return true
                },
                onDeleteProject: (repoId) => {
                    actions.push(`delete-project:${repoId}`)
                    return true
                },
            })
        )

        expect(buttonByText(container, "Manage")).toBeTruthy()
        expect(container.querySelector('input[aria-label="Project name"]')).toBeNull()
        act(() => buttonByText(container, "Manage").click())
        expect(inputByLabel(container, "Project name").value).toBe("Runtime Project")
        expect(actions).toEqual([])
    })

    it("drops project edit drafts when update capability disappears while delete remains", () => {
        const actions: string[] = []
        const renderWithCapabilities = (canUpdate: boolean) =>
            render(
                projectTasksElement({
                    onUpdateProject: canUpdate
                        ? (input) => {
                              actions.push(`update-project:${input.repoId}:${input.name ?? ""}:${input.path ?? ""}:${input.archived ?? ""}`)
                              return true
                          }
                        : undefined,
                    onDeleteProject: (repoId) => {
                        actions.push(`delete-project:${repoId}`)
                        return true
                    },
                })
            )

        renderWithCapabilities(true)
        act(() => buttonByText(container, "Manage").click())
        typeInto(inputByLabel(container, "Project name"), "Stale Runtime Project")
        expect(inputByLabel(container, "Project name").value).toBe("Stale Runtime Project")

        renderWithCapabilities(false)
        expect(buttonByText(container, "Manage")).toBeTruthy()
        expect(buttonByText(container, "Delete")).toBeTruthy()
        expect(container.querySelector('input[aria-label="Project name"]')).toBeNull()
        expect(queryButtonByText(container, "Save")).toBeNull()

        renderWithCapabilities(true)
        expect(inputByLabel(container, "Project name").value).toBe("Runtime Project")
        expect(actions).toEqual([])
    })
})
