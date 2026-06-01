import "./runtimeProfile"

import { app, dialog, ipcMain, shell } from "electron"
import { configureLinuxDisplayBackend } from "./modules/linuxDisplayBackend"
configureLinuxDisplayBackend(app.commandLine)

// Initialize Sentry before the rest of the app loads.
import { initSentry, load as loadSentry, cleanup as cleanupSentry } from "./modules/sentry"
initSentry()

import logger from "electron-log"
import { load as loadExecutorWindow } from "./executor"
import { load as loadAutoUpdater } from "./modules/autoUpdate"
import { load as loadContextMenu } from "./modules/contextMenu"
import { load as loadFindInPage } from "./modules/findInPage"
import { load as loadMoveToApplications } from "./modules/moveToApplications"
import { load as loadWindowControls } from "./modules/windowControls"
import { load as loadWindowFrame } from "./modules/windowFrame"
import { load as loadSubprocess, cleanup as cleanupSubprocess } from "./modules/code/subprocess"
import { cleanup as cleanupHarness } from "./modules/code/harness"
import { cleanup as cleanupGit } from "./modules/code/git"
import { cleanup as cleanupProcess } from "./modules/code/process"
import { cleanup as cleanupPty } from "./modules/code/pty"
import { cleanup as cleanupFiles } from "./modules/code/files"
import { load as loadNotifications, cleanup as cleanupNotifications } from "./modules/code/notifications"
import { cleanup as cleanupProcs } from "./modules/code/procs"
import { load as loadShell, cleanup as cleanupShell } from "./modules/code/shell"
import { cleanup as cleanupMcp } from "./modules/code/mcp"
import { cleanup as cleanupPlatform } from "./modules/code/platform"
import { cleanup as cleanupYjsStorage } from "./modules/code/yjsStorage"
import { load as loadDataFolder, cleanup as cleanupDataFolder } from "./modules/code/dataFolder"
import { cleanup as cleanupCapabilities } from "./modules/code/capabilities"
import { load as loadBinaries, cleanup as cleanupBinaries } from "./modules/code/binaries"
import { load as loadCodeWindowFrame, cleanup as cleanupCodeWindowFrame } from "./modules/code/windowFrame"
import { cleanup as cleanupFilePreviewProtocol, load as loadFilePreviewProtocol, registerSchemes as registerFilePreviewProtocolSchemes } from "./modules/code/filePreviewProtocol"
import { load as loadCompanion, cleanup as cleanupCompanion } from "./modules/companion"
import { hasActiveRuntimeWork } from "./modules/companion/runtimeGateway"
import { isDev } from "./config"
import { load as loadRuntimeCore, cleanup as cleanupRuntimeCore } from "./modules/runtimeCore"

registerFilePreviewProtocolSchemes()

function envFlag(value: string | undefined, fallback = false): boolean {
    if (!value) return fallback
    return ["1", "true", "yes", "on"].includes(value.toLowerCase())
}

const main = () => {
    const companionEnabled = envFlag(process.env.OPENADE_ENABLE_COMPANION ?? process.env.VITE_OPENADE_ENABLE_COMPANION, isDev)
    const activeWorkQuitPromptDisabled =
        envFlag(process.env.OPENADE_DISABLE_ACTIVE_WORK_UNLOAD_BLOCKER) || envFlag(process.env.OPENADE_SMOKE_TEST)

    // OPENADE_SMOKE_TEST runs packaged smoke tests alongside any local production instance.
    if (!process.env.OPENADE_SMOKE_TEST) {
        const gotLock = app.requestSingleInstanceLock()
        if (!gotLock) {
            app.quit()
            return
        }
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
    loadSubprocess() // Must be loaded before other code modules that use execCommand
    loadBinaries() // Enhances PATH before harness/process execution.
    loadNotifications()
    loadShell()
    loadDataFolder()
    loadCodeWindowFrame()
    loadFilePreviewProtocol()
    loadRuntimeCore()
    if (companionEnabled) {
        loadCompanion()
    }

    ipcMain.handle("quit-app", () => {
        app.quit()
    })
    ipcMain.handle("open-url", (_, args) => {
        shell.openExternal(args)
    })

    // Graceful shutdown - show confirmation dialog if runtime-owned work is active.
    app.on("before-quit", (event) => {
        if (!activeWorkQuitPromptDisabled && hasActiveRuntimeWork()) {
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
        cleanupFilePreviewProtocol()
        cleanupRuntimeCore()
        if (companionEnabled) {
            void cleanupCompanion()
        }
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
        cleanupFilePreviewProtocol()
        cleanupRuntimeCore()
        if (companionEnabled) {
            void cleanupCompanion()
        }
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
        cleanupFilePreviewProtocol()
        cleanupRuntimeCore()
        if (companionEnabled) {
            void cleanupCompanion()
        }
        cleanupSubprocess()
        app.quit()
    })
}

main()
