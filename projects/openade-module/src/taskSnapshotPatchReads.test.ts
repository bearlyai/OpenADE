import { describe, expect, it, vi } from "vitest"
import {
    openADESnapshotPatchFileId,
    readOpenADETaskSnapshotIndex,
    readOpenADETaskSnapshotPatch,
    readOpenADETaskSnapshotPatchSlice,
    type OpenADETaskSnapshotPatchStore,
} from "./taskSnapshotPatchReads"
import type { OpenADESnapshotEventRecord, OpenADESnapshotPatchIndex } from "./types"

const patch = "diff --git a/README.md b/README.md\n+shared snapshot patch\n"
const patchSliceStart = patch.indexOf("+shared")
const patchSliceEnd = patch.length
const storedIndex: OpenADESnapshotPatchIndex = { version: 1, patchSize: 123, files: [] }

function snapshotEvent(fields: Record<string, unknown>): OpenADESnapshotEventRecord {
    return { id: "snapshot-1", type: "snapshot", ...fields }
}

function store(overrides: Partial<OpenADETaskSnapshotPatchStore> = {}): OpenADETaskSnapshotPatchStore {
    return {
        loadPatch: vi.fn(async () => patch),
        ...overrides,
    }
}

describe("OpenADE task snapshot patch reads", () => {
    it("prefers inline patches over external storage", async () => {
        const patchStore = store()
        await expect(
            readOpenADETaskSnapshotPatch({
                repoId: "repo-1",
                taskId: "task-1",
                eventId: "snapshot-1",
                snapshotEvent: snapshotEvent({ patchFileId: "patch-1", fullPatch: patch }),
                store: patchStore,
            })
        ).resolves.toMatchObject({ patchFileId: "patch-1", patch })
        expect(patchStore.loadPatch).not.toHaveBeenCalled()
    })

    it("reads stored indexes and builds an index from patch content when no stored index exists", async () => {
        await expect(
            readOpenADETaskSnapshotIndex({
                repoId: "repo-1",
                taskId: "task-1",
                eventId: "snapshot-1",
                snapshotEvent: snapshotEvent({ patchFileId: "patch-1" }),
                store: store({ loadIndex: vi.fn(async () => storedIndex) }),
            })
        ).resolves.toMatchObject({ patchFileId: "patch-1", index: storedIndex })

        await expect(
            readOpenADETaskSnapshotIndex({
                repoId: "repo-1",
                taskId: "task-1",
                eventId: "snapshot-1",
                snapshotEvent: snapshotEvent({ patchFileId: "patch-1" }),
                store: store({ loadIndex: vi.fn(async () => null) }),
            })
        ).resolves.toMatchObject({ index: { files: [expect.objectContaining({ path: "README.md", insertions: 1 })] } })
    })

    it("uses storage slice callbacks when available and slices loaded patches otherwise", async () => {
        await expect(
            readOpenADETaskSnapshotPatchSlice({
                repoId: "repo-1",
                taskId: "task-1",
                eventId: "snapshot-1",
                snapshotEvent: snapshotEvent({ patchFileId: "patch-1" }),
                start: patchSliceStart,
                end: patchSliceEnd,
                store: store({ loadPatchSlice: vi.fn(async () => "+stored slice\n") }),
            })
        ).resolves.toMatchObject({ patch: "+stored slice\n" })

        await expect(
            readOpenADETaskSnapshotPatchSlice({
                repoId: "repo-1",
                taskId: "task-1",
                eventId: "snapshot-1",
                snapshotEvent: snapshotEvent({ patchFileId: "patch-1" }),
                start: patchSliceStart,
                end: patchSliceEnd,
                store: store(),
            })
        ).resolves.toMatchObject({ patch: "+shared snapshot patch\n" })
    })

    it("rejects unsafe snapshot patch ids", () => {
        expect(() => openADESnapshotPatchFileId(snapshotEvent({ patchFileId: "../patch-1" }))).toThrow("snapshot patch file id is invalid")
    })
})
