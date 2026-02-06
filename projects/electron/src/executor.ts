import { app, BrowserWindow, globalShortcut, ipcMain, Rectangle, screen } from "electron"
import logger from "electron-log"
import Store from "electron-store"
import debounce from "lodash/debounce"
import * as path from "path"
import { isDev, getMainUrl } from "./config"
import { manageWindowsAutoHide } from "./modules/windowControls"
import { getLastFrameColors } from "./modules/windowFrame"
import { waitFor } from "./utils"

let executorWindow: BrowserWindow | null = null

const cantLoadPath = (): string => {
    // Note: this path is used in
    let viewerPath = "pages/cantLoad.html"
    if (!isDev) {
        viewerPath = path.join(process.resourcesPath, "dist", "pages", "cantLoad.html")
    }
    return viewerPath
}

const windowSizeStorageKey = "openade-window-size"
const wasFocusedLastStorageKey = "openade-last-focused"
const store = new Store()

const forceEnableDevTools = () => {
    const wasEnabled = isDevToolsEnabled()
    store.set("enable-dev-tools", true)
    if (!wasEnabled) {
        app.relaunch()
        app.quit()
    } else {
        currentExecutor().window?.webContents.openDevTools()
    }
}

const isDevToolsEnabled = (): boolean => {
    if (store.get("enable-dev-tools") === true) {
        return true
    }
    if (isDev) {
        return true
    }
    return false
}

export const defaultExecutorBounds = (): Rectangle => {
    const currentDisplay = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const heightRatio = 0.8
    const width = Math.floor(Math.min(1000, 0.9 * currentDisplay.bounds.width))
    const height = Math.floor(Math.min(800, currentDisplay.bounds.height * heightRatio))
    const x = Math.floor((currentDisplay.bounds.width - width) / 2)
    const y = Math.floor((currentDisplay.bounds.height - height) / 2)
    return { x, y, height, width }
}

const loadLastWindowSize = (): Rectangle => {
    try {
        const res = store.get(windowSizeStorageKey) as Rectangle | null
        if (res && res.height > 50 && res.width > 50) {
            return res
        }
    } catch (e) {
        // pass
    }
    return defaultExecutorBounds()
}

const saveWindowSize = debounce(
    (bounds: Rectangle) => {
        store.set(windowSizeStorageKey, bounds)
    },
    1000,
    { leading: false, trailing: true }
)

const startExecutor = () => {
    if (executorWindow && !executorWindow.isDestroyed()) {
        console.debug("can't recreate, a window is already running")
        return
    }
    executorWindow = null
    const executorUrl = getMainUrl()
    const mbExecutor = new BrowserWindow({
        title: "OpenADE",
        resizable: true,
        titleBarStyle: "hidden",
        titleBarOverlay: {
            height: 0,
            ...getLastFrameColors(),
        },
        trafficLightPosition: {
            x: 16,
            y: 14,
        },
        show: false,
        backgroundColor: "#202124",
        alwaysOnTop: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, "preload.js"),
            textAreasAreResizable: false,
            spellcheck: true,
            devTools: true,
            backgroundThrottling: false,
            scrollBounce: true,
        },
        ...loadLastWindowSize(),
    })

    // Block Cmd+W (macOS) and Ctrl+W (Windows/Linux) from closing the window
    // Intercept Cmd+R / Ctrl+R to do a graceful reload instead of Electron's default
    // which causes a transient did-fail-load and briefly shows the cantLoad page
    mbExecutor.webContents.on("before-input-event", (event, input) => {
        if (input.key.toLowerCase() === "w" && (input.meta || input.control) && !input.alt && !input.shift) {
            event.preventDefault()
        }
        if (input.key.toLowerCase() === "r" && (input.meta || input.control) && !input.alt && !input.shift && input.type === "keyDown") {
            event.preventDefault()
            loadSite()
        }
    })

    manageWindowsAutoHide(mbExecutor)

    const loadSite = () => {
        mbExecutor.loadURL(executorUrl)
    }

    mbExecutor.webContents.on("did-fail-load", (_, errorCode: number, errorDescription: string, validatedURL: string, isMainFrame: boolean) => {
        if (!isMainFrame) {
            return
        }
        const msg = `Got a did-fail-load on the main frame. Err code: ${errorCode} with description: ${errorDescription} and url: ${validatedURL}`
        logger.error(msg)

        setTimeout(() => {
            mbExecutor.webContents
                .loadFile(cantLoadPath(), {
                    query: {
                        errCode: errorCode.toString(),
                        errMessage: errorDescription,
                    },
                })
                .then(() => {
                    setTimeout(loadSite, isDev ? 2000 : 5000)
                })
        }, 100)
    })
    loadSite()

    mbExecutor.on("focus", () => {
        store.set(wasFocusedLastStorageKey, true)
    })

    mbExecutor.on("blur", () => {
        store.set(wasFocusedLastStorageKey, false)
    })

    // once or it fires every time theres a reload
    mbExecutor.once("ready-to-show", () => {
        if (isDev) {
            mbExecutor.webContents.openDevTools()
        }
        showExecutor()
        executorWindow = mbExecutor
    })

    mbExecutor.on("hide", () => {
        globalShortcut.unregister("Escape")
    })

    mbExecutor.on("resize", () => {
        const bounds = mbExecutor.getBounds()
        bounds && saveWindowSize(bounds)
    })

    mbExecutor.on("move", () => {
        const bounds = mbExecutor.getBounds()
        bounds && saveWindowSize(bounds)
    })

    mbExecutor.on("close", function () {
        app.quit()
    })
}

export const currentExecutor = (): { window: BrowserWindow | null } => {
    if (executorWindow && executorWindow.isDestroyed()) {
        startExecutor()
    }
    return {
        window: executorWindow,
    }
}

const showExecutor = async () => {
    try {
        let win = currentExecutor().window
        if (!win) {
            // For some reason handing off to the async loop in electron can fucking take a long assss time
            // like 400ms to 3.6s in some cases, its wack and makes no sense.... even if the async func returns immediately
            // so we only really do this when we need to (the window is dead).
            await waitFor(() => currentExecutor().window !== null, 50, 10000)
        }
        win = currentExecutor().window
        if (!win) {
            // unlikely
            return
        }
        if (process.platform === "win32") {
            win.setAlwaysOnTop(true)
            win.show()
            win.setAlwaysOnTop(false)
            app.focus()
        } else {
            win.show()
            win.focus()
        }
        return
    } catch (e) {
        logger.warn("unable to wait for the window in time")
        return
    }
}

export const load = () => {
    app.on("ready", () => {
        if (process.platform === "darwin") {
            app.dock?.show()
        }
        startExecutor()
        // for migrating the frontend app to have a frame
        ipcMain.handle("is-windowed-with-frame", async () => {
            return true
        })
    })

    // override as it is deabled on prod.
    ipcMain.handle("force-enable-dev-tools", () => {
        forceEnableDevTools()
    })
}
