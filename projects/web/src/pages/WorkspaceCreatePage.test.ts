import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { OPENADE_METHOD } from "../../../openade-client/src"
import { CodeStoreProvider } from "../store/context"
import type { CodeStore } from "../store/store"
import { WorkspaceCreatePage } from "./WorkspaceCreatePage"

const gitApiMocks = vi.hoisted(() => ({
    resolvePath: vi.fn(),
    isGitDirectory: vi.fn(),
    initGit: vi.fn(),
    isGitApiAvailable: vi.fn(() => true),
}))

const shellApiMocks = vi.hoisted(() => ({
    createDirectory: vi.fn(),
    selectDirectory: vi.fn(),
    isDirectorySelectionAvailable: vi.fn(() => true),
}))

vi.mock("../electronAPI/git", () => ({
    resolvePath: gitApiMocks.resolvePath,
    isGitDirectory: gitApiMocks.isGitDirectory,
    initGit: gitApiMocks.initGit,
    isGitApiAvailable: gitApiMocks.isGitApiAvailable,
}))

vi.mock("../electronAPI/shell", () => ({
    createDirectory: shellApiMocks.createDirectory,
    selectDirectory: shellApiMocks.selectDirectory,
    isDirectorySelectionAvailable: shellApiMocks.isDirectorySelectionAvailable,
}))

vi.mock("../electronAPI/platform", () => ({
    getPathSeparator: () => "/",
}))

const navigateGo = vi.fn()

vi.mock("../routing", () => ({
    useCodeNavigate: () => ({ go: navigateGo }),
}))

vi.mock("../components/ui", async () => {
    const React = await import("react")
    return {
        ScrollArea: ({ children }: { children?: React.ReactNode }) => React.createElement("div", null, children),
    }
})

function createStore({
    runtimeProductAPI = true,
    coreOwnedProductRuntime = true,
    canUseProductMethod = (method: string) => method === OPENADE_METHOD.repoCreate || method === OPENADE_METHOD.repoPathInspect,
}: {
    runtimeProductAPI?: boolean
    coreOwnedProductRuntime?: boolean
    canUseProductMethod?: (method: string) => boolean
} = {}): CodeStore {
    let runtimeProductAPIAvailable = runtimeProductAPI
    const canUseProductMethodMock = vi.fn(canUseProductMethod)
    const ensureCoreOwnedProductMethodsAvailable = vi.fn(async () => {
        runtimeProductAPIAvailable = true
    })
    return {
        canUseProductMethod: canUseProductMethodMock,
        canUseProductMethodAfterConnect: vi.fn(async (method: string) => {
            runtimeProductAPIAvailable = true
            return canUseProductMethodMock(method)
        }),
        shouldUseRuntimeProductAPI: vi.fn(() => runtimeProductAPIAvailable),
        usesCoreOwnedProductRuntime: vi.fn(() => coreOwnedProductRuntime),
        ensureCoreOwnedProductMethodsAvailable,
        inspectProductRepoPath: vi.fn(async () => ({
            path: "~/Projects/app",
            resolvedPath: "/Users/test/Projects/app",
            exists: true,
            isDirectory: true,
            isGitRepo: false,
            error: "not a git repository",
        })),
        repos: {
            addRepo: vi.fn(async () => ({ id: "repo-1", name: "app", path: "/Users/test/Projects/app" })),
        },
    } as unknown as CodeStore
}

interface RepoPathInspectionResult {
    path: string
    resolvedPath: string
    exists: boolean
    isDirectory: boolean
    isGitRepo: boolean
    error?: string
    repoRoot?: string
    relativePath?: string
    mainBranch?: string
    hasGhCli?: boolean
}

interface Deferred<T> {
    promise: Promise<T>
    resolve: (value: T) => void
}

function createDeferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void
    const promise = new Promise<T>((next) => {
        resolve = next
    })
    return { promise, resolve }
}

function setInputValue(input: HTMLInputElement, value: string): void {
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
    if (!valueSetter) throw new Error("HTMLInputElement value setter is unavailable")
    valueSetter.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
    input.dispatchEvent(new Event("change", { bubbles: true }))
}

describe("WorkspaceCreatePage Core-owned repo path inspection", () => {
    let container: HTMLDivElement
    let root: Root
    let previousActEnvironment: boolean | undefined

    beforeEach(() => {
        previousActEnvironment = (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT
        ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
        vi.useFakeTimers()
        container = document.createElement("div")
        document.body.appendChild(container)
        root = createRoot(container)
        navigateGo.mockReset()
        gitApiMocks.resolvePath.mockReset()
        gitApiMocks.isGitDirectory.mockReset()
        gitApiMocks.initGit.mockReset()
        gitApiMocks.isGitApiAvailable.mockReturnValue(true)
        shellApiMocks.createDirectory.mockReset()
        shellApiMocks.selectDirectory.mockReset()
        shellApiMocks.isDirectorySelectionAvailable.mockReturnValue(true)
    })

    afterEach(() => {
        act(() => root.unmount())
        container.remove()
        vi.useRealTimers()
        ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
    })

    it("uses Core repo path inspection instead of Electron git validation before adding an existing non-git workspace", async () => {
        const store = createStore({ runtimeProductAPI: false })
        gitApiMocks.isGitApiAvailable.mockReturnValue(false)

        await act(async () => {
            root.render(createElement(CodeStoreProvider, { store }, createElement(WorkspaceCreatePage)))
        })

        await vi.waitFor(() => expect(store.ensureCoreOwnedProductMethodsAvailable).toHaveBeenCalledWith(expect.arrayContaining([OPENADE_METHOD.repoCreate])))

        const input = container.querySelector<HTMLInputElement>("#workspace-path")
        if (!input) throw new Error("workspace path input not found")

        await act(async () => {
            setInputValue(input, "~/Projects/app")
            await vi.advanceTimersByTimeAsync(350)
        })

        await vi.waitFor(() => expect(store.inspectProductRepoPath).toHaveBeenCalledWith({ path: "~/Projects/app" }))
        expect(gitApiMocks.resolvePath).not.toHaveBeenCalled()
        expect(gitApiMocks.isGitDirectory).not.toHaveBeenCalled()
        expect(container.textContent).toContain("Browse")
        expect(container.textContent).toContain("OpenADE Core will initialize one when you add this workspace.")
        expect(container.textContent).not.toContain("Initialize Git Repository")

        const submit = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Add Workspace"))
        if (!submit) throw new Error("submit button not found")

        await act(async () => {
            submit.dispatchEvent(new MouseEvent("click", { bubbles: true }))
        })

        expect(store.repos.addRepo).toHaveBeenCalledWith({
            name: "app",
            path: "/Users/test/Projects/app",
            initializeGit: true,
        })
        expect(gitApiMocks.initGit).not.toHaveBeenCalled()
        expect(navigateGo).toHaveBeenCalledWith("CodeWorkspace", { workspaceId: "repo-1" })
    })

    it("fails closed instead of using Electron git helpers while Core owns repo creation but is not attached", async () => {
        const store = {
            ...createStore(),
            canUseProductMethod: vi.fn(() => false),
            canUseProductMethodAfterConnect: vi.fn(async () => false),
            shouldUseRuntimeProductAPI: vi.fn(() => false),
            usesCoreOwnedProductRuntime: vi.fn(() => true),
            inspectProductRepoPath: vi.fn(),
            repos: {
                addRepo: vi.fn(),
            },
        } as unknown as CodeStore

        await act(async () => {
            root.render(createElement(CodeStoreProvider, { store }, createElement(WorkspaceCreatePage)))
        })

        const input = container.querySelector<HTMLInputElement>("#workspace-path")
        if (!input) throw new Error("workspace path input not found")

        await act(async () => {
            setInputValue(input, "~/Projects/app")
            await vi.advanceTimersByTimeAsync(350)
        })

        expect(store.inspectProductRepoPath).not.toHaveBeenCalled()
        expect(gitApiMocks.resolvePath).not.toHaveBeenCalled()
        expect(gitApiMocks.isGitDirectory).not.toHaveBeenCalled()
        expect(gitApiMocks.initGit).not.toHaveBeenCalled()
        expect(container.textContent).not.toContain("Initialize Git Repository")

        const submit = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Add Workspace"))
        if (!submit) throw new Error("submit button not found")
        expect(submit.disabled).toBe(true)
        expect(store.repos.addRepo).not.toHaveBeenCalled()
    })

    it("ignores stale Core repo path inspection results after the path changes", async () => {
        const firstInspection = createDeferred<RepoPathInspectionResult>()
        const secondInspection = createDeferred<RepoPathInspectionResult>()
        const inspectProductRepoPath = vi.fn((request: { path: string }) => {
            if (request.path === "~/Projects/old") return firstInspection.promise
            return secondInspection.promise
        })
        const store = {
            ...createStore(),
            inspectProductRepoPath,
        } as unknown as CodeStore

        await act(async () => {
            root.render(createElement(CodeStoreProvider, { store }, createElement(WorkspaceCreatePage)))
        })

        const input = container.querySelector<HTMLInputElement>("#workspace-path")
        if (!input) throw new Error("workspace path input not found")

        await act(async () => {
            setInputValue(input, "~/Projects/old")
            await vi.advanceTimersByTimeAsync(350)
        })
        await vi.waitFor(() => expect(inspectProductRepoPath).toHaveBeenCalledWith({ path: "~/Projects/old" }))

        await act(async () => {
            setInputValue(input, "~/Projects/new")
            await vi.advanceTimersByTimeAsync(350)
        })
        await vi.waitFor(() => expect(inspectProductRepoPath).toHaveBeenCalledWith({ path: "~/Projects/new" }))

        await act(async () => {
            firstInspection.resolve({
                path: "~/Projects/old",
                resolvedPath: "/Users/test/Projects/old",
                exists: true,
                isDirectory: true,
                isGitRepo: true,
                repoRoot: "/Users/test/Projects/old",
                relativePath: "",
                mainBranch: "old-main",
                hasGhCli: false,
            })
            await Promise.resolve()
        })

        expect(container.textContent).not.toContain("old-main")

        await act(async () => {
            secondInspection.resolve({
                path: "~/Projects/new",
                resolvedPath: "/Users/test/Projects/new",
                exists: true,
                isDirectory: true,
                isGitRepo: true,
                repoRoot: "/Users/test/Projects/new",
                relativePath: "",
                mainBranch: "new-main",
                hasGhCli: false,
            })
            await Promise.resolve()
        })

        await vi.waitFor(() => expect(container.textContent).toContain("Git repository detected (default branch: new-main)"))
        expect(container.textContent).not.toContain("old-main")
    })
})
