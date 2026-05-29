import { localOpenADEClient } from "../../runtime/localOpenADEClient"
import type { ActionEvent, Comment, CommentSelectedText, CommentSource } from "../../types"
import type { CodeStore } from "../store"

export class CommentManager {
    constructor(private store: CodeStore) {}

    async addComment(taskId: string, source: CommentSource, content: string, selectedText: CommentSelectedText): Promise<string> {
        const result = await localOpenADEClient.createComment({
            taskId,
            content,
            source: source as unknown as Record<string, unknown>,
            selectedText,
            author: this.store.currentUser,
        })
        await this.store.refreshTaskStoreFromStorage(taskId)
        await this.store.refreshRepoStoreFromStorage()
        return result.commentId
    }

    async removeComment(taskId: string, commentId: string): Promise<void> {
        await localOpenADEClient.deleteComment({ taskId, commentId })
        await this.store.refreshTaskStoreFromStorage(taskId)
        await this.store.refreshRepoStoreFromStorage()
    }

    async editComment(taskId: string, commentId: string, newContent: string): Promise<void> {
        await localOpenADEClient.editComment({ taskId, commentId, content: newContent })
        await this.store.refreshTaskStoreFromStorage(taskId)
        await this.store.refreshRepoStoreFromStorage()
    }

    /**
     * Get all comment IDs that have been included in any event.
     * Checks the includesCommentIds field on all ActionEvents.
     */
    getIncludedCommentIds(taskId: string): Set<string> {
        const taskStore = this.store.getCachedTaskStore(taskId)
        if (!taskStore) return new Set()

        const includedIds = new Set<string>()
        for (const event of taskStore.events.all()) {
            if (event.type === "action") {
                const actionEvent = event as ActionEvent
                for (const commentId of actionEvent.includesCommentIds) {
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
        const taskStore = this.store.getCachedTaskStore(taskId)
        if (!taskStore) return []

        const includedIds = this.getIncludedCommentIds(taskId)
        return taskStore.comments.all().filter((c) => !includedIds.has(c.id))
    }

    getPendingCommentCount(taskId: string): number {
        return this.getUnsubmittedComments(taskId).length
    }
}
