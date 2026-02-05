import { useCallback, useEffect, useRef, useState } from "react"

interface CommentFormProps {
    startLine: number
    endLine: number
    initialContent?: string // If provided, this is an edit
    onSubmit: (content: string) => void
    onCancel: () => void
}

export function CommentForm({ startLine, endLine, initialContent = "", onSubmit, onCancel }: CommentFormProps) {
    const [content, setContent] = useState(initialContent)
    const textareaRef = useRef<HTMLTextAreaElement>(null)
    const isEdit = initialContent !== ""

    useEffect(() => {
        setTimeout(() => textareaRef.current?.focus(), 0)
    }, [])

    const handleSubmit = useCallback(() => {
        if (content.trim()) {
            onSubmit(content.trim())
        }
    }, [content, onSubmit])

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === "Escape") {
                onCancel()
            } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                handleSubmit()
            }
        },
        [onCancel, handleSubmit]
    )

    const lineLabel = startLine === endLine ? `Line ${startLine}` : `Lines ${startLine}-${endLine}`

    return (
        <div style={{ overflow: "hidden", display: "flex", flexDirection: "row" }}>
            <div style={{ width: "100%" }}>
                <div className="max-w-[95%] sm:max-w-[70%]" style={{ whiteSpace: "normal", margin: 20 }}>
                    <div className="bg-base-200 border border-border p-4 shadow-sm">
                        <div className="text-xs text-muted mb-2">{lineLabel}</div>
                        <textarea
                            ref={textareaRef}
                            placeholder="Leave a comment..."
                            className="w-full min-h-[60px] resize-none border border-border bg-input p-2 text-sm text-base-content focus:outline-none focus:ring-2 focus:ring-primary"
                            value={content}
                            onChange={(e) => setContent(e.target.value)}
                            onKeyDown={handleKeyDown}
                        />
                        <div className="mt-3 flex items-center gap-2">
                            <button
                                type="button"
                                className="px-3 py-1.5 bg-primary text-primary-content text-sm font-medium hover:bg-primary/90 cursor-pointer"
                                onClick={handleSubmit}
                            >
                                {isEdit ? "Save" : "Comment"}
                            </button>
                            <button type="button" className="px-3 py-1.5 text-muted text-sm hover:text-base-content cursor-pointer" onClick={onCancel}>
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
