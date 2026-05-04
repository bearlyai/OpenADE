export interface ReleaseNote {
    version: string
    title: string
    date: string
    highlights: string[]
}

/** Hardcoded release notes, newest first. */
export const RELEASE_NOTES: ReleaseNote[] = [
    {
        version: "0.74.0",
        title: "Usage Stats & Sharper Reviews",
        date: "2026-05-03",
        highlights: [
            "Stats now include agent runtime totals in task stats, monthly breakdowns, and share cards",
            "Codex usage costs are calculated more accurately with cached-token pricing and resumed-session deltas",
            "Reviews and plans now separate explicit user requirements from agent decisions more clearly",
            "The changes tray keeps newly appearing directories expanded while still respecting directories you collapsed",
            "Diff status icons stay readable in dense file lists instead of shrinking",
        ],
    },
    {
        version: "0.73.0",
        title: "Smarter Resumes & Review Diffs",
        date: "2026-04-26",
        highlights: [
            "Changing the model on a resumed Codex task now takes effect instead of silently sticking to the original model",
            "Review and changes trays now switch diff context reliably without showing stale partial patches, with bounded context options that stay responsive",
            "Review model pickers now stay aligned with the models you can actually select, and the redundant Claude Opus latest alias is hidden",
            "Closed tasks now show a GitHub-style [Closed] marker before the title so status is easier to spot",
        ],
    },
    {
        version: "0.72.1",
        title: "Claude Opus Selection Fix",
        date: "2026-04-25",
        highlights: [
            "Claude Code tasks using rolling Opus selections no longer break on newer Claude Code versions",
            "Concrete Claude model IDs still force matching subagent models when configured",
        ],
    },
    {
        version: "0.72.0",
        title: "Faster Diffs & GPT-5.5",
        date: "2026-04-24",
        highlights: [
            "Large snapshot and diff views stay responsive — snapshot bundles are indexed and only the selected file slice is loaded",
            "Changes and git log trays default to compact per-hunk diffs with shared context controls for quicker history review",
            "Added GPT-5.5 to Codex task creation, and your selected model now persists from the new-task page through to the first execution",
            'Scratchpad titles no longer revert to "Untitled" on empty first lines, and the tray remembers the last-active pad per workspace',
            "Task headers now display a Closed label so the page title reflects task status",
        ],
    },
    {
        version: "0.71.0",
        title: "Claude Opus 4.7",
        date: "2026-04-16",
        highlights: [
            "Default Opus model upgraded to Claude Opus 4.7 for improved reasoning and coding performance",
            "Existing tasks with older Opus/Sonnet full IDs continue to work — model aliases now resolve across current and future Claude releases",
        ],
    },
    {
        version: "0.70.0",
        title: "Scratchpad, Draft Stashing & Sonnet 4.6",
        date: "2026-04-13",
        highlights: [
            "New scratchpad tray panel for quick notes with auto-generated titles from the first line",
            "Stash task drafts to a side rail and restore them later — rich editor state including file mentions and images is preserved across context switches and refreshes",
            "Cron jobs can now reuse an existing task thread instead of always creating new tasks",
            "Added Sonnet 4.6 model with default effort set to max",
            "Stderr line bursts in inline messages are now collapsed for cleaner output",
        ],
    },
    {
        version: "0.69.0",
        title: "Inline Config Editing & Better Navigation",
        date: "2026-04-12",
        highlights: [
            "Edit processes and cron jobs inline from the app instead of round-tripping through a task and raw TOML edits",
            "Browse multiple openade.toml files from a built-in file tree with a wider editor for faster config maintenance",
            "Pinned tasks now always stay above unpinned tasks in the sidebar, even when an unpinned task is running",
            "Process config is now consistently openade.toml-only, reducing ambiguity across process management",
        ],
    },
    {
        version: "0.68.0",
        title: "Task Management & Harness APIs",
        date: "2026-04-12",
        highlights: [
            "Multi-select task deletion lets you bulk-remove tasks with full resource cleanup",
            "Pin tasks to the top of your sidebar for quick access to important work",
            "Edit task titles inline directly from the sidebar or navbar",
            "MCP connectors now open in a popover and reliably toggle on first click",
            "Reviews focus on blocking findings only, with new dimensions for security, style, and robustness",
        ],
    },
    {
        version: "0.67.0",
        title: "Refined Reviews",
        date: "2026-04-02",
        highlights: [
            "Reviews are less aggressive — findings now distinguish real bugs from potentially intentional behavior with a confirmation section",
            "Review picker redesigned as a single-click agent list with top models highlighted",
            "Review handoff context is now compact, preventing bloated follow-up prompts",
            "Task thread serializer no longer includes function-call inputs by default, reducing noise",
        ],
    },
    {
        version: "0.66.0",
        title: "Isolated Reviews & HyperPlan Reliability",
        date: "2026-04-02",
        highlights: [
            "New Review commands let you launch an independent read-only review of your plan or recent work with a dedicated harness and model picker",
            "Stop reliably cancels in-progress HyperPlan runs and cleans up all sub-sessions",
            "Fixed HyperPlan session resume using the wrong harness and model after handoff",
            "Stats page now includes Today and This Week period filters for quick access to recent usage",
            "Git state now refreshes automatically when the terminal tray closes",
        ],
    },
    {
        version: "0.65.1",
        title: "Cron Timer Reliability Fix",
        date: "2026-03-16",
        highlights: [
            "Fixed cron scheduler skipping the current time slot by firing directly on timer instead of recomputing the next run",
            "Refresh events (task completion, window focus) are now debounced to avoid cancelling and recreating timers on every event",
        ],
    },
    {
        version: "0.65.0",
        title: "Cron Scheduling Fix & Repeat Limits",
        date: "2026-03-12",
        highlights: [
            "Cron jobs now fire reliably on schedule with catch-up for missed runs",
            "Repeat mode now has a configurable max runs limit (default 100) to prevent runaway loops",
            "Fixed a crash in the todo list parser when a malformed non-array value was passed",
        ],
    },
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
            "Edit menu in process tray for creating and updating openade.toml directly",
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
