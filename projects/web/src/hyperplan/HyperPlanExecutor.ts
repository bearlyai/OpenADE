/**
 * HyperPlanExecutor
 *
 * Orchestrates the execution of a HyperPlan strategy DAG.
 * Manages parallel sub-plan queries, collects results, extracts plan text,
 * and fires the reconciliation query.
 *
 * This class is decoupled from YJS/EventManager — it communicates via callbacks.
 * The ExecutionManager is the glue that connects this to persistence.
 */

import { getModelFullId } from "../constants"
import type { HarnessStreamEvent, McpServerConfig } from "../electronAPI/harnessEventTypes"
import { type ClientHarnessQueryOptions, type HarnessQuery, getHarnessQueryManager, isHarnessApiAvailable } from "../electronAPI/harnessQuery"
import { extractPlanText } from "./extractPlanText"
import { type ReconcileInput, buildHyperPlanStepPrompt, buildReconcileStepPrompt, buildReviewStepPrompt } from "./prompts"
import { groupByDepth, isStandardStrategy, validateStrategy } from "./strategies"
import type { HyperPlanStep, HyperPlanStrategy, SubPlanState } from "./types"

// ============================================================================
// Callbacks — how the executor communicates with the persistence layer
// ============================================================================

export interface HyperPlanCallbacks {
    /** Called when a sub-plan step starts (for creating the sub-execution record) */
    onSubPlanStarted(stepId: string, executionId: string): void
    /** Called when a sub-plan step emits a stream event */
    onSubPlanEvent(stepId: string, event: HarnessStreamEvent): void
    /** Called when a sub-plan step completes or fails */
    onSubPlanStatusChange(stepId: string, status: SubPlanState["status"], resultText?: string, error?: string): void
    /** Called when the terminal step emits a stream event (persisted as main execution events) */
    onTerminalEvent(event: HarnessStreamEvent): void
    /** Called when the terminal step's session ID is known */
    onTerminalSessionId(sessionId: string): void
}

// ============================================================================
// Executor Configuration
// ============================================================================

export interface HyperPlanExecutorConfig {
    strategy: HyperPlanStrategy
    taskDescription: string
    cwd: string
    additionalDirectories?: string[]
    mcpServerConfigs?: Record<string, McpServerConfig>
    callbacks: HyperPlanCallbacks
    signal: AbortSignal
}

// ============================================================================
// HyperPlanExecutor
// ============================================================================

export class HyperPlanExecutor {
    private stepResults = new Map<string, string>() // stepId -> resultText
    private aborted = false
    private config: HyperPlanExecutorConfig
    private activeQueries: HarnessQuery[] = []

    constructor(config: HyperPlanExecutorConfig) {
        this.config = config

        // Listen for abort
        config.signal.addEventListener("abort", () => {
            this.aborted = true
            for (const query of this.activeQueries) {
                query.abort().catch(() => {})
            }
        })
    }

    /**
     * Execute the full strategy DAG.
     * Returns the terminal step's session ID (for task session persistence).
     */
    async execute(): Promise<{ sessionId?: string; success: boolean }> {
        const { strategy } = this.config

        // Validate strategy
        const errors = validateStrategy(strategy)
        if (errors.length > 0) {
            throw new Error(`Invalid strategy: ${errors.join(", ")}`)
        }

        if (!isHarnessApiAvailable()) {
            throw new Error("Harness API not available")
        }

        // For standard strategies, just run a single plan (no reconciliation)
        if (isStandardStrategy(strategy)) {
            return this.executeSinglePlan(strategy.steps[0])
        }

        // Group steps into parallelizable layers
        const layers = groupByDepth(strategy)

        let terminalSessionId: string | undefined

        for (const layer of layers) {
            if (this.aborted) break

            // Run all steps in this layer in parallel
            const results = await Promise.allSettled(layer.map((step) => this.executeStep(step)))

            // Collect results, track failures
            for (let i = 0; i < layer.length; i++) {
                const step = layer[i]
                const result = results[i]
                if (result.status === "fulfilled" && result.value) {
                    this.stepResults.set(step.id, result.value.text)
                    if (step.id === strategy.terminalStepId) {
                        terminalSessionId = result.value.sessionId
                    }
                }
                // Failures are already reported via callbacks in executeStep
            }
        }

        const terminalSucceeded = this.stepResults.has(strategy.terminalStepId)
        return { sessionId: terminalSessionId, success: terminalSucceeded }
    }

    /**
     * Execute a single plan step directly as the terminal step.
     * Used for standard (single-agent) strategies — delegates to the
     * terminal event callbacks so the output goes to the main execution.
     */
    private async executeSinglePlan(step: HyperPlanStep): Promise<{ sessionId?: string; success: boolean }> {
        const { taskDescription, callbacks } = this.config
        const { systemPrompt, userMessage } = buildHyperPlanStepPrompt(taskDescription)

        const query = await this.startQuery(step, userMessage, systemPrompt)
        if (!query) {
            return { success: false }
        }

        this.activeQueries.push(query)

        let sessionId: string | undefined

        query.onSessionId((sid) => {
            sessionId = sid
            callbacks.onTerminalSessionId(sid)
        })

        try {
            for await (const msg of query.stream()) {
                if (this.aborted) break
                const streamEvent = this.wrapAsStreamEvent(query, msg)
                callbacks.onTerminalEvent(streamEvent)
            }

            // Persist envelope events (complete, error, etc.) — critical for Codex
            // cost tracking where cost lives on the harness-level complete event
            const envelopeEvents = query.executionState.events.filter((e) => e.direction === "execution" && e.type !== "raw_message")
            for (const ev of envelopeEvents) {
                callbacks.onTerminalEvent(ev)
            }

            return { sessionId, success: query.executionState.status !== "error" }
        } finally {
            this.activeQueries = this.activeQueries.filter((q) => q !== query)
            await this.cleanupQuery(query)
        }
    }

    /**
     * Execute a single step in the DAG.
     * For non-terminal steps, events go to sub-plan callbacks.
     * For the terminal step, events go to terminal callbacks.
     */
    private async executeStep(step: HyperPlanStep): Promise<{ text: string; sessionId?: string } | null> {
        const { strategy, taskDescription, callbacks } = this.config
        const isTerminal = step.id === strategy.terminalStepId

        // Build prompt based on primitive type
        let userMessage: string
        let systemPrompt: string

        switch (step.primitive) {
            case "plan": {
                const result = buildHyperPlanStepPrompt(taskDescription)
                userMessage = result.userMessage
                systemPrompt = result.systemPrompt
                break
            }
            case "review": {
                const inputStepId = step.inputs[0]
                const inputText = this.stepResults.get(inputStepId)
                if (!inputText) {
                    const errMsg = `Review step "${step.id}" has no input text from "${inputStepId}"`
                    callbacks.onSubPlanStatusChange(step.id, "error", undefined, errMsg)
                    return null
                }
                const result = buildReviewStepPrompt(taskDescription, inputText, inputStepId)
                userMessage = result.userMessage
                systemPrompt = result.systemPrompt
                break
            }
            case "reconcile": {
                const inputs: ReconcileInput[] = []
                for (const inputId of step.inputs) {
                    const inputText = this.stepResults.get(inputId)
                    if (!inputText) continue // Skip failed inputs

                    const inputStep = strategy.steps.find((s) => s.id === inputId)
                    if (!inputStep) continue

                    inputs.push({
                        stepId: inputId,
                        primitive: inputStep.primitive as "plan" | "review",
                        text: inputText,
                        reviewsStepId: inputStep.primitive === "review" ? inputStep.inputs[0] : undefined,
                    })
                }

                if (inputs.length === 0) {
                    const errMsg = `Reconcile step "${step.id}" has no successful inputs`
                    if (isTerminal) {
                        // No way to recover — all sub-plans failed
                        return null
                    }
                    callbacks.onSubPlanStatusChange(step.id, "error", undefined, errMsg)
                    return null
                }

                const result = buildReconcileStepPrompt(taskDescription, inputs)
                userMessage = result.userMessage
                systemPrompt = result.systemPrompt
                break
            }
        }

        // Start the query
        const executionId = crypto.randomUUID()

        if (!isTerminal) {
            callbacks.onSubPlanStarted(step.id, executionId)
        }

        const query = await this.startQuery(step, userMessage, systemPrompt, executionId)
        if (!query) {
            if (!isTerminal) {
                callbacks.onSubPlanStatusChange(step.id, "error", undefined, "Failed to start query")
            }
            return null
        }

        this.activeQueries.push(query)

        let sessionId: string | undefined

        if (isTerminal) {
            query.onSessionId((sid) => {
                sessionId = sid
                callbacks.onTerminalSessionId(sid)
            })
        }

        if (!isTerminal) {
            callbacks.onSubPlanStatusChange(step.id, "running")
        }

        try {
            for await (const msg of query.stream()) {
                if (this.aborted) break

                const streamEvent = this.wrapAsStreamEvent(query, msg)

                if (isTerminal) {
                    callbacks.onTerminalEvent(streamEvent)
                } else {
                    callbacks.onSubPlanEvent(step.id, streamEvent)
                }
            }

            // Extract plan/review text from the completed stream
            const allEvents = query.executionState.events
            const text = extractPlanText(allEvents, step.agent.harnessId)
            const success = query.executionState.status !== "error"

            // Persist envelope events (complete, error, etc.) for all steps.
            // Critical for Codex cost tracking where cost lives on the
            // harness-level complete event rather than on a raw message.
            const envelopeEvents = allEvents.filter((e) => e.direction === "execution" && e.type !== "raw_message")
            if (isTerminal) {
                for (const ev of envelopeEvents) {
                    callbacks.onTerminalEvent(ev)
                }
            } else {
                for (const ev of envelopeEvents) {
                    callbacks.onSubPlanEvent(step.id, ev)
                }
            }

            if (!isTerminal) {
                callbacks.onSubPlanStatusChange(step.id, success ? "completed" : "error", text ?? undefined, success ? undefined : "Execution failed")
            }

            if (text) {
                return { text, sessionId }
            }

            return null
        } finally {
            this.activeQueries = this.activeQueries.filter((q) => q !== query)
            await this.cleanupQuery(query)
        }
    }

    /**
     * Start a harness query for a step.
     */
    private async startQuery(step: HyperPlanStep, prompt: string, appendSystemPrompt: string, executionId?: string): Promise<HarnessQuery | null> {
        const { cwd, additionalDirectories, mcpServerConfigs } = this.config
        const manager = getHarnessQueryManager()

        const options: ClientHarnessQueryOptions = {
            harnessId: step.agent.harnessId,
            cwd,
            additionalDirectories,
            model: getModelFullId(step.agent.modelId, step.agent.harnessId),
            thinking: "high",
            mode: "read-only",
            appendSystemPrompt,
            mcpServerConfigs,
        }

        return manager.startExecution(prompt, options, executionId)
    }

    /**
     * Wrap a raw message as a HarnessStreamEvent for persistence.
     */
    private wrapAsStreamEvent(query: HarnessQuery, msg: unknown): HarnessStreamEvent {
        return {
            id: crypto.randomUUID(),
            type: "raw_message" as const,
            executionId: query.id,
            harnessId: query.options.harnessId,
            message: msg,
            direction: "execution" as const,
        } as HarnessStreamEvent
    }

    /**
     * Clean up a finished query.
     */
    private async cleanupQuery(query: HarnessQuery): Promise<void> {
        try {
            await query.clearBuffer()
        } catch {
            // Non-critical
        }
        getHarnessQueryManager().cleanup(query.id)
    }

    /**
     * Abort all running queries.
     */
    abort(): void {
        this.aborted = true
        for (const query of this.activeQueries) {
            query.abort().catch(() => {})
        }
    }
}
