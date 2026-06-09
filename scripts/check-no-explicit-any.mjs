#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const ALLOW_COMMENT = "openade-allow-explicit-any"
const SELF_TEST_FLAG = "--self-test"
const SKIP_SELF_TEST_ENV = "OPENADE_SKIP_NO_ANY_SELF_TEST"
const SKIP_DIRS = new Set([".git", ".next", ".venvy", "build", "coverage", "dist", "external_repos", "node_modules", "output"])
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".go"])
const TEST_FILE_PATTERN = /(^|[/\\])(__tests__|tests?)([/\\])|(\.test|\.spec)\.[cm]?[tj]sx?$|_test\.go$/
const SCRIPT_PATH = fileURLToPath(import.meta.url)
const REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..")
const REVIEWED_BOUNDARY_EXCEPTION_ENTRIES = [
    {
        relativeFile: "projects/openade-core/internal/core/http.go",
        reason: "Go empty interface",
        allowReason: "net/http JSON responses encode several concrete DTO types through one helper.",
        sourceLine: "func (server *HTTPServer) writeJSON(response http.ResponseWriter, status int, value interface{}) {",
    },
    {
        relativeFile: "projects/openade-core/internal/core/protocol.go",
        reason: "Go empty interface",
        allowReason: "runtime JSON envelopes carry method-specific DTOs through one shared transport field.",
        sourceLine: "type JSONPayload interface{}",
    },
    {
        relativeFile: "projects/openade-core/internal/product/product.go",
        reason: "Go empty interface",
        allowReason: "encoding/json.Unmarshal requires a dynamic destination; callers pass concrete DTO pointers.",
        sourceLine: "func decodeObject(raw json.RawMessage, target interface{}) *core.RuntimeError {",
    },
    {
        relativeFile: "projects/openade-core/internal/storage/store.go",
        reason: "Go empty interface",
        allowReason: "mirrors database/sql Row.Scan and Rows.Scan destination contract.",
        sourceLine: "Scan(dest ...interface{}) error",
    },
]
const REVIEWED_BOUNDARY_EXCEPTIONS = new Set(
    REVIEWED_BOUNDARY_EXCEPTION_ENTRIES.map(({ relativeFile, reason, allowReason, sourceLine }) =>
        boundaryExceptionKeyFromParts(relativeFile, reason, allowReason, sourceLine),
    ),
)

const rawArgs = process.argv.slice(2)
const shouldRunSelfTest = rawArgs.includes(SELF_TEST_FLAG)
const roots = rawArgs.filter((arg) => arg !== SELF_TEST_FLAG)
const scanRoots = roots.length > 0 ? roots : ["projects", "scripts"]
const findings = []
const allowedFindings = new Map()

if (shouldRunSelfTest && process.env[SKIP_SELF_TEST_ENV] !== "1") {
    runInternalSelfTest()
}

for (const root of scanRoots) {
    walk(path.resolve(process.cwd(), root))
}

for (const exception of REVIEWED_BOUNDARY_EXCEPTION_ENTRIES) {
    const exceptionKey = boundaryExceptionKeyFromParts(exception.relativeFile, exception.reason, exception.allowReason, exception.sourceLine)
    if (reviewedExceptionIsInScan(exception.relativeFile) && !allowedFindings.has(exceptionKey)) {
        findings.push({
            file: path.resolve(REPO_ROOT, exception.relativeFile),
            line: 1,
            column: 1,
            reason: `${ALLOW_COMMENT} reviewed exception is stale or no longer matches source`,
        })
    }
}

if (findings.length > 0) {
    console.error("Explicit any is not allowed in non-test source files.")
    console.error(`Use concrete types, unknown, typed JSON boundary aliases, or add a reviewed narrow ${ALLOW_COMMENT}: reason comment.`)
    for (const finding of findings) {
        console.error(`${path.relative(process.cwd(), finding.file)}:${finding.line}:${finding.column} ${finding.reason}`)
    }
    process.exit(1)
}

const allowedSuffix =
    allowedFindings.size === 0 ? "" : ` (${allowedFindings.size} documented boundary exception${allowedFindings.size === 1 ? "" : "s"})`
console.log(`No explicit any in non-test source files under ${scanRoots.join(", ")}${allowedSuffix}`)

function walk(entryPath) {
    if (!fs.existsSync(entryPath)) {
        console.error(`Path does not exist: ${entryPath}`)
        process.exitCode = 1
        return
    }

    const stat = fs.statSync(entryPath)
    if (stat.isDirectory()) {
        const basename = path.basename(entryPath)
        if (SKIP_DIRS.has(basename)) return
        for (const child of fs.readdirSync(entryPath)) {
            walk(path.join(entryPath, child))
        }
        return
    }

    if (!stat.isFile()) return
    if (TEST_FILE_PATTERN.test(entryPath)) return
    if (!SOURCE_EXTENSIONS.has(sourceExtension(entryPath))) return

    scanFile(entryPath)
}

function sourceExtension(file) {
    if (file.endsWith(".d.ts")) return ".ts"
    return path.extname(file)
}

function scanFile(file) {
    const source = fs.readFileSync(file, "utf8")
    const stripped = stripCommentsAndStrings(source)
    const lines = source.split(/\r?\n/)

    if (file.endsWith(".go")) {
        collectPatternFindings(file, stripped, lines, /\bany\b/g, "Go any alias")
        collectPatternFindings(file, stripped, lines, /\binterface\s*\{\s*\}/g, "Go empty interface")
        return
    }

    const patterns = [
        { pattern: /:\s*any\b/g, reason: "explicit any annotation" },
        { pattern: /=\s*any\b/g, reason: "explicit any alias" },
        { pattern: /\bas\s+any\b/g, reason: "explicit any cast" },
        { pattern: /\bsatisfies\s+any\b/g, reason: "explicit any satisfies constraint" },
        { pattern: /\bextends\s+any\b/g, reason: "explicit any generic constraint" },
        { pattern: /=>\s*any\b/g, reason: "explicit any function return" },
        { pattern: /\bkeyof\s+any\b/g, reason: "explicit any keyof constraint" },
        { pattern: /<[^>\n]*\bany\b[^>\n]*>/g, reason: "explicit any generic argument" },
        { pattern: /<\s*\n\s*any\b/g, reason: "explicit any generic argument" },
        { pattern: /[\[,|&]\s*any\b/g, reason: "explicit any union, intersection, or tuple member" },
        { pattern: /\bany\s*(\[\]|[\],|&])/g, reason: "explicit any union, intersection, or tuple member" },
    ]

    for (const { pattern, reason } of patterns) {
        collectPatternFindings(file, stripped, lines, pattern, reason)
    }
}

function collectPatternFindings(file, stripped, originalLines, pattern, reason) {
    for (const match of stripped.matchAll(pattern)) {
        const index = match.index ?? 0
        const location = locationForIndex(stripped, index)
        const allow = findAllowComment(originalLines, location.line - 1)
        if (allow) {
            const sourceLine = originalLines[location.line - 1]?.trim() ?? ""
            const exceptionKey = boundaryExceptionKey(file, reason, allow.reason, sourceLine)
            if (!REVIEWED_BOUNDARY_EXCEPTIONS.has(exceptionKey)) {
                findings.push({
                    file,
                    line: location.line,
                    column: location.column,
                    reason: `${reason} has an unreviewed ${ALLOW_COMMENT} exception`,
                })
                continue
            }
            allowedFindings.set(exceptionKey, true)
            continue
        }
        findings.push({
            file,
            line: location.line,
            column: location.column,
            reason,
        })
    }
}

function findAllowComment(lines, lineIndex) {
    const sameLineReason = allowCommentReason(lines[lineIndex])
    if (sameLineReason) return { line: lines[lineIndex], reason: sameLineReason }

    for (let index = lineIndex - 1; index >= 0; index -= 1) {
        const line = lines[index]
        if (!line) return undefined
        const trimmed = line.trim()
        if (trimmed.length === 0) continue
        const reason = allowCommentReason(trimmed)
        return reason ? { line: trimmed, reason } : undefined
    }

    return undefined
}

function allowCommentReason(line) {
    if (!line) return false
    const markerIndex = line.indexOf(ALLOW_COMMENT)
    if (markerIndex < 0) return false
    if (!markerIsInsideComment(line, markerIndex)) return false
    const reason = line.slice(markerIndex + ALLOW_COMMENT.length).replace(/^[:\s-]+/, "").trim()
    return reason.length > 0 ? reason : false
}

function markerIsInsideComment(line, markerIndex) {
    const beforeMarker = line.slice(0, markerIndex)
    return beforeMarker.includes("//") || beforeMarker.includes("/*") || beforeMarker.trimStart().startsWith("*")
}

function locationForIndex(source, index) {
    let line = 1
    let column = 1
    for (let cursor = 0; cursor < index; cursor += 1) {
        if (source.charCodeAt(cursor) === 10) {
            line += 1
            column = 1
        } else {
            column += 1
        }
    }
    return { line, column }
}

function boundaryExceptionKey(file, reason, allowReason, sourceLine) {
    const relativeFile = path.relative(REPO_ROOT, file).split(path.sep).join("/")
    return boundaryExceptionKeyFromParts(relativeFile, reason, allowReason, sourceLine)
}

function boundaryExceptionKeyFromParts(relativeFile, reason, allowReason, sourceLine) {
    return `${relativeFile}\0${reason}\0${allowReason}\0${sourceLine}`
}

function runInternalSelfTest() {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openade-no-any-"))
    try {
        expectFixturePass(tempRoot, "passes-valid-and-test-only-any", {
            "src/ok.ts": [
                "const literal = \"value: any\"",
                "const comment = \"// as any\"",
                "export const typed: unknown = `${literal} ${comment}`",
                "",
            ].join("\n"),
            "src/ok.go": [
                "package sample",
                "// any and interface{} in comments are ignored.",
                "type DTO struct { Name string }",
                "",
            ].join("\n"),
            "src/fixture.test.ts": "export const allowedInTests: any = 1\n",
            "src/fixture_test.go": "package sample\nfunc TestAllowedAnyInTests(t any) {}\n",
        })
        expectFixtureFail(tempRoot, "fails-typescript-any", {
            "src/bad.ts": "export type Bad = Array<any>\n",
        }, "explicit any generic argument")
        expectFixtureFail(tempRoot, "fails-go-any", {
            "bad.go": "package sample\nfunc Bad(value any) {}\n",
        }, "Go any alias")
        expectFixtureFail(tempRoot, "fails-unreviewed-allow-comment", {
            "src/bad.ts": [
                "// openade-allow-explicit-any: local fixture should not be accepted",
                "export const bad: any = 1",
                "",
            ].join("\n"),
        }, "unreviewed openade-allow-explicit-any exception")
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true })
    }
}

function expectFixturePass(tempRoot, name, files) {
    const fixtureRoot = writeFixture(tempRoot, name, files)
    runScannerForFixture(fixtureRoot)
}

function expectFixtureFail(tempRoot, name, files, expectedOutput) {
    const fixtureRoot = writeFixture(tempRoot, name, files)
    try {
        runScannerForFixture(fixtureRoot)
    } catch (error) {
        const output = `${error.stdout ?? ""}${error.stderr ?? ""}`
        if (!output.includes(expectedOutput)) {
            throw new Error(`No-any scanner self-test ${name} failed with unexpected output:\n${output}`)
        }
        return
    }
    throw new Error(`No-any scanner self-test ${name} unexpectedly passed`)
}

function writeFixture(tempRoot, name, files) {
    const fixtureRoot = path.join(tempRoot, name)
    for (const [relativeFile, source] of Object.entries(files)) {
        const file = path.join(fixtureRoot, relativeFile)
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.writeFileSync(file, source)
    }
    return fixtureRoot
}

function runScannerForFixture(fixtureRoot) {
    execFileSync(process.execPath, [SCRIPT_PATH, fixtureRoot], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        env: { ...process.env, [SKIP_SELF_TEST_ENV]: "1" },
        stdio: ["ignore", "pipe", "pipe"],
    })
}

function reviewedExceptionIsInScan(relativeFile) {
    const exceptionPath = path.resolve(REPO_ROOT, relativeFile)
    return scanRoots.some((root) => {
        const scanPath = path.resolve(process.cwd(), root)
        return exceptionPath === scanPath || exceptionPath.startsWith(`${scanPath}${path.sep}`)
    })
}

function stripCommentsAndStrings(source) {
    let result = ""
    let state = "code"

    for (let index = 0; index < source.length; index += 1) {
        const char = source[index]
        const next = source[index + 1]

        if (state === "lineComment") {
            if (char === "\n") {
                state = "code"
                result += char
            } else {
                result += " "
            }
            continue
        }

        if (state === "blockComment") {
            if (char === "*" && next === "/") {
                result += "  "
                index += 1
                state = "code"
            } else {
                result += char === "\n" ? "\n" : " "
            }
            continue
        }

        if (state === "singleQuote" || state === "doubleQuote" || state === "template") {
            const terminator = state === "singleQuote" ? "'" : state === "doubleQuote" ? "\"" : "`"
            if (char === "\\") {
                result += " "
                if (next) {
                    result += next === "\n" ? "\n" : " "
                    index += 1
                }
                continue
            }
            if (char === terminator) {
                result += " "
                state = "code"
            } else {
                result += char === "\n" ? "\n" : " "
            }
            continue
        }

        if (char === "/" && next === "/") {
            result += "  "
            index += 1
            state = "lineComment"
            continue
        }

        if (char === "/" && next === "*") {
            result += "  "
            index += 1
            state = "blockComment"
            continue
        }

        if (char === "'") {
            result += " "
            state = "singleQuote"
            continue
        }

        if (char === "\"") {
            result += " "
            state = "doubleQuote"
            continue
        }

        if (char === "`") {
            result += " "
            state = "template"
            continue
        }

        result += char
    }

    return result
}
