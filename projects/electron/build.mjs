// make.mjs (node LTS - node Current)
import ES from "esbuild"
import { spawnSync } from "child_process"
import { mkdirSync, readFileSync } from "fs"
import path from "path"
import { copySync } from 'fs-extra/esm'

const localPkgJson = JSON.parse(readFileSync("./package.json", "utf-8"))

const externalDep = {
  ...(localPkgJson.dependencies || {}),
  ...(localPkgJson.devDependencies || {}),
  ...(localPkgJson.peerDependencies || {}),
}

function openadeCoreBinaryName() {
  return process.platform === "win32" ? "openade-core.exe" : "openade-core"
}

function buildOpenADECore() {
  if (process.env.OPENADE_SKIP_CORE_BUILD === "1") {
    console.log("skipping OpenADE Core build.")
    return
  }

  console.time("building OpenADE Core.")
  const outputDir = path.resolve("dist", "openade-core")
  mkdirSync(outputDir, { recursive: true })
  const outputPath = path.join(outputDir, openadeCoreBinaryName())
  const result = spawnSync("go", ["build", "-o", outputPath, "./cmd/openade-core"], {
    cwd: path.resolve("../openade-core"),
    stdio: "inherit",
    env: process.env,
  })
  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(`OpenADE Core build failed with exit code ${result.status}`)
  }
  console.timeEnd("building OpenADE Core.")
}

async function make() {
  buildOpenADECore()

  // For the main process we only want to bundle the local files, no deps.
  console.time("building main process.")
  await ES.build({
    bundle: true,
    minify: true,
    entryPoints: ["./src/main.ts"],
    sourcemap: "linked",
    external: Object.keys(externalDep),
    define: {
      "process.env.NODE_ENV": process.env.DEBUG === "1" ? '"dev"' : '"production"',
      "process.env.RELEASE": `"${process.env.RELEASE || "unknown"}"`,
    },
    platform: "node",
    format: "cjs",
    outfile: "dist/main.js",
  })
  console.timeEnd("building main process.")

  // Build preload script for context isolation
  console.time("building preload script.")
  await ES.build({
    bundle: true,
    minify: true,
    entryPoints: ["./src/preload.ts"],
    sourcemap: "linked",
    external: ["electron"],
    platform: "node",
    format: "cjs",
    outfile: "dist/preload.js",
  })
  console.timeEnd("building preload script.")

  copySync("./src/pages", "./dist/pages", { overwrite: true }, function (err) {
    if (err) {
      console.error(err)
    } else {
      console.log("success!")
    }
  })

}

await make()
