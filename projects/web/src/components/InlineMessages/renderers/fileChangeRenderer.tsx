import { AlertCircle, FileMinus, FilePlus, Pencil } from "lucide-react"
import { useMemo } from "react"
import { FileDiffViewer, FileViewer, parsePatchFiles } from "../../FilesAndDiffs"
import type { FileChangeGroup, GroupRenderer } from "../../events/messageGroups"
import { getFileName } from "../../utils/paths"

function FileChangeContent({ group }: { group: FileChangeGroup }) {
    const parsedDiff = useMemo(() => {
        if (!group.diff || group.isPending) return null
        try {
            const parsed = parsePatchFiles(group.diff, group.filePath)
            return parsed[0]?.files[0] ?? null
        } catch {
            return null
        }
    }, [group.diff, group.filePath, group.isPending])

    if (parsedDiff) {
        return <FileDiffViewer fileDiff={parsedDiff} diffStyle="unified" commentHandlers={null} />
    }

    const details = [`${group.status}: ${group.kind} ${group.filePath}`]
    if (group.diff) details.push("", group.diff)

    return (
        <FileViewer
            file={{ name: "file-change.txt", contents: details.join("\n"), lang: "text" }}
            disableFileHeader
            disableLineNumbers
            commentHandlers={null}
        />
    )
}

function getIcon(kind: string) {
    switch (kind) {
        case "add":
            return <FilePlus size="0.85em" className="text-success flex-shrink-0" />
        case "delete":
            return <FileMinus size="0.85em" className="text-error flex-shrink-0" />
        default:
            return <Pencil size="0.85em" className="text-primary flex-shrink-0" />
    }
}

function getKindLabel(kind: string): string {
    switch (kind) {
        case "add":
            return "Add"
        case "delete":
            return "Delete"
        case "update":
            return "Update"
        default:
            return kind ? kind[0].toUpperCase() + kind.slice(1) : "Change"
    }
}

export const fileChangeRenderer: GroupRenderer<FileChangeGroup> = {
    getLabel: (group) => `${getKindLabel(group.kind)} ${getFileName(group.filePath)}`,
    getIcon: (group) => getIcon(group.kind),
    getStatusIcon: (group) => {
        if (group.isError) return <AlertCircle size="1em" className="text-error flex-shrink-0" />
        return null
    },
    getHeaderInfo: (group) => <span className="text-muted text-xs">{group.kind}</span>,
    renderContent: (group) => <FileChangeContent group={group} />,
}
