/**
 * ImageAttachments
 *
 * Renders image attachment thumbnails in a horizontal strip.
 * Loads images lazily from disk and displays lightbox on click.
 */

import { observer } from "mobx-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { OPENADE_METHOD } from "../../../../openade-client/src"
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
    const objectUrlRef = useRef<string | null>(null)
    const thumbnailRef = useRef<HTMLDivElement>(null)
    const [shouldLoad, setShouldLoad] = useState(false)
    const [lightboxOpen, setLightboxOpen] = useState(false)
    const productRuntimeOwnsImages = codeStore.shouldUseRuntimeProductTaskRoute()
    const canReadProductImage = !productRuntimeOwnsImages || codeStore.canUseProductMethod(OPENADE_METHOD.taskImageRead)

    const replaceObjectUrl = useCallback((nextUrl: string | null) => {
        const currentUrl = objectUrlRef.current
        if (currentUrl && currentUrl !== nextUrl) URL.revokeObjectURL(currentUrl)
        objectUrlRef.current = nextUrl
        setObjectUrl(nextUrl)
        if (!nextUrl) setLightboxOpen(false)
    }, [])

    useEffect(() => {
        return () => {
            const currentUrl = objectUrlRef.current
            if (currentUrl) URL.revokeObjectURL(currentUrl)
            objectUrlRef.current = null
        }
    }, [])

    useEffect(() => {
        if (shouldLoad) return
        const node = thumbnailRef.current
        if (!node) return
        if (typeof IntersectionObserver === "undefined") {
            setShouldLoad(true)
            return
        }

        const observer = new IntersectionObserver(
            (entries) => {
                if (!entries.some((entry) => entry.isIntersecting || entry.intersectionRatio > 0)) return
                setShouldLoad(true)
                observer.disconnect()
            },
            { rootMargin: "200px" }
        )
        observer.observe(node)
        return () => observer.disconnect()
    }, [shouldLoad])

    useEffect(() => {
        if (!shouldLoad) return
        let cancelled = false
        replaceObjectUrl(null)

        async function loadImage() {
            try {
                if (productRuntimeOwnsImages) {
                    if (codeStore.shouldUseRuntimeProductAPI() && !canReadProductImage) return
                    const canReadImage = codeStore.shouldUseRuntimeProductAPI()
                        ? canReadProductImage
                        : await codeStore.canUseProductMethodAfterConnect(OPENADE_METHOD.taskImageRead)
                    if (cancelled || !canReadImage) return
                    const repoId = codeStore.findProductRepoIdForTask(taskId)
                    if (!repoId) return
                    const result = await codeStore.readProductTaskImage({
                        repoId,
                        taskId,
                        imageId: image.id,
                        ext: image.ext,
                    })
                    if (cancelled || !result.data) return
                    replaceObjectUrl(objectUrlFromBase64(result.data, result.mediaType ?? image.mediaType))
                    return
                }

                const data = await dataFolderApi.load("images", image.id, image.ext)
                if (cancelled || !data) return
                const blob = new Blob([data], { type: image.mediaType })
                replaceObjectUrl(URL.createObjectURL(blob))
            } catch (err) {
                console.error("[ImageAttachments] Failed to load image:", image.id, err)
            }
        }

        loadImage()

        return () => {
            cancelled = true
        }
    }, [canReadProductImage, codeStore, image.id, image.ext, image.mediaType, productRuntimeOwnsImages, replaceObjectUrl, shouldLoad, taskId])

    const handleClick = useCallback(() => {
        if (objectUrl) setLightboxOpen(true)
    }, [objectUrl])

    return (
        <>
            <div
                ref={thumbnailRef}
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
