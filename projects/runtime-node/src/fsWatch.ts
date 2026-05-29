import { randomUUID } from "node:crypto"
import fs from "node:fs"
import { RuntimeHandlerError, type RuntimeServer } from "../../runtime/src"
import { optionalString, requiredString as requiredStringParam, validateParams } from "./validation"

interface FsWatchState {
    watcher: fs.FSWatcher
    dir: string
    poller: ReturnType<typeof setInterval>
    snapshot: Map<string, number>
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {}
}

function requiredString(record: Record<string, unknown>, key: string): string {
    const value = record[key]
    if (typeof value !== "string" || value.length < 1) throw new Error(`${key} is required`)
    return value
}

function fsWatchRuntimeId(watchId: string): string {
    return `fs-watch:${watchId}`
}

function readDirectorySnapshot(dir: string): Map<string, number> {
    const snapshot = new Map<string, number>()
    for (const name of fs.readdirSync(dir)) {
        try {
            snapshot.set(name, fs.statSync(`${dir}/${name}`).mtimeMs)
        } catch {
            // File changed between readdir and stat; the next poll will see the stable state.
        }
    }
    return snapshot
}

function emitWatchEvent(server: RuntimeServer, watchId: string, dir: string, eventType: string, filename?: string): void {
    server.supervisor.touchByOwner("fs-watch", watchId)
    server.notify("fs/watch/event", {
        watchId,
        dir,
        eventType,
        filename,
        at: new Date().toISOString(),
    })
}

function stopWatch(server: RuntimeServer, fsWatches: Map<string, FsWatchState>, watchId: string): { ok: true; dir: string } | { ok: false; error: string } {
    const watch = fsWatches.get(watchId)
    if (!watch) return { ok: false, error: "watch not found" }
    watch.watcher.close()
    clearInterval(watch.poller)
    fsWatches.delete(watchId)
    server.notify("fs/watch/stopped", { watchId, dir: watch.dir, at: new Date().toISOString() })
    return { ok: true, dir: watch.dir }
}

export function registerRuntimeNodeFsWatchModule(server: RuntimeServer): () => void {
    const fsWatches = new Map<string, FsWatchState>()

    server.registerNotification("fs/watch/event")
    server.registerNotification("fs/watch/stopped")

    server.register(
        "fs/watch/start",
        (params) => {
            const record = asRecord(params)
            const dir = requiredString(record, "dir")
            if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error("dir must be an existing directory")

            const watchId = typeof record.watchId === "string" && record.watchId.length > 0 ? record.watchId : `watch-${randomUUID()}`
            if (fsWatches.has(watchId)) return { watchId, runtimeId: fsWatchRuntimeId(watchId), reused: true }

            const watcher = fs.watch(dir, { persistent: false }, (eventType: string, filename: string | Buffer | null) => {
                emitWatchEvent(server, watchId, dir, eventType, filename?.toString())
            })
            watcher.on("error", (error: Error) => {
                const runtime = server.supervisor.update(fsWatchRuntimeId(watchId), {
                    status: "failed",
                    error: error instanceof Error ? error.message : "File watcher failed",
                })
                server.notify("runtime/failed", runtime)
            })

            const state: FsWatchState = {
                watcher,
                dir,
                snapshot: readDirectorySnapshot(dir),
                poller: setInterval(() => {
                    const current = readDirectorySnapshot(dir)
                    for (const [filename, mtimeMs] of current) {
                        if (state.snapshot.get(filename) !== mtimeMs) {
                            emitWatchEvent(server, watchId, dir, "change", filename)
                        }
                    }
                    for (const filename of state.snapshot.keys()) {
                        if (!current.has(filename)) {
                            emitWatchEvent(server, watchId, dir, "rename", filename)
                        }
                    }
                    state.snapshot = current
                }, 250),
            }
            state.poller.unref?.()
            fsWatches.set(watchId, state)
            const runtime = server.supervisor.create({
                runtimeId: fsWatchRuntimeId(watchId),
                kind: "fsWatch",
                status: "running",
                scope: {
                    ownerType: "fs-watch",
                    ownerId: watchId,
                    rootPath: dir,
                },
                nativeId: watchId,
            })
            server.notify("runtime/created", runtime)
            return { watchId, runtimeId: runtime.runtimeId, reused: false }
        },
        {
            validateParams: validateParams(requiredStringParam("dir"), optionalString("watchId")),
        }
    )

    server.register("fs/watch/stop", (params) => {
        const watchId = requiredString(asRecord(params), "watchId")
        const result = stopWatch(server, fsWatches, watchId)
        if (!result.ok) return result
        const runtime = server.supervisor.update(fsWatchRuntimeId(watchId), { status: "stopped" })
        server.notify("runtime/stopped", runtime)
        return { ok: true }
    }, {
        validateParams: validateParams(requiredStringParam("watchId")),
    })

    server.register("fs/watch/list", () =>
        [...fsWatches.entries()].map(([watchId, watch]) => ({
            watchId,
            dir: watch.dir,
            runtimeId: fsWatchRuntimeId(watchId),
        }))
    )
    const unregisterStopHandler = server.registerRuntimeStopHandler((runtime) => {
        if (runtime.kind !== "fsWatch") return false
        const watchId = runtime.nativeId ?? runtime.scope.ownerId
        if (!watchId) return false
        const result = stopWatch(server, fsWatches, watchId)
        if (!result.ok) throw new RuntimeHandlerError("stop_failed", result.error, { runtimeId: runtime.runtimeId })
        return true
    })
    return () => {
        unregisterStopHandler()
        for (const watch of fsWatches.values()) {
            watch.watcher.close()
            clearInterval(watch.poller)
        }
        fsWatches.clear()
    }
}
