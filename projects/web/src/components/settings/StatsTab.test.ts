import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, it, vi } from "vitest"
import { OPENADE_METHOD } from "../../../../openade-client/src"
import type { CodeStore } from "../../store/store"
import { StatsTab } from "./StatsTab"

async function renderStatsTab(store: CodeStore): Promise<{ container: HTMLElement; cleanup: () => void }> {
    const previousActEnvironment = (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
        root.render(createElement(StatsTab, { store }))
        await Promise.resolve()
    })

    return {
        container,
        cleanup: () => {
            act(() => root.unmount())
            container.remove()
            ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
        },
    }
}

describe("StatsTab", () => {
    it("attaches Core usage backfill before exposing the explicit update action", async () => {
        let runtimeProductAPIAvailable = false
        const store = {
            getTaskPreviewReposForStats: () => [
                {
                    id: "repo-1",
                    name: "Repo",
                    tasks: [
                        {
                            id: "task-1",
                            title: "Task",
                            createdAt: "2026-06-12T00:00:00.000Z",
                        },
                    ],
                },
            ],
            usesCoreOwnedProductRuntime: () => true,
            shouldUseRuntimeProductAPI: () => runtimeProductAPIAvailable,
            canUseProductMethod: vi.fn((method: string) => runtimeProductAPIAvailable && method === OPENADE_METHOD.taskUsageBackfill),
            canUseProductMethodAfterConnect: vi.fn(async (method: string) => {
                runtimeProductAPIAvailable = method === OPENADE_METHOD.taskUsageBackfill
                return runtimeProductAPIAvailable
            }),
            backfillTaskUsagePreviews: vi.fn(async () => undefined),
            backfillTaskUsagePreview: vi.fn(async () => undefined),
            syncRepoStore: vi.fn(async () => undefined),
        } as unknown as CodeStore

        const { container, cleanup } = await renderStatsTab(store)
        try {
            await vi.waitFor(() => {
                expect(container.textContent).toContain("missing usage")
            })
            expect(store.canUseProductMethodAfterConnect).toHaveBeenCalledWith(OPENADE_METHOD.taskUsageBackfill)
            expect(store.backfillTaskUsagePreviews).not.toHaveBeenCalled()
            expect(store.backfillTaskUsagePreview).not.toHaveBeenCalled()
            expect(store.syncRepoStore).not.toHaveBeenCalled()

            const updateButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Update"))
            if (!updateButton) throw new Error("Expected usage update button")
            await act(async () => {
                updateButton.click()
            })

            expect(store.backfillTaskUsagePreviews).toHaveBeenCalledWith([{ repoId: "repo-1", taskId: "task-1" }])
            expect(store.backfillTaskUsagePreview).not.toHaveBeenCalled()
            expect(store.syncRepoStore).not.toHaveBeenCalled()
        } finally {
            cleanup()
        }
    })
})
