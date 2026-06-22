import { act, createElement, type ReactElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { OpenADEIsolationStrategy, OpenADEProject } from "../../../../openade-module/src"
import { resetMetaKeyPressed } from "../../hooks/useMetaKeyPressed"
import { NewTaskScreen } from "./NewTaskScreen"

const repos: OpenADEProject[] = [
    { id: "repo-1", name: "One", path: "/tmp/one", tasks: [] },
    { id: "repo-2", name: "Two", path: "/tmp/two", tasks: [] },
]

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
    if (!button) throw new Error(`Missing labeled button: ${label}`)
    return button
}

function summaryByText(container: HTMLElement, text: string): HTMLElement {
    const summary = Array.from(container.querySelectorAll("summary")).find((item): item is HTMLElement => item.textContent?.includes(text) === true)
    if (!summary) throw new Error(`Missing summary: ${text}`)
    return summary
}

function textareaByPlaceholder(container: HTMLElement, text: string): HTMLTextAreaElement {
    const textarea = Array.from(container.querySelectorAll("textarea")).find((item): item is HTMLTextAreaElement => item.placeholder === text)
    if (!textarea) throw new Error(`Missing textarea: ${text}`)
    return textarea
}

function buttonTexts(container: HTMLElement): string[] {
    return Array.from(container.querySelectorAll("button"))
        .map((button) => button.textContent?.trim() ?? "")
        .filter((text) => text.length > 0)
}

function shortcutBadgeTexts(container: HTMLElement): string[] {
    return Array.from(container.querySelectorAll("kbd"))
        .map((badge) => badge.textContent?.trim() ?? "")
        .filter((text) => text.length > 0)
}

describe("NewTaskScreen", () => {
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

    it("renders shared new-task controls from project DTOs", () => {
        const actions: string[] = []
        render(
            createElement(NewTaskScreen, {
                repos,
                repoId: "repo-1",
                mode: "do",
                title: "Title draft",
                prompt: "Build the feature",
                isLoading: false,
                isSubmitting: false,
                isOnline: true,
                onRepoChange: (repoId) => actions.push(`repo:${repoId}`),
                onModeChange: (mode) => actions.push(`mode:${mode}`),
                onTitleChange: (title) => actions.push(`title:${title}`),
                onPromptChange: (prompt) => actions.push(`prompt:${prompt}`),
                onCreateAndRun: () => actions.push("create"),
            })
        )

        expect(container.textContent).toContain("One")
        expect(container.textContent).toContain("/tmp/one")
        expect(textareaByPlaceholder(container, "What should OpenADE do?").value).toBe("Build the feature")

        act(() => buttonByText(container, "Ask").click())
        act(() => buttonByText(container, "Create & Run").click())

        expect(actions).toEqual(["mode:ask", "create"])
    })

    it("exposes desktop-style draft stash, restore, and delete controls", () => {
        const actions: string[] = []
        render(
            createElement(NewTaskScreen, {
                repos,
                repoId: "repo-1",
                mode: "do",
                title: "Title draft",
                prompt: "Build the feature",
                drafts: [{ id: "draft-1", createdAtLabel: "6/14/26, 10:00 AM", preview: "Saved draft", imageCount: 2 }],
                canStashDraft: true,
                canRestoreDraft: true,
                isLoading: false,
                isSubmitting: false,
                isOnline: true,
                onRepoChange: () => undefined,
                onModeChange: () => undefined,
                onTitleChange: () => undefined,
                onPromptChange: () => undefined,
                onStashDraft: () => actions.push("stash"),
                onRestoreDraft: (draftId) => actions.push(`restore:${draftId}`),
                onDeleteDraft: (draftId) => actions.push(`delete:${draftId}`),
                onCreateAndRun: () => undefined,
            })
        )

        act(() => buttonByText(container, "Stash").click())
        act(() => summaryByText(container, "Drafts").click())
        expect(container.textContent).toContain("Saved draft")
        expect(container.textContent).toContain("2 images")
        act(() => buttonByText(container, "Pop").click())
        act(() => buttonByText(container, "Delete").click())

        expect(actions).toEqual(["stash", "restore:draft-1", "delete:draft-1"])
    })

    it("exposes desktop-style pending creation controls", () => {
        const actions: string[] = []
        render(
            createElement(NewTaskScreen, {
                repos,
                repoId: "repo-1",
                mode: "do",
                title: "",
                prompt: "Build the feature",
                pendingCreations: [
                    {
                        id: "pending-1",
                        preview: "Pending task",
                        phaseLabel: "Starting task",
                        sourceBranch: "feature/shared-shell",
                        error: null,
                        canCancel: true,
                    },
                    {
                        id: "pending-2",
                        preview: "Failed task",
                        phaseLabel: "Starting task",
                        error: "Task creation failed",
                    },
                    {
                        id: "pending-3",
                        preview: "Ready task",
                        phaseLabel: "Ready",
                        error: null,
                        isComplete: true,
                        canOpen: true,
                    },
                ],
                isLoading: false,
                isSubmitting: false,
                isOnline: true,
                onRepoChange: () => undefined,
                onModeChange: () => undefined,
                onTitleChange: () => undefined,
                onPromptChange: () => undefined,
                onRetryPendingCreation: (creationId) => actions.push(`retry:${creationId}`),
                onOpenPendingCreation: (creationId) => actions.push(`open:${creationId}`),
                onCancelPendingCreation: (creationId) => actions.push(`cancel:${creationId}`),
                onDismissPendingCreation: (creationId) => actions.push(`dismiss:${creationId}`),
                onCreateAndRun: () => undefined,
            })
        )

        act(() => summaryByText(container, "3 pending").click())
        expect(container.textContent).toContain("Pending task")
        expect(container.textContent).toContain("Starting task")
        expect(container.textContent).toContain("feature/shared-shell")
        expect(container.textContent).toContain("Task creation failed")
        expect(container.textContent).toContain("Ready task")
        act(() => buttonByText(container, "Cancel").click())
        act(() => buttonByText(container, "Open").click())
        act(() => buttonByText(container, "Retry").click())
        act(() => buttonByText(container, "Dismiss").click())

        expect(actions).toEqual(["cancel:pending-1", "open:pending-3", "retry:pending-2", "dismiss:pending-2"])
    })

    it("keeps draft and pending actions unavailable when handlers are withheld", () => {
        render(
            createElement(NewTaskScreen, {
                repos,
                repoId: "repo-1",
                mode: "do",
                title: "Title draft",
                prompt: "Build the feature",
                drafts: [{ id: "draft-1", createdAtLabel: "6/14/26, 10:00 AM", preview: "Saved draft", imageCount: 1 }],
                pendingCreations: [
                    {
                        id: "pending-1",
                        preview: "Pending task",
                        phaseLabel: "Starting task",
                        error: null,
                        canCancel: true,
                    },
                    {
                        id: "pending-2",
                        preview: "Failed task",
                        phaseLabel: "Starting task",
                        error: "Task creation failed",
                    },
                    {
                        id: "pending-3",
                        preview: "Ready task",
                        phaseLabel: "Ready",
                        error: null,
                        isComplete: true,
                        canOpen: true,
                    },
                ],
                canStashDraft: true,
                canRestoreDraft: true,
                createMore: true,
                isLoading: false,
                isSubmitting: false,
                isOnline: true,
                onRepoChange: () => undefined,
                onModeChange: () => undefined,
                onTitleChange: () => undefined,
                onPromptChange: () => undefined,
                onCreateAndRun: () => undefined,
            })
        )

        act(() => summaryByText(container, "3 pending").click())
        expect(container.textContent).toContain("Pending task")
        expect(container.textContent).toContain("Failed task")
        expect(container.textContent).toContain("Ready task")
        expect(queryButtonByText(container, "Open")).toBeNull()
        expect(queryButtonByText(container, "Retry")).toBeNull()
        expect(queryButtonByText(container, "Cancel")).toBeNull()
        expect(queryButtonByText(container, "Dismiss")).toBeNull()

        act(() => summaryByText(container, "Drafts").click())
        expect(container.textContent).toContain("Saved draft")
        expect(buttonByText(container, "Stash").disabled).toBe(true)
        expect(buttonByText(container, "Pop").disabled).toBe(true)
        expect(queryButtonByText(container, "Delete")).toBeNull()
        expect(buttonByLabel(container, "Create more tasks").disabled).toBe(true)
    })

    it("exposes create-more state for shared desktop-parity task creation", () => {
        const actions: string[] = []
        render(
            createElement(NewTaskScreen, {
                repos,
                repoId: "repo-1",
                mode: "do",
                title: "",
                prompt: "Build the feature",
                createMore: true,
                isLoading: false,
                isSubmitting: false,
                isOnline: true,
                onRepoChange: () => undefined,
                onModeChange: () => undefined,
                onTitleChange: () => undefined,
                onPromptChange: () => undefined,
                onCreateMoreChange: (value) => actions.push(`create-more:${value}`),
                onCreateAndRun: () => undefined,
            })
        )

        expect(container.textContent).toContain("Create More")

        act(() => buttonByLabel(container, "Create more tasks").click())

        expect(actions).toEqual(["create-more:false"])
    })

    it("uses desktop-style shortcuts for create mode submission and create-more toggle", () => {
        const actions: string[] = []
        render(
            createElement(NewTaskScreen, {
                repos,
                repoId: "repo-1",
                mode: "do",
                title: "",
                prompt: "Build the feature",
                createMore: false,
                isLoading: false,
                isSubmitting: false,
                isOnline: true,
                onRepoChange: () => undefined,
                onModeChange: (mode) => actions.push(`mode:${mode}`),
                onTitleChange: () => undefined,
                onPromptChange: () => undefined,
                onCreateMoreChange: (value) => actions.push(`create-more:${value}`),
                onCreateAndRun: (mode) => actions.push(`create:${mode ?? "current"}`),
            })
        )

        act(() => {
            window.dispatchEvent(new KeyboardEvent("keydown", { code: "Digit2", key: "2", metaKey: true, bubbles: true }))
        })
        act(() => {
            window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyM", key: "m", metaKey: true, altKey: true, bubbles: true }))
        })

        expect(actions).toEqual(["mode:plan", "create:plan", "create-more:true"])
    })

    it("reveals desktop shortcut badges while the command key is held", () => {
        render(
            createElement(NewTaskScreen, {
                repos,
                repoId: "repo-1",
                mode: "do",
                title: "",
                prompt: "Build the feature",
                createMore: false,
                isolationStrategy: { type: "head" },
                branchOptions: {
                    repoId: "repo-1",
                    defaultBranch: "main",
                    branches: [{ name: "main", isDefault: true, isRemote: false }],
                },
                branchesLoading: false,
                isLoading: false,
                isSubmitting: false,
                isOnline: true,
                onRepoChange: () => undefined,
                onModeChange: () => undefined,
                onTitleChange: () => undefined,
                onPromptChange: () => undefined,
                onCreateMoreChange: () => undefined,
                onIsolationStrategyChange: () => undefined,
                onRefreshBranches: () => undefined,
                onCreateAndRun: () => undefined,
            })
        )

        expect(shortcutBadgeTexts(container)).toEqual([])

        act(() => {
            window.dispatchEvent(new KeyboardEvent("keydown", { key: "Meta", metaKey: true, bubbles: true }))
        })

        expect(shortcutBadgeTexts(container)).toEqual(expect.arrayContaining(["1", "2", "3", "4", "M", "W"]))

        act(() => {
            window.dispatchEvent(new KeyboardEvent("keyup", { key: "Meta", metaKey: false, bubbles: true }))
        })

        expect(shortcutBadgeTexts(container)).toEqual([])
    })

    it("renders create-only controls when turn start is unavailable", () => {
        const actions: string[] = []
        render(
            createElement(NewTaskScreen, {
                repos,
                repoId: "repo-1",
                mode: "do",
                title: "",
                prompt: "Capture this task",
                isLoading: false,
                isSubmitting: false,
                isOnline: true,
                onRepoChange: () => undefined,
                onModeChange: (mode) => actions.push(`mode:${mode}`),
                onTitleChange: () => undefined,
                onPromptChange: () => undefined,
                onCreateTask: () => actions.push("create"),
            })
        )

        expect(buttonByText(container, "Create Task").disabled).toBe(false)
        expect(container.textContent).not.toContain("Ask")
        expect(buttonTexts(container)).toEqual(["Create Task"])

        act(() => buttonByText(container, "Create Task").click())

        expect(actions).toEqual(["create"])
    })

    it("renders HyperPlan strategy presets for create-and-run tasks", () => {
        const actions: string[] = []
        render(
            createElement(NewTaskScreen, {
                repos,
                repoId: "repo-1",
                mode: "hyperplan",
                title: "",
                prompt: "Plan this feature",
                isLoading: false,
                isSubmitting: false,
                isOnline: true,
                hyperplanPresetId: "ensemble",
                onRepoChange: () => undefined,
                onModeChange: () => undefined,
                onTitleChange: () => undefined,
                onPromptChange: () => undefined,
                onHyperplanPresetChange: (value) => actions.push(`strategy:${value}`),
                onCreateAndRun: () => undefined,
            })
        )

        expect(container.textContent).toContain("HyperPlan Strategy")

        act(() => buttonByText(container, "Peer Review").click())

        expect(actions).toEqual(["strategy:peer-review"])
    })

    it("gates worktree source branch selection behind loaded project branches", () => {
        const actions: string[] = []
        render(
            createElement(NewTaskScreen, {
                repos,
                repoId: "repo-1",
                mode: "do",
                title: "",
                prompt: "Build the feature",
                isolationStrategy: { type: "head" },
                branchOptions: null,
                branchesLoading: false,
                isLoading: false,
                isSubmitting: false,
                isOnline: true,
                onRepoChange: () => undefined,
                onModeChange: () => undefined,
                onTitleChange: () => undefined,
                onPromptChange: () => undefined,
                onIsolationStrategyChange: (strategy) =>
                    actions.push(`isolation:${strategy.type}${strategy.type === "worktree" ? `:${strategy.sourceBranch}` : ""}`),
                onRefreshBranches: () => actions.push("refresh-branches"),
                onCreateAndRun: () => undefined,
            })
        )

        act(() => buttonByText(container, "Load Branches").click())
        expect(actions).toEqual(["refresh-branches"])

        render(
            createElement(NewTaskScreen, {
                repos,
                repoId: "repo-1",
                mode: "do",
                title: "",
                prompt: "Build the feature",
                isolationStrategy: { type: "head" },
                branchOptions: {
                    repoId: "repo-1",
                    defaultBranch: "main",
                    branches: [
                        { name: "main", isDefault: true, isRemote: false },
                        { name: "feature/shared-shell", isDefault: false, isRemote: false },
                    ],
                },
                branchesLoading: false,
                isLoading: false,
                isSubmitting: false,
                isOnline: true,
                onRepoChange: () => undefined,
                onModeChange: () => undefined,
                onTitleChange: () => undefined,
                onPromptChange: () => undefined,
                onIsolationStrategyChange: (strategy) =>
                    actions.push(`isolation:${strategy.type}${strategy.type === "worktree" ? `:${strategy.sourceBranch}` : ""}`),
                onRefreshBranches: () => actions.push("refresh-branches"),
                onCreateAndRun: () => undefined,
            })
        )

        const worktreeToggle = container.querySelector('input[aria-label="Use worktree"]')
        if (!(worktreeToggle instanceof HTMLInputElement)) throw new Error("Missing worktree toggle")
        act(() => {
            worktreeToggle.click()
        })
        expect(actions).toEqual(["refresh-branches", "isolation:worktree:main"])

        render(
            createElement(NewTaskScreen, {
                repos,
                repoId: "repo-1",
                mode: "do",
                title: "",
                prompt: "Build the feature",
                isolationStrategy: { type: "worktree", sourceBranch: "main" },
                branchOptions: {
                    repoId: "repo-1",
                    defaultBranch: "main",
                    branches: [
                        { name: "main", isDefault: true, isRemote: false },
                        { name: "feature/shared-shell", isDefault: false, isRemote: false },
                    ],
                },
                branchesLoading: false,
                isLoading: false,
                isSubmitting: false,
                isOnline: true,
                onRepoChange: () => undefined,
                onModeChange: () => undefined,
                onTitleChange: () => undefined,
                onPromptChange: () => undefined,
                onIsolationStrategyChange: (strategy) =>
                    actions.push(`isolation:${strategy.type}${strategy.type === "worktree" ? `:${strategy.sourceBranch}` : ""}`),
                onRefreshBranches: () => undefined,
                onCreateAndRun: () => undefined,
            })
        )
        const sourceBranch = container.querySelector('select[aria-label="Source branch"]')
        if (!(sourceBranch instanceof HTMLSelectElement)) throw new Error("Missing source branch select")
        act(() => {
            sourceBranch.value = "feature/shared-shell"
            sourceBranch.dispatchEvent(new Event("change", { bubbles: true }))
        })
        expect(actions).toEqual(["refresh-branches", "isolation:worktree:main", "isolation:worktree:feature/shared-shell"])
    })

    it("uses the desktop worktree shortcut through branch capabilities", () => {
        const actions: string[] = []
        const baseProps = {
            repos,
            repoId: "repo-1",
            mode: "do" as const,
            title: "",
            prompt: "Build the feature",
            branchesLoading: false,
            isLoading: false,
            isSubmitting: false,
            isOnline: true,
            onRepoChange: () => undefined,
            onModeChange: () => undefined,
            onTitleChange: () => undefined,
            onPromptChange: () => undefined,
            onIsolationStrategyChange: (strategy: OpenADEIsolationStrategy) =>
                actions.push(`isolation:${strategy.type}${strategy.type === "worktree" ? `:${strategy.sourceBranch}` : ""}`),
            onRefreshBranches: () => actions.push("refresh-branches"),
            onCreateAndRun: () => undefined,
        }

        render(createElement(NewTaskScreen, { ...baseProps, isolationStrategy: { type: "head" }, branchOptions: null }))

        act(() => {
            window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW", key: "w", metaKey: true, altKey: true, bubbles: true }))
        })
        expect(actions).toEqual(["refresh-branches"])

        render(
            createElement(NewTaskScreen, {
                ...baseProps,
                isolationStrategy: { type: "head" },
                branchOptions: {
                    repoId: "repo-1",
                    defaultBranch: "main",
                    branches: [
                        { name: "main", isDefault: true, isRemote: false },
                        { name: "feature/shared-shell", isDefault: false, isRemote: false },
                    ],
                },
            })
        )

        act(() => {
            window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW", key: "w", metaKey: true, altKey: true, bubbles: true }))
        })
        expect(actions).toEqual(["refresh-branches", "isolation:worktree:main"])

        render(
            createElement(NewTaskScreen, {
                ...baseProps,
                isolationStrategy: { type: "worktree", sourceBranch: "main" },
                branchOptions: {
                    repoId: "repo-1",
                    defaultBranch: "main",
                    branches: [
                        { name: "main", isDefault: true, isRemote: false },
                        { name: "feature/shared-shell", isDefault: false, isRemote: false },
                    ],
                },
            })
        )

        act(() => {
            window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW", key: "w", metaKey: true, altKey: true, bubbles: true }))
        })
        expect(actions).toEqual(["refresh-branches", "isolation:worktree:main", "isolation:head"])

        render(createElement(NewTaskScreen, { ...baseProps, onRefreshBranches: undefined, isolationStrategy: { type: "head" }, branchOptions: null }))

        act(() => {
            window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW", key: "w", metaKey: true, altKey: true, bubbles: true }))
        })
        expect(actions).toEqual(["refresh-branches", "isolation:worktree:main", "isolation:head"])
    })

    it("prefers the last shared worktree source branch when enabling worktree creation", () => {
        const actions: string[] = []
        render(
            createElement(NewTaskScreen, {
                repos,
                repoId: "repo-1",
                mode: "do",
                title: "",
                prompt: "Build the feature",
                isolationStrategy: { type: "head" },
                branchOptions: {
                    repoId: "repo-1",
                    defaultBranch: "main",
                    branches: [
                        { name: "main", isDefault: true, isRemote: false },
                        { name: "feature/shared-shell", isDefault: false, isRemote: false },
                    ],
                },
                branchesLoading: false,
                preferredSourceBranch: "feature/shared-shell",
                isLoading: false,
                isSubmitting: false,
                isOnline: true,
                onRepoChange: () => undefined,
                onModeChange: () => undefined,
                onTitleChange: () => undefined,
                onPromptChange: () => undefined,
                onIsolationStrategyChange: (strategy) =>
                    actions.push(`isolation:${strategy.type}${strategy.type === "worktree" ? `:${strategy.sourceBranch}` : ""}`),
                onRefreshBranches: () => undefined,
                onCreateAndRun: () => undefined,
            })
        )

        const worktreeToggle = container.querySelector('input[aria-label="Use worktree"]')
        if (!(worktreeToggle instanceof HTMLInputElement)) throw new Error("Missing worktree toggle")

        act(() => {
            worktreeToggle.click()
        })

        expect(actions).toEqual(["isolation:worktree:feature/shared-shell"])

        render(
            createElement(NewTaskScreen, {
                repos,
                repoId: "repo-1",
                mode: "do",
                title: "",
                prompt: "Build the feature",
                isolationStrategy: { type: "worktree", sourceBranch: "feature/shared-shell" },
                branchOptions: {
                    repoId: "repo-1",
                    defaultBranch: "main",
                    branches: [
                        { name: "main", isDefault: true, isRemote: false },
                        { name: "feature/shared-shell", isDefault: false, isRemote: false },
                    ],
                },
                branchesLoading: false,
                preferredSourceBranch: "feature/shared-shell",
                isLoading: false,
                isSubmitting: false,
                isOnline: true,
                onRepoChange: () => undefined,
                onModeChange: () => undefined,
                onTitleChange: () => undefined,
                onPromptChange: () => undefined,
                onIsolationStrategyChange: (strategy) =>
                    actions.push(`isolation:${strategy.type}${strategy.type === "worktree" ? `:${strategy.sourceBranch}` : ""}`),
                onRefreshBranches: () => undefined,
                onCreateAndRun: () => undefined,
            })
        )

        const sourceBranch = container.querySelector('select[aria-label="Source branch"]')
        if (!(sourceBranch instanceof HTMLSelectElement)) throw new Error("Missing source branch select")
        expect(Array.from(sourceBranch.options).map((option) => option.textContent)).toContain("feature/shared-shell (last)")
    })

    it("ignores stale worktree state when branch capability is hidden", () => {
        const actions: string[] = []
        render(
            createElement(NewTaskScreen, {
                repos,
                repoId: "repo-1",
                mode: "do",
                title: "",
                prompt: "Build the feature",
                isolationStrategy: { type: "worktree", sourceBranch: "" },
                branchOptions: null,
                branchesLoading: false,
                isLoading: false,
                isSubmitting: false,
                isOnline: true,
                onRepoChange: () => undefined,
                onModeChange: () => undefined,
                onTitleChange: () => undefined,
                onPromptChange: () => undefined,
                onIsolationStrategyChange: (strategy) =>
                    actions.push(`isolation:${strategy.type}${strategy.type === "worktree" ? `:${strategy.sourceBranch}` : ""}`),
                onCreateAndRun: () => actions.push("create"),
            })
        )

        expect(container.querySelector('input[aria-label="Use worktree"]')).toBeNull()
        const createButton = buttonByText(container, "Create & Run")
        expect(createButton.disabled).toBe(false)

        act(() => createButton.click())

        expect(actions).toEqual(["create"])
    })

    it("disables create while offline", () => {
        render(
            createElement(NewTaskScreen, {
                repos,
                repoId: "repo-1",
                mode: "do",
                title: "",
                prompt: "Build the feature",
                isLoading: false,
                isSubmitting: false,
                isOnline: false,
                onRepoChange: () => undefined,
                onModeChange: () => undefined,
                onTitleChange: () => undefined,
                onPromptChange: () => undefined,
                onCreateAndRun: () => undefined,
            })
        )

        expect(buttonByText(container, "Create & Run").disabled).toBe(true)
    })

    it("disables create when the runtime lacks task-create capability", () => {
        render(
            createElement(NewTaskScreen, {
                repos,
                repoId: "repo-1",
                mode: "do",
                title: "",
                prompt: "Build the feature",
                isLoading: false,
                isSubmitting: false,
                isOnline: true,
                onRepoChange: () => undefined,
                onModeChange: () => undefined,
                onTitleChange: () => undefined,
                onPromptChange: () => undefined,
            })
        )

        expect(buttonByText(container, "Create Task").disabled).toBe(true)
    })
})
