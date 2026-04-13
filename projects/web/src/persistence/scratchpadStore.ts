import type * as Y from "yjs"
import { type YArrayHandle, type YObjectHandle, arrayOfType, objectOfType } from "./storage"

// Index store — one per workspace, lightweight metadata for sidebar listing
export interface ScratchpadMeta {
    id: string
    title: string
    preview: string
    createdAt: string
    updatedAt: string
}

export interface ScratchpadIndexStore {
    pads: YArrayHandle<ScratchpadMeta>
}

export function createScratchpadIndexStore(doc: Y.Doc): ScratchpadIndexStore {
    return { pads: arrayOfType<ScratchpadMeta>(doc, "scratchpad_index") }
}

// Content store — one per scratchpad, holds full TipTap JSON
export interface ScratchpadContent {
    content: Record<string, unknown> | null
    plainText: string
}

export interface ScratchpadContentStore {
    data: YObjectHandle<ScratchpadContent>
}

export function createScratchpadContentStore(doc: Y.Doc): ScratchpadContentStore {
    return {
        data: objectOfType<ScratchpadContent>(doc, "scratchpad_content", () => ({
            content: null,
            plainText: "",
        })),
    }
}
