import { FolderGit2 } from "lucide-react"
import { observer } from "mobx-react"
import type { SetupEnvironmentEvent } from "../../types"
import { FileViewer } from "../FilesAndDiffs"
import { type BaseEventItemProps, CollapsibleEvent } from "./shared"

interface SetupEventItemProps extends BaseEventItemProps {
    event: SetupEnvironmentEvent
}

export const SetupEventItem = observer(({ event, expanded, onToggle }: SetupEventItemProps) => {
    const icon = <FolderGit2 size="1em" className="flex-shrink-0 text-info-text" />

    return (
        <CollapsibleEvent icon={icon} label="Setup" event={event} expanded={expanded} onToggle={onToggle}>
            {event.setupOutput ? (
                <div className="border-t border-border">
                    <FileViewer
                        file={{
                            name: "setup.log",
                            contents: event.setupOutput,
                            lang: "bash",
                        }}
                        disableFileHeader
                        disableLineNumbers
                        commentHandlers={null}
                    />
                </div>
            ) : (
                <div className="px-3 py-4 text-muted text-sm text-center border-t border-border">Setting up worktree...</div>
            )}
        </CollapsibleEvent>
    )
})
