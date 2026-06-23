import { makeAutoObservable } from "mobx"

export class TaskUIStateManager {
    // Event IDs the user has manually toggled away from their default expansion state.
    toggledEventIds: Set<string> = new Set()

    constructor() {
        makeAutoObservable(this, {
            toggledEventIds: true,
        })
    }

    isEventExpanded(eventId: string, defaultExpanded: boolean): boolean {
        return this.toggledEventIds.has(eventId) ? !defaultExpanded : defaultExpanded
    }

    toggleEventExpanded(eventId: string): void {
        if (this.toggledEventIds.has(eventId)) {
            this.toggledEventIds.delete(eventId)
        } else {
            this.toggledEventIds.add(eventId)
        }
    }
}
