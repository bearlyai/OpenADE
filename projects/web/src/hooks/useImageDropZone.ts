import { useCallback, useRef, useState } from "react"
import type { SmartEditorManager } from "../store/managers/SmartEditorManager"
import { processImageBlob } from "../utils/imageAttachment"

export function useImageDropZone(editorManager: SmartEditorManager | null) {
    const [isDragOver, setIsDragOver] = useState(false)
    const dragCounter = useRef(0)

    const handleDragEnter = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        dragCounter.current++
        if (e.dataTransfer?.types.includes("Files")) {
            setIsDragOver(true)
        }
    }, [])

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault()
    }, [])

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        dragCounter.current--
        if (dragCounter.current <= 0) {
            dragCounter.current = 0
            setIsDragOver(false)
        }
    }, [])

    const handleDrop = useCallback(
        (e: React.DragEvent) => {
            e.preventDefault()
            dragCounter.current = 0
            setIsDragOver(false)
            if (!editorManager) return
            const files = e.dataTransfer?.files
            if (!files) return
            for (const file of Array.from(files)) {
                if (file.type.startsWith("image/")) {
                    processImageBlob(file)
                        .then(({ attachment, dataUrl }) => editorManager.addImage(attachment, dataUrl))
                        .catch((err) => console.error("[useImageDropZone] Failed to process dropped image:", err))
                }
            }
        },
        [editorManager]
    )

    const dragHandlers = {
        onDragEnter: handleDragEnter,
        onDragOver: handleDragOver,
        onDragLeave: handleDragLeave,
        onDrop: handleDrop,
    }

    return { isDragOver, dragHandlers }
}
