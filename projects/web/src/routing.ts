/**
 * Code Module Routing
 *
 * Local routing definitions for the code module, isolated from @/state/routing.
 * Provides typesafe navigation for code-specific routes.
 */

import { useNavigate as rrUseNavigate, useLocation, useParams } from "react-router"

type RouteWithoutParams = {
    path: string
    makePath: () => string
}

type RouteWithParams<T extends Record<string, string>> = {
    path: string
    makePath: (params: T) => string
}

export const codeRoutes = {
    Code: {
        path: "/dashboard/code",
        makePath: () => "/dashboard/code",
    },
    CodeWorkspaceCreate: {
        path: "/dashboard/code/workspace/create",
        makePath: () => "/dashboard/code/workspace/create",
    },
    CodeWorkspace: {
        path: "/dashboard/code/workspace/:workspaceId",
        makePath: (params: { workspaceId: string }) => `/dashboard/code/workspace/${params.workspaceId}`,
    },
    CodeWorkspaceTaskCreate: {
        path: "/dashboard/code/workspace/:workspaceId/task/create",
        makePath: (params: { workspaceId: string }) => `/dashboard/code/workspace/${params.workspaceId}/task/create`,
    },
    CodeWorkspaceTaskCreating: {
        path: "/dashboard/code/workspace/:workspaceId/task/create/:creationId",
        makePath: (params: { workspaceId: string; creationId: string }) => `/dashboard/code/workspace/${params.workspaceId}/task/create/${params.creationId}`,
    },
    CodeWorkspaceTask: {
        path: "/dashboard/code/workspace/:workspaceId/task/:taskId",
        makePath: (params: { workspaceId: string; taskId: string }) => `/dashboard/code/workspace/${params.workspaceId}/task/${params.taskId}`,
    },
    CodeWorkspaceSettings: {
        path: "/dashboard/code/workspace/:workspaceId/settings",
        makePath: (params: { workspaceId: string }) => `/dashboard/code/workspace/${params.workspaceId}/settings`,
    },
} as const

// Type utilities for extracting route categories
type CodeRoutesWithoutParams = {
    [K in keyof typeof codeRoutes]: (typeof codeRoutes)[K] extends RouteWithoutParams ? K : never
}[keyof typeof codeRoutes]

type CodeRoutesWithParams = {
    [K in keyof typeof codeRoutes]: (typeof codeRoutes)[K] extends RouteWithParams<infer _> ? K : never
}[keyof typeof codeRoutes]

type ExtractCodeRouteParams<K extends keyof typeof codeRoutes> = (typeof codeRoutes)[K] extends RouteWithParams<infer P> ? P : never

// Typesafe navigation interface
export interface CodeNavigationMethods {
    go<K extends CodeRoutesWithoutParams>(routeName: K): void
    go<K extends CodeRoutesWithParams>(routeName: K, params: ExtractCodeRouteParams<K>): void

    path<K extends CodeRoutesWithoutParams>(routeName: K): string
    path<K extends CodeRoutesWithParams>(routeName: K, params: ExtractCodeRouteParams<K>): string
}

export const useCodeNavigate = () => {
    const navigate = rrUseNavigate()
    const location = useLocation()
    const params = useParams()

    const navigationMethods: CodeNavigationMethods = {
        go: (routeName: keyof typeof codeRoutes, params?: Record<string, string>) => {
            const route = codeRoutes[routeName]
            if (params) {
                navigate((route as RouteWithParams<Record<string, string>>).makePath(params))
            } else {
                navigate((route as RouteWithoutParams).makePath())
            }
        },

        path: (routeName: keyof typeof codeRoutes, params?: Record<string, string>) => {
            const route = codeRoutes[routeName]
            if (params) {
                return (route as RouteWithParams<Record<string, string>>).makePath(params)
            } else {
                return (route as RouteWithoutParams).makePath()
            }
        },
    }

    const goPath = (path: string) => {
        navigate(path)
    }

    return {
        ...navigationMethods,
        goPath,
        params,
        location,
    }
}
