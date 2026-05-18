import NiceModal from "@ebay/nice-modal-react"
import cx from "classnames"
import { BarChart3, Settings } from "lucide-react"
import { observer } from "mobx-react"
import { useCallback } from "react"
import { useParams } from "react-router"
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
            <ScrollArea className="flex-1" viewportClassName="h-full">
                <div className="flex flex-col gap-2">
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

    const containerClasses = cx(
        "absolute left-0 top-0 flex flex-col bg-base-200 flex-shrink-0 transition-[transform,opacity] duration-300 ease-in-out overflow-hidden h-full w-[300px]",
        hidden ? "invisible -translate-x-4 opacity-0 pointer-events-none" : "visible translate-x-0 opacity-100"
    )

    const contentClasses = cx("flex flex-col h-full min-w-[300px] transition-opacity duration-300", hidden ? "opacity-0" : "opacity-100")

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

    const containerClasses = cx(
        "absolute left-0 top-0 h-full bg-base-200 z-50 transition-transform duration-300 border-r border-border",
        "w-[300px]",
        "max-[900px]:block hidden",
        hidden ? "invisible -translate-x-full" : "visible translate-x-0"
    )

    const innerClasses = "flex flex-col pt-2 h-full"

    return (
        <>
            {/* Backdrop */}
            {!hidden && (
                <div
                    className="absolute inset-0 z-40 max-[900px]:block hidden backdrop-blur-sm bg-black/20"
                    onClick={manager.toggleSidebar}
                    aria-label="Close sidebar"
                />
            )}

            <div className={containerClasses} aria-hidden={hidden}>
                <div className={innerClasses}>
                    <SidebarContent />
                </div>
            </div>
        </>
    )
})

export const CodeSidebar = observer(() => {
    return (
        <>
            {/* Drawer version for small screens */}
            <DrawerBaseSidebar />

            {/* Fixed version for large screens */}
            <div className="min-[901px]:block hidden">
                <BaseSidebar />
            </div>
        </>
    )
})
