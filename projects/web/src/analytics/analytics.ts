/**
 * Analytics provider implementation.
 * Combines Amplitude for event tracking and Sentry for error tracking.
 */

import * as amplitude from "@amplitude/analytics-browser"
import * as Sentry from "@sentry/browser"
import type { AnalyticsProvider } from "./types"

// Amplitude API key - client-side keys are safe to expose
const AMPLITUDE_API_KEY = "5d0f1a208211c73ed80e48f89f4d9b5a"

// Sentry DSN - safe to expose (only allows sending events, not reading)
const SENTRY_DSN = "https://b4bc0904eefb535e3f528d7722b3e7f8@o4510828830720000.ingest.us.sentry.io/4510828832227328"

export class AnalyticsProviderImpl implements AnalyticsProvider {
    private enabled = true
    private initialized = false
    private sentryInitialized = false

    init(deviceId: string): void {
        // Initialize Amplitude
        if (!AMPLITUDE_API_KEY) {
            console.debug("[Analytics] No Amplitude API key configured, analytics disabled")
            this.enabled = false
            return
        }

        amplitude.init(AMPLITUDE_API_KEY, {
            deviceId,
            // Disable automatic tracking - we'll track events explicitly
            autocapture: false,
            // Don't track IP for privacy
            trackingOptions: {
                ipAddress: false,
            },
        })

        this.initialized = true
        console.debug("[Analytics] Amplitude initialized with device ID:", deviceId.slice(0, 8) + "...")

        // Initialize Sentry for renderer process
        if (SENTRY_DSN) {
            Sentry.init({
                dsn: SENTRY_DSN,
                sampleRate: 0.1,
                tracesSampleRate: 0,
                sendDefaultPii: false,
            })
            Sentry.setUser({ id: deviceId })
            this.sentryInitialized = true
            console.debug("[Analytics] Sentry initialized for renderer")
        }
    }

    track(event: string, properties?: Record<string, unknown>): void {
        if (!this.enabled || !this.initialized) return

        amplitude.track(event, properties)
        console.debug("[Analytics] Track:", event, properties)
    }

    identify(userId: string, traits?: Record<string, unknown>): void {
        if (!this.enabled || !this.initialized) return

        amplitude.setUserId(userId)
        if (traits) {
            const identifyEvent = new amplitude.Identify()
            for (const [key, value] of Object.entries(traits)) {
                // Amplitude accepts strings, numbers, booleans, and arrays of these
                if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || Array.isArray(value)) {
                    identifyEvent.set(key, value)
                }
            }
            amplitude.identify(identifyEvent)
        }
        console.debug("[Analytics] Identify:", userId, traits)
    }

    reset(): void {
        if (!this.initialized) return

        amplitude.reset()
        console.debug("[Analytics] Reset")
    }

    setEnabled(enabled: boolean): void {
        this.enabled = enabled

        // Update Sentry enabled state
        if (this.sentryInitialized) {
            const client = Sentry.getClient()
            if (client) {
                client.getOptions().enabled = enabled
            }
        }

        console.debug("[Analytics] Enabled:", enabled)
    }

    captureError(error: Error, context?: { tags?: Record<string, string>; extra?: Record<string, unknown> }): void {
        if (!this.enabled || !this.sentryInitialized) return

        Sentry.captureException(error, {
            tags: context?.tags,
            extra: context?.extra,
        })
        console.debug("[Analytics] Captured error:", error.message, context)
    }
}
