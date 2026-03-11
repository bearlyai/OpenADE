---
name: twitter-graphic
description: Generate a beautiful Twitter/social media promo PNG graphic for OpenADE features
argument-hint: [feature or topic to promote]
disable-model-invocation: true
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Agent
---

# Twitter Promo Graphic Generator

Create a beautiful, on-brand PNG promo graphic for Twitter (1200x675, exported at 2x retina as 2400x1350).

## Workflow

1. **Research**: Read the relevant source code for the feature being promoted. Understand what it does, how users interact with it, and what the UI looks like.
2. **Design**: Create an HTML file in `promo/` that mocks the real app UI faithfully.
3. **Screenshot**: Use Chrome headless to export as a retina PNG.

## Brand & Theme

Use the `code-theme-black` palette from `projects/web/src/tw.css`:

```
--base-100: oklch(0% 0 0)           /* #000000 — background */
--base-200: oklch(19% 0 0)          /* #2d2d2d — elevated surfaces, action bar bg */
--base-300: oklch(22% 0 0)          /* #363636 — buttons on base-200 */
--base-content: oklch(87.609% 0 0)  /* #d6d6d6 — primary text */
--primary: var(--color-orange-700)   /* #c2410c — brand orange, Plan buttons */
--primary-content: oklch(1 0 0)     /* #ffffff */
--border: oklch(0.25 0 0 / 0.5)     /* rgba(60,60,60,0.5) */
--muted: oklch(0.55 0 0)            /* #808080 — secondary text */
--success: oklch(51.975% 0.176 142.495) /* #15803d — Do buttons, pass states */
--error: oklch(62.795% 0.257 29.233)    /* #dc2626 — Stop/danger buttons */
```

Fonts: `Inter` for UI text, `JetBrains Mono` for code/mono. Import from Google Fonts.

## Component Reference

When mocking the app UI, replicate the actual component structure. Key files:

- **InputBar**: `projects/web/src/components/InputBar.tsx` — the main input component
  - Outer wrapper: `absolute bottom-6 left-1/2 -translate-x-1/2 w-full max-w-3xl px-4`
  - Container: `bg-base-100 border border-border shadow-lg`
  - Tray row: `flex items-center gap-1 p-1` with 28x28px icon buttons
  - Editor area: `min-h-[58px] text-sm leading-[20px]`, padding `px-2.5 py-[9px]`
  - Actions row: `flex items-center gap-2 px-2 py-2 bg-base-200`
  - Button base: `btn flex items-center justify-center gap-2 px-4 h-9 text-sm font-medium`
  - Variants: success=`bg-success`, primary=`bg-primary`, neutral=`bg-base-200`, danger=`bg-error`

- **Tray buttons** (from `trayConfigs.tsx`): Changes (GitCompare), Files (FolderOpen), Git Log (GitCommitHorizontal), Search (Search), Terminal (TerminalSquare), Processes (Play) — all size 14, w-7 h-7

- **Sidebar crons**: `projects/web/src/components/sidebar/CronList.tsx`
  - Header: Clock icon + "Crons" + Plus button
  - Each item: `flex items-center gap-2 py-1.5 pl-3 pr-2`, 8x8 status dot (running=green pulse, active=orange, inactive=gray), text-xs name, hover actions

- **Command buttons** (from `InputManager.ts`): Do (Play, success), Plan (FileText, primary), Ask (MessageCircleQuestion, neutral), Repeat (Repeat, neutral), Close (CheckCircle, neutral with spacer)

Icons are from `lucide-react`. Use inline SVGs with matching viewBox="0 0 24 24" and stroke-width="2".

## Screenshot Command

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless --disable-gpu --hide-scrollbars \
  --screenshot="${CLAUDE_SKILL_DIR}/promo/<name>.png" \
  --window-size=1200,675 \
  --force-device-scale-factor=2 \
  "file://${CLAUDE_SKILL_DIR}/promo/<name>.html"
```

## Layout Tips

- The canvas is exactly 1200x675. Everything must fit — no scroll.
- When using `overflow: hidden` on containers (like an app window mock), absolutely positioned children near the edges WILL be clipped. Position overlaying elements (like the InputBar) outside the clipped container.
- Include a brief marketing header (logo, headline, subline) and a minimal footer.
- Keep copy punchy and concrete. Show real examples, not abstract descriptions.
- Use annotation labels in the document flow (not absolutely positioned over content) to call out features.

## Output

- HTML source: `${CLAUDE_SKILL_DIR}/promo/<name>.html`
- PNG output: `${CLAUDE_SKILL_DIR}/promo/<name>.png` (2400x1350 retina)

After generating, read the PNG to verify it looks correct before presenting to the user.

## Existing Examples

See `${CLAUDE_SKILL_DIR}/promo/cron-repeat.html` for a reference implementation showing the app window mock pattern with sidebar + main area + overlaid InputBar.
