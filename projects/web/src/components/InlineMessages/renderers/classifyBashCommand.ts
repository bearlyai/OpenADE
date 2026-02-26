/**
 * Classifies bash commands by semantic intent for user-friendly rendering.
 *
 * Codex emits raw shell commands like `/bin/zsh -lc "rg \"pattern\" -n"`
 * which are opaque to users. This utility strips shell wrappers and maps
 * the inner command to a semantic type (search, read, list, edit) with a
 * human-friendly label used by the bash pill/row renderer.
 */

export type BashSemanticType = "search" | "read" | "list" | "edit" | "git" | "bash"

export interface ClassifiedCommand {
    /** The inner command after stripping shell wrappers */
    innerCommand: string
    /** Semantic classification */
    semanticType: BashSemanticType
    /** Human-friendly label for pill/row display */
    label: string
}

/**
 * Strip shell wrappers like `/bin/zsh -lc "..."` or `/bin/bash -lc '...'`
 * to extract the actual command being run.
 */
export function stripShellWrapper(command: string): string {
    // Match: /bin/zsh -lc "..." or /bin/bash -lc '...' or bare zsh/bash/sh -lc
    const match = command.match(/^(?:\/\w+\/)?(?:zsh|bash|sh)\s+-\w*l\w*c\s+(['"])(.*)\1$/s)
    if (match) return match[2]
    return command
}

/**
 * Classify a bash command's semantic intent and produce a friendly label.
 * Handles compound commands (&&, ||, ;, |) by classifying each segment
 * and picking the most specific/interesting one.
 */
export function classifyBashCommand(rawCommand: string): ClassifiedCommand {
    const inner = stripShellWrapper(rawCommand)

    // Split on && / || / ; to get independent command chains, then split
    // each chain on | (outside quotes) to get pipe segments. Classify each
    // segment and pick the most specific result.
    const chains = splitOutsideQuotes(inner, /\s*(?:&&|\|\||;)\s*/)
    let best: { semanticType: BashSemanticType; label: string } | null = null

    for (const chain of chains) {
        const segments = splitOutsideQuotes(chain, /\s*\|\s*/)
        for (const segment of segments) {
            const result = classifySegment(segment.trim())
            if (result && (!best || PRIORITY[result.semanticType] > PRIORITY[best.semanticType])) {
                best = result
            }
        }
        // Also classify the full chain (for piped-read patterns like "nl file | sed -n ...")
        const chainResult = classifyChain(chain.trim())
        if (chainResult && (!best || PRIORITY[chainResult.semanticType] > PRIORITY[best.semanticType])) {
            best = chainResult
        }
    }

    if (best && best.semanticType !== "bash") {
        return { innerCommand: inner, ...best }
    }
    return { innerCommand: inner, semanticType: "bash", label: extractFallbackLabel(inner, chains) }
}

/** Priority for picking the most interesting classification from a compound command */
const PRIORITY: Record<BashSemanticType, number> = {
    bash: 0,
    list: 1,
    read: 2,
    git: 3,
    search: 4,
    edit: 5,
}

/** Classify a single command segment (no pipes, no &&) */
function classifySegment(segment: string): { semanticType: BashSemanticType; label: string } | null {
    const trimmed = segment.trimStart()
    if (!trimmed) return null

    // --- Edit patterns (check before read to catch sed -i before sed -n) ---
    if (/^sed\s+.*-i/.test(trimmed) || /^sed\s+-i/.test(trimmed)) {
        return { semanticType: "edit", label: "Edit file" }
    }
    if (/^patch\s/.test(trimmed)) {
        return { semanticType: "edit", label: "Patch file" }
    }

    // --- Search patterns ---
    if (/^(rg|grep|ag)\s/.test(trimmed)) {
        return { semanticType: "search", label: summarizeSearch(trimmed) }
    }
    if (/^(find|fd)\s/.test(trimmed)) {
        return { semanticType: "search", label: "Find files" }
    }

    // --- Read patterns ---
    if (/^(cat|head|tail|less|more|bat|nl|wc)\s/.test(trimmed)) {
        return { semanticType: "read", label: summarizeRead(trimmed) }
    }
    // sed -n (print specific lines) without -i
    if (/^sed\s/.test(trimmed) && /\s-n[\s]/.test(` ${trimmed} `)) {
        return { semanticType: "read", label: summarizeRead(trimmed) }
    }
    // sed without -n is a substitution/replacement (Codex uses sed for surgical edits)
    if (/^sed\s/.test(trimmed)) {
        return { semanticType: "edit", label: "Edit file" }
    }

    // --- List patterns ---
    if (/^(ls|tree)(\s|$)/.test(trimmed)) {
        return { semanticType: "list", label: "List files" }
    }

    // --- Git patterns ---
    if (/^git\s/.test(trimmed)) {
        return { semanticType: "git", label: summarizeGit(trimmed) }
    }

    return null
}

/** Classify a full pipe chain for patterns that span pipes (e.g., "nl file | sed -n ...") */
function classifyChain(chain: string): { semanticType: BashSemanticType; label: string } | null {
    // Piped commands ending in sed -n / head / tail are reads
    if (/\|\s*(sed\s+-n|head|tail)\s/.test(chain)) {
        return { semanticType: "read", label: summarizeRead(chain) }
    }
    return null
}

function summarizeSearch(cmd: string): string {
    // Try to extract the search pattern from rg/grep/ag
    // Matches: rg "pattern", rg 'pattern', rg pattern (first non-flag arg)
    const patternMatch = cmd.match(/^(?:rg|grep|ag)\s+(?:[^\s"'-][^\s]*|"([^"]*)"|'([^']*)')/)
    const pattern = patternMatch?.[1] ?? patternMatch?.[2] ?? extractFirstNonFlagArg(cmd)
    if (pattern && isCleanPattern(pattern)) return `Search: ${truncate(pattern, 30)}`
    return "Search"
}

function summarizeGit(cmd: string): string {
    // Extract the git subcommand (e.g., "diff", "log", "show", "status")
    const subcommand = cmd.match(/^git\s+(\S+)/)?.[1]
    if (subcommand) return `Git: ${subcommand}`
    return "Git"
}

/** Check if a search pattern is clean enough to display as a label */
function isCleanPattern(pattern: string): boolean {
    // Reject patterns that are mostly regex/escape noise
    if (/[\\|{}()\[\]^$*+?]/.test(pattern)) return false
    // Reject patterns with multiple pipe-separated alternatives (multi-pattern searches)
    if (pattern.includes("|")) return false
    // Reject very short patterns (likely flags or noise)
    if (pattern.length < 2) return false
    return true
}

function summarizeRead(cmd: string): string {
    // Extract the filename from the last non-flag, non-pipe argument
    // For piped commands like "nl -ba file.tsx | sed -n '100,190p'", get file from the first command
    const beforePipe = cmd.split("|")[0].trim()
    const parts = beforePipe.split(/\s+/)
    const filePart = parts.filter((p) => !p.startsWith("-") && p !== parts[0]).pop()
    if (filePart) {
        const filename = filePart.split("/").pop() || filePart
        return `Read ${truncate(filename, 30)}`
    }
    return "Read file"
}

function extractFirstNonFlagArg(cmd: string): string | undefined {
    const parts = cmd.split(/\s+/)
    // Skip command name (index 0), then find first arg that isn't a flag
    for (let i = 1; i < parts.length; i++) {
        if (!parts[i].startsWith("-")) return parts[i]
    }
    return undefined
}

/** Commands that are navigational/environmental — not interesting as a label */
const BORING_COMMANDS = new Set([
    "cd",
    "pwd",
    "echo",
    "export",
    "source",
    ".",
    "true",
    "false",
    "mkdir",
    "pushd",
    "popd",
    "set",
    "unset",
    "env",
    "test",
    "[",
    "printf",
])

/** Multi-word command prefixes where the subcommand matters (e.g., "go test", "npm run") */
const MULTI_WORD_PREFIXES = new Set(["go", "npm", "yarn", "pnpm", "bun", "cargo", "docker", "kubectl", "dotnet"])

/**
 * When no segment classifies to a known type, extract the interesting command
 * names from the compound command for a more readable fallback label.
 */
function extractFallbackLabel(inner: string, chains: string[]): string {
    const interesting: string[] = []
    for (const chain of chains) {
        const segments = splitOutsideQuotes(chain, /\s*\|\s*/)
        for (const segment of segments) {
            const name = extractCommandName(segment.trim())
            if (name && !BORING_COMMANDS.has(name.split(" ")[0])) {
                interesting.push(name)
            }
        }
    }
    if (interesting.length > 0) {
        return truncate(interesting.join(", "), 40)
    }
    return truncate(inner, 40)
}

/** Extract a human-readable command name, including subcommand for multi-word tools */
function extractCommandName(segment: string): string | null {
    const trimmed = segment.trimStart()
    if (!trimmed) return null
    const parts = trimmed.split(/\s+/)
    const cmd = parts[0]
    if (parts.length > 1 && MULTI_WORD_PREFIXES.has(cmd)) {
        return `${cmd} ${parts[1]}`
    }
    return cmd
}

/**
 * Split a command string on a delimiter pattern, but only when the delimiter
 * is outside of single or double quotes.
 */
function splitOutsideQuotes(input: string, delimiter: RegExp): string[] {
    const results: string[] = []
    let current = ""
    let inSingle = false
    let inDouble = false

    for (let i = 0; i < input.length; i++) {
        const ch = input[i]
        if (ch === "'" && !inDouble) {
            inSingle = !inSingle
            current += ch
        } else if (ch === '"' && !inSingle) {
            inDouble = !inDouble
            current += ch
        } else if (!inSingle && !inDouble) {
            // Try to match the delimiter at this position
            const remaining = input.slice(i)
            const match = remaining.match(new RegExp(`^${delimiter.source}`))
            if (match) {
                results.push(current)
                current = ""
                i += match[0].length - 1 // -1 because the loop increments
                continue
            }
            current += ch
        } else {
            current += ch
        }
    }
    if (current) results.push(current)
    return results
}

function truncate(s: string, max: number): string {
    return s.length > max ? `${s.slice(0, max)}...` : s
}
