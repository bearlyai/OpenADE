import { type ComponentProps, type ReactElement, act, createElement } from "react"
import { type Root, createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { OpenADETaskPreview } from "../../../../openade-module/src"
import type { CodeStore } from "../../store/store"
import { TaskItem, resolveTaskListCopyPath } from "./TaskList"

describe("resolveTaskListCopyPath", () => {
    it("resolves the repo path through Core git info when the snapshot repo projection is missing", async () => {
        const getGitInfo = vi.fn(async () => ({
            isGitRepo: true,
            repoRoot: "/runtime/repo",
            relativePath: "packages/app",
            mainBranch: "main",
            hasGhCli: false,
        }))
        const loadProductTaskForRead = vi.fn(async () => ({
            isolationStrategy: { type: "head" },
            events: [],
        }))
        const codeStore = {
            repos: {
                getRepo: () => undefined,
                getGitInfo,
            },
            shouldUseRuntimeProductAPI: () => false,
            usesCoreOwnedProductRuntime: () => true,
            loadProductTaskForRead,
            tasks: {
                getTaskModel: () => null,
            },
        } as unknown as CodeStore

        await expect(resolveTaskListCopyPath({ codeStore, workspaceId: "repo-1", selectedTaskId: "task-1" })).resolves.toBe("/runtime/repo/packages/app")

        expect(getGitInfo).toHaveBeenCalledWith("repo-1")
        expect(loadProductTaskForRead).toHaveBeenCalledWith("repo-1", "task-1")
    })
})

describe("TaskItem task metadata capabilities", () => {
    let container: HTMLDivElement
    let root: Root
    let previousActEnvironment: boolean | undefined

    beforeEach(() => {
        previousActEnvironment = (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT
        ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
        container = document.createElement("div")
        document.body.appendChild(container)
        root = createRoot(container)
    })

    afterEach(async () => {
        await act(async () => root.unmount())
        container.remove()
        ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
    })

    async function render(element: ReactElement): Promise<void> {
        await act(async () => {
            root.render(element)
            await Promise.resolve()
        })
    }

    function taskPreview(): OpenADETaskPreview {
        return {
            id: "task-1",
            slug: "task-1",
            title: "Original task",
            createdAt: "2026-06-01T00:00:00.000Z",
        }
    }

    function findTitleElement(title: string): HTMLElement {
        const titleElement = Array.from(container.querySelectorAll("span")).find((element) => element.textContent === title)
        if (!(titleElement instanceof HTMLElement)) throw new Error(`Missing title element: ${title}`)
        return titleElement
    }

    function taskItemElement(overrides: Partial<ComponentProps<typeof TaskItem>> = {}): ReactElement {
        return createElement(TaskItem, {
            preview: taskPreview(),
            isActive: false,
            isUnread: false,
            isPinned: false,
            inProgressEvent: null,
            selectionMode: false,
            isSelected: false,
            onSelect: vi.fn(),
            onToggleSelect: vi.fn(),
            onEnterSelect: vi.fn(),
            onDelete: vi.fn(),
            onToggleClosed: vi.fn(),
            onTogglePinned: vi.fn(),
            onCopyPath: vi.fn(),
            onRename: vi.fn(),
            canUpdateTaskMetadata: true,
            canDeleteTask: true,
            ...overrides,
        })
    }

    it("does not open rename editing when task metadata updates are unavailable", async () => {
        const onRename = vi.fn()
        await render(taskItemElement({ canUpdateTaskMetadata: false, onRename }))

        await act(async () => {
            findTitleElement("Original task").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))
        })

        expect(container.querySelector('input[aria-label="Task title"]')).toBeNull()
        expect(onRename).not.toHaveBeenCalled()
    })

    it("closes an already-open rename when task metadata capability disappears", async () => {
        const onRename = vi.fn()
        await render(taskItemElement({ canUpdateTaskMetadata: true, onRename }))

        await act(async () => {
            findTitleElement("Original task").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))
        })

        const input = container.querySelector<HTMLInputElement>('input[aria-label="Task title"]')
        expect(input).toBeInstanceOf(HTMLInputElement)
        if (!input) throw new Error("Expected rename input")
        input.value = "Renamed task"

        await render(taskItemElement({ canUpdateTaskMetadata: false, onRename }))

        expect(onRename).not.toHaveBeenCalled()
        expect(container.querySelector('input[aria-label="Task title"]')).toBeNull()
    })
})
