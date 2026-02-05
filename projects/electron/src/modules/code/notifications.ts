/**
 * Notifications Module for Electron (macOS)
 *
 * Placeholder for future macOS notification state checking.
 * Uses the macos-notification-state package to check:
 * - Do Not Disturb status
 * - Screen lock status
 * - Session state
 *
 * Install: npm install macos-notification-state
 */

import { ipcMain, type IpcMainInvokeEvent } from "electron"
import logger from "electron-log"
import { isDev } from "../../config"

type SessionState = "SESSION_SCREEN_IS_LOCKED" | "SESSION_ON_CONSOLE_KEY" | "UNKNOWN"

type NotificationStateValue =
    | "SESSION_SCREEN_IS_LOCKED"
    | "SESSION_ON_CONSOLE_KEY"
    | "DO_NOT_DISTURB"
    | "UNKNOWN"
    | "UNKNOWN_ERROR"

interface NotificationState {
    doNotDisturb: boolean
    sessionState: SessionState
    notificationState: NotificationStateValue
}

function checkAllowed(e: IpcMainInvokeEvent): boolean {
    const origin = e.sender.getURL()
    try {
        const url = new URL(origin)
        if (isDev) {
            return url.hostname.endsWith("localhost")
        }
        return url.hostname.endsWith("localhost") || url.protocol === "file:"
    } catch (error) {
        logger.error("[Notifications:checkAllowed] Failed to parse origin:", error)
        return false
    }
}

/**
 * Get the current macOS notification state.
 * Returns null on non-macOS platforms or if the module is not available.
 */
function getNotificationState(): NotificationState | null {
    if (process.platform !== "darwin") {
        return null
    }

    try {
        // Dynamically require to avoid errors on non-macOS platforms
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const macosNotificationState = require("macos-notification-state")

        const doNotDisturb: boolean = macosNotificationState.getDoNotDisturb()
        const sessionState: SessionState = macosNotificationState.getSessionState()
        const notificationState: NotificationStateValue = macosNotificationState.getNotificationState()

        return {
            doNotDisturb,
            sessionState,
            notificationState,
        }
    } catch (err) {
        logger.warn("[Notifications] macos-notification-state not available:", err)
        return null
    }
}

/**
 * Check if we should show a notification based on macOS system state.
 * Returns true if:
 * - Not on macOS (let the browser handle it)
 * - Do Not Disturb is disabled AND screen is not locked
 */
function shouldShowNotification(): boolean {
    const state = getNotificationState()

    if (!state) {
        return true
    }

    if (state.doNotDisturb) {
        return false
    }

    if (state.sessionState === "SESSION_SCREEN_IS_LOCKED") {
        return false
    }

    return true
}

async function handleGetNotificationState(): Promise<NotificationState | null> {
    return getNotificationState()
}

async function handleShouldShowNotification(): Promise<boolean> {
    return shouldShowNotification()
}

export const load = () => {
    logger.info("[Notifications] Registering IPC handlers")

    ipcMain.handle("notifications:getState", async (event) => {
        if (!checkAllowed(event)) throw new Error("not allowed")
        return handleGetNotificationState()
    })

    ipcMain.handle("notifications:shouldShow", async (event) => {
        if (!checkAllowed(event)) throw new Error("not allowed")
        return handleShouldShowNotification()
    })

    logger.info("[Notifications] IPC handlers registered successfully")
}

export const cleanup = () => {
    logger.info("[Notifications] Cleanup called (no active resources to clean)")
}
