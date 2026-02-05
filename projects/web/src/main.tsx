/**
 * OpenADE Main Entry Point
 *
 * This is the standalone app entry point.
 * For embedding in other apps, import from './index' instead.
 */

import NiceModal from "@ebay/nice-modal-react"
import { StrictMode, useEffect, useState } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter, Navigate, Route, Routes } from "react-router"
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
import "./index.css"

// Default user for standalone mode
const getDefaultUser = () => ({
    id: "local-user",
    name: "Local User",
    email: "local@openade.dev",
})

// Create store instance
const storeConfig: CodeStoreConfig = {
    getCurrentUser: getDefaultUser,
    navigateToTask: (workspaceId: string, taskId: string) => {
        window.location.href = codeRoutes.CodeWorkspaceTask.makePath({ workspaceId, taskId })
    },
}

const codeStore = new CodeStore(storeConfig)

function App() {
    const [initialized, setInitialized] = useState(false)

    useEffect(() => {
        codeStore.initializeStores().then(() => {
            setInitialized(true)
        })

        return () => {
            codeStore.disconnectAllStores()
        }
    }, [])

    if (!initialized) {
        return (
            <div className="code-theme-dark h-screen w-screen flex items-center justify-center bg-base-100 text-base-content">
                <div className="text-muted">Loading...</div>
            </div>
        )
    }

    return (
        <CodeStoreProvider store={codeStore}>
            <NiceModal.Provider>
                <Routes>
                    {/* Root redirect to code base */}
                    <Route path="/" element={<Navigate to="/dashboard/code" replace />} />

                    {/* Code routes */}
                    <Route path={codeRoutes.Code.path} element={<CodeBaseRoute />} />
                    <Route path={codeRoutes.CodeWorkspaceCreate.path} element={<CodeWorkspaceCreateRoute />} />
                    <Route path={codeRoutes.CodeWorkspace.path} element={<CodeWorkspaceRoute />} />
                    <Route path={codeRoutes.CodeWorkspaceSettings.path} element={<CodeWorkspaceSettingsRoute />} />
                    <Route path={codeRoutes.CodeWorkspaceTaskCreate.path} element={<CodeWorkspaceTaskCreateRoute />} />
                    <Route path={codeRoutes.CodeWorkspaceTaskCreating.path} element={<CodeWorkspaceTaskCreatingRoute />} />
                    <Route path={codeRoutes.CodeWorkspaceTask.path} element={<CodeWorkspaceTaskRoute />} />

                    {/* Catch-all redirect */}
                    <Route path="*" element={<Navigate to="/dashboard/code" replace />} />
                </Routes>
            </NiceModal.Provider>
        </CodeStoreProvider>
    )
}

createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <BrowserRouter>
            <App />
        </BrowserRouter>
    </StrictMode>
)
