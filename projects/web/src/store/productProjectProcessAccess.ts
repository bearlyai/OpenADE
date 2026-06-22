import { OPENADE_SHELL_METHOD } from "../shell/capabilities"
import type { ProductProjectProcessAccess } from "./managers/RepoProcessesManager"
import type { CodeStore } from "./store"

export interface ProductProjectScope {
    repoId: string
    taskId?: string
}

type ProcessMutationMethod =
    | typeof OPENADE_SHELL_METHOD.projectProcessStart
    | typeof OPENADE_SHELL_METHOD.projectProcessReconnect
    | typeof OPENADE_SHELL_METHOD.projectProcessStop

export function createProductProjectProcessAccess(
    codeStore: Pick<
        CodeStore,
        | "canUseProductMethod"
        | "canUseProductMethodAfterConnect"
        | "startProductProjectProcess"
        | "reconnectProductProjectProcess"
        | "stopProductProjectProcess"
    >,
    scope: ProductProjectScope
): ProductProjectProcessAccess {
    const canUseProcessMethod = (method: ProcessMutationMethod) => codeStore.canUseProductMethod(method)
    const canUseProcessMethodAfterConnect = (method: ProcessMutationMethod) => codeStore.canUseProductMethodAfterConnect(method)

    return {
        get canStartProjectProcess() {
            return canUseProcessMethod(OPENADE_SHELL_METHOD.projectProcessStart)
        },
        get canReconnectProjectProcess() {
            return canUseProcessMethod(OPENADE_SHELL_METHOD.projectProcessReconnect)
        },
        get canStopProjectProcess() {
            return canUseProcessMethod(OPENADE_SHELL_METHOD.projectProcessStop)
        },
        startProjectProcess: async (args) => {
            if (!(await canUseProcessMethodAfterConnect(OPENADE_SHELL_METHOD.projectProcessStart)))
                throw new Error("Attached runtime does not support starting project processes")
            return codeStore.startProductProjectProcess({ repoId: scope.repoId, taskId: scope.taskId, definitionId: args.definitionId })
        },
        reconnectProjectProcess: async (args) => {
            if (!(await canUseProcessMethodAfterConnect(OPENADE_SHELL_METHOD.projectProcessReconnect)))
                throw new Error("Attached runtime does not support reconnecting project processes")
            return codeStore.reconnectProductProjectProcess({ repoId: scope.repoId, taskId: scope.taskId, processId: args.processId })
        },
        stopProjectProcess: async (args) => {
            if (!(await canUseProcessMethodAfterConnect(OPENADE_SHELL_METHOD.projectProcessStop)))
                throw new Error("Attached runtime does not support stopping project processes")
            return codeStore.stopProductProjectProcess({ repoId: scope.repoId, taskId: scope.taskId, processId: args.processId })
        },
    }
}
