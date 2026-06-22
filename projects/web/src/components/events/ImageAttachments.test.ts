import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { OPENADE_METHOD, type OpenADEMethod } from "../../../../openade-client/src"
import { CodeStoreProvider } from "../../store/context"
import type { CodeStore } from "../../store/store"
import type { ImageAttachment } from "../../types"
import { ImageAttachments } from "./ImageAttachments"

const image: ImageAttachment = {
    id: "image-1",
    mediaType: "image/png",
    ext: "png",
    originalWidth: 20,
    originalHeight: 10,
    resizedWidth: 20,
    resizedHeight: 10,
}

describe("ImageAttachments", () => {
    let container: HTMLDivElement
    let root: Root
    let originalIntersectionObserver: typeof IntersectionObserver | undefined
    let originalCreateObjectURL: typeof URL.createObjectURL
    let originalRevokeObjectURL: typeof URL.revokeObjectURL
    let triggerIntersection: (() => void) | null

    beforeEach(() => {
        ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
        container = document.createElement("div")
        document.body.appendChild(container)
        root = createRoot(container)
        originalIntersectionObserver = globalThis.IntersectionObserver
        originalCreateObjectURL = URL.createObjectURL
        originalRevokeObjectURL = URL.revokeObjectURL
        triggerIntersection = null

        class TestIntersectionObserver {
            readonly root = null
            readonly rootMargin = "200px"
            readonly thresholds = []
            private observed: Element | null = null

            constructor(private readonly callback: IntersectionObserverCallback) {
                triggerIntersection = () => {
                    if (!this.observed) return
                    const rect = this.observed.getBoundingClientRect()
                    this.callback(
                        [
                            {
                                boundingClientRect: rect,
                                intersectionRatio: 1,
                                intersectionRect: rect,
                                isIntersecting: true,
                                rootBounds: null,
                                target: this.observed,
                                time: performance.now(),
                            },
                        ],
                        this as unknown as IntersectionObserver
                    )
                }
            }

            observe(target: Element): void {
                this.observed = target
            }

            unobserve(target: Element): void {
                if (this.observed === target) this.observed = null
            }

            disconnect(): void {
                this.observed = null
            }

            takeRecords(): IntersectionObserverEntry[] {
                return []
            }
        }

        Object.defineProperty(globalThis, "IntersectionObserver", {
            configurable: true,
            value: TestIntersectionObserver as unknown as typeof IntersectionObserver,
        })
        Object.defineProperty(URL, "createObjectURL", {
            configurable: true,
            value: vi.fn(() => "blob:test-image"),
        })
        Object.defineProperty(URL, "revokeObjectURL", {
            configurable: true,
            value: vi.fn(),
        })
    })

    afterEach(() => {
        act(() => root.unmount())
        container.remove()
        Object.defineProperty(globalThis, "IntersectionObserver", {
            configurable: true,
            value: originalIntersectionObserver,
        })
        Object.defineProperty(URL, "createObjectURL", {
            configurable: true,
            value: originalCreateObjectURL,
        })
        Object.defineProperty(URL, "revokeObjectURL", {
            configurable: true,
            value: originalRevokeObjectURL,
        })
    })

    it("defers runtime image reads until a thumbnail enters the viewport", async () => {
        const readProductTaskImage = vi.fn(async () => ({
            repoId: "repo-1",
            taskId: "task-1",
            imageId: image.id,
            ext: image.ext,
            mediaType: image.mediaType,
            data: "AQID",
        }))
        const store = {
            shouldUseRuntimeProductAPI: vi.fn(() => true),
            usesCoreOwnedProductRuntime: vi.fn(() => true),
            canUseProductMethod: vi.fn((method: OpenADEMethod) => method === OPENADE_METHOD.taskImageRead),
            findProductRepoIdForTask: vi.fn(() => "repo-1"),
            readProductTaskImage,
        } as unknown as CodeStore

        await act(async () => {
            root.render(createElement(CodeStoreProvider, { store }, createElement(ImageAttachments, { images: [image], taskId: "task-1" })))
            await Promise.resolve()
        })

        expect(readProductTaskImage).not.toHaveBeenCalled()
        expect(container.querySelector("img")).toBeNull()

        await act(async () => {
            triggerIntersection?.()
            await Promise.resolve()
        })

        await vi.waitFor(() => {
            expect(readProductTaskImage).toHaveBeenCalledWith({
                repoId: "repo-1",
                taskId: "task-1",
                imageId: image.id,
                ext: image.ext,
            })
        })
        expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:test-image")
    })

    it("attaches Core image reads when the thumbnail enters the viewport", async () => {
        let runtimeProductAPIAvailable = false
        const canUseProductMethodAfterConnect = vi.fn(async (method: OpenADEMethod) => {
            runtimeProductAPIAvailable = method === OPENADE_METHOD.taskImageRead
            return runtimeProductAPIAvailable
        })
        const readProductTaskImage = vi.fn(async () => ({
            repoId: "repo-1",
            taskId: "task-1",
            imageId: image.id,
            ext: image.ext,
            mediaType: image.mediaType,
            data: "AQID",
        }))
        const store = {
            shouldUseRuntimeProductAPI: vi.fn(() => runtimeProductAPIAvailable),
            usesCoreOwnedProductRuntime: vi.fn(() => true),
            canUseProductMethod: vi.fn((method: OpenADEMethod) => runtimeProductAPIAvailable && method === OPENADE_METHOD.taskImageRead),
            canUseProductMethodAfterConnect,
            findProductRepoIdForTask: vi.fn(() => "repo-1"),
            readProductTaskImage,
        } as unknown as CodeStore

        await act(async () => {
            root.render(createElement(CodeStoreProvider, { store }, createElement(ImageAttachments, { images: [image], taskId: "task-1" })))
            await Promise.resolve()
        })

        expect(readProductTaskImage).not.toHaveBeenCalled()

        await act(async () => {
            triggerIntersection?.()
            await Promise.resolve()
        })

        await vi.waitFor(() => {
            expect(canUseProductMethodAfterConnect).toHaveBeenCalledWith(OPENADE_METHOD.taskImageRead)
            expect(readProductTaskImage).toHaveBeenCalledWith({
                repoId: "repo-1",
                taskId: "task-1",
                imageId: image.id,
                ext: image.ext,
            })
        })
        expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:test-image")
    })
})
