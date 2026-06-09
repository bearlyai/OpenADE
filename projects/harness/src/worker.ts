#!/usr/bin/env node

import { runCommandAgentWorker } from "./agent-worker.js"

const controller = new AbortController()
process.once("SIGINT", () => controller.abort())
process.once("SIGTERM", () => controller.abort())

const exitCode = await runCommandAgentWorker({
    input: process.stdin,
    output: process.stdout,
    errorOutput: process.stderr,
    signal: controller.signal,
})

process.exitCode = exitCode
