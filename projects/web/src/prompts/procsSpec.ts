/**
 * openade.toml Specification
 *
 * Contains the spec documentation and prompt generator for creating openade.toml files.
 */

const PROCS_SPEC = `
# openade.toml Specification

An openade.toml file defines processes and cron jobs for a project directory. Each process has a type that determines its behavior.

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
work_dir = "frontend"           # Optional: relative to openade.toml location
url = "http://localhost:3000"   # Optional: for daemons with web UI

[[cron]]
name = "Weekly Review"          # Required: display name
schedule = "0 9 * * 1"          # Required: 5-field cron expression
type = "plan"                   # Required: plan | do | ask | hyperplan
prompt = "Review the codebase"  # Required: prompt sent to agent
harness = "claude-code"         # Optional: agent harness to use
isolation = "worktree"          # Optional: head (default) or worktree
\`\`\`

## Behavior

- **setup** processes run automatically before the first daemon starts
- **daemon** processes have a 24hr timeout, others have 10min
- **check** processes can be triggered by automation (CI, pre-commit)
- Multiple openade.toml files can exist in subdirectories (monorepo support)
- Cron jobs must be "installed" per-machine to activate scheduling

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

[[cron]]
name = "Weekly Dependency Check"
schedule = "0 9 * * 1"
type = "plan"
prompt = "Check for outdated dependencies and create a plan to update them"
\`\`\`
`.trim()

export function getProcsUpdatePrompt(changeDescription: string): string {
    return `Update the openade.toml file(s) in this project based on the following request:

${changeDescription}

${PROCS_SPEC}

Read the existing openade.toml (or procs.toml) file(s), apply the requested changes, and write the updated file(s). Keep changes minimal and preserve existing processes that aren't affected by the request.`
}

export function getProcsCreationPrompt(targetDir: string): string {
    const dirDisplay = targetDir === "." ? "the project root" : `"${targetDir}"`

    return `Create an openade.toml file in ${dirDisplay} for this project.

${PROCS_SPEC}

Analyze the directory to find:
- Package files (package.json, Cargo.toml, pyproject.toml, go.mod, etc.)
- Available scripts and their purposes
- Dev server configurations

Generate appropriate processes. Only include processes that actually exist in the project's config files. Keep it minimal - a typical project needs 3-5 processes at most.`
}

export function getCronCreationPrompt(description: string): string {
    return `Add a new cron job to the openade.toml file based on the following description:

${description}

${PROCS_SPEC}

Read the existing openade.toml (or procs.toml) file. If neither exists, create an openade.toml in the project root. Add a new [[cron]] entry that matches what the user described. Pick an appropriate cron schedule, type (plan/do/ask), and prompt. Preserve all existing content in the file.`
}
