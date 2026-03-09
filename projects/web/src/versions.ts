export interface ReleaseNote {
    version: string
    title: string
    date: string
    highlights: string[]
}

/** Hardcoded release notes, newest first. */
export const RELEASE_NOTES: ReleaseNote[] = [
    {
        version: "0.64.0",
        title: "Cron Jobs, Repeat Actions & Windows Fix",
        date: "2026-03-09",
        highlights: [
            "Schedule recurring tasks with cron jobs — define schedules in openade.toml and manage them from the sidebar",
            "New Repeat action lets you loop a prompt repeatedly with an optional stop-on-text condition",
            "Fixed blank screen on Windows caused by BrowserRouter on file:// protocol",
            "Tray buttons are now compact icon-only squares with tooltips, reducing input bar overflow",
            "Session forking disabled by default so follow-up turns continue in-place instead of forking",
        ],
    },
    {
        version: "0.63.0",
        title: "GPT-5.4, Frecency Favorites & Diff Performance",
        date: "2026-03-06",
        highlights: [
            "GPT-5.4 is now the default Codex model, offering improved coding performance",
            "File favorites now use frecency ranking — recently and frequently used files surface first",
            "Stale file favorites that reference deleted files are automatically pruned on load",
            "Large file diffs (lock files, generated files, 10k+ line files) no longer freeze the Changes and Git Log views",
        ],
    },
    {
        version: "0.62.0",
        title: "Thinking Controls, Stats Sharing & Sidebar Polish",
        date: "2026-03-01",
        highlights: [
            "New thinking-level picker lets you control how much reasoning effort the AI uses per task",
            "Share your usage stats as a shareable image card with one-click copy to clipboard",
            "Drag and drop images directly onto the task creation page to include them in your prompt",
            "Sidebar now offers copy-path actions for workspaces and tasks, and shows deleted files in the Changes tray",
            "Tool call pills display file names and patterns for easier scanning of what the AI touched",
        ],
    },
    {
        version: "0.61.0",
        title: "Git Log, Smart Bash Pills & Image Prompts",
        date: "2026-02-26",
        highlights: [
            "New Git Log tray lets you browse commit history, view diffs, and inspect changes without leaving the app",
            "Bash commands now render as friendly semantic pills — search, read, edit, git — instead of raw shell invocations",
            "Attach images to prompts via paste, drag-and-drop, or file picker with support across task runs",
            "Changes viewer rebuilt as a collapsible file tree with Open in Finder support",
            "Commit and push unified into a single action that accepts custom instructions from the editor",
        ],
    },
    {
        version: "0.55.0",
        title: "Plan Button Fix",
        date: "2026-02-15",
        highlights: [
            "Fixed Plan button incorrectly launching HyperPlan when a multi-agent strategy was previously selected",
            "Plan and HyperPlan are now distinct actions — choosing Plan always runs standard planning regardless of persisted strategy",
        ],
    },
    {
        version: "0.54.0",
        title: "HyperPlan & Multi-Harness Support",
        date: "2026-02-15",
        highlights: [
            "HyperPlan lets you run multiple AI agents in parallel with DAG-based planning strategies for complex tasks",
            "Multi-harness support: switch between Claude Code and Codex backends from the same interface",
            "Archive and hide workspaces from the sidebar to keep your project list tidy",
            "Global start/stop buttons in the Processes tray to manage all daemons at once",
            "Conversation context is now included when regenerating task titles for more accurate results",
        ],
    },
    {
        version: "0.53.0",
        title: "Push to PR & Extended Thinking",
        date: "2026-02-10",
        highlights: [
            "New Push command that automatically creates pull requests with LLM-generated titles and descriptions",
            "Claude's extended thinking blocks now render inline so you can follow the reasoning process",
            "SDK tool calls and results are visually nested under their parent action for cleaner conversation flow",
            "Processes tray redesigned with compact single-line rows and hover-reveal actions",
            "Auto-update failures now show an error banner with a one-click retry option",
        ],
    },
    {
        version: "0.52.0",
        title: "Image Input & Workspace Overhaul",
        date: "2026-02-09",
        highlights: [
            "Paste, drag-and-drop, or pick images to attach to any message",
            "New 3-way workspace creation: open an existing directory, create a new one, or start from a prototype",
            "File browser, content search, and model selection are now scoped per task",
            "Edit menu in process tray for creating and updating procs.toml directly",
            "Unread and running indicators on workspace sidebar items with last-viewed-page memory",
        ],
    },
    {
        version: "0.51.0",
        title: "MCP Connectors & Improved Terminal",
        date: "2026-02-05",
        highlights: [
            "Added 12 new MCP connector presets for popular services",
            "Terminal now supports custom themes",
            "Fixed worktree cleanup on task deletion",
        ],
    },
    {
        version: "0.50.0",
        title: "Multi-Theme Support",
        date: "2026-01-28",
        highlights: [
            "6 new themes: Light, Bright, Clean, Black, Synthwave, Dracula",
            "Theme picker in settings with live preview",
            "System theme auto-detection",
        ],
    },
    {
        version: "0.49.0",
        title: "Collaborative Workspaces",
        date: "2026-01-20",
        highlights: ["Real-time collaboration with shared cursors", "Per-task comment threads", "Improved onboarding flow for new users"],
    },
]
