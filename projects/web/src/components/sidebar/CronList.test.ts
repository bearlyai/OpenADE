import NiceModal from "@ebay/nice-modal-react"
import { act, createElement } from "react"
import { type Root, createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { CodeStoreProvider } from "../../store/context"
import type { CodeStore } from "../../store/store"
import { CronsSidebarContent } from "./CronList"

vi.mock("@ebay/nice-modal-react", () => ({
    default: {
        show: vi.fn(),
    },
}))

vi.mock("../procs/ProcsEditorModal", () => ({
    ProcsEditorModal: function MockProcsEditorModal() {
        return null
    },
}))

function createCodeStore(): CodeStore {
    return {
        crons: {
            getCronsForRepo: vi.fn(() => []),
            ensureRepoConfigLoaded: vi.fn(async () => undefined),
        },
        repos: {
            getRepo: vi.fn(() => ({ id: "repo-1", name: "Repo", path: "/repo" })),
        },
        shouldUseRuntimeProductAPI: vi.fn(() => false),
        usesCoreOwnedProductRuntime: vi.fn(() => false),
        canUseProductMethod: vi.fn(() => false),
    } as unknown as CodeStore
}

describe("CronsSidebarContent", () => {
    let container: HTMLDivElement
    let root: Root
    let previousActEnvironment: boolean | undefined

    beforeEach(() => {
        previousActEnvironment = (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT
        ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
        container = document.createElement("div")
        document.body.appendChild(container)
        root = createRoot(container)
        vi.clearAllMocks()
    })

    afterEach(async () => {
        await act(async () => root.unmount())
        container.remove()
        ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
    })

    async function render(store: CodeStore): Promise<void> {
        await act(async () => {
            root.render(createElement(CodeStoreProvider, { store }, createElement(CronsSidebarContent, { workspaceId: "repo-1" })))
            await Promise.resolve()
        })
    }

    it("keeps cron config reads lazy until the user opens cron editing", async () => {
        const store = createCodeStore()

        await render(store)

        expect(store.crons.ensureRepoConfigLoaded).not.toHaveBeenCalled()

        const button = Array.from(container.querySelectorAll("button")).find((candidate) => candidate.textContent?.includes("Add a cron job"))
        expect(button).toBeInstanceOf(HTMLButtonElement)
        if (!(button instanceof HTMLButtonElement)) throw new Error("Expected Add cron button")

        await act(async () => {
            button.click()
            await Promise.resolve()
        })

        expect(store.crons.ensureRepoConfigLoaded).toHaveBeenCalledWith("repo-1")
        expect(NiceModal.show).toHaveBeenCalledTimes(1)
    })
})
