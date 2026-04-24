export const DIFF_CONTEXT_OPTIONS = [
    { id: 0, label: "Changed only" },
    { id: 3, label: "3 lines" },
    { id: 10, label: "10 lines" },
    { id: 25, label: "25 lines" },
    { id: "full", label: "Whole file" },
] as const

export type DiffContextSetting = (typeof DIFF_CONTEXT_OPTIONS)[number]["id"]
export type PatchContextLines = Exclude<DiffContextSetting, "full">
export type DiffViewMode = "current" | "split" | "unified"

export const DEFAULT_DIFF_CONTEXT: DiffContextSetting = 3

export function isWholeFileDiffContext(value: DiffContextSetting): value is "full" {
    return value === "full"
}

export function getPatchContextLines(value: DiffContextSetting): PatchContextLines {
    return value === "full" ? 3 : value
}

export function shouldUsePatchDiff(viewMode: DiffViewMode, diffContext: DiffContextSetting): boolean {
    return viewMode !== "current" && !isWholeFileDiffContext(diffContext)
}

export function getChangesLoadMode(viewMode: DiffViewMode, diffContext: DiffContextSetting): "current" | "unified" {
    return shouldUsePatchDiff(viewMode, diffContext) ? "unified" : "current"
}
