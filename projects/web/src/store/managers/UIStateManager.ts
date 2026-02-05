import { makeAutoObservable } from "mobx"

export type ViewMode = "split" | "unified" | "current"

export class UIStateManager {
    viewMode: ViewMode = "unified"
    updateAvailable = false

    constructor() {
        makeAutoObservable(this)
    }

    setViewMode(mode: ViewMode): void {
        this.viewMode = mode
    }

    setUpdateAvailable(available: boolean): void {
        this.updateAvailable = available
    }
}
