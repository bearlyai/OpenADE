/**
 * Files API Bridge
 *
 * Client-side API for file search operations over the trusted local runtime
 * transport.
 */

import type {
    RuntimeNodeContentSearchParams,
    RuntimeNodeContentSearchResponse,
    RuntimeNodeDescribePathParams,
    RuntimeNodeDescribePathResponse,
    RuntimeNodeFuzzySearchParams,
    RuntimeNodeFuzzySearchResponse,
    RuntimeNodePathEntry,
    RuntimeNodeTreeChild,
    RuntimeNodeTreeMatch,
} from "../../../runtime-node/src/files"

export type FuzzySearchParams = RuntimeNodeFuzzySearchParams
export type TreeChild = RuntimeNodeTreeChild
export type TreeMatch = RuntimeNodeTreeMatch
export type FuzzySearchResponse = RuntimeNodeFuzzySearchResponse
type DescribePathParams = RuntimeNodeDescribePathParams
export type PathEntry = RuntimeNodePathEntry
export type DescribePathResponse = RuntimeNodeDescribePathResponse
type ContentSearchParams = RuntimeNodeContentSearchParams
type ContentSearchResponse = RuntimeNodeContentSearchResponse

// ============================================================================
// API Check
// ============================================================================

import { isCodeModuleAvailable } from "./capabilities"
import { localRuntimeClient } from "../runtime/localRuntimeClient"

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

    return localRuntimeClient.request<FuzzySearchResponse>("fs/search/fuzzy", params)
}

async function describePath(params: DescribePathParams): Promise<DescribePathResponse> {
    if (!window.openadeAPI) {
        throw new Error("Not running in Electron")
    }

    return localRuntimeClient.request<DescribePathResponse>("fs/path/describe", params)
}

async function contentSearch(params: ContentSearchParams): Promise<ContentSearchResponse> {
    if (!window.openadeAPI) {
        throw new Error("Not running in Electron")
    }

    return localRuntimeClient.request<ContentSearchResponse>("fs/search/content", params)
}

export function isFilesApiAvailable(): boolean {
    return isCodeModuleAvailable()
}

export function getFilePreviewUrl(path: string): string {
    return `openade-file://image?path=${encodeURIComponent(path)}`
}

export const filesApi = {
    fuzzySearch,
    describePath,
    contentSearch,
    getFilePreviewUrl,
    isAvailable: isFilesApiAvailable,
}
