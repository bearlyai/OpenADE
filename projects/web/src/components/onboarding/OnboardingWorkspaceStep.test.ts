import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { OPENADE_METHOD } from "../../../../openade-client/src"
import type { CodeStore } from "../../store/store"
import { OnboardingWorkspaceStep } from "./OnboardingWorkspaceStep"

const gitApiMocks = vi.hoisted(() => ({
    resolvePath: vi.fn(),
    isGitDirectory: vi.fn(),
    initGit: vi.fn(),
    isGitApiAvailable: vi.fn(() => true),
}))

const shellApiMocks = vi.hoisted(() => ({
    selectDirectory: vi.fn(),
    isDirectorySelectionAvailable: vi.fn(() => true),
}))

vi.mock("../../electronAPI/git", () => ({
    resolvePath: gitApiMocks.resolvePath,
    isGitDirectory: gitApiMocks.isGitDirectory,
    initGit: gitApiMocks.initGit,
    isGitApiAvailable: gitApiMocks.isGitApiAvailable,
}))

vi.mock("../../electronAPI/shell", () => ({
    selectDirectory: shellApiMocks.selectDirectory,
    isDirectorySelectionAvailable: shellApiMocks.isDirectorySelectionAvailable,
}))

function setInputValue(input: HTMLInputElement, value: string): void {
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
    if (!valueSetter) throw new Error("HTMLInputElement value setter is unavailable")
    valueSetter.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
    input.dispatchEvent(new Event("change", { bubbles: true }))
}

function createCoreStore({ runtimeProductAPI = true }: { runtimeProductAPI?: boolean } = {}): CodeStore {
    let runtimeProductAPIAvailable = runtimeProductAPI
    const canUseProductMethod = vi.fn((_method: string) => true)
    const ensureCoreOwnedProductMethodsAvailable = vi.fn(async () => {
        runtimeProductAPIAvailable = true
    })
    return {
        canUseProductMethod,
        canUseProductMethodAfterConnect: vi.fn(async (method: string) => {
            runtimeProductAPIAvailable = true
            return canUseProductMethod(method)
        }),
        shouldUseRuntimeProductAPI: vi.fn(() => runtimeProductAPIAvailable),
        usesCoreOwnedProductRuntime: vi.fn(() => true),
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
            addRepo: vi.fn(async () => ({ id: "repo-1" })),
        },
    } as unknown as CodeStore
}

describe("OnboardingWorkspaceStep Core-owned repo path inspection", () => {
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
        gitApiMocks.resolvePath.mockReset()
        gitApiMocks.isGitDirectory.mockReset()
        gitApiMocks.initGit.mockReset()
        gitApiMocks.isGitApiAvailable.mockReturnValue(true)
        shellApiMocks.selectDirectory.mockReset()
        shellApiMocks.isDirectorySelectionAvailable.mockReturnValue(true)
    })

    afterEach(() => {
        act(() => root.unmount())
        container.remove()
        vi.useRealTimers()
        ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
    })

    it("uses Core repo path inspection even when legacy git availability is false", async () => {
        const onWorkspaceAdded = vi.fn()
        const store = createCoreStore({ runtimeProductAPI: false })
        gitApiMocks.isGitApiAvailable.mockReturnValue(false)

        await act(async () => {
            root.render(createElement(OnboardingWorkspaceStep, { store, onWorkspaceAdded }))
        })

        await vi.waitFor(() => expect(store.ensureCoreOwnedProductMethodsAvailable).toHaveBeenCalledWith(expect.arrayContaining([OPENADE_METHOD.repoCreate])))

        const input = container.querySelector<HTMLInputElement>("#onboarding-workspace-path")
        if (!input) throw new Error("onboarding workspace path input not found")

        await act(async () => {
            setInputValue(input, "~/Projects/app")
            await vi.advanceTimersByTimeAsync(350)
        })

        await vi.waitFor(() => expect(store.inspectProductRepoPath).toHaveBeenCalledWith({ path: "~/Projects/app" }))
        expect(gitApiMocks.resolvePath).not.toHaveBeenCalled()
        expect(gitApiMocks.isGitDirectory).not.toHaveBeenCalled()
        expect(container.textContent).toContain("Browse")

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
        expect(onWorkspaceAdded).toHaveBeenCalledTimes(1)
        expect(gitApiMocks.initGit).not.toHaveBeenCalled()
    })

    it("fails closed instead of using Electron git helpers while Core owns repo creation but is not attached", async () => {
        const store = {
            canUseProductMethod: vi.fn(() => false),
            canUseProductMethodAfterConnect: vi.fn(async () => false),
            shouldUseRuntimeProductAPI: vi.fn(() => false),
            usesCoreOwnedProductRuntime: vi.fn(() => true),
            ensureCoreOwnedProductMethodsAvailable: vi.fn(async () => undefined),
            inspectProductRepoPath: vi.fn(),
            repos: {
                addRepo: vi.fn(),
            },
        } as unknown as CodeStore

        await act(async () => {
            root.render(createElement(OnboardingWorkspaceStep, { store, onWorkspaceAdded: vi.fn() }))
        })

        const input = container.querySelector<HTMLInputElement>("#onboarding-workspace-path")
        if (!input) throw new Error("onboarding workspace path input not found")

        await act(async () => {
            setInputValue(input, "~/Projects/app")
            await vi.advanceTimersByTimeAsync(350)
        })

        expect(store.inspectProductRepoPath).not.toHaveBeenCalled()
        expect(gitApiMocks.resolvePath).not.toHaveBeenCalled()
        expect(gitApiMocks.isGitDirectory).not.toHaveBeenCalled()
        expect(gitApiMocks.initGit).not.toHaveBeenCalled()
        expect(container.textContent).not.toContain("Initialize Git")

        const submit = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Add Workspace"))
        if (!submit) throw new Error("submit button not found")
        expect(submit.disabled).toBe(true)
        expect(store.repos.addRepo).not.toHaveBeenCalled()
    })
})
