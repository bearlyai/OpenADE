import fs from "node:fs"
import path from "node:path"
import type { RuntimeRecord } from "../../runtime-protocol/src"
import type { RuntimeCheckpointStore } from "../../runtime/src"

function parseRecords(raw: string): RuntimeRecord[] {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((record): record is RuntimeRecord => {
        if (typeof record !== "object" || record === null) return false
        const candidate = record as Partial<RuntimeRecord>
        return typeof candidate.runtimeId === "string" && typeof candidate.kind === "string" && typeof candidate.status === "string"
    })
}

export function createRuntimeNodeCheckpointStore(filePath: string): RuntimeCheckpointStore {
    return {
        load() {
            try {
                if (!fs.existsSync(filePath)) return []
                return parseRecords(fs.readFileSync(filePath, "utf8"))
            } catch {
                return []
            }
        },
        save(records) {
            try {
                fs.mkdirSync(path.dirname(filePath), { recursive: true })
                fs.writeFileSync(filePath, JSON.stringify(records, null, 2))
            } catch {
                // Checkpoints are a recovery aid; runtime memory stays authoritative.
            }
        },
    }
}
