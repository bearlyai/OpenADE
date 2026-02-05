/**
 * FilesTrayContent - Content panel for the files tray
 *
 * Shows TreeNavigator on the left and file viewer on the right.
 * Expands TreeNavigator to full width when searching.
 */

import { observer } from "mobx-react"
import { useCodeStore } from "../../store/context"
import { FileContentViewer } from "../FileContentViewer"
import { FileTabs } from "../FileTabs"
import { TreeNavigator } from "../TreeNavigator"

interface FilesTrayContentProps {
    taskId: string
    onClose: () => void
}

export const FilesTrayContent = observer(function FilesTrayContent({ taskId, onClose }: FilesTrayContentProps) {
    const codeStore = useCodeStore()
    const isSearching = codeStore.fileBrowser.isSearching

    return (
        <div className="flex h-full">
            <TreeNavigator className={isSearching ? "flex-1" : "w-64 flex-shrink-0 border-r border-border"} onEscapeClose={onClose} />
            {!isSearching && (
                <div className="flex-1 min-w-0 flex flex-col">
                    <FileTabs />
                    <FileContentViewer taskId={taskId} className="flex-1 min-h-0" />
                </div>
            )}
        </div>
    )
})
