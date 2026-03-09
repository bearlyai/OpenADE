import NiceModal, { useModal } from "@ebay/nice-modal-react"
import { observer } from "mobx-react"
import { useCallback, useEffect, useState } from "react"
import { readConfigFile, writeConfigFile } from "../../electronAPI/procs"
import { Modal } from "../ui/Modal"

interface CronEditModalProps {
    filePath: string
}

export const CronEditModal = NiceModal.create(
    observer(({ filePath }: CronEditModalProps) => {
        const modal = useModal()
        const [content, setContent] = useState("")
        const [originalContent, setOriginalContent] = useState("")
        const [loading, setLoading] = useState(true)
        const [saving, setSaving] = useState(false)
        const [error, setError] = useState<string | null>(null)

        useEffect(() => {
            let cancelled = false
            setLoading(true)
            readConfigFile(filePath)
                .then((text) => {
                    if (cancelled) return
                    setContent(text)
                    setOriginalContent(text)
                    setLoading(false)
                })
                .catch((err) => {
                    if (cancelled) return
                    setError(err instanceof Error ? err.message : "Failed to load file")
                    setLoading(false)
                })
            return () => {
                cancelled = true
            }
        }, [filePath])

        const hasChanges = content !== originalContent

        const handleSaveAndClose = useCallback(async () => {
            if (hasChanges) {
                setSaving(true)
                setError(null)
                try {
                    await writeConfigFile(filePath, content)
                    modal.remove()
                } catch (err) {
                    setError(err instanceof Error ? err.message : "Failed to save file")
                    setSaving(false)
                }
            } else {
                modal.remove()
            }
        }, [filePath, content, hasChanges, modal])

        // Extract filename for title
        const fileName = filePath.split("/").pop() ?? filePath

        return (
            <Modal
                title={`Edit ${fileName}`}
                footer={
                    <div className="flex items-center justify-between">
                        <span className="text-xs text-muted font-mono truncate max-w-[60%]">{filePath}</span>
                        <div className="flex items-center gap-2">
                            {error && <span className="text-xs text-error">{error}</span>}
                            <button
                                type="button"
                                className="btn px-3 py-1.5 text-sm text-muted hover:text-base-content transition-colors"
                                onClick={() => modal.remove()}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                className="btn px-3 py-1.5 text-sm bg-primary text-primary-content hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                onClick={handleSaveAndClose}
                                disabled={saving || loading}
                            >
                                {saving ? "Saving..." : hasChanges ? "Save & Close" : "Close"}
                            </button>
                        </div>
                    </div>
                }
            >
                {loading ? (
                    <div className="flex items-center justify-center py-8 text-muted text-sm">Loading...</div>
                ) : (
                    <textarea
                        value={content}
                        onChange={(e) => setContent(e.target.value)}
                        className="w-full h-[400px] bg-base-200 text-base-content font-mono text-sm p-3 border border-border focus:outline-none focus:border-primary resize-y"
                        spellCheck={false}
                        autoFocus
                    />
                )}
            </Modal>
        )
    })
)
