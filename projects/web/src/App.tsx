import { lazy, Suspense } from "react"
import { Navigate, Route, Routes } from "react-router"
import { isCompanionFeatureEnabled } from "./featureFlags"
import { RemoteApp } from "./remote/RemoteApp"
import { codeRoutes } from "./routing"
import type { CodeAppProps } from "./CodeApp"

const CodeApp = lazy(async () => {
    const module = await import("./CodeApp")
    return { default: module.CodeApp }
})

export interface OpenADEAppProps {
    codeStoreFactory?: CodeAppProps["codeStoreFactory"]
}

const codeAppFallback = (
    <div className="code-theme-black h-screen w-screen flex items-center justify-center bg-base-100 text-base-content">
        <div className="text-muted">Loading...</div>
    </div>
)

function RemoteRoute() {
    return isCompanionFeatureEnabled ? <RemoteApp /> : <Navigate to="/dashboard/code" replace />
}

export function OpenADEApp({ codeStoreFactory }: OpenADEAppProps) {
    return (
        <Routes>
            <Route path="/" element={<Navigate to="/dashboard/code" replace />} />
            <Route path={codeRoutes.Remote.path} element={<RemoteRoute />} />
            <Route
                path="/dashboard/code/*"
                element={
                    <Suspense fallback={codeAppFallback}>
                        <CodeApp codeStoreFactory={codeStoreFactory} />
                    </Suspense>
                }
            />
            <Route path="*" element={<Navigate to="/dashboard/code" replace />} />
        </Routes>
    )
}
