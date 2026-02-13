// Initialize Sentry first, before any other code that might throw
import { initSentry, load as loadSentry, cleanup as cleanupSentry } from "./modules/sentry"
initSentry()

import { app, dialog, ipcMain, shell } from "electron"
import logger from "electron-log"
import { load as loadExecutorWindow } from "./executor"
import { load as loadAutoUpdater } from "./modules/autoUpdate"
import { load as loadContextMenu } from "./modules/contextMenu"
import { load as loadDirSync } from "./modules/dirAccess"
import { load as loadFindInPage } from "./modules/findInPage"
import { load as loadMoveToApplications } from "./modules/moveToApplications"
import { load as loadWindowControls } from "./modules/windowControls"
import { load as loadWindowFrame } from "./modules/windowFrame"
import { load as loadSubprocess, cleanup as cleanupSubprocess } from "./modules/code/subprocess"
import { load as loadHarness, cleanup as cleanupHarness, hasActiveQueries } from "./modules/code/harness"
import { load as loadGit, cleanup as cleanupGit } from "./modules/code/git"
import { load as loadProcess, cleanup as cleanupProcess } from "./modules/code/process"
import { load as loadPty, cleanup as cleanupPty } from "./modules/code/pty"
import { load as loadFiles, cleanup as cleanupFiles } from "./modules/code/files"
import { load as loadNotifications, cleanup as cleanupNotifications } from "./modules/code/notifications"
import { load as loadProcs, cleanup as cleanupProcs } from "./modules/code/procs"
import { load as loadShell, cleanup as cleanupShell } from "./modules/code/shell"
import { load as loadMcp, cleanup as cleanupMcp } from "./modules/code/mcp"
import { load as loadPlatform, cleanup as cleanupPlatform } from "./modules/code/platform"
import { load as loadYjsStorage, cleanup as cleanupYjsStorage } from "./modules/code/yjsStorage"
import { load as loadDataFolder, cleanup as cleanupDataFolder } from "./modules/code/dataFolder"
import { load as loadCapabilities, cleanup as cleanupCapabilities } from "./modules/code/capabilities"
import { load as loadBinaries, cleanup as cleanupBinaries } from "./modules/code/binaries"
import { load as loadCodeWindowFrame, cleanup as cleanupCodeWindowFrame } from "./modules/code/windowFrame"

const main = () => {
    const gotLock = app.requestSingleInstanceLock()
    if (!gotLock) {
        app.quit()
        return
    }
    logger.info("OpenADE starting with versions:", process.versions)
    loadSentry() // Register IPC handlers for device config
    loadExecutorWindow()
    loadMoveToApplications()
    loadAutoUpdater()
    loadWindowControls()
    loadWindowFrame()
    loadContextMenu()
    loadFindInPage()
    loadDirSync()
    loadSubprocess() // Must be loaded before other code modules that use execCommand
    loadBinaries() // Must be loaded before harness — enhances PATH with managed binaries
    loadCapabilities()
    loadHarness()
    loadGit()
    loadProcess()
    loadPty()
    loadFiles()
    loadNotifications()
    loadProcs()
    loadShell()
    loadMcp()
    loadPlatform()
    loadYjsStorage()
    loadDataFolder()
    loadCodeWindowFrame()

    ipcMain.handle("quit-app", () => {
        app.quit()
    })
    ipcMain.handle("open-url", (_, args) => {
        shell.openExternal(args)
    })

    // Graceful shutdown - abort active harness queries and cleanup git/processes/ptys
    // Show confirmation dialog if agents are running
    app.on("before-quit", (event) => {
        if (hasActiveQueries()) {
            const response = dialog.showMessageBoxSync({
                type: "warning",
                buttons: ["Cancel", "Quit Anyway"],
                defaultId: 0,
                cancelId: 0,
                title: "Agents Running",
                message: "Agents are still running",
                detail: "Quitting now may result in lost progress and corrupted state. Are you sure you want to quit?",
            })

            if (response === 0) {
                event.preventDefault()
                return
            }
        }

        cleanupSentry()
        cleanupHarness()
        cleanupGit()
        cleanupProcess()
        cleanupPty()
        cleanupFiles()
        cleanupNotifications()
        cleanupProcs()
        cleanupShell()
        cleanupMcp()
        cleanupPlatform()
        cleanupYjsStorage()
        cleanupDataFolder()
        cleanupCapabilities()
        cleanupBinaries()
        cleanupCodeWindowFrame()
        cleanupSubprocess()
    })

    process.on("SIGINT", () => {
        cleanupSentry()
        cleanupHarness()
        cleanupGit()
        cleanupProcess()
        cleanupPty()
        cleanupFiles()
        cleanupNotifications()
        cleanupProcs()
        cleanupShell()
        cleanupMcp()
        cleanupPlatform()
        cleanupYjsStorage()
        cleanupDataFolder()
        cleanupCapabilities()
        cleanupBinaries()
        cleanupCodeWindowFrame()
        cleanupSubprocess()
        app.quit()
    })

    process.on("SIGTERM", () => {
        cleanupSentry()
        cleanupHarness()
        cleanupGit()
        cleanupProcess()
        cleanupPty()
        cleanupFiles()
        cleanupNotifications()
        cleanupProcs()
        cleanupShell()
        cleanupMcp()
        cleanupPlatform()
        cleanupYjsStorage()
        cleanupDataFolder()
        cleanupCapabilities()
        cleanupBinaries()
        cleanupCodeWindowFrame()
        cleanupSubprocess()
        app.quit()
    })
}

main()
