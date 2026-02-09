/**
 * OpenADE Public Exports
 *
 * This file exports the components and utilities needed to embed
 * OpenADE in other React applications.
 */

// Store
export { CodeStore, type CodeStoreConfig, type CreationPhase, type TaskCreationOptions, type TaskCreation, type ViewMode } from "./store/store"
export { CodeStoreProvider, useCodeStore } from "./store/context"

// Routes and navigation
export {
    CodeBaseRoute,
    CodeWorkspaceCreateRoute,
    CodeWorkspaceRoute,
    CodeWorkspaceSettingsRoute,
    CodeWorkspaceTaskCreateRoute,
    CodeWorkspaceTaskRoute,
    CodeWorkspaceTaskCreatingRoute,
} from "./Routes"
export { codeRoutes, useCodeNavigate, type CodeNavigationMethods, type CodeNavigator } from "./routing"

// Types
export type { Task, Repo, User, ActionEvent, CodeEvent, Comment } from "./types"

// Components (selective exports for embedding)
export { CodeLayout, type CodeLayoutProps } from "./layout/CodeLayout"
export { CodeAppLayout } from "./layout/CodeAppLayout"

// Constants
export { DEFAULT_MODEL, CLAUDE_MODELS, type ClaudeModelId } from "./constants"
