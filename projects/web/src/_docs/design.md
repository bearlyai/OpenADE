# Design System

## Philosophy

**Flat, square, clean, spacious.**

- No rounded corners anywhere - all elements are square
- Flat design with minimal shadows (only subtle `shadow-sm` or `shadow-lg` for floating elements)
- Clean borders using `border-border`
- Spacious padding and generous whitespace
- Floating UI elements centered and hovering above content

## IMPORTANT: Read tw.css First

**Before working with colors, ALWAYS read `tw.css` in the code module root.**

The code module has its own standalone theme system with `code-theme-light` and `code-theme-dark` classes. Only use color tokens defined in this file. Never use legacy color tokens from the dashboard's `src/tw.css` or any other color system unless explicitly asked.

The `tw.css` file contains a complete COLOR REFERENCE section documenting all available tokens.

## Design Rules

1. **No rounded corners**: Never use `rounded-*` classes
2. **Use `btn` class for buttons**: Always add the `btn` class to buttons - it resets browser defaults. Since `btn` does `all: unset`, you MUST also set an explicit text color (e.g., `text-base-content`, `text-muted`) and background color if needed (e.g., `bg-base-100`).
3. **Use `input` class for inputs**: Always add the `input` class to inputs/textareas, but override `rounded-*` with explicit square styling if needed.
4. **Square cards**: Comment cards and containers have no border radius
5. **Floating elements**: Use `fixed` or `absolute` positioning with `shadow-lg` for floating bars

## Theme System - DaisyUI-Compatible Colors

**This is the ONLY theme system to use for the Code module.**

The code module uses a DaisyUI-compatible semantic color system defined in `tw.css`. Theme classes (e.g., `code-theme-light`, `code-theme-dark`, `code-theme-black`, `code-theme-synthwave`) are applied in `CodeAppLayout.tsx` based on user preference (Settings → Vibes tab).

### Adding a New Theme

To add a new theme, update two files:

**1. Add CSS class in `tw.css`:**

```css
/* Code Theme - My Theme (description) */
.code-theme-mytheme {
    color: var(--color-base-content);
    background-color: var(--color-base-100);

    /* Editor theme for syntax highlighting */
    --editor-theme: pierre-dark;  /* or pierre-light, synthwave-84, etc. */
    --color-editor-background: #000000;

    /* Terminal theme for xterm.js (see themes/terminalThemes.ts) */
    --terminal-theme: pierre-dark;  /* pierre-light, pierre-dark, pierre-black, tokyo-night, dracula, atom-one-light */

    /* Required color tokens */
    --color-base-100: oklch(...);      /* Main background */
    --color-base-200: oklch(...);      /* Elevated surfaces */
    --color-base-300: oklch(...);      /* More elevated surfaces */
    --color-base-content: oklch(...);  /* Text on base backgrounds */
    --color-primary: oklch(...);
    --color-primary-content: oklch(...);
    --color-secondary: oklch(...);
    --color-secondary-content: oklch(...);
    --color-accent: oklch(...);
    --color-accent-content: oklch(...);
    --color-neutral: oklch(...);
    --color-neutral-content: oklch(...);
    --color-info: oklch(...);
    --color-info-content: oklch(...);
    --color-success: oklch(...);
    --color-success-content: oklch(...);
    --color-warning: oklch(...);
    --color-warning-content: oklch(...);
    --color-error: oklch(...);
    --color-error-content: oklch(...);

    /* Additional tokens */
    --color-border: oklch(...);
    --color-input: oklch(...);
    --color-muted: oklch(...);
}
```

**2. Register in `persistence/personalSettingsStore.ts`:**

```typescript
export const themeClasses = {
    "code-theme-light": { label: "Light" },
    "code-theme-dark": { label: "Dark" },
    "code-theme-black": { label: "Black" },
    "code-theme-synthwave": { label: "Synthwave" },
    "code-theme-mytheme": { label: "My Theme" },  // Add here
} as const satisfies Record<string, ThemeInfo>
```

The theme will automatically appear in Settings → Vibes with a live preview card.

**3. (Optional) Add a new terminal theme in `themes/terminalThemes.ts`:**

If none of the existing terminal themes match your UI theme, you can add a new one:

```typescript
const myTerminalTheme: TerminalTheme = {
    // 5 UI colors
    background: "#000000",
    foreground: "#ffffff",
    cursor: "#ffffff",
    cursorAccent: "#000000",
    selectionBackground: "#ffffff33",
    // 8 normal ANSI colors
    black: "#000000",
    red: "#ff0000",
    green: "#00ff00",
    yellow: "#ffff00",
    blue: "#0000ff",
    magenta: "#ff00ff",
    cyan: "#00ffff",
    white: "#ffffff",
    // 8 bright ANSI colors
    brightBlack: "#808080",
    brightRed: "#ff8080",
    brightGreen: "#80ff80",
    brightYellow: "#ffff80",
    brightBlue: "#8080ff",
    brightMagenta: "#ff80ff",
    brightCyan: "#80ffff",
    brightWhite: "#ffffff",
}

// Add to TERMINAL_THEMES record:
export const TERMINAL_THEMES: Record<string, TerminalTheme> = {
    // ... existing themes
    "my-theme": myTerminalTheme,
}
```

**Terminal theme sources:**
- Pierre themes (`projects/external_repos/pierre/packages/diffs/src/themes/`) - primary source, colors in `terminal.*` section
- iTerm2-Color-Schemes (`external_repos/iTerm2-Color-Schemes/ghostty/`) - 250+ themes in compatible format

### Core Principle: Semantic Color Pairing

**The #1 rule: When using `bg-{color}`, ALWAYS pair with `text-{color}-content`.**

This ensures proper contrast across all themes (light/dark) and allows themes to define appropriate text colors for each background.

```tsx
// Semantic pairing examples
<button className="bg-primary text-primary-content">Submit</button>
<button className="bg-error text-error-content">Delete</button>
<button className="bg-success text-success-content">Confirm</button>
<span className="bg-warning text-warning-content">Caution</span>
<div className="bg-info text-info-content">Note: ...</div>
```

### Color System Overview

Uses OKLCH color space for perceptual uniformity. Opacity modifiers work: `bg-primary/10`, `text-error/50`, etc.

### Brand Colors

| Category | Background | Text (on that bg) | Usage |
|----------|------------|-------------------|-------|
| **Primary** | `bg-primary` | `text-primary-content` | Main brand color, primary actions, CTAs |
| **Secondary** | `bg-secondary` | `text-secondary-content` | Secondary brand color (rarely used in this app) |
| **Accent** | `bg-accent` | `text-accent-content` | Accent brand color (rarely used in this app) |

### Semantic State Colors

| Category | Background | Text (on that bg) | Usage |
|----------|------------|-------------------|-------|
| **Success** | `bg-success` | `text-success-content` | Success/safe messages |
| **Warning** | `bg-warning` | `text-warning-content` | Warning/caution messages |
| **Error** | `bg-error` | `text-error-content` | Error/danger/destructive messages |
| **Info** | `bg-info` | `text-info-content` | Informative/helpful messages |

### Surface Colors (Base)

| Color | Usage |
|-------|-------|
| `bg-base-100` | Blank backgrounds, main page surface |
| `bg-base-200` | Elevated surfaces (cards, sidebars, buttons) - darker shade for depth |
| `bg-base-300` | Even more elevated surfaces, hover/pressed states - darkest shade |
| `text-base-content` | Default text on any base background |

**Important:** Use `bg-base-200/300` for general UI surfaces, cards, and neutral buttons. Do NOT use `bg-secondary` for these - `secondary` is a brand color, not a surface color.

### Dark UI Color (Neutral)

| Category | Background | Text (on that bg) | Usage |
|----------|------------|-------------------|-------|
| **Neutral** | `bg-neutral` | `text-neutral-content` | Dark, not-saturated UI parts (switch tracks, scrollbars, dark badges) |

**Utility colors:**
- `bg-input` - Form input backgrounds
- `text-muted` - Secondary/helper text
- `border-border` - Borders

### Button Patterns

#### Standard Button Styles

```tsx
// Primary action button
className="bg-primary text-primary-content hover:bg-primary/80"

// Success/confirm button
className="bg-success text-success-content hover:bg-success/80"

// Danger/destructive button
className="bg-error text-error-content hover:bg-error/80"

// Neutral button (uses base colors, not secondary!)
className="bg-base-200 text-base-content hover:bg-base-300"

// Ghost button (no background)
className="text-base-content hover:bg-base-200"
```

#### Disabled Button States

**Critical: Disabled buttons must preserve their color identity.**

```tsx
// Disabled state preserves color identity with reduced opacity
const primaryButtonClass = isDisabled
    ? "bg-primary/40 text-primary-content/50 cursor-not-allowed"
    : "bg-primary text-primary-content hover:bg-primary/80 cursor-pointer"

const successButtonClass = isDisabled
    ? "bg-success/40 text-success-content/50 cursor-not-allowed"
    : "bg-success text-success-content hover:bg-success/80 cursor-pointer"

const errorButtonClass = isDisabled
    ? "bg-error/40 text-error-content/50 cursor-not-allowed"
    : "bg-error text-error-content hover:bg-error/80 cursor-pointer"
```

**Disabled pattern for each variant:**

| Variant | Enabled | Disabled |
|---------|---------|----------|
| Primary | `bg-primary text-primary-content` | `bg-primary/40 text-primary-content/50` |
| Success | `bg-success text-success-content` | `bg-success/40 text-success-content/50` |
| Error | `bg-error text-error-content` | `bg-error/40 text-error-content/50` |
| Neutral | `bg-base-200 text-base-content` | `bg-base-200/40 text-base-content/50` |
| Ghost | `text-base-content` | `text-muted/50` |

#### Complete Button Style Object (Reference Implementation)

See `InputBar.tsx` for the canonical button style definitions:

```tsx
const BUTTON_STYLES = {
    primary: {
        enabled: "bg-primary text-primary-content cursor-pointer hover:bg-primary/80 active:bg-primary/70",
        disabled: "bg-primary/40 text-primary-content/50 cursor-not-allowed",
    },
    success: {
        enabled: "bg-success text-success-content cursor-pointer hover:bg-success/80 active:bg-success/70",
        disabled: "bg-success/40 text-success-content/50 cursor-not-allowed",
    },
    danger: {
        enabled: "bg-error text-error-content cursor-pointer hover:bg-error/80 active:bg-error/70",
        disabled: "bg-error/40 text-error-content/50 cursor-not-allowed",
    },
    neutral: {
        enabled: "bg-base-200 text-base-content cursor-pointer hover:bg-base-300 active:bg-base-300",
        disabled: "bg-base-200/40 text-base-content/50 cursor-not-allowed",
    },
    ghost: {
        enabled: "text-base-content cursor-pointer hover:bg-base-200 active:bg-base-300",
        disabled: "text-muted/50 cursor-not-allowed",
    },
}
```

### Chips, Tags, and Pills

For small UI elements like tags or pills, use base colors or semantic light backgrounds:

```tsx
// Base colors for neutral UI elements
<span className="bg-base-200 text-base-content px-2 py-1">Tag</span>
<span className="bg-base-200 text-muted px-2 py-1">Subtle tag</span>
<kbd className="bg-base-200 text-base-content px-1.5 py-0.5">⌘</kbd>

// Semantic colors for status indicators (light bg + colored text)
<span className="bg-success/10 text-success px-2 py-1">Active</span>
<span className="bg-error/10 text-error px-2 py-1">Error</span>
<span className="bg-warning/10 text-warning px-2 py-1">Pending</span>
<span className="bg-primary/10 text-primary px-2 py-1">Plan</span>
<span className="bg-info/10 text-info px-2 py-1">Info</span>
```

### Light Background States (Alerts, Highlights)

For light-colored backgrounds (like error alerts), use opacity modifiers:

```tsx
// Error alert box
<div className="bg-error/10 border border-error/30 text-error">
    Error message here
</div>

// Warning banner
<div className="bg-warning/10 border border-warning/30 text-warning">
    <AlertTriangle className="text-warning" />
    Warning message
</div>

// Success highlight
<div className="bg-success/10 text-success">
    Success message
</div>

// Info notice
<div className="bg-info/10 border border-info/30 text-info">
    Informational note
</div>

// Selected/active state
<div className="bg-primary/10 text-primary">
    Selected item
</div>
```

### Dark UI Elements (Neutral)

Use `neutral` for dark, non-saturated UI components:

```tsx
// Switch track (unchecked state)
<div className="bg-neutral data-[checked]:bg-primary">...</div>

// Scrollbar thumb
<div className="bg-neutral rounded-full">...</div>

// Dark badge
<span className="bg-neutral text-neutral-content px-2 py-1">Dark badge</span>
```

### Color Mapping from Legacy

When updating old code, use this mapping:

| Old Class | New Class |
|-----------|-----------|
| `text-text` | `text-base-content` |
| `text-text-secondary` | `text-muted` |
| `text-white` (on colored bg) | `text-{color}-content` |
| `text-black` (on colored bg) | `text-{color}-content` |
| `bg-bg` | `bg-base-100` |
| `bg-secondary-bg` | `bg-base-200` |
| `bg-secondary-fill` | `bg-base-200` (for UI) or `bg-secondary` (for brand) |
| `bg-secondary-fill-pressed` | `bg-base-300` |
| `bg-secondary-fill-hover` | `hover:bg-base-300` |
| `bg-primary-fill` | `bg-primary` |
| `bg-primary-accent` | `bg-primary` |
| `text-primary-accent` | `text-primary` |
| `bg-input-fill` | `bg-input` |
| `bg-success-fill` | `bg-success/10` |
| `bg-error-fill` | `bg-error/10` |
| `bg-warning-fill` | `bg-warning/10` |
| `bg-neutral-fill` | `bg-neutral` |
| `bg-neutral-content` (as bg) | `bg-neutral` |

### Editor Background

When wrapping a Pierre diff/file viewer in a larger viewport container, use `bg-editor-background` with `min-h-full` to fill empty space with the editor's theme-matched background color:

```tsx
<div className="min-h-full bg-editor-background">
    <FileViewer file={file} ... />
</div>
```

This ensures the viewport fills with the correct background color (`#ffffff` in light mode, `#070707` in dark mode) rather than showing the page background when the file content is shorter than the container.

### Theme Files

| File | Purpose |
|------|---------|
| `tw.css` | Theme CSS classes and color variables. **Read this first for color reference.** |
| `persistence/personalSettingsStore.ts` | Theme registry (`themeClasses`) and user preference storage |
| `hooks/useResolvedTheme.ts` | Resolves "system" preference to actual theme class |
| `themes/terminalThemes.ts` | Terminal color palettes (21 colors each) for xterm.js |
| `hooks/useTerminalTheme.ts` | Reads `--terminal-theme` CSS variable and returns theme object |
| `components/settings/AppearanceTab.tsx` | Theme selection UI with live previews (Settings → Vibes) |
| `CodeAppLayout.tsx` | Applies resolved theme class to root element |

### Portal Elements

Portal elements (dropdowns, popups, modals) must render inside the themed container to inherit CSS variables. The code module provides a `PortalContainerProvider` and `usePortalContainer()` hook for this.

**How it works:**

```tsx
// In CodeAppLayout.tsx
<div className={themeClass}>
    <NiceModal.Provider>
        <PortalContainerProvider>
            {children}
            <div id="code-portal-root" />  {/* Portals render here */}
        </PortalContainerProvider>
    </NiceModal.Provider>
</div>
```

**Using portals in components:**

```tsx
import { usePortalContainer } from "../../hooks/usePortalContainer"

function MyComponent() {
    const portalContainer = usePortalContainer()

    return (
        <SelectBase.Portal container={portalContainer}>
            {/* Dropdown content inherits theme */}
        </SelectBase.Portal>
    )
}
```

**Portal types and their setup:**

| Component Type | Implementation |
|----------------|----------------|
| Base UI (Select, Menu, Popover) | Pass `container={portalContainer}` to `<*.Portal>` |
| React `createPortal()` | Use `portalContainer ?? document.body` as target |
| NiceModal | Automatically works (Provider is inside themed container) |

**Key files:**

| File | Purpose |
|------|---------|
| `hooks/usePortalContainer.tsx` | Context and hook for portal container |
| `CodeAppLayout.tsx` | Sets up `PortalContainerProvider` inside themed div |

## Keeping This Document Updated

This document should evolve with the codebase. When making significant changes to the design system or theme, consider whether this doc needs updates.

The code is ground truth. If you find any inconsistencies update this document.
