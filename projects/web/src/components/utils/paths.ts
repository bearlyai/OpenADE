/**
 * Cross-platform path utilities
 *
 * These functions handle both Unix (/) and Windows (\) path separators.
 * All functions are designed to work regardless of the current platform.
 */

import { getPathSeparator } from "../../electronAPI/platform"

/**
 * Regex to split paths on both forward and back slashes
 */
const PATH_SEPARATOR_REGEX = /[/\\]/

/**
 * Split a path into its component parts.
 * Handles both "/" and "\\" separators.
 *
 * Example: "src/components/Button.tsx" -> ["src", "components", "Button.tsx"]
 * Example: "C:\\Users\\file.txt" -> ["C:", "Users", "file.txt"]
 */
export function splitPath(path: string): string[] {
    return path.split(PATH_SEPARATOR_REGEX).filter(Boolean)
}

/**
 * Extract just the filename from a file path.
 * Handles both "/" and "\\" separators.
 *
 * Example: "src/components/Button.tsx" -> "Button.tsx"
 * Example: "C:\\Users\\file.txt" -> "file.txt"
 */
export function getFileName(path: string): string {
    const parts = splitPath(path)
    return parts[parts.length - 1] || path
}

/**
 * Extract the directory portion of a file path.
 * Uses the platform's native separator for the result.
 *
 * Example (Unix): "src/components/Button.tsx" -> "src/components"
 * Example (Windows): "C:\\Users\\file.txt" -> "C:\\Users"
 */
export function getFileDir(path: string): string {
    const parts = splitPath(path)
    if (parts.length <= 1) return ""
    return parts.slice(0, -1).join(getPathSeparator())
}

/**
 * Normalize a path to use forward slashes consistently.
 * Useful for internal storage/comparison where we want consistent formatting.
 *
 * Example: "C:\\Users\\file.txt" -> "C:/Users/file.txt"
 */
function normalizePath(path: string): string {
    return path.replace(/\\/g, "/")
}

/**
 * Get relative path from a base path.
 * If the path starts with base, returns the remainder.
 * Handles both "/" and "\\" separators.
 *
 * Example: getRelativePath("/home/user/project", "/home/user/project/src/file.ts") -> "src/file.ts"
 */
export function getRelativePath(basePath: string, fullPath: string): string {
    const normalizedBase = normalizePath(basePath)
    const normalizedFull = normalizePath(fullPath)

    if (normalizedFull.startsWith(normalizedBase)) {
        let relative = normalizedFull.slice(normalizedBase.length)
        // Remove leading separator if present
        if (relative.startsWith("/")) {
            relative = relative.slice(1)
        }
        return relative
    }
    return fullPath
}

/**
 * Compute disambiguated short paths for a list of file paths.
 * Shows filename, adding parent dirs only when needed to distinguish duplicates.
 * Handles both "/" and "\\" separators.
 *
 * Algorithm:
 * 1. Start with just the filename
 * 2. For any duplicates, add parent dir until unique
 *
 * Examples:
 * - ["src/a/Button.tsx", "src/b/Button.tsx"] -> ["a/Button.tsx", "b/Button.tsx"]
 * - ["src/Button.tsx", "lib/Card.tsx"] -> ["Button.tsx", "Card.tsx"]
 * - ["a/b/index.ts", "a/c/index.ts", "x/c/index.ts"] -> ["b/index.ts", "a/c/index.ts", "x/c/index.ts"]
 */
export function getDisambiguatedPaths(files: string[]): Map<string, string> {
    const result = new Map<string, string>()

    // Start with just filenames (split on both separators)
    const shortPaths = files.map((f) => {
        const parts = splitPath(f)
        return { full: f, parts, depth: 1 } // depth=1 means just filename
    })

    // Keep expanding until all are unique
    let hasChanges = true
    while (hasChanges) {
        hasChanges = false

        // Group by current short path
        const groups = new Map<string, typeof shortPaths>()
        for (const item of shortPaths) {
            const short = item.parts.slice(-item.depth).join("/")
            if (!groups.has(short)) {
                groups.set(short, [])
            }
            groups.get(short)!.push(item)
        }

        // For any group with duplicates, expand depth
        for (const group of groups.values()) {
            if (group.length > 1) {
                for (const item of group) {
                    if (item.depth < item.parts.length) {
                        item.depth++
                        hasChanges = true
                    }
                }
            }
        }
    }

    // Build result map (always use forward slash for display consistency)
    for (const item of shortPaths) {
        result.set(item.full, item.parts.slice(-item.depth).join("/"))
    }

    return result
}
