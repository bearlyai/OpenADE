import { FileCode, X } from "lucide-react"
import { observer } from "mobx-react"
import { twMerge } from "tailwind-merge"
import type { FileBrowserManager } from "../store/managers/FileBrowserManager"

interface FileTabProps {
    path: string
    name: string
    active: boolean
    onSelect: () => void
    onClose: () => void
}

function FileTab({ name, active, onSelect, onClose }: FileTabProps) {
    return (
        <div
            className={twMerge(
                "flex items-center gap-1.5 px-3 py-1.5 text-sm border-r border-border cursor-pointer group",
                active ? "bg-base-100 text-base-content" : "bg-base-200 text-muted hover:text-base-content hover:bg-base-100/50"
            )}
            onClick={onSelect}
        >
            <FileCode size={14} className="flex-shrink-0" />
            <span className="truncate font-mono text-xs max-w-[120px]" title={name}>
                {name}
            </span>
            <button
                type="button"
                onClick={(e) => {
                    e.stopPropagation()
                    onClose()
                }}
                className={twMerge(
                    "btn p-0.5 rounded text-muted hover:text-base-content hover:bg-base-300 transition-colors",
                    active ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                )}
            >
                <X size={12} />
            </button>
        </div>
    )
}

interface FileTabsProps {
    fileBrowser: FileBrowserManager
    className?: string
}

export const FileTabs = observer(function FileTabs({ fileBrowser, className }: FileTabsProps) {
    const { openTabs, activeFile } = fileBrowser

    if (openTabs.length === 0) {
        return null
    }

    return (
        <div className={twMerge("flex items-stretch bg-base-200 border-b border-border overflow-x-auto", className)}>
            {openTabs.map((tab) => (
                <FileTab
                    key={tab.path}
                    path={tab.path}
                    name={tab.name}
                    active={activeFile === tab.path}
                    onSelect={() => fileBrowser.switchToTab(tab.path)}
                    onClose={() => fileBrowser.closeTab(tab.path)}
                />
            ))}
        </div>
    )
})
