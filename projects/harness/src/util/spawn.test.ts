import { describe, it, expect } from "vitest"
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
})
