/**
 * Files API Bridge
 *
 * Client-side API for file search operations.
 * Communicates with Electron main process via openadeAPI.
 */

// ============================================================================
// Type Definitions
// IMPORTANT: Keep in sync with projects/electron/src/modules/code/files.ts
// ============================================================================

export interface FuzzySearchParams {
    dir: string
    query: string
    matchDirs: boolean
    limit?: number
}

export interface TreeChild {
    name: string
    isDir: boolean
    fullPath: string
}

export interface TreeMatch {
    path: string
    children: TreeChild[]
}

export interface FuzzySearchResponse {
    results: string[]
    truncated: boolean
    source: "git" | "ripgrep" | "fs"
    treeMatch?: TreeMatch
}

// ============================================================================
// describePath Types
// ============================================================================

interface DescribePathParams {
    path: string
    readContents?: boolean
    maxReadSize?: number
    showHidden?: boolean
}

export interface PathEntry {
    name: string
    path: string
    isDir: boolean
    isSymlink: boolean
    size: number
    mode: number
}

export type DescribePathResponse =
    | { type: "dir"; path: string; mode: number; entries: PathEntry[] }
    | { type: "file"; path: string; size: number; mode: number; content: string | null; tooLarge: boolean; isReadable: boolean }
    | { type: "not_found"; path: string }
    | { type: "error"; path: string; message: string }

// ============================================================================
// Content Search Types
// IMPORTANT: Keep in sync with projects/electron/src/modules/code/files.ts
// ============================================================================

interface ContentSearchParams {
    dir: string
    query: string
    limit?: number // default 100
    caseSensitive?: boolean
    regex?: boolean
    rankByHotFiles?: boolean // if true, rank results by git commit frequency
}

export interface ContentSearchMatch {
    file: string // relative path from dir
    line: number // 1-indexed
    content: string // full line content
    matchStart: number // character offset in content where match starts
    matchEnd: number // character offset in content where match ends
}

interface ContentSearchResponse {
    matches: ContentSearchMatch[]
    truncated: boolean
}

// ============================================================================
// API Check
// ============================================================================

import { isCodeModuleAvailable } from "./capabilities"

// ============================================================================
// Files API Functions
// ============================================================================

/**
 * Fuzzy search for files or directories in a given directory
 *
 * Uses the best available method:
 * 1. git ls-files (if in a git repo)
 * 2. ripgrep (if available in PATH or vendored)
 * 3. filesystem walk (fallback)
 */
export async function fuzzySearch(params: FuzzySearchParams): Promise<FuzzySearchResponse> {
    if (!window.openadeAPI) {
        throw new Error("Not running in Electron")
    }

    return (await window.openadeAPI.files.fuzzySearch(params)) as FuzzySearchResponse
}

async function describePath(params: DescribePathParams): Promise<DescribePathResponse> {
    if (!window.openadeAPI) {
        throw new Error("Not running in Electron")
    }

    return (await window.openadeAPI.files.describePath(params)) as DescribePathResponse
}

async function contentSearch(params: ContentSearchParams): Promise<ContentSearchResponse> {
    if (!window.openadeAPI) {
        throw new Error("Not running in Electron")
    }

    return (await window.openadeAPI.files.contentSearch(params)) as ContentSearchResponse
}

export function isFilesApiAvailable(): boolean {
    return isCodeModuleAvailable()
}

export const filesApi = {
    fuzzySearch,
    describePath,
    contentSearch,
    isAvailable: isFilesApiAvailable,
}
