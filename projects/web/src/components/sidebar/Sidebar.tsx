import NiceModal from "@ebay/nice-modal-react"
import cx from "classnames"
import { AlertTriangle, BarChart3, Database, Settings } from "lucide-react"
import { observer } from "mobx-react"
import { useCallback } from "react"
import { useParams } from "react-router"
import type { OpenADECoreRolloutState } from "../../../../electron/src/preload-api"
import { resolveCoreMigrationRuntimeEndpoint, resolveCoreRolloutState, resolveCoreRuntimeEndpoint } from "../../runtime/localProductRuntimeClient"
import { useCodeStore } from "../../store/context"
import { SettingsModal, type SettingsTab } from "../settings/SettingsModal"
import { ScrollArea } from "../ui/ScrollArea"
import { CronsSidebarContent } from "./CronList"
import { ReposSidebarContent } from "./RepoList"
import { TasksSidebarContent } from "./TaskList"
import { codeSidebarManager } from "./sidebarManager"
import SidebarIcon from "./static/sidebar.svg?react"

const ELECTRON_DRAG_REGION_CLASS = "electron-drag-region"
const ELECTRON_NO_DRAG_REGION_CLASS = "electron-no-drag-region"

export function shouldShowCoreMigrationCallout({
    rolloutState,
    hasCoreRuntimeEndpoint,
    hasCoreMigrationRuntimeEndpoint,
}: {
    rolloutState: OpenADECoreRolloutState | null
    hasCoreRuntimeEndpoint: boolean
    hasCoreMigrationRuntimeEndpoint: boolean
}): boolean {
    return (
        !hasCoreRuntimeEndpoint &&
        hasCoreMigrationRuntimeEndpoint &&
        rolloutState?.reason === "legacy-yjs-documents" &&
        rolloutState.legacyYjsDocumentsPresent &&
        !rolloutState.legacyYjsMigrationAccepted
    )
}

export function CoreMigrationCalloutView({ onOpenMigration }: { onOpenMigration: () => void }) {
    return (
        <div className="mx-2 mb-2 border border-warning/30 bg-warning/10 p-2.5 text-warning">
            <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium">Legacy backend active</p>
                    <p className="mt-1 text-xs leading-relaxed text-warning/80">Import local data to enable OpenADE Core on next launch.</p>
                    <button
                        type="button"
                        className="btn mt-2 flex items-center gap-1.5 bg-warning px-2 py-1 text-xs font-medium text-warning-content hover:bg-warning/90"
                        onClick={onOpenMigration}
                    >
                        <Database className="h-3.5 w-3.5" />
                        <span>Migrate</span>
                    </button>
                </div>
            </div>
        </div>
    )
}

const CoreMigrationCallout = ({ onOpenMigration }: { onOpenMigration: () => void }) => {
    const rolloutState = resolveCoreRolloutState()
    const hasCoreRuntimeEndpoint = resolveCoreRuntimeEndpoint() !== null
    const hasCoreMigrationRuntimeEndpoint = resolveCoreMigrationRuntimeEndpoint() !== null

    if (!shouldShowCoreMigrationCallout({ rolloutState, hasCoreRuntimeEndpoint, hasCoreMigrationRuntimeEndpoint })) return null
    return <CoreMigrationCalloutView onOpenMigration={onOpenMigration} />
}

const SidebarContent = observer(() => {
    const manager = codeSidebarManager
    const codeStore = useCodeStore()
    const params = useParams<{ workspaceId?: string; taskId?: string; creationId?: string }>()
    const { workspaceId, taskId, creationId } = params
    const handleOpenSettings = useCallback(
        (tab?: SettingsTab) => {
            NiceModal.show(SettingsModal, { store: codeStore, initialTab: tab })
        },
        [codeStore]
    )

    return (
        <>
            <div className={`${ELECTRON_DRAG_REGION_CLASS} flex items-center pr-2 pl-3 h-11 flex-shrink-0`}>
                <div className="ml-auto flex gap-1">
                    <button
                        type="button"
                        className={`${ELECTRON_NO_DRAG_REGION_CLASS} btn flex h-7 w-7 items-center justify-center rounded-md text-muted hover:text-base-content hover:bg-base-300/60`}
                        onClick={manager.toggleSidebar}
                        title="Close sidebar"
                    >
                        <SidebarIcon className="h-4 w-4" />
                    </button>
                </div>
            </div>
            <ScrollArea
                className="flex-1"
                viewportClassName="h-full"
                scrollbarClassName="pointer-events-none opacity-0 transition-[background-color,opacity] data-[scrolling]:pointer-events-auto data-[scrolling]:opacity-100"
            >
                <div className="flex flex-col gap-2">
                    <CoreMigrationCallout onOpenMigration={() => handleOpenSettings("system")} />
                    <ReposSidebarContent workspaceId={workspaceId} />
                    {workspaceId && <CronsSidebarContent workspaceId={workspaceId} />}
                    {workspaceId && <TasksSidebarContent workspaceId={workspaceId} taskId={taskId} creationId={creationId} />}
                </div>
            </ScrollArea>
            <div className="flex items-center gap-1 px-3 py-2 border-t border-border flex-shrink-0">
                <button
                    type="button"
                    className="btn flex items-center gap-1.5 px-2 py-1.5 text-xs text-muted hover:text-base-content transition-colors"
                    onClick={() => handleOpenSettings("stats")}
                    title="Usage Stats"
                >
                    <BarChart3 className="w-3.5 h-3.5" />
                    <span>Stats</span>
                </button>
                <button
                    type="button"
                    className="btn flex items-center gap-1.5 px-2 py-1.5 text-xs text-muted hover:text-base-content transition-colors"
                    onClick={() => handleOpenSettings()}
                    title="Settings"
                >
                    <Settings className="w-3.5 h-3.5" />
                    <span>Settings</span>
                </button>
            </div>
        </>
    )
})

const BaseSidebar = observer(() => {
    const manager = codeSidebarManager
    const hidden = !manager.showSidebar
    if (hidden) return null

    const containerClasses = cx(
        "absolute left-0 top-0 flex flex-col bg-base-200 flex-shrink-0 transition-[transform,opacity] duration-300 ease-in-out overflow-hidden h-full w-[300px]",
        "visible translate-x-0 opacity-100"
    )

    const contentClasses = "flex flex-col h-full min-w-[300px] transition-opacity duration-300 opacity-100"

    return (
        <div className={containerClasses} aria-hidden={hidden}>
            <div className={contentClasses}>
                <SidebarContent />
            </div>
        </div>
    )
})

const DrawerBaseSidebar = observer(() => {
    const manager = codeSidebarManager
    const hidden = !manager.showSidebar
    if (hidden) return null

    const containerClasses = cx(
        "absolute left-0 top-0 h-full bg-base-200 z-50 transition-transform duration-300 border-r border-border",
        "w-[300px]",
        "visible translate-x-0"
    )

    const innerClasses = "flex flex-col pt-2 h-full"

    return (
        <>
            {/* Backdrop */}
            <div className="absolute inset-0 z-40 backdrop-blur-sm bg-black/20" onClick={manager.toggleSidebar} aria-label="Close sidebar" />

            <div className={containerClasses} aria-hidden={hidden}>
                <div className={innerClasses}>
                    <SidebarContent />
                </div>
            </div>
        </>
    )
})

export const CodeSidebar = observer(() => {
    return codeSidebarManager.isSmallScreen ? <DrawerBaseSidebar /> : <BaseSidebar />
})
