import { describe, expect, it } from "vitest"
import { getDisambiguatedPaths, getFileDir, getFileName, slugify } from "./paths"

describe("getFileName", () => {
    it("extracts filename from path", () => {
        expect(getFileName("src/components/Button.tsx")).toBe("Button.tsx")
        expect(getFileName("Button.tsx")).toBe("Button.tsx")
        expect(getFileName("a/b/c/d.ts")).toBe("d.ts")
    })
})

describe("getFileDir", () => {
    it("extracts directory from path", () => {
        expect(getFileDir("src/components/Button.tsx")).toBe("src/components")
        expect(getFileDir("Button.tsx")).toBe("")
        expect(getFileDir("a/b/c/d.ts")).toBe("a/b/c")
    })
})

describe("slugify", () => {
    it("converts to lowercase and replaces spaces with hyphens", () => {
        expect(slugify("My Cool Idea")).toBe("my-cool-idea")
    })

    it("replaces special characters with hyphens", () => {
        expect(slugify("hello@world!")).toBe("hello-world")
        expect(slugify("foo/bar\\baz")).toBe("foo-bar-baz")
    })

    it("collapses consecutive hyphens", () => {
        expect(slugify("hello   world")).toBe("hello-world")
        expect(slugify("a---b")).toBe("a-b")
    })

    it("trims leading and trailing hyphens", () => {
        expect(slugify("  hello  ")).toBe("hello")
        expect(slugify("--hello--")).toBe("hello")
        expect(slugify("!hello!")).toBe("hello")
    })

    it("handles empty and whitespace-only input", () => {
        expect(slugify("")).toBe("")
        expect(slugify("   ")).toBe("")
        expect(slugify("!!!")).toBe("")
    })

    it("preserves numbers", () => {
        expect(slugify("version 2.0")).toBe("version-2-0")
        expect(slugify("123abc")).toBe("123abc")
    })

    it("handles unicode characters", () => {
        expect(slugify("caf\u00e9 latt\u00e9")).toBe("caf-latt")
    })
})

describe("getDisambiguatedPaths", () => {
    it("returns just filename when all unique", () => {
        const files = ["src/Button.tsx", "lib/Card.tsx", "utils/helpers.ts"]
        const result = getDisambiguatedPaths(files)

        expect(result.get("src/Button.tsx")).toBe("Button.tsx")
        expect(result.get("lib/Card.tsx")).toBe("Card.tsx")
        expect(result.get("utils/helpers.ts")).toBe("helpers.ts")
    })

    it("adds parent dir when filenames conflict", () => {
        const files = ["src/a/Button.tsx", "src/b/Button.tsx"]
        const result = getDisambiguatedPaths(files)

        expect(result.get("src/a/Button.tsx")).toBe("a/Button.tsx")
        expect(result.get("src/b/Button.tsx")).toBe("b/Button.tsx")
    })

    it("adds multiple parent dirs when needed", () => {
        const files = ["x/a/index.ts", "y/a/index.ts"]
        const result = getDisambiguatedPaths(files)

        expect(result.get("x/a/index.ts")).toBe("x/a/index.ts")
        expect(result.get("y/a/index.ts")).toBe("y/a/index.ts")
    })

    it("handles mixed duplicates", () => {
        const files = ["a/b/index.ts", "a/c/index.ts", "x/c/index.ts"]
        const result = getDisambiguatedPaths(files)

        expect(result.get("a/b/index.ts")).toBe("b/index.ts")
        expect(result.get("a/c/index.ts")).toBe("a/c/index.ts")
        expect(result.get("x/c/index.ts")).toBe("x/c/index.ts")
    })

    it("handles empty input", () => {
        const result = getDisambiguatedPaths([])
        expect(result.size).toBe(0)
    })

    it("handles single file", () => {
        const result = getDisambiguatedPaths(["src/components/Button.tsx"])
        expect(result.get("src/components/Button.tsx")).toBe("Button.tsx")
    })

    it("handles files with no directory", () => {
        const files = ["Button.tsx", "Card.tsx"]
        const result = getDisambiguatedPaths(files)

        expect(result.get("Button.tsx")).toBe("Button.tsx")
        expect(result.get("Card.tsx")).toBe("Card.tsx")
    })

    it("handles deeply nested paths", () => {
        const files = ["projects/dashboard/src/pages/code/index.ts", "projects/api/src/pages/code/index.ts"]
        const result = getDisambiguatedPaths(files)

        expect(result.get("projects/dashboard/src/pages/code/index.ts")).toBe("dashboard/src/pages/code/index.ts")
        expect(result.get("projects/api/src/pages/code/index.ts")).toBe("api/src/pages/code/index.ts")
    })
})
