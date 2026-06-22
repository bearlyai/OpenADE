import { autoUpdate, flip, offset, shift, useFloating } from "@floating-ui/react-dom"
import Document from "@tiptap/extension-document"
import HardBreak from "@tiptap/extension-hard-break"
import History from "@tiptap/extension-history"
import Mention from "@tiptap/extension-mention"
import Paragraph from "@tiptap/extension-paragraph"
import Placeholder from "@tiptap/extension-placeholder"
import Text from "@tiptap/extension-text"
import { EditorContent, Extension, NodeViewWrapper, ReactNodeViewRenderer, useEditor } from "@tiptap/react"
import type { Editor, NodeViewProps } from "@tiptap/react"
import Suggestion from "@tiptap/suggestion"
import type { SuggestionKeyDownProps, SuggestionProps } from "@tiptap/suggestion"
import { ChevronRight, FileText, Folder, Terminal, Zap } from "lucide-react"
import { observer } from "mobx-react"
import type React from "react"
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { twMerge } from "tailwind-merge"
import { usePortalContainer } from "../hooks/usePortalContainer"
import type { ImageAttachment } from "../types"
import { type PersistImage, processImageBlob } from "../utils/imageAttachment"
import { emitEmptyEditorGlobalShortcut, isEmptyEditorGlobalShortcut } from "../utils/keyboardShortcuts"

export interface SlashCommandEntry {
    name: string
    type: "slash_command" | "skill"
}

export interface SmartEditorFileTreeChild {
    name: string
    isDir: boolean
    fullPath: string
}

export interface SmartEditorFileTreeMatch {
    path: string
    children: SmartEditorFileTreeChild[]
}

export interface SmartEditorFileSearchResult {
    results: string[]
    treeMatch: SmartEditorFileTreeMatch | null
}

export interface SmartEditorManagerContract {
    value: string
    files: string[]
    editorContent: Record<string, unknown> | null
    pendingImages: ImageAttachment[]
    setValue(value: string): void
    setFiles(files: string[]): void
    setEditorContent(content: Record<string, unknown> | null): void
    setTextContent(text: string): void
    clear(): void
    addImage(image: ImageAttachment, dataUrl: string): void
    insertFile(path: string): void
    canSearchFileMentions(dir: string): boolean
    getFileMentionFavorites(limit?: number): string[]
    searchFileMentions(dir: string, query: string, limit?: number): Promise<SmartEditorFileSearchResult>
    registerInsertCallback(cb: (path: string) => void): void
    unregisterInsertCallback(): void
    registerClearCallback(cb: () => void): void
    unregisterClearCallback(): void
    registerSetContentCallback(cb: (content: string | Record<string, unknown> | null) => void): void
    unregisterSetContentCallback(): void
}

export interface SmartEditorSdkCapabilitiesContract {
    slashCommands: string[]
    skills: string[]
    allCommands: SlashCommandEntry[]
    loadCapabilities(cwd: string): Promise<void>
}

interface SmartEditorProps {
    /** Required: manager instance for state management */
    manager: SmartEditorManagerContract
    placeholder?: string
    ariaLabel?: string
    disabled?: boolean
    className?: string
    editorClassName?: string
    onKeyDown?: (e: React.KeyboardEvent) => void
    allowGlobalShortcutsWhenEmpty?: boolean
    /** Directory for @file mention autocomplete, null to disable */
    fileMentionsDir: string | null
    /** Final capability gate for @file mention autocomplete. */
    enableFileMentions?: boolean
    /** Directory for /slash command autocomplete, null to disable */
    slashCommandsDir: string | null
    /** Lazy directory resolver for runtime/Core sessions where task open intentionally does not load environment. */
    resolveWorkingDir?: () => Promise<string | null>
    /** SDK capabilities manager for slash command discovery */
    sdkCapabilities?: SmartEditorSdkCapabilitiesContract
    /** Lazy SDK capabilities resolver for task routes that should not touch host capability reads on first paint. */
    resolveSdkCapabilities?: () => SmartEditorSdkCapabilitiesContract | undefined
    persistImage?: PersistImage
    enableImagePasteDrop?: boolean
}

export interface SmartEditorRef {
    focus: () => void
    focusEnd: () => void
    blur: () => void
    clear: () => void
}

function FileMentionChip({ node }: NodeViewProps) {
    return (
        <NodeViewWrapper as="span" className="bg-primary/10 text-primary text-sm px-1.5 py-0.5 inline-flex items-center gap-1">
            <FileText size="0.875em" />
            {node.attrs.id}
        </NodeViewWrapper>
    )
}

interface SuggestionItem {
    type: "file" | "dir"
    name: string
    fullPath: string
}

interface SuggestionListProps {
    items: SuggestionItem[]
    treeMatch: SmartEditorFileTreeMatch | null
    selectedIndex: number
    onSelectIndex: (index: number) => void
    onSelectItem: (index: number) => void
}

function SuggestionList({ items, treeMatch, selectedIndex, onSelectIndex, onSelectItem }: SuggestionListProps) {
    const itemRefs = useRef<Map<number, HTMLButtonElement>>(new Map())

    const displayItems: SuggestionItem[] = treeMatch
        ? treeMatch.children.map((child) => ({
              type: child.isDir ? ("dir" as const) : ("file" as const),
              name: child.name,
              fullPath: child.fullPath,
          }))
        : items

    useEffect(() => {
        const el = itemRefs.current.get(selectedIndex)
        el?.scrollIntoView({ block: "nearest" })
    }, [selectedIndex])

    if (displayItems.length === 0) {
        return (
            <div className="min-w-64">
                <div className="text-sm text-muted">No files found</div>
            </div>
        )
    }

    return (
        <div className="min-w-64 max-h-64 overflow-y-auto -m-3">
            {treeMatch?.path && (
                <div className="px-3 py-1.5 text-xs border-b border-border flex items-center gap-1 text-muted bg-base-300">
                    <Folder size="1em" />
                    <span>{treeMatch.path}/</span>
                </div>
            )}
            {displayItems.map((item, index) => (
                <button
                    key={item.fullPath}
                    ref={(el) => {
                        if (el) itemRefs.current.set(index, el)
                        else itemRefs.current.delete(index)
                    }}
                    type="button"
                    className={twMerge(
                        "btn w-full flex items-center gap-2 px-3 py-2 text-sm text-left cursor-pointer",
                        index === selectedIndex ? "bg-primary text-primary-content" : "text-base-content hover:bg-base-300"
                    )}
                    onClick={() => onSelectItem(index)}
                    onMouseEnter={() => onSelectIndex(index)}
                >
                    {item.type === "dir" ? (
                        <Folder size="1em" className={twMerge("flex-shrink-0", index === selectedIndex ? "text-primary-content/70" : "text-muted")} />
                    ) : (
                        <FileText size="1em" className={twMerge("flex-shrink-0", index === selectedIndex ? "text-primary-content/70" : "text-muted")} />
                    )}
                    <span className="truncate flex-1">{treeMatch ? item.name : item.fullPath}</span>
                    {item.type === "dir" && (
                        <ChevronRight size="1em" className={twMerge("flex-shrink-0", index === selectedIndex ? "text-primary-content/70" : "text-muted")} />
                    )}
                </button>
            ))}
        </div>
    )
}

// ============================================================================
// Slash Command Suggestion List
// ============================================================================

interface SlashSuggestionListProps {
    items: SlashCommandEntry[]
    selectedIndex: number
    onSelectIndex: (index: number) => void
    onSelectItem: (index: number) => void
}

function SlashSuggestionList({ items, selectedIndex, onSelectIndex, onSelectItem }: SlashSuggestionListProps) {
    const itemRefs = useRef<Map<number, HTMLButtonElement>>(new Map())

    useEffect(() => {
        const el = itemRefs.current.get(selectedIndex)
        el?.scrollIntoView({ block: "nearest" })
    }, [selectedIndex])

    if (items.length === 0) {
        return (
            <div className="min-w-64">
                <div className="text-sm text-muted">No matching commands</div>
            </div>
        )
    }

    return (
        <div className="min-w-72 max-h-64 overflow-y-auto -m-3">
            {items.map((cmd, index) => {
                const Icon = cmd.type === "skill" ? Zap : Terminal
                return (
                    <button
                        key={cmd.name}
                        ref={(el) => {
                            if (el) itemRefs.current.set(index, el)
                            else itemRefs.current.delete(index)
                        }}
                        type="button"
                        className={twMerge(
                            "btn w-full flex items-center gap-2 px-3 py-2 text-sm text-left cursor-pointer",
                            index === selectedIndex ? "bg-primary text-primary-content" : "text-base-content hover:bg-base-300"
                        )}
                        onClick={() => onSelectItem(index)}
                        onMouseEnter={() => onSelectIndex(index)}
                    >
                        <Icon size="1em" className={twMerge("flex-shrink-0", index === selectedIndex ? "text-primary-content/70" : "text-muted")} />
                        <span className="truncate flex-1">/{cmd.name}</span>
                    </button>
                )
            })}
        </div>
    )
}

// ============================================================================
// Helpers
// ============================================================================

function getPlainTextWithMentions(editor: Editor): string {
    let result = ""
    editor.state.doc.descendants((node) => {
        if (node.type.name === "text") {
            result += node.text
        } else if (node.type.name === "mention") {
            result += `@${node.attrs.id}`
        } else if (node.type.name === "hardBreak") {
            result += "\n"
        } else if (node.type.name === "paragraph") {
            if (result.length > 0 && !result.endsWith("\n")) {
                result += "\n"
            }
        }
    })
    return result.trim()
}

function extractFilesFromEditor(editor: Editor): string[] {
    const files: string[] = []
    editor.state.doc.descendants((node) => {
        if (node.type.name === "mention") {
            files.push(node.attrs.id)
        }
    })
    return files
}

// ============================================================================
// Suggestion popup state types
// ============================================================================

interface FileSuggestionPopupState {
    open: boolean
    items: SuggestionItem[]
    treeMatch: SmartEditorFileTreeMatch | null
    selectedIndex: number
    anchorRect: DOMRect | null
}

interface SlashSuggestionPopupState {
    open: boolean
    items: SlashCommandEntry[]
    query: string
    selectedIndex: number
    anchorRect: DOMRect | null
}

interface PendingFileSearchRequest {
    dir: string
    query: string
    requestId: number
}

function filterSlashCommands(commands: SlashCommandEntry[], query: string): SlashCommandEntry[] {
    const lower = query.toLowerCase()
    return commands.filter((cmd) => cmd.name.toLowerCase().includes(lower))
}

function getMentionFileName(path: string): string {
    const parts = path.split(/[/\\]/).filter(Boolean)
    return parts[parts.length - 1] ?? path
}

// ============================================================================
// SmartEditor
// ============================================================================

export const SmartEditor = observer(
    forwardRef<SmartEditorRef, SmartEditorProps>(
        (
            {
                manager,
                placeholder,
                ariaLabel,
                disabled,
                className,
                editorClassName,
                onKeyDown,
                allowGlobalShortcutsWhenEmpty,
                fileMentionsDir,
                enableFileMentions = true,
                slashCommandsDir,
                resolveWorkingDir,
                sdkCapabilities,
                resolveSdkCapabilities,
                persistImage,
                enableImagePasteDrop = true,
            },
            ref
        ) => {
            const portalContainer = usePortalContainer()
            const [resolvedWorkingDir, setResolvedWorkingDir] = useState<string | null>(null)
            const [resolvedSdkCapabilities, setResolvedSdkCapabilities] = useState<SmartEditorSdkCapabilitiesContract | undefined>(sdkCapabilities)
            const workingDirResolveInFlightRef = useRef<Promise<string | null> | null>(null)

            useEffect(() => {
                setResolvedSdkCapabilities(sdkCapabilities)
            }, [sdkCapabilities])

            // --- File mention suggestion state (@ trigger) ---
            const [fileSuggestion, setFileSuggestion] = useState<FileSuggestionPopupState>({
                open: false,
                items: [],
                treeMatch: null,
                selectedIndex: 0,
                anchorRect: null,
            })

            // --- Slash command suggestion state (/ trigger) ---
            const [slashSuggestion, setSlashSuggestion] = useState<SlashSuggestionPopupState>({
                open: false,
                items: [],
                query: "",
                selectedIndex: 0,
                anchorRect: null,
            })

            // Determine if features should be enabled
            const effectiveFileMentionsDir = fileMentionsDir ?? resolvedWorkingDir
            const effectiveSlashCommandsDir = slashCommandsDir ?? resolvedWorkingDir
            const canResolveWorkingDir = resolveWorkingDir !== undefined
            const activeSdkCapabilities = sdkCapabilities ?? resolvedSdkCapabilities
            const mentionsEnabled =
                enableFileMentions &&
                ((effectiveFileMentionsDir !== null && manager.canSearchFileMentions(effectiveFileMentionsDir)) ||
                    (effectiveFileMentionsDir === null && canResolveWorkingDir))
            const slashEnabled =
                (activeSdkCapabilities !== undefined || resolveSdkCapabilities !== undefined) && (effectiveSlashCommandsDir !== null || canResolveWorkingDir)

            const resolveEditorWorkingDir = useCallback(async (): Promise<string | null> => {
                const current = fileMentionsDir ?? slashCommandsDir ?? resolvedWorkingDir
                if (current) return current
                if (!resolveWorkingDir) return null
                if (workingDirResolveInFlightRef.current) return workingDirResolveInFlightRef.current
                const pending = resolveWorkingDir()
                    .then((resolved) => {
                        const next = resolved ?? null
                        if (next) setResolvedWorkingDir(next)
                        return next
                    })
                    .finally(() => {
                        if (workingDirResolveInFlightRef.current === pending) {
                            workingDirResolveInFlightRef.current = null
                        }
                    })
                workingDirResolveInFlightRef.current = pending
                return pending
            }, [fileMentionsDir, slashCommandsDir, resolvedWorkingDir, resolveWorkingDir])

            const slashCommands = useMemo(
                () => (slashEnabled && activeSdkCapabilities ? activeSdkCapabilities.allCommands : []),
                [slashEnabled, activeSdkCapabilities?.skills, activeSdkCapabilities?.slashCommands]
            )

            // --- File mention floating ---
            const { refs: fileRefs, floatingStyles: fileFloatingStyles } = useFloating({
                open: fileSuggestion.open,
                placement: "bottom-start",
                middleware: [offset(8), flip(), shift({ padding: 8 })],
                whileElementsMounted: autoUpdate,
            })

            useEffect(() => {
                if (fileSuggestion.anchorRect) {
                    fileRefs.setReference({
                        getBoundingClientRect: () => fileSuggestion.anchorRect as DOMRect,
                    })
                }
            }, [fileSuggestion.anchorRect, fileRefs])

            // --- Slash command floating ---
            const { refs: slashRefs, floatingStyles: slashFloatingStyles } = useFloating({
                open: slashSuggestion.open,
                placement: "top-start",
                middleware: [offset(8), flip(), shift({ padding: 8 })],
                whileElementsMounted: autoUpdate,
            })

            useEffect(() => {
                if (slashSuggestion.anchorRect) {
                    slashRefs.setReference({
                        getBoundingClientRect: () => slashSuggestion.anchorRect as DOMRect,
                    })
                }
            }, [slashSuggestion.anchorRect, slashRefs])

            // --- File mention logic ---
            const fileSuggestionPropsRef = useRef<SuggestionProps<string> | null>(null)
            const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
            const lastQueryRef = useRef<string>("")
            const searchRequestIdRef = useRef(0)
            const fileSearchInFlightRef = useRef(false)
            const queuedFileSearchRef = useRef<PendingFileSearchRequest | null>(null)
            const runFileSearchRef = useRef<((request: PendingFileSearchRequest) => Promise<void>) | null>(null)

            const runFileSearch = useCallback(
                async (request: PendingFileSearchRequest) => {
                    if (fileSearchInFlightRef.current) {
                        queuedFileSearchRef.current = request
                        return
                    }

                    fileSearchInFlightRef.current = true
                    try {
                        const result = await manager.searchFileMentions(request.dir, request.query, 20)
                        if (request.requestId === searchRequestIdRef.current && request.query === lastQueryRef.current) {
                            const items = result.results.map((path) => ({
                                type: "file" as const,
                                name: getMentionFileName(path),
                                fullPath: path,
                            }))
                            setFileSuggestion((prev) => ({
                                ...prev,
                                items,
                                treeMatch: result.treeMatch || null,
                                selectedIndex: 0,
                            }))
                        }
                    } catch (err) {
                        console.error("[SmartEditor] Search failed:", err)
                        if (request.requestId === searchRequestIdRef.current && request.query === lastQueryRef.current) {
                            setFileSuggestion((prev) => ({
                                ...prev,
                                items: [],
                                treeMatch: null,
                            }))
                        }
                    } finally {
                        fileSearchInFlightRef.current = false
                        const queued = queuedFileSearchRef.current
                        queuedFileSearchRef.current = null
                        if (queued && queued.requestId === searchRequestIdRef.current && queued.query === lastQueryRef.current) {
                            void runFileSearchRef.current?.(queued)
                        }
                    }
                },
                [manager]
            )

            useEffect(() => {
                runFileSearchRef.current = runFileSearch
                return () => {
                    if (runFileSearchRef.current === runFileSearch) {
                        runFileSearchRef.current = null
                    }
                }
            }, [runFileSearch])

            const handleFileSearch = useCallback(
                async (query: string) => {
                    const normalizedQuery = query.trim()
                    searchRequestIdRef.current += 1
                    const requestId = searchRequestIdRef.current
                    lastQueryRef.current = normalizedQuery
                    queuedFileSearchRef.current = null
                    if (searchTimeoutRef.current) {
                        clearTimeout(searchTimeoutRef.current)
                        searchTimeoutRef.current = null
                    }

                    if (normalizedQuery === "") {
                        const items = manager.getFileMentionFavorites(20).map((path) => ({
                            type: "file" as const,
                            name: getMentionFileName(path),
                            fullPath: path,
                        }))
                        setFileSuggestion((prev) => ({
                            ...prev,
                            items,
                            treeMatch: null,
                            selectedIndex: 0,
                        }))
                        return
                    }

                    const dir = effectiveFileMentionsDir ?? (await resolveEditorWorkingDir())
                    if (requestId !== searchRequestIdRef.current) return
                    if (!dir || !manager.canSearchFileMentions(dir)) return

                    searchTimeoutRef.current = setTimeout(async () => {
                        if (requestId !== searchRequestIdRef.current || normalizedQuery !== lastQueryRef.current) return
                        void runFileSearch({ dir, query: normalizedQuery, requestId })
                    }, 150)
                },
                [effectiveFileMentionsDir, manager, resolveEditorWorkingDir, runFileSearch]
            )

            useEffect(() => {
                return () => {
                    searchRequestIdRef.current += 1
                    queuedFileSearchRef.current = null
                    if (searchTimeoutRef.current) {
                        clearTimeout(searchTimeoutRef.current)
                        searchTimeoutRef.current = null
                    }
                }
            }, [])

            const fileDisplayItems: SuggestionItem[] = fileSuggestion.treeMatch
                ? fileSuggestion.treeMatch.children.map((child) => ({
                      type: child.isDir ? ("dir" as const) : ("file" as const),
                      name: child.name,
                      fullPath: child.fullPath,
                  }))
                : fileSuggestion.items

            const handleFileSelectItem = useCallback(
                (index: number) => {
                    const item = fileDisplayItems[index]
                    if (!item) return

                    const props = fileSuggestionPropsRef.current
                    if (!props) return

                    if (item.type === "dir") {
                        const { editor: e, range } = props
                        e.chain().focus().deleteRange(range).insertContent(`@${item.fullPath}`).run()
                    } else {
                        const { editor: e, range } = props
                        e.chain().focus().deleteRange(range).run()
                        manager.insertFile(item.fullPath)
                    }
                },
                [fileDisplayItems, manager]
            )

            const handleFileKeyDown = useCallback(
                (event: KeyboardEvent): boolean => {
                    if (event.key === "Escape") {
                        return true
                    }
                    if (event.key === "ArrowUp") {
                        setFileSuggestion((prev) => ({
                            ...prev,
                            selectedIndex: (prev.selectedIndex + fileDisplayItems.length - 1) % Math.max(fileDisplayItems.length, 1),
                        }))
                        return true
                    }
                    if (event.key === "ArrowDown") {
                        setFileSuggestion((prev) => ({
                            ...prev,
                            selectedIndex: (prev.selectedIndex + 1) % Math.max(fileDisplayItems.length, 1),
                        }))
                        return true
                    }
                    if (event.key === "Enter") {
                        handleFileSelectItem(fileSuggestion.selectedIndex)
                        return true
                    }
                    return false
                },
                [fileDisplayItems, handleFileSelectItem, fileSuggestion.selectedIndex]
            )

            const fileKeyDownRef = useRef(handleFileKeyDown)
            useEffect(() => {
                fileKeyDownRef.current = handleFileKeyDown
            }, [handleFileKeyDown])

            // --- Slash command logic ---
            const slashSuggestionPropsRef = useRef<SuggestionProps<SlashCommandEntry> | null>(null)

            // Keep a ref to the latest slashCommands so the suggestion plugin can access it
            const slashCommandsRef = useRef(slashCommands)
            useEffect(() => {
                slashCommandsRef.current = slashCommands
            }, [slashCommands])

            const ensureSlashCapabilities = useCallback(() => {
                let capabilities = activeSdkCapabilities
                if (!capabilities && resolveSdkCapabilities) {
                    capabilities = resolveSdkCapabilities()
                    if (capabilities) setResolvedSdkCapabilities(capabilities)
                }
                if (!capabilities) return
                const dir = effectiveSlashCommandsDir
                if (dir) {
                    void capabilities.loadCapabilities(dir)
                    return
                }
                void resolveEditorWorkingDir().then((resolvedDir) => {
                    if (resolvedDir) void capabilities.loadCapabilities(resolvedDir)
                })
            }, [activeSdkCapabilities, effectiveSlashCommandsDir, resolveEditorWorkingDir, resolveSdkCapabilities])

            useEffect(() => {
                if (!slashSuggestion.open) return
                setSlashSuggestion((prev) => {
                    const items = filterSlashCommands(slashCommands, prev.query)
                    return {
                        ...prev,
                        items,
                        selectedIndex: Math.min(prev.selectedIndex, Math.max(items.length - 1, 0)),
                    }
                })
            }, [slashCommands, slashSuggestion.open])

            const handleSlashSelectItem = useCallback(
                (index: number) => {
                    const item = slashSuggestion.items[index]
                    if (!item) return

                    const props = slashSuggestionPropsRef.current
                    if (!props) return

                    // Replace the /query with /<command> (as plain text, not a mention node)
                    const { editor: e, range } = props
                    e.chain().focus().deleteRange(range).insertContent(`/${item.name} `).run()
                },
                [slashSuggestion.items]
            )

            const handleSlashKeyDown = useCallback(
                (event: KeyboardEvent): boolean => {
                    if (event.key === "Escape") {
                        return true
                    }
                    if (event.key === "ArrowUp") {
                        setSlashSuggestion((prev) => ({
                            ...prev,
                            selectedIndex: (prev.selectedIndex + prev.items.length - 1) % Math.max(prev.items.length, 1),
                        }))
                        return true
                    }
                    if (event.key === "ArrowDown") {
                        setSlashSuggestion((prev) => ({
                            ...prev,
                            selectedIndex: (prev.selectedIndex + 1) % Math.max(prev.items.length, 1),
                        }))
                        return true
                    }
                    if (event.key === "Enter" || event.key === "Tab") {
                        handleSlashSelectItem(slashSuggestion.selectedIndex)
                        return true
                    }
                    return false
                },
                [handleSlashSelectItem, slashSuggestion.selectedIndex]
            )

            const slashKeyDownRef = useRef(handleSlashKeyDown)
            useEffect(() => {
                slashKeyDownRef.current = handleSlashKeyDown
            }, [handleSlashKeyDown])

            // --- Build extensions ---
            const extensions = useMemo(() => {
                const baseExtensions = [
                    Document,
                    Paragraph,
                    Text,
                    HardBreak,
                    History,
                    Placeholder.configure({
                        placeholder: placeholder ?? "What would you like to do?",
                    }),
                ]

                if (mentionsEnabled) {
                    baseExtensions.push(
                        Mention.extend({
                            addNodeView() {
                                return ReactNodeViewRenderer(FileMentionChip)
                            },
                        }).configure({
                            HTMLAttributes: {
                                class: "file-mention",
                            },
                            suggestion: {
                                char: "@",
                                items: ({ query }: { query: string }) => {
                                    handleFileSearch(query)
                                    return []
                                },
                                render: () => ({
                                    onStart: (props: SuggestionProps<string>) => {
                                        fileSuggestionPropsRef.current = props
                                        const rect = props.clientRect?.()
                                        setFileSuggestion((prev) => ({
                                            ...prev,
                                            open: true,
                                            selectedIndex: 0,
                                            anchorRect: rect ?? null,
                                        }))
                                    },
                                    onUpdate: (props: SuggestionProps<string>) => {
                                        fileSuggestionPropsRef.current = props
                                        const rect = props.clientRect?.()
                                        if (rect) {
                                            setFileSuggestion((prev) => ({
                                                ...prev,
                                                anchorRect: rect,
                                            }))
                                        }
                                    },
                                    onKeyDown: (props: SuggestionKeyDownProps) => {
                                        return fileKeyDownRef.current(props.event)
                                    },
                                    onExit: () => {
                                        fileSuggestionPropsRef.current = null
                                        setFileSuggestion({
                                            open: false,
                                            items: [],
                                            treeMatch: null,
                                            selectedIndex: 0,
                                            anchorRect: null,
                                        })
                                    },
                                }),
                            },
                        })
                    )
                }

                // Slash command suggestion (/ trigger)
                if (slashEnabled) {
                    baseExtensions.push(
                        Extension.create({
                            name: "slashCommand",
                            addProseMirrorPlugins() {
                                return [
                                    Suggestion({
                                        editor: this.editor,
                                        char: "/",
                                        startOfLine: true,
                                        items: ({ query }) => {
                                            const commands = slashCommandsRef.current ?? []
                                            return filterSlashCommands(commands, query)
                                        },
                                        command: ({ editor: e, range, props: item }) => {
                                            const cmd = item as unknown as SlashCommandEntry
                                            e.chain().focus().deleteRange(range).insertContent(`/${cmd.name} `).run()
                                        },
                                        render: () => ({
                                            onStart: (props: SuggestionProps<SlashCommandEntry>) => {
                                                ensureSlashCapabilities()
                                                slashSuggestionPropsRef.current = props
                                                const rect = props.clientRect?.()
                                                setSlashSuggestion({
                                                    open: true,
                                                    items: props.items,
                                                    query: props.query,
                                                    selectedIndex: 0,
                                                    anchorRect: rect ?? null,
                                                })
                                            },
                                            onUpdate: (props: SuggestionProps<SlashCommandEntry>) => {
                                                ensureSlashCapabilities()
                                                slashSuggestionPropsRef.current = props
                                                const rect = props.clientRect?.()
                                                setSlashSuggestion((prev) => ({
                                                    ...prev,
                                                    items: props.items,
                                                    query: props.query,
                                                    selectedIndex: 0,
                                                    anchorRect: rect ?? prev.anchorRect,
                                                }))
                                            },
                                            onKeyDown: (props: SuggestionKeyDownProps) => {
                                                return slashKeyDownRef.current(props.event)
                                            },
                                            onExit: () => {
                                                slashSuggestionPropsRef.current = null
                                                setSlashSuggestion({
                                                    open: false,
                                                    items: [],
                                                    query: "",
                                                    selectedIndex: 0,
                                                    anchorRect: null,
                                                })
                                            },
                                        }),
                                    }),
                                ]
                            },
                        })
                    )
                }

                return baseExtensions
            }, [mentionsEnabled, slashEnabled, placeholder, handleFileSearch, ensureSlashCapabilities])

            const editor = useEditor(
                {
                    extensions,
                    // Use stored JSON content if available, otherwise empty
                    content: manager.editorContent ?? undefined,
                    editable: !disabled,
                    onUpdate: ({ editor: e }) => {
                        const text = getPlainTextWithMentions(e)
                        const files = extractFilesFromEditor(e)
                        const json = e.getJSON()
                        manager.setValue(text)
                        manager.setFiles(files)
                        manager.setEditorContent(json)
                    },
                    editorProps: {
                        attributes: {
                            class: "outline-none h-full",
                            ...(ariaLabel ? { "aria-label": ariaLabel } : {}),
                        },
                        handleDrop: (_view, event) => {
                            if (!enableImagePasteDrop) return false
                            const files = event.dataTransfer?.files
                            if (files) {
                                for (const file of Array.from(files)) {
                                    if (file.type.startsWith("image/")) {
                                        event.preventDefault()
                                        processImageBlob(file, { persistImage })
                                            .then(({ attachment, dataUrl }) => manager.addImage(attachment, dataUrl))
                                            .catch((err) => console.error("[SmartEditor] Failed to process dropped image:", err))
                                        return true
                                    }
                                }
                            }
                            return false
                        },
                        handlePaste: (_view, event) => {
                            if (!enableImagePasteDrop) return false
                            const items = event.clipboardData?.items
                            if (items) {
                                for (const item of Array.from(items)) {
                                    if (item.type.startsWith("image/")) {
                                        const file = item.getAsFile()
                                        if (file) {
                                            event.preventDefault()
                                            processImageBlob(file, { persistImage })
                                                .then(({ attachment, dataUrl }) => manager.addImage(attachment, dataUrl))
                                                .catch((err) => console.error("[SmartEditor] Failed to process pasted image:", err))
                                            return true
                                        }
                                    }
                                }
                            }
                            // Let TipTap handle text paste natively
                            return false
                        },
                        handleKeyDown: (_view, event) => {
                            if (
                                !event.defaultPrevented &&
                                allowGlobalShortcutsWhenEmpty &&
                                manager.pendingImages.length === 0 &&
                                getPlainTextWithMentions(editor).length === 0 &&
                                isEmptyEditorGlobalShortcut(event)
                            ) {
                                event.preventDefault()
                                emitEmptyEditorGlobalShortcut(event)
                                return true
                            }

                            if (onKeyDown) {
                                const syntheticEvent = {
                                    key: event.key,
                                    metaKey: event.metaKey,
                                    ctrlKey: event.ctrlKey,
                                    shiftKey: event.shiftKey,
                                    altKey: event.altKey,
                                    preventDefault: () => event.preventDefault(),
                                    stopPropagation: () => event.stopPropagation(),
                                } as React.KeyboardEvent
                                onKeyDown(syntheticEvent)
                                if (event.defaultPrevented) return true
                            }
                            return false
                        },
                    },
                },
                [ariaLabel, enableImagePasteDrop, extensions, manager, persistImage]
            )

            useEffect(() => {
                if (editor) {
                    editor.setEditable(!disabled)
                }
            }, [editor, disabled])

            // Register insert callback with manager so external UI can insert files
            useEffect(() => {
                if (!editor) return

                const insertFile = (path: string) => {
                    editor
                        .chain()
                        .focus()
                        .insertContent([
                            { type: "mention", attrs: { id: path } },
                            { type: "text", text: " " },
                        ])
                        .run()
                }

                manager.registerInsertCallback(insertFile)
                return () => {
                    manager.unregisterInsertCallback()
                }
            }, [editor, manager])

            // Register clear callback so manager.clear() can clear the editor
            useEffect(() => {
                if (!editor) return

                const clearEditor = () => {
                    editor.commands.clearContent()
                }

                manager.registerClearCallback(clearEditor)
                return () => {
                    manager.unregisterClearCallback()
                }
            }, [editor, manager])

            // Register setContent callback so manager-driven restores can replace the full editor state.
            useEffect(() => {
                if (!editor) return

                const setContent = (content: string | Record<string, unknown> | null) => {
                    if (content === null) {
                        editor.commands.clearContent()
                    } else {
                        editor.commands.setContent(content)
                    }
                    editor.commands.focus("end")
                }

                manager.registerSetContentCallback(setContent)
                return () => {
                    manager.unregisterSetContentCallback()
                }
            }, [editor, manager])

            useImperativeHandle(
                ref,
                () => ({
                    focus: () => {
                        editor?.commands.focus()
                    },
                    focusEnd: () => {
                        editor?.commands.focus("end")
                    },
                    blur: () => {
                        editor?.commands.blur()
                    },
                    clear: () => {
                        // Just call manager.clear() - it will trigger the registered callback to clear the editor
                        manager.clear()
                    },
                }),
                [editor, manager]
            )

            const handleContainerClick = () => {
                if (!disabled) {
                    editor?.commands.focus()
                }
            }

            const [isDragOver, setIsDragOver] = useState(false)
            const dragCounterRef = useRef(0)

            const handleDragEnter = useCallback((e: React.DragEvent) => {
                e.preventDefault()
                dragCounterRef.current++
                if (e.dataTransfer?.types.includes("Files")) {
                    setIsDragOver(true)
                }
            }, [])

            const handleDragLeave = useCallback((e: React.DragEvent) => {
                e.preventDefault()
                dragCounterRef.current--
                if (dragCounterRef.current === 0) {
                    setIsDragOver(false)
                }
            }, [])

            const handleDragOver = useCallback((e: React.DragEvent) => {
                e.preventDefault()
            }, [])

            const handleDrop = useCallback((_e: React.DragEvent) => {
                dragCounterRef.current = 0
                setIsDragOver(false)
                // Actual drop handling is done by TipTap's handleDrop in editorProps
            }, [])

            return (
                <div className="relative w-full">
                    <div
                        className={twMerge(
                            "w-full bg-input text-base-content border border-border cursor-text",
                            "focus-within:border-primary transition-colors",
                            isDragOver && "border-primary ring-1 ring-primary/50",
                            disabled && "opacity-50 cursor-not-allowed",
                            className
                        )}
                        onClick={handleContainerClick}
                        onDragEnter={handleDragEnter}
                        onDragLeave={handleDragLeave}
                        onDragOver={handleDragOver}
                        onDrop={handleDrop}
                    >
                        <EditorContent
                            editor={editor}
                            className={twMerge(
                                "w-full h-full px-4 py-3 [&_.ProseMirror]:h-full [&_.ProseMirror]:outline-none [&_.ProseMirror_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)] [&_.ProseMirror_p.is-editor-empty:first-child::before]:text-muted/50 [&_.ProseMirror_p.is-editor-empty:first-child::before]:float-left [&_.ProseMirror_p.is-editor-empty:first-child::before]:h-0 [&_.ProseMirror_p.is-editor-empty:first-child::before]:pointer-events-none",
                                editorClassName
                            )}
                            data-placeholder={placeholder}
                        />
                    </div>

                    {/* File mention popup (@ trigger) */}
                    {fileSuggestion.open &&
                        createPortal(
                            <div
                                ref={fileRefs.setFloating}
                                style={fileFloatingStyles}
                                className="z-50 bg-base-200 p-3 text-base-content shadow-lg outline outline-1 outline-border"
                            >
                                <SuggestionList
                                    items={fileSuggestion.items}
                                    treeMatch={fileSuggestion.treeMatch}
                                    selectedIndex={fileSuggestion.selectedIndex}
                                    onSelectIndex={(index) => setFileSuggestion((prev) => ({ ...prev, selectedIndex: index }))}
                                    onSelectItem={handleFileSelectItem}
                                />
                            </div>,
                            portalContainer ?? document.body
                        )}

                    {/* Slash command popup (/ trigger) */}
                    {slashSuggestion.open &&
                        slashSuggestion.items.length > 0 &&
                        createPortal(
                            <div
                                ref={slashRefs.setFloating}
                                style={slashFloatingStyles}
                                className="z-50 bg-base-200 p-3 text-base-content shadow-lg outline outline-1 outline-border"
                            >
                                <SlashSuggestionList
                                    items={slashSuggestion.items}
                                    selectedIndex={slashSuggestion.selectedIndex}
                                    onSelectIndex={(index) => setSlashSuggestion((prev) => ({ ...prev, selectedIndex: index }))}
                                    onSelectItem={handleSlashSelectItem}
                                />
                            </div>,
                            portalContainer ?? document.body
                        )}
                </div>
            )
        }
    )
)

SmartEditor.displayName = "SmartEditor"
