export const Z_INDEX = {
    COPY_OVERLAY: 10,
    INPUT_BAR: 100,
    INPUT_BAR_TRAY: 90,
    PORTAL_CONTAINER: 200,
    RELEASE_NOTIFICATION: 201,
} as const

const LAST_VIEWED_KEY = "_code_last_viewed"

export interface LastViewed {
    workspaceId: string
    taskId?: string
}

export function getLastViewed(): LastViewed | null {
    try {
        const data = localStorage.getItem(LAST_VIEWED_KEY)
        if (!data) return null
        return JSON.parse(data) as LastViewed
    } catch {
        return null
    }
}

export function setLastViewed(data: LastViewed): void {
    localStorage.setItem(LAST_VIEWED_KEY, JSON.stringify(data))
}

const WORKSPACE_LAST_VIEWED_KEY = "_code_workspace_last_viewed"

interface WorkspaceLastViewed {
    taskId?: string
}

export function getWorkspaceLastViewed(workspaceId: string): WorkspaceLastViewed | null {
    try {
        const data = localStorage.getItem(WORKSPACE_LAST_VIEWED_KEY)
        if (!data) return null
        const map = JSON.parse(data) as Record<string, WorkspaceLastViewed>
        return map[workspaceId] ?? null
    } catch {
        return null
    }
}

export function setWorkspaceLastViewed(workspaceId: string, data: WorkspaceLastViewed): void {
    try {
        const existing = localStorage.getItem(WORKSPACE_LAST_VIEWED_KEY)
        const map: Record<string, WorkspaceLastViewed> = existing ? JSON.parse(existing) : {}
        map[workspaceId] = data
        localStorage.setItem(WORKSPACE_LAST_VIEWED_KEY, JSON.stringify(map))
    } catch {
        // Ignore storage errors
    }
}

// ============================================================================
// MCP Server Presets
// ============================================================================

import { siAsana, siAtlassian, siFigma, siIntercom, siLinear, siNotion, siPaypal, siSentry, siSquare, siStripe, siVercel, siWebflow } from "simple-icons"
import type { SimpleIcon } from "simple-icons"

export interface McpPreset {
    id: string
    name: string
    description: string
    transportType: "http" | "stdio"
    url?: string
    command?: string
    args?: string[]
    /** Simple Icon for this preset. Find slugs at https://simpleicons.org */
    icon: SimpleIcon
    docsUrl?: string
}

/**
 * Built-in MCP server presets for popular services.
 * Only includes verified, production-ready servers from major companies.
 * OAuth endpoints are discovered automatically from the server URL per MCP spec.
 *
 * To add a new preset:
 * 1. Find the icon at https://simpleicons.org
 * 2. Import it: import { siIconname } from "simple-icons"
 * 3. Add the preset with the icon
 */
export const MCP_PRESETS: Record<string, McpPreset> = {
    // Productivity & Collaboration
    notion: {
        id: "notion",
        name: "Notion",
        description: "Access pages, databases, and workspace content",
        transportType: "http",
        url: "https://mcp.notion.com/mcp",
        icon: siNotion,
    },
    linear: {
        id: "linear",
        name: "Linear",
        description: "Manage issues, projects, and team workflows",
        transportType: "http",
        url: "https://mcp.linear.app/sse",
        icon: siLinear,
    },
    asana: {
        id: "asana",
        name: "Asana",
        description: "Manage tasks, projects, and team work",
        transportType: "http",
        url: "https://mcp.asana.com/sse",
        icon: siAsana,
    },

    // Development
    vercel: {
        id: "vercel",
        name: "Vercel",
        description: "Manage deployments, domains, and projects",
        transportType: "http",
        url: "https://mcp.vercel.com",
        icon: siVercel,
    },

    // Payments & Finance
    stripe: {
        id: "stripe",
        name: "Stripe",
        description: "Access customers, payments, and billing data",
        transportType: "http",
        url: "https://mcp.stripe.com",
        icon: siStripe,
    },
    paypal: {
        id: "paypal",
        name: "PayPal",
        description: "Access transactions, invoices, and payment data",
        transportType: "http",
        url: "https://mcp.paypal.com/sse",
        icon: siPaypal,
    },
    square: {
        id: "square",
        name: "Square",
        description: "Access payments, inventory, and business data",
        transportType: "http",
        url: "https://mcp.squareup.com/sse",
        icon: siSquare,
    },

    // Design & Content
    webflow: {
        id: "webflow",
        name: "Webflow",
        description: "Manage sites, CMS content, and hosting",
        transportType: "http",
        url: "https://mcp.webflow.com/mcp",
        icon: siWebflow,
    },
    figma: {
        id: "figma",
        name: "Figma",
        description: "Access designs, components, and design systems",
        transportType: "http",
        url: "https://mcp.figma.com/mcp",
        icon: siFigma,
    },

    // Developer Tools
    atlassian: {
        id: "atlassian",
        name: "Atlassian",
        description: "Access Jira issues and Confluence pages",
        transportType: "http",
        url: "https://mcp.atlassian.com/v1/mcp",
        icon: siAtlassian,
    },
    sentry: {
        id: "sentry",
        name: "Sentry",
        description: "Search, query, and debug errors",
        transportType: "http",
        url: "https://mcp.sentry.dev/mcp",
        icon: siSentry,
    },
    // Analytics & Customer
    intercom: {
        id: "intercom",
        name: "Intercom",
        description: "Access customer conversations and data",
        transportType: "http",
        url: "https://mcp.intercom.com/mcp",
        icon: siIntercom,
    },
} as const

export const MCP_PRESET_IDS = Object.keys(MCP_PRESETS) as (keyof typeof MCP_PRESETS)[]

// ============================================================================
// Claude Model Configuration (legacy, kept for backward compat)
// ============================================================================

export const CLAUDE_MODELS = [
    { id: "opus", fullId: "claude-opus-4-6", label: "Opus 4.6" },
    { id: "sonnet", fullId: "claude-sonnet-4-5-20250929", label: "Sonnet 4.5" },
    { id: "haiku", fullId: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
] as const

export const DEFAULT_MODEL = "opus"
/** @deprecated Use string instead - models are now per-harness */
export type ClaudeModelId = (typeof CLAUDE_MODELS)[number]["id"]

// ============================================================================
// Multi-Harness Model Registry (Phase 4)
// ============================================================================

import type { HarnessId } from "./electronAPI/harnessEventTypes"

export interface ModelEntry {
    id: string // alias used in the picker (e.g. "opus", "o3")
    fullId: string // wire model ID sent to the CLI
    label: string // display label
}

export interface HarnessModelConfig {
    models: ModelEntry[]
    defaultModel: string // alias ID
}

/**
 * Registry of models per harness. Each harness defines its own set of
 * available models and a default.
 */
export const MODEL_REGISTRY: Record<HarnessId, HarnessModelConfig> = {
    "claude-code": {
        models: [
            { id: "opus", fullId: "claude-opus-4-6", label: "Opus 4.6" },
            { id: "sonnet", fullId: "claude-sonnet-4-5-20250929", label: "Sonnet 4.5" },
            { id: "haiku", fullId: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
        ],
        defaultModel: "opus",
    },
    codex: {
        models: [
            { id: "gpt-5.3-codex", fullId: "gpt-5.3-codex", label: "GPT-5.3 Codex" },
            { id: "gpt-5.3-codex-spark", fullId: "gpt-5.3-codex-spark", label: "GPT-5.3 Codex Spark" },
        ],
        defaultModel: "gpt-5.3-codex",
    },
}

export const DEFAULT_HARNESS_ID: HarnessId = "claude-code"

/** Get the full model ID from an alias. Searches the specified harness first, then all. */
export function getModelFullId(alias: string, harnessId?: HarnessId): string {
    // If harnessId given, look there first
    if (harnessId) {
        const config = MODEL_REGISTRY[harnessId]
        if (config) {
            const found = config.models.find((m) => m.id === alias)
            if (found) return found.fullId
        }
    }

    // Fallback: search all harnesses (backward compat)
    for (const config of Object.values(MODEL_REGISTRY)) {
        const found = config.models.find((m) => m.id === alias)
        if (found) return found.fullId
    }

    // If alias is already a full ID, return as-is
    return alias
}

/** Get models for a specific harness */
export function getModelsForHarness(harnessId: HarnessId): ModelEntry[] {
    return MODEL_REGISTRY[harnessId]?.models ?? []
}

/** Get default model alias for a harness */
export function getDefaultModelForHarness(harnessId: HarnessId): string {
    return MODEL_REGISTRY[harnessId]?.defaultModel ?? DEFAULT_MODEL
}

/** Resolve the best model alias for a given harness, falling back to that harness's default */
export function resolveModelForHarness(alias: string, harnessId: HarnessId): string {
    const config = MODEL_REGISTRY[harnessId]
    if (!config) return alias
    const found = config.models.find((m) => m.id === alias)
    if (found) return found.id
    return config.defaultModel
}

/** Normalize a raw model ID to its display class name (e.g. "Opus", "Sonnet", "Haiku", "o3") */
export function normalizeModelClass(modelId: string): string {
    const lower = modelId.toLowerCase()
    if (lower.includes("opus")) return "Opus"
    if (lower.includes("sonnet")) return "Sonnet"
    if (lower.includes("haiku")) return "Haiku"
    // Codex models
    if (lower.includes("codex")) return "Codex"
    return "Other"
}

/**
 * When true, sets ANTHROPIC_DEFAULT_*_MODEL and CLAUDE_CODE_SUBAGENT_MODEL env vars
 * to force all nested agents/subagents to use the same model as the selected one.
 */
export const USE_SAME_MODEL_FOR_AGENTS = true
