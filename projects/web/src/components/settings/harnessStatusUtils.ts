import type { HarnessInstallStatus } from "../../electronAPI/harnessStatus"

const HARNESS_LABELS: Record<string, string> = {
    "claude-code": "Claude Code",
    codex: "Codex",
}

const AUTH_TYPE_LABELS: Record<HarnessInstallStatus["authType"], string> = {
    account: "Account",
    "api-key": "API Key",
    none: "No Auth",
}

export interface HarnessStatusView {
    label: "Ready" | "Needs Login" | "Not Installed"
    tone: "success" | "warning" | "error"
    subtitle: string
}

export function getHarnessDisplayName(harnessId: string): string {
    if (HARNESS_LABELS[harnessId]) return HARNESS_LABELS[harnessId]

    return harnessId
        .split("-")
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ")
}

export function getHarnessAuthTypeLabel(authType: HarnessInstallStatus["authType"]): string {
    return AUTH_TYPE_LABELS[authType]
}

export function toHarnessStatusView(status: HarnessInstallStatus): HarnessStatusView {
    if (!status.installed) {
        return {
            label: "Not Installed",
            tone: "error",
            subtitle: status.authInstructions ?? "Install this harness CLI to enable it.",
        }
    }

    if (status.authType !== "none" && !status.authenticated) {
        return {
            label: "Needs Login",
            tone: "warning",
            subtitle: status.authInstructions ?? "Authenticate this harness to use it.",
        }
    }

    if (status.authType === "none") {
        return {
            label: "Ready",
            tone: "success",
            subtitle: "No authentication required.",
        }
    }

    return {
        label: "Ready",
        tone: "success",
        subtitle: "Authenticated and ready.",
    }
}
