import type { ActionEvent, ActionEventSource } from "../../types"
import { REPEAT_LABEL } from "./RepeatManager"
import type { CodeStore } from "../store"

const NOTIFICATION_CLEANUP_MS = 5 * 60 * 1000

export class NotificationManager {
    private activeNotifications = new Map<string, Notification>()

    constructor(private store: CodeStore) {
        this.init()
    }

    private init(): void {
        this.requestPermission()
        this.store.execution.onAfterEvent((taskId, eventType) => {
            this.handleEvent(taskId, eventType)
        })
    }

    private async requestPermission(): Promise<void> {
        try {
            if (typeof Notification === "undefined") return
            if (Notification.permission === "default") {
                await Notification.requestPermission()
            }
        } catch (err) {
            console.error("[NotificationManager] Failed to request notification permission:", err)
        }
    }

    private getNotificationMessage(eventType: ActionEventSource["type"], label?: string): string {
        switch (eventType) {
            case "plan":
                return "Planning complete."
            case "revise":
                return "Plan revision complete."
            case "do":
                return label ? `${label} complete.` : "Action complete."
            case "run_plan":
                return "Plan execution complete."
            case "ask":
                return "Answer complete."
            case "hyperplan":
                return "HyperPlan complete."
            case "review":
                return "Review complete."
            default: {
                const _exhaustive: never = eventType
                return `${_exhaustive} complete.`
            }
        }
    }

    private getActionLabel(taskId: string): string | undefined {
        const task = this.store.tasks.getTask(taskId)
        if (!task?.events.length) return undefined

        const lastEvent = task.events[task.events.length - 1]
        if (lastEvent.type === "action") {
            return (lastEvent as ActionEvent).source.userLabel
        }
        return undefined
    }

    private getLastActionEvent(taskId: string): ActionEvent | undefined {
        const task = this.store.tasks.getTask(taskId)
        if (!task?.events.length) return undefined
        const lastEvent = task.events[task.events.length - 1]
        return lastEvent.type === "action" ? (lastEvent as ActionEvent) : undefined
    }

    private handleEvent(taskId: string, eventType: ActionEventSource["type"]): void {
        const task = this.store.tasks.getTask(taskId)
        if (!task) return

        const lastActionEvent = this.getLastActionEvent(taskId)
        if (eventType === "ask" && lastActionEvent?.source.type === "ask" && lastActionEvent.source.origin === "review_follow_up") {
            return
        }

        const label = eventType === "do" ? this.getActionLabel(taskId) : undefined

        // Suppress notifications for repeat iterations (stop-on-text sends its own notification)
        if (label === REPEAT_LABEL) return

        const message = this.getNotificationMessage(eventType, label)

        this.sendNotification(taskId, task.repoId, task.title, message)
    }

    private sendNotification(taskId: string, workspaceId: string, taskTitle: string, message: string): void {
        try {
            if (typeof Notification === "undefined") return
            if (Notification.permission !== "granted") return
            if (typeof document !== "undefined" && document.hasFocus()) return

            const tag = `openade-task-${taskId}`
            const notification = new Notification(taskTitle, {
                body: message,
                tag,
            })

            // Store reference to prevent GC from collecting the notification
            // before the user clicks it (macOS/Electron drops onclick otherwise)
            this.activeNotifications.set(tag, notification)

            const cleanup = () => {
                this.activeNotifications.delete(tag)
            }

            notification.onclick = () => {
                cleanup()
                notification.close()
                window.focus()
                try {
                    this.store.config.navigateToTask(workspaceId, taskId)
                } catch (err) {
                    console.error("[NotificationManager] Failed to navigate:", err)
                }
            }

            notification.onclose = () => {
                cleanup()
            }

            setTimeout(cleanup, NOTIFICATION_CLEANUP_MS)
        } catch (err) {
            console.error("[NotificationManager] Failed to send notification:", err)
        }
    }
}
