import { observer } from "mobx-react"
import { useCallback, useEffect, useRef, useState } from "react"
import type {
    OpenADEProjectFileReadResult,
    OpenADEProjectFilesTreeResult,
    OpenADEProjectProcessListResult,
    OpenADEProjectProcessReconnectResult,
    OpenADEProjectSearchResult,
} from "../../../openade-module/src"
import { useCodeNavigate } from "../routing"
import { localOpenADEClient } from "../runtime/localOpenADEClient"
import { ProjectTasksScreen } from "../shell/project/ProjectTasksScreen"
import { useCodeStore } from "../store/context"

interface DesktopSharedProjectPageProps {
    workspaceId: string
}

function desktopProjectClientRequestId(prefix: string): string {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `${prefix}-${crypto.randomUUID()}`
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function desktopProjectErrorMessage(err: unknown, fallback: string): string {
    if (err instanceof Error && err.message.trim()) return err.message
    return fallback
}

export const DesktopSharedProjectPage = observer(({ workspaceId }: DesktopSharedProjectPageProps) => {
    const codeStore = useCodeStore()
    const navigate = useCodeNavigate()
    const workspaceIdRef = useRef(workspaceId)
    const project = codeStore.getRuntimeProductProject(workspaceId)
    const projectId = project?.id ?? null
    const workingTaskIds = codeStore.runtimeProductSnapshot?.workingTaskIds ?? []

    const [files, setFiles] = useState<OpenADEProjectFilesTreeResult | null>(null)
    const [filesLoading, setFilesLoading] = useState(false)
    const [fileRead, setFileRead] = useState<OpenADEProjectFileReadResult | null>(null)
    const [fileActionPath, setFileActionPath] = useState<string | null>(null)
    const [searchQuery, setSearchQuery] = useState("")
    const [searchResult, setSearchResult] = useState<OpenADEProjectSearchResult | null>(null)
    const [searchLoading, setSearchLoading] = useState(false)
    const [processes, setProcesses] = useState<OpenADEProjectProcessListResult | null>(null)
    const [processesLoading, setProcessesLoading] = useState(false)
    const [processActionId, setProcessActionId] = useState<string | null>(null)
    const [processOutput, setProcessOutput] = useState<OpenADEProjectProcessReconnectResult | null>(null)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        workspaceIdRef.current = workspaceId
        setFiles(null)
        setFilesLoading(false)
        setFileRead(null)
        setFileActionPath(null)
        setSearchQuery("")
        setSearchResult(null)
        setSearchLoading(false)
        setProcesses(null)
        setProcessesLoading(false)
        setProcessActionId(null)
        setProcessOutput(null)
        setError(null)
    }, [workspaceId])

    const refreshFiles = useCallback(async () => {
        setFilesLoading(true)
        try {
            const result = await localOpenADEClient.listProjectFiles({ repoId: workspaceId, maxDepth: 2, maxEntries: 40 })
            if (workspaceIdRef.current === workspaceId) setFiles(result)
        } finally {
            if (workspaceIdRef.current === workspaceId) setFilesLoading(false)
        }
    }, [workspaceId])

    const refreshProcesses = useCallback(async () => {
        setProcessesLoading(true)
        try {
            const result = await localOpenADEClient.listProjectProcesses({ repoId: workspaceId })
            if (workspaceIdRef.current === workspaceId) setProcesses(result)
        } finally {
            if (workspaceIdRef.current === workspaceId) setProcessesLoading(false)
        }
    }, [workspaceId])

    useEffect(() => {
        if (!projectId) return
        void Promise.all([codeStore.refreshRuntimeProductSnapshot(), refreshFiles(), refreshProcesses()]).catch((err) => {
            if (workspaceIdRef.current === workspaceId) setError(desktopProjectErrorMessage(err, "Unable to load project"))
        })
    }, [codeStore, projectId, refreshFiles, refreshProcesses, workspaceId])

    const handleSelectTask = useCallback(
        (taskId: string) => {
            navigate.go("CodeWorkspaceTask", { workspaceId, taskId })
        },
        [navigate, workspaceId]
    )

    const handleNewTask = useCallback(() => {
        navigate.go("CodeWorkspaceTaskCreate", { workspaceId })
    }, [navigate, workspaceId])

    const handleRefreshFiles = useCallback(() => {
        setError(null)
        void refreshFiles().catch((err) => {
            setError(desktopProjectErrorMessage(err, "Unable to refresh files"))
        })
    }, [refreshFiles])

    const handleReadFile = useCallback(
        (path: string) => {
            setError(null)
            setFileActionPath(path)
            void localOpenADEClient
                .readProjectFile({ repoId: workspaceId, path, maxBytes: 64 * 1024 })
                .then((result) => {
                    if (workspaceIdRef.current === workspaceId) setFileRead(result)
                })
                .catch((err) => {
                    setError(desktopProjectErrorMessage(err, "Unable to read file"))
                })
                .finally(() => {
                    if (workspaceIdRef.current === workspaceId) setFileActionPath(null)
                })
        },
        [workspaceId]
    )

    const handleSearch = useCallback(() => {
        const query = searchQuery.trim()
        if (!query) {
            setSearchResult(null)
            return
        }
        setError(null)
        setSearchLoading(true)
        void localOpenADEClient
            .searchProject({ repoId: workspaceId, query, limit: 25 })
            .then((result) => {
                if (workspaceIdRef.current === workspaceId) setSearchResult(result)
            })
            .catch((err) => {
                setError(desktopProjectErrorMessage(err, "Unable to search files"))
            })
            .finally(() => {
                if (workspaceIdRef.current === workspaceId) setSearchLoading(false)
            })
    }, [searchQuery, workspaceId])

    const handleRefreshProcesses = useCallback(() => {
        setError(null)
        void refreshProcesses().catch((err) => {
            setError(desktopProjectErrorMessage(err, "Unable to refresh processes"))
        })
    }, [refreshProcesses])

    const handleStartProcess = useCallback(
        (definitionId: string) => {
            setError(null)
            setProcessActionId(definitionId)
            void localOpenADEClient
                .startProjectProcess({ repoId: workspaceId, definitionId }, { clientRequestId: desktopProjectClientRequestId("desktop-project-process-start") })
                .then(() => refreshProcesses())
                .catch((err) => {
                    setError(desktopProjectErrorMessage(err, "Unable to start process"))
                })
                .finally(() => {
                    if (workspaceIdRef.current === workspaceId) setProcessActionId(null)
                })
        },
        [refreshProcesses, workspaceId]
    )

    const handleReconnectProcess = useCallback(
        (processId: string) => {
            setError(null)
            setProcessActionId(processId)
            void localOpenADEClient
                .reconnectProjectProcess({ repoId: workspaceId, processId })
                .then(async (result) => {
                    if (workspaceIdRef.current === workspaceId) setProcessOutput(result)
                    await refreshProcesses()
                })
                .catch((err) => {
                    setError(desktopProjectErrorMessage(err, "Unable to read process output"))
                })
                .finally(() => {
                    if (workspaceIdRef.current === workspaceId) setProcessActionId(null)
                })
        },
        [refreshProcesses, workspaceId]
    )

    const handleStopProcess = useCallback(
        (processId: string) => {
            setError(null)
            setProcessActionId(processId)
            void localOpenADEClient
                .stopProjectProcess({ repoId: workspaceId, processId }, { clientRequestId: desktopProjectClientRequestId("desktop-project-process-stop") })
                .then(() => refreshProcesses())
                .catch((err) => {
                    setError(desktopProjectErrorMessage(err, "Unable to stop process"))
                })
                .finally(() => {
                    if (workspaceIdRef.current === workspaceId) setProcessActionId(null)
                })
        },
        [refreshProcesses, workspaceId]
    )

    return (
        <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
            {error && <div className="border-b border-border bg-error/10 px-3 py-2 text-sm text-error">{error}</div>}
            <ProjectTasksScreen
                repo={project}
                workingTaskIds={workingTaskIds}
                files={files}
                filesLoading={filesLoading}
                fileRead={fileRead}
                fileActionPath={fileActionPath}
                searchQuery={searchQuery}
                searchResult={searchResult}
                searchLoading={searchLoading}
                processes={processes}
                processesLoading={processesLoading}
                processActionId={processActionId}
                processOutput={processOutput}
                onSelectTask={handleSelectTask}
                onNewTask={handleNewTask}
                onRefreshFiles={handleRefreshFiles}
                onReadFile={handleReadFile}
                onSearchQueryChange={setSearchQuery}
                onSearch={handleSearch}
                onRefreshProcesses={handleRefreshProcesses}
                onStartProcess={handleStartProcess}
                onReconnectProcess={handleReconnectProcess}
                onStopProcess={handleStopProcess}
            />
        </div>
    )
})
