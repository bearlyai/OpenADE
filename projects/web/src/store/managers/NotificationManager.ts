import type { ActionEvent } from "../../types"
import type { CodeStore } from "../store"

type NotifiableEventType = "plan" | "revise" | "action" | "runPlan"

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

    private isNotifiableEvent(eventType: string): eventType is NotifiableEventType {
        return ["plan", "revise", "action", "runPlan"].includes(eventType)
    }

    private getNotificationMessage(eventType: NotifiableEventType, label?: string): string {
        switch (eventType) {
            case "plan":
                return "Planning complete."
            case "revise":
                return "Plan revision complete."
            case "action":
                return label ? `${label} complete.` : "Action complete."
            case "runPlan":
                return "Plan execution complete."
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

    private handleEvent(taskId: string, eventType: string): void {
        if (!this.isNotifiableEvent(eventType)) return

        const task = this.store.tasks.getTask(taskId)
        if (!task) return

        const label = eventType === "action" ? this.getActionLabel(taskId) : undefined
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
