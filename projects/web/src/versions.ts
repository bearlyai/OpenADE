export interface ReleaseNote {
    version: string
    title: string
    date: string
    highlights: string[]
}

/** Hardcoded release notes, newest first. */
export const RELEASE_NOTES: ReleaseNote[] = [
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
