export interface ReleaseNote {
    version: string
    title: string
    date: string
    highlights: string[]
}

/** Hardcoded release notes, newest first. */
export const RELEASE_NOTES: ReleaseNote[] = [
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
