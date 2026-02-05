import { app, BrowserWindow, globalShortcut, ipcMain, Rectangle, screen } from "electron"

import logger from "electron-log"
import Store from "electron-store"
import { currentExecutor, defaultExecutorBounds } from "../executor"

// Sync with electornWindowApi.ts
type windowAction =
    | "minimize"
    | "maximize"
    | "left"
    | "right"
    | "always-on-top"
    | "not-always-on-top"
    | "default"
    | "toggle-maximize"
    | "auto-hide-on"
    | "auto-hide-off"

const store = new Store()

const autoHideStoreKey = "bearly-autohide"
let autoHideMode = store.get(autoHideStoreKey, false)
let pinned = false
let lastSize: Rectangle | null = null

const isMacOs = process.platform === "darwin"

export const manageWindowsAutoHide = (window: BrowserWindow) => {
    window.on("show", () => {
        if (autoHideMode) {
            globalShortcut.register("Escape", () => {
                if (window.isVisible()) {
                    window.hide()
                }
            })
        }
    })
    window.on("hide", () => {
        globalShortcut.unregister("Escape") // always unregister even if not in autohidemode to be safe
    })

    window.on("blur", () => {
        if (autoHideMode) {
            window.hide()
        }
    })

    if (autoHideMode && isMacOs) {
        app.dock?.hide()
    }
}

const setAutoHide = (v: boolean) => {
    autoHideMode = v
    store.set(autoHideStoreKey, v)
    if (isMacOs) {
        if (v && app.dock?.isVisible()) {
            app.dock?.hide()
        } else {
            app.dock?.show()
        }
    }
}

export const load = () => {
    // Close window when closing last tab
    const bestWindow = () => currentExecutor().window
    app.whenReady().then(() => {
        ipcMain.handle("window-is-pinned", async () => {
            return { pinned: pinned }
        })
        ipcMain.handle("window-is-autoHide", async () => {
            return { autoHide: autoHideMode }
        })

        ipcMain.handle("window-action", async (_, args) => {
            const action: windowAction = args.action
            const window = bestWindow()
            if (!window) {
                return
            }
            if (action === "maximize") {
                bestWindow()?.maximize()
            } else if (action === "minimize") {
                bestWindow()?.minimize()
            } else if (action === "left") {
                const width = 500
                const windowBounds = window.getBounds()
                const currentScreen = screen.getDisplayNearestPoint({ x: windowBounds.x, y: windowBounds.y })
                window.setBounds({ x: 0, y: 0, height: currentScreen.bounds.height, width: width }, true)
            } else if (action === "right") {
                const width = 500
                const windowBounds = window.getBounds()
                const currentScreen = screen.getDisplayNearestPoint({ x: windowBounds.x, y: windowBounds.y })
                window.setBounds(
                    {
                        x: Math.floor(currentScreen.bounds.width - width),
                        y: 0,
                        height: currentScreen.bounds.height,
                        width: Math.floor(width),
                    },
                    true
                )
            } else if (action === "toggle-maximize") {
                const w = bestWindow()
                if (!w) return
                if (!w.isMaximized()) {
                    lastSize = w.getBounds()
                    w.maximize()
                } else {
                    if (lastSize) {
                        w.setBounds(lastSize, true)
                    } else {
                        const windowBounds = w.getBounds()
                        const currentScreen = screen.getDisplayNearestPoint({ x: windowBounds.x, y: windowBounds.y })
                        w.setBounds(
                            {
                                // 20% padded box of the window by default if there isnt a config to rebound to.
                                x: Math.floor(currentScreen.bounds.width * 0.2),
                                y: Math.floor(currentScreen.bounds.height * 0.2),
                                height: Math.floor(currentScreen.bounds.height * 0.6),
                                width: Math.floor(currentScreen.bounds.width * 0.6),
                            },
                            true
                        )
                    }
                }
            } else if (action === "always-on-top") {
                window.setAlwaysOnTop(true)
                pinned = true
            } else if (action === "not-always-on-top") {
                window.setAlwaysOnTop(false)
                pinned = false
            } else if (action === "default") {
                const bounds = defaultExecutorBounds()
                window.setBounds(bounds, true)
                return
            } else if (action === "auto-hide-on") {
                setAutoHide(true)
            } else if (action === "auto-hide-off") {
                setAutoHide(false)
            } else {
                let _: never = action
                logger.warn("unknown action", _)
            }
        })
    })
}
