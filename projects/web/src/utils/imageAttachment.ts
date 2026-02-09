/**
 * Image Attachment Processing Pipeline
 *
 * Shared by both paste and file picker input methods.
 * Handles: resize → save to disk → generate preview → return metadata.
 */

import { ulid } from "ulid"
import { dataFolderApi } from "../electronAPI/dataFolder"
import type { ImageAttachment } from "../types"
import { mimeToExt, resizeImage } from "./imageResize"

export interface ProcessedImage {
    attachment: ImageAttachment
    dataUrl: string
}

export async function processImageBlob(blob: Blob): Promise<ProcessedImage> {
    const id = ulid()

    // Resize for API submission
    const resized = await resizeImage(blob)

    // Save the *resized* image to disk (avoids re-resize on send)
    const ext = mimeToExt(resized.mediaType)
    const buffer = await resized.blob.arrayBuffer()
    await dataFolderApi.save("images", id, buffer, ext)

    // Generate preview data URL from resized blob
    const dataUrl = URL.createObjectURL(resized.blob)

    const attachment: ImageAttachment = {
        id,
        mediaType: resized.mediaType,
        ext,
        originalWidth: resized.originalWidth,
        originalHeight: resized.originalHeight,
        resizedWidth: resized.width,
        resizedHeight: resized.height,
    }

    return { attachment, dataUrl }
}
