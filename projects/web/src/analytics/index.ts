/**
 * Analytics module entry point.
 *
 * Exports a singleton analytics provider and convenience functions.
 */

import { AnalyticsProviderImpl } from "./analytics"
import type { AnalyticsProvider } from "./types"

// Singleton analytics provider instance
export const analytics: AnalyticsProvider = new AnalyticsProviderImpl()

/**
 * Convenience function to track an event.
 * Event names are free-form strings - define them at call sites.
 *
 * Common events:
 * - "app_opened" - App startup
 * - "task_created" - New task created
 * - "command_run" - Command executed (plan/do/ask/revise/run_plan/retry)
 * - "execution_completed" - Execution finished
 * - "execution_error" - Execution failed
 * - "mcp_server_added" - MCP server added
 * - "mcp_server_removed" - MCP server removed
 * - "settings_changed" - Setting changed
 */
export function track(event: string, properties?: Record<string, unknown>): void {
    analytics.track(event, properties)
}

/**
 * Capture an exception with optional context.
 * Used for error tracking via Sentry.
 */
export function captureError(error: Error, context?: { tags?: Record<string, string>; extra?: Record<string, unknown> }): void {
    analytics.captureError(error, context)
}
