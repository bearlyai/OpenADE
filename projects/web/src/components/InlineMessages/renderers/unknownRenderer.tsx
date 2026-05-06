import { CircleHelp } from "lucide-react"
import { FileViewer } from "../../FilesAndDiffs"
import type { GroupRenderer, UnknownGroup } from "../../events/messageGroups"

function stringifyRaw(value: unknown): string {
    try {
        const json = JSON.stringify(value, null, 2)
        return json ?? String(value)
    } catch {
        return String(value)
    }
}

function UnknownContent({ group }: { group: UnknownGroup }) {
    const contents = stringifyRaw(group.raw)

    return <FileViewer file={{ name: "unknown-event.json", contents, lang: "json" }} copyContent={contents} disableFileHeader commentHandlers={null} />
}

export const unknownRenderer: GroupRenderer<UnknownGroup> = {
    getLabel: (group) => group.label,
    getIcon: () => <CircleHelp size="0.85em" className="text-warning flex-shrink-0" />,
    getStatusIcon: () => null,
    getHeaderInfo: (group) => <span className="text-muted text-xs">{group.harnessId}</span>,
    renderContent: (group) => <UnknownContent group={group} />,
}
