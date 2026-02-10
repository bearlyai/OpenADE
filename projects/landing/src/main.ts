import "./style.css"

// ─── OS Detection & Download CTA ───
function detectOS(): "mac" | "linux" | "windows" | "unknown" {
  const ua = navigator.userAgent.toLowerCase()
  const platform = navigator.platform?.toLowerCase() || ""

  if (ua.includes("mac") || platform.includes("mac")) return "mac"
  if (ua.includes("win") || platform.includes("win")) return "windows"
  if (ua.includes("linux") || platform.includes("linux")) return "linux"
  return "unknown"
}

function setupDownloadLinks() {
  const os = detectOS()

  const links: Record<string, string> = {
    mac: "https://github.com/bearlyai/OpenADE/releases/download/v0.52.0/OpenADE-0.52.0-universal.dmg",
    linux:
      "https://github.com/bearlyai/OpenADE/releases/download/v0.52.0/OpenADE-0.52.0-arm64.AppImage",
    windows:
      "https://github.com/bearlyai/OpenADE/releases/download/v0.52.0/OpenADE-Setup-0.52.0.exe",
  }

  const labels: Record<string, string> = {
    mac: "Download for macOS",
    linux: "Download for Linux",
    windows: "Download for Windows",
  }

  // Update hero CTA
  const heroBtn = document.getElementById(
    "hero-download-btn"
  ) as HTMLAnchorElement | null
  const heroText = document.getElementById("hero-download-text")
  if (os !== "unknown" && links[os]) {
    if (heroBtn) heroBtn.href = links[os]
    if (heroText) heroText.textContent = labels[os]
  }

  // Highlight recommended download button with orange border
  const recMap: Record<string, string> = {
    mac: "dl-mac",
    linux: "dl-linux",
    windows: "dl-windows",
  }
  if (os !== "unknown" && recMap[os]) {
    const btn = document.getElementById(recMap[os])
    if (btn) btn.classList.add("recommended")
  }
}

// ─── Scroll Reveal ───
function setupScrollReveal() {
  const reveals = document.querySelectorAll(".reveal")
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("visible")
          observer.unobserve(entry.target)
        }
      })
    },
    { threshold: 0.1 }
  )

  reveals.forEach((el) => observer.observe(el))
}

// ─── Init ───
setupDownloadLinks()
setupScrollReveal()
