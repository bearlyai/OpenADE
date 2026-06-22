import { makeAutoObservable, runInAction } from "mobx"
import { OPENADE_NOTIFICATION } from "../../../../openade-client/src"
import type { RuntimeNotification } from "../../../../runtime-protocol/src"
import type { QueuedTurn } from "../../types"

function notificationRecord(notification: RuntimeNotification): Record<string, unknown> | null {
    return typeof notification.params === "object" && notification.params !== null && !Array.isArray(notification.params)
        ? (notification.params as Record<string, unknown>)
        : null
}

function queuedTurnStatus(value: unknown): QueuedTurn["status"] | null {
    return value === "queued" || value === "running" || value === "completed" || value === "error" || value === "stopped" || value === "cancelled"
        ? value
        : null
}

function optionalString(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined
}

function optionalBoolean(value: unknown): boolean | undefined {
    return typeof value === "boolean" ? value : undefined
}

function optionalStringArray(value: unknown): string[] | undefined {
    return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined
}

function optionalThinking(value: unknown): QueuedTurn["thinking"] {
    return value === "low" || value === "med" || value === "high" || value === "max" ? value : undefined
}

function optionalHyperPlanStrategy(value: unknown): QueuedTurn["hyperplanStrategy"] {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
    const record = value as Record<string, unknown>
    if (typeof record.id !== "string" || typeof record.name !== "string" || typeof record.description !== "string") return undefined
    if (typeof record.terminalStepId !== "string" || !Array.isArray(record.steps)) return undefined
    const steps: NonNullable<QueuedTurn["hyperplanStrategy"]>["steps"] = []
    for (const step of record.steps) {
        if (typeof step !== "object" || step === null || Array.isArray(step)) return undefined
        const stepRecord = step as Record<string, unknown>
        const agent = typeof stepRecord.agent === "object" && stepRecord.agent !== null && !Array.isArray(stepRecord.agent) ? stepRecord.agent : null
        const agentRecord = agent as Record<string, unknown> | null
        if (typeof stepRecord.id !== "string") return undefined
        if (stepRecord.primitive !== "plan" && stepRecord.primitive !== "review" && stepRecord.primitive !== "reconcile" && stepRecord.primitive !== "revise")
            return undefined
        if (!agentRecord || typeof agentRecord.harnessId !== "string" || typeof agentRecord.modelId !== "string") return undefined
        if (!Array.isArray(stepRecord.inputs) || !stepRecord.inputs.every((input) => typeof input === "string")) return undefined
        steps.push({
            id: stepRecord.id,
            primitive: stepRecord.primitive,
            agent: { harnessId: agentRecord.harnessId, modelId: agentRecord.modelId },
            inputs: stepRecord.inputs,
            resumeStepId: optionalString(stepRecord.resumeStepId),
        })
    }
    return {
        id: record.id,
        name: record.name,
        description: record.description,
        terminalStepId: record.terminalStepId,
        steps,
    }
}

function queuedTurn(value: unknown): QueuedTurn | null {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null
    const record = value as Record<string, unknown>
    if (typeof record.id !== "string") return null
    if (record.type !== "do" && record.type !== "ask" && record.type !== "hyperplan") return null
    if (typeof record.input !== "string") return null
    const status = queuedTurnStatus(record.status)
    if (!status) return null
    if (typeof record.createdAt !== "string") return null
    if (typeof record.updatedAt !== "string") return null
    return {
        id: record.id,
        clientRequestId: optionalString(record.clientRequestId),
        type: record.type,
        input: record.input,
        status,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        eventId: optionalString(record.eventId),
        appendSystemPrompt: optionalString(record.appendSystemPrompt),
        enabledMcpServerIds: optionalStringArray(record.enabledMcpServerIds),
        harnessId: optionalString(record.harnessId),
        modelId: optionalString(record.modelId),
        label: optionalString(record.label),
        includeComments: optionalBoolean(record.includeComments),
        images: Array.isArray(record.images) ? record.images : undefined,
        hyperplanStrategy: optionalHyperPlanStrategy(record.hyperplanStrategy),
        thinking: optionalThinking(record.thinking),
        fastMode: optionalBoolean(record.fastMode),
    }
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
        if (notification.method !== OPENADE_NOTIFICATION.queuedTurnUpdated) return null

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
