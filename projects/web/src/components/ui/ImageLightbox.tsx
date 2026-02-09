/**
 * ImageLightbox
 *
 * Full-viewport overlay that displays an image at full resolution.
 * Closes on click outside, Escape key, or X button.
 */

import { X } from "lucide-react"
import { useCallback, useEffect } from "react"
import { createPortal } from "react-dom"
import { usePortalContainer } from "../../hooks/usePortalContainer"

interface ImageLightboxProps {
    src: string
    alt?: string
    onClose: () => void
}

export function ImageLightbox({ src, alt = "", onClose }: ImageLightboxProps) {
    const portalContainer = usePortalContainer()

    const handleKeyDown = useCallback(
        (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                onClose()
            }
        },
        [onClose]
    )

    useEffect(() => {
        document.addEventListener("keydown", handleKeyDown)
        return () => document.removeEventListener("keydown", handleKeyDown)
    }, [handleKeyDown])

    const content = (
        <div className="fixed inset-0 flex items-center justify-center bg-black/80" style={{ zIndex: 9999 }} onClick={onClose}>
            <button type="button" className="btn absolute top-4 right-4 text-white hover:text-white/80 p-2" onClick={onClose}>
                <X size={24} />
            </button>
            <img src={src} alt={alt} className="max-h-[90vh] max-w-[90vw] object-contain" onClick={(e) => e.stopPropagation()} />
        </div>
    )

    if (portalContainer) {
        return createPortal(content, portalContainer)
    }
    return content
}
