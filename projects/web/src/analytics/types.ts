/**
 * Analytics abstraction layer types.
 *
 * Defines a generic interface for analytics providers, allowing
 * different backends (Amplitude, PostHog, etc.) to be swapped easily.
 */

export interface AnalyticsProvider {
    /**
     * Initialize the analytics provider with a device ID.
     * Should be called once on app startup.
     */
    init(deviceId: string): void

    /**
     * Track an event with optional properties.
     * Event names are free-form strings defined at call sites.
     */
    track(event: string, properties?: Record<string, unknown>): void

    /**
     * Identify a user with optional traits.
     * For anonymous tracking, use the device ID.
     */
    identify(userId: string, traits?: Record<string, unknown>): void

    /**
     * Reset the analytics state (e.g., on logout).
     */
    reset(): void

    /**
     * Enable or disable analytics tracking.
     * When disabled, all track/identify calls should be no-ops.
     */
    setEnabled(enabled: boolean): void

    /**
     * Capture an exception with optional context.
     * Used for error tracking (e.g., Sentry).
     */
    captureError(error: Error, context?: { tags?: Record<string, string>; extra?: Record<string, unknown> }): void
}
