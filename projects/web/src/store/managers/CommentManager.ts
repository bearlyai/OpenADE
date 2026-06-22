import { OPENADE_METHOD, type OpenADEMethod } from "../../../../openade-client/src"
import type { ActionEvent, Comment, CommentSelectedText, CommentSource } from "../../types"
import type { CodeStore } from "../store"

function commentSourceRecord(source: CommentSource): Record<string, unknown> {
    return { ...source }
}

export class CommentManager {
    constructor(private store: CodeStore) {}

    private canUseProductMethod(method: OpenADEMethod): boolean {
        return this.store.canUseProductMethod(method)
    }

    private productRuntimeOwnsComments(): boolean {
        return this.store.shouldUseRuntimeProductTaskRoute()
    }

    private async canUseCommentMethodAfterConnect(method: OpenADEMethod): Promise<boolean> {
        if (!this.productRuntimeOwnsComments()) return this.canUseProductMethod(method)
        if (this.store.usesCoreOwnedProductRuntime()) return this.store.canUseProductMethodAfterConnect(method)
        if (this.store.shouldUseRuntimeProductAPI()) return this.canUseProductMethod(method)
        return this.store.canUseProductMethodAfterConnect(method)
    }

    private shouldRefreshLegacyTaskAfterMutation(): boolean {
        return !this.store.shouldUseRuntimeProductTaskRoute()
    }

    async addComment(taskId: string, source: CommentSource, content: string, selectedText: CommentSelectedText): Promise<string> {
        if (!(await this.canUseCommentMethodAfterConnect(OPENADE_METHOD.commentCreate))) return ""
        const result = await this.store.createProductComment({
            taskId,
            content,
            source: commentSourceRecord(source),
            selectedText,
            author: this.store.currentUser,
        })
        if (this.shouldRefreshLegacyTaskAfterMutation()) await this.store.refreshProductStateAfterTaskMutation(taskId)
        return result.commentId
    }

    async removeComment(taskId: string, commentId: string): Promise<void> {
        if (!(await this.canUseCommentMethodAfterConnect(OPENADE_METHOD.commentDelete))) return
        await this.store.deleteProductComment({ taskId, commentId })
        if (this.shouldRefreshLegacyTaskAfterMutation()) await this.store.refreshProductStateAfterTaskMutation(taskId)
    }

    async editComment(taskId: string, commentId: string, newContent: string): Promise<void> {
        if (!(await this.canUseCommentMethodAfterConnect(OPENADE_METHOD.commentEdit))) return
        await this.store.editProductComment({ taskId, commentId, content: newContent })
        if (this.shouldRefreshLegacyTaskAfterMutation()) await this.store.refreshProductStateAfterTaskMutation(taskId)
    }

    /**
     * Get all comment IDs that have been included in any event.
     * Checks the includesCommentIds field on all ActionEvents.
     */
    getIncludedCommentIds(taskId: string): Set<string> {
        const task = this.store.tasks.getTask(taskId)
        if (!task) return new Set()

        const includedIds = new Set<string>()
        for (const event of task.events) {
            if (event.type === "action") {
                const actionEvent = event as ActionEvent
                for (const commentId of actionEvent.includesCommentIds ?? []) {
                    includedIds.add(commentId)
                }
            }
        }
        return includedIds
    }

    /**
     * Get comments that haven't been included in any event yet.
     * These are "pending" comments that should be included in the next revise.
     */
    getUnsubmittedComments(taskId: string): Comment[] {
        const task = this.store.tasks.getTask(taskId)
        if (!task) return []

        const includedIds = this.getIncludedCommentIds(taskId)
        return task.comments.filter((c) => !includedIds.has(c.id))
    }

    getPendingCommentCount(taskId: string): number {
        return this.getUnsubmittedComments(taskId).length
    }
}
