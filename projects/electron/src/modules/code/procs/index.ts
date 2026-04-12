/**
 * Procs module - openade.toml configuration system
 *
 * Provides discovery, parsing, and utilities for config files.
 * The parsing and utility code is designed to be extractable to a standalone library.
 */

import { ipcMain, type IpcMainInvokeEvent } from "electron"
import log from "electron-log"
import * as fs from "fs/promises"
import * as path from "path"
import { parseEditableProcsFile, parseProcsFile } from "./parse"
import { detectGitInfo, findProcsFiles } from "./discover"
import { serializeProcsFile } from "./serialize"
import type { CronInput, EditableProcsFile, ProcessInput, ProcsConfig, ProcsConfigError, ReadProcsResult, SaveEditableProcsResult } from "./types"
import { isDev } from "../../../config"

const logger = log.scope("procs")

/** Config filenames that can be read/written via IPC */
const ALLOWED_CONFIG_FILENAMES = new Set(["openade.toml"])

// Re-export everything for library use
export * from "./types"
export * from "./parse"
export * from "./discover"
export * from "./serialize"

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
 * Validate that a file path points to a config file
 */
function validateConfigFilePath(filePath: string): void {
    const basename = path.basename(filePath)
    if (!ALLOWED_CONFIG_FILENAMES.has(basename)) {
        throw new Error(`Can only access openade.toml files, got: ${basename}`)
    }
}

/**
 * Handle procs:read request
 */
async function handleReadProcs(params: { path: string }): Promise<ReadProcsResult> {
    const searchRoot = params.path
    logger.info(`[Procs] Reading config from ${searchRoot}`)

    // Detect git info
    const gitInfo = await detectGitInfo(searchRoot)
    logger.debug(`[Procs] Git info:`, JSON.stringify(gitInfo))

    // Find all config files (openade.toml)
    const configFiles = await findProcsFiles(searchRoot, gitInfo)
    logger.info(`[Procs] Found ${configFiles.length} config files`)

    // Parse each file
    const configs: ProcsConfig[] = []
    const errors: ProcsConfigError[] = []

    for (const filePath of configFiles) {
        try {
            const content = await fs.readFile(filePath, "utf-8")
            const relativePath = path.relative(gitInfo?.repoRoot ?? searchRoot, filePath)
            const result = parseProcsFile(content, relativePath)

            if ("config" in result) {
                configs.push(result.config)
                logger.debug(`[Procs] Parsed ${relativePath}: ${result.config.processes.length} processes, ${result.config.crons.length} crons`)
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

async function getRepoRootForPath(filePath: string, searchPath?: string): Promise<string> {
    if (searchPath) {
        const gitInfo = await detectGitInfo(searchPath)
        return gitInfo?.repoRoot ?? searchPath
    }

    const parentDir = path.dirname(filePath)
    const gitInfo = await detectGitInfo(parentDir)
    return gitInfo?.repoRoot ?? parentDir
}

async function handleLoadEditable(params: { filePath: string; searchPath?: string }): Promise<EditableProcsFile> {
    validateConfigFilePath(params.filePath)
    const rawContent = await fs.readFile(params.filePath, "utf-8")
    const repoRoot = await getRepoRootForPath(params.filePath, params.searchPath)
    const relativePath = path.relative(repoRoot, params.filePath)
    const parsed = parseEditableProcsFile(rawContent, relativePath)

    if ("error" in parsed) {
        throw new Error(parsed.error.error)
    }

    return {
        filePath: params.filePath,
        relativePath,
        processes: parsed.processes,
        crons: parsed.crons,
        rawContent,
    }
}

function handleParseRaw(params: { content: string; relativePath: string }): { processes: ProcessInput[]; crons: CronInput[] } {
    const parsed = parseEditableProcsFile(params.content, params.relativePath)
    if ("error" in parsed) {
        throw new Error(parsed.error.error)
    }
    return parsed
}

function handleSerialize(params: { processes: ProcessInput[]; crons: CronInput[] }): { rawContent: string } {
    return {
        rawContent: serializeProcsFile({
            processes: params.processes,
            crons: params.crons,
        }),
    }
}

async function handleSaveEditable(params: {
    filePath: string
    relativePath: string
    processes: ProcessInput[]
    crons: CronInput[]
    searchPath?: string
}): Promise<SaveEditableProcsResult> {
    validateConfigFilePath(params.filePath)

    const rawContent = serializeProcsFile({
        processes: params.processes,
        crons: params.crons,
    })

    await fs.mkdir(path.dirname(params.filePath), { recursive: true })
    await fs.writeFile(params.filePath, rawContent, "utf-8")

    const readResult = params.searchPath ? await handleReadProcs({ path: params.searchPath }) : undefined

    return {
        filePath: params.filePath,
        relativePath: params.relativePath,
        rawContent,
        readResult,
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

    // Read raw file content (for the cron edit modal)
    ipcMain.handle("procs:readFile", async (event, params: { filePath: string }): Promise<string> => {
        if (!checkAllowed(event)) throw new Error("not allowed")
        validateConfigFilePath(params.filePath)
        return fs.readFile(params.filePath, "utf-8")
    })

    // Write raw file content (from the cron edit modal)
    ipcMain.handle("procs:writeFile", async (event, params: { filePath: string; content: string }): Promise<void> => {
        if (!checkAllowed(event)) throw new Error("not allowed")
        validateConfigFilePath(params.filePath)
        await fs.writeFile(params.filePath, params.content, "utf-8")
    })

    ipcMain.handle("procs:loadEditable", async (event, params: { filePath: string; searchPath?: string }): Promise<EditableProcsFile> => {
        if (!checkAllowed(event)) throw new Error("not allowed")
        return handleLoadEditable(params)
    })

    ipcMain.handle(
        "procs:parseRaw",
        async (event, params: { content: string; relativePath: string }): Promise<{ processes: ProcessInput[]; crons: CronInput[] }> => {
            if (!checkAllowed(event)) throw new Error("not allowed")
            return handleParseRaw(params)
        }
    )

    ipcMain.handle(
        "procs:serializeEditable",
        async (event, params: { processes: ProcessInput[]; crons: CronInput[] }): Promise<{ rawContent: string }> => {
            if (!checkAllowed(event)) throw new Error("not allowed")
            return handleSerialize(params)
        }
    )

    ipcMain.handle(
        "procs:saveEditable",
        async (
            event,
            params: {
                filePath: string
                relativePath: string
                processes: ProcessInput[]
                crons: CronInput[]
                searchPath?: string
            }
        ): Promise<SaveEditableProcsResult> => {
            if (!checkAllowed(event)) throw new Error("not allowed")
            return handleSaveEditable(params)
        }
    )

    logger.info("[Procs] IPC handlers registered successfully")
}

/**
 * Cleanup procs module
 */
export const cleanup = () => {
    logger.info("[Procs] Cleanup called")
    // No persistent state to clean up currently
}
