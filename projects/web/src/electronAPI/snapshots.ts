import { isCodeModuleAvailable } from "./capabilities"

export interface SnapshotPatchFile {
    id: string
    path: string
    oldPath?: string
    status: "added" | "deleted" | "modified" | "renamed"
    binary: boolean
    insertions: number
    deletions: number
    changedLines: number
    hunkCount: number
    patchStart: number
    patchEnd: number
}

export interface SnapshotPatchIndex {
    version: 1
    patchSize: number
    files: SnapshotPatchFile[]
}

async function saveBundle(id: string, patch: string, index: SnapshotPatchIndex): Promise<void> {
    if (!window.openadeAPI?.snapshots) {
        throw new Error("Snapshots API not available")
    }

    await window.openadeAPI.snapshots.saveBundle({ id, patch, index })
}

async function loadPatch(id: string): Promise<string | null> {
    if (!window.openadeAPI?.snapshots) {
        throw new Error("Snapshots API not available")
    }

    return (await window.openadeAPI.snapshots.loadPatch({ id })) as string | null
}

async function loadIndex(id: string): Promise<SnapshotPatchIndex | null> {
    if (!window.openadeAPI?.snapshots) {
        throw new Error("Snapshots API not available")
    }

    return (await window.openadeAPI.snapshots.loadIndex({ id })) as SnapshotPatchIndex | null
}

async function loadPatchSlice(id: string, start: number, end: number): Promise<string | null> {
    if (!window.openadeAPI?.snapshots) {
        throw new Error("Snapshots API not available")
    }

    return (await window.openadeAPI.snapshots.loadPatchSlice({ id, start, end })) as string | null
}

async function deleteBundle(id: string): Promise<void> {
    if (!window.openadeAPI?.snapshots) {
        throw new Error("Snapshots API not available")
    }

    await window.openadeAPI.snapshots.deleteBundle({ id })
}

function isAvailable(): boolean {
    return isCodeModuleAvailable() && !!window.openadeAPI?.snapshots
}

export const snapshotsApi = {
    saveBundle,
    loadPatch,
    loadIndex,
    loadPatchSlice,
    delete: deleteBundle,
    isAvailable,
}
