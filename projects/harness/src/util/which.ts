import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"

/**
 * Finds a binary on PATH. Returns absolute path or undefined.
 * Checks common install locations if not on PATH.
 */
export async function resolveExecutable(name: string, extraPaths?: string[]): Promise<string | undefined> {
    // Try `which` first
    try {
        const result = execFileSync("which", [name], {
            encoding: "utf-8",
            timeout: 5000,
            stdio: ["pipe", "pipe", "pipe"],
        }).trim()
        if (result) return result
    } catch {
        // Not found on PATH
    }

    // Check common install locations
    const defaultExtraPaths = [
        join(homedir(), ".local", "bin"),
        "/usr/local/bin",
        "/opt/homebrew/bin",
        join(homedir(), ".npm-global", "bin"),
        join(homedir(), ".yarn", "bin"),
    ]

    const searchPaths = [...(extraPaths ?? []), ...defaultExtraPaths]

    for (const dir of searchPaths) {
        const fullPath = join(dir, name)
        if (existsSync(fullPath)) {
            return fullPath
        }
    }

    return undefined
}
