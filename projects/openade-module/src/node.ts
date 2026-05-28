import os from "node:os"
import path from "node:path"
import { createHash } from "node:crypto"
import {
    buildOpenADEHyperPlanStepPrompt,
    buildOpenADEReconcileStepPrompt,
    buildOpenADEReviewStepPrompt,
    buildOpenADEReviseStepPrompt,
    extractOpenADEPlanText,
    groupOpenADEHyperPlanByDepth,
    isStandardOpenADEHyperPlanStrategy,
    validateOpenADEHyperPlanStrategy,
} from "./hyperplan"
import { createOpenADEModule, publishOpenADECompanionEvent, type OpenADEModuleAdapters } from "./module"
import { buildOpenADEPrompt } from "./promptBuilder"
import { buildOpenADEPlanReviewPrompt, buildOpenADEReviewHandoffPrompt, buildOpenADEWorkReviewPrompt } from "./review"
import {
    type OpenADEActionEventCreateRequest,
    type OpenADEActionEventSource,
    type OpenADEHyperPlanStep,
    type OpenADEHyperPlanStrategy,
    type OpenADEReviewStartRequest,
    type OpenADETask,
    type OpenADETaskCreateRequest,
    type OpenADETurnStartRequest,
} from "./types"
import { createOpenADEYjsWriter } from "./yjsMutation"
import { createOpenADEYjsProjection } from "./yjsProjection"
import { createOpenADENodeYjsStorage } from "./nodeYjsStorage"
import { RuntimeHandlerError, type RuntimeServer } from "../../runtime/src"
import type { RuntimeRecord } from "../../runtime-protocol/src"
import { createRuntimeNodeHarnessAgentExecutor, registerRuntimeNodeAgentModule, type RuntimeNodeAgentExecutor } from "../../runtime-node/src/agents"

export interface RuntimeNodeOpenADEOptions {
    dataDir?: string
    hostName?: string
    version?: string
    server?: RuntimeServer
    agentExecutor?: RuntimeNodeAgentExecutor
    registerAgentModule?: boolean
}

type ActiveTaskExecution = {
    executionId: string
    runtimeId: string
    repoId: string
    eventId: string
    childExecutionIds?: Set<string>
    stopping?: boolean
}

function defaultDataDir(): string {
    return path.join(os.homedir(), ".openade", "data", "yjs")
}

function now(): string {
    return new Date().toISOString()
}

function sourceForTurn(type: OpenADETurnStartRequest["type"], label?: string): OpenADEActionEventSource {
    const userLabel = label || type
    switch (type) {
        case "plan":
            return { type: "plan", userLabel }
        case "do":
            return { type: "do", userLabel }
        case "ask":
            return { type: "ask", userLabel }
        case "revise":
            return { type: "revise", userLabel, parentEventId: "headless" }
        case "run_plan":
            return { type: "run_plan", userLabel, planEventId: "headless" }
        case "hyperplan":
            return { type: "hyperplan", userLabel, strategyId: "headless" }
    }
}

function fallbackTitle(input: string): string {
    const cleaned = input.replace(/\s+/g, " ").trim()
    return cleaned.length <= 50 ? cleaned : `${cleaned.slice(0, 50).trim()}...`
}

function executionIdForTask(taskId: string): string {
    return `headless-${taskId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function taskIdForClientRequest(repoId: string, clientRequestId: string | undefined): string | undefined {
    if (!clientRequestId) return undefined
    const hash = createHash("sha256").update(repoId).update("\0").update(clientRequestId).digest("hex").slice(0, 26)
    return `task-${hash}`
}

function eventRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function latestCompletedPlanEventId(events: unknown[]): string | undefined {
    return latestCompletedPlanEvent(events)?.id as string | undefined
}

function latestCompletedPlanEvent(events: unknown[]): Record<string, unknown> | undefined {
    for (let index = events.length - 1; index >= 0; index--) {
        const event = eventRecord(events[index])
        if (!event || event.type !== "action" || event.status !== "completed" || typeof event.id !== "string") continue
        const source = eventRecord(event.source)
        if (source?.type === "plan" || source?.type === "revise" || source?.type === "hyperplan") return event
    }
    return undefined
}

function executionEvents(event: Record<string, unknown> | undefined): Array<Record<string, unknown>> {
    const execution = eventRecord(event?.execution)
    const events = Array.isArray(execution?.events) ? execution.events : []
    return events.filter((candidate): candidate is Record<string, unknown> => eventRecord(candidate) !== null)
}

function actionHarnessId(event: Record<string, unknown> | undefined, fallback: string): string {
    const execution = eventRecord(event?.execution)
    return typeof execution?.harnessId === "string" ? execution.harnessId : fallback
}

function taskReviewThreadXml(task: OpenADETask): string {
    const events = task.events.filter((event) => eventRecord(event)?.type !== "snapshot")
    const maxBytes = 240_000
    const included: unknown[] = []
    let byteLength = 0
    for (let index = events.length - 1; index >= 0; index--) {
        const eventText = JSON.stringify(events[index])
        const eventBytes = Buffer.byteLength(eventText, "utf8")
        if (included.length > 0 && byteLength + eventBytes > maxBytes) break
        included.unshift(events[index])
        byteLength += eventBytes
    }
    return JSON.stringify(included, null, 2)
}

function recentSnapshotFiles(task: OpenADETask, limit = 40): string[] {
    const summaries: string[] = []
    const seen = new Set<string>()

    for (let index = task.events.length - 1; index >= 0 && summaries.length < limit; index--) {
        const record = eventRecord(task.events[index])
        if (record?.type !== "snapshot") continue
        const files = Array.isArray(record.files) ? record.files : []
        for (const value of files) {
            const file = eventRecord(value)
            if (!file) continue
            const filePath = typeof file.path === "string" ? file.path : undefined
            const status = typeof file.status === "string" ? file.status : undefined
            if (!filePath || !status) continue
            const oldPath = typeof file.oldPath === "string" ? file.oldPath : undefined
            const summary = status === "renamed" && oldPath ? `renamed: ${oldPath} -> ${filePath}` : `${status}: ${filePath}`
            if (seen.has(summary)) continue
            seen.add(summary)
            summaries.push(summary)
            if (summaries.length >= limit) break
        }
    }

    return summaries
}

function notifyTaskChanged(server: RuntimeServer | undefined, repoId: string, taskId: string): void {
    if (!server) return
    publishOpenADECompanionEvent(server, {
        type: "task_changed",
        repoId,
        taskId,
        at: new Date().toISOString(),
    })
}

function notifyRepoChanged(server: RuntimeServer | undefined, repoId: string): void {
    if (!server) return
    publishOpenADECompanionEvent(server, {
        type: "repo_changed",
        repoId,
        at: new Date().toISOString(),
    })
}

function notifyRepoDeleted(server: RuntimeServer | undefined, repoId: string): void {
    if (!server) return
    publishOpenADECompanionEvent(server, {
        type: "repo_deleted",
        repoId,
        at: new Date().toISOString(),
    })
}

function notifyWorkingTasks(server: RuntimeServer | undefined): void {
    if (!server) return
    publishOpenADECompanionEvent(server, {
        type: "working_tasks",
        taskIds: server.supervisor
            .list({ ownerType: "openade-task" })
            .filter((runtime) => runtime.scope.ownerId && (runtime.status === "starting" || runtime.status === "running"))
            .map((runtime) => runtime.scope.ownerId as string),
        at: new Date().toISOString(),
    })
}

async function reconcileCheckpointedOpenADEActionEvents({
    server,
    writer,
}: {
    server: RuntimeServer
    writer: ReturnType<typeof createOpenADEYjsWriter>
}): Promise<void> {
    const terminalStatuses = new Set(["completed", "failed", "stopped"])
    for (const runtime of server.supervisor.list({ ownerType: "openade-task" })) {
        if (!terminalStatuses.has(runtime.status)) continue
        const taskId = runtime.scope.ownerId
        if (!taskId) continue
        const labels = runtime.scope.labels ?? {}
        const eventId = typeof labels.eventId === "string" ? labels.eventId : undefined
        const executionId = typeof labels.executionId === "string" ? labels.executionId : runtime.nativeId
        if (!eventId && !executionId) continue

        const result = await writer.reconcileActionEventRuntime({
            taskId,
            eventId,
            executionId,
            status: runtime.status === "failed" ? "failed" : runtime.status === "stopped" ? "stopped" : "completed",
            success: runtime.status === "completed" ? true : undefined,
        }).catch(() => null)
        if (result?.changed && result.repoId) notifyTaskChanged(server, result.repoId, taskId)
    }
}

async function stopActiveOpenADERuntime({
    server,
    writer,
    agentExecutor,
    activeTaskExecutions,
    runtime,
}: {
    server: RuntimeServer
    writer: ReturnType<typeof createOpenADEYjsWriter>
    agentExecutor: RuntimeNodeAgentExecutor
    activeTaskExecutions: Map<string, ActiveTaskExecution>
    runtime: RuntimeRecord
}): Promise<boolean> {
    if (runtime.scope.ownerType !== "openade-task" && runtime.scope.ownerType !== "openade-turn" && runtime.scope.ownerType !== "openade-review") return false
    const activeEntry = [...activeTaskExecutions.entries()].find(([, active]) => active.runtimeId === runtime.runtimeId)
    if (!activeEntry) return false

    const [taskId, active] = activeEntry
    active.stopping = true
    const executionIds = active.childExecutionIds && active.childExecutionIds.size > 0 ? Array.from(active.childExecutionIds) : [active.executionId]
    const results = await Promise.all(executionIds.map((executionId) => agentExecutor.interrupt(executionId)))
    const failed = results.find((result) => !result.ok)
    if (failed) {
        throw new RuntimeHandlerError("stop_failed", failed.error ?? "Failed to stop OpenADE runtime", { runtimeId: runtime.runtimeId })
    }

    await writer.stoppedActionEvent({ taskId, eventId: active.eventId })
    activeTaskExecutions.delete(taskId)
    notifyWorkingTasks(server)
    notifyTaskChanged(server, active.repoId, taskId)
    return true
}

export function createRuntimeNodeOpenADEAdapters(options: RuntimeNodeOpenADEOptions = {}): OpenADEModuleAdapters {
    const storage = createOpenADENodeYjsStorage(options.dataDir ?? defaultDataDir())
    const projection = createOpenADEYjsProjection({
        ...storage,
        hostName: () => options.hostName,
    })
    const writer = createOpenADEYjsWriter({
        ...storage,
        hostName: () => options.hostName,
    })
    const server = options.server
    const agentExecutor = options.agentExecutor ?? createRuntimeNodeHarnessAgentExecutor()
    const activeTaskExecutions = new Map<string, ActiveTaskExecution>()
    if (server) {
        server.registerRuntimeStopHandler((runtime) =>
            stopActiveOpenADERuntime({
                server,
                writer,
                agentExecutor,
                activeTaskExecutions,
                runtime,
            })
        )
        void reconcileCheckpointedOpenADEActionEvents({ server, writer })
    }

    async function startTurn(params: OpenADETurnStartRequest, context?: { runtimeId?: string }): Promise<{ taskId: string; eventId: string }> {
        let taskId = params.inTaskId || ""
        if (!taskId) {
            const createdAt = now()
            const request: OpenADETaskCreateRequest = {
                repoId: params.repoId,
                input: params.input,
                createdBy: { id: "headless-runtime", email: "headless@openade.local" },
                deviceId: "headless-runtime",
                title: params.title ?? fallbackTitle(params.input),
                taskId: taskIdForClientRequest(params.repoId, params.clientRequestId),
                createdAt,
                isolationStrategy: params.isolationStrategy,
                enabledMcpServerIds: params.enabledMcpServerIds,
            }
            const result = await writer.createTask(request)
            taskId = result.taskId
        }

        const task = await projection.readTask(params.repoId, taskId)
        const project = (await projection.readProjects()).find((candidate) => candidate.id === params.repoId)
        if (!project) throw new Error(`Repository ${params.repoId} not found`)

        if (params.type === "hyperplan") {
            const strategy = params.hyperplanStrategy
            if (!strategy) {
                return startTurn({ ...params, type: "plan", label: params.label ?? "HyperPlan", inTaskId: taskId }, context)
            }
            if (isStandardOpenADEHyperPlanStrategy(strategy)) {
                const step = strategy.steps[0]
                return startTurn(
                    {
                        ...params,
                        type: "plan",
                        harnessId: step.agent.harnessId,
                        modelId: step.agent.modelId,
                        label: params.label ?? "HyperPlan",
                        inTaskId: taskId,
                    },
                    context
                )
            }
            return startHyperPlan({ params, task, project, strategy, context })
        }

        let promptType = params.type
        let planEventId = latestCompletedPlanEventId(task.events)
        if (promptType === "revise" && !planEventId) {
            promptType = "plan"
            planEventId = undefined
        }
        if (promptType === "run_plan" && !planEventId) {
            throw new Error("Run Plan requires a completed plan event")
        }

        const prompt = buildOpenADEPrompt({
            type: promptType as "plan" | "do" | "ask" | "revise" | "run_plan",
            input: params.input,
            comments: task.comments as Parameters<typeof buildOpenADEPrompt>[0]["comments"],
            label: params.label,
            includeComments: params.includeComments,
            planEventId,
        })
        const executionId = executionIdForTask(taskId)
        const actionRequest: OpenADEActionEventCreateRequest = {
            taskId,
            userInput: params.input,
            executionId,
            harnessId: params.harnessId ?? "claude-code",
            source: prompt.source ?? sourceForTurn(params.type, params.label),
            modelId: params.modelId,
            images: params.images,
            includesCommentIds: prompt.consumedCommentIds,
            fastMode: params.fastMode,
        }
        const action = await writer.createActionEvent(actionRequest)
        const runtimeId = context?.runtimeId ?? `openade-turn:${taskId}`
        if (server) {
            const runtimePatch = {
                status: "running" as const,
                scope: {
                    ownerType: "openade-task",
                    ownerId: taskId,
                    repoPath: project.path,
                    rootPath: project.path,
                    labels: {
                        eventId: action.eventId,
                        executionId,
                    },
                },
                nativeId: executionId,
            }
            const runtime =
                server.supervisor.update(runtimeId, runtimePatch) ??
                server.supervisor.create({
                    runtimeId,
                    kind: "agent",
                    ...runtimePatch,
                })
            server.notify("runtime/updated", runtime)
        }

        activeTaskExecutions.set(taskId, { executionId, runtimeId, repoId: params.repoId, eventId: action.eventId })
        notifyWorkingTasks(server)
        notifyTaskChanged(server, params.repoId, taskId)

        void runHeadlessTurn({
            server,
            writer,
            agentExecutor,
            repoId: params.repoId,
            taskId,
            eventId: action.eventId,
            runtimeId,
            executionId,
            harnessId: actionRequest.harnessId as "claude-code" | "codex",
            cwd: project.path,
            prompt: prompt.userMessage,
            appendSystemPrompt: [prompt.systemPrompt, params.appendSystemPrompt].filter(Boolean).join("\n\n") || undefined,
            readOnly: prompt.readOnly,
            modelId: params.modelId,
            thinking: params.thinking,
            fastMode: params.fastMode,
            activeTaskExecutions,
        })

        return { taskId, eventId: action.eventId }
    }

    async function startReview(params: OpenADEReviewStartRequest, context?: { runtimeId?: string }): Promise<{ taskId: string; eventId: string }> {
        const task = await projection.readTask(params.repoId, params.taskId)
        const project = (await projection.readProjects()).find((candidate) => candidate.id === params.repoId)
        if (!project) throw new Error(`Repository ${params.repoId} not found`)

        const latestPlan = latestCompletedPlanEvent(task.events)
        const latestPlanHarnessId = actionHarnessId(latestPlan, params.harnessId)
        const planText = latestPlan ? (extractOpenADEPlanText(executionEvents(latestPlan), latestPlanHarnessId) ?? "") : ""
        const threadXml = taskReviewThreadXml(task)
        const changedFiles = recentSnapshotFiles(task)
        const reviewPrompt =
            params.reviewType === "plan"
                ? buildOpenADEPlanReviewPrompt({
                      threadXml,
                      planText,
                      changedFiles,
                      customInstructions: params.customInstructions,
                  })
                : buildOpenADEWorkReviewPrompt({
                      threadXml,
                      changedFiles,
                      customInstructions: params.customInstructions,
                  })

        const userLabel = params.reviewType === "plan" ? "Review Plan" : "Review"
        const reviewDisplayInput = params.customInstructions?.trim() ? `${userLabel}: ${params.customInstructions.trim()}` : userLabel
        const executionId = executionIdForTask(params.taskId)
        const action = await writer.createActionEvent({
            taskId: params.taskId,
            userInput: reviewDisplayInput,
            executionId,
            harnessId: params.harnessId,
            source: {
                type: "review",
                userLabel,
                reviewType: params.reviewType,
                userInstructions: params.customInstructions,
            },
            includesCommentIds: [],
            modelId: params.modelId,
        })

        const runtimeId = context?.runtimeId ?? `openade-review:${params.taskId}`
        if (server) {
            const runtimePatch = {
                status: "running" as const,
                scope: {
                    ownerType: "openade-task",
                    ownerId: params.taskId,
                    repoPath: project.path,
                    rootPath: project.path,
                    labels: {
                        eventId: action.eventId,
                        executionId,
                    },
                },
                nativeId: executionId,
            }
            const runtime =
                server.supervisor.update(runtimeId, runtimePatch) ??
                server.supervisor.create({
                    runtimeId,
                    kind: "composite",
                    ...runtimePatch,
                })
            server.notify("runtime/updated", runtime)
        }

        activeTaskExecutions.set(params.taskId, { executionId, runtimeId, repoId: params.repoId, eventId: action.eventId })
        notifyWorkingTasks(server)
        notifyTaskChanged(server, params.repoId, params.taskId)

        void runHeadlessTurn({
            server,
            writer,
            agentExecutor,
            repoId: params.repoId,
            taskId: params.taskId,
            eventId: action.eventId,
            runtimeId,
            executionId,
            harnessId: params.harnessId as "claude-code" | "codex",
            cwd: project.path,
            prompt: reviewPrompt.userMessage,
            appendSystemPrompt: reviewPrompt.systemPrompt,
            readOnly: true,
            modelId: params.modelId,
            activeTaskExecutions,
            onCompleted: async ({ events }) => {
                const reviewText = extractOpenADEPlanText(events, params.harnessId)
                if (!reviewText) return

                const followUpLabel = `${userLabel} Follow-up`
                const followUpMessage = buildOpenADEReviewHandoffPrompt({ reviewType: params.reviewType, reviewText })
                const followUpPrompt = buildOpenADEPrompt({
                    type: "ask",
                    input: followUpMessage,
                    comments: [],
                    label: followUpLabel,
                    includeComments: false,
                })
                const followUpExecutionId = executionIdForTask(params.taskId)
                const followUpAction = await writer.createActionEvent({
                    taskId: params.taskId,
                    userInput: followUpLabel,
                    executionId: followUpExecutionId,
                    harnessId: params.harnessId,
                    source: { type: "ask", userLabel: followUpLabel, origin: "review_follow_up" },
                    includesCommentIds: [],
                    modelId: params.modelId,
                })
                const runtime = server?.supervisor.update(runtimeId, {
                    status: "running",
                    scope: {
                        ownerType: "openade-task",
                        ownerId: params.taskId,
                        repoPath: project.path,
                        rootPath: project.path,
                        labels: {
                            eventId: followUpAction.eventId,
                            executionId: followUpExecutionId,
                        },
                    },
                    nativeId: followUpExecutionId,
                })
                server?.notify("runtime/updated", runtime)
                activeTaskExecutions.set(params.taskId, { executionId: followUpExecutionId, runtimeId, repoId: params.repoId, eventId: followUpAction.eventId })
                notifyWorkingTasks(server)
                notifyTaskChanged(server, params.repoId, params.taskId)

                void runHeadlessTurn({
                    server,
                    writer,
                    agentExecutor,
                    repoId: params.repoId,
                    taskId: params.taskId,
                    eventId: followUpAction.eventId,
                    runtimeId,
                    executionId: followUpExecutionId,
                    harnessId: params.harnessId as "claude-code" | "codex",
                    cwd: project.path,
                    prompt: followUpPrompt.userMessage,
                    appendSystemPrompt: followUpPrompt.systemPrompt,
                    readOnly: followUpPrompt.readOnly,
                    modelId: params.modelId,
                    activeTaskExecutions,
                })
            },
        })

        return { taskId: params.taskId, eventId: action.eventId }
    }

    async function startHyperPlan({
        params,
        task,
        project,
        strategy,
        context,
    }: {
        params: OpenADETurnStartRequest
        task: OpenADETask
        project: { path: string }
        strategy: OpenADEHyperPlanStrategy
        context?: { runtimeId?: string }
    }): Promise<{ taskId: string; eventId: string }> {
        const errors = validateOpenADEHyperPlanStrategy(strategy)
        if (errors.length > 0) throw new Error(`Invalid HyperPlan strategy: ${errors.join(", ")}`)
        const terminalStep = strategy.steps.find((step) => step.id === strategy.terminalStepId)
        if (!terminalStep) throw new Error(`Terminal HyperPlan step ${strategy.terminalStepId} not found`)

        const executionId = executionIdForTask(task.id)
        const action = await writer.createActionEvent({
            taskId: task.id,
            userInput: params.input,
            executionId,
            harnessId: terminalStep.agent.harnessId,
            source: { type: "hyperplan", userLabel: params.label ?? "HyperPlan", strategyId: strategy.id },
            images: params.images,
            includesCommentIds: [],
            modelId: terminalStep.agent.modelId,
            fastMode: params.fastMode,
        })

        for (const step of strategy.steps) {
            if (step.id === strategy.terminalStepId) continue
            await writer.addHyperPlanSubExecution({
                taskId: task.id,
                eventId: action.eventId,
                subExecution: {
                    stepId: step.id,
                    primitive: step.primitive,
                    harnessId: step.agent.harnessId,
                    modelId: step.agent.modelId,
                    executionId: "",
                    status: "in_progress",
                    events: [],
                },
            })
        }

        const runtimeId = context?.runtimeId ?? `openade-turn:${task.id}`
        if (server) {
            const runtimePatch = {
                status: "running" as const,
                scope: {
                    ownerType: "openade-task",
                    ownerId: task.id,
                    repoPath: project.path,
                    rootPath: project.path,
                    labels: {
                        eventId: action.eventId,
                        executionId,
                    },
                },
                nativeId: executionId,
            }
            const runtime =
                server.supervisor.update(runtimeId, runtimePatch) ??
                server.supervisor.create({
                    runtimeId,
                    kind: "composite",
                    ...runtimePatch,
                })
            server.notify("runtime/updated", runtime)
        }

        activeTaskExecutions.set(task.id, { executionId, runtimeId, repoId: params.repoId, eventId: action.eventId, childExecutionIds: new Set() })
        notifyWorkingTasks(server)
        notifyTaskChanged(server, params.repoId, task.id)

        void runHeadlessHyperPlanTurn({
            server,
            writer,
            agentExecutor,
            repoId: params.repoId,
            task,
            taskId: task.id,
            eventId: action.eventId,
            strategy,
            cwd: project.path,
            taskDescription: params.input,
            appendSystemPrompt: params.appendSystemPrompt,
            thinking: params.thinking,
            fastMode: params.fastMode,
            runtimeId,
            activeTaskExecutions,
        })

        return { taskId: task.id, eventId: action.eventId }
    }

    return {
        version: () => options.version ?? "headless",
        readSnapshot: (params) => projection.readSnapshot(params),
        readProjects: (params) => projection.readProjects(params),
        readTaskList: (repoId, params) => projection.readTaskList(repoId, params),
        readTask: (repoId, taskId) => projection.readTask(repoId, taskId),
        listDataDocuments: () => projection.listDataDocuments(),
        readDataDocumentBase64: (id) => projection.readDataDocumentBase64(id),
        saveDataDocumentBase64: (id, data) => storage.saveDocumentUpdate(id, Buffer.from(data, "base64")),
        deleteDataDocument: (id) => storage.deleteDocument(id),
        createRepo: async (params) => {
            const result = await writer.createRepo(params)
            notifyRepoChanged(server, result.repoId)
            return result
        },
        updateRepo: async (params) => {
            await writer.updateRepo(params)
            notifyRepoChanged(server, params.repoId)
        },
        deleteRepo: async (params) => {
            await writer.deleteRepo(params)
            notifyRepoDeleted(server, params.repoId)
        },
        deleteTask: async (params) => {
            const result = await writer.deleteTask(params)
            if (server) {
                publishOpenADECompanionEvent(server, {
                    type: "task_deleted",
                    repoId: params.repoId,
                    taskId: params.taskId,
                    at: new Date().toISOString(),
                })
            }
            return result
        },
        startTurn,
        startReview,
        interruptTurn: async (params) => {
            const active = activeTaskExecutions.get(params.taskId)
            if (!active) return { ok: false, error: "No active headless turn is running for this task" }
            active.stopping = true
            const executionIds = active.childExecutionIds && active.childExecutionIds.size > 0 ? Array.from(active.childExecutionIds) : [active.executionId]
            const results = await Promise.all(executionIds.map((executionId) => agentExecutor.interrupt(executionId)))
            const firstError = results.find((result) => !result.ok)
            return firstError ?? { ok: true }
        },
        cancelQueuedTurn: async (params) => {
            const task = await projection.readTask(params.repoId, params.taskId)
            let cancelled = false
            const queuedTurns = (task.queuedTurns ?? []).map((turn) => {
                if (turn.id !== params.queuedTurnId) return turn
                if (turn.status !== "queued") return turn
                cancelled = true
                return { ...turn, status: "cancelled" as const, updatedAt: now() }
            })
            if (cancelled) {
                await writer.updateTaskMetadata({ taskId: params.taskId, queuedTurns })
                notifyTaskChanged(server, params.repoId, params.taskId)
            }
            return { taskId: params.taskId, queuedTurnId: params.queuedTurnId, cancelled }
        },
        setupTaskEnvironment: (params) => writer.setupTaskEnvironment(params),
        createActionEvent: (params) => writer.createActionEvent(params),
        appendActionStreamEvent: (params) => writer.appendActionStreamEvent(params),
        completeActionEvent: (params) => writer.completeActionEvent(params),
        errorActionEvent: (params) => writer.errorActionEvent(params),
        stoppedActionEvent: (params) => writer.stoppedActionEvent(params),
        reconcileActionEventRuntime: async (params) => {
            const result = await writer.reconcileActionEventRuntime(params)
            if (result.changed && result.repoId) notifyTaskChanged(server, result.repoId, params.taskId)
            return result
        },
        updateActionExecution: (params) => writer.updateActionExecution(params),
        addHyperPlanSubExecution: (params) => writer.addHyperPlanSubExecution(params),
        appendHyperPlanSubExecutionStreamEvent: (params) => writer.appendHyperPlanSubExecutionStreamEvent(params),
        updateHyperPlanSubExecution: (params) => writer.updateHyperPlanSubExecution(params),
        setHyperPlanReconcileLabels: (params) => writer.setHyperPlanReconcileLabels(params),
        createSnapshotEvent: (params) => writer.createSnapshotEvent(params),
        createComment: async (params) => {
            const result = await writer.createComment(params)
            const project = (await projection.readProjects()).find((candidate) => candidate.tasks.some((task) => task.id === params.taskId))
            if (project) notifyTaskChanged(server, project.id, params.taskId)
            return result
        },
        editComment: async (params) => {
            await writer.editComment(params)
            const project = (await projection.readProjects()).find((candidate) => candidate.tasks.some((task) => task.id === params.taskId))
            if (project) notifyTaskChanged(server, project.id, params.taskId)
        },
        deleteComment: async (params) => {
            await writer.deleteComment(params)
            const project = (await projection.readProjects()).find((candidate) => candidate.tasks.some((task) => task.id === params.taskId))
            if (project) notifyTaskChanged(server, project.id, params.taskId)
        },
        updateTaskMetadata: async (params) => {
            await writer.updateTaskMetadata(params)
            const project = (await projection.readProjects()).find((candidate) => candidate.tasks.some((task) => task.id === params.taskId))
            if (project) notifyTaskChanged(server, project.id, params.taskId)
        },
    }
}

export function registerRuntimeNodeOpenADEModule(server: RuntimeServer, options: RuntimeNodeOpenADEOptions = {}): void {
    const agentExecutor = options.agentExecutor ?? createRuntimeNodeHarnessAgentExecutor()
    if (options.registerAgentModule !== false) registerRuntimeNodeAgentModule(server, agentExecutor)
    server.registerModule(createOpenADEModule(createRuntimeNodeOpenADEAdapters({ ...options, server, agentExecutor })))
}

type HeadlessHyperPlanStepResult = {
    text?: string
    sessionId?: string
    status: "completed" | "error" | "stopped"
    error?: string
}

function mergeSystemPrompts(...prompts: Array<string | undefined>): string | undefined {
    const merged = prompts.filter((prompt): prompt is string => typeof prompt === "string" && prompt.trim().length > 0).join("\n\n")
    return merged.length > 0 ? merged : undefined
}

async function runHeadlessHyperPlanTurn({
    server,
    writer,
    agentExecutor,
    repoId,
    task,
    taskId,
    eventId,
    strategy,
    cwd,
    taskDescription,
    appendSystemPrompt,
    thinking,
    fastMode,
    runtimeId,
    activeTaskExecutions,
}: {
    server?: RuntimeServer
    writer: ReturnType<typeof createOpenADEYjsWriter>
    agentExecutor: RuntimeNodeAgentExecutor
    repoId: string
    task: OpenADETask
    taskId: string
    eventId: string
    strategy: OpenADEHyperPlanStrategy
    cwd: string
    taskDescription: string
    appendSystemPrompt?: string
    thinking?: OpenADETurnStartRequest["thinking"]
    fastMode?: boolean
    runtimeId: string
    activeTaskExecutions: Map<string, ActiveTaskExecution>
}): Promise<void> {
    const stepResults = new Map<string, string>()
    const stepSessionIds = new Map<string, string>()
    const mainThreadContextXml = taskReviewThreadXml(task)
    let terminalSuccess = false
    let finalized = false

    const finalize = async (status: "completed" | "failed" | "stopped", error?: string) => {
        if (finalized) return
        finalized = true

        if (status === "completed") {
            await writer.completeActionEvent({ taskId, eventId, success: terminalSuccess })
            const runtime = server?.supervisor.update(runtimeId, { status: "completed" })
            server?.notify("runtime/completed", runtime)
        } else if (status === "stopped") {
            await writer.stoppedActionEvent({ taskId, eventId })
            const runtime = server?.supervisor.update(runtimeId, { status: "stopped", error })
            server?.notify("runtime/stopped", runtime)
        } else {
            await writer.errorActionEvent({ taskId, eventId })
            const runtime = server?.supervisor.update(runtimeId, { status: "failed", error })
            server?.notify("runtime/failed", runtime)
        }

        activeTaskExecutions.delete(taskId)
        notifyWorkingTasks(server)
        notifyTaskChanged(server, repoId, taskId)
    }

    try {
        for (const layer of groupOpenADEHyperPlanByDepth(strategy)) {
            if (activeTaskExecutions.get(taskId)?.stopping) {
                await finalize("stopped")
                return
            }

            const settled = await Promise.allSettled(
                layer.map((step) =>
                    runHeadlessHyperPlanStep({
                        server,
                        writer,
                        agentExecutor,
                        repoId,
                        taskId,
                        eventId,
                        strategy,
                        step,
                        cwd,
                        taskDescription,
                        appendSystemPrompt,
                        thinking,
                        fastMode,
                        stepResults,
                        stepSessionIds,
                        mainThreadContextXml,
                        runtimeId,
                        activeTaskExecutions,
                    })
                )
            )

            for (let index = 0; index < layer.length; index++) {
                const step = layer[index]
                const result = settled[index]
                const value: HeadlessHyperPlanStepResult =
                    result.status === "fulfilled"
                        ? result.value
                        : { status: "error", error: result.reason instanceof Error ? result.reason.message : "HyperPlan step failed" }
                if (value.text) stepResults.set(step.id, value.text)
                if (value.sessionId) stepSessionIds.set(step.id, value.sessionId)
                if (value.status === "stopped") {
                    await finalize("stopped", value.error)
                    return
                }
                if (step.id === strategy.terminalStepId) terminalSuccess = value.status === "completed" && Boolean(value.text)
            }
        }

        await finalize(activeTaskExecutions.get(taskId)?.stopping ? "stopped" : "completed")
    } catch (error) {
        await finalize("failed", error instanceof Error ? error.message : "HyperPlan failed")
    }
}

async function runHeadlessHyperPlanStep({
    server,
    writer,
    agentExecutor,
    repoId,
    taskId,
    eventId,
    strategy,
    step,
    cwd,
    taskDescription,
    appendSystemPrompt,
    thinking,
    fastMode,
    stepResults,
    stepSessionIds,
    mainThreadContextXml,
    runtimeId,
    activeTaskExecutions,
}: {
    server?: RuntimeServer
    writer: ReturnType<typeof createOpenADEYjsWriter>
    agentExecutor: RuntimeNodeAgentExecutor
    repoId: string
    taskId: string
    eventId: string
    strategy: OpenADEHyperPlanStrategy
    step: OpenADEHyperPlanStep
    cwd: string
    taskDescription: string
    appendSystemPrompt?: string
    thinking?: OpenADETurnStartRequest["thinking"]
    fastMode?: boolean
    stepResults: Map<string, string>
    stepSessionIds: Map<string, string>
    mainThreadContextXml: string
    runtimeId: string
    activeTaskExecutions: Map<string, ActiveTaskExecution>
}): Promise<HeadlessHyperPlanStepResult> {
    const isTerminal = step.id === strategy.terminalStepId
    let prompt: { systemPrompt: string; userMessage: string }
    let resumeSessionId: string | undefined

    if (step.primitive === "plan") {
        prompt = buildOpenADEHyperPlanStepPrompt(taskDescription, { mainThreadContextXml })
    } else if (step.primitive === "review") {
        const inputStepId = step.inputs[0]
        const inputText = stepResults.get(inputStepId)
        if (!inputText) {
            const error = `Review step ${step.id} has no input text from ${inputStepId}`
            if (!isTerminal) await writer.updateHyperPlanSubExecution({ taskId, eventId, stepId: step.id, status: "error", error })
            return { status: "error", error }
        }
        prompt = buildOpenADEReviewStepPrompt(taskDescription, inputText, inputStepId)
    } else if (step.primitive === "reconcile") {
        const inputs = step.inputs
            .map((inputId) => {
                const text = stepResults.get(inputId)
                const inputStep = strategy.steps.find((candidate) => candidate.id === inputId)
                if (!text || !inputStep || (inputStep.primitive !== "plan" && inputStep.primitive !== "review")) return null
                return {
                    stepId: inputId,
                    primitive: inputStep.primitive,
                    text,
                    reviewsStepId: inputStep.primitive === "review" ? inputStep.inputs[0] : undefined,
                }
            })
            .filter((input): input is NonNullable<typeof input> => input !== null)
        if (inputs.length === 0) {
            const error = `Reconcile step ${step.id} has no successful inputs`
            if (!isTerminal) await writer.updateHyperPlanSubExecution({ taskId, eventId, stepId: step.id, status: "error", error })
            return { status: "error", error }
        }
        const reconciled = buildOpenADEReconcileStepPrompt(taskDescription, inputs)
        await writer.setHyperPlanReconcileLabels({ taskId, eventId, mapping: reconciled.labelMapping })
        prompt = reconciled
    } else {
        const reviewStepId = step.inputs[0]
        const reviewText = stepResults.get(reviewStepId)
        if (!reviewText || !step.resumeStepId) {
            const error = `Revise step ${step.id} is missing review input or resume target`
            if (!isTerminal) await writer.updateHyperPlanSubExecution({ taskId, eventId, stepId: step.id, status: "error", error })
            return { status: "error", error }
        }
        resumeSessionId = stepSessionIds.get(step.resumeStepId)
        if (!resumeSessionId) {
            const error = `Cannot resume session for step ${step.resumeStepId}`
            if (!isTerminal) await writer.updateHyperPlanSubExecution({ taskId, eventId, stepId: step.id, status: "error", error })
            return { status: "error", error }
        }
        prompt = buildOpenADEReviseStepPrompt(reviewText, reviewStepId)
    }

    const executionId = `hyperplan-${taskId}-${step.id}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
    const active = activeTaskExecutions.get(taskId)
    active?.childExecutionIds?.add(executionId)
    if (!isTerminal) await writer.updateHyperPlanSubExecution({ taskId, eventId, stepId: step.id, executionId, status: "in_progress" })

    const persistedWrites: Array<Promise<unknown>> = []
    const events: Array<Record<string, unknown> & { id: string }> = []
    let sessionId: string | undefined
    let settled = false
    const persist = (write: Promise<unknown>) => {
        persistedWrites.push(write.catch((error) => console.warn("[RuntimeNodeOpenADE] Failed to persist HyperPlan stream event:", error)))
    }

    return new Promise((resolve) => {
        const finish = (result: HeadlessHyperPlanStepResult) => {
            if (settled) return
            settled = true
            void (async () => {
                await Promise.all(persistedWrites)
                const text = extractOpenADEPlanText(events, step.agent.harnessId) ?? undefined
                if (!isTerminal) {
                    await writer.updateHyperPlanSubExecution({
                        taskId,
                        eventId,
                        stepId: step.id,
                        status: result.status === "completed" ? "completed" : result.status === "stopped" ? "stopped" : "error",
                        resultText: text,
                        error: result.status === "error" ? result.error ?? "Execution failed" : undefined,
                    })
                }
                resolve({
                    ...result,
                    text: result.text ?? text,
                    sessionId: result.sessionId ?? sessionId,
                })
            })()
        }

        void agentExecutor
            .start(
                {
                    executionId,
                    harnessId: step.agent.harnessId as "claude-code" | "codex",
                    prompt: prompt.userMessage,
                    cwd,
                    mode: "read-only",
                    model: step.agent.modelId,
                    thinking: thinking ?? "high",
                    fastMode,
                    appendSystemPrompt: mergeSystemPrompts(prompt.systemPrompt, appendSystemPrompt),
                    resumeSessionId,
                    forkSession: resumeSessionId ? false : undefined,
                    processLabel: `OpenADE HyperPlan ${taskId} ${step.id}`,
                },
                {
                    onSpawn(info) {
                        const runtime = server?.supervisor.update(runtimeId, {
                            pid: info.pid,
                            pgid: info.pgid,
                            processLabel: info.processLabel,
                            processStartedAt: info.processStartedAt,
                        })
                        server?.notify("runtime/updated", runtime)
                    },
                    onEvent(event) {
                        events.push(event)
                        server?.supervisor.touchByOwner("openade-task", taskId)
                        server?.notify("agent/event", event)
                        if (isTerminal) {
                            persist(writer.appendActionStreamEvent({ taskId, eventId, streamEvent: event }))
                        } else {
                            persist(writer.appendHyperPlanSubExecutionStreamEvent({ taskId, eventId, stepId: step.id, streamEvent: event }))
                        }
                        if (event.type === "session_started" && typeof event.sessionId === "string") {
                            sessionId = event.sessionId
                            if (isTerminal) {
                                persist(writer.updateActionExecution({ taskId, eventId, sessionId: event.sessionId, parentSessionId: resumeSessionId }))
                            } else {
                                persist(
                                    writer.updateHyperPlanSubExecution({
                                        taskId,
                                        eventId,
                                        stepId: step.id,
                                        sessionId: event.sessionId,
                                        parentSessionId: resumeSessionId,
                                    })
                                )
                            }
                        }
                        notifyTaskChanged(server, repoId, taskId)
                    },
                    onSettled(result) {
                        if (result.status === "completed") finish({ status: "completed", sessionId: result.sessionId })
                        else if (result.status === "stopped") finish({ status: "stopped", sessionId: result.sessionId, error: result.error })
                        else finish({ status: "error", sessionId: result.sessionId, error: result.error ?? "Execution failed" })
                    },
                }
            )
            .then((start) => {
                if (!start.ok) finish({ status: "error", error: start.error ?? "Failed to start HyperPlan step" })
            })
            .catch((error) => {
                finish({ status: "error", error: error instanceof Error ? error.message : "Failed to start HyperPlan step" })
            })
    })
}

async function runHeadlessTurn({
    server,
    writer,
    agentExecutor,
    repoId,
    taskId,
    eventId,
    runtimeId,
    executionId,
    harnessId,
    cwd,
    prompt,
    appendSystemPrompt,
    readOnly,
    modelId,
    thinking,
    fastMode,
    activeTaskExecutions,
    onCompleted,
}: {
    server?: RuntimeServer
    writer: ReturnType<typeof createOpenADEYjsWriter>
    agentExecutor: RuntimeNodeAgentExecutor
    repoId: string
    taskId: string
    eventId: string
    runtimeId: string
    executionId: string
    harnessId: "claude-code" | "codex"
    cwd: string
    prompt: string
    appendSystemPrompt?: string
    readOnly: boolean
    modelId?: string
    thinking?: OpenADETurnStartRequest["thinking"]
    fastMode?: boolean
    activeTaskExecutions: Map<string, ActiveTaskExecution>
    onCompleted?: (result: { events: Array<Record<string, unknown>>; sessionId?: string }) => Promise<void> | void
}): Promise<void> {
    const pendingWrites: Array<Promise<unknown>> = []
    const observedEvents: Array<Record<string, unknown>> = []
    let savedSessionId: string | undefined
    let finalized = false

    const enqueue = (write: Promise<unknown>) => {
        pendingWrites.push(write.catch((error) => console.warn("[RuntimeNodeOpenADE] Failed to persist stream event:", error)))
    }
    const finalize = async (status: "completed" | "failed" | "stopped", error?: string) => {
        if (finalized) return
        finalized = true
        await Promise.all(pendingWrites)

        if (status === "completed") {
            await writer.completeActionEvent({ taskId, eventId, success: true })
            const runtime = server?.supervisor.update(runtimeId, { status: "completed" })
            server?.notify("runtime/completed", runtime)
        } else if (status === "stopped") {
            await writer.stoppedActionEvent({ taskId, eventId })
            const runtime = server?.supervisor.update(runtimeId, { status: "stopped", error })
            server?.notify("runtime/stopped", runtime)
        } else {
            await writer.errorActionEvent({ taskId, eventId })
            const runtime = server?.supervisor.update(runtimeId, { status: "failed", error })
            server?.notify("runtime/failed", runtime)
        }

        activeTaskExecutions.delete(taskId)
        notifyWorkingTasks(server)
        notifyTaskChanged(server, repoId, taskId)

        if (status === "completed" && onCompleted) {
            await onCompleted({ events: observedEvents, sessionId: savedSessionId })
        }
    }

    const start = await agentExecutor.start(
        {
            executionId,
            harnessId,
            prompt,
            cwd,
            mode: readOnly ? "read-only" : "yolo",
            model: modelId,
            thinking,
            fastMode,
            appendSystemPrompt,
            processLabel: `OpenADE ${taskId}`,
        },
        {
            onSpawn(info) {
                const runtime = server?.supervisor.update(runtimeId, {
                    pid: info.pid,
                    pgid: info.pgid,
                    processLabel: info.processLabel,
                    processStartedAt: info.processStartedAt,
                })
                server?.notify("runtime/updated", runtime)
            },
            onEvent(event) {
                observedEvents.push(event)
                server?.supervisor.touchByOwner("openade-task", taskId)
                server?.notify("agent/event", event)
                enqueue(writer.appendActionStreamEvent({ taskId, eventId, streamEvent: event }))
                if (event.type === "session_started" && typeof event.sessionId === "string") {
                    savedSessionId = event.sessionId
                    enqueue(writer.updateActionExecution({ taskId, eventId, sessionId: event.sessionId }))
                }
                if (event.type === "complete") void finalize("completed")
                if (event.type === "error") void finalize(event.code === "aborted" ? "stopped" : "failed", typeof event.error === "string" ? event.error : undefined)
                notifyTaskChanged(server, repoId, taskId)
            },
            onSettled(result) {
                if (result.status === "completed") void finalize("completed")
                else if (result.status === "stopped") void finalize("stopped", result.error)
                else void finalize("failed", result.error)
            },
        }
    )

    if (!start.ok) {
        await finalize("failed", start.error ?? "Agent execution failed")
    }
}
