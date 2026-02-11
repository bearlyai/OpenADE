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
    mac: "https://github.com/bearlyai/OpenADE/releases/download/v0.53.0/OpenADE-0.53.0-universal.dmg",
    linux:
      "https://github.com/bearlyai/OpenADE/releases/download/v0.53.0/OpenADE-0.53.0-arm64.AppImage",
    windows:
      "https://github.com/bearlyai/OpenADE/releases/download/v0.53.0/OpenADE-Setup-0.53.0.exe",
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
    // On Windows, keep hero scrolling to download section so user sees the experimental note
    if (os === "windows") {
      if (heroBtn) heroBtn.href = "#download"
    } else {
      if (heroBtn) heroBtn.href = links[os]
    }
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

  // Windows: intercept download click and show warning dialog
  setupWindowsWarningDialog()
}

function setupWindowsWarningDialog() {
  const windowsBtn = document.getElementById("dl-windows")
  const dialog = document.getElementById(
    "windows-warning-dialog"
  ) as HTMLDialogElement | null
  const dialogDownload = document.getElementById("windows-dialog-download")
  const dialogCancel = document.getElementById("windows-dialog-cancel")

  if (!windowsBtn || !dialog) return

  windowsBtn.addEventListener("click", (e) => {
    e.preventDefault()
    dialog.showModal()
  })

  dialogDownload?.addEventListener("click", () => {
    dialog.close()
  })

  dialogCancel?.addEventListener("click", () => {
    dialog.close()
  })

  // Close on backdrop click
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) {
      dialog.close()
    }
  })
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

// ─── Mobile Nav Toggle ───
function setupMobileNav() {
  const hamburger = document.getElementById("nav-hamburger")
  const navRight = document.getElementById("nav-right")
  if (!hamburger || !navRight) return

  hamburger.addEventListener("click", () => {
    const isOpen = navRight.classList.toggle("open")
    hamburger.classList.toggle("open", isOpen)
    hamburger.setAttribute("aria-expanded", String(isOpen))
  })

  // Close menu when a nav link is tapped (smooth scroll links)
  navRight.querySelectorAll(".nav-link").forEach((link) => {
    link.addEventListener("click", () => {
      navRight.classList.remove("open")
      hamburger.classList.remove("open")
      hamburger.setAttribute("aria-expanded", "false")
    })
  })
}

// ─── Init ───
setupDownloadLinks()
setupScrollReveal()
setupMobileNav()
