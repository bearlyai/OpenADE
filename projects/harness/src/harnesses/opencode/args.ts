import { tmpdir } from "node:os"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import { writeFile } from "node:fs/promises"

import type { HarnessQuery, PromptPart } from "../../types.js"

export interface OpencodeHarnessConfig {
    binaryPath?: string
    tempDir?: string
}

export interface OpencodeArgBuildResult {
    command: string
    args: string[]
    env: Record<string, string>
    cwd?: string
    cleanup: Array<{ path: string; type: "file" | "dir" }>
}

const THINKING_VARIANT_MAP: Record<string, string> = {
    low: "low",
    med: "medium",
    high: "high",
    max: "max",
}

/**
 * Builds CLI arguments for the `opencode` binary from a HarnessQuery.
 */
export async function buildOpencodeArgs(query: HarnessQuery, config: OpencodeHarnessConfig): Promise<OpencodeArgBuildResult> {
    const args: string[] = ["run", "--format", "json"]
    const env: Record<string, string> = { ...(query.env ?? {}) }
    const cleanup: Array<{ path: string; type: "file" | "dir" }> = []

    env.OPENCODE_DISABLE_AUTOUPDATE ??= "true"

    if (query.mode === "yolo") {
        args.push("--dangerously-skip-permissions")
    } else if (query.mode === "read-only") {
        env.OPENCODE_CONFIG_CONTENT = buildReadOnlyConfigContent(query.additionalDirectories, env.OPENCODE_CONFIG_CONTENT)
    }

    if (query.cwd) {
        args.push("--dir", query.cwd)
    }

    if (query.model) {
        args.push("-m", query.model)
    }

    if (query.thinking) {
        const variant = THINKING_VARIANT_MAP[query.thinking]
        if (variant) {
            args.push("--variant", variant)
        }
    }

    if (query.fastMode) {
        console.warn("[opencode-harness] fastMode is not supported by opencode. Ignoring.")
    }

    if (query.resumeSessionId) {
        args.push("--session", query.resumeSessionId)
        if (query.forkSession) {
            args.push("--fork")
        }
    } else if (query.forkSession) {
        console.warn("[opencode-harness] forkSession requires a resumeSessionId. Ignoring.")
    }

    if (query.additionalDirectories && query.additionalDirectories.length > 0) {
        console.warn("[opencode-harness] additionalDirectories are only reflected in read-only permission config; opencode has no add-dir flag.")
    }

    const { promptText: rawPromptText, filePaths, fileCleanup } = await resolveOpencodePrompt(query.prompt, config)
    cleanup.push(...fileCleanup)

    for (const filePath of filePaths) {
        args.push("-f", filePath)
    }

    let promptText = rawPromptText
    const systemPrompt = query.systemPrompt ?? query.appendSystemPrompt
    if (systemPrompt) {
        promptText = `<system-instructions>\n${systemPrompt}\n</system-instructions>\n\n${promptText}`
    }

    if (query.outputSchema) {
        promptText = [
            promptText,
            "Return only valid JSON matching this JSON Schema. Do not wrap the JSON in Markdown fences.",
            JSON.stringify(query.outputSchema),
        ].join("\n\n")
    }

    args.push("--", promptText)

    return {
        command: "opencode",
        args,
        env,
        cwd: query.cwd,
        cleanup,
    }
}

interface OpencodeResolvedPrompt {
    promptText: string
    filePaths: string[]
    fileCleanup: Array<{ path: string; type: "file" }>
}

async function resolveOpencodePrompt(prompt: string | PromptPart[], config: OpencodeHarnessConfig): Promise<OpencodeResolvedPrompt> {
    if (typeof prompt === "string") {
        return { promptText: prompt, filePaths: [], fileCleanup: [] }
    }

    const textParts: string[] = []
    const filePaths: string[] = []
    const fileCleanup: Array<{ path: string; type: "file" }> = []

    for (const part of prompt) {
        if (part.type === "text") {
            textParts.push(part.text)
        } else if (part.type === "image") {
            if (part.source.kind === "path") {
                filePaths.push(part.source.path)
            } else if (part.source.kind === "base64") {
                const ext = part.source.mediaType.split("/")[1] || "png"
                const filename = `harness-img-${randomUUID()}.${ext}`
                const filepath = join(config.tempDir ?? tmpdir(), filename)
                await writeFile(filepath, Buffer.from(part.source.data, "base64"))
                filePaths.push(filepath)
                fileCleanup.push({ path: filepath, type: "file" })
            }
        }
    }

    return {
        promptText: textParts.join("\n"),
        filePaths,
        fileCleanup,
    }
}

function buildReadOnlyConfigContent(additionalDirectories: string[] | undefined, existingConfigContent: string | undefined): string {
    const base = parseConfigContent(existingConfigContent)
    const permission = isRecord(base.permission) ? base.permission : {}
    const externalDirectory = buildExternalDirectoryRules(additionalDirectories)

    return JSON.stringify({
        ...base,
        permission: {
            ...permission,
            edit: "deny",
            bash: "deny",
            ...(externalDirectory ? { external_directory: externalDirectory } : {}),
        },
    })
}

function parseConfigContent(raw: string | undefined): Record<string, unknown> {
    if (!raw) return {}
    try {
        const parsed = JSON.parse(raw)
        return isRecord(parsed) ? parsed : {}
    } catch {
        return {}
    }
}

function buildExternalDirectoryRules(additionalDirectories: string[] | undefined): Record<string, "allow"> | undefined {
    if (!additionalDirectories || additionalDirectories.length === 0) return undefined

    const rules: Record<string, "allow"> = {}
    for (const dir of additionalDirectories) {
        const trimmed = dir.replace(/\/+$/, "")
        if (!trimmed) continue
        rules[trimmed] = "allow"
        rules[`${trimmed}/**`] = "allow"
    }

    return Object.keys(rules).length > 0 ? rules : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value)
}
