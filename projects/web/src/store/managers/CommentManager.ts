import type { ActionEvent, Comment, CommentSelectedText, CommentSource } from "../../types"
import { ulid } from "../../utils/ulid"
import type { CodeStore } from "../store"

export class CommentManager {
    constructor(private store: CodeStore) {}

    addComment(taskId: string, source: CommentSource, content: string, selectedText: CommentSelectedText): string {
        const taskStore = this.store.getCachedTaskStore(taskId)
        if (!taskStore) {
            throw new Error(`Task ${taskId} not loaded`)
        }

        const id = ulid()
        const comment: Comment & { id: string } = {
            id,
            content,
            source,
            selectedText,
            author: this.store.currentUser,
            createdAt: new Date().toISOString(),
        }

        taskStore.comments.push(comment)
        taskStore.meta.update((draft) => {
            draft.updatedAt = new Date().toISOString()
        })

        return id
    }

    removeComment(taskId: string, commentId: string): void {
        const taskStore = this.store.getCachedTaskStore(taskId)
        if (!taskStore) return

        taskStore.comments.delete(commentId)
        taskStore.meta.update((draft) => {
            draft.updatedAt = new Date().toISOString()
        })
    }

    editComment(taskId: string, commentId: string, newContent: string): void {
        const taskStore = this.store.getCachedTaskStore(taskId)
        if (!taskStore) return

        taskStore.comments.update(commentId, (draft) => {
            draft.content = newContent
            draft.updatedAt = new Date().toISOString()
        })

        taskStore.meta.update((draft) => {
            draft.updatedAt = new Date().toISOString()
        })
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
