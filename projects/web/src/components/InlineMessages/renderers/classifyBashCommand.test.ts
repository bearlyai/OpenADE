import { describe, expect, it } from "vitest"
import { classifyBashCommand, stripShellWrapper } from "./classifyBashCommand"

describe("stripShellWrapper", () => {
    it("strips /bin/zsh -lc with double quotes", () => {
        expect(stripShellWrapper('/bin/zsh -lc "rg foo -n"')).toBe("rg foo -n")
    })

    it("strips /bin/bash -lc with single quotes", () => {
        expect(stripShellWrapper("/bin/bash -lc 'cat file.txt'")).toBe("cat file.txt")
    })

    it("strips bare zsh -lc", () => {
        expect(stripShellWrapper('zsh -lc "ls src/"')).toBe("ls src/")
    })

    it("strips bare sh -lc", () => {
        expect(stripShellWrapper("sh -lc 'grep pattern .'")).toBe("grep pattern .")
    })

    it("returns non-wrapped commands unchanged", () => {
        expect(stripShellWrapper("rg foo -n")).toBe("rg foo -n")
    })

    it("returns plain commands unchanged", () => {
        expect(stripShellWrapper("npm install")).toBe("npm install")
    })
})

describe("classifyBashCommand", () => {
    describe("search commands", () => {
        it("classifies wrapped rg as search", () => {
            const result = classifyBashCommand('/bin/zsh -lc "rg \\"lucide-react\\" -g \'package.json\' -n"')
            expect(result.semanticType).toBe("search")
            expect(result.label).toContain("Search")
        })

        it("classifies rg with pattern in double quotes", () => {
            const result = classifyBashCommand("/bin/zsh -lc 'rg \"openSettingsMenu\" projects/dashboard/src -n'")
            expect(result.semanticType).toBe("search")
            expect(result.label).toContain("openSettingsMenu")
        })

        it("classifies rg with escaped pattern", () => {
            const result = classifyBashCommand('/bin/zsh -lc "rg \\"\\\\bOption\\\\b\\" projects/dashboard -n"')
            expect(result.semanticType).toBe("search")
            expect(result.label).toContain("Search")
        })

        it("classifies bare rg as search", () => {
            const result = classifyBashCommand("rg pattern src/")
            expect(result.semanticType).toBe("search")
            expect(result.label).toBe("Search: pattern")
        })

        it("classifies grep as search", () => {
            const result = classifyBashCommand("grep -r pattern src/")
            expect(result.semanticType).toBe("search")
        })

        it("classifies ag as search", () => {
            const result = classifyBashCommand("ag pattern src/")
            expect(result.semanticType).toBe("search")
        })

        it("classifies find as search", () => {
            const result = classifyBashCommand('find . -name "*.ts"')
            expect(result.semanticType).toBe("search")
            expect(result.label).toBe("Find files")
        })

        it("classifies fd as search", () => {
            const result = classifyBashCommand("fd .ts src/")
            expect(result.semanticType).toBe("search")
            expect(result.label).toBe("Find files")
        })

        it("shows just Search for regex patterns with special chars", () => {
            const result = classifyBashCommand('rg "\\bOption\\b" projects/dashboard -n')
            expect(result.semanticType).toBe("search")
            expect(result.label).toBe("Search")
        })

        it("shows just Search for multi-pattern searches with pipes", () => {
            const result = classifyBashCommand('rg -n "connectors|assetBrowser|download-as-markdown|response style" src/')
            expect(result.semanticType).toBe("search")
            expect(result.label).toBe("Search")
        })

        it("shows clean pattern for simple word searches", () => {
            const result = classifyBashCommand('rg "openSettingsMenu" src/ -n')
            expect(result.semanticType).toBe("search")
            expect(result.label).toBe("Search: openSettingsMenu")
        })
    })

    describe("read commands", () => {
        it("classifies nl piped to sed -n as read", () => {
            const result = classifyBashCommand("/bin/zsh -lc \"nl -ba projects/dashboard/src/module.tsx | sed -n '100,190p'\"")
            expect(result.semanticType).toBe("read")
            expect(result.label).toContain("Read")
            expect(result.label).toContain("module.tsx")
        })

        it("classifies cat as read", () => {
            const result = classifyBashCommand("cat package.json")
            expect(result.semanticType).toBe("read")
            expect(result.label).toBe("Read package.json")
        })

        it("classifies head as read", () => {
            const result = classifyBashCommand("head -n 50 src/index.ts")
            expect(result.semanticType).toBe("read")
            expect(result.label).toContain("Read")
        })

        it("classifies tail as read", () => {
            const result = classifyBashCommand("tail -n 20 src/index.ts")
            expect(result.semanticType).toBe("read")
        })

        it("classifies sed -n as read", () => {
            const result = classifyBashCommand("sed -n '1,50p' file.ts")
            expect(result.semanticType).toBe("read")
        })

        it("classifies wc as read", () => {
            const result = classifyBashCommand("wc -l src/index.ts")
            expect(result.semanticType).toBe("read")
        })

        it("classifies nl standalone as read", () => {
            const result = classifyBashCommand("nl -ba src/index.ts")
            expect(result.semanticType).toBe("read")
        })

        it("classifies bat as read", () => {
            const result = classifyBashCommand("bat src/index.ts")
            expect(result.semanticType).toBe("read")
        })
    })

    describe("list commands", () => {
        it("classifies ls as list", () => {
            const result = classifyBashCommand("ls src/")
            expect(result.semanticType).toBe("list")
            expect(result.label).toBe("List files")
        })

        it("classifies tree as list", () => {
            const result = classifyBashCommand("tree src/")
            expect(result.semanticType).toBe("list")
            expect(result.label).toBe("List files")
        })

        it("classifies bare ls as list", () => {
            const result = classifyBashCommand("ls")
            expect(result.semanticType).toBe("list")
        })
    })

    describe("git commands", () => {
        it("classifies git diff as git", () => {
            const result = classifyBashCommand("git diff -- projects/electron/src/modules/contextMenuTemplate.ts")
            expect(result.semanticType).toBe("git")
            expect(result.label).toBe("Git: diff")
        })

        it("classifies git log as git", () => {
            const result = classifyBashCommand('git log -1 --format="%H %ad %s" --date=short -- file.ts')
            expect(result.semanticType).toBe("git")
            expect(result.label).toBe("Git: log")
        })

        it("classifies git show as git", () => {
            const result = classifyBashCommand("git show --stat --oneline abc123 -- file.ts")
            expect(result.semanticType).toBe("git")
            expect(result.label).toBe("Git: show")
        })

        it("classifies git status as git", () => {
            const result = classifyBashCommand("git status --short")
            expect(result.semanticType).toBe("git")
            expect(result.label).toBe("Git: status")
        })

        it("classifies wrapped git as git", () => {
            const result = classifyBashCommand("/bin/zsh -lc 'git diff -- file.ts'")
            expect(result.semanticType).toBe("git")
            expect(result.label).toBe("Git: diff")
        })
    })

    describe("write commands", () => {
        it("classifies echo with redirection as write", () => {
            const result = classifyBashCommand("echo 'hello' > out.txt")
            expect(result.semanticType).toBe("write")
            expect(result.label).toBe("Write out.txt")
        })

        it("classifies cat heredoc with redirection as write", () => {
            const result = classifyBashCommand("cat <<'EOF' > config.json")
            expect(result.semanticType).toBe("write")
            expect(result.label).toBe("Write config.json")
        })

        it("classifies append redirection as write", () => {
            const result = classifyBashCommand("echo 'line' >> log.txt")
            expect(result.semanticType).toBe("write")
            expect(result.label).toBe("Write log.txt")
        })

        it("does not classify /dev/null redirection as write", () => {
            const result = classifyBashCommand("some-cmd 2>&1 > /dev/null")
            expect(result.semanticType).not.toBe("write")
        })

        it("classifies tee as write", () => {
            const result = classifyBashCommand("tee output.txt")
            expect(result.semanticType).toBe("write")
            expect(result.label).toBe("Write file")
        })

        it("classifies cp as write", () => {
            const result = classifyBashCommand("cp src/file.txt dst/file.txt")
            expect(result.semanticType).toBe("write")
            expect(result.label).toBe("Copy file")
        })

        it("classifies mv as write", () => {
            const result = classifyBashCommand("mv old.txt new.txt")
            expect(result.semanticType).toBe("write")
            expect(result.label).toBe("Move file")
        })

        it("classifies wrapped redirection as write", () => {
            const result = classifyBashCommand('/bin/zsh -lc \'cat <<"EOF" > /tmp/test.py\nprint("hello")\nEOF\'')
            expect(result.semanticType).toBe("write")
            expect(result.label).toBe("Write test.py")
        })
    })

    describe("edit commands", () => {
        it("classifies sed -i as edit", () => {
            const result = classifyBashCommand("sed -i 's/foo/bar/g' file.txt")
            expect(result.semanticType).toBe("edit")
            expect(result.label).toBe("Edit file")
        })

        it("classifies sed with -i flag in complex position as edit", () => {
            const result = classifyBashCommand("sed -i.bak 's/old/new/' file.txt")
            expect(result.semanticType).toBe("edit")
        })

        it("classifies patch as edit", () => {
            const result = classifyBashCommand("patch -p1 < fix.patch")
            expect(result.semanticType).toBe("edit")
            expect(result.label).toBe("Patch file")
        })

        it("classifies plain sed substitution (no -i, no -n) as edit", () => {
            const result = classifyBashCommand("sed 's/foo/bar/g' file.txt")
            expect(result.semanticType).toBe("edit")
            expect(result.label).toBe("Edit file")
        })

        it("classifies sed with expression flag as edit", () => {
            const result = classifyBashCommand("sed -e 's/old/new/' file.txt")
            expect(result.semanticType).toBe("edit")
        })
    })

    describe("fallback", () => {
        it("falls back to bash for unknown commands", () => {
            const result = classifyBashCommand("npm install")
            expect(result.semanticType).toBe("bash")
            expect(result.label).toBe("npm install")
        })

        it("extracts interesting commands from compound, filtering boring ones", () => {
            const result = classifyBashCommand("docker compose up -d && npm run migrate")
            expect(result.semanticType).toBe("bash")
            expect(result.label).toBe("docker compose, npm run")
        })

        it("extracts go test from cd && gofmt && go test", () => {
            const result = classifyBashCommand(
                "/bin/zsh -lc 'cd /Users/pnegahdar/Projects/bearly/projects/core/testapp && gofmt -w sql_progress_metrics_test.go && go test -count=1 -run TestSQLProgressMetrics_Report -v ./...'"
            )
            expect(result.semanticType).toBe("bash")
            expect(result.label).toBe("gofmt, go test")
        })

        it("extracts go test from cd && go test", () => {
            const result = classifyBashCommand(
                "/bin/zsh -lc 'cd /Users/pnegahdar/Projects/bearly/projects/core/testapp && go test -count=1 -run TestSQLProgressMetrics_Report -v ./...'"
            )
            expect(result.semanticType).toBe("bash")
            expect(result.label).toBe("go test")
        })

        it("falls back to raw truncation when all commands are boring", () => {
            const result = classifyBashCommand("cd /tmp && pwd")
            expect(result.semanticType).toBe("bash")
            expect(result.label).toBe("cd /tmp && pwd")
        })

        it("truncates long fallback labels", () => {
            const longCommand = "some-very-long-command --with-many-flags --and-arguments value1 value2"
            const result = classifyBashCommand(longCommand)
            expect(result.semanticType).toBe("bash")
            expect(result.label.length).toBeLessThanOrEqual(43) // 40 + "..."
        })
    })

    describe("compound commands", () => {
        it("classifies rg in a piped chain as search", () => {
            const result = classifyBashCommand("/bin/zsh -lc 'pwd && ls -la && rg --files | rg -n \"SKILL.md|model|nano|banana|gemini|image\"'")
            expect(result.semanticType).toBe("search")
            expect(result.label).toBe("Search")
        })

        it("picks the most specific command from && chains", () => {
            const result = classifyBashCommand("cd /some/dir && rg pattern src/")
            expect(result.semanticType).toBe("search")
            expect(result.label).toBe("Search: pattern")
        })

        it("classifies git in a compound command", () => {
            const result = classifyBashCommand("/bin/zsh -lc 'cd /Users/pnegahdar/Projects/openade && git status --short'")
            expect(result.semanticType).toBe("git")
            expect(result.label).toBe("Git: status")
        })

        it("picks edit over search in compound command", () => {
            const result = classifyBashCommand("rg pattern file.txt && sed -i 's/old/new/' file.txt")
            expect(result.semanticType).toBe("edit")
        })

        it("falls back to bash with extracted names when all segments are unknown", () => {
            const result = classifyBashCommand("cd /tmp && npm install && npm run build")
            expect(result.semanticType).toBe("bash")
            expect(result.label).toBe("npm install, npm run")
        })
    })

    describe("shell wrapper + classification combined", () => {
        it("unwraps and classifies rg", () => {
            const result = classifyBashCommand('/bin/zsh -lc "rg \\"lucide-react\\" -g \'package.json\' -n"')
            expect(result.semanticType).toBe("search")
            expect(result.innerCommand).not.toContain("/bin/zsh")
        })

        it("unwraps and classifies nl | sed -n", () => {
            const result = classifyBashCommand("/bin/zsh -lc 'nl -ba file.tsx | sed -n \"100,190p\"'")
            expect(result.semanticType).toBe("read")
            expect(result.innerCommand).toBe('nl -ba file.tsx | sed -n "100,190p"')
        })

        it("unwraps and classifies unknown command", () => {
            const result = classifyBashCommand('/bin/zsh -lc "fooctl do-something"')
            expect(result.semanticType).toBe("bash")
            expect(result.label).toBe("fooctl")
        })
    })
})
