/**
 * FilesTrayContent - Content panel for the files tray
 *
 * Shows TreeNavigator on the left and file viewer on the right.
 * Expands TreeNavigator to full width when searching.
 */

import { observer } from "mobx-react"
import type { FileBrowserManager } from "../../store/managers/FileBrowserManager"
import { FileContentViewer } from "../FileContentViewer"
import { FileTabs } from "../FileTabs"
import { TreeNavigator } from "../TreeNavigator"

interface FilesTrayContentProps {
    fileBrowser: FileBrowserManager
    taskId: string
    onClose: () => void
}

export const FilesTrayContent = observer(function FilesTrayContent({ fileBrowser, taskId, onClose }: FilesTrayContentProps) {
    const isSearching = fileBrowser.isSearching

    return (
        <div className="flex h-full">
            <TreeNavigator fileBrowser={fileBrowser} className={isSearching ? "flex-1" : "w-64 flex-shrink-0 border-r border-border"} onEscapeClose={onClose} />
            {!isSearching && (
                <div className="flex-1 min-w-0 flex flex-col">
                    <FileTabs fileBrowser={fileBrowser} />
                    <FileContentViewer fileBrowser={fileBrowser} taskId={taskId} className="flex-1 min-h-0" />
                </div>
            )}
        </div>
    )
})
