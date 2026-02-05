/**
 * Procs module - procs.toml configuration system
 *
 * Provides discovery, parsing, and utilities for procs.toml files.
 * The parsing and utility code is designed to be extractable to a standalone library.
 */

import { ipcMain, type IpcMainInvokeEvent } from "electron"
import log from "electron-log"
import * as fs from "fs/promises"
import * as path from "path"
import { parseProcsFile } from "./parse"
import { detectGitInfo, findProcsFiles } from "./discover"
import type { ReadProcsResult, ProcsConfig, ProcsConfigError } from "./types"
import { isDev } from "../../../config"

const logger = log.scope("procs")

// Re-export everything for library use
export * from "./types"
export * from "./parse"
export * from "./discover"

/**
 * Check if caller is allowed
 */
function checkAllowed(e: IpcMainInvokeEvent): boolean {
    const origin = e.sender.getURL()
    try {
        const url = new URL(origin)
        if (isDev) {
            return url.hostname.endsWith("localhost")
        }
        return url.hostname.endsWith("localhost") || url.protocol === "file:"
    } catch (error) {
        logger.error("[Procs:checkAllowed] Failed to parse origin:", error)
        return false
    }
}

/**
 * Handle procs:read request
 */
async function handleReadProcs(params: { path: string }): Promise<ReadProcsResult> {
    const searchRoot = params.path
    logger.info(`[Procs] Reading procs from ${searchRoot}`)

    // Detect git info
    const gitInfo = await detectGitInfo(searchRoot)
    logger.debug(`[Procs] Git info:`, JSON.stringify(gitInfo))

    // Find all procs.toml files
    const procsFiles = await findProcsFiles(searchRoot, gitInfo)
    logger.info(`[Procs] Found ${procsFiles.length} procs.toml files`)

    // Parse each file
    const configs: ProcsConfig[] = []
    const errors: ProcsConfigError[] = []

    for (const filePath of procsFiles) {
        try {
            const content = await fs.readFile(filePath, "utf-8")
            const relativePath = path.relative(gitInfo?.repoRoot ?? searchRoot, filePath)
            const result = parseProcsFile(content, relativePath)

            if ("config" in result) {
                configs.push(result.config)
                logger.debug(`[Procs] Parsed ${relativePath}: ${result.config.processes.length} processes`)
            } else {
                errors.push(result.error)
                logger.warn(`[Procs] Parse error in ${relativePath}: ${result.error.error}`)
            }
        } catch (e) {
            // File read error
            const relativePath = path.relative(gitInfo?.repoRoot ?? searchRoot, filePath)
            const error = e instanceof Error ? e.message : "Failed to read file"
            errors.push({ relativePath, error })
            logger.error(`[Procs] Read error for ${relativePath}: ${error}`)
        }
    }

    return {
        repoRoot: gitInfo?.repoRoot ?? searchRoot,
        searchRoot,
        isWorktree: gitInfo?.isWorktree ?? false,
        worktreeRoot: gitInfo?.worktreeRoot,
        configs,
        errors,
    }
}

/**
 * Load procs module - register IPC handlers
 */
export const load = () => {
    logger.info("[Procs] Registering IPC handlers")

    ipcMain.handle("procs:read", async (event, params: { path: string }): Promise<ReadProcsResult> => {
        if (!checkAllowed(event)) throw new Error("not allowed")
        return handleReadProcs(params)
    })

    logger.info("[Procs] IPC handlers registered successfully")
}

/**
 * Cleanup procs module
 */
export const cleanup = () => {
    logger.info("[Procs] Cleanup called")
    // No persistent state to clean up currently
}
