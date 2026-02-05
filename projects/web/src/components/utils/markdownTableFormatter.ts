/**
 * Markdown Table Formatter
 *
 * Formats markdown tables for consistent, readable display.
 * Inspired by markdown-table-prettify but implemented in TypeScript
 * without external dependencies.
 *
 * Features:
 * - Aligns columns based on content width
 * - Preserves alignment markers (:--, --:, :-:)
 * - Handles CJK characters (double-width display)
 * - Preserves indentation
 * - Skips tables inside code blocks
 */

// ============================================================================
// Types
// ============================================================================

type Alignment = "left" | "center" | "right" | "none"

interface TableInfo {
    startLine: number
    endLine: number
    indent: string
    headerRow: string[]
    separatorRow: string[]
    bodyRows: string[][]
    alignments: Alignment[]
}

// ============================================================================
// Character Width Utilities
// ============================================================================

/**
 * Check if a character is a CJK (Chinese, Japanese, Korean) character
 * that renders as double-width in monospace fonts.
 */
function isCJKChar(char: string): boolean {
    const code = char.charCodeAt(0)
    return (
        // CJK Unified Ideographs
        (code >= 0x4e00 && code <= 0x9fff) ||
        // CJK Unified Ideographs Extension A
        (code >= 0x3400 && code <= 0x4dbf) ||
        // CJK Unified Ideographs Extension B-F (requires surrogate pairs)
        (code >= 0x20000 && code <= 0x2ebef) ||
        // Hiragana
        (code >= 0x3040 && code <= 0x309f) ||
        // Katakana
        (code >= 0x30a0 && code <= 0x30ff) ||
        // Hangul Syllables
        (code >= 0xac00 && code <= 0xd7af) ||
        // Fullwidth Forms
        (code >= 0xff00 && code <= 0xffef)
    )
}

/**
 * Calculate the display width of a string, accounting for CJK characters.
 */
function getDisplayWidth(str: string): number {
    let width = 0
    for (const char of str) {
        width += isCJKChar(char) ? 2 : 1
    }
    return width
}

/**
 * Pad a string to a target display width.
 */
function padToWidth(str: string, targetWidth: number, alignment: Alignment): string {
    const currentWidth = getDisplayWidth(str)
    const padding = targetWidth - currentWidth

    if (padding <= 0) return str

    switch (alignment) {
        case "right":
            return " ".repeat(padding) + str
        case "center": {
            const leftPad = Math.floor(padding / 2)
            const rightPad = padding - leftPad
            return " ".repeat(leftPad) + str + " ".repeat(rightPad)
        }
        default: // left or none
            return str + " ".repeat(padding)
    }
}

// ============================================================================
// Table Parsing
// ============================================================================

/**
 * Check if a line looks like a table row (has pipes).
 */
function isTableRow(line: string): boolean {
    const trimmed = line.trim()
    return trimmed.includes("|")
}

/**
 * Check if a line is a separator row (contains only |, -, :, and spaces).
 */
function isSeparatorRow(line: string): boolean {
    const trimmed = line.trim()
    // Must have at least one pipe and one dash
    if (!trimmed.includes("|") || !trimmed.includes("-")) return false
    // Should only contain valid separator characters
    return /^[\s|:\-]+$/.test(trimmed)
}

/**
 * Parse alignment from a separator cell.
 */
function parseAlignment(cell: string): Alignment {
    const trimmed = cell.trim()
    const hasLeft = trimmed.startsWith(":")
    const hasRight = trimmed.endsWith(":")

    if (hasLeft && hasRight) return "center"
    if (hasRight) return "right"
    if (hasLeft) return "left"
    return "none"
}

/**
 * Split a table row into cells.
 */
function splitRow(line: string): string[] {
    // Remove leading/trailing pipes and split
    let trimmed = line.trim()

    // Handle leading pipe
    if (trimmed.startsWith("|")) {
        trimmed = trimmed.slice(1)
    }

    // Handle trailing pipe
    if (trimmed.endsWith("|")) {
        trimmed = trimmed.slice(0, -1)
    }

    return trimmed.split("|").map((cell) => cell.trim())
}

/**
 * Find the indentation of a line.
 */
function getIndent(line: string): string {
    const match = line.match(/^(\s*)/)
    return match ? match[1] : ""
}

/**
 * Find all tables in the markdown content.
 */
function findTables(lines: string[]): TableInfo[] {
    const tables: TableInfo[] = []
    let inCodeBlock = false
    let i = 0

    while (i < lines.length) {
        const line = lines[i]

        // Track code blocks (don't format tables inside them)
        if (line.trim().startsWith("```")) {
            inCodeBlock = !inCodeBlock
            i++
            continue
        }

        if (inCodeBlock) {
            i++
            continue
        }

        // Look for separator row (always the second row of a table)
        if (isSeparatorRow(line) && i > 0 && isTableRow(lines[i - 1])) {
            const headerLine = lines[i - 1]
            const indent = getIndent(headerLine)
            const headerRow = splitRow(headerLine)
            const separatorRow = splitRow(line)
            const alignments = separatorRow.map(parseAlignment)

            // Collect body rows
            const bodyRows: string[][] = []
            let j = i + 1
            while (j < lines.length && isTableRow(lines[j]) && !isSeparatorRow(lines[j])) {
                // Check if still part of the table (same or compatible structure)
                const row = splitRow(lines[j])
                // Allow rows with different cell counts (markdown is flexible)
                bodyRows.push(row)
                j++
            }

            tables.push({
                startLine: i - 1,
                endLine: j - 1,
                indent,
                headerRow,
                separatorRow,
                bodyRows,
                alignments,
            })

            i = j
        } else {
            i++
        }
    }

    return tables
}

// ============================================================================
// Table Formatting
// ============================================================================

/**
 * Format a single table.
 */
function formatTable(table: TableInfo): string[] {
    const { indent, headerRow, bodyRows, alignments } = table
    const allRows = [headerRow, ...bodyRows]

    // Calculate the number of columns (max across all rows)
    const numCols = Math.max(headerRow.length, alignments.length, ...bodyRows.map((r) => r.length))

    // Ensure all rows have the same number of cells
    const normalizedRows = allRows.map((row) => {
        const normalized = [...row]
        while (normalized.length < numCols) {
            normalized.push("")
        }
        return normalized
    })

    // Ensure alignments array has the right length
    const normalizedAlignments = [...alignments]
    while (normalizedAlignments.length < numCols) {
        normalizedAlignments.push("none")
    }

    // Calculate column widths (minimum 3 for separator dashes)
    const colWidths = new Array<number>(numCols).fill(3)
    for (const row of normalizedRows) {
        for (let col = 0; col < numCols; col++) {
            const cellWidth = getDisplayWidth(row[col])
            colWidths[col] = Math.max(colWidths[col], cellWidth)
        }
    }

    // Format header row
    const formattedHeader = indent + "| " + normalizedRows[0].map((cell, col) => padToWidth(cell, colWidths[col], normalizedAlignments[col])).join(" | ") + " |"

    // Format separator row
    const formattedSeparator =
        indent +
        "| " +
        normalizedAlignments
            .map((align, col) => {
                const width = colWidths[col]
                const dashes = "-".repeat(width)
                switch (align) {
                    case "left":
                        return ":" + dashes.slice(1)
                    case "right":
                        return dashes.slice(1) + ":"
                    case "center":
                        return ":" + dashes.slice(2) + ":"
                    default:
                        return dashes
                }
            })
            .join(" | ") +
        " |"

    // Format body rows
    const formattedBody = normalizedRows
        .slice(1)
        .map((row) => indent + "| " + row.map((cell, col) => padToWidth(cell, colWidths[col], normalizedAlignments[col])).join(" | ") + " |")

    return [formattedHeader, formattedSeparator, ...formattedBody]
}

// ============================================================================
// Public API
// ============================================================================

export interface FormatOptions {
    /** Minimum column padding (default: 1, included in the formatting) */
    minColumnWidth?: number
}

/**
 * Format all markdown tables in a string.
 *
 * @param markdown - The markdown content to format
 * @param options - Formatting options
 * @returns The formatted markdown content
 *
 * @example
 * ```typescript
 * const input = `
 * |Name|Age|City|
 * |---|---|---|
 * |Alice|30|NYC|
 * |Bob|25|LA|
 * `
 *
 * const output = formatMarkdownTables(input)
 * // Result:
 * // | Name  | Age | City |
 * // |-------|-----|------|
 * // | Alice | 30  | NYC  |
 * // | Bob   | 25  | LA   |
 * ```
 */
export function formatMarkdownTables(markdown: string, _options: FormatOptions = {}): string {
    const lines = markdown.split("\n")
    const tables = findTables(lines)

    if (tables.length === 0) {
        return markdown
    }

    // Process tables in reverse order to maintain line indices
    const result = [...lines]
    for (let i = tables.length - 1; i >= 0; i--) {
        const table = tables[i]
        const formattedLines = formatTable(table)
        const deleteCount = table.endLine - table.startLine + 1
        result.splice(table.startLine, deleteCount, ...formattedLines)
    }

    return result.join("\n")
}

/**
 * Check if a file path suggests it's a markdown file.
 */
function isMarkdownFile(filePath: string): boolean {
    const lower = filePath.toLowerCase()
    return lower.endsWith(".md") || lower.endsWith(".markdown") || lower.endsWith(".mdx")
}

/**
 * Check if a language identifier indicates markdown.
 */
function isMarkdownLanguage(lang: string | undefined): boolean {
    if (!lang) return false
    const lower = lang.toLowerCase()
    return lower === "markdown" || lower === "md" || lower === "mdx"
}

/**
 * Check if a file should be treated as markdown based on name or language.
 */
export function shouldFormatAsMarkdown(fileName: string, lang?: string): boolean {
    return isMarkdownFile(fileName) || isMarkdownLanguage(lang)
}
