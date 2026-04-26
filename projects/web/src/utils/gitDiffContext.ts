export const DIFF_CONTEXT_OPTIONS = [
    { id: 1, label: "1 line" },
    { id: 3, label: "3 lines" },
    { id: 10, label: "10 lines" },
    { id: 25, label: "25 lines" },
    { id: 100, label: "100 lines" },
] as const

export type DiffContextSetting = (typeof DIFF_CONTEXT_OPTIONS)[number]["id"]
export type PatchContextLines = DiffContextSetting
export type DiffViewMode = "current" | "split" | "unified"

export const DEFAULT_DIFF_CONTEXT: DiffContextSetting = 3

export function getPatchContextLines(value: DiffContextSetting): PatchContextLines {
    return value
}

export function shouldUsePatchDiff(viewMode: DiffViewMode, diffContext: DiffContextSetting): boolean {
    return viewMode !== "current" && Number.isInteger(diffContext)
}

export function getChangesLoadMode(viewMode: DiffViewMode, diffContext: DiffContextSetting): "current" | "unified" {
    return shouldUsePatchDiff(viewMode, diffContext) ? "unified" : "current"
}
