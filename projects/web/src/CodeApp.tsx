import NiceModal from "@ebay/nice-modal-react"
import { type ReactNode, useEffect, useState } from "react"
import { Route, Routes, useLocation, useNavigate } from "react-router"
import {
    CodeBaseRoute,
    CodeWorkspaceCreateRoute,
    CodeWorkspaceRoute,
    CodeWorkspaceSettingsRoute,
    CodeWorkspaceTaskCreateRoute,
    CodeWorkspaceTaskCreatingRoute,
    CodeWorkspaceTaskRoute,
} from "./Routes"
import { codeRoutes } from "./routing"
import { CodeStoreProvider } from "./store/context"
import { CodeStore, type CodeStoreConfig } from "./store/store"

const getDefaultUser = () => ({
    id: "local-user",
    name: "Local User",
    email: "local@openade.dev",
})

let routerNavigate: ReturnType<typeof useNavigate> | null = null

const storeConfig: CodeStoreConfig = {
    getCurrentUser: getDefaultUser,
    navigateToTask: (workspaceId: string, taskId: string) => {
        const path = codeRoutes.CodeWorkspaceTask.makePath({ workspaceId, taskId })
        if (routerNavigate) {
            routerNavigate(path)
        } else {
            window.location.hash = path
        }
    },
}

export interface CodeAppProps {
    codeStoreFactory?: () => CodeStore
}

function createDefaultCodeStore(): CodeStore {
    return new CodeStore(storeConfig)
}

export function CodeApp({ codeStoreFactory = createDefaultCodeStore }: CodeAppProps) {
    routerNavigate = useNavigate()

    return (
        <CodeStoreBoundary codeStoreFactory={codeStoreFactory}>
            <Routes>
                <Route path={codeRoutes.Code.path} element={<CodeBaseRoute />} />
                <Route path={codeRoutes.CodeWorkspaceCreate.path} element={<CodeWorkspaceCreateRoute />} />
                <Route path={codeRoutes.CodeWorkspace.path} element={<CodeWorkspaceRoute />} />
                <Route path={codeRoutes.CodeWorkspaceSettings.path} element={<CodeWorkspaceSettingsRoute />} />
                <Route path={codeRoutes.CodeWorkspaceTaskCreate.path} element={<CodeWorkspaceTaskCreateRoute />} />
                <Route path={codeRoutes.CodeWorkspaceTaskCreating.path} element={<CodeWorkspaceTaskCreatingRoute />} />
                <Route path={codeRoutes.CodeWorkspaceTask.path} element={<CodeWorkspaceTaskRoute />} />
            </Routes>
        </CodeStoreBoundary>
    )
}

export function isDirectTaskRoutePath(pathname: string): boolean {
    return getDirectTaskRouteParams(pathname) !== null
}

function getDirectTaskRouteParams(pathname: string): { workspaceId: string; taskId: string } | null {
    const segments = pathname.split("/").filter(Boolean)
    if (
        segments.length !== 6 ||
        segments[0] !== "dashboard" ||
        segments[1] !== "code" ||
        segments[2] !== "workspace" ||
        segments[4] !== "task" ||
        segments[5] === "create"
    ) {
        return null
    }
    return { workspaceId: segments[3] ?? "", taskId: segments[5] ?? "" }
}

function CodeStoreBoundary({ children, codeStoreFactory }: { children: ReactNode; codeStoreFactory: () => CodeStore }) {
    const location = useLocation()
    const [codeStore] = useState(() => codeStoreFactory())
    const [initialized, setInitialized] = useState(false)
    const directTaskRoute = getDirectTaskRouteParams(location.pathname)
    const allowRouteFirstTaskOpen = directTaskRoute !== null && codeStore.shouldUseRuntimeProductTaskRoute()

    useEffect(() => {
        return () => {
            codeStore.disconnectAllStores()
        }
    }, [codeStore])

    useEffect(() => {
        if (allowRouteFirstTaskOpen) return

        let active = true

        const initialize = () => {
            codeStore
                .initializeStores()
                .then(() => {
                    if (active) setInitialized(true)
                })
                .catch((err) => {
                    console.error("[CodeApp] Failed to initialize stores:", err)
                })
        }
        initialize()

        return () => {
            active = false
        }
    }, [codeStore, allowRouteFirstTaskOpen])

    if (!initialized && !allowRouteFirstTaskOpen) {
        return (
            <div className="code-theme-black h-screen w-screen flex items-center justify-center bg-base-100 text-base-content">
                <div className="text-muted">Loading...</div>
            </div>
        )
    }

    return (
        <CodeStoreProvider store={codeStore}>
            <NiceModal.Provider>{children}</NiceModal.Provider>
        </CodeStoreProvider>
    )
}
