import { createHash } from "node:crypto"
import type { OpenADETaskTerminalOutputChunk } from "./types"

export function openADETaskTerminalId(repoId: string, taskId: string): string {
    const hash = createHash("sha256").update(repoId).update("\0").update(taskId).digest("hex").slice(0, 24)
    return `openade-task-terminal-${hash}`
}

export function assertOpenADETaskTerminalId(params: { repoId: string; taskId: string; terminalId: string }): void {
    if (params.terminalId !== openADETaskTerminalId(params.repoId, params.taskId)) throw new Error("terminalId is invalid")
}

export function encodeOpenADETaskTerminalInput(data: string): string {
    return Buffer.from(data, "utf8").toString("base64")
}

export function decodeOpenADETaskTerminalOutputData(data: string): string {
    if (!data || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) return data
    try {
        return Buffer.from(data, "base64").toString("utf8")
    } catch {
        return data
    }
}

export function decodeOpenADETaskTerminalOutputChunk(chunk: { data: string; timestamp?: number }): OpenADETaskTerminalOutputChunk {
    return {
        data: decodeOpenADETaskTerminalOutputData(chunk.data),
        timestamp: chunk.timestamp,
    }
}

export function openADETaskTerminalOutputChunkFromUnknown(value: unknown): OpenADETaskTerminalOutputChunk | null {
    if (typeof value === "string") return { data: value }
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null
    const record = Object.fromEntries(Object.entries(value))
    if (typeof record.data !== "string") return null
    const timestamp = typeof record.timestamp === "number" ? record.timestamp : undefined
    return decodeOpenADETaskTerminalOutputChunk({ data: record.data, timestamp })
}
