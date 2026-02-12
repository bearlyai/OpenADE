import { execFileSync } from "node:child_process"

let cachedEnv: Record<string, string> | null = null

/**
 * Captures the user's real shell environment (PATH, etc.)
 * This solves the macOS Dock/Electron launch problem where PATH is minimal.
 * Spawns the user's login shell, runs `env`, parses output.
 * Result is cached for the process lifetime.
 */
export async function detectShellEnvironment(shell?: string): Promise<Record<string, string>> {
    if (cachedEnv) return cachedEnv

    const targetShell = shell ?? process.env.SHELL ?? "/bin/zsh"

    try {
        const output = execFileSync(targetShell, ["-lic", "env"], {
            encoding: "utf-8",
            timeout: 10000,
            stdio: ["pipe", "pipe", "pipe"],
            env: { ...process.env },
        })

        const env: Record<string, string> = {}
        // Parse KEY=VALUE lines. Values can contain = so only split on first =
        for (const line of output.split("\n")) {
            const eqIdx = line.indexOf("=")
            if (eqIdx > 0) {
                const key = line.slice(0, eqIdx)
                const value = line.slice(eqIdx + 1)
                // Skip keys that contain invalid chars (multi-line values, etc.)
                if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
                    env[key] = value
                }
            }
        }

        cachedEnv = env
        return env
    } catch (err) {
        // If shell detection fails, return current process.env as fallback
        const fallback: Record<string, string> = {}
        for (const [key, value] of Object.entries(process.env)) {
            if (value !== undefined) {
                fallback[key] = value
            }
        }
        return fallback
    }
}

/**
 * Clears the cached shell environment. Useful for testing.
 */
export function clearShellEnvironmentCache(): void {
    cachedEnv = null
}
