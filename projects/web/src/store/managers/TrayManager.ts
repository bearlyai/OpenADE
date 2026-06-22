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

export type TrayType = "files" | "search" | "changes" | "gitlog" | "terminal" | "processes" | "scratchpad"

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

    canOpen(tray: TrayType): boolean {
        const config = getTrayConfig(tray)
        return config?.isVisible?.(this) ?? true
    }

    get visibleOpenTray(): TrayType | null {
        if (!this.openTray) return null
        return this.canOpen(this.openTray) ? this.openTray : null
    }

    ensureOpenTrayVisible(): void {
        if (!this.openTray || this.canOpen(this.openTray)) return
        this.close()
    }

    toggle(tray: TrayType): void {
        const previousTray = this.openTray
        const closing = previousTray === tray
        if (!closing && !this.canOpen(tray)) return
        this.openTray = closing ? null : tray
        if (previousTray) {
            getTrayConfig(previousTray)?.onClose?.(this)
        }
        if (!closing) {
            getTrayConfig(tray)?.onOpen?.(this)
        }
    }

    open(tray: TrayType): void {
        if (!this.canOpen(tray)) return
        const previousTray = this.openTray
        if (previousTray === tray) return
        this.openTray = tray
        if (previousTray) {
            getTrayConfig(previousTray)?.onClose?.(this)
        }
        getTrayConfig(tray)?.onOpen?.(this)
    }

    close(): void {
        const previousTray = this.openTray
        this.openTray = null
        if (previousTray) {
            getTrayConfig(previousTray)?.onClose?.(this)
        }
    }

    get isOpen(): boolean {
        return this.visibleOpenTray !== null
    }
}
