/**
 * Terminal color themes for xterm.js / ghostty-web
 *
 * Each theme requires 21 color properties:
 * - 5 UI colors: background, foreground, cursor, cursorAccent, selectionBackground
 * - 8 normal ANSI: black, red, green, yellow, blue, magenta, cyan, white
 * - 8 bright ANSI: brightBlack, brightRed, brightGreen, brightYellow, brightBlue, brightMagenta, brightCyan, brightWhite
 *
 * Sources:
 * - pierre-light, pierre-dark: from projects/external_repos/pierre/packages/diffs/src/themes/
 * - tokyo-night, dracula, atom-one-light: from external_repos/iTerm2-Color-Schemes/ghostty/
 */

export interface TerminalTheme {
    background: string
    foreground: string
    cursor: string
    cursorAccent: string
    selectionBackground: string
    black: string
    red: string
    green: string
    yellow: string
    blue: string
    magenta: string
    cyan: string
    white: string
    brightBlack: string
    brightRed: string
    brightGreen: string
    brightYellow: string
    brightBlue: string
    brightMagenta: string
    brightCyan: string
    brightWhite: string
}

/**
 * Pierre Light - from pierre-light.json terminal.* colors
 * Used by: code-theme-light
 */
const pierreLightTheme: TerminalTheme = {
    background: "#f8f8f8",
    foreground: "#6C6C71",
    cursor: "#009fff",
    cursorAccent: "#f8f8f8",
    selectionBackground: "#009fff4d",
    black: "#1F1F21",
    red: "#ff2e3f",
    green: "#0dbe4e",
    yellow: "#ffca00",
    blue: "#009fff",
    magenta: "#c635e4",
    cyan: "#08c0ef",
    white: "#c6c6c8",
    brightBlack: "#1F1F21",
    brightRed: "#ff2e3f",
    brightGreen: "#0dbe4e",
    brightYellow: "#ffca00",
    brightBlue: "#009fff",
    brightMagenta: "#c635e4",
    brightCyan: "#08c0ef",
    brightWhite: "#c6c6c8",
}

/**
 * Pierre Dark - from pierre-dark.json terminal.* colors
 * Used by: code-theme-dark
 */
const pierreDarkTheme: TerminalTheme = {
    background: "#141415",
    foreground: "#adadb1",
    cursor: "#009fff",
    cursorAccent: "#141415",
    selectionBackground: "#009fff4d",
    black: "#141415",
    red: "#ff2e3f",
    green: "#0dbe4e",
    yellow: "#ffca00",
    blue: "#009fff",
    magenta: "#c635e4",
    cyan: "#08c0ef",
    white: "#c6c6c8",
    brightBlack: "#141415",
    brightRed: "#ff2e3f",
    brightGreen: "#0dbe4e",
    brightYellow: "#ffca00",
    brightBlue: "#009fff",
    brightMagenta: "#c635e4",
    brightCyan: "#08c0ef",
    brightWhite: "#c6c6c8",
}

/**
 * Pierre Black - pierre-dark with true black background for OLED
 * Used by: code-theme-black
 */
const pierreBlackTheme: TerminalTheme = {
    ...pierreDarkTheme,
    background: "#000000",
    cursorAccent: "#000000",
}

/**
 * Tokyo Night - from iTerm2-Color-Schemes/ghostty/TokyoNight
 * Used by: code-theme-synthwave
 */
const tokyoNightTheme: TerminalTheme = {
    background: "#1a1b26",
    foreground: "#c0caf5",
    cursor: "#c0caf5",
    cursorAccent: "#15161e",
    selectionBackground: "#33467c",
    black: "#15161e",
    red: "#f7768e",
    green: "#9ece6a",
    yellow: "#e0af68",
    blue: "#7aa2f7",
    magenta: "#bb9af7",
    cyan: "#7dcfff",
    white: "#a9b1d6",
    brightBlack: "#414868",
    brightRed: "#f7768e",
    brightGreen: "#9ece6a",
    brightYellow: "#e0af68",
    brightBlue: "#7aa2f7",
    brightMagenta: "#bb9af7",
    brightCyan: "#7dcfff",
    brightWhite: "#c0caf5",
}

/**
 * Dracula - from iTerm2-Color-Schemes/ghostty/Dracula
 * Used by: code-theme-dracula
 */
const draculaTheme: TerminalTheme = {
    background: "#282a36",
    foreground: "#f8f8f2",
    cursor: "#f8f8f2",
    cursorAccent: "#282a36",
    selectionBackground: "#44475a",
    black: "#21222c",
    red: "#ff5555",
    green: "#50fa7b",
    yellow: "#f1fa8c",
    blue: "#bd93f9",
    magenta: "#ff79c6",
    cyan: "#8be9fd",
    white: "#f8f8f2",
    brightBlack: "#6272a4",
    brightRed: "#ff6e6e",
    brightGreen: "#69ff94",
    brightYellow: "#ffffa5",
    brightBlue: "#d6acff",
    brightMagenta: "#ff92df",
    brightCyan: "#a4ffff",
    brightWhite: "#ffffff",
}

/**
 * Atom One Light - from iTerm2-Color-Schemes/ghostty/Atom One Light
 * Used by: code-theme-bright, code-theme-clean
 */
const atomOneLightTheme: TerminalTheme = {
    background: "#f9f9f9",
    foreground: "#2a2c33",
    cursor: "#bbbbbb",
    cursorAccent: "#ffffff",
    selectionBackground: "#ededed",
    black: "#000000",
    red: "#de3e35",
    green: "#3f953a",
    yellow: "#d2b67c",
    blue: "#2f5af3",
    magenta: "#950095",
    cyan: "#3f953a",
    white: "#bbbbbb",
    brightBlack: "#000000",
    brightRed: "#de3e35",
    brightGreen: "#3f953a",
    brightYellow: "#d2b67c",
    brightBlue: "#2f5af3",
    brightMagenta: "#a00095",
    brightCyan: "#3f953a",
    brightWhite: "#ffffff",
}

/**
 * Terminal themes mapped by CSS variable name
 * The key must match the --terminal-theme value in tw.css
 */
export const TERMINAL_THEMES: Record<string, TerminalTheme> = {
    "pierre-light": pierreLightTheme,
    "pierre-dark": pierreDarkTheme,
    "pierre-black": pierreBlackTheme,
    "tokyo-night": tokyoNightTheme,
    dracula: draculaTheme,
    "atom-one-light": atomOneLightTheme,
}

/** Default theme to use if the CSS variable is not set or invalid */
export const DEFAULT_TERMINAL_THEME = pierreDarkTheme
