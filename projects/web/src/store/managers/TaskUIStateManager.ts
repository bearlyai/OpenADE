import { makeAutoObservable } from "mobx"

export class TaskUIStateManager {
    expandedEventIds: Set<string> = new Set()

    constructor() {
        makeAutoObservable(this, {
            expandedEventIds: true,
        })
    }

    isEventExpanded(eventId: string): boolean {
        return this.expandedEventIds.has(eventId)
    }

    toggleEventExpanded(eventId: string): void {
        if (this.expandedEventIds.has(eventId)) {
            this.expandedEventIds.delete(eventId)
        } else {
            this.expandedEventIds.add(eventId)
        }
    }

    expandOnlyEvent(eventId: string): void {
        this.expandedEventIds.clear()
        this.expandedEventIds.add(eventId)
    }

    get hasExplicitState(): boolean {
        return this.expandedEventIds.size > 0
    }
}
