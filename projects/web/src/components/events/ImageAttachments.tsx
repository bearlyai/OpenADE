/**
 * ImageAttachments
 *
 * Renders image attachment thumbnails in a horizontal strip.
 * Loads images lazily from disk and displays lightbox on click.
 */

import { observer } from "mobx-react"
import { useCallback, useEffect, useState } from "react"
import { dataFolderApi } from "../../electronAPI/dataFolder"
import { useCodeStore } from "../../store/context"
import type { ImageAttachment } from "../../types"
import { ImageLightbox } from "../ui/ImageLightbox"

interface ImageAttachmentsProps {
    images: ImageAttachment[]
    taskId: string
}

function objectUrlFromBase64(data: string, mediaType: string): string {
    const binary = atob(data)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index)
    }
    return URL.createObjectURL(new Blob([bytes], { type: mediaType }))
}

function ImageThumbnail({ image, taskId }: { image: ImageAttachment; taskId: string }) {
    const codeStore = useCodeStore()
    const [objectUrl, setObjectUrl] = useState<string | null>(null)
    const [lightboxOpen, setLightboxOpen] = useState(false)

    useEffect(() => {
        let cancelled = false
        let url: string | null = null

        async function loadImage() {
            try {
                if (codeStore.shouldUseRuntimeProductReads()) {
                    const repoId = codeStore.findRuntimeProductRepoIdForTask(taskId)
                    if (!repoId) return
                    const result = await codeStore.readProductTaskImage({
                        repoId,
                        taskId,
                        imageId: image.id,
                        ext: image.ext,
                    })
                    if (cancelled || !result.data) return
                    url = objectUrlFromBase64(result.data, result.mediaType ?? image.mediaType)
                    setObjectUrl(url)
                    return
                }

                const data = await dataFolderApi.load("images", image.id, image.ext)
                if (cancelled || !data) return
                const blob = new Blob([data], { type: image.mediaType })
                url = URL.createObjectURL(blob)
                setObjectUrl(url)
            } catch (err) {
                console.error("[ImageAttachments] Failed to load image:", image.id, err)
            }
        }

        loadImage()

        return () => {
            cancelled = true
            if (url) URL.revokeObjectURL(url)
        }
    }, [codeStore, image.id, image.ext, image.mediaType, taskId])

    const handleClick = useCallback(() => {
        if (objectUrl) setLightboxOpen(true)
    }, [objectUrl])

    return (
        <>
            <div
                className="shrink-0 bg-base-200 cursor-pointer overflow-hidden"
                style={{
                    height: 80,
                    aspectRatio: `${image.resizedWidth}/${image.resizedHeight}`,
                }}
                onClick={handleClick}
            >
                {objectUrl && <img src={objectUrl} alt="" className="h-full w-full object-cover" />}
            </div>
            {lightboxOpen && objectUrl && <ImageLightbox src={objectUrl} onClose={() => setLightboxOpen(false)} />}
        </>
    )
}

export const ImageAttachments = observer(function ImageAttachments({ images, taskId }: ImageAttachmentsProps) {
    if (images.length === 0) return null

    return (
        <div className="flex gap-2 py-1 overflow-x-auto">
            {images.map((img) => (
                <ImageThumbnail key={img.id} image={img} taskId={taskId} />
            ))}
        </div>
    )
})
