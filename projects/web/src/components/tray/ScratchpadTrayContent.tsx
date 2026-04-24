import cx from "classnames"
import { reaction } from "mobx"
import { Loader2, Plus, Trash2 } from "lucide-react"
import { observer } from "mobx-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { ScratchpadMeta } from "../../persistence/scratchpadStore"
import { useCodeStore } from "../../store/context"
import { SdkCapabilitiesManager } from "../../store/managers/SdkCapabilitiesManager"
import { SmartEditor, type SmartEditorRef } from "../SmartEditor"
import { ScrollArea } from "../ui/ScrollArea"

interface ScratchpadTrayContentProps {
    workspaceId: string
    repoPath: string | null
}

const PadEditor = observer(({ workspaceId, padId, repoPath }: { workspaceId: string; padId: string; repoPath: string | null }) => {
    const codeStore = useCodeStore()
    const editorRef = useRef<SmartEditorRef>(null)
    const sdkCapabilities = useMemo(() => new SdkCapabilitiesManager(), [])
    const [contentLoading, setContentLoading] = useState(true)

    useEffect(() => {
        setContentLoading(true)
        codeStore.scratchpads.loadContent(padId).then(() => setContentLoading(false))
    }, [padId, codeStore.scratchpads])

    const contentStore = codeStore.scratchpads.getContentStore(padId)

    const editorManager = useMemo(() => {
        const mgr = codeStore.smartEditors.getManager(`scratchpad-${padId}`, workspaceId)
        if (contentStore && !mgr.editorContent) {
            const data = contentStore.data.get()
            if (data.content) {
                mgr.setEditorContent(data.content)
                mgr.setValue(data.plainText)
            }
        }
        return mgr
    }, [padId, workspaceId, contentStore, codeStore.smartEditors])

    useEffect(() => {
        if (!contentStore) return
        const disposer = reaction(
            () => ({ value: editorManager.value, content: editorManager.editorContent }),
            ({ content, value }) => {
                codeStore.scratchpads.updateContent(workspaceId, padId, content, value)
            },
            { delay: 500 }
        )
        return disposer
    }, [padId, workspaceId, editorManager, contentStore, codeStore.scratchpads])

    useEffect(() => {
        if (contentLoading) return
        const timer = setTimeout(() => editorRef.current?.focus(), 100)
        return () => clearTimeout(timer)
    }, [contentLoading, padId])

    if (contentLoading) {
        return (
            <div className="flex-1 flex items-center justify-center text-muted">
                <Loader2 size={16} className="animate-spin" />
            </div>
        )
    }

    return (
        <SmartEditor
            key={padId}
            ref={editorRef}
            manager={editorManager}
            fileMentionsDir={repoPath}
            slashCommandsDir={null}
            sdkCapabilities={sdkCapabilities}
            placeholder="Write your thoughts... Use @ to reference files"
            className="h-full text-sm border-0 bg-transparent [&>div]:h-full [&>div]:border-0"
            editorClassName="h-full"
        />
    )
})

function NoteItem({ pad, isActive, onSelect, onDelete }: { pad: ScratchpadMeta; isActive: boolean; onSelect: () => void; onDelete: () => void }) {
    return (
        <div
            role="button"
            tabIndex={0}
            onClick={onSelect}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    onSelect()
                }
            }}
            className={cx(
                "group flex items-center gap-2 px-2 py-1.5 cursor-pointer transition-colors text-sm",
                isActive ? "bg-primary/10 text-primary" : "text-base-content hover:bg-base-200"
            )}
        >
            <span className="truncate flex-1">{pad.title || "Untitled"}</span>
            <button
                type="button"
                className="btn p-0.5 opacity-0 group-hover:opacity-100 text-muted hover:text-error transition-all flex-shrink-0"
                onClick={(e) => {
                    e.stopPropagation()
                    onDelete()
                }}
                title="Delete"
            >
                <Trash2 size={12} />
            </button>
        </div>
    )
}

const lastActivePadKey = (workspaceId: string) => `scratchpad:last-active:${workspaceId}`

export const ScratchpadTrayContent = observer(({ workspaceId, repoPath }: ScratchpadTrayContentProps) => {
    const codeStore = useCodeStore()
    const [indexLoading, setIndexLoading] = useState(true)
    const [activePadId, setActivePadIdState] = useState<string | null>(null)

    const setActivePadId = useCallback(
        (id: string | null) => {
            setActivePadIdState(id)
            if (id) localStorage.setItem(lastActivePadKey(workspaceId), id)
            else localStorage.removeItem(lastActivePadKey(workspaceId))
        },
        [workspaceId]
    )

    useEffect(() => {
        setIndexLoading(true)
        codeStore.scratchpads.ensureIndexLoaded(workspaceId).then(() => setIndexLoading(false))
    }, [workspaceId, codeStore.scratchpads])

    const pads = codeStore.scratchpads.getPads(workspaceId)

    useEffect(() => {
        if (indexLoading) return
        if (activePadId && pads.some((p) => p.id === activePadId)) return
        const remembered = localStorage.getItem(lastActivePadKey(workspaceId))
        if (remembered && pads.some((p) => p.id === remembered)) {
            setActivePadId(remembered)
            return
        }
        if (pads.length > 0) {
            setActivePadId(pads[0].id)
        } else {
            const id = codeStore.scratchpads.createPad(workspaceId, "My Notes")
            setActivePadId(id)
        }
    }, [indexLoading, pads, activePadId, workspaceId, codeStore.scratchpads, setActivePadId])

    const handleCreate = useCallback(() => {
        const id = codeStore.scratchpads.createPad(workspaceId)
        setActivePadId(id)
    }, [workspaceId, codeStore.scratchpads, setActivePadId])

    const handleDelete = useCallback(
        (id: string) => {
            codeStore.scratchpads.deletePad(workspaceId, id)
            codeStore.smartEditors.disposeManager(`scratchpad-${id}`, workspaceId)
            if (activePadId === id) {
                const remaining = pads.filter((p) => p.id !== id)
                setActivePadId(remaining.length > 0 ? remaining[0].id : null)
            }
        },
        [workspaceId, activePadId, pads, codeStore.scratchpads, codeStore.smartEditors, setActivePadId]
    )

    const activeMeta = activePadId ? codeStore.scratchpads.getPadMeta(workspaceId, activePadId) : undefined

    if (indexLoading) {
        return (
            <div className="flex items-center justify-center h-full text-muted">
                <Loader2 size={16} className="animate-spin" />
            </div>
        )
    }

    return (
        <div className="flex h-full">
            {/* Notes list */}
            <div className="w-44 flex-shrink-0 border-r border-border flex flex-col h-full">
                <div className="flex items-center justify-between px-2 py-2 border-b border-border">
                    <span className="text-xs text-muted font-medium">Notes</span>
                    <button type="button" onClick={handleCreate} className="btn p-0.5 text-muted hover:text-base-content transition-colors" title="New note">
                        <Plus size={14} />
                    </button>
                </div>
                <ScrollArea className="flex-1" viewportClassName="h-full">
                    {pads.map((pad) => (
                        <NoteItem
                            key={pad.id}
                            pad={pad}
                            isActive={pad.id === activePadId}
                            onSelect={() => setActivePadId(pad.id)}
                            onDelete={() => handleDelete(pad.id)}
                        />
                    ))}
                </ScrollArea>
            </div>

            {/* Editor */}
            <div className="flex-1 flex flex-col min-w-0 h-full">
                {activeMeta && activePadId ? (
                    <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
                        <PadEditor workspaceId={workspaceId} padId={activePadId} repoPath={repoPath} />
                    </div>
                ) : (
                    <div className="flex items-center justify-center h-full text-muted text-sm">No notes yet</div>
                )}
            </div>
        </div>
    )
})
