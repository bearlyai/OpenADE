import type { ComponentProps, HTMLAttributes } from "react"
import { ImageDropOverlay } from "../components/ImageDropOverlay"
import { TaskScreen } from "./task/TaskScreen"

type DesktopTaskDragHandlers = Pick<HTMLAttributes<HTMLDivElement>, "onDragEnter" | "onDragOver" | "onDragLeave" | "onDrop">

export type DesktopTaskShellProps = ComponentProps<typeof TaskScreen> & {
    error: string | null
    notice: string | null
    isDragOver?: boolean
    dragHandlers?: DesktopTaskDragHandlers
}

export function DesktopTaskShell({ error, notice, isDragOver = false, dragHandlers, ...taskScreenProps }: DesktopTaskShellProps) {
    return (
        <div className="relative flex h-full min-h-0 w-full flex-col overflow-hidden" {...dragHandlers}>
            {isDragOver && <ImageDropOverlay />}
            {error && <div className="mx-3 mt-3 shrink-0 border border-error/30 bg-error/10 p-2 text-xs text-error">{error}</div>}
            {notice && <div className="mx-3 mt-3 shrink-0 border border-info/30 bg-info/10 p-2 text-xs text-info">{notice}</div>}
            <div className="min-h-0 flex-1 overflow-hidden">
                <TaskScreen {...taskScreenProps} />
            </div>
        </div>
    )
}
