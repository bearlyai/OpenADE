import type { IsolationStrategy } from "../types"
import type { CreationPhase } from "../store/managers/TaskCreationManager"

export type TaskCreationDisplayPhase = CreationPhase | "pending" | "completing" | "error"

export function getTaskCreationPhaseLabel(phase: TaskCreationDisplayPhase, isolationStrategy: IsolationStrategy): string {
    if (phase === "pending") return "Starting..."
    if (phase === "workspace") return "Creating workspace"
    if (phase === "completing") {
        return isolationStrategy.type === "worktree" ? "Creating workspace" : "Starting task"
    }
    return "Setup failed"
}
