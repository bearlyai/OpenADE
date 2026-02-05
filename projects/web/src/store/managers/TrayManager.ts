/**
 * TrayManager - Manages tray state, keybindings, and configuration
 *
 * Centralizes tray open/close state and provides declarative tray configuration.
 * Each tray type defines its own button badge renderer and content renderer.
 */

import { makeAutoObservable } from "mobx"
import { getTrayConfig } from "../../components/tray/trayConfigs"
import type { TaskModel } from "../TaskModel"
import type { CodeStore } from "../store"

export type TrayType = "files" | "search" | "changes" | "terminal" | "processes"

export class TrayManager {
    openTray: TrayType | null = null

    constructor(
        readonly store: CodeStore,
        readonly taskModel: TaskModel
    ) {
        makeAutoObservable(this, {
            store: false,
            taskModel: false,
        })
    }

    get taskId(): string {
        return this.taskModel.taskId
    }

    get workspaceId(): string {
        return this.taskModel.workspaceId
    }

    toggle(tray: TrayType): void {
        const wasOpen = this.openTray === tray
        this.openTray = wasOpen ? null : tray
        if (!wasOpen) {
            console.debug("[TrayManager] toggle: calling onOpen for", tray)
            getTrayConfig(tray)?.onOpen?.(this)
        }
    }

    open(tray: TrayType): void {
        this.openTray = tray
        console.debug("[TrayManager] open: calling onOpen for", tray)
        getTrayConfig(tray)?.onOpen?.(this)
    }

    close(): void {
        this.openTray = null
    }

    get isOpen(): boolean {
        return this.openTray !== null
    }
}
