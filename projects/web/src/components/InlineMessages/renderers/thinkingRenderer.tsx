import { BrainCircuit } from "lucide-react"
import { FileViewer } from "../../FilesAndDiffs"
import type { CommentContext, GroupRenderer, ThinkingGroup } from "../../events/messageGroups"

export const thinkingRenderer: GroupRenderer<ThinkingGroup> = {
    getLabel: () => "Thinking",
    getIcon: () => <BrainCircuit size="0.85em" className="text-muted flex-shrink-0" />,
    getStatusIcon: () => null,
    getHeaderInfo: () => null,
    renderContent: (group, _ctx: CommentContext) => (
        <FileViewer file={{ name: "thinking.md", contents: group.text, lang: "markdown" }} disableFileHeader commentHandlers={null} />
    ),
}
