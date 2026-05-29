/**
 * Procs module - openade.toml configuration system
 *
 * Provides discovery, parsing, and utilities for config files.
 * The parsing and utility code is designed to be extractable to a standalone library.
 */

import log from "electron-log"
import * as fs from "fs/promises"
import * as path from "path"
import { parseEditableProcsFile, parseProcsFile } from "./parse"
import { detectGitInfo, findProcsFiles } from "./discover"
import { serializeProcsFile } from "./serialize"
import type { CronInput, EditableProcsFile, ProcessInput, ProcsConfig, ProcsConfigError, ReadProcsResult, SaveEditableProcsResult } from "./types"

const logger = log.scope("procs")
const TRACE_PROCS_READS = process.env.OPENADE_TRACE_PROCS === "1"

/** Config filenames that can be read/written through the trusted runtime host methods. */
const ALLOWED_CONFIG_FILENAMES = new Set(["openade.toml"])

// Re-export everything for library use
export * from "./types"
export * from "./parse"
export * from "./discover"
export * from "./serialize"

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
 * Read openade.toml process config from a search root.
 */
export async function readRuntimeProcs(params: { path: string }): Promise<ReadProcsResult> {
    const searchRoot = params.path
    if (TRACE_PROCS_READS) logger.debug(`[Procs] Reading config from ${searchRoot}`)

    // Detect git info
    const gitInfo = await detectGitInfo(searchRoot)
    if (TRACE_PROCS_READS) logger.debug(`[Procs] Git info:`, JSON.stringify(gitInfo))

    // Find all config files (openade.toml)
    const configFiles = await findProcsFiles(searchRoot, gitInfo)
    if (TRACE_PROCS_READS) logger.debug(`[Procs] Found ${configFiles.length} config files`)

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
                if (TRACE_PROCS_READS) logger.debug(`[Procs] Parsed ${relativePath}: ${result.config.processes.length} processes, ${result.config.crons.length} crons`)
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

export async function readRuntimeProcsFile(params: { filePath: string }): Promise<string> {
    validateConfigFilePath(params.filePath)
    return fs.readFile(params.filePath, "utf-8")
}

export async function writeRuntimeProcsFile(params: { filePath: string; content: string }): Promise<void> {
    validateConfigFilePath(params.filePath)
    await fs.writeFile(params.filePath, params.content, "utf-8")
}

export async function loadRuntimeEditableProcs(params: { filePath: string; searchPath?: string }): Promise<EditableProcsFile> {
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

export function parseRuntimeEditableRaw(params: { content: string; relativePath: string }): { processes: ProcessInput[]; crons: CronInput[] } {
    const parsed = parseEditableProcsFile(params.content, params.relativePath)
    if ("error" in parsed) {
        throw new Error(parsed.error.error)
    }
    return parsed
}

export function serializeRuntimeEditableProcs(params: { processes: ProcessInput[]; crons: CronInput[] }): { rawContent: string } {
    return {
        rawContent: serializeProcsFile({
            processes: params.processes,
            crons: params.crons,
        }),
    }
}

export async function saveRuntimeEditableProcs(params: {
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

    const readResult = params.searchPath ? await readRuntimeProcs({ path: params.searchPath }) : undefined

    return {
        filePath: params.filePath,
        relativePath: params.relativePath,
        rawContent,
        readResult,
    }
}

/**
 * Cleanup procs module
 */
export const cleanup = () => {
    logger.info("[Procs] Cleanup called")
    // No persistent state to clean up currently
}
