/**
 * Modal
 *
 * Base modal component for the Code module.
 * Flat, square design following Theme V2.
 */

import { useModal } from "@ebay/nice-modal-react"
import { X } from "lucide-react"
import type { ReactNode } from "react"
import { useHotkeys } from "react-hotkeys-hook"
import { ScrollArea } from "./ScrollArea"

const Z_INDEX_MODAL = "z-50"

export const Modal = ({
    title,
    children,
    footer,
    onClose,
    hideSeparator = false,
}: {
    title: string
    children: ReactNode
    footer?: ReactNode
    onClose?: () => void
    hideSeparator?: boolean
}) => {
    const modal = useModal()

    useHotkeys(
        "esc",
        (e) => {
            e.preventDefault()
            e.stopPropagation()
            onClose?.()
            modal.remove()
        },
        { enableOnFormTags: ["INPUT", "TEXTAREA", "SELECT"] },
        [modal, onClose]
    )

    const handleClose = () => {
        onClose?.()
        modal.remove()
    }

    const handleBackdropClick = (e: React.MouseEvent) => {
        if (e.target === e.currentTarget) {
            handleClose()
        }
    }

    return (
        <div
            className={`absolute inset-0 bg-black/50 flex items-start justify-center ${Z_INDEX_MODAL} p-4`}
            style={{
                backdropFilter: "blur(5px)",
                WebkitBackdropFilter: "blur(5px)",
                paddingTop: "max(min(100px, 20%), 1rem)",
            }}
            onClick={handleBackdropClick}
        >
            <div
                className="bg-base-100 shadow-2xl w-full max-w-2xl flex flex-col border border-border"
                style={{
                    maxHeight: "calc(100% - max(min(100px, 10%), 1rem) - 1rem)",
                    minHeight: "200px",
                }}
            >
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-border flex-shrink-0">
                    <h2 className="text-lg font-semibold text-base-content">{title}</h2>
                    <button
                        type="button"
                        className="btn w-8 h-8 flex items-center justify-center bg-transparent hover:bg-base-200 text-muted hover:text-base-content transition-colors"
                        onClick={handleClose}
                        title="Close"
                    >
                        <X size={16} />
                    </button>
                </div>

                {/* Scrollable Content */}
                <ScrollArea className="flex-auto min-h-0 overflow-auto" viewportClassName="p-4">
                    {children}
                </ScrollArea>

                {/* Footer */}
                {footer && <div className={`p-4 flex-shrink-0 ${!hideSeparator ? "border-t border-border" : ""}`}>{footer}</div>}
            </div>
        </div>
    )
}
