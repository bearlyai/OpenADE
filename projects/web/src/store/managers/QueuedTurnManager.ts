import { makeAutoObservable, runInAction } from "mobx"
import type { RuntimeNotification } from "../../../../runtime-protocol/src"
import type { QueuedTurn } from "../../types"

function notificationRecord(notification: RuntimeNotification): Record<string, unknown> | null {
    return typeof notification.params === "object" && notification.params !== null && !Array.isArray(notification.params)
        ? (notification.params as Record<string, unknown>)
        : null
}

function queuedTurn(value: unknown): QueuedTurn | null {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null
    const record = value as Record<string, unknown>
    if (typeof record.id !== "string") return null
    if (record.type !== "do" && record.type !== "ask") return null
    if (typeof record.input !== "string") return null
    if (typeof record.status !== "string") return null
    if (typeof record.createdAt !== "string") return null
    if (typeof record.updatedAt !== "string") return null
    return record as unknown as QueuedTurn
}

export class QueuedTurnManager {
    version = 0
    readonly turnsByTaskId = new Map<string, Map<string, { source: "accepted" | "server"; turn: QueuedTurn }>>()

    constructor() {
        makeAutoObservable(this, {
            turnsByTaskId: false,
        })
    }

    acceptQueuedTurn(taskId: string, turn: QueuedTurn): void {
        this.upsert(taskId, turn, "accepted")
    }

    applyNotification(notification: RuntimeNotification): string | null {
        if (notification.method !== "openade/queuedTurn/updated") return null

        const params = notificationRecord(notification)
        if (!params || typeof params.taskId !== "string") return null

        const turn = queuedTurn(params.turn)
        if (!turn) return null

        this.upsert(params.taskId, turn, "server")
        return params.taskId
    }

    queuedForTask(taskId: string, storedTurns: QueuedTurn[]): QueuedTurn[] {
        void this.version
        const liveTurns = this.turnsByTaskId.get(taskId)
        if (!liveTurns) return storedTurns.filter((turn) => turn.status === "queued")

        const seen = new Set<string>()
        const queued: QueuedTurn[] = []
        for (const storedTurn of storedTurns) {
            const liveTurn = liveTurns.get(storedTurn.id)
            const turn = liveTurn?.source === "server" ? liveTurn.turn : storedTurn
            seen.add(storedTurn.id)
            if (turn.status === "queued") queued.push(turn)
        }

        for (const { turn } of liveTurns.values()) {
            if (seen.has(turn.id)) continue
            if (turn.status === "queued") queued.push(turn)
        }

        return queued
    }

    reconcileTaskWithStorage(taskId: string, storedTurns: QueuedTurn[]): void {
        const liveTurns = this.turnsByTaskId.get(taskId)
        if (!liveTurns) return

        const storedById = new Map(storedTurns.map((turn) => [turn.id, turn]))
        runInAction(() => {
            let changed = false
            for (const [turnId, entry] of liveTurns) {
                const storedTurn = storedById.get(turnId)
                if (!storedTurn) continue
                if (entry.source === "accepted" || storedTurn.status === entry.turn.status) {
                    liveTurns.delete(turnId)
                    changed = true
                }
            }
            if (liveTurns.size === 0) {
                this.turnsByTaskId.delete(taskId)
                changed = true
            }
            if (changed) this.version++
        })
    }

    suppressQueuedTurn(taskId: string, queuedTurnId: string, storedTurns: QueuedTurn[]): void {
        const existing = this.turnsByTaskId.get(taskId)?.get(queuedTurnId)?.turn ?? storedTurns.find((turn) => turn.id === queuedTurnId)
        if (!existing) return
        this.upsert(taskId, { ...existing, status: "cancelled", updatedAt: new Date().toISOString() }, "accepted")
    }

    clear(): void {
        this.turnsByTaskId.clear()
        this.version++
    }

    private upsert(taskId: string, turn: QueuedTurn, source: "accepted" | "server"): void {
        let turns = this.turnsByTaskId.get(taskId)
        if (!turns) {
            turns = new Map()
            this.turnsByTaskId.set(taskId, turns)
        }
        turns.set(turn.id, { source, turn })
        this.version++
    }
}
