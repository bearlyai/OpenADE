import { describe, it, expect } from "vitest"
import { execFileSync } from "node:child_process"
import { spawnJsonl } from "./spawn.js"
import type { HarnessEvent } from "../types.js"

async function collectEvents<M>(gen: AsyncGenerator<HarnessEvent<M>>): Promise<HarnessEvent<M>[]> {
    const events: HarnessEvent<M>[] = []
    for await (const event of gen) {
        events.push(event)
    }
    return events
}

describe("spawnJsonl", () => {
    it("parses JSONL lines from stdout", async () => {
        const script = `
      console.log(JSON.stringify({ type: "msg", data: 1 }));
      console.log(JSON.stringify({ type: "msg", data: 2 }));
      console.log(JSON.stringify({ type: "done" }));
    `
        const ac = new AbortController()
        const events = await collectEvents(
            spawnJsonl<Record<string, unknown>>({
                command: "node",
                args: ["-e", script],
                signal: ac.signal,
                parseLine: (line) => {
                    const parsed = JSON.parse(line)
                    return { type: "message", message: parsed }
                },
            })
        )

        const messages = events.filter((e) => e.type === "message")
        expect(messages).toHaveLength(3)
        expect((messages[0] as { type: "message"; message: { data: number } }).message.data).toBe(1)
        expect((messages[1] as { type: "message"; message: { data: number } }).message.data).toBe(2)
    })

    it("captures stderr and yields stderr events", async () => {
        const script = `
      console.error("warning: something happened");
      console.log(JSON.stringify({ type: "ok" }));
    `
        const ac = new AbortController()
        const events = await collectEvents(
            spawnJsonl<Record<string, unknown>>({
                command: "node",
                args: ["-e", script],
                signal: ac.signal,
                parseLine: (line) => {
                    const parsed = JSON.parse(line)
                    return { type: "message", message: parsed }
                },
            })
        )

        const stderrEvents = events.filter((e) => e.type === "stderr")
        expect(stderrEvents.length).toBeGreaterThan(0)
        expect((stderrEvents[0] as { type: "stderr"; data: string }).data).toContain("warning: something happened")
    })

    it("handles abort signal", async () => {
        const script = `
      setInterval(() => {
        console.log(JSON.stringify({ type: "tick" }));
      }, 100);
    `
        const ac = new AbortController()
        const startedAt = Date.now()

        // Abort after a short delay
        setTimeout(() => ac.abort(), 300)

        const events = await collectEvents(
            spawnJsonl<Record<string, unknown>>({
                command: "node",
                args: ["-e", script],
                signal: ac.signal,
                parseLine: (line) => {
                    const parsed = JSON.parse(line)
                    return { type: "message", message: parsed }
                },
            })
        )

        // Should have received some ticks but then been aborted
        const abortEvents = events.filter((e) => e.type === "error" && (e as { code?: string }).code === "aborted")
        expect(abortEvents.length).toBeGreaterThan(0)
        expect(Date.now() - startedAt).toBeLessThan(5000)
    })

    it("handles process crash (non-zero exit)", async () => {
        const script = `process.exit(42)`
        const ac = new AbortController()

        const events = await collectEvents(
            spawnJsonl<Record<string, unknown>>({
                command: "node",
                args: ["-e", script],
                signal: ac.signal,
                parseLine: (line) => {
                    const parsed = JSON.parse(line)
                    return { type: "message", message: parsed }
                },
            })
        )

        const errorEvents = events.filter((e) => e.type === "error")
        expect(errorEvents.length).toBeGreaterThan(0)
        expect((errorEvents[0] as { code?: string }).code).toBe("process_crashed")
    })

    it("skips malformed JSON lines", async () => {
        const script = `
      console.log("not json at all");
      console.log(JSON.stringify({ type: "valid" }));
      console.log("{broken json");
      console.log(JSON.stringify({ type: "also_valid" }));
    `
        const ac = new AbortController()

        const events = await collectEvents(
            spawnJsonl<Record<string, unknown>>({
                command: "node",
                args: ["-e", script],
                signal: ac.signal,
                parseLine: (line) => {
                    const parsed = JSON.parse(line)
                    return { type: "message", message: parsed }
                },
            })
        )

        // Only valid JSON lines should produce message events
        const messages = events.filter((e) => e.type === "message")
        expect(messages).toHaveLength(2)
    })

    it("handles empty stdout", async () => {
        const script = `// no output`
        const ac = new AbortController()

        const events = await collectEvents(
            spawnJsonl<Record<string, unknown>>({
                command: "node",
                args: ["-e", script],
                signal: ac.signal,
                parseLine: (line) => {
                    const parsed = JSON.parse(line)
                    return { type: "message", message: parsed }
                },
            })
        )

        const messages = events.filter((e) => e.type === "message")
        expect(messages).toHaveLength(0)
    })

    it("calls onExit with exit code and stderr", async () => {
        const script = `
      console.error("some error info");
      process.exit(1);
    `
        const ac = new AbortController()
        let capturedCode: number | null = null
        let capturedStderr = ""

        const events = await collectEvents(
            spawnJsonl<Record<string, unknown>>({
                command: "node",
                args: ["-e", script],
                signal: ac.signal,
                parseLine: (line) => {
                    const parsed = JSON.parse(line)
                    return { type: "message", message: parsed }
                },
                onExit: (code, stderr) => {
                    capturedCode = code
                    capturedStderr = stderr
                    return { type: "complete" }
                },
            })
        )

        expect(capturedCode).toBe(1)
        expect(capturedStderr).toContain("some error info")

        const completeEvents = events.filter((e) => e.type === "complete")
        expect(completeEvents).toHaveLength(1)
    })

    it("handles already-aborted signal", async () => {
        const ac = new AbortController()
        ac.abort()

        const events = await collectEvents(
            spawnJsonl<Record<string, unknown>>({
                command: "node",
                args: ["-e", "console.log('hello')"],
                signal: ac.signal,
                parseLine: (line) => {
                    const parsed = JSON.parse(line)
                    return { type: "message", message: parsed }
                },
            })
        )

        const errorEvents = events.filter((e) => e.type === "error" && (e as { code?: string }).code === "aborted")
        expect(errorEvents.length).toBeGreaterThan(0)
    })

    it("parseLine can return multiple events", async () => {
        const script = `console.log(JSON.stringify({ type: "multi" }));`
        const ac = new AbortController()

        const events = await collectEvents(
            spawnJsonl<Record<string, unknown>>({
                command: "node",
                args: ["-e", script],
                signal: ac.signal,
                parseLine: (_line) => {
                    return [
                        { type: "message", message: { first: true } },
                        { type: "message", message: { second: true } },
                    ]
                },
            })
        )

        const messages = events.filter((e) => e.type === "message")
        expect(messages).toHaveLength(2)
    })

    it("writes raw stdinData to child stdin", async () => {
        const script = `
      let body = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => { body += chunk; });
      process.stdin.on("end", () => {
        console.log(JSON.stringify({ type: "stdin", body }));
      });
    `
        const ac = new AbortController()

        const events = await collectEvents(
            spawnJsonl<Record<string, unknown>>({
                command: "node",
                args: ["-e", script],
                signal: ac.signal,
                stdinData: "alpha\nbeta\n--gamma",
                parseLine: (line) => ({ type: "message", message: JSON.parse(line) }),
            })
        )

        const stdinMsg = events.find((e) => e.type === "message") as
            | { type: "message"; message: { body: string } }
            | undefined
        expect(stdinMsg).toBeDefined()
        expect(stdinMsg!.message.body).toBe("alpha\nbeta\n--gamma")
    })

    it("rejects when stdinLines and stdinData are both provided", async () => {
        const ac = new AbortController()
        await expect(
            collectEvents(
                spawnJsonl<Record<string, unknown>>({
                    command: "node",
                    args: ["-e", "console.log(JSON.stringify({ok:true}))"],
                    signal: ac.signal,
                    stdinLines: ["a"],
                    stdinData: "b",
                    parseLine: (line) => ({ type: "message", message: JSON.parse(line) }),
                })
            )
        ).rejects.toThrow("stdinLines and stdinData are mutually exclusive")
    })

    it.skipIf(process.platform === "win32")("supports argv0 labeling without leaking stdin prompt to ps", async () => {
        const ac = new AbortController()
        const promptSentinel = `PROMPT_SENTINEL_${Date.now()}`
        const label = `openade-spawn-test-${Date.now()}`
        let pid: number | undefined

        const eventsPromise = collectEvents(
            spawnJsonl<Record<string, unknown>>({
                command: "sleep",
                args: ["30"],
                signal: ac.signal,
                stdinData: promptSentinel,
                argv0: label,
                onSpawn: (childPid) => {
                    pid = childPid
                },
                parseLine: () => null,
            })
        )

        const deadline = Date.now() + 5000
        while (!pid && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 25))
        }
        expect(pid, "spawn should expose child pid").toBeDefined()

        const commandLine = execFileSync("ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf-8" }).trim()
        expect(commandLine).toContain(label)
        expect(commandLine).not.toContain(promptSentinel)

        ac.abort()
        const events = await eventsPromise
        expect(events.some((e) => e.type === "error" && (e as { code?: string }).code === "aborted")).toBe(true)
    })
})
