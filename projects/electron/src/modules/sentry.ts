/**
 * Sentry Error Tracking Module
 *
 * Initializes Sentry for the main process and provides IPC handlers
 * for the renderer to access device config and update telemetry preferences.
 */

import * as Sentry from "@sentry/electron/main"
import { app, ipcMain } from "electron"
import { getDeviceConfig, setTelemetryDisabled } from "./deviceConfig"

// Sentry DSN - safe to expose (only allows sending events, not reading)
const SENTRY_DSN = "https://b4bc0904eefb535e3f528d7722b3e7f8@o4510828830720000.ingest.us.sentry.io/4510828832227328"

let initialized = false

/**
 * Initialize Sentry for the main process.
 * Must be called as early as possible, before any other code that might throw.
 */
export function initSentry(): void {
	if (initialized) return

	const config = getDeviceConfig()

	Sentry.init({
		dsn: SENTRY_DSN,
		enabled: !config.telemetryDisabled,
		release: `openade@${app.getVersion()}`,
		environment: process.env.NODE_ENV === "dev" ? "development" : "production",

		// Sample 10% of errors
		sampleRate: 0.1,
		tracesSampleRate: 0,

		// Don't send PII
		sendDefaultPii: false,

		beforeSend(event) {
			// Attach device ID for correlation with Amplitude
			event.user = { id: config.deviceId }
			return event
		},
	})

	initialized = true
	console.debug("[Sentry] Initialized for main process, enabled:", !config.telemetryDisabled)
}

/**
 * Register IPC handlers for renderer communication.
 */
export function load(): void {
	// IPC handler for renderer to get device config
	ipcMain.handle("get-device-config", () => {
		return getDeviceConfig()
	})

	// IPC handler for renderer to update telemetry preference
	ipcMain.handle("set-telemetry-disabled", (_, disabled: boolean) => {
		setTelemetryDisabled(disabled)
		// Note: Sentry in main process won't pick up the change until restart
		// This is acceptable - the renderer Sentry instance will update immediately
	})
}

/**
 * Cleanup IPC handlers.
 */
export function cleanup(): void {
	ipcMain.removeHandler("get-device-config")
	ipcMain.removeHandler("set-telemetry-disabled")
}
