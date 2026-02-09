/**
 * Procs.toml Specification
 *
 * Contains the spec documentation and prompt generator for creating procs.toml files.
 */

const PROCS_SPEC = `
# procs.toml Specification

A procs.toml file defines processes for a project directory. Each process has a type that determines its behavior.

## Process Types

- **setup**: Run once per session before daemons start (e.g., npm install, pip install)
- **daemon**: Long-running background processes (e.g., dev servers, watchers)
- **task**: One-shot manual commands (e.g., build, deploy, migrations)
- **check**: Validation commands (e.g., typecheck, lint, test)

## Schema

\`\`\`toml
[[process]]
name = "Display Name"           # Required: shown in UI
type = "daemon"                 # Required: setup | daemon | task | check
command = "npm run dev"         # Required: shell command to run
work_dir = "frontend"           # Optional: relative to procs.toml location
url = "http://localhost:3000"   # Optional: for daemons with web UI
\`\`\`

## Behavior

- **setup** processes run automatically before the first daemon starts
- **daemon** processes have a 24hr timeout, others have 10min
- **check** processes can be triggered by automation (CI, pre-commit)
- Multiple procs.toml files can exist in subdirectories (monorepo support)

## Example for a typical Node.js project

\`\`\`toml
[[process]]
name = "Install"
type = "setup"
command = "npm install"

[[process]]
name = "Dev Server"
type = "daemon"
command = "npm run dev"
url = "http://localhost:3000"

[[process]]
name = "Build"
type = "task"
command = "npm run build"

[[process]]
name = "Typecheck"
type = "check"
command = "npm run typecheck"
\`\`\`
`.trim()

export function getProcsUpdatePrompt(changeDescription: string): string {
    return `Update the procs.toml file(s) in this project based on the following request:

${changeDescription}

${PROCS_SPEC}

Read the existing procs.toml file(s), apply the requested changes, and write the updated file(s). Keep changes minimal and preserve existing processes that aren't affected by the request.`
}

export function getProcsCreationPrompt(targetDir: string): string {
    const dirDisplay = targetDir === "." ? "the project root" : `"${targetDir}"`

    return `Create a procs.toml file in ${dirDisplay} for this project.

${PROCS_SPEC}

Analyze the directory to find:
- Package files (package.json, Cargo.toml, pyproject.toml, go.mod, etc.)
- Available scripts and their purposes
- Dev server configurations

Generate appropriate processes. Only include processes that actually exist in the project's config files. Keep it minimal - a typical project needs 3-5 processes at most.`
}
