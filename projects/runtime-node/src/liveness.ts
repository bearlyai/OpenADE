import { execFileSync } from "node:child_process"
import path from "node:path"
import type { RuntimeRecord } from "../../runtime-protocol/src"
import type { RuntimeLivenessProbe, RuntimeLivenessProbeResult } from "../../runtime/src"

function pidState(pid: number): RuntimeLivenessProbeResult {
    try {
        process.kill(pid, 0)
        return { state: "alive" }
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code === "ESRCH") return { state: "dead", reason: `Process ${pid} is not running` }
        if (code === "EPERM") return { state: "alive" }
        return { state: "unknown", reason: error instanceof Error ? error.message : `Unable to probe process ${pid}` }
    }
}

function processGroupState(pgid: number): RuntimeLivenessProbeResult {
    if (process.platform === "win32") return { state: "unknown", reason: "Process-group probing is unavailable on Windows" }
    try {
        process.kill(-pgid, 0)
        return { state: "alive" }
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code === "ESRCH") return { state: "dead", reason: `Process group ${pgid} is not running` }
        if (code === "EPERM") return { state: "alive" }
        return { state: "unknown", reason: error instanceof Error ? error.message : `Unable to probe process group ${pgid}` }
    }
}

function commandForPid(pid: number): string | undefined {
    if (process.platform === "win32") return undefined
    try {
        return execFileSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()
    } catch {
        return undefined
    }
}

function startedAtForPid(pid: number): string | undefined {
    if (process.platform === "win32") return undefined
    try {
        const raw = execFileSync("ps", ["-p", String(pid), "-o", "lstart="], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()
        const timestamp = Date.parse(raw)
        return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined
    } catch {
        return undefined
    }
}

function commandMatchesLabel(command: string, label: string): boolean {
    const first = label.split(/\s+/)[0]
    if (!first) return true
    return command.includes(label) || command.includes(first) || command.includes(path.basename(first))
}

function processStartedAtMatches(expected: string, actual: string): boolean {
    const expectedMs = Date.parse(expected)
    const actualMs = Date.parse(actual)
    if (!Number.isFinite(expectedMs) || !Number.isFinite(actualMs)) return true
    return Math.abs(expectedMs - actualMs) < 60_000
}

export function createRuntimeNodeLivenessProbe(): RuntimeLivenessProbe {
    return {
        probe(runtime: RuntimeRecord): RuntimeLivenessProbeResult {
            const pid = runtime.pid
            if (!Number.isInteger(pid) || !pid || pid <= 0) {
                return { state: "unknown", reason: "Runtime has no process id" }
            }

            const state = pidState(pid)
            if (state.state !== "alive") return state

            let verifiedByProcessGroup = false
            const pgid = runtime.pgid
            if (process.platform !== "win32" && Number.isInteger(pgid) && pgid && pgid > 0) {
                const groupState = processGroupState(pgid)
                if (groupState.state === "dead") return { state: "unknown", reason: `Process ${pid} is alive but expected process group ${pgid} is not` }
                if (groupState.state === "alive") verifiedByProcessGroup = true
            }

            let verifiedByLabel = false
            if (runtime.processLabel) {
                const command = commandForPid(pid)
                if (!command) {
                    return {
                        state: "unknown",
                        reason: `Process ${pid} is alive but command identity could not be verified`,
                    }
                }
                if (command && !commandMatchesLabel(command, runtime.processLabel)) {
                    return {
                        state: "unknown",
                        reason: `Process ${pid} is alive but does not match expected runtime label`,
                    }
                }
                verifiedByLabel = true
            }

            let verifiedByStartTime = false
            if (runtime.processStartedAt) {
                const actualStartedAt = startedAtForPid(pid)
                if (!actualStartedAt) {
                    return {
                        state: "unknown",
                        reason: `Process ${pid} is alive but start time could not be verified`,
                    }
                }
                if (actualStartedAt && !processStartedAtMatches(runtime.processStartedAt, actualStartedAt)) {
                    return {
                        state: "unknown",
                        reason: `Process ${pid} is alive but started at ${actualStartedAt}, not ${runtime.processStartedAt}`,
                    }
                }
                verifiedByStartTime = true
            }

            return {
                state: "alive",
                verified: verifiedByProcessGroup || verifiedByLabel || verifiedByStartTime,
                adoptable: verifiedByProcessGroup && (verifiedByLabel || verifiedByStartTime),
            }
        },
    }
}
