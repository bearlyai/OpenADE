/**
 * Orphan Harness Process Control
 *
 * After an unclean Electron main shutdown (crash/restart), detached harness
 * child processes survive and are reparented to PID 1. They keep running with
 * no one consuming their output — burning tokens and editing files — while the
 * owning task's action event is stuck `in_progress`.
 *
 * Harness processes are spawned with argv0 = `OpenADE <taskId>` (see the
 * `processLabel` passed from runtimeGateway), so they are discoverable by that
 * label. We only ever reap processes reparented to PID 1: a process still owned
 * by a live main (this instance or another) is left alone — the in-memory abort
 * path handles those.
 */

import { execFileSync } from "node:child_process"

const TASK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/
const ORPHAN_PPID = 1
const SIGKILL_GRACE_MS = 4000

export interface OrphanHarnessProcess {
    pid: number
    ppid: number
    taskId: string
    command: string
}

/**
 * Extract the OpenADE task id from a harness process command line.
 * Labels look like `OpenADE <taskId> ...` or `OpenADE HyperPlan <taskId> <stepId> ...`.
 */
export function taskIdFromHarnessCommand(command: string): string | null {
    const tokens = command.trim().split(/\s+/)
    const labelIndex = tokens.indexOf("OpenADE")
    if (labelIndex === -1) return null
    let candidate = tokens[labelIndex + 1]
    if (candidate === "HyperPlan") candidate = tokens[labelIndex + 2]
    if (candidate && TASK_ID_PATTERN.test(candidate)) return candidate
    return null
}

/**
 * Parse `ps -A -ww -o pid=,ppid=,command=` output into orphaned harness records.
 * Only rows reparented to PID 1 with a recognizable OpenADE harness label are returned.
 */
export function parseOrphanHarnessProcesses(stdout: string): OrphanHarnessProcess[] {
    const result: OrphanHarnessProcess[] = []
    for (const line of stdout.split("\n")) {
        const trimmed = line.trim()
        if (!trimmed) continue
        const match = /^(\d+)\s+(\d+)\s+(.*)$/.exec(trimmed)
        if (!match) continue
        const pid = Number(match[1])
        const ppid = Number(match[2])
        const command = match[3]
        if (!Number.isInteger(pid) || pid <= 0 || ppid !== ORPHAN_PPID) continue
        const taskId = taskIdFromHarnessCommand(command)
        if (!taskId) continue
        result.push({ pid, ppid, taskId, command })
    }
    return result
}

/** Snapshot all orphaned harness processes grouped by task id. */
export function listOrphanHarnessProcesses(): Map<string, number[]> {
    const byTask = new Map<string, number[]>()
    if (process.platform === "win32") return byTask // best-effort: no reaping on Windows yet

    let stdout: string
    try {
        stdout = execFileSync("ps", ["-A", "-ww", "-o", "pid=,ppid=,command="], {
            encoding: "utf8",
            maxBuffer: 16 * 1024 * 1024,
            stdio: ["ignore", "pipe", "ignore"],
        })
    } catch {
        return byTask
    }

    for (const proc of parseOrphanHarnessProcesses(stdout)) {
        const pids = byTask.get(proc.taskId) ?? []
        pids.push(proc.pid)
        byTask.set(proc.taskId, pids)
    }
    return byTask
}

function signalProcess(pid: number, signal: NodeJS.Signals): void {
    // Harness processes are spawned detached as their own group leader, so the
    // group (-pid) covers the CLI and any children it spawned.
    try {
        if (process.platform !== "win32") {
            process.kill(-pid, signal)
            return
        }
    } catch {
        // Fall through to direct-pid kill if the group is already gone.
    }
    try {
        process.kill(pid, signal)
    } catch {
        // Already exited.
    }
}

/** Terminate the given orphan pids (SIGTERM, then SIGKILL for survivors). */
export function killOrphanHarnessPids(pids: number[]): void {
    if (pids.length === 0) return
    for (const pid of pids) signalProcess(pid, "SIGTERM")

    const timer = setTimeout(() => {
        for (const pid of pids) {
            try {
                process.kill(pid, 0)
            } catch {
                continue // already gone
            }
            signalProcess(pid, "SIGKILL")
        }
    }, SIGKILL_GRACE_MS)
    timer.unref?.()
}

/**
 * Terminate any orphaned harness process group owned by a dead main for the
 * given task. Returns the pids that were signalled.
 */
export function terminateOrphanHarness(taskId: string): number[] {
    if (!TASK_ID_PATTERN.test(taskId)) return []
    const pids = listOrphanHarnessProcesses().get(taskId) ?? []
    killOrphanHarnessPids(pids)
    return pids
}
