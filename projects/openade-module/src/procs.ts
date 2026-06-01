import type {
    OpenADEProcsConfig,
    OpenADEProcsConfigError,
    OpenADEProcsCronDef,
    OpenADEProcsCronInput,
    OpenADEProcsProcessDef,
    OpenADEProcsProcessInput,
} from "./types"

export type OpenADEProcsParseResult = { config: OpenADEProcsConfig } | { error: OpenADEProcsConfigError }
export type OpenADEProcsParseEditableResult =
    | { processes: OpenADEProcsProcessInput[]; crons: OpenADEProcsCronInput[] }
    | { error: OpenADEProcsConfigError }

type TableName = "process" | "cron"
type TomlValue = string | boolean | string[]

function stripTomlComment(line: string): string {
    let quote: "'" | '"' | null = null
    let escaped = false
    for (let index = 0; index < line.length; index++) {
        const char = line[index]
        if (quote === '"') {
            if (escaped) {
                escaped = false
            } else if (char === "\\") {
                escaped = true
            } else if (char === '"') {
                quote = null
            }
            continue
        }
        if (quote === "'") {
            if (char === "'") quote = null
            continue
        }
        if (char === "'" || char === '"') {
            quote = char
            continue
        }
        if (char === "#") return line.slice(0, index)
    }
    return line
}

function parseTomlString(rawValue: string): string | null {
    const value = rawValue.trim()
    if (value.startsWith('"') && value.endsWith('"')) {
        try {
            const parsed = JSON.parse(value) as unknown
            return typeof parsed === "string" ? parsed : null
        } catch {
            return null
        }
    }
    if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1)
    return null
}

function splitTomlArray(value: string): string[] | null {
    const body = value.slice(1, -1).trim()
    if (!body) return []
    const items: string[] = []
    let current = ""
    let quote: "'" | '"' | null = null
    let escaped = false

    for (let index = 0; index < body.length; index++) {
        const char = body[index]
        if (quote === '"') {
            current += char
            if (escaped) {
                escaped = false
            } else if (char === "\\") {
                escaped = true
            } else if (char === '"') {
                quote = null
            }
            continue
        }
        if (quote === "'") {
            current += char
            if (char === "'") quote = null
            continue
        }
        if (char === "'" || char === '"') {
            quote = char
            current += char
            continue
        }
        if (char === ",") {
            const parsed = parseTomlString(current)
            if (parsed === null) return null
            items.push(parsed)
            current = ""
            continue
        }
        current += char
    }

    if (quote !== null) return null
    const parsed = parseTomlString(current)
    if (parsed === null) return null
    items.push(parsed)
    return items
}

function parseTomlValue(rawValue: string): TomlValue | null {
    const value = rawValue.trim()
    if (value === "true") return true
    if (value === "false") return false
    if (value.startsWith("[") && value.endsWith("]")) return splitTomlArray(value)
    return parseTomlString(value)
}

function parseTomlKeyValue(line: string): { key: string; value: TomlValue } | null {
    const equalsIndex = line.indexOf("=")
    if (equalsIndex < 1) return null
    const key = line.slice(0, equalsIndex).trim()
    const value = parseTomlValue(line.slice(equalsIndex + 1))
    if (!key || value === null) return null
    return { key, value }
}

function stringField(values: Map<string, TomlValue>, key: string): string | undefined {
    const value = values.get(key)
    return typeof value === "string" ? value : undefined
}

function stringArrayField(values: Map<string, TomlValue>, key: string): string[] | undefined {
    const value = values.get(key)
    return Array.isArray(value) ? value : undefined
}

function booleanField(values: Map<string, TomlValue>, key: string): boolean | undefined {
    const value = values.get(key)
    return typeof value === "boolean" ? value : undefined
}

function processDef(values: Map<string, TomlValue>, relativePath: string): OpenADEProcsProcessDef | OpenADEProcsConfigError {
    const name = stringField(values, "name")
    const command = stringField(values, "command")
    const type = stringField(values, "type") ?? "daemon"
    if (!name) return { relativePath, error: "process.name is required" }
    if (!command) return { relativePath, error: "process.command is required" }
    if (type !== "setup" && type !== "daemon" && type !== "task" && type !== "check") {
        return { relativePath, error: `process.type '${type}' is invalid` }
    }
    return {
        id: `${relativePath}::${name}`,
        name,
        command,
        workDir: stringField(values, "work_dir"),
        url: stringField(values, "url"),
        type,
    }
}

function cronDef(values: Map<string, TomlValue>, relativePath: string): OpenADEProcsCronDef | OpenADEProcsConfigError {
    const name = stringField(values, "name")
    const schedule = stringField(values, "schedule")
    const type = stringField(values, "type")
    const prompt = stringField(values, "prompt")
    const rawImages = values.get("images")
    const rawIsolation = stringField(values, "isolation")
    const rawReuseTask = values.get("reuse_task")
    if (!name) return { relativePath, error: "cron.name is required" }
    if (!schedule) return { relativePath, error: "cron.schedule is required" }
    if (!type) return { relativePath, error: "cron.type is required" }
    if (!prompt) return { relativePath, error: "cron.prompt is required" }
    if (type !== "plan" && type !== "do" && type !== "ask" && type !== "hyperplan") {
        return { relativePath, error: `cron.type '${type}' is invalid` }
    }
    if (rawImages !== undefined && !Array.isArray(rawImages)) return { relativePath, error: "cron.images must be an array of strings" }
    if (rawIsolation !== undefined && rawIsolation !== "head" && rawIsolation !== "worktree") {
        return { relativePath, error: `cron.isolation '${rawIsolation}' is invalid` }
    }
    if (rawReuseTask !== undefined && typeof rawReuseTask !== "boolean") return { relativePath, error: "cron.reuse_task must be a boolean" }
    return {
        id: `${relativePath}::${name}`,
        name,
        schedule,
        type,
        prompt,
        appendSystemPrompt: stringField(values, "append_system_prompt"),
        images: stringArrayField(values, "images"),
        isolation: rawIsolation,
        harness: stringField(values, "harness"),
        inTaskId: stringField(values, "in_task_id"),
        reuseTask: booleanField(values, "reuse_task") ?? true,
    }
}

export function parseProcsFile(content: string, relativePath: string): OpenADEProcsParseResult {
    const processes: OpenADEProcsProcessDef[] = []
    const crons: OpenADEProcsCronDef[] = []
    let current: { table: TableName; line: number; values: Map<string, TomlValue> } | null = null

    const finishCurrent = (): OpenADEProcsConfigError | null => {
        if (!current) return null
        if (current.table === "process") {
            const result = processDef(current.values, relativePath)
            if ("error" in result) return { ...result, line: current.line }
            processes.push(result)
            current = null
            return null
        }
        const result = cronDef(current.values, relativePath)
        if ("error" in result) return { ...result, line: current.line }
        crons.push(result)
        current = null
        return null
    }

    const lines = content.split(/\r?\n/)
    for (let index = 0; index < lines.length; index++) {
        const lineNumber = index + 1
        const trimmed = stripTomlComment(lines[index]).trim()
        if (!trimmed) continue

        if (trimmed === "[[process]]" || trimmed === "[[cron]]") {
            const error = finishCurrent()
            if (error) return { error }
            current = { table: trimmed === "[[process]]" ? "process" : "cron", line: lineNumber, values: new Map() }
            continue
        }

        if (trimmed.startsWith("[[") && !/^\[\[[A-Za-z0-9_.-]+\]\]$/.test(trimmed)) {
            return { error: { relativePath, error: `Invalid TOML table header at line ${lineNumber}`, line: lineNumber } }
        }

        if (trimmed.startsWith("[") && !/^\[[A-Za-z0-9_.-]+\]$/.test(trimmed) && !/^\[\[[A-Za-z0-9_.-]+\]\]$/.test(trimmed)) {
            return { error: { relativePath, error: `Invalid TOML table header at line ${lineNumber}`, line: lineNumber } }
        }

        if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
            const error = finishCurrent()
            if (error) return { error }
            current = null
            continue
        }

        if (!current) continue
        const pair = parseTomlKeyValue(trimmed)
        if (!pair) {
            return { error: { relativePath, error: `Invalid ${current.table} key/value at line ${lineNumber}`, line: lineNumber } }
        }
        current.values.set(pair.key, pair.value)
    }

    const error = finishCurrent()
    if (error) return { error }
    return { config: { relativePath, processes, crons } }
}

export function parseEditableProcsFile(content: string, relativePath: string): OpenADEProcsParseEditableResult {
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
            reuseTask: cron.reuseTask,
        })),
    }
}

function ensureNonEmpty(value: string, label: string): void {
    if (!value.trim()) throw new Error(`${label} is required`)
}

function ensureUniqueNames(items: Array<{ name: string }>, label: string): void {
    const seen = new Set<string>()
    for (const item of items) {
        const normalized = item.name.trim().toLowerCase()
        if (seen.has(normalized)) throw new Error(`Duplicate ${label} name: ${item.name}`)
        seen.add(normalized)
    }
}

function normalizeSchedule(schedule: string): string {
    return schedule.trim().replace(/\s+/g, " ")
}

function validateSchedule(schedule: string): void {
    if (normalizeSchedule(schedule).split(" ").length !== 5) {
        throw new Error(`Invalid cron schedule "${schedule}" (expected 5 fields)`)
    }
}

export function validateEditableEntries(processes: OpenADEProcsProcessInput[], crons: OpenADEProcsCronInput[]): void {
    for (const process of processes) {
        ensureNonEmpty(process.name, "Process name")
        ensureNonEmpty(process.command, `Process "${process.name}" command`)
    }

    for (const cron of crons) {
        ensureNonEmpty(cron.name, "Cron name")
        ensureNonEmpty(cron.prompt, `Cron "${cron.name}" prompt`)
        ensureNonEmpty(cron.schedule, `Cron "${cron.name}" schedule`)
        validateSchedule(cron.schedule)
    }

    ensureUniqueNames(processes, "process")
    ensureUniqueNames(crons, "cron")
}

function tomlString(value: string): string {
    return JSON.stringify(value)
}

function processToml(process: OpenADEProcsProcessInput): string[] {
    const lines = ["[[process]]", `name = ${tomlString(process.name.trim())}`, `type = ${tomlString(process.type)}`, `command = ${tomlString(process.command.trim())}`]
    if (process.workDir?.trim()) lines.push(`work_dir = ${tomlString(process.workDir.trim())}`)
    if (process.url?.trim()) lines.push(`url = ${tomlString(process.url.trim())}`)
    return lines
}

function cronToml(cron: OpenADEProcsCronInput): string[] {
    const lines = [
        "[[cron]]",
        `name = ${tomlString(cron.name.trim())}`,
        `schedule = ${tomlString(normalizeSchedule(cron.schedule))}`,
        `type = ${tomlString(cron.type)}`,
        `prompt = ${tomlString(cron.prompt.trim())}`,
    ]
    if (cron.appendSystemPrompt?.trim()) lines.push(`append_system_prompt = ${tomlString(cron.appendSystemPrompt.trim())}`)
    const images = cron.images?.map((image) => image.trim()).filter(Boolean)
    if (images && images.length > 0) lines.push(`images = [${images.map(tomlString).join(", ")}]`)
    if (cron.isolation) lines.push(`isolation = ${tomlString(cron.isolation)}`)
    if (cron.harness?.trim()) lines.push(`harness = ${tomlString(cron.harness.trim())}`)
    if (cron.inTaskId?.trim()) lines.push(`in_task_id = ${tomlString(cron.inTaskId.trim())}`)
    if (cron.reuseTask === false) lines.push("reuse_task = false")
    return lines
}

export function serializeProcsFile(input: {
    processes: OpenADEProcsProcessInput[]
    crons: OpenADEProcsCronInput[]
}): string {
    validateEditableEntries(input.processes, input.crons)

    const blocks = [...input.processes.map(processToml), ...input.crons.map(cronToml)]
    return blocks.length > 0 ? `${blocks.map((block) => block.join("\n")).join("\n\n")}\n` : ""
}
