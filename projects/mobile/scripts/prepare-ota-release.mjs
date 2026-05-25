import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

const projectRoot = dirname(fileURLToPath(import.meta.url)).replace(/\/scripts$/, "")
const packageJson = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8"))
const distDir = join(projectRoot, "dist")
const outDir = join(projectRoot, "build", "ota")
const zipPath = join(outDir, "dist.zip")
const manifestPath = join(outDir, "updates.json")

function requiredEnv(name) {
    const value = process.env[name]?.trim()
    if (!value) throw new Error(`${name} is required`)
    return value
}

function sanitizeVersion(value) {
    return value.replace(/[^0-9A-Za-z._-]/g, "-")
}

function defaultVersion() {
    const run = process.env.GITHUB_RUN_NUMBER || new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 12)
    const sha = process.env.GITHUB_SHA?.slice(0, 7)
    return sanitizeVersion([packageJson.version, run, sha].filter(Boolean).join("-"))
}

function run(command, args, options = {}) {
    const result = spawnSync(command, args, { stdio: "inherit", ...options })
    if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed`)
}

function objectPrefixFromPublicBase(url) {
    const parsed = new URL(url)
    return parsed.pathname.replace(/^\/+|\/+$/g, "")
}

if (!existsSync(join(distDir, "index.html"))) {
    throw new Error("dist/index.html is missing. Run npm run build before preparing OTA release.")
}

const publicBaseUrl = requiredEnv("OTA_PUBLIC_BASE_URL").replace(/\/+$/g, "")
const channel = process.env.OPENADE_OTA_CHANNEL?.trim() || "production"
const version = sanitizeVersion(process.env.OTA_BUNDLE_VERSION?.trim() || defaultVersion())
const prefix = objectPrefixFromPublicBase(publicBaseUrl)
const zipKey = [prefix, "bundles", version, "dist.zip"].filter(Boolean).join("/")
const manifestKey = [prefix, "updates.json"].filter(Boolean).join("/")
const zipUrl = `${publicBaseUrl}/bundles/${version}/dist.zip`

rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })
run("zip", ["-qry", zipPath, "."], { cwd: distDir })

const zip = readFileSync(zipPath)
const checksum = createHash("sha256").update(zip).digest("hex")
const manifest = {
    version,
    url: zipUrl,
    checksum,
    channel,
    comment: process.env.OTA_RELEASE_NOTES?.trim() || `OpenADE mobile web bundle ${version}`,
    uploadedAt: new Date().toISOString(),
}

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

console.log(`version=${version}`)
console.log(`zip_path=${zipPath}`)
console.log(`zip_key=${zipKey}`)
console.log(`manifest_path=${manifestPath}`)
console.log(`manifest_key=${manifestKey}`)
