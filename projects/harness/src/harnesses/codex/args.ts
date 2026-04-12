import { tmpdir } from "node:os"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import { writeFile } from "node:fs/promises"

import type { HarnessQuery, PromptPart } from "../../types.js"

export interface CodexHarnessConfig {
    binaryPath?: string
    tempDir?: string
}

export interface CodexArgBuildResult {
    command: string
    args: string[]
    env: Record<string, string>
    cwd?: string
    stdinData?: string
    structuredOutputPath?: string
    /** Temp files/dirs that need cleanup */
    cleanup: Array<{ path: string; type: "file" | "dir" }>
}

const THINKING_EFFORT_MAP: Record<string, string> = {
    low: "low",
    med: "medium",
    high: "high",
    max: "xhigh",
}

/**
 * Builds CLI arguments for the `codex` binary from a HarnessQuery.
 */
export async function buildCodexArgs(query: HarnessQuery, _config: CodexHarnessConfig, mcpConfigArgs?: string[]): Promise<CodexArgBuildResult> {
    const rootArgs: string[] = []
    const execArgs: string[] = []
    const env: Record<string, string> = {}
    const cleanup: Array<{ path: string; type: "file" | "dir" }> = []
    let structuredOutputPath: string | undefined

    // ── Root-level flags (before exec subcommand) ──

    // Permissions / mode
    if (query.mode === "read-only") {
        rootArgs.push("-a", "on-request")
    } else if (query.mode === "yolo") {
        rootArgs.push("--yolo")
    }

    // ── Subcommand ──
    if (query.resumeSessionId) {
        rootArgs.push("exec", "resume")
    } else {
        rootArgs.push("exec")
    }

    // ── Exec-level flags ──

    // Always JSON output
    execArgs.push("--json")

    // Skip git repo check — the app manages directory context
    execArgs.push("--skip-git-repo-check")

    // `codex exec resume` accepts a smaller flag set than `codex exec`.
    // Keep resume-safe flags outside this block, and gate the rest here.
    if (!query.resumeSessionId) {
        // Sandbox for read-only
        if (query.mode === "read-only") {
            execArgs.push("--sandbox", "read-only")
        }

        // Model
        if (query.model) {
            execArgs.push("-m", query.model)
        }

        // Working directory
        if (query.cwd) {
            execArgs.push("-C", query.cwd)
        }

        // Additional directories
        if (query.additionalDirectories) {
            for (const dir of query.additionalDirectories) {
                execArgs.push("--add-dir", dir)
            }
        }

        // Thinking / reasoning effort
        if (query.thinking) {
            const effort = THINKING_EFFORT_MAP[query.thinking]
            if (effort) {
                execArgs.push("-c", `model_reasoning_effort=${effort}`)
            }
        }

        // MCP config overrides (passed through from the harness class)
        if (mcpConfigArgs) {
            for (const arg of mcpConfigArgs) {
                execArgs.push("-c", arg)
            }
        }
    }

    // Fork session warning
    if (query.forkSession) {
        console.warn("[codex-harness] forkSession is not supported in Codex JSON mode. Ignoring.")
    }

    // ── Structured output ──
    if (query.outputSchema) {
        const schemaPath = join(tmpdir(), `harness-schema-${randomUUID()}.json`)
        structuredOutputPath = join(tmpdir(), `harness-output-${randomUUID()}.json`)
        await writeFile(schemaPath, JSON.stringify(query.outputSchema), "utf-8")
        execArgs.push("--output-schema", schemaPath)
        execArgs.push("--output-last-message", structuredOutputPath)
        cleanup.push({ path: schemaPath, type: "file" })
        cleanup.push({ path: structuredOutputPath, type: "file" })
    }

    // ── Build prompt and extract images ──
    const { promptText: rawPromptText, imagePaths, imageCleanup } = await resolveCodexPrompt(query.prompt)
    cleanup.push(...imageCleanup)

    // Image attachments via --image/-i flag.
    // Supported for both `codex exec` and `codex exec resume`.
    if (imagePaths.length > 0) {
        for (const imgPath of imagePaths) {
            execArgs.push("-i", imgPath)
        }
    }

    let promptText = rawPromptText

    // System prompt → prepend to user prompt (Codex has no native system prompt)
    const systemPrompt = query.systemPrompt ?? query.appendSystemPrompt
    if (systemPrompt) {
        promptText = `<system-instructions>\n${systemPrompt}\n</system-instructions>\n\n${promptText}`
    }

    // ── Session ID (for resume) + stdin prompt placeholder ──
    // Codex exec reads prompt text from stdin when positional prompt is omitted
    // or explicitly set to "-". We use "-" to keep argv free of prompt text.
    if (query.resumeSessionId) {
        execArgs.push("--", query.resumeSessionId, "-")
    } else {
        execArgs.push("--", "-")
    }

    // Merge query env
    if (query.env) {
        Object.assign(env, query.env)
    }

    // Note: disablePlanningTools is not applicable for Codex (no named tools / plan mode)

    return {
        command: "codex",
        args: [...rootArgs, ...execArgs],
        env,
        cwd: query.cwd,
        stdinData: promptText,
        structuredOutputPath,
        cleanup,
    }
}

interface CodexResolvedPrompt {
    promptText: string
    imagePaths: string[]
    imageCleanup: Array<{ path: string; type: "file" }>
}

async function resolveCodexPrompt(prompt: string | PromptPart[]): Promise<CodexResolvedPrompt> {
    if (typeof prompt === "string") {
        return { promptText: prompt, imagePaths: [], imageCleanup: [] }
    }

    const textParts: string[] = []
    const imagePaths: string[] = []
    const imageCleanup: Array<{ path: string; type: "file" }> = []

    for (const part of prompt) {
        if (part.type === "text") {
            textParts.push(part.text)
        } else if (part.type === "image") {
            if (part.source.kind === "path") {
                // Already on disk (e.g. ~/.openade/data/images/...) — reference directly
                imagePaths.push(part.source.path)
            } else if (part.source.kind === "base64") {
                const ext = part.source.mediaType.split("/")[1] || "png"
                const filename = `harness-img-${randomUUID()}.${ext}`
                const filepath = join(tmpdir(), filename)
                await writeFile(filepath, Buffer.from(part.source.data, "base64"))
                imagePaths.push(filepath)
                imageCleanup.push({ path: filepath, type: "file" })
            }
        }
    }

    return {
        promptText: textParts.join("\n"),
        imagePaths,
        imageCleanup,
    }
}
