/**
 * TOML parser for openade.toml files
 *
 * Uses Zod for validation with clean error messages.
 */

import { parse as parseToml } from "smol-toml"
import { z } from "zod"
import type { CronDef, CronInput, ProcessDef, ProcsConfig, ProcsConfigError, ProcessInput } from "./types"

/** Zod schema for a single process definition (TOML uses snake_case) */
const ProcessSchema = z.object({
    name: z.string().min(1, "name is required"),
    command: z.string().min(1, "command is required"),
    work_dir: z.string().optional(),
    url: z.string().optional(),
    type: z.enum(["setup", "daemon", "task", "check"]).default("daemon"),
})

/** Zod schema for a single cron definition (TOML uses snake_case) */
const CronSchema = z.object({
    name: z.string().min(1, "name is required"),
    schedule: z.string().min(1, "schedule is required"),
    type: z.enum(["plan", "do", "ask", "hyperplan"]),
    prompt: z.string().min(1, "prompt is required"),
    append_system_prompt: z.string().optional(),
    images: z.array(z.string()).optional(),
    isolation: z.enum(["head", "worktree"]).optional(),
    harness: z.string().optional(),
    in_task_id: z.string().optional(),
})

/** Zod schema for the entire config file */
const ConfigFileSchema = z.object({
    process: z.array(ProcessSchema).default([]),
    cron: z.array(CronSchema).default([]),
})

export type ParseResult = { config: ProcsConfig } | { error: ProcsConfigError }
export type ParseEditableResult = { processes: ProcessInput[]; crons: CronInput[] } | { error: ProcsConfigError }

/**
 * Parse an openade.toml file content into a ProcsConfig
 *
 * @param content - Raw TOML file content
 * @param relativePath - Path relative to repo root (used for error messages and IDs)
 * @returns Parsed config or error
 */
export function parseProcsFile(content: string, relativePath: string): ParseResult {
    try {
        // Parse TOML
        const raw = parseToml(content)

        // Validate with Zod
        const parsed = ConfigFileSchema.parse(raw)

        // Transform processes (snake_case -> camelCase, add id)
        const processes: ProcessDef[] = parsed.process.map((proc) => ({
            id: `${relativePath}::${proc.name}`,
            name: proc.name,
            command: proc.command,
            workDir: proc.work_dir,
            url: proc.url,
            type: proc.type,
        }))

        // Transform crons (snake_case -> camelCase, add id)
        const crons: CronDef[] = parsed.cron.map((c) => ({
            id: `${relativePath}::${c.name}`,
            name: c.name,
            schedule: c.schedule,
            type: c.type,
            prompt: c.prompt,
            appendSystemPrompt: c.append_system_prompt,
            images: c.images,
            isolation: c.isolation,
            harness: c.harness,
            inTaskId: c.in_task_id,
        }))

        return { config: { relativePath, processes, crons } }
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

export function parseEditableProcsFile(content: string, relativePath: string): ParseEditableResult {
    const result = parseProcsFile(content, relativePath)
    if ("error" in result) return result

    return {
        processes: result.config.processes.map((process) => ({
            name: process.name,
            command: process.command,
            workDir: process.workDir,
            url: process.url,
            type: process.type,
        })),
        crons: result.config.crons.map((cron) => ({
            name: cron.name,
            schedule: cron.schedule,
            type: cron.type,
            prompt: cron.prompt,
            appendSystemPrompt: cron.appendSystemPrompt,
            images: cron.images,
            isolation: cron.isolation,
            harness: cron.harness,
            inTaskId: cron.inTaskId,
        })),
    }
}
