/**
 * ExecutionManager
 *
 * Handles Claude agent execution:
 * - Plan generation
 * - Plan revision
 * - Direct action execution
 * - Run plan execution
 */

import { captureError, track } from "../../analytics"
import { getModelFullId } from "../../constants"
import type { HarnessId, HarnessStreamEvent, McpServerConfig } from "../../electronAPI/harnessEventTypes"
import { getHarnessQueryManager, isHarnessApiAvailable } from "../../electronAPI/harnessQuery"
import { getGitSummary, isGitApiAvailable } from "../../electronAPI/git"
import { buildMcpServerConfigs } from "../../electronAPI/mcp"
import { HyperPlanExecutor, type HyperPlanCallbacks } from "../../hyperplan/HyperPlanExecutor"
import { extractPlanText } from "../../hyperplan/extractPlanText"
import type { HyperPlanStrategy } from "../../hyperplan/types"
import { isStandardStrategy } from "../../hyperplan/strategies"
import { buildRawRendererStyleInstruction, buildWorktreeExecutionInstruction, mergeAppendSystemPrompt } from "../../prompts/executionContext"
import { buildPlanReviewPrompt, buildReviewHandoffPrompt, buildWorkReviewPrompt, type ReviewType } from "../../prompts/reviewPrompts"
import { buildTaskThreadXmlWithBudget } from "../../prompts/taskThreadSerializer"
import {
    type ContentBlock,
    type PromptBuildContext,
    type PromptResult,
    buildAskPrompt,
    buildDoPrompt,
    buildPlanGenerationPrompt,
    buildRevisePrompt,
    buildRunPlanPrompt,
} from "../../prompts/prompts"
import type { ActionEventSource, GitRefs, Repo, Task, UserInputContext } from "../../types"
import type { TaskModel } from "../TaskModel"
import type { CodeStore } from "../store"

type AfterEventCallback = (taskId: string, eventType: ActionEventSource["type"]) => void

interface ActionParams {
    taskId: string
    input: UserInputContext
    source: ActionEventSource
    buildPrompt: (ctx: PromptBuildContext) => Promise<PromptResult>
    readOnly: boolean
    createSnapshot?: boolean
    includeComments?: boolean
    extraSystemPrompt?: string
    freshSession?: boolean
    overrideHarnessId?: HarnessId
    overrideModel?: string
}

interface RunActionResult {
    started: boolean
    eventId?: string
    success: boolean
}

const HYPERPLAN_MAIN_THREAD_CONTEXT_MAX_BYTES = 240_000

interface SessionContextSnapshot {
    sessionId: string
    harnessId: HarnessId
    modelId?: string
}

interface ResolvedExecutionSession {
    parentSessionId?: string
    effectiveHarnessId: HarnessId
    effectiveModel: string
}

export function resolveExecutionSession(args: {
    freshSession?: boolean
    overrideHarnessId?: HarnessId
    overrideModel?: string
    taskHarnessId: HarnessId
    taskModel: string
    sessionContext?: SessionContextSnapshot
}): ResolvedExecutionSession {
    const requestedHarnessId = args.overrideHarnessId ?? args.taskHarnessId
    const requestedModel = args.overrideModel ?? args.taskModel

    if (args.freshSession || !args.sessionContext?.sessionId) {
        return {
            effectiveHarnessId: requestedHarnessId,
            effectiveModel: requestedModel,
        }
    }

    const { sessionContext } = args
    if (sessionContext.harnessId !== requestedHarnessId) {
        return {
            parentSessionId: sessionContext.sessionId,
            effectiveHarnessId: sessionContext.harnessId,
            effectiveModel: sessionContext.modelId ?? requestedModel,
        }
    }

    return {
        parentSessionId: sessionContext.sessionId,
        effectiveHarnessId: requestedHarnessId,
        effectiveModel: requestedModel,
    }
}

export class ExecutionManager {
    private afterEventCallbacks: AfterEventCallback[] = []

    constructor(private store: CodeStore) {}

    // === Event hooks ===

    onAfterEvent(callback: AfterEventCallback): () => void {
        this.afterEventCallbacks.push(callback)
        return () => {
            this.afterEventCallbacks = this.afterEventCallbacks.filter((cb) => cb !== callback)
        }
    }

    private fireAfterEvent(taskId: string, eventType: ActionEventSource["type"], success: boolean): void {
        // Track execution completion
        track("execution_completed", { eventType, success })

        for (const cb of this.afterEventCallbacks) {
            try {
                cb(taskId, eventType)
            } catch (err) {
                console.error("[ExecutionManager] afterEvent callback error:", err)
            }
        }
    }

    private async getGitRefs(cwd: string): Promise<GitRefs | undefined> {
        if (!isGitApiAvailable()) return undefined
        try {
            const status = await getGitSummary({ repoDir: cwd })
            return {
                sha: status.headCommit,
                branch: status.branch ?? undefined,
            }
        } catch {
            return undefined
        }
    }

    // === Core execution ===

    private async runAction(params: ActionParams): Promise<RunActionResult> {
        const {
            taskId,
            input,
            source,
            buildPrompt,
            readOnly,
            createSnapshot,
            includeComments = true,
            extraSystemPrompt,
            freshSession = false,
            overrideHarnessId,
            overrideModel,
        } = params

        console.debug("[ExecutionManager] runAction called", { taskId, source: source.type, userInput: input.userInput.slice(0, 50) })

        // Get prerequisites
        const taskModel = this.store.tasks.getTaskModel(taskId)
        const task = this.store.tasks.getTask(taskId)
        const repo = task ? this.store.repos.getRepo(task.repoId) : null

        if (!task || !taskModel || !repo) {
            console.debug("[ExecutionManager] runAction: missing prerequisites", {
                hasTask: !!task,
                hasTaskModel: !!taskModel,
                hasRepo: !!repo,
                taskId,
                repoId: task?.repoId,
            })
            return { started: false, success: false }
        }

        if (this.store.isTaskWorking(taskId)) {
            console.debug("[ExecutionManager] runAction: task already working", { taskId })
            return { started: false, success: false }
        }

        // Keep the existing session/harness pairing intact, but let the selected
        // model flow through when the harness is unchanged. That makes model
        // switches take effect on resume instead of being silently overwritten
        // by the session's original model.
        const sessionContext = freshSession ? undefined : this.store.events.getLastEventSessionContext(taskId)
        const resolvedSession = resolveExecutionSession({
            freshSession,
            overrideHarnessId,
            overrideModel,
            taskHarnessId: taskModel.harnessId,
            taskModel: taskModel.model,
            sessionContext,
        })
        const parentSessionId = resolvedSession.parentSessionId
        const effectiveHarnessId = resolvedSession.effectiveHarnessId
        const effectiveModel = resolvedSession.effectiveModel

        // Get pending comments - the prompt builder decides which to consume
        const pendingComments = includeComments ? this.store.comments.getUnsubmittedComments(taskId) : []

        // Build prompt context from UserInputContext + comments
        const promptCtx: PromptBuildContext = {
            ...input,
            comments: pendingComments,
        }

        // Build prompt - returns system prompt, user message, and consumed comment IDs
        const { systemPrompt, userMessage, consumedCommentIds } = await buildPrompt(promptCtx)

        this.store.setTaskWorking(taskId, true)
        let executionId: string | undefined
        let actionEventId: string | undefined
        let executionSuccess = false
        let cwd = repo.path
        let additionalDirectories: string[] | undefined
        let appendSystemPrompt: string | undefined = systemPrompt

        try {
            if (!isHarnessApiAvailable()) {
                console.debug("[ExecutionManager] Harness API not available (not in Electron?) - aborting runAction")
                return { started: false, success: false }
            }

            // Resolve execution paths after environment load (required for worktree correctness).
            const executionPaths = await this.getExecutionPaths(taskModel, repo)
            cwd = executionPaths.cwd
            additionalDirectories = executionPaths.additionalDirectories

            const worktreeInstruction = buildWorktreeExecutionInstruction(task.isolationStrategy, cwd)
            appendSystemPrompt = mergeAppendSystemPrompt(mergeAppendSystemPrompt(systemPrompt, worktreeInstruction), extraSystemPrompt)
            const rawRendererStyleInstruction = buildRawRendererStyleInstruction(effectiveHarnessId, source.type)
            appendSystemPrompt = mergeAppendSystemPrompt(appendSystemPrompt, rawRendererStyleInstruction)

            console.debug("[ExecutionManager] Starting execution", {
                taskId,
                source: source.type,
                cwd,
                additionalDirectories,
                readOnly,
                userInputLength: input.userInput.length,
                imageCount: input.images.length,
            })

            executionId = crypto.randomUUID()

            // Capture git refs before execution starts
            const gitRefsBefore = await this.getGitRefs(cwd)

            // Create event with consumed comment IDs and git refs
            const eventResult = this.store.events.createActionEvent({
                taskId,
                userInput: input.userInput,
                images: input.images.length > 0 ? input.images : undefined,
                executionId,
                source,
                includesCommentIds: consumedCommentIds,
                modelId: effectiveModel,
                harnessId: effectiveHarnessId,
                gitRefsBefore,
            })
            if (!eventResult) {
                console.debug("[ExecutionManager] createActionEvent returned null - aborting", { taskId, executionId })
                return { started: false, success: false }
            }

            const { eventId } = eventResult
            actionEventId = eventId
            this.store.tasks.getTaskUIState(taskId).expandOnlyEvent(eventId)

            // Build MCP server configs from enabled servers
            const mcpServerConfigs = this.buildMcpServerConfigs(task.enabledMcpServerIds)

            // Run execution
            await this.runExecutionLoop({
                taskId,
                eventId,
                executionId,
                harnessId: effectiveHarnessId,
                modelId: effectiveModel,
                prompt: userMessage,
                appendSystemPrompt,
                cwd,
                additionalDirectories,
                parentSessionId,
                readOnly,
                createSnapshot,
                mcpServerConfigs,
            })
            const actionEvent = actionEventId ? this.store.getCachedTaskStore(taskId)?.events.get(actionEventId) : undefined
            executionSuccess = actionEvent?.type === "action" ? (actionEvent.result?.success ?? false) : false
        } catch (err) {
            console.error(`[ExecutionManager] ${source.type} failed:`, err)
            track("execution_error", { eventType: source.type })

            // Capture error in Sentry with context
            if (err instanceof Error) {
                captureError(err, {
                    tags: { eventType: source.type },
                    extra: { taskId, executionId },
                })
            }
        } finally {
            this.store.queries.clearActiveQuery(taskId)
            this.store.setTaskWorking(taskId, false)
            if (executionId) {
                getHarnessQueryManager().cleanup(executionId)
            }
            if (actionEventId) {
                this.fireAfterEvent(taskId, source.type, executionSuccess)
            }
        }

        return {
            started: !!actionEventId,
            eventId: actionEventId,
            success: executionSuccess,
        }
    }

    private async getExecutionPaths(taskModel: TaskModel, repo: Repo): Promise<{ cwd: string; additionalDirectories?: string[] }> {
        const env = taskModel.environment ?? (await taskModel.loadEnvironment())
        if (env) {
            const cwd = env.taskWorkingDir
            const additionalDirectories = env.taskRootDir !== cwd ? [env.taskRootDir] : undefined
            return { cwd, additionalDirectories }
        }

        if (taskModel.isolationStrategy?.type === "worktree") {
            throw new Error("Worktree environment is not ready; cannot resolve execution cwd")
        }

        return { cwd: repo.path }
    }

    private getRecentSnapshotFiles(task: Task, limit = 40): string[] {
        const summaries: string[] = []
        const seen = new Set<string>()

        for (let i = task.events.length - 1; i >= 0 && summaries.length < limit; i--) {
            const event = task.events[i]
            if (event.type !== "snapshot") continue

            for (const file of event.files ?? []) {
                const summary = file.status === "renamed" && file.oldPath ? `renamed: ${file.oldPath} -> ${file.path}` : `${file.status}: ${file.path}`
                if (seen.has(summary)) continue
                seen.add(summary)
                summaries.push(summary)
                if (summaries.length >= limit) break
            }
        }

        return summaries
    }

    /**
     * Build MCP server configs from enabled server IDs.
     * Returns undefined if no servers are enabled.
     */
    private buildMcpServerConfigs(enabledServerIds?: string[]): Record<string, McpServerConfig> | undefined {
        if (!enabledServerIds || enabledServerIds.length === 0) return undefined
        if (!this.store.mcpServerStore) return undefined

        const enabledServers = this.store.mcpServers.getServersByIds(enabledServerIds)
        if (enabledServers.length === 0) return undefined

        const configs = buildMcpServerConfigs(enabledServers)
        if (Object.keys(configs).length === 0) return undefined

        return configs
    }

    private async runExecutionLoop(ctx: {
        taskId: string
        eventId: string
        executionId: string
        harnessId: HarnessId
        modelId?: string
        prompt: string | ContentBlock[]
        appendSystemPrompt?: string
        cwd: string
        additionalDirectories?: string[]
        parentSessionId?: string
        readOnly?: boolean
        createSnapshot?: boolean
        mcpServerConfigs?: Record<string, McpServerConfig>
    }): Promise<void> {
        console.debug("[ExecutionManager] runExecutionLoop called", {
            taskId: ctx.taskId,
            eventId: ctx.eventId,
            executionId: ctx.executionId,
            cwd: ctx.cwd,
            readOnly: ctx.readOnly,
            parentSessionId: ctx.parentSessionId,
            hasMcpServerConfigs: !!ctx.mcpServerConfigs,
            promptLength: ctx.prompt.length,
            hasImages: Array.isArray(ctx.prompt),
        })

        const manager = getHarnessQueryManager()

        console.debug("[ExecutionManager] runExecutionLoop: calling manager.startExecution")
        const taskModel = this.store.tasks.getTaskModel(ctx.taskId)
        const selectedModel = ctx.modelId ?? taskModel?.model ?? this.store.defaultModel
        const fullModelId = getModelFullId(selectedModel, ctx.harnessId)
        const query = await manager.startExecution(
            ctx.prompt,
            {
                harnessId: ctx.harnessId,
                cwd: ctx.cwd,
                additionalDirectories: ctx.additionalDirectories,
                model: fullModelId,
                thinking: taskModel?.thinking ?? "high",
                resumeSessionId: ctx.parentSessionId,
                // Forking disabled for now — resume continues the session in-place
                forkSession: false,
                mode: ctx.readOnly ? "read-only" : undefined,
                appendSystemPrompt: ctx.appendSystemPrompt,
                mcpServerConfigs: ctx.mcpServerConfigs,
            },
            ctx.executionId
        )

        if (!query) {
            console.debug("[ExecutionManager] startExecution returned null - IPC failed or not in Electron")
            this.store.events.errorEvent(ctx.taskId, ctx.eventId)
            return
        }

        console.debug("[ExecutionManager] runExecutionLoop: query created, starting stream", {
            executionId: ctx.executionId,
            queryId: query.id,
        })

        this.store.queries.setActiveQuery(ctx.taskId, query, ctx.eventId, ctx.parentSessionId)

        let sessionIdSaved = false
        let messageCount = 0
        for await (const msg of query.stream()) {
            messageCount++
            const rawMsg = msg as Record<string, unknown>

            // Cast needed: TypeScript can't verify harnessId↔message correlation
            // when constructing the event generically across harness types.
            const streamEvent = {
                id: crypto.randomUUID(),
                type: "raw_message" as const,
                executionId: ctx.executionId,
                harnessId: ctx.harnessId,
                message: msg,
                direction: "execution" as const,
            } as HarnessStreamEvent

            this.store.events.appendStreamEventToEvent({
                taskId: ctx.taskId,
                eventId: ctx.eventId,
                streamEvent,
            })

            // Update SDK capabilities from system:init message
            if (rawMsg.type === "system" && rawMsg.subtype === "init") {
                taskModel?.sdkCapabilities.updateFromInitMessage(rawMsg)
            }

            if (!sessionIdSaved && query.sessionId) {
                sessionIdSaved = true
                this.store.events.updateEventSessionIds({
                    taskId: ctx.taskId,
                    eventId: ctx.eventId,
                    sessionId: query.sessionId,
                    parentSessionId: ctx.parentSessionId,
                })
            }
        }

        // Persist non-raw_message execution events (complete, error, stderr, etc.).
        // The stream loop above only persists raw_message events; the remaining
        // envelope events carry usage/cost data, error details, and other metadata.
        const envelopeEvents = query.executionState.events.filter((e) => e.direction === "execution" && e.type !== "raw_message")
        for (const envelopeEvent of envelopeEvents) {
            this.store.events.appendStreamEventToEvent({
                taskId: ctx.taskId,
                eventId: ctx.eventId,
                streamEvent: envelopeEvent,
            })
        }

        const success = query.executionState.status !== "error"

        await manager.clearBuffer(ctx.executionId)

        this.store.events.completeActionEvent({
            taskId: ctx.taskId,
            eventId: ctx.eventId,
            success,
        })

        // Capture git refs after execution completes
        const gitRefsAfter = await this.getGitRefs(ctx.cwd)
        if (gitRefsAfter) {
            this.store.events.updateEventGitRefsAfter({
                taskId: ctx.taskId,
                eventId: ctx.eventId,
                gitRefsAfter,
            })
        }

        if (ctx.createSnapshot) {
            await this.store.events.createSnapshot({
                taskId: ctx.taskId,
                actionEventId: ctx.eventId,
            })
        }
    }

    // === Public execution methods ===

    async executePlan(taskId: string, input: UserInputContext, extraSystemPrompt?: string): Promise<void> {
        await this.runAction({
            taskId,
            input,
            source: { type: "plan", userLabel: "Plan" },
            buildPrompt: (ctx) => buildPlanGenerationPrompt(ctx),
            readOnly: true,
            extraSystemPrompt,
        })
    }

    async executeRevise(taskId: string, input: UserInputContext): Promise<void> {
        // Find the latest completed plan to revise
        const parentPlanEvent = this.store.events.getTaskLatestCompletedPlanEvent(taskId)
        if (!parentPlanEvent) {
            return this.executePlan(taskId, input)
        }

        await this.runAction({
            taskId,
            input: { ...input, userInput: input.userInput.trim() },
            source: { type: "revise", userLabel: "Revise Plan", parentEventId: parentPlanEvent.id },
            buildPrompt: (ctx) => buildRevisePrompt(ctx),
            readOnly: true,
        })
    }

    async executeAction({
        taskId,
        input,
        label,
        includeComments = true,
        extraSystemPrompt,
    }: {
        taskId: string
        input: UserInputContext
        label?: string
        includeComments?: boolean
        extraSystemPrompt?: string
    }): Promise<void> {
        await this.runAction({
            taskId,
            input: { ...input, userInput: input.userInput.trim() },
            source: { type: "do", userLabel: label || "Do" },
            buildPrompt: (ctx) => buildDoPrompt(ctx),
            readOnly: false,
            createSnapshot: true,
            includeComments,
            extraSystemPrompt,
        })
    }

    async executeAsk({ taskId, input, extraSystemPrompt }: { taskId: string; input: UserInputContext; extraSystemPrompt?: string }): Promise<void> {
        await this.runAction({
            taskId,
            input: { ...input, userInput: input.userInput.trim() },
            source: { type: "ask", userLabel: "Ask" },
            buildPrompt: (ctx) => buildAskPrompt(ctx),
            readOnly: true,
            createSnapshot: true,
            extraSystemPrompt,
        })
    }

    async executeReview({
        taskId,
        reviewType,
        harnessId,
        modelId,
        customInstructions,
    }: {
        taskId: string
        reviewType: ReviewType
        harnessId: HarnessId
        modelId: string
        customInstructions?: string
    }): Promise<void> {
        const task = this.store.tasks.getTask(taskId)
        if (!task) return

        const threadContext = buildTaskThreadXmlWithBudget(task, {
            maxBytes: HYPERPLAN_MAIN_THREAD_CONTEXT_MAX_BYTES,
            includeThinking: false,
            includeFunctionInputs: false,
            includeFunctionOutputs: false,
        })
        const threadXml = threadContext.xml
        const changedFiles = this.getRecentSnapshotFiles(task)

        let reviewPrompt: PromptResult
        if (reviewType === "plan") {
            const planEvent = this.store.events.getTaskLatestCompletedPlanEvent(taskId)
            const planText = planEvent ? (extractPlanText(planEvent.execution.events, planEvent.execution.harnessId) ?? "") : ""
            reviewPrompt = buildPlanReviewPrompt({ threadXml, planText, changedFiles, customInstructions })
        } else {
            reviewPrompt = buildWorkReviewPrompt({ threadXml, changedFiles, customInstructions })
        }

        if (typeof reviewPrompt.userMessage !== "string") {
            console.error("[ExecutionManager] executeReview expected string review prompt")
            return
        }

        const userLabel = reviewType === "plan" ? "Review Plan" : "Review"
        const reviewUserInstructions = reviewPrompt.userMessage
        const reviewDisplayInput = customInstructions?.trim() ? `${userLabel}: ${customInstructions.trim()}` : userLabel

        const reviewRun = await this.runAction({
            taskId,
            input: { userInput: reviewDisplayInput, images: [] },
            source: { type: "review", userLabel, reviewType, userInstructions: reviewUserInstructions },
            buildPrompt: async () => reviewPrompt,
            readOnly: true,
            createSnapshot: false,
            includeComments: false,
            freshSession: true,
            overrideHarnessId: harnessId,
            overrideModel: modelId,
        })

        if (!reviewRun.started || !reviewRun.eventId || !reviewRun.success) return

        const reviewEventRaw = this.store.getCachedTaskStore(taskId)?.events.get(reviewRun.eventId)
        const reviewEvent = reviewEventRaw?.type === "action" && reviewEventRaw.source.type === "review" ? reviewEventRaw : undefined
        if (!reviewEvent || reviewEvent.status !== "completed" || !reviewEvent.result?.success) return

        const reviewText = extractPlanText(reviewEvent.execution.events, reviewEvent.execution.harnessId ?? harnessId)
        if (!reviewText) return

        const handoffMessage = buildReviewHandoffPrompt({ reviewType, reviewText })
        const followUpLabel = `${userLabel} Follow-up`
        await this.runAction({
            taskId,
            input: { userInput: followUpLabel, images: [] },
            source: { type: "ask", userLabel: followUpLabel, origin: "review_follow_up" },
            buildPrompt: (ctx) => buildAskPrompt({ ...ctx, userInput: handoffMessage }),
            readOnly: true,
            createSnapshot: false,
            includeComments: false,
        })
    }

    async executeRunPlan(taskId: string, input: UserInputContext): Promise<void> {
        const planEvent = this.store.events.getTaskLatestCompletedPlanEvent(taskId)
        if (!planEvent) {
            console.error("[ExecutionManager] executeRunPlan: No completed plan event found")
            return
        }

        await this.runAction({
            taskId,
            input: { ...input, userInput: input.userInput?.trim() || "" },
            source: { type: "run_plan", userLabel: "Run Plan", planEventId: planEvent.id },
            buildPrompt: (ctx) => buildRunPlanPrompt(ctx),
            readOnly: false,
            createSnapshot: true,
        })
    }

    // === HyperPlan execution ===

    async executeHyperPlan(taskId: string, input: UserInputContext, strategy: HyperPlanStrategy): Promise<void> {
        // For standard strategies, just delegate to normal executePlan
        if (isStandardStrategy(strategy)) {
            return this.executePlan(taskId, input)
        }

        console.debug("[ExecutionManager] executeHyperPlan called", {
            taskId,
            strategyId: strategy.id,
            stepCount: strategy.steps.length,
        })

        const taskModel = this.store.tasks.getTaskModel(taskId)
        const task = this.store.tasks.getTask(taskId)
        const repo = task ? this.store.repos.getRepo(task.repoId) : null

        if (!task || !taskModel || !repo) {
            console.debug("[ExecutionManager] executeHyperPlan: missing prerequisites")
            return
        }

        if (this.store.isTaskWorking(taskId)) {
            console.debug("[ExecutionManager] executeHyperPlan: task already working")
            return
        }

        this.store.setTaskWorking(taskId, true)
        let cwd = repo.path
        let additionalDirectories: string[] | undefined
        let worktreeInstruction: string | undefined
        let mainThreadContextXml: string | undefined
        let mainThreadContextMeta: { truncated: boolean; includedEvents: number; omittedEvents: number; byteLength: number } | undefined
        const mcpServerConfigs = this.buildMcpServerConfigs(task.enabledMcpServerIds)
        const abortController = new AbortController()
        let executor: HyperPlanExecutor | null = null

        // The terminal step's executionId becomes the main execution ID
        const executionId = crypto.randomUUID()
        let executionSuccess = false

        this.store.queries.setActiveCustomRun(taskId, {
            eventId: null,
            abort: async () => {
                abortController.abort()
                executor?.abort()
            },
        })

        try {
            if (!isHarnessApiAvailable()) {
                console.debug("[ExecutionManager] Harness API not available - aborting executeHyperPlan")
                return
            }

            const executionPaths = await this.getExecutionPaths(taskModel, repo)
            cwd = executionPaths.cwd
            additionalDirectories = executionPaths.additionalDirectories
            worktreeInstruction = buildWorktreeExecutionInstruction(task.isolationStrategy, cwd)
            const threadContext = buildTaskThreadXmlWithBudget(task, { maxBytes: HYPERPLAN_MAIN_THREAD_CONTEXT_MAX_BYTES })
            if (threadContext.includedEvents > 0) {
                mainThreadContextXml = threadContext.xml
                mainThreadContextMeta = {
                    truncated: threadContext.truncated,
                    includedEvents: threadContext.includedEvents,
                    omittedEvents: threadContext.omittedEvents,
                    byteLength: threadContext.byteLength,
                }
            }
            if (abortController.signal.aborted) return

            const gitRefsBefore = await this.getGitRefs(cwd)
            if (abortController.signal.aborted) return

            // Find the terminal step to get the harness/model for the main execution record
            const terminalStep = strategy.steps.find((s) => s.id === strategy.terminalStepId)!

            // Create the ActionEvent — the main execution record uses the terminal step's harness
            const eventResult = this.store.events.createActionEvent({
                taskId,
                userInput: input.userInput,
                images: input.images.length > 0 ? input.images : undefined,
                executionId,
                source: { type: "hyperplan", userLabel: "HyperPlan", strategyId: strategy.id },
                includesCommentIds: [],
                modelId: terminalStep.agent.modelId,
                harnessId: terminalStep.agent.harnessId,
                gitRefsBefore,
            })

            if (!eventResult) {
                console.debug("[ExecutionManager] createActionEvent returned null - aborting")
                return
            }

            const { eventId } = eventResult
            this.store.queries.updateActiveRunEvent(taskId, eventId)
            this.store.tasks.getTaskUIState(taskId).expandOnlyEvent(eventId)
            if (abortController.signal.aborted) {
                this.store.events.stoppedEvent({ taskId, eventId })
                return
            }

            // Create sub-execution records for all non-terminal steps
            for (const step of strategy.steps) {
                if (step.id === strategy.terminalStepId) continue
                this.store.events.addHyperPlanSubExecution({
                    taskId,
                    eventId,
                    subExecution: {
                        stepId: step.id,
                        primitive: step.primitive,
                        harnessId: step.agent.harnessId,
                        modelId: step.agent.modelId,
                        executionId: "", // Set when the query starts
                        status: "in_progress",
                        events: [],
                    },
                })
            }

            // Build callbacks that persist to YJS
            const callbacks: HyperPlanCallbacks = {
                onSubPlanStarted: (stepId, subExecutionId) => {
                    this.store.events.updateSubExecutionStatus({
                        taskId,
                        eventId,
                        stepId,
                        status: "in_progress",
                    })
                    // Update the executionId on the sub-execution
                    const taskStore = this.store.getCachedTaskStore(taskId)
                    if (taskStore) {
                        taskStore.events.update(eventId, (draft) => {
                            if (draft.type !== "action") return
                            const sub = draft.hyperplanSubExecutions?.find((s) => s.stepId === stepId)
                            if (sub) sub.executionId = subExecutionId
                        })
                    }
                },

                onSubPlanEvent: (stepId, streamEvent) => {
                    this.store.events.appendStreamEventToSubExecution({
                        taskId,
                        eventId,
                        stepId,
                        streamEvent,
                    })
                },

                onSubPlanStatusChange: (stepId, status, resultText, error) => {
                    this.store.events.updateSubExecutionStatus({
                        taskId,
                        eventId,
                        stepId,
                        status: status === "running" ? "in_progress" : status === "completed" ? "completed" : "error",
                        resultText,
                        error,
                    })
                },

                onTerminalEvent: (streamEvent) => {
                    this.store.events.appendStreamEventToEvent({
                        taskId,
                        eventId,
                        streamEvent,
                    })
                },

                onTerminalSessionId: (sessionId, parentSessionId) => {
                    this.store.events.updateEventSessionIds({
                        taskId,
                        eventId,
                        sessionId,
                        parentSessionId,
                    })
                },

                onLabelMapping: (mapping) => {
                    this.store.events.setHyperPlanReconcileLabels({
                        taskId,
                        eventId,
                        mapping,
                    })
                },
            }

            // Create and run the executor
            executor = new HyperPlanExecutor({
                strategy,
                taskDescription: input.userInput,
                mainThreadContextXml,
                mainThreadContextMeta,
                cwd,
                additionalDirectories,
                appendSystemPromptSuffix: worktreeInstruction,
                thinking: taskModel?.thinking,
                mcpServerConfigs,
                callbacks,
                signal: abortController.signal,
            })

            const result = await executor.execute()
            executionSuccess = result.success

            this.store.events.completeActionEvent({
                taskId,
                eventId,
                success: result.success,
            })

            // Sync TaskModel to the reconciler's harness/model so follow-up
            // actions and the UI reflect the terminal step's agent.
            taskModel.syncHarnessFromHistory()

            // Capture git refs after execution completes
            const gitRefsAfter = await this.getGitRefs(cwd)
            if (gitRefsAfter) {
                this.store.events.updateEventGitRefsAfter({
                    taskId,
                    eventId,
                    gitRefsAfter,
                })
            }
        } catch (err) {
            console.error("[ExecutionManager] executeHyperPlan failed:", err)
            track("execution_error", { eventType: "hyperplan" })

            if (err instanceof Error) {
                captureError(err, {
                    tags: { eventType: "hyperplan" },
                    extra: { taskId, executionId, strategyId: strategy.id },
                })
            }
        } finally {
            this.store.queries.clearActiveQuery(taskId)
            this.store.setTaskWorking(taskId, false)
            this.fireAfterEvent(taskId, "hyperplan", executionSuccess)
        }
    }

    // === Cancel Plan ===

    cancelPlan(taskId: string, planEventId: string): boolean {
        return this.store.events.cancelPlan(taskId, planEventId)
    }
}
