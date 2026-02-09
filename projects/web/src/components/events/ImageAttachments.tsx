/**
 * ImageAttachments
 *
 * Renders image attachment thumbnails in a horizontal strip.
 * Loads images lazily from disk and displays lightbox on click.
 */

import { observer } from "mobx-react"
import { useCallback, useEffect, useState } from "react"
import { dataFolderApi } from "../../electronAPI/dataFolder"
import type { ImageAttachment } from "../../types"
import { ImageLightbox } from "../ui/ImageLightbox"

interface ImageAttachmentsProps {
    images: ImageAttachment[]
}

function ImageThumbnail({ image }: { image: ImageAttachment }) {
    const [objectUrl, setObjectUrl] = useState<string | null>(null)
    const [lightboxOpen, setLightboxOpen] = useState(false)

    useEffect(() => {
        let cancelled = false
        let url: string | null = null

        async function loadImage() {
            try {
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
    }, [image.id, image.ext, image.mediaType])

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

export const ImageAttachments = observer(function ImageAttachments({ images }: ImageAttachmentsProps) {
    if (images.length === 0) return null

    return (
        <div className="flex gap-2 py-1 overflow-x-auto">
            {images.map((img) => (
                <ImageThumbnail key={img.id} image={img} />
            ))}
        </div>
    )
})
