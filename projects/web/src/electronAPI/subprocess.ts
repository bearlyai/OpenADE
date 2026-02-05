/**
 * Subprocess API Client
 *
 * Provides access to the centralized subprocess execution module in Electron.
 * Used to push global environment variables that apply to all subprocess calls.
 */

// ============================================================================
// Subprocess API Functions
// ============================================================================

/**
 * Set global environment variables for all subprocess calls in Electron.
 * These env vars are merged into process.env for all subprocess executions
 * (git, ripgrep, binary checks, etc.)
 *
 * @param env - Record of environment variable key-value pairs
 */
export async function setGlobalEnv(env: Record<string, string>): Promise<{ success: boolean }> {
    if (!window.openadeAPI) {
        console.warn("[SubprocessAPI] Not running in Electron, cannot set global env")
        return { success: false }
    }

    try {
        const response = (await window.openadeAPI.subprocess.setGlobalEnv({ env })) as { success: boolean }
        return response
    } catch (error) {
        console.error("[SubprocessAPI] Failed to set global env:", error)
        return { success: false }
    }
}
