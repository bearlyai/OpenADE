import NiceModal from "@ebay/nice-modal-react"
import cx from "classnames"
import { BarChart3, Settings } from "lucide-react"
import { observer } from "mobx-react"
import { useCallback } from "react"
import { useParams } from "react-router"
import { useCodeStore } from "../../store/context"
import { SettingsModal, type SettingsTab } from "../settings/SettingsModal"
import { ScrollArea } from "../ui/ScrollArea"
import { ReposSidebarContent } from "./RepoList"
import { TasksSidebarContent } from "./TaskList"
import { codeSidebarManager } from "./sidebarManager"
import SidebarIcon from "./static/sidebar.svg?react"

const SidebarLogo = () => (
    <span
        className="font-bold text-xl tracking-tight select-none"
        style={{
            background:
                "linear-gradient(135deg, var(--color-primary) 0%, color-mix(in oklch, var(--color-primary) 80%, var(--color-accent) 20%) 50%, color-mix(in oklch, var(--color-primary) 60%, var(--color-accent) 40%) 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
        }}
    >
        OpenADE
    </span>
)

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
            <div className="flex pr-2 pl-3">
                <div className="pt-1">
                    <SidebarLogo />
                </div>
                <div className="ml-auto flex gap-1">
                    <button
                        type="button"
                        className="btn flex items-center p-2 mt-[-5px] text-lg rounded-md"
                        onClick={manager.toggleSidebar}
                        title="Close sidebar"
                    >
                        <SidebarIcon />
                    </button>
                </div>
            </div>
            <ScrollArea className="flex-1 mt-2" viewportClassName="h-full">
                <div className="flex flex-col gap-2">
                    <ReposSidebarContent workspaceId={workspaceId} />
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
        "flex flex-col bg-base-100 flex-shrink-0 transition-[width] duration-300 border-r border-border overflow-hidden h-full",
        hidden ? "w-0 border-r-0" : "w-[300px]"
    )

    const contentClasses = cx("flex flex-col pt-2 h-full min-w-[300px] transition-opacity duration-0", hidden ? "opacity-0" : "opacity-100")

    return (
        <div className={containerClasses}>
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
        "absolute left-0 top-0 h-full bg-base-100 z-50 transition-transform duration-300 border-r border-border",
        "w-[300px]",
        "max-[900px]:block hidden",
        hidden ? "-translate-x-full" : "translate-x-0"
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

            <div className={containerClasses}>
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
