// make.mjs (node LTS - node Current)
import ES from "esbuild"
import { readFileSync } from "fs"
import { copySync } from 'fs-extra/esm'

const localPkgJson = JSON.parse(readFileSync("./package.json", "utf-8"))

const externalDep = {
  ...(localPkgJson.dependencies || {}),
  ...(localPkgJson.devDependencies || {}),
  ...(localPkgJson.peerDependencies || {}),
}

async function make() {
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
