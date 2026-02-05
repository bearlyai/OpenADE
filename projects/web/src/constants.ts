export const Z_INDEX = {
    COPY_OVERLAY: 10,
    INPUT_BAR: 100,
    INPUT_BAR_TRAY: 90,
    PORTAL_CONTAINER: 200,
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
// Claude Model Configuration
// ============================================================================

export const CLAUDE_MODELS = [
    { id: "claude-opus-4-5-20251101", label: "Opus 4.5" },
    { id: "claude-sonnet-4-5-20250929", label: "Sonnet 4.5" },
    { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
] as const

export const DEFAULT_MODEL = "claude-opus-4-5-20251101"
export type ClaudeModelId = (typeof CLAUDE_MODELS)[number]["id"]
