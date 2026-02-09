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
import { type ClaudeStreamEvent, type McpServerConfig, getClaudeQueryManager, isClaudeApiAvailable } from "../../electronAPI/claude"
import { getGitStatus, isGitApiAvailable } from "../../electronAPI/git"
import { buildMcpServerConfigs } from "../../electronAPI/mcp"
import { type PromptResult, buildAskPrompt, buildDoPrompt, buildPlanGenerationPrompt, buildRevisePrompt, buildRunPlanPrompt } from "../../prompts/prompts"
import type { ActionEventSource, Comment, GitRefs, Repo, Task } from "../../types"
import type { TaskModel } from "../TaskModel"
import type { CodeStore } from "../store"

type AfterEventCallback = (taskId: string, eventType: ActionEventSource["type"]) => void

interface ActionParams {
    taskId: string
    userInput: string
    source: ActionEventSource
    buildPrompt: (ctx: PromptContext) => PromptResult
    readOnly: boolean
    createSnapshot?: boolean
}

interface PromptContext {
    task: Task
    userInput: string
    pendingComments: Comment[]
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
            const status = await getGitStatus({ repoDir: cwd })
            return {
                sha: status.headCommit,
                branch: status.branch ?? undefined,
            }
        } catch {
            return undefined
        }
    }

    // === Core execution ===

    private async runAction(params: ActionParams): Promise<void> {
        const { taskId, userInput, source, buildPrompt, readOnly, createSnapshot } = params

        console.debug("[ExecutionManager] runAction called", { taskId, source: source.type, userInput: userInput.slice(0, 50) })

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
            return
        }

        if (this.store.isTaskWorking(taskId)) {
            console.debug("[ExecutionManager] runAction: task already working", { taskId })
            return
        }

        // Get pending comments - the prompt builder decides which to consume
        const pendingComments = this.store.comments.getUnsubmittedComments(taskId)

        // Build prompt - returns system prompt, user message, and consumed comment IDs
        const { systemPrompt, userMessage, consumedCommentIds } = buildPrompt({ task, userInput, pendingComments })

        this.store.setTaskWorking(taskId, true)
        let executionId: string | undefined
        let executionSuccess = false

        // Get execution paths early so we can capture git refs before event creation
        const { cwd, additionalDirectories } = this.getExecutionPaths(taskModel, repo)

        try {
            if (!isClaudeApiAvailable()) {
                console.debug("[ExecutionManager] Claude API not available (not in Electron?) - aborting runAction")
                return
            }

            console.debug("[ExecutionManager] Starting execution", {
                taskId,
                source: source.type,
                cwd,
                additionalDirectories,
                readOnly,
                userInputLength: userInput.length,
            })

            executionId = crypto.randomUUID()

            // Capture git refs before execution starts
            const gitRefsBefore = await this.getGitRefs(cwd)

            // Create event with consumed comment IDs and git refs
            const eventResult = this.store.events.createActionEvent({
                taskId,
                userInput,
                executionId,
                source,
                includesCommentIds: consumedCommentIds,
                modelId: taskModel.model,
                gitRefsBefore,
            })
            if (!eventResult) {
                console.debug("[ExecutionManager] createActionEvent returned null - aborting", { taskId, executionId })
                return
            }

            const { eventId } = eventResult
            this.store.tasks.getTaskUIState(taskId).expandOnlyEvent(eventId)

            const parentSessionId = this.store.events.getLastEventSessionId(taskId)

            // Build MCP server configs from enabled servers
            const mcpServerConfigs = this.buildMcpServerConfigs(task.enabledMcpServerIds)
            console.log("[ExecutionManager] MCP config", {
                taskEnabledMcpServerIds: task.enabledMcpServerIds,
                mcpServerConfigs: mcpServerConfigs ? Object.keys(mcpServerConfigs) : null,
            })

            // Run execution
            await this.runExecutionLoop({
                taskId,
                eventId,
                executionId,
                prompt: userMessage,
                appendSystemPrompt: systemPrompt,
                cwd,
                additionalDirectories,
                parentSessionId,
                readOnly,
                createSnapshot,
                mcpServerConfigs,
            })
            executionSuccess = true
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
                getClaudeQueryManager().cleanup(executionId)
            }
            this.fireAfterEvent(taskId, source.type, executionSuccess)
        }
    }

    private getExecutionPaths(taskModel: TaskModel, repo: Repo): { cwd: string; additionalDirectories?: string[] } {
        const env = taskModel.environment
        if (env) {
            const cwd = env.taskWorkingDir
            const additionalDirectories = repo.path !== cwd ? [repo.path] : undefined
            return { cwd, additionalDirectories }
        }
        return { cwd: repo.path }
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
        prompt: string
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
        })

        const manager = getClaudeQueryManager()

        console.debug("[ExecutionManager] runExecutionLoop: calling manager.startExecution")
        const taskModel = this.store.tasks.getTaskModel(ctx.taskId)
        const query = await manager.startExecution(
            ctx.prompt,
            {
                cwd: ctx.cwd,
                additionalDirectories: ctx.additionalDirectories,
                model: taskModel?.model ?? this.store.defaultModel,
                resume: ctx.parentSessionId,
                forkSession: !!ctx.parentSessionId,
                readOnly: ctx.readOnly,
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
            console.debug("[ExecutionManager] stream message received", { messageCount, msgType: msg.type })

            const streamEvent: ClaudeStreamEvent = {
                id: crypto.randomUUID(),
                type: "sdk_message",
                executionId: ctx.executionId,
                message: msg,
                direction: "execution",
            }

            this.store.events.appendStreamEventToEvent({
                taskId: ctx.taskId,
                eventId: ctx.eventId,
                streamEvent,
            })

            // Update SDK capabilities from system:init message
            if (msg.type === "system" && "subtype" in msg && (msg as Record<string, unknown>).subtype === "init") {
                taskModel?.sdkCapabilities.updateFromInitMessage(msg as Record<string, unknown>)
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

        console.debug("[ExecutionManager] runExecutionLoop: stream ended", {
            executionId: ctx.executionId,
            totalMessages: messageCount,
            queryIsComplete: query.isComplete,
            queryIsAborted: query.isAborted,
        })

        await manager.clearBuffer(ctx.executionId)

        this.store.events.completeActionEvent({
            taskId: ctx.taskId,
            eventId: ctx.eventId,
            success: true,
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

    async executePlan(taskId: string, userInput: string): Promise<void> {
        return this.runAction({
            taskId,
            userInput,
            source: { type: "plan", userLabel: "Plan" },
            buildPrompt: ({ userInput: input, pendingComments }) => buildPlanGenerationPrompt(input, pendingComments),
            readOnly: true,
        })
    }

    async executeRevise(taskId: string, userInput: string): Promise<void> {
        // Find the latest completed plan to revise
        const parentPlanEvent = this.store.events.getTaskLatestCompletedPlanEvent(taskId)
        if (!parentPlanEvent) {
            return this.executePlan(taskId, userInput)
        }

        return this.runAction({
            taskId,
            userInput: userInput.trim(),
            source: { type: "revise", userLabel: "Revise Plan", parentEventId: parentPlanEvent.id },
            buildPrompt: ({ userInput: input, pendingComments }) => buildRevisePrompt(input, pendingComments),
            readOnly: true,
        })
    }

    async executeAction({
        taskId,
        userInput,
        label,
        includeComments = true,
    }: {
        taskId: string
        userInput: string
        label?: string
        includeComments?: boolean
    }): Promise<void> {
        const trimmed = userInput.trim()
        return this.runAction({
            taskId,
            userInput: trimmed,
            source: { type: "do", userLabel: label || "Do" },
            buildPrompt: ({ userInput: input, pendingComments }) => buildDoPrompt(input, includeComments ? pendingComments : []),
            readOnly: false,
            createSnapshot: true,
        })
    }

    async executeAsk({ taskId, userInput }: { taskId: string; userInput: string }): Promise<void> {
        const trimmed = userInput.trim()
        return this.runAction({
            taskId,
            userInput: trimmed,
            source: { type: "ask", userLabel: "Ask" },
            buildPrompt: ({ userInput: input, pendingComments }) => buildAskPrompt(input, pendingComments),
            readOnly: true,
            createSnapshot: true,
        })
    }

    async executeRunPlan(taskId: string, userInput?: string): Promise<void> {
        const planEvent = this.store.events.getTaskLatestCompletedPlanEvent(taskId)
        if (!planEvent) {
            console.error("[ExecutionManager] executeRunPlan: No completed plan event found")
            return
        }

        return this.runAction({
            taskId,
            userInput: userInput?.trim() || "",
            source: { type: "run_plan", userLabel: "Run Plan", planEventId: planEvent.id },
            buildPrompt: ({ pendingComments, userInput: input }) => buildRunPlanPrompt(input, pendingComments),
            readOnly: false,
            createSnapshot: true,
        })
    }

    // === Cancel Plan ===

    cancelPlan(taskId: string, planEventId: string): boolean {
        return this.store.events.cancelPlan(taskId, planEventId)
    }
}
