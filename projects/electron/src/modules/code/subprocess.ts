/**
 * Centralized Subprocess Execution & Environment Module
 *
 * All subprocess calls in modules/code/ should use this module.
 * Manages environment variables from two sources:
 * 1. Shell environment — detected at startup by spawning the user's login shell
 *    (fixes the Electron/Finder/Dock launch problem where PATH is minimal)
 * 2. Global env vars — pushed from renderer (user Settings)
 *
 * Both sources are merged directly into process.env so all spawn sites
 * (including those that don't go through execCommand) inherit them automatically.
 */

import { execFile, spawn } from "child_process"
import { ipcMain, type IpcMainInvokeEvent } from "electron"
import logger from "electron-log"
import { userInfo } from "os"
import { isDev } from "../../config"

// ============================================================================
// Shell Environment Detection
// Adapted from https://github.com/sindresorhus/shell-env (MIT)
// Inlined to avoid ESM/CJS compatibility issues with Electron's CJS build.
// ============================================================================

const SHELL_ENV_DELIMITER = "_SHELL_ENV_DELIMITER_"

// Regex to strip ANSI escape codes (covers colors, cursor movement, etc.)
// From https://github.com/chalk/ansi-regex
const ANSI_REGEX =
    /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-ntqry=><~]))/g

function detectDefaultShell(): string {
    if (process.platform === "win32") {
        return process.env.COMSPEC || "cmd.exe"
    }
    try {
        const { shell } = userInfo()
        if (shell) return shell
    } catch {}
    return process.platform === "darwin" ? process.env.SHELL || "/bin/zsh" : process.env.SHELL || "/bin/sh"
}

function parseShellEnv(stdout: string): Record<string, string> {
    const parts = stdout.split(SHELL_ENV_DELIMITER)
    if (parts.length < 2) return {}
    const envSection = parts[1]
    const result: Record<string, string> = {}
    for (const line of envSection.replace(ANSI_REGEX, "").split("\n").filter(Boolean)) {
        const idx = line.indexOf("=")
        if (idx > 0) {
            result[line.substring(0, idx)] = line.substring(idx + 1)
        }
    }
    return result
}

function execShell(shell: string): Promise<string> {
    return new Promise((resolve, reject) => {
        execFile(
            shell,
            ["-ilc", `echo -n "${SHELL_ENV_DELIMITER}"; command env; echo -n "${SHELL_ENV_DELIMITER}"; exit`],
            {
                timeout: 5000,
                env: {
                    // Disables Oh My Zsh auto-update that can block the process
                    DISABLE_AUTO_UPDATE: "true",
                    // Prevents the oh-my-zsh tmux plugin from auto-starting
                    ZSH_TMUX_AUTOSTARTED: "true",
                    ZSH_TMUX_AUTOSTART: "false",
                },
            },
            (error, stdout) => {
                if (error) reject(error)
                else resolve(stdout)
            },
        )
    })
}

/**
 * Detect the user's shell environment by spawning their login shell.
 * Falls back to /bin/zsh then /bin/bash if the default shell fails.
 * Merges the result into process.env so all child processes inherit it.
 */
async function initShellEnv(): Promise<void> {
    if (process.platform === "win32") return

    const defaultShell = detectDefaultShell()
    const fallbackShells = ["/bin/zsh", "/bin/bash"].filter((s) => s !== defaultShell)

    for (const shell of [defaultShell, ...fallbackShells]) {
        try {
            const stdout = await execShell(shell)
            const env = parseShellEnv(stdout)
            if (Object.keys(env).length > 0) {
                // Merge shell PATH with existing PATH instead of overwriting.
                // This preserves any paths already added (e.g. managed binaries).
                if (env.PATH) {
                    const sep = ":"  // win32 early-returns above
                    const currentPath = process.env.PATH || ""
                    const shellEntries = env.PATH.split(sep).filter((p) => !currentPath.includes(p))
                    if (shellEntries.length > 0) {
                        env.PATH = `${currentPath}${sep}${shellEntries.join(sep)}`
                    } else {
                        env.PATH = currentPath
                    }
                }
                Object.assign(process.env, env)
                logger.info("[Subprocess] Shell env loaded from", shell, "PATH:", (process.env.PATH || "").substring(0, 200))
                return
            }
        } catch (err) {
            logger.warn("[Subprocess] Failed to load shell env from", shell, err)
        }
    }

    logger.warn("[Subprocess] Could not load shell env from any shell, using system defaults")
}

// ============================================================================
// Global Environment Variables (from user Settings)
// ============================================================================

// Track overrides so we can restore original values when env vars change
let previousOverrides: Record<string, string | undefined> = {}
let previousOverrideKeys: Set<string> = new Set()

/**
 * Set global environment variables by mutating process.env directly.
 * Tracks previous values so they can be restored when new vars are pushed or on cleanup.
 */
function setGlobalEnvVars(env: Record<string, string>): void {
    // Restore previous overrides
    for (const key of previousOverrideKeys) {
        if (previousOverrides[key] === undefined) {
            delete process.env[key]
        } else {
            process.env[key] = previousOverrides[key]
        }
    }

    // Save originals for the new keys, then apply
    previousOverrides = {}
    previousOverrideKeys = new Set(Object.keys(env))
    for (const key of previousOverrideKeys) {
        previousOverrides[key] = process.env[key]
        process.env[key] = env[key]
    }

    logger.info(
        "[Subprocess] Global env vars updated",
        JSON.stringify({
            count: Object.keys(env).length,
            keys: Object.keys(env),
        }),
    )
}


// ============================================================================
// Subprocess Execution
// ============================================================================

export interface ExecOptions {
    cwd?: string
    timeout?: number // ms, default 30000
    maxBuffer?: number // bytes, default 50MB
    env?: Record<string, string> // Additional env vars for this call only
}

export interface ExecResult {
    stdout: string
    stderr: string
    success: boolean
    code: number | null
}

/**
 * Execute a command asynchronously with merged environment variables.
 *
 * Environment variable merge order (later overrides earlier):
 * 1. process.env (includes shell env + global env vars, already merged)
 * 2. options.env (call-specific env vars)
 */
export async function execCommand(cmd: string, args: string[], options: ExecOptions = {}): Promise<ExecResult> {
    const { cwd, timeout = 30000, maxBuffer = 50 * 1024 * 1024, env: callEnv } = options

    const mergedEnv = { ...process.env, ...callEnv }

    return new Promise((resolve) => {
        let stdout = ""
        let stderr = ""
        let killed = false
        let resolved = false

        const child = spawn(cmd, args, {
            cwd,
            env: mergedEnv,
            stdio: ["ignore", "pipe", "pipe"],
        })

        const timeoutId =
            timeout > 0
                ? setTimeout(() => {
                      killed = true
                      child.kill("SIGTERM")
                  }, timeout)
                : null

        child.stdout?.on("data", (data) => {
            if (stdout.length < maxBuffer) {
                stdout += data.toString()
            }
        })

        child.stderr?.on("data", (data) => {
            if (stderr.length < maxBuffer) {
                stderr += data.toString()
            }
        })

        child.on("error", (err) => {
            if (resolved) return
            resolved = true
            if (timeoutId) clearTimeout(timeoutId)
            resolve({
                stdout: "",
                stderr: err.message,
                success: false,
                code: null,
            })
        })

        child.on("close", (code) => {
            if (resolved) return
            resolved = true
            if (timeoutId) clearTimeout(timeoutId)
            resolve({
                stdout: stdout.replace(/\r\n/g, "\n"),
                stderr: stderr.replace(/\r\n/g, "\n"),
                success: code === 0 && !killed,
                code,
            })
        })
    })
}

// ============================================================================
// IPC Handlers
// ============================================================================

/**
 * Check if caller is allowed
 */
function checkAllowed(e: IpcMainInvokeEvent): boolean {
    const origin = e.sender.getURL()
    try {
        const url = new URL(origin)
        if (isDev) {
            return url.hostname.endsWith("localhost")
        } else {
            return url.hostname.endsWith("localhost") || url.protocol === "file:"
        }
    } catch {
        return false
    }
}

// ============================================================================
// Module Export
// ============================================================================

export const load = () => {
    logger.info("[Subprocess] Registering IPC handlers")

    // Detect the user's shell environment (fire-and-forget).
    // Resolves in ~200-500ms, well before any user interaction triggers a subprocess.
    initShellEnv().catch((err) => logger.error("[Subprocess] initShellEnv unexpected error", err))

    ipcMain.handle("code:system:setGlobalEnv", async (event, { env }: { env: Record<string, string> }) => {
        if (!checkAllowed(event)) throw new Error("not allowed")
        setGlobalEnvVars(env)
        return { success: true }
    })

    logger.info("[Subprocess] IPC handlers registered")
}

export const cleanup = () => {
    // Restore process.env to pre-override state
    for (const key of previousOverrideKeys) {
        if (previousOverrides[key] === undefined) {
            delete process.env[key]
        } else {
            process.env[key] = previousOverrides[key]
        }
    }
    previousOverrides = {}
    previousOverrideKeys = new Set()
    logger.info("[Subprocess] Cleanup complete")
}
