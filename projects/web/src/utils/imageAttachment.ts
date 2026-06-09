/**
 * Image Attachment Processing Pipeline
 *
 * Shared by both paste and file picker input methods.
 * Handles: resize → persist bytes → generate preview → return metadata.
 */

import { ulid } from "ulid"
import type { OpenADETaskImageWriteRequest } from "../../../openade-module/src"
import { dataFolderApi } from "../electronAPI/dataFolder"
import type { ImageAttachment } from "../types"
import { mimeToExt, resizeImage } from "./imageResize"

type TaskImageWriteExt = OpenADETaskImageWriteRequest["ext"]
type TaskImageWriteMediaType = OpenADETaskImageWriteRequest["mediaType"]

export interface ProcessedImage {
    attachment: ImageAttachment
    dataUrl: string
}

export interface ImagePersistencePayload {
    id: string
    ext: string
    mediaType: string
    data: ArrayBuffer
}

export type PersistImage = (payload: ImagePersistencePayload) => Promise<void>

export interface ProcessImageBlobOptions {
    persistImage?: PersistImage
}

function bytesToBase64(bytes: Uint8Array): string {
    let binary = ""
    const chunkSize = 0x8000
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
    }
    return btoa(binary)
}

function imageWriteExt(ext: string): TaskImageWriteExt {
    switch (ext) {
        case "gif":
        case "jpeg":
        case "jpg":
        case "png":
        case "webp":
            return ext
        default:
            throw new Error(`Unsupported image extension: ${ext}`)
    }
}

function imageWriteMediaType(mediaType: string): TaskImageWriteMediaType {
    switch (mediaType) {
        case "image/gif":
        case "image/jpeg":
        case "image/png":
        case "image/webp":
            return mediaType
        default:
            throw new Error(`Unsupported image media type: ${mediaType}`)
    }
}

export function imagePersistencePayloadToWriteRequest(payload: ImagePersistencePayload): OpenADETaskImageWriteRequest {
    return {
        imageId: payload.id,
        ext: imageWriteExt(payload.ext),
        mediaType: imageWriteMediaType(payload.mediaType),
        data: bytesToBase64(new Uint8Array(payload.data)),
    }
}

export async function persistImageToDataFolder(payload: ImagePersistencePayload): Promise<void> {
    await dataFolderApi.save("images", payload.id, payload.data, payload.ext)
}

export async function processImageBlob(blob: Blob, options: ProcessImageBlobOptions = {}): Promise<ProcessedImage> {
    const id = ulid()

    // Resize for API submission
    const resized = await resizeImage(blob)

    const ext = mimeToExt(resized.mediaType)
    const buffer = await resized.blob.arrayBuffer()
    await (options.persistImage ?? persistImageToDataFolder)({
        id,
        ext,
        mediaType: resized.mediaType,
        data: buffer,
    })

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
