import { app, ipcMain } from "electron"
import Store from "electron-store"
import { currentExecutor } from "../executor"

const frameColorStore = new Store<Record<string, FrameColors>>()

interface FrameColors {
    symbolColor: string
    color: string
}

const defaultFrameColors: FrameColors = {
    // var(--secondaryBg) and var(--textLight)
    // set dynamically by javascript app
    color: "#27282D", // BG
    symbolColor: "#ABB2BA", // icon color
}

const storageKey = "window-frame-colors"
export const getLastFrameColors = (): FrameColors => {
    const storedColors = frameColorStore.get(storageKey)
    if (storedColors) {
        return storedColors
    }
    return defaultFrameColors
}

const updateColorsOnExecutorWindow = (color: FrameColors) => {
    const executorWindow = currentExecutor().window
    if (process.platform === "win32") {
        // this method is only available on windows.
        executorWindow?.setTitleBarOverlay(color)
    }
    frameColorStore.set(storageKey, color)
}

export const load = () => {
    app.whenReady().then(() => {
        ipcMain.handle("window-frame-enabled", () => {
            return true
        })
        ipcMain.handle("window-frame-set-colors", (_, colors: FrameColors) => {
            updateColorsOnExecutorWindow(colors)
        })
    })
}
