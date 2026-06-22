import { describe, expect, it, vi } from "vitest"
import { OPENADE_METHOD } from "../../../../openade-client/src"
import type { CommentSelectedText, CommentSource, User } from "../../types"
import type { CodeStore } from "../store"
import { CommentManager } from "./CommentManager"

const source: CommentSource = {
    type: "file",
    filePath: "README.md",
    lineStart: 1,
    lineEnd: 1,
}

const selectedText: CommentSelectedText = {
    text: "selected",
    linesBefore: "",
    linesAfter: "",
}

const currentUser: User = {
    id: "user-1",
    email: "user@example.com",
}

describe("CommentManager runtime capabilities", () => {
    it("does not issue comment mutations when their runtime capabilities are unavailable", async () => {
        const store = {
            currentUser,
            shouldUseRuntimeProductAPI: vi.fn(() => true),
            usesCoreOwnedProductRuntime: vi.fn(() => false),
            shouldUseRuntimeProductTaskRoute: vi.fn(() => true),
            canUseProductMethod: vi.fn(
                (method: string) => method !== OPENADE_METHOD.commentCreate && method !== OPENADE_METHOD.commentEdit && method !== OPENADE_METHOD.commentDelete
            ),
            createProductComment: vi.fn(async () => ({ commentId: "comment-1" })),
            editProductComment: vi.fn(async () => undefined),
            deleteProductComment: vi.fn(async () => undefined),
            refreshProductStateAfterTaskMutation: vi.fn(async () => undefined),
        } as unknown as CodeStore
        const manager = new CommentManager(store)

        await expect(manager.addComment("task-1", source, "comment", selectedText)).resolves.toBe("")
        await manager.editComment("task-1", "comment-1", "edited")
        await manager.removeComment("task-1", "comment-1")

        expect(store.createProductComment).not.toHaveBeenCalled()
        expect(store.editProductComment).not.toHaveBeenCalled()
        expect(store.deleteProductComment).not.toHaveBeenCalled()
        expect(store.refreshProductStateAfterTaskMutation).not.toHaveBeenCalled()
    })

    it("does not refresh legacy task storage after comment mutations while Core owns product state", async () => {
        const store = {
            currentUser,
            shouldUseRuntimeProductAPI: vi.fn(() => true),
            usesCoreOwnedProductRuntime: vi.fn(() => true),
            shouldUseRuntimeProductTaskRoute: vi.fn(() => true),
            canUseProductMethod: vi.fn(() => true),
            canUseProductMethodAfterConnect: vi.fn(async () => true),
            createProductComment: vi.fn(async () => ({ commentId: "comment-1" })),
            editProductComment: vi.fn(async () => undefined),
            deleteProductComment: vi.fn(async () => undefined),
            refreshProductStateAfterTaskMutation: vi.fn(async () => undefined),
        } as unknown as CodeStore
        const manager = new CommentManager(store)

        await expect(manager.addComment("task-1", source, "comment", selectedText)).resolves.toBe("comment-1")
        await manager.editComment("task-1", "comment-1", "edited")
        await manager.removeComment("task-1", "comment-1")

        expect(store.createProductComment).toHaveBeenCalled()
        expect(store.editProductComment).toHaveBeenCalled()
        expect(store.deleteProductComment).toHaveBeenCalled()
        expect(store.refreshProductStateAfterTaskMutation).not.toHaveBeenCalled()
    })

    it("attaches Core-owned comment mutations before the first comment write", async () => {
        let runtimeProductAPIAvailable = false
        const commentMethods = new Set<string>([OPENADE_METHOD.commentCreate, OPENADE_METHOD.commentEdit, OPENADE_METHOD.commentDelete])
        const canUseProductMethodAfterConnect = vi.fn(async (method: string) => {
            if (!commentMethods.has(method)) return false
            runtimeProductAPIAvailable = true
            return true
        })
        const store = {
            currentUser,
            shouldUseRuntimeProductAPI: vi.fn(() => runtimeProductAPIAvailable),
            usesCoreOwnedProductRuntime: vi.fn(() => true),
            shouldUseRuntimeProductTaskRoute: vi.fn(() => true),
            canUseProductMethod: vi.fn((method: string) => runtimeProductAPIAvailable && commentMethods.has(method)),
            canUseProductMethodAfterConnect,
            createProductComment: vi.fn(async () => ({ commentId: "comment-1" })),
            editProductComment: vi.fn(async () => undefined),
            deleteProductComment: vi.fn(async () => undefined),
            refreshProductStateAfterTaskMutation: vi.fn(async () => undefined),
        } as unknown as CodeStore
        const manager = new CommentManager(store)

        await expect(manager.addComment("task-1", source, "comment", selectedText)).resolves.toBe("comment-1")
        await manager.editComment("task-1", "comment-1", "edited")
        await manager.removeComment("task-1", "comment-1")

        expect(canUseProductMethodAfterConnect).toHaveBeenCalledWith(OPENADE_METHOD.commentCreate)
        expect(store.createProductComment).toHaveBeenCalled()
        expect(store.editProductComment).toHaveBeenCalled()
        expect(store.deleteProductComment).toHaveBeenCalled()
        expect(store.refreshProductStateAfterTaskMutation).not.toHaveBeenCalled()
    })

    it("does not refresh legacy task storage when only the runtime task route owns comments", async () => {
        const commentMethods = new Set<string>([OPENADE_METHOD.commentCreate, OPENADE_METHOD.commentEdit, OPENADE_METHOD.commentDelete])
        const store = {
            currentUser,
            shouldUseRuntimeProductAPI: vi.fn(() => false),
            usesCoreOwnedProductRuntime: vi.fn(() => false),
            shouldUseRuntimeProductTaskRoute: vi.fn(() => true),
            canUseProductMethod: vi.fn(() => false),
            canUseProductMethodAfterConnect: vi.fn(async (method: string) => commentMethods.has(method)),
            createProductComment: vi.fn(async () => ({ commentId: "comment-1" })),
            editProductComment: vi.fn(async () => undefined),
            deleteProductComment: vi.fn(async () => undefined),
            refreshProductStateAfterTaskMutation: vi.fn(async () => undefined),
        } as unknown as CodeStore
        const manager = new CommentManager(store)

        await expect(manager.addComment("task-1", source, "comment", selectedText)).resolves.toBe("comment-1")
        await manager.editComment("task-1", "comment-1", "edited")
        await manager.removeComment("task-1", "comment-1")

        expect(store.createProductComment).toHaveBeenCalled()
        expect(store.editProductComment).toHaveBeenCalled()
        expect(store.deleteProductComment).toHaveBeenCalled()
        expect(store.refreshProductStateAfterTaskMutation).not.toHaveBeenCalled()
    })
})
