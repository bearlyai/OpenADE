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
import type { TreeMatch } from "../electronAPI/files"
import { fuzzySearch, isFilesApiAvailable } from "../electronAPI/files"
import { usePortalContainer } from "../hooks/usePortalContainer"
import { useCodeStore } from "../store/context"
import type { SlashCommandEntry } from "../store/managers/SdkCapabilitiesManager"
import type { SmartEditorManager } from "../store/managers/SmartEditorManager"
import { getFileName } from "./utils/paths"

interface SmartEditorProps {
    /** Required: manager instance for state management */
    manager: SmartEditorManager
    placeholder?: string
    disabled?: boolean
    className?: string
    editorClassName?: string
    onKeyDown?: (e: React.KeyboardEvent) => void
    /** Directory for @file mention autocomplete, null to disable */
    fileMentionsDir: string | null
    /** Directory for /slash command autocomplete, null to disable */
    slashCommandsDir: string | null
}

export interface SmartEditorRef {
    focus: () => void
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
    treeMatch: TreeMatch | null
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
    treeMatch: TreeMatch | null
    selectedIndex: number
    anchorRect: DOMRect | null
}

interface SlashSuggestionPopupState {
    open: boolean
    items: SlashCommandEntry[]
    selectedIndex: number
    anchorRect: DOMRect | null
}

// ============================================================================
// SmartEditor
// ============================================================================

export const SmartEditor = observer(
    forwardRef<SmartEditorRef, SmartEditorProps>(
        ({ manager, placeholder, disabled, className, editorClassName, onKeyDown, fileMentionsDir, slashCommandsDir }, ref) => {
            const portalContainer = usePortalContainer()
            const codeStore = useCodeStore()

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
                selectedIndex: 0,
                anchorRect: null,
            })

            // Determine if features should be enabled
            const mentionsEnabled = fileMentionsDir !== null && isFilesApiAvailable()
            const slashEnabled = slashCommandsDir !== null

            // Load SDK capabilities when slashCommandsDir is provided
            useEffect(() => {
                if (slashCommandsDir) {
                    codeStore.sdkCapabilities.loadCapabilities(slashCommandsDir)
                }
            }, [slashCommandsDir, codeStore.sdkCapabilities])

            // Warm up file search cache when fileMentionsDir is provided
            useEffect(() => {
                if (fileMentionsDir && isFilesApiAvailable()) {
                    fuzzySearch({ dir: fileMentionsDir, query: "", matchDirs: false, limit: 20 }).catch(() => {})
                }
            }, [fileMentionsDir])

            const slashCommands = slashEnabled ? codeStore.sdkCapabilities.allCommands : []

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

            const handleFileSearch = useCallback(
                async (query: string) => {
                    if (!fileMentionsDir) return

                    if (searchTimeoutRef.current) {
                        clearTimeout(searchTimeoutRef.current)
                    }

                    lastQueryRef.current = query

                    const delay = query ? 150 : 50
                    searchTimeoutRef.current = setTimeout(async () => {
                        try {
                            const result = await fuzzySearch({
                                dir: fileMentionsDir,
                                query,
                                matchDirs: false,
                                limit: 20,
                            })
                            if (query === lastQueryRef.current) {
                                const items = result.results.map((path) => ({
                                    type: "file" as const,
                                    name: getFileName(path),
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
                            if (query === lastQueryRef.current) {
                                setFileSuggestion((prev) => ({
                                    ...prev,
                                    items: [],
                                    treeMatch: null,
                                }))
                            }
                        }
                    }, delay)
                },
                [fileMentionsDir]
            )

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
                                            const lower = query.toLowerCase()
                                            return commands.filter((cmd) => cmd.name.toLowerCase().includes(lower))
                                        },
                                        command: ({ editor: e, range, props: item }) => {
                                            const cmd = item as unknown as SlashCommandEntry
                                            e.chain().focus().deleteRange(range).insertContent(`/${cmd.name} `).run()
                                        },
                                        render: () => ({
                                            onStart: (props: SuggestionProps<SlashCommandEntry>) => {
                                                slashSuggestionPropsRef.current = props
                                                const rect = props.clientRect?.()
                                                setSlashSuggestion({
                                                    open: true,
                                                    items: props.items,
                                                    selectedIndex: 0,
                                                    anchorRect: rect ?? null,
                                                })
                                            },
                                            onUpdate: (props: SuggestionProps<SlashCommandEntry>) => {
                                                slashSuggestionPropsRef.current = props
                                                const rect = props.clientRect?.()
                                                setSlashSuggestion((prev) => ({
                                                    ...prev,
                                                    items: props.items,
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
            }, [mentionsEnabled, slashEnabled, placeholder, handleFileSearch])

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
                        },
                        handlePaste: () => {
                            // Let TipTap handle paste natively - it preserves structure correctly
                            return false
                        },
                        handleKeyDown: (_view, event) => {
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
                [extensions]
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

            // Register setContent callback so manager.setTextContent() can update the editor
            useEffect(() => {
                if (!editor) return

                const setContent = (text: string) => {
                    editor.commands.setContent(text)
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
                    clear: () => {
                        // Just call manager.clear() - it will trigger the registered callback to clear the editor
                        manager.clear()
                    },
                }),
                [manager]
            )

            const handleContainerClick = () => {
                if (!disabled) {
                    editor?.commands.focus()
                }
            }

            return (
                <div className="relative w-full">
                    <div
                        className={twMerge(
                            "w-full bg-input text-base-content border border-border cursor-text",
                            "focus-within:border-primary transition-colors",
                            disabled && "opacity-50 cursor-not-allowed",
                            className
                        )}
                        onClick={handleContainerClick}
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
