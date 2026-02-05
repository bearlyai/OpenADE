/**
 * ModalConfirm
 *
 * Confirmation modal for destructive actions.
 * Flat, square design following Theme V2.
 */

import NiceModal, { useModal } from "@ebay/nice-modal-react"
import { useHotkeys } from "react-hotkeys-hook"
import { Modal } from "./Modal"

const ModalContent = (props: {
    title: string
    description: string
    onConfirm: () => void
    buttonText: string
    onCancel?: () => void
}) => {
    const modal = useModal()
    const { title, description, onConfirm, buttonText } = props

    const handleClose = () => {
        if (props.onCancel) {
            props.onCancel()
        }
        modal.remove()
    }

    useHotkeys(
        "shift+enter",
        (e) => {
            if (modal.visible) {
                e.preventDefault()
                e.stopPropagation()
                onConfirm()
                modal.remove()
            }
        },
        {
            enabled: modal.visible,
        },
        [modal.visible]
    )

    const footer = (
        <div className="flex flex-col sm:flex-row gap-2">
            <button
                type="button"
                autoFocus={true}
                className="btn flex-1 px-4 py-2.5 bg-base-200 hover:bg-base-300 text-base-content font-medium transition-colors border border-border"
                onClick={handleClose}
            >
                Cancel
            </button>
            <button
                type="button"
                className="btn flex-1 px-4 py-2.5 bg-error hover:bg-error/90 text-error-content font-medium transition-colors"
                onClick={() => {
                    onConfirm()
                    modal.remove()
                }}
            >
                {buttonText}
            </button>
        </div>
    )

    return (
        <Modal title={title} onClose={handleClose} footer={footer} hideSeparator={true}>
            <div className="text-base-content py-2">{description}</div>
        </Modal>
    )
}

export const ModalConfirm = NiceModal.create(
    (props: { title: string; description: string; onConfirm: () => void; buttonText: string; onCancel?: () => void }) => {
        return <ModalContent {...props} />
    }
)
