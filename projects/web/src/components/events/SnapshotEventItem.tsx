import { Camera, Check, Copy, Download, Loader2 } from "lucide-react"
import { observer } from "mobx-react"
import { useEffect, useState } from "react"
import { useCodeStore } from "../../store/context"
import type { SnapshotEventModel } from "../../store/EventModel"
import type { SnapshotEvent } from "../../types"
import { ViewPatch } from "../ViewPatch"
import { type BaseEventItemProps, CollapsibleEvent } from "./shared"

interface SnapshotEventItemProps extends BaseEventItemProps {
    event: SnapshotEvent
    /** Task ID - required for comment support */
    taskId: string
}

export const SnapshotEventItem = observer(({ event, expanded, onToggle, taskId }: SnapshotEventItemProps) => {
    const store = useCodeStore()
    const taskModel = store.tasks.getTaskModel(taskId)
    const eventModel = taskModel?.events.find((e) => e.id === event.id) as SnapshotEventModel | undefined

    const { stats, referenceBranch, mergeBaseCommit } = event
    const hasChanges = stats.filesChanged > 0 || stats.insertions > 0 || stats.deletions > 0
    const [copied, setCopied] = useState(false)

    // Load patch from file when expanded (if stored externally)
    useEffect(() => {
        if (expanded && eventModel?.patchFileId && !eventModel.isPatchLoaded) {
            eventModel.loadPatch()
        }
    }, [expanded, eventModel])

    // Get patch from model (handles both inline and file-based patches)
    const fullPatch = eventModel?.fullPatch ?? event.fullPatch ?? ""
    const isLoading = eventModel?.isPatchLoading ?? false

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(fullPatch)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
        } catch (err) {
            console.error("Failed to copy patch:", err)
        }
    }

    const handleDownload = () => {
        const randomStr = Math.random().toString(36).substring(2, 8)
        const filename = `patch-${randomStr}.patch`
        const blob = new Blob([fullPatch], { type: "text/plain" })
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = filename
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
    }

    const icon = <Camera size="1em" className="flex-shrink-0 text-muted" />
    const shortCommit = mergeBaseCommit.slice(0, 8)

    const statsLabel = hasChanges
        ? `${stats.filesChanged} ${stats.filesChanged === 1 ? "file" : "files"}, +${stats.insertions} -${stats.deletions}`
        : "No changes"

    return (
        <CollapsibleEvent icon={icon} label="Snapshot" query={statsLabel} event={event} expanded={expanded} onToggle={onToggle}>
            <div className="border-t border-border">
                <div className="px-4 py-3 flex items-center gap-4 text-sm border-b border-border bg-base-200">
                    <span className="text-muted">
                        vs <span className="font-mono text-base-content">{referenceBranch}</span>
                        <span className="text-muted ml-1">({shortCommit})</span>
                    </span>
                    <span className="text-muted">
                        {stats.filesChanged} {stats.filesChanged === 1 ? "file" : "files"} changed
                    </span>
                    {stats.insertions > 0 && <span className="text-success">+{stats.insertions}</span>}
                    {stats.deletions > 0 && <span className="text-error">-{stats.deletions}</span>}
                    <div className="flex-1" />
                    {hasChanges && (
                        <>
                            <span className="text-muted text-xs">Git patch:</span>
                            <button
                                type="button"
                                onClick={handleDownload}
                                className="btn flex items-center gap-1.5 px-2 py-1 text-xs text-muted hover:bg-base-300 hover:text-base-content"
                                title="Download patch file"
                            >
                                <Download size="0.85em" />
                                Download
                            </button>
                            <button
                                type="button"
                                onClick={handleCopy}
                                className="btn flex items-center gap-1.5 px-2 py-1 text-xs text-muted hover:bg-base-300 hover:text-base-content"
                                title="Copy patch to clipboard"
                            >
                                {copied ? (
                                    <>
                                        <Check size="0.85em" className="text-success" />
                                        Copied
                                    </>
                                ) : (
                                    <>
                                        <Copy size="0.85em" />
                                        Copy
                                    </>
                                )}
                            </button>
                        </>
                    )}
                </div>
                {hasChanges ? (
                    isLoading ? (
                        <div className="px-4 py-6 text-muted text-sm text-center flex items-center justify-center gap-2">
                            <Loader2 size="1em" className="animate-spin" />
                            Loading patch...
                        </div>
                    ) : (
                        <ViewPatch patch={fullPatch} taskId={taskId} snapshotEventId={event.id} />
                    )
                ) : (
                    <div className="px-4 py-6 text-muted text-sm text-center">No changes from {referenceBranch}</div>
                )}
            </div>
        </CollapsibleEvent>
    )
})
