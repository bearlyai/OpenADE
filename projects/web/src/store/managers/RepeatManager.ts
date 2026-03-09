import { makeAutoObservable } from "mobx"
import { extractRawMessageEvents } from "../../electronAPI/harnessEventTypes"
import type { ActionEvent } from "../../types"
import type { CodeStore } from "../store"

const REPEAT_LABEL = "Repeat"

export class RepeatManager {
    activeTaskId: string | null = null
    stopOnText = ""
    iterationCount = 0

    private disposeAfterEvent: (() => void) | null = null

    constructor(private store: CodeStore) {
        makeAutoObservable<RepeatManager, "store" | "disposeAfterEvent">(this, {
            store: false,
            disposeAfterEvent: false,
        })
    }

    get isActive(): boolean {
        return this.activeTaskId !== null
    }

    start(taskId: string): void {
        // Clean up any previous repeat session
        if (this.isActive) this.cleanup()

        this.activeTaskId = taskId
        this.iterationCount = 0

        this.disposeAfterEvent = this.store.execution.onAfterEvent((completedTaskId, eventType) => {
            if (completedTaskId !== this.activeTaskId) return
            if (eventType !== "do") return
            this.onIterationComplete()
        })

        this.runNextIteration()
    }

    stop(): void {
        if (!this.activeTaskId) return
        this.cleanup()
    }

    setStopOnText(value: string): void {
        this.stopOnText = value
    }

    private onIterationComplete(): void {
        if (!this.activeTaskId) return

        if (this.stopOnText.trim() && this.shouldStopOnText()) {
            // Notify user that stop text was found
            this.sendStopTextNotification()
            this.cleanup()
            return
        }

        this.runNextIteration()
    }

    private shouldStopOnText(): boolean {
        if (!this.activeTaskId || !this.stopOnText.trim()) return false

        const task = this.store.tasks.getTask(this.activeTaskId)
        if (!task) return false

        const events = task.events
        const lastAction = [...events].reverse().find(
            (e) => e.type === "action" && (e.status === "completed" || e.status === "stopped")
        ) as ActionEvent | undefined
        if (!lastAction) return false

        const needle = this.stopOnText.trim().toLowerCase()
        const rawMessages = extractRawMessageEvents(lastAction.execution.events)
        for (const evt of rawMessages) {
            if (evt.harnessId === "claude-code" && evt.message.type === "assistant") {
                for (const block of evt.message.message.content) {
                    if (block.type === "text" && block.text.toLowerCase().includes(needle)) {
                        return true
                    }
                }
            }
        }
        return false
    }

    private sendStopTextNotification(): void {
        if (!this.activeTaskId) return
        try {
            if (typeof Notification === "undefined" || Notification.permission !== "granted") return
            const task = this.store.tasks.getTask(this.activeTaskId)
            const title = task?.title ?? "Task"
            new Notification(title, {
                body: `Repeat stopped: found "${this.stopOnText.trim()}" in output.`,
                tag: `openade-repeat-stop-${this.activeTaskId}`,
            })
        } catch {
            // Notification API may not be available
        }
    }

    private runNextIteration(): void {
        if (!this.activeTaskId) return
        this.iterationCount++

        const taskModel = this.store.tasks.getTaskModel(this.activeTaskId)
        if (!taskModel) {
            this.cleanup()
            return
        }

        const prompt = taskModel.input.value.trim()
        if (!prompt) {
            this.cleanup()
            return
        }

        this.store.execution.executeAction({
            taskId: this.activeTaskId,
            input: { userInput: prompt, images: [] },
            label: REPEAT_LABEL,
            includeComments: false,
        })
    }

    private cleanup(): void {
        this.disposeAfterEvent?.()
        this.disposeAfterEvent = null
        this.activeTaskId = null
        this.iterationCount = 0
        // stopOnText is intentionally preserved across sessions
    }
}

export { REPEAT_LABEL }
