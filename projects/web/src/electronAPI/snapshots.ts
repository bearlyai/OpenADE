import { isCodeModuleAvailable } from "./capabilities"
import { localRuntimeClient } from "../runtime/localRuntimeClient"
import type { SnapshotPatchFile, SnapshotPatchIndex } from "../../../electron/src/modules/code/snapshotsIndex"

export type { SnapshotPatchFile, SnapshotPatchIndex }

async function saveBundle(id: string, patch: string, index: SnapshotPatchIndex): Promise<void> {
    await localRuntimeClient.request("snapshot/bundle/save", { id, patch, index })
}

async function loadPatch(id: string): Promise<string | null> {
    return localRuntimeClient.request<string | null>("snapshot/patch/read", { id })
}

async function loadIndex(id: string): Promise<SnapshotPatchIndex | null> {
    return localRuntimeClient.request<SnapshotPatchIndex | null>("snapshot/index/read", { id })
}

async function loadPatchSlice(id: string, start: number, end: number): Promise<string | null> {
    return localRuntimeClient.request<string | null>("snapshot/patch/readSlice", { id, start, end })
}

async function deleteBundle(id: string): Promise<void> {
    await localRuntimeClient.request("snapshot/bundle/delete", { id })
}

function isAvailable(): boolean {
    return isCodeModuleAvailable() && !!window.openadeAPI?.runtime
}

export const snapshotsApi = {
    saveBundle,
    loadPatch,
    loadIndex,
    loadPatchSlice,
    delete: deleteBundle,
    isAvailable,
}
