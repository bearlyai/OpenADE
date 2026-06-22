import type { AnnotationSide } from "@pierre/diffs"
import type { OpenADEHyperPlanStrategy, OpenADETask, OpenADETaskPreview } from "../../../openade-module/src"
import type { HarnessStreamEvent, HarnessId } from "../electronAPI/harnessEventTypes"
import type { HyperPlanSubExecution } from "../hyperplan/types"
import type {
    ActionEvent,
    ActionEventSource,
    CodeEvent,
    Comment,
    CommentSource,
    ImageAttachment,
    IsolationStrategy,
    QueuedTurn,
    SnapshotChangedFile,
    Task,
    TaskDeviceEnvironment,
    User,
} from "../types"

const zeroTime = new Date(0).toISOString()

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown, fallback = ""): string {
    return typeof value === "string" ? value : fallback
}

function optionalString(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined
}

function numberValue(value: unknown, fallback = 0): number {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function optionalNumber(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function booleanValue(value: unknown): boolean | undefined {
    return typeof value === "boolean" ? value : undefined
}

function stringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function toHyperPlanPrimitive(value: unknown): OpenADEHyperPlanStrategy["steps"][number]["primitive"] | null {
    if (value === "plan" || value === "review" || value === "reconcile" || value === "revise") return value
    return null
}

function toHyperPlanStrategy(value: unknown): OpenADEHyperPlanStrategy | undefined {
    if (!isRecord(value) || !Array.isArray(value.steps)) return undefined
    const id = stringValue(value.id)
    const name = stringValue(value.name)
    const description = stringValue(value.description)
    const terminalStepId = stringValue(value.terminalStepId)
    if (!id || !name || !description || !terminalStepId) return undefined
    const steps: OpenADEHyperPlanStrategy["steps"] = []
    for (const item of value.steps) {
        if (!isRecord(item) || !isRecord(item.agent)) return undefined
        const primitive = toHyperPlanPrimitive(item.primitive)
        const stepId = stringValue(item.id)
        const harnessId = stringValue(item.agent.harnessId)
        const modelId = stringValue(item.agent.modelId)
        if (!primitive || !stepId || !harnessId || !modelId) return undefined
        const resumeStepId = optionalString(item.resumeStepId)
        steps.push({
            id: stepId,
            primitive,
            agent: { harnessId, modelId },
            inputs: stringArray(item.inputs),
            ...(resumeStepId ? { resumeStepId } : {}),
        })
    }
    if (steps.length === 0) return undefined
    return { id, name, description, steps, terminalStepId }
}

function stringRecord(value: unknown): Record<string, string> {
    if (!isRecord(value)) return {}
    const result: Record<string, string> = {}
    for (const [key, nested] of Object.entries(value)) {
        if (typeof nested === "string") result[key] = nested
    }
    return result
}

function isHarnessId(value: unknown): value is HarnessId {
    return value === "claude-code" || value === "codex"
}

function toHarnessStreamEvent(value: unknown): HarnessStreamEvent | null {
    if (!isRecord(value)) return null
    if (typeof value.id !== "string" || typeof value.type !== "string" || typeof value.executionId !== "string") return null
    if (value.direction !== "execution" && value.direction !== "command") return null

    // Boundary conversion: provider-specific harness payloads are validated by the harness/rendering layer.
    return value as unknown as HarnessStreamEvent
}

function toHarnessStreamEvents(value: unknown): HarnessStreamEvent[] {
    if (!Array.isArray(value)) return []
    return value.map(toHarnessStreamEvent).filter((event): event is HarnessStreamEvent => event !== null)
}

function toUser(value: unknown, fallback: User): User {
    if (!isRecord(value)) return fallback
    const id = stringValue(value.id)
    const email = stringValue(value.email)
    return id && email ? { id, email } : fallback
}

function toIsolationStrategy(value: unknown): IsolationStrategy {
    if (!isRecord(value)) return { type: "head" }
    if (value.type === "worktree") {
        return { type: "worktree", sourceBranch: stringValue(value.sourceBranch, "main") }
    }
    return { type: "head" }
}

function toDeviceEnvironment(value: unknown): TaskDeviceEnvironment | null {
    if (!isRecord(value)) return null
    const id = stringValue(value.id)
    const deviceId = stringValue(value.deviceId)
    if (!id || !deviceId) return null
    return {
        id,
        deviceId,
        worktreeDir: optionalString(value.worktreeDir),
        setupComplete: value.setupComplete === true,
        mergeBaseCommit: optionalString(value.mergeBaseCommit),
        createdAt: stringValue(value.createdAt, zeroTime),
        lastUsedAt: stringValue(value.lastUsedAt, stringValue(value.createdAt, zeroTime)),
    }
}

function toDeviceEnvironments(value: unknown): TaskDeviceEnvironment[] {
    if (!Array.isArray(value)) return []
    return value.map(toDeviceEnvironment).filter((env): env is TaskDeviceEnvironment => env !== null)
}

function toQueuedTurn(value: unknown): QueuedTurn | null {
    if (!isRecord(value)) return null
    if (value.type !== "do" && value.type !== "ask" && value.type !== "hyperplan") return null
    const id = stringValue(value.id)
    const input = stringValue(value.input)
    const status = stringValue(value.status)
    if (!id || !input) return null
    if (status !== "queued" && status !== "running" && status !== "completed" && status !== "error" && status !== "stopped" && status !== "cancelled") {
        return null
    }
    return {
        id,
        clientRequestId: optionalString(value.clientRequestId),
        type: value.type,
        input,
        status,
        createdAt: stringValue(value.createdAt, zeroTime),
        updatedAt: stringValue(value.updatedAt, stringValue(value.createdAt, zeroTime)),
        eventId: optionalString(value.eventId),
        appendSystemPrompt: optionalString(value.appendSystemPrompt),
        enabledMcpServerIds: stringArray(value.enabledMcpServerIds),
        harnessId: optionalString(value.harnessId),
        modelId: optionalString(value.modelId),
        label: optionalString(value.label),
        includeComments: booleanValue(value.includeComments),
        images: Array.isArray(value.images) ? value.images : undefined,
        hyperplanStrategy: toHyperPlanStrategy(value.hyperplanStrategy),
        thinking: value.thinking === "low" || value.thinking === "med" || value.thinking === "high" || value.thinking === "max" ? value.thinking : undefined,
        fastMode: booleanValue(value.fastMode),
    }
}

function toQueuedTurns(value: unknown): QueuedTurn[] | undefined {
    if (!Array.isArray(value)) return undefined
    const turns = value.map(toQueuedTurn).filter((turn): turn is QueuedTurn => turn !== null)
    return turns.length > 0 ? turns : undefined
}

function toImageAttachment(value: unknown): ImageAttachment | null {
    if (!isRecord(value)) return null
    const id = stringValue(value.id)
    const mediaType = stringValue(value.mediaType)
    const ext = stringValue(value.ext)
    if (!id || !mediaType || !ext) return null
    return {
        id,
        mediaType,
        ext,
        originalWidth: numberValue(value.originalWidth),
        originalHeight: numberValue(value.originalHeight),
        resizedWidth: numberValue(value.resizedWidth),
        resizedHeight: numberValue(value.resizedHeight),
    }
}

function toImageAttachments(value: unknown): ImageAttachment[] | undefined {
    if (!Array.isArray(value)) return undefined
    const images = value.map(toImageAttachment).filter((image): image is ImageAttachment => image !== null)
    return images.length > 0 ? images : undefined
}

function toActionSource(value: unknown): ActionEventSource | null {
    if (!isRecord(value)) return null
    const userLabel = stringValue(value.userLabel, "Task")
    switch (value.type) {
        case "plan":
        case "do":
        case "ask":
            return value.type === "ask" && value.origin === "review_follow_up"
                ? { type: "ask", userLabel, origin: "review_follow_up" }
                : { type: value.type, userLabel }
        case "revise":
            return { type: "revise", userLabel, parentEventId: stringValue(value.parentEventId) }
        case "run_plan":
            return { type: "run_plan", userLabel, planEventId: stringValue(value.planEventId) }
        case "hyperplan":
            return { type: "hyperplan", userLabel, strategyId: stringValue(value.strategyId, "standard") }
        case "review":
            if (value.reviewType !== "plan" && value.reviewType !== "work") return null
            return {
                type: "review",
                userLabel,
                reviewType: value.reviewType,
                userInstructions: optionalString(value.userInstructions),
            }
        default:
            return null
    }
}

function toHyperPlanSubExecution(value: unknown): HyperPlanSubExecution | null {
    if (!isRecord(value)) return null
    const harnessId = isHarnessId(value.harnessId) ? value.harnessId : null
    if (!harnessId) return null
    if (value.primitive !== "plan" && value.primitive !== "review" && value.primitive !== "reconcile" && value.primitive !== "revise") return null
    if (value.status !== "in_progress" && value.status !== "completed" && value.status !== "error" && value.status !== "stopped") return null
    return {
        stepId: stringValue(value.stepId),
        primitive: value.primitive,
        harnessId,
        modelId: stringValue(value.modelId),
        fastMode: booleanValue(value.fastMode),
        executionId: stringValue(value.executionId),
        sessionId: optionalString(value.sessionId),
        parentSessionId: optionalString(value.parentSessionId),
        status: value.status,
        events: toHarnessStreamEvents(value.events),
        omittedEventCount: optionalNumber(value.omittedEventCount),
        resultText: optionalString(value.resultText),
        error: optionalString(value.error),
        reconcileLabel: optionalString(value.reconcileLabel),
    }
}

function toHyperPlanSubExecutions(value: unknown): HyperPlanSubExecution[] | undefined {
    if (!Array.isArray(value)) return undefined
    const executions = value.map(toHyperPlanSubExecution).filter((execution): execution is HyperPlanSubExecution => execution !== null)
    return executions.length > 0 ? executions : undefined
}

type CodeEventStatus = CodeEvent["status"]

interface CodeEventBase {
    id: string
    status: CodeEventStatus
    createdAt: string
    completedAt?: string
    userInput: string
}

function toCodeEventBase(value: Record<string, unknown>): CodeEventBase | null {
    const id = stringValue(value.id)
    if (!id) return null
    const status = value.status
    if (status !== "in_progress" && status !== "completed" && status !== "error" && status !== "stopped") return null
    return {
        id,
        status,
        createdAt: stringValue(value.createdAt, zeroTime),
        completedAt: optionalString(value.completedAt),
        userInput: stringValue(value.userInput),
    }
}

function toCodeEvent(value: unknown): CodeEvent | null {
    if (!isRecord(value)) return null
    const base = toCodeEventBase(value)
    if (!base) return null

    switch (value.type) {
        case "action": {
            const execution = isRecord(value.execution) ? value.execution : null
            const source = toActionSource(value.source)
            if (!execution || !source) return null
            const harnessId = isHarnessId(execution.harnessId) ? execution.harnessId : "claude-code"
            const result = isRecord(value.result) && typeof value.result.success === "boolean" ? { success: value.result.success } : undefined
            const action: ActionEvent = {
                ...base,
                type: "action",
                execution: {
                    harnessId,
                    executionId: stringValue(execution.executionId),
                    sessionId: optionalString(execution.sessionId),
                    parentSessionId: optionalString(execution.parentSessionId),
                    modelId: optionalString(execution.modelId),
                    fastMode: booleanValue(execution.fastMode),
                    events: toHarnessStreamEvents(execution.events),
                    omittedEventCount: optionalNumber(execution.omittedEventCount),
                    gitRefsBefore: isRecord(execution.gitRefsBefore)
                        ? { sha: stringValue(execution.gitRefsBefore.sha), branch: optionalString(execution.gitRefsBefore.branch) }
                        : undefined,
                    gitRefsAfter: isRecord(execution.gitRefsAfter)
                        ? { sha: stringValue(execution.gitRefsAfter.sha), branch: optionalString(execution.gitRefsAfter.branch) }
                        : undefined,
                },
                source,
                includesCommentIds: stringArray(value.includesCommentIds),
                images: toImageAttachments(value.images),
                result,
                hyperplanSubExecutions: toHyperPlanSubExecutions(value.hyperplanSubExecutions),
            }
            return action
        }
        case "setup_environment":
            return {
                ...base,
                type: "setup_environment",
                worktreeId: stringValue(value.worktreeId),
                deviceId: stringValue(value.deviceId),
                workingDir: stringValue(value.workingDir),
                setupOutput: optionalString(value.setupOutput),
            }
        case "snapshot":
            return {
                ...base,
                type: "snapshot",
                actionEventId: stringValue(value.actionEventId),
                referenceBranch: stringValue(value.referenceBranch),
                mergeBaseCommit: stringValue(value.mergeBaseCommit),
                fullPatch: stringValue(value.fullPatch),
                patchFileId: optionalString(value.patchFileId),
                stats: isRecord(value.stats)
                    ? {
                          filesChanged: numberValue(value.stats.filesChanged),
                          insertions: numberValue(value.stats.insertions),
                          deletions: numberValue(value.stats.deletions),
                      }
                    : { filesChanged: 0, insertions: 0, deletions: 0 },
                files: toSnapshotChangedFiles(value.files),
            }
        default:
            return null
    }
}

function toSnapshotChangedFile(value: unknown): SnapshotChangedFile | null {
    if (!isRecord(value)) return null
    if (value.status !== "added" && value.status !== "deleted" && value.status !== "modified" && value.status !== "renamed") return null
    const path = stringValue(value.path)
    if (!path) return null
    return {
        path,
        status: value.status,
        oldPath: optionalString(value.oldPath),
    }
}

function toSnapshotChangedFiles(value: unknown): SnapshotChangedFile[] | undefined {
    if (!Array.isArray(value)) return undefined
    const files = value.map(toSnapshotChangedFile).filter((file): file is SnapshotChangedFile => file !== null)
    return files.length > 0 ? files : undefined
}

function toCodeEvents(value: unknown): CodeEvent[] {
    if (!Array.isArray(value)) return []
    return value.map(toCodeEvent).filter((event): event is CodeEvent => event !== null)
}

function toAnnotationSide(value: unknown): AnnotationSide | null {
    return value === "additions" || value === "deletions" ? value : null
}

function toCommentSource(value: unknown): CommentSource | null {
    if (!isRecord(value)) return null
    const lineStart = numberValue(value.lineStart)
    const lineEnd = numberValue(value.lineEnd)
    switch (value.type) {
        case "plan":
            return { type: "plan", eventId: stringValue(value.eventId), lineStart, lineEnd }
        case "file":
            return { type: "file", filePath: stringValue(value.filePath), lineStart, lineEnd }
        case "diff": {
            const side = toAnnotationSide(value.side)
            return side ? { type: "diff", eventId: stringValue(value.eventId), filePath: stringValue(value.filePath), side, lineStart, lineEnd } : null
        }
        case "patch": {
            const side = toAnnotationSide(value.side)
            return side
                ? { type: "patch", snapshotEventId: stringValue(value.snapshotEventId), filePath: stringValue(value.filePath), side, lineStart, lineEnd }
                : null
        }
        case "llm_output":
            return { type: "llm_output", eventId: stringValue(value.eventId), lineStart, lineEnd }
        case "edit_diff": {
            const side = toAnnotationSide(value.side)
            return side
                ? {
                      type: "edit_diff",
                      actionEventId: stringValue(value.actionEventId),
                      toolUseId: stringValue(value.toolUseId),
                      filePath: stringValue(value.filePath),
                      side,
                      lineStart,
                      lineEnd,
                  }
                : null
        }
        case "write_diff":
            return {
                type: "write_diff",
                actionEventId: stringValue(value.actionEventId),
                toolUseId: stringValue(value.toolUseId),
                filePath: stringValue(value.filePath),
                lineStart,
                lineEnd,
            }
        case "bash_output":
            return { type: "bash_output", actionEventId: stringValue(value.actionEventId), toolUseId: stringValue(value.toolUseId), lineStart, lineEnd }
        case "assistant_text":
            return {
                type: "assistant_text",
                actionEventId: stringValue(value.actionEventId),
                messageIndex: numberValue(value.messageIndex),
                lineStart,
                lineEnd,
            }
        default:
            return null
    }
}

function toComment(value: unknown, fallbackUser: User): Comment | null {
    if (!isRecord(value)) return null
    const id = stringValue(value.id)
    const source = toCommentSource(value.source)
    if (!id || !source || !isRecord(value.selectedText)) return null
    return {
        id,
        content: stringValue(value.content),
        source,
        selectedText: {
            text: stringValue(value.selectedText.text),
            linesBefore: stringValue(value.selectedText.linesBefore),
            linesAfter: stringValue(value.selectedText.linesAfter),
        },
        author: toUser(value.author, fallbackUser),
        createdAt: stringValue(value.createdAt, zeroTime),
        updatedAt: optionalString(value.updatedAt),
    }
}

function toComments(value: unknown, fallbackUser: User): Comment[] {
    if (!Array.isArray(value)) return []
    return value.map((comment) => toComment(comment, fallbackUser)).filter((comment): comment is Comment => comment !== null)
}

function previewCreatedAt(preview: OpenADETaskPreview | undefined): string {
    return preview?.createdAt ?? zeroTime
}

export function taskFromRuntimeProduct({
    task,
    preview,
    currentUser,
}: {
    task: OpenADETask
    preview?: OpenADETaskPreview
    currentUser: User
}): Task {
    const effectivePreview = preview ?? task.preview
    const createdAt = task.createdAt ?? previewCreatedAt(effectivePreview)
    const updatedAt = task.updatedAt ?? task.lastEventAt ?? effectivePreview?.lastEventAt ?? createdAt
    return {
        id: task.id,
        repoId: task.repoId,
        slug: task.slug,
        title: task.title,
        description: task.description,
        isolationStrategy: toIsolationStrategy(task.isolationStrategy),
        deviceEnvironments: toDeviceEnvironments(task.deviceEnvironments),
        createdBy: toUser(task.createdBy, currentUser),
        events: toCodeEvents(task.events),
        comments: toComments(task.comments, currentUser),
        sessionIds: stringRecord(task.sessionIds),
        queuedTurns: toQueuedTurns(task.queuedTurns),
        createdAt,
        updatedAt,
        closed: task.closed,
        cancelledPlanEventId: task.cancelledPlanEventId,
        enabledMcpServerIds: task.enabledMcpServerIds,
        pullRequest: task.pullRequest,
    }
}
