import { describe, expect, it } from "vitest"
import type { ChangedFileInfo } from "../../electronAPI/git"
import { buildFileTree, collectAllDirPaths, flattenFileTree } from "./changesTree"

function changedFile(path: string, status: ChangedFileInfo["status"] = "modified", extra: Partial<ChangedFileInfo> = {}): ChangedFileInfo {
    return {
        path,
        status,
        ...extra,
    }
}

describe("buildFileTree", () => {
    it("groups files under shared directories", () => {
        const tree = buildFileTree([
            changedFile("src/components/Button.tsx"),
            changedFile("src/components/Input.tsx"),
            changedFile("src/utils/format.ts"),
            changedFile("README.md"),
        ])

        const src = tree.find((node) => node.path === "src")
        expect(src?.isDir).toBe(true)
        expect(src?.children.map((child) => child.path)).toEqual(["src/components", "src/utils"])

        const components = src?.children.find((child) => child.path === "src/components")
        expect(components?.children.map((child) => child.path)).toEqual(["src/components/Button.tsx", "src/components/Input.tsx"])
    })

    it("sorts directories before files, then alphabetically", () => {
        const tree = buildFileTree([
            changedFile("zeta.ts"),
            changedFile("src/z.ts"),
            changedFile("alpha.ts"),
            changedFile("docs/readme.md"),
            changedFile("src/a.ts"),
        ])

        expect(tree.map((node) => node.path)).toEqual(["docs", "src", "alpha.ts", "zeta.ts"])

        const src = tree.find((node) => node.path === "src")
        expect(src?.children.map((child) => child.path)).toEqual(["src/a.ts", "src/z.ts"])
    })

    it("handles root-level files", () => {
        const tree = buildFileTree([changedFile("README.md"), changedFile("package.json", "added")])

        expect(tree).toHaveLength(2)
        expect(tree[0]).toMatchObject({ path: "package.json", isDir: false })
        expect(tree[1]).toMatchObject({ path: "README.md", isDir: false })
    })

    it("computes correct fileCount on folder nodes", () => {
        const tree = buildFileTree([changedFile("src/components/Button.tsx"), changedFile("src/components/Input.tsx"), changedFile("src/utils/format.ts")])

        const src = tree.find((node) => node.path === "src")
        const components = src?.children.find((child) => child.path === "src/components")
        const utils = src?.children.find((child) => child.path === "src/utils")

        expect(src?.fileCount).toBe(3)
        expect(components?.fileCount).toBe(2)
        expect(utils?.fileCount).toBe(1)
    })

    it("preserves ChangedFileInfo on leaf nodes including renamed files", () => {
        const tree = buildFileTree([
            changedFile("src/new-name.ts", "renamed", {
                oldPath: "src/old-name.ts",
                binary: true,
            }),
        ])

        const src = tree.find((node) => node.path === "src")
        const renamedFile = src?.children.find((child) => child.path === "src/new-name.ts")

        expect(renamedFile?.file).toMatchObject({
            path: "src/new-name.ts",
            oldPath: "src/old-name.ts",
            status: "renamed",
            binary: true,
        })
    })

    it("splits both forward and backslash separators", () => {
        const tree = buildFileTree([changedFile("src\\components\\Button.tsx")])
        expect(tree.map((node) => node.path)).toEqual(["src"])
        expect(tree[0].children[0].path).toBe("src/components")
        expect(tree[0].children[0].children[0].path).toBe("src/components/Button.tsx")
    })
})

describe("flattenFileTree", () => {
    it("returns all nodes when all directories are expanded", () => {
        const tree = buildFileTree([changedFile("src/nested/b.ts"), changedFile("src/a.ts"), changedFile("README.md")])
        const flat = flattenFileTree(tree, collectAllDirPaths(tree))

        expect(flat.map((entry) => entry.node.path)).toEqual(["src", "src/nested", "src/nested/b.ts", "src/a.ts", "README.md"])
    })

    it("hides descendants of collapsed directories", () => {
        const tree = buildFileTree([changedFile("src/nested/b.ts"), changedFile("src/a.ts"), changedFile("README.md")])
        const flat = flattenFileTree(tree, new Set(["src"]))

        expect(flat.map((entry) => entry.node.path)).toEqual(["src", "src/nested", "src/a.ts", "README.md"])
    })

    it("assigns correct depth values for indentation", () => {
        const tree = buildFileTree([changedFile("src/nested/b.ts"), changedFile("README.md")])
        const flat = flattenFileTree(tree, collectAllDirPaths(tree))

        expect(flat.map((entry) => ({ path: entry.node.path, depth: entry.depth }))).toEqual([
            { path: "src", depth: 0 },
            { path: "src/nested", depth: 1 },
            { path: "src/nested/b.ts", depth: 2 },
            { path: "README.md", depth: 0 },
        ])
    })
})

describe("collectAllDirPaths", () => {
    it("returns all directory paths in tree", () => {
        const tree = buildFileTree([changedFile("src/components/Button.tsx"), changedFile("src/utils/format.ts"), changedFile("docs/guide.md")])

        expect([...collectAllDirPaths(tree)].sort()).toEqual(["docs", "src", "src/components", "src/utils"])
    })

    it("returns empty set for files at root only", () => {
        const tree = buildFileTree([changedFile("README.md"), changedFile("package.json")])
        expect([...collectAllDirPaths(tree)]).toEqual([])
    })
})
