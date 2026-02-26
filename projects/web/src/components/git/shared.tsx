import { ArrowRight, Columns2, FileCode, FileImage, FileText, Minus, Pencil, Plus, Rows2 } from "lucide-react"
import { twMerge } from "tailwind-merge"
import type { ChangedFileInfo } from "../../electronAPI/git"

export type ViewMode = "split" | "unified" | "current"

export function ViewModeToggle({ value, onChange }: { value: ViewMode; onChange: (v: ViewMode) => void }) {
    const buttonClass = (mode: ViewMode) =>
        twMerge(
            "btn flex items-center justify-center w-8 h-8 text-xs font-medium transition-colors",
            value === mode ? "bg-base-300 text-base-content" : "text-muted hover:text-base-content"
        )

    return (
        <div className="flex items-center border border-border">
            <button type="button" onClick={() => onChange("split")} className={buttonClass("split")} title="Split view">
                <Columns2 size={14} />
            </button>
            <button type="button" onClick={() => onChange("unified")} className={buttonClass("unified")} title="Unified view">
                <Rows2 size={14} />
            </button>
            <button type="button" onClick={() => onChange("current")} className={buttonClass("current")} title="Current file">
                <FileText size={14} />
            </button>
        </div>
    )
}

export function StatusIcon({ status }: { status: ChangedFileInfo["status"] }) {
    switch (status) {
        case "added":
            return <Plus size="1em" className="text-success" />
        case "deleted":
            return <Minus size="1em" className="text-error" />
        case "renamed":
            return <ArrowRight size="1em" className="text-warning" />
        default:
            return <Pencil size="1em" className="text-primary" />
    }
}

interface FileListItemProps {
    file: ChangedFileInfo
    displayPath?: string
    displayOldPath?: string
    selected: boolean
    onSelect: () => void
}

export function FileListItem({ file, displayPath, displayOldPath, selected, onSelect }: FileListItemProps) {
    const FileIcon = file.binary ? FileImage : FileCode
    const shownPath = displayPath ?? file.path
    const shownOldPath = file.oldPath ? (displayOldPath ?? file.oldPath) : null

    return (
        <button
            type="button"
            onClick={onSelect}
            className={twMerge(
                "btn px-2 py-1 flex items-center gap-1.5 text-xs whitespace-nowrap transition-colors",
                selected ? "bg-primary/10 text-base-content" : "text-muted hover:text-base-content hover:bg-base-200"
            )}
            title={file.oldPath ? `${file.oldPath} -> ${file.path}` : file.path}
        >
            <StatusIcon status={file.status} />
            <FileIcon size={13} className="flex-shrink-0 text-muted" />
            {shownOldPath ? (
                <span className="truncate max-w-[24rem]">
                    <span className="text-muted">{shownOldPath}</span>
                    <ArrowRight size="1em" className="inline mx-1" />
                    {shownPath}
                </span>
            ) : (
                <span className="truncate max-w-[24rem]">{shownPath}</span>
            )}
        </button>
    )
}
