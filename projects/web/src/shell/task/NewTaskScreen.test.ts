import { act, createElement, type ReactElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { OpenADEProject } from "../../../../openade-module/src"
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

function textareaByPlaceholder(container: HTMLElement, text: string): HTMLTextAreaElement {
    const textarea = Array.from(container.querySelectorAll("textarea")).find((item): item is HTMLTextAreaElement => item.placeholder === text)
    if (!textarea) throw new Error(`Missing textarea: ${text}`)
    return textarea
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
                canCreateTask: true,
                canStartTurn: true,
                onRepoChange: (repoId) => actions.push(`repo:${repoId}`),
                onModeChange: (mode) => actions.push(`mode:${mode}`),
                onTitleChange: (title) => actions.push(`title:${title}`),
                onPromptChange: (prompt) => actions.push(`prompt:${prompt}`),
                onCreate: () => actions.push("create"),
            })
        )

        expect(container.textContent).toContain("One")
        expect(container.textContent).toContain("/tmp/one")
        expect(textareaByPlaceholder(container, "What should OpenADE do?").value).toBe("Build the feature")

        act(() => buttonByText(container, "Ask").click())
        act(() => buttonByText(container, "Create & Run").click())

        expect(actions).toEqual(["mode:ask", "create"])
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
                canCreateTask: true,
                canStartTurn: false,
                onRepoChange: () => undefined,
                onModeChange: (mode) => actions.push(`mode:${mode}`),
                onTitleChange: () => undefined,
                onPromptChange: () => undefined,
                onCreate: () => actions.push("create"),
            })
        )

        expect(buttonByText(container, "Create Task").disabled).toBe(false)
        expect(container.textContent).not.toContain("Ask")

        act(() => buttonByText(container, "Create Task").click())

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
                canCreateTask: true,
                canStartTurn: true,
                onRepoChange: () => undefined,
                onModeChange: () => undefined,
                onTitleChange: () => undefined,
                onPromptChange: () => undefined,
                onCreate: () => undefined,
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
                canCreateTask: false,
                canStartTurn: true,
                onRepoChange: () => undefined,
                onModeChange: () => undefined,
                onTitleChange: () => undefined,
                onPromptChange: () => undefined,
                onCreate: () => undefined,
            })
        )

        expect(buttonByText(container, "Create & Run").disabled).toBe(true)
    })
})
