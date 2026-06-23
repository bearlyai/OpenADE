import NiceModal from "@ebay/nice-modal-react"
import { FileText } from "lucide-react"
import { observer } from "mobx-react"
import { useCodeStore } from "../store/context"
import { CopyMarkdownModal } from "./CopyMarkdownModal"

interface CopyMarkdownButtonProps {
    taskId: string
}

export const CopyMarkdownButton = observer(({ taskId }: CopyMarkdownButtonProps) => {
    const codeStore = useCodeStore()
    const task = codeStore.tasks.getTask(taskId)
    const hasActionEvents = task?.events.some((event) => event.type === "action") ?? false

    if (!hasActionEvents) return null

    return (
        <button
            type="button"
            className="btn flex items-center gap-1 px-1.5 py-0.5 text-xs text-muted hover:bg-base-200 hover:text-base-content flex-shrink-0"
            onClick={() => void NiceModal.show(CopyMarkdownModal, { taskId })}
            title="Copy chat as Markdown"
            aria-label="Copy chat as Markdown"
        >
            <FileText size="0.85em" />
            <span>Markdown</span>
        </button>
    )
})
