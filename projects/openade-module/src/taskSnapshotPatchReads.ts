import {
    type OpenADESnapshotEventRecord,
    type OpenADESnapshotPatchIndex,
    type OpenADETaskSnapshotIndexReadRequest,
    type OpenADETaskSnapshotIndexReadResult,
    type OpenADETaskSnapshotPatchReadRequest,
    type OpenADETaskSnapshotPatchReadResult,
    type OpenADETaskSnapshotPatchSliceReadRequest,
    type OpenADETaskSnapshotPatchSliceReadResult,
} from "./types"
import { buildOpenADESnapshotPatchIndex, sliceOpenADESnapshotPatchBytes } from "./snapshotPatchIndex"

export interface OpenADETaskSnapshotPatchStore {
    loadPatch(patchFileId: string): Promise<string | null>
    loadIndex?(patchFileId: string): Promise<OpenADESnapshotPatchIndex | null>
    loadPatchSlice?(patchFileId: string, start: number, end: number): Promise<string | null>
}

export function openADESnapshotPatchFileId(snapshotEvent: OpenADESnapshotEventRecord): string | undefined {
    const value = snapshotEvent.patchFileId
    if (typeof value !== "string" || value.length < 1) return undefined
    if (!/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error("snapshot patch file id is invalid")
    return value
}

export function openADESnapshotInlinePatch(snapshotEvent: OpenADESnapshotEventRecord): string | null {
    return typeof snapshotEvent.fullPatch === "string" && snapshotEvent.fullPatch.length > 0 ? snapshotEvent.fullPatch : null
}

async function readExternalPatchIndex(store: OpenADETaskSnapshotPatchStore, patchFileId: string): Promise<OpenADESnapshotPatchIndex | null> {
    const storedIndex = store.loadIndex ? await store.loadIndex(patchFileId) : null
    if (storedIndex) return storedIndex
    const patch = await store.loadPatch(patchFileId)
    return patch === null ? null : buildOpenADESnapshotPatchIndex(patch)
}

export async function readOpenADETaskSnapshotPatch(
    params: OpenADETaskSnapshotPatchReadRequest & { snapshotEvent: OpenADESnapshotEventRecord; store: OpenADETaskSnapshotPatchStore }
): Promise<OpenADETaskSnapshotPatchReadResult> {
    const patchFileId = openADESnapshotPatchFileId(params.snapshotEvent)
    const inlinePatch = openADESnapshotInlinePatch(params.snapshotEvent)
    const patch = inlinePatch ?? (patchFileId ? await params.store.loadPatch(patchFileId) : null)
    return { repoId: params.repoId, taskId: params.taskId, eventId: params.eventId, patchFileId, patch }
}

export async function readOpenADETaskSnapshotIndex(
    params: OpenADETaskSnapshotIndexReadRequest & { snapshotEvent: OpenADESnapshotEventRecord; store: OpenADETaskSnapshotPatchStore }
): Promise<OpenADETaskSnapshotIndexReadResult> {
    const patchFileId = openADESnapshotPatchFileId(params.snapshotEvent)
    const inlinePatch = openADESnapshotInlinePatch(params.snapshotEvent)
    const index = inlinePatch !== null ? buildOpenADESnapshotPatchIndex(inlinePatch) : patchFileId ? await readExternalPatchIndex(params.store, patchFileId) : null
    return { repoId: params.repoId, taskId: params.taskId, eventId: params.eventId, patchFileId, index }
}

export async function readOpenADETaskSnapshotPatchSlice(
    params: OpenADETaskSnapshotPatchSliceReadRequest & { snapshotEvent: OpenADESnapshotEventRecord; store: OpenADETaskSnapshotPatchStore }
): Promise<OpenADETaskSnapshotPatchSliceReadResult> {
    const patchFileId = openADESnapshotPatchFileId(params.snapshotEvent)
    const inlinePatch = openADESnapshotInlinePatch(params.snapshotEvent)
    if (inlinePatch !== null) {
        return {
            repoId: params.repoId,
            taskId: params.taskId,
            eventId: params.eventId,
            patchFileId,
            patch: sliceOpenADESnapshotPatchBytes(inlinePatch, params.start, params.end),
        }
    }

    if (!patchFileId) {
        return { repoId: params.repoId, taskId: params.taskId, eventId: params.eventId, patchFileId, patch: null }
    }

    if (params.store.loadPatchSlice) {
        const patch = await params.store.loadPatchSlice(patchFileId, params.start, params.end)
        return { repoId: params.repoId, taskId: params.taskId, eventId: params.eventId, patchFileId, patch }
    }

    const patch = await params.store.loadPatch(patchFileId)
    return {
        repoId: params.repoId,
        taskId: params.taskId,
        eventId: params.eventId,
        patchFileId,
        patch: patch === null ? null : sliceOpenADESnapshotPatchBytes(patch, params.start, params.end),
    }
}
