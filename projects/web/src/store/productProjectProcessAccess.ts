import type { ProductProjectProcessAccess } from "./managers/RepoProcessesManager"
import type { CodeStore } from "./store"

export interface ProductProjectScope {
    repoId: string
    taskId?: string
}

export function createProductProjectProcessAccess(
    codeStore: Pick<CodeStore, "startProductProjectProcess" | "reconnectProductProjectProcess" | "stopProductProjectProcess">,
    scope: ProductProjectScope
): ProductProjectProcessAccess {
    return {
        startProjectProcess: (args) => codeStore.startProductProjectProcess({ repoId: scope.repoId, taskId: scope.taskId, definitionId: args.definitionId }),
        reconnectProjectProcess: (args) => codeStore.reconnectProductProjectProcess({ repoId: scope.repoId, taskId: scope.taskId, processId: args.processId }),
        stopProjectProcess: (args) => codeStore.stopProductProjectProcess({ repoId: scope.repoId, taskId: scope.taskId, processId: args.processId }),
    }
}
