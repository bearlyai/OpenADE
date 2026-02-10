import { app, ipcMain } from "electron"
import logger from "electron-log"
import { autoUpdater } from "electron-updater"
import { isDev } from "../config"
import { currentExecutor } from "../executor"

// Debug autoupdater until we're confident in it
autoUpdater.logger = logger
// @ts-ignore
autoUpdater.logger.transports.file.level = "debug"
// @ts-ignore
autoUpdater.logger.level = "debug"

let pendingUpdate = false
const notifyFeOnUpdateAvailable = () => {
    pendingUpdate = true
    const executorWindow = currentExecutor().window
    if (!executorWindow) {
        return
    }
    try {
        executorWindow.webContents.send("app:update-available")
    } catch (e) {
        logger.warn("Error notifying FE of update", e)
    }
}

const notifyFeOnUpdateError = () => {
    const executorWindow = currentExecutor().window
    if (!executorWindow) {
        return
    }
    try {
        executorWindow.webContents.send("app:update-error")
    } catch (e) {
        logger.warn("Error notifying FE of update error", e)
    }
}

function checkForUpdatesAndNotify() {
    if (!autoUpdater.isUpdaterActive()) {
        return Promise.resolve(null)
    }
    return autoUpdater
        .checkForUpdates()
        .then((it) => {
            if (!it) {
                return
            }
            const downloadPromise = it.downloadPromise
            if (downloadPromise == null) {
                // @ts-ignore
                const debug = autoUpdater._logger.debug
                if (debug != null) {
                    debug("checkForUpdatesAndNotify called, downloadPromise is null")
                }
                return it
            }
            downloadPromise
                .then(() => {
                    notifyFeOnUpdateAvailable()
                })
                .catch((e: unknown) => {
                    logger.warn("Auto-update download failed", e)
                    notifyFeOnUpdateError()
                })
            return it
        })
        .catch((e: unknown) => {
            logger.warn("Auto-update check failed", e)
            notifyFeOnUpdateError()
            return null
        })
}

export const load = () => {
    // Check for updates
    if (!isDev) {
        checkForUpdatesAndNotify()
        setInterval(checkForUpdatesAndNotify, 60000 * 30) // Check for updates every 30 minutes
    }

    app.whenReady().then(() => {
        // give them the notification again if they reload the app
        app.on("web-contents-created", (_, contents) => {
            contents.on("did-finish-load", () => {
                if (pendingUpdate) {
                    setTimeout(() => {
                        notifyFeOnUpdateAvailable()
                    }, 5000)
                }
            })
        })

        ipcMain.handle("retry-update-check", () => {
            return checkForUpdatesAndNotify()
        })

        ipcMain.handle("apply-update", () => {
            pendingUpdate = false
            autoUpdater.quitAndInstall()
            setTimeout(() => {
                app.quit()
            }, 90000) // There was no update force quit so pending update/issue potentially disappears
        })
    })
}
