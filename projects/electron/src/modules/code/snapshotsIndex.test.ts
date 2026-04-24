import { describe, expect, it } from "vitest"
import { buildSnapshotPatchIndex, sliceSnapshotPatchBytes } from "./snapshotsIndex"

describe("snapshotsIndex", () => {
    it("indexes multi-file patches and preserves exact slice boundaries", () => {
        const segments = [
            [
                "diff --git a/src/old.ts b/src/new.ts",
                "similarity index 100%",
                "rename from src/old.ts",
                "rename to src/new.ts",
                "",
            ].join("\n"),
            [
                "diff --git a/docs/readme.md b/docs/readme.md",
                "index 1111111..2222222 100644",
                "--- a/docs/readme.md",
                "+++ b/docs/readme.md",
                "@@ -1 +1 @@",
                "-old",
                "+caf\u00e9",
                "",
            ].join("\n"),
            [
                "diff --git a/bin/logo.png b/bin/logo.png",
                "new file mode 100644",
                "index 0000000..1234567",
                "Binary files /dev/null and b/bin/logo.png differ",
                "",
            ].join("\n"),
            [
                "diff --git a/src/deleted.ts b/src/deleted.ts",
                "deleted file mode 100644",
                "index 89abcde..0000000",
                "--- a/src/deleted.ts",
                "+++ /dev/null",
                "@@ -1 +0,0 @@",
                "-gone",
                "",
            ].join("\n"),
        ]
        const patch = segments.join("")

        const index = buildSnapshotPatchIndex(patch)

        expect(index.version).toBe(1)
        expect(index.patchSize).toBe(Buffer.byteLength(patch, "utf8"))
        expect(index.files).toHaveLength(4)

        expect(index.files[0]).toMatchObject({
            path: "src/new.ts",
            oldPath: "src/old.ts",
            status: "renamed",
            changedLines: 0,
        })
        expect(index.files[1]).toMatchObject({
            path: "docs/readme.md",
            status: "modified",
            insertions: 1,
            deletions: 1,
            changedLines: 2,
            hunkCount: 1,
        })
        expect(index.files[2]).toMatchObject({
            path: "bin/logo.png",
            status: "added",
            binary: true,
        })
        expect(index.files[3]).toMatchObject({
            path: "src/deleted.ts",
            status: "deleted",
            deletions: 1,
        })

        expect(index.files.map((file) => sliceSnapshotPatchBytes(patch, file.patchStart, file.patchEnd))).toEqual(segments)
    })

    it("returns an empty index for an empty patch", () => {
        expect(buildSnapshotPatchIndex("")).toEqual({
            version: 1,
            patchSize: 0,
            files: [],
        })
    })
})
