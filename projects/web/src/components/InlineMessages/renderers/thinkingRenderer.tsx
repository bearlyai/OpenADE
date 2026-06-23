import { BrainCircuit } from "lucide-react"
import { FileViewer } from "../../FilesAndDiffs"
import type { CommentContext, GroupRenderer, ThinkingGroup } from "../../events/messageGroups"

function formatThinkingTokens(tokens: number): string {
    const value = tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : `${tokens}`
    return `~${value} tokens`
}

export const thinkingRenderer: GroupRenderer<ThinkingGroup> = {
    getLabel: (group) => (typeof group.estimatedThinkingTokens === "number" ? `Thinking · ${formatThinkingTokens(group.estimatedThinkingTokens)}` : "Thinking"),
    getIcon: () => <BrainCircuit size="0.85em" className="text-muted flex-shrink-0" />,
    getStatusIcon: () => null,
    getHeaderInfo: () => null,
    renderContent: (group, _ctx: CommentContext) => (
        <FileViewer file={{ name: "thinking.md", contents: group.text, lang: "markdown" }} disableFileHeader commentHandlers={null} />
    ),
}
