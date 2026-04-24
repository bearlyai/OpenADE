import { makeAutoObservable } from "mobx"
import { DEFAULT_DIFF_CONTEXT, type DiffContextSetting } from "../../utils/gitDiffContext"

export type ViewMode = "split" | "unified" | "current"

export class UIStateManager {
    viewMode: ViewMode = "unified"
    diffContext: DiffContextSetting = DEFAULT_DIFF_CONTEXT
    updateAvailable = false

    constructor() {
        makeAutoObservable(this)
    }

    setViewMode(mode: ViewMode): void {
        this.viewMode = mode
    }

    setDiffContext(context: DiffContextSetting): void {
        this.diffContext = context
    }

    setUpdateAvailable(available: boolean): void {
        this.updateAvailable = available
    }
}
