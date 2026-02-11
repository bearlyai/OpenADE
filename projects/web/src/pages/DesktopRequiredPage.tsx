import { Code, Cpu, GitBranch, Monitor, Shield } from "lucide-react"
import { openUrlInNativeBrowser } from "../electronAPI/shell"

// Use GitHub Releases "latest" redirects - these auto-resolve to the newest version
const GITHUB_RELEASES_BASE = "https://github.com/bearlyai/OpenADE/releases/latest/download"

const downloadUrls = {
    mac: `${GITHUB_RELEASES_BASE}/OpenADE-universal.dmg`,
    windows: `${GITHUB_RELEASES_BASE}/OpenADE-Setup.exe`,
    linux: `${GITHUB_RELEASES_BASE}/OpenADE.AppImage`,
}

type Platform = "mac" | "windows" | "linux" | "unknown"

function detectPlatform(): Platform {
    const platform = navigator.platform?.toLowerCase() || ""
    const userAgent = navigator.userAgent?.toLowerCase() || ""

    if (platform.includes("mac") || userAgent.includes("mac")) return "mac"
    if (platform.includes("win") || userAgent.includes("win")) return "windows"
    if (platform.includes("linux") || userAgent.includes("linux")) return "linux"
    return "unknown"
}

function getPlatformLabel(platform: Platform): string {
    switch (platform) {
        case "mac":
            return "Mac"
        case "windows":
            return "Windows"
        case "linux":
            return "Linux"
        default:
            return ""
    }
}

const features = [
    {
        icon: Monitor,
        title: "Full Filesystem Access",
        description: "Work directly in your local repos with complete read/write capabilities",
    },
    {
        icon: Cpu,
        title: "AI-Powered Understanding",
        description: "Claude understands your entire codebase, not just snippets",
    },
    {
        icon: GitBranch,
        title: "Git-Isolated Tasks",
        description: "Experiment fearlessly with automatic worktree isolation",
    },
    {
        icon: Shield,
        title: "Plan, Review, Execute",
        description: "See exactly what changes will be made before they happen",
    },
]

export function DesktopRequiredPage() {
    const detectedPlatform = detectPlatform()
    const otherPlatforms = (["mac", "windows", "linux"] as const).filter((p) => p !== detectedPlatform)

    return (
        <div className="flex flex-col items-center justify-center min-h-full px-8 py-16">
            <div className="max-w-2xl w-full text-center">
                <div className="flex items-center justify-center gap-3 mb-6">
                    <Code size="2.5rem" className="text-primary" />
                    <h1 className="text-4xl font-bold text-base-content">OpenADE</h1>
                </div>

                <p className="text-xl text-muted mb-4">AI-powered coding that actually understands your codebase.</p>

                <p className="text-muted mb-12">
                    OpenADE runs directly on your machine, giving Claude full access to your repositories, git history, and local environment. It's the most
                    powerful way to code with AI.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-12">
                    {features.map((feature) => (
                        <div key={feature.title} className="flex items-start gap-4 p-4 bg-base-200 border border-border text-left">
                            <feature.icon size="1.5rem" className="text-primary flex-shrink-0 mt-0.5" />
                            <div>
                                <h3 className="font-semibold text-base-content mb-1">{feature.title}</h3>
                                <p className="text-sm text-muted">{feature.description}</p>
                            </div>
                        </div>
                    ))}
                </div>

                <div className="bg-base-200 border border-border p-8">
                    <h2 className="text-lg font-semibold text-base-content mb-2">Desktop App Required</h2>
                    <p className="text-muted mb-6">
                        OpenADE requires the desktop app to access your local files and run Claude's agent capabilities securely on your machine.
                    </p>

                    {detectedPlatform !== "unknown" ? (
                        <div className="flex flex-col items-center gap-4">
                            <button
                                type="button"
                                onClick={() => openUrlInNativeBrowser(downloadUrls[detectedPlatform])}
                                className="btn inline-flex items-center justify-center gap-2 px-8 py-4 bg-primary text-primary-content font-semibold text-lg hover:bg-primary/90 transition-colors w-full max-w-sm"
                            >
                                <Monitor size="1.25rem" />
                                Download for {getPlatformLabel(detectedPlatform)}
                            </button>
                            {detectedPlatform === "windows" && (
                                <p className="text-sm text-muted" style={{ maxWidth: "24rem" }}>
                                    Windows support is experimental and largely untested — expect rough edges. For a smoother experience, try the Linux build
                                    via{" "}
                                    <button
                                        type="button"
                                        onClick={() => openUrlInNativeBrowser("https://learn.microsoft.com/en-us/windows/wsl/")}
                                        className="text-primary hover:underline"
                                    >
                                        WSL
                                    </button>
                                    .
                                </p>
                            )}
                            <p className="text-sm text-muted">
                                Also available for{" "}
                                {otherPlatforms.map((platform, index) => (
                                    <span key={platform}>
                                        <button
                                            type="button"
                                            onClick={() => openUrlInNativeBrowser(downloadUrls[platform])}
                                            className="text-primary hover:underline"
                                        >
                                            {getPlatformLabel(platform)}
                                        </button>
                                        {index < otherPlatforms.length - 1 ? " and " : ""}
                                    </span>
                                ))}
                            </p>
                        </div>
                    ) : (
                        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                            <button
                                type="button"
                                onClick={() => openUrlInNativeBrowser(downloadUrls.mac)}
                                className="btn inline-flex items-center justify-center gap-2 px-6 py-3 bg-primary text-primary-content font-semibold hover:bg-primary/90 transition-colors"
                            >
                                Mac
                            </button>
                            <button
                                type="button"
                                onClick={() => openUrlInNativeBrowser(downloadUrls.windows)}
                                className="btn inline-flex items-center justify-center gap-2 px-6 py-3 bg-primary text-primary-content font-semibold hover:bg-primary/90 transition-colors"
                            >
                                Windows
                            </button>
                            <button
                                type="button"
                                onClick={() => openUrlInNativeBrowser(downloadUrls.linux)}
                                className="btn inline-flex items-center justify-center gap-2 px-6 py-3 bg-primary text-primary-content font-semibold hover:bg-primary/90 transition-colors"
                            >
                                Linux
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
