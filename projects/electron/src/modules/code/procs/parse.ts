/**
 * TOML parser for procs.toml files
 *
 * Uses Zod for validation with clean error messages.
 */

import { parse as parseToml } from "smol-toml"
import { z } from "zod"
import type { ProcessDef, ProcsConfig, ProcsConfigError } from "./types"

/** Zod schema for a single process definition (TOML uses snake_case) */
const ProcessSchema = z.object({
    name: z.string().min(1, "name is required"),
    command: z.string().min(1, "command is required"),
    work_dir: z.string().optional(),
    url: z.string().optional(),
    type: z.enum(["setup", "daemon", "task", "check"]).default("daemon"),
})

/** Zod schema for the entire procs.toml file */
const ProcsFileSchema = z.object({
    process: z.array(ProcessSchema).default([]),
})

export type ParseResult = { config: ProcsConfig } | { error: ProcsConfigError }

/**
 * Parse a procs.toml file content into a ProcsConfig
 *
 * @param content - Raw TOML file content
 * @param relativePath - Path relative to repo root (used for error messages and process IDs)
 * @returns Parsed config or error
 */
export function parseProcsFile(content: string, relativePath: string): ParseResult {
    try {
        // Parse TOML
        const raw = parseToml(content)

        // Validate with Zod
        const parsed = ProcsFileSchema.parse(raw)

        // Transform to ProcessDef (snake_case -> camelCase, add id)
        const processes: ProcessDef[] = parsed.process.map((proc) => ({
            id: `${relativePath}::${proc.name}`,
            name: proc.name,
            command: proc.command,
            workDir: proc.work_dir,
            url: proc.url,
            type: proc.type,
        }))

        return { config: { relativePath, processes } }
    } catch (e) {
        if (e instanceof z.ZodError) {
            // Format Zod errors nicely
            const firstIssue = e.issues[0]
            const path = firstIssue.path.join(".")
            return {
                error: {
                    relativePath,
                    error: `${path}: ${firstIssue.message}`,
                },
            }
        }

        // TOML parse error
        const msg = e instanceof Error ? e.message : "Invalid TOML"
        const lineMatch = msg.match(/line (\d+)/i)
        return {
            error: {
                relativePath,
                error: msg,
                line: lineMatch ? parseInt(lineMatch[1], 10) : undefined,
            },
        }
    }
}
