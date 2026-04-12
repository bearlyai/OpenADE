import { stringify as stringifyToml } from "smol-toml"
import { Cron } from "croner"
import type { CronInput, ProcessInput } from "./types"

function ensureNonEmpty(value: string, label: string): void {
    if (!value.trim()) {
        throw new Error(`${label} is required`)
    }
}

function ensureUniqueNames(items: Array<{ name: string }>, label: string): void {
    const seen = new Set<string>()
    for (const item of items) {
        const normalized = item.name.trim().toLowerCase()
        if (seen.has(normalized)) {
            throw new Error(`Duplicate ${label} name: ${item.name}`)
        }
        seen.add(normalized)
    }
}

function normalizeSchedule(schedule: string): string {
    return schedule.trim().replace(/\s+/g, " ")
}

function validateSchedule(schedule: string): void {
    const normalized = normalizeSchedule(schedule)
    const parts = normalized.split(" ")
    if (parts.length !== 5) throw new Error(`Invalid cron schedule "${schedule}" (expected 5 fields)`)
    try {
        new Cron(normalized)
    } catch {
        throw new Error(`Invalid cron schedule "${schedule}"`)
    }
}

export function validateEditableEntries(processes: ProcessInput[], crons: CronInput[]): void {
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

function toProcessToml(process: ProcessInput): Record<string, unknown> {
    const out: Record<string, unknown> = {
        name: process.name.trim(),
        type: process.type,
        command: process.command.trim(),
    }
    if (process.workDir?.trim()) out.work_dir = process.workDir.trim()
    if (process.url?.trim()) out.url = process.url.trim()
    return out
}

function toCronToml(cron: CronInput): Record<string, unknown> {
    const out: Record<string, unknown> = {
        name: cron.name.trim(),
        schedule: normalizeSchedule(cron.schedule),
        type: cron.type,
        prompt: cron.prompt.trim(),
    }

    if (cron.appendSystemPrompt?.trim()) out.append_system_prompt = cron.appendSystemPrompt.trim()
    if (cron.images && cron.images.length > 0) out.images = cron.images.filter((image) => image.trim().length > 0)
    if (cron.isolation) out.isolation = cron.isolation
    if (cron.harness?.trim()) out.harness = cron.harness.trim()
    if (cron.inTaskId?.trim()) out.in_task_id = cron.inTaskId.trim()
    return out
}

export function serializeProcsFile(input: {
    processes: ProcessInput[]
    crons: CronInput[]
}): string {
    validateEditableEntries(input.processes, input.crons)

    const out: Record<string, unknown> = {}
    if (input.processes.length > 0) {
        out.process = input.processes.map(toProcessToml)
    }
    if (input.crons.length > 0) {
        out.cron = input.crons.map(toCronToml)
    }

    return stringifyToml(out)
}
