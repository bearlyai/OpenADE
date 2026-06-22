import { chromium } from "playwright"
import { fileURLToPath } from "node:url"
import { createServer } from "vite"

const forbiddenRequestMarkers = [
    "CodeApp",
    "/src/store/managers/",
    "/src/electronAPI/",
    "rawPtyTerminalSession",
    "dataFolder",
    "setTerminalKeyboardCapture",
    "PtyHandle",
]

function hasForbiddenRequest(url) {
    return forbiddenRequestMarkers.some((marker) => url.includes(marker))
}

function formatIssueList(values) {
    return values.length === 0 ? "none" : values.map((value) => `- ${value}`).join("\n")
}

const server = await createServer({
    configFile: fileURLToPath(new URL("../vite.config.ts", import.meta.url)),
    logLevel: "error",
    server: {
        host: "127.0.0.1",
        port: 0,
        strictPort: false,
    },
})

let browser
try {
    await server.listen()
    const baseUrl = server.resolvedUrls?.local.find((url) => url.startsWith("http://127.0.0.1")) ?? server.resolvedUrls?.local[0]
    if (!baseUrl) throw new Error("Vite did not report a local URL")

    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage()
    const consoleIssues = []
    const pageErrors = []
    const requestFailures = []
    const forbiddenRequests = []

    page.on("console", (message) => {
        if (message.type() === "error" || message.type() === "warning") {
            consoleIssues.push(`${message.type()}: ${message.text()}`)
        }
    })
    page.on("pageerror", (error) => {
        pageErrors.push(error.message)
    })
    page.on("request", (request) => {
        const url = request.url()
        if (hasForbiddenRequest(url)) forbiddenRequests.push(url)
    })
    page.on("requestfailed", (request) => {
        requestFailures.push(`${request.url()} (${request.failure()?.errorText ?? "failed"})`)
    })

    await page.goto(`${baseUrl}#/remote`, { waitUntil: "domcontentloaded" })
    await page.locator("body").waitFor({ timeout: 10_000 })
    await page.waitForFunction(() => document.body.innerText.includes("OpenADE") && document.body.innerText.includes("Connect"), null, {
        timeout: 10_000,
    })
    await page.waitForTimeout(500)
    const bodyText = await page.locator("body").innerText()

    const failures = []
    for (const expectedText of ["OpenADE", "COMPANION", "Connect"]) {
        if (!bodyText.includes(expectedText)) failures.push(`Missing visible text: ${expectedText}\nRendered text:\n${bodyText}`)
    }
    if (consoleIssues.length > 0) failures.push(`Console issues:\n${formatIssueList(consoleIssues)}`)
    if (pageErrors.length > 0) failures.push(`Page errors:\n${formatIssueList(pageErrors)}`)
    if (requestFailures.length > 0) failures.push(`Failed requests:\n${formatIssueList(requestFailures)}`)
    if (forbiddenRequests.length > 0) failures.push(`Desktop-only requests:\n${formatIssueList(forbiddenRequests)}`)

    if (failures.length > 0) {
        throw new Error(`Remote route smoke failed:\n\n${failures.join("\n\n")}`)
    }

    console.log(
        JSON.stringify(
            {
                ok: true,
                route: `${baseUrl}#/remote`,
                rendered: ["OpenADE", "COMPANION", "Connect"],
                forbiddenRequestMarkers,
            },
            null,
            2
        )
    )
} finally {
    if (browser) await browser.close()
    await server.close()
}
