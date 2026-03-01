import type { CodeEvent, IsolationStrategy } from "../../types"

export interface ResolveTaskCopyPathParams {
    repoPath: string
    isolationStrategy?: IsolationStrategy
    environmentPath?: string | null
    events?: CodeEvent[]
}

function getLatestSetupWorkingDir(events: CodeEvent[]): string | null {
    for (let i = events.length - 1; i >= 0; i--) {
        const event = events[i]
        if (event.type === "setup_environment" && event.workingDir) {
            return event.workingDir
        }
    }
    return null
}

export function resolveTaskCopyPath({ repoPath, isolationStrategy, environmentPath, events = [] }: ResolveTaskCopyPathParams): string | null {
    if (environmentPath) {
        return environmentPath
    }

    if (!isolationStrategy || isolationStrategy.type === "head") {
        return repoPath
    }

    return getLatestSetupWorkingDir(events)
}
