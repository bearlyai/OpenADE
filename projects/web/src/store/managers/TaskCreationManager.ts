import { makeAutoObservable, runInAction } from "mobx"
import { track } from "../../analytics"
import type { HarnessId } from "../../electronAPI/harnessEventTypes"
import type { HyperPlanStrategy } from "../../hyperplan/types"
import { fallbackTitle, generateTitle } from "../../prompts/titleExtractor"
import type { ImageAttachment, IsolationStrategy, UserInputContext } from "../../types"
import { ulid } from "../../utils/ulid"
import type { ThinkingLevel } from "../TaskModel"
import type { CodeStore } from "../store"

export type CreationPhase = "workspace"

export interface TaskCreationOptions {
    repoId: string
    description: string
    mode: "plan" | "do" | "ask" | "hyperplan"
    isolationStrategy: IsolationStrategy
    images?: ImageAttachment[]
    enabledMcpServerIds?: string[]
    harnessId?: HarnessId
    modelId?: string
    thinking?: ThinkingLevel
    fastMode?: boolean
}

export interface TaskCreation {
    id: string
    repoId: string
    description: string
    mode: "plan" | "do" | "ask" | "hyperplan"
    isolationStrategy: IsolationStrategy
    images: ImageAttachment[]
    enabledMcpServerIds?: string[]
    harnessId?: HarnessId
    modelId?: string
    thinking?: ThinkingLevel
    fastMode?: boolean
    phase: CreationPhase | "pending" | "completing"
    error: string | null
    abortController: AbortController
    createdAt: string
    completedTaskId: string | null
}

export function buildTaskCreationInput(description: string, images: ImageAttachment[]): UserInputContext {
    return {
        userInput: description,
        images: images.map(cloneImageAttachment),
    }
}

function cloneImageAttachment(image: ImageAttachment): ImageAttachment {
    return {
        id: image.id,
        mediaType: image.mediaType,
        ext: image.ext,
        originalWidth: image.originalWidth,
        originalHeight: image.originalHeight,
        resizedWidth: image.resizedWidth,
        resizedHeight: image.resizedHeight,
    }
}

function cloneIsolationStrategy(strategy: IsolationStrategy): IsolationStrategy {
    return strategy.type === "worktree" ? { type: "worktree", sourceBranch: strategy.sourceBranch } : { type: "head" }
}

function cloneHyperPlanStrategy(strategy: HyperPlanStrategy): HyperPlanStrategy {
    return {
        id: strategy.id,
        name: strategy.name,
        description: strategy.description,
        terminalStepId: strategy.terminalStepId,
        steps: strategy.steps.map((step) => ({
            id: step.id,
            primitive: step.primitive,
            agent: {
                harnessId: step.agent.harnessId,
                modelId: step.agent.modelId,
            },
            inputs: [...step.inputs],
            resumeStepId: step.resumeStepId,
        })),
    }
}

export class TaskCreationManager {
    creationsById: Map<string, TaskCreation> = new Map()

    constructor(private store: CodeStore) {
        makeAutoObservable(this, {
            creationsById: true,
        })
    }

    newTask(options: TaskCreationOptions): string {
        const id = ulid()
        const creation: TaskCreation = {
            id,
            repoId: options.repoId,
            description: options.description,
            mode: options.mode,
            isolationStrategy: options.isolationStrategy,
            images: options.images ? [...options.images] : [],
            enabledMcpServerIds: options.enabledMcpServerIds,
            harnessId: options.harnessId,
            modelId: options.modelId,
            thinking: options.thinking,
            fastMode: options.fastMode,
            phase: "pending",
            error: null,
            abortController: new AbortController(),
            createdAt: new Date().toISOString(),
            completedTaskId: null,
        }

        runInAction(() => {
            this.creationsById.set(id, creation)
        })

        this.runCreation(id)

        return id
    }

    getCreation(id: string): TaskCreation | null {
        return this.creationsById.get(id) || null
    }

    getCreationsForRepo(repoId: string): TaskCreation[] {
        return Array.from(this.creationsById.values()).filter((c) => c.repoId === repoId && c.completedTaskId === null)
    }

    async cancelCreation(id: string): Promise<void> {
        const creation = this.creationsById.get(id)
        if (!creation) return

        creation.abortController.abort()

        runInAction(() => {
            this.creationsById.delete(id)
        })
    }

    retryCreation(id: string): void {
        const creation = this.creationsById.get(id)
        if (!creation || !creation.error) return

        runInAction(() => {
            creation.error = null
            creation.phase = "pending"
            creation.abortController = new AbortController()
        })

        this.runCreation(id)
    }

    dismissCreation(id: string): void {
        const creation = this.creationsById.get(id)
        if (!creation) return

        // Abort if still running
        creation.abortController.abort()

        runInAction(() => {
            this.creationsById.delete(id)
        })
    }

    private async runCreation(id: string): Promise<void> {
        const creation = this.creationsById.get(id)
        if (!creation) return

        const repo = this.store.repos.getRepo(creation.repoId)
        if (!repo) {
            runInAction(() => {
                creation.error = "Repository not found"
            })
            return
        }

        const signal = creation.abortController.signal

        try {
            if (signal.aborted) throw new Error("Task creation cancelled")

            runInAction(() => {
                creation.phase = "completing"
            })

            const result = await this.store.startProductTurn({
                repoId: creation.repoId,
                type: creation.mode,
                input: creation.description,
                isolationStrategy: cloneIsolationStrategy(creation.isolationStrategy),
                enabledMcpServerIds: creation.enabledMcpServerIds ? [...creation.enabledMcpServerIds] : undefined,
                harnessId: creation.harnessId,
                modelId: creation.modelId,
                images: creation.images.map(cloneImageAttachment),
                thinking: creation.thinking,
                fastMode: creation.fastMode,
                hyperplanStrategy: creation.mode === "hyperplan" ? cloneHyperPlanStrategy(this.store.getActiveHyperPlanStrategy()) : undefined,
            })

            const cleanupIfCancelled = async () => {
                if (!signal.aborted) return false
                await this.cleanupAcceptedCancelledTask(creation.repoId, result.taskId)
                return true
            }

            if (await cleanupIfCancelled()) throw new Error("Task creation cancelled")
            if (!this.store.shouldUseRuntimeProductReads()) {
                await this.store.refreshProductStateAfterTaskCreation(creation.repoId, result.taskId)
            }

            if (await cleanupIfCancelled()) throw new Error("Task creation cancelled")

            runInAction(() => {
                creation.completedTaskId = result.taskId
            })

            // Track task creation
            track("task_created", {
                mode: creation.mode,
                isolationStrategy: creation.isolationStrategy.type,
                hasMcpServers: (creation.enabledMcpServerIds?.length ?? 0) > 0,
            })

            // Generate title async - don't block task creation
            this.generateTitleAsync({
                repoId: creation.repoId,
                taskId: result.taskId,
                description: creation.description,
                harnessId: creation.harnessId,
                cwd: repo.path,
            })
        } catch (err) {
            if (err instanceof Error && err.message === "Task creation cancelled") {
                runInAction(() => {
                    this.creationsById.delete(id)
                })
                return
            }
            console.error("[TaskCreationManager] Creation failed:", err)
            runInAction(() => {
                creation.error = err instanceof Error ? err.message : "Failed to create task"
            })
        }
    }

    private async cleanupAcceptedCancelledTask(repoId: string, taskId: string): Promise<void> {
        await this.store.interruptProductTurn(taskId).catch((err) => {
            console.warn("[TaskCreationManager] Failed to interrupt cancelled runtime task:", err)
        })
        await this.store
            .deleteProductTask({
                repoId,
                taskId,
                options: {
                    deleteSnapshots: true,
                    deleteImages: true,
                    deleteSessions: true,
                    deleteWorktrees: true,
                },
            })
            .catch((err) => {
                console.warn("[TaskCreationManager] Failed to delete cancelled runtime task:", err)
            })
        await this.store.refreshProductStateAfterTaskDeletion(taskId).catch((err) => {
            console.warn("[TaskCreationManager] Failed to refresh cancelled task deletion:", err)
        })
    }

    /** Generate title async and update task when done (fire-and-forget) */
    private async generateTitleAsync({
        repoId,
        taskId,
        description,
        harnessId,
        cwd,
    }: {
        repoId: string
        taskId: string
        description: string
        harnessId?: HarnessId
        cwd: string
    }): Promise<void> {
        try {
            if (this.store.shouldUseRuntimeProductReads()) {
                await this.store.generateProductTaskTitle({ repoId, taskId, harnessId })
                return
            }

            const abortController = new AbortController()
            const generatedTitle = await generateTitle(description, abortController, { harnessId, cwd })
            this.store.tasks.setTaskTitle(taskId, generatedTitle ?? fallbackTitle(description))
        } catch (err) {
            console.error("[TaskCreationManager] Title generation failed:", err)
            this.store.tasks.setTaskTitle(taskId, fallbackTitle(description))
        }
    }
}
