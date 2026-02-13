import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { HarnessEvent } from "./types.js"

export async function collectEvents<M>(gen: AsyncGenerator<HarnessEvent<M>>): Promise<HarnessEvent<M>[]> {
    const events: HarnessEvent<M>[] = []
    for await (const event of gen) {
        events.push(event)
    }
    return events
}

export async function makeTmpDir(): Promise<{ path: string; cleanup: () => Promise<void> }> {
    const path = await mkdtemp(join(tmpdir(), "harness-integ-"))
    return {
        path,
        cleanup: async () => {
            try {
                await rm(path, { recursive: true, force: true })
            } catch {
                // Ignore cleanup errors
            }
        },
    }
}

export async function writeEchoMcpServer(): Promise<{ scriptPath: string; cleanup: () => Promise<void> }> {
    const dir = await mkdtemp(join(tmpdir(), "harness-mcp-echo-"))
    const scriptPath = join(dir, "echo-server.mjs")

    const script = `
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new Server(
    { name: "test-echo", version: "1.0.0" },
    { capabilities: { tools: {} } }
);

server.setRequestHandler(
    { method: "tools/list" },
    async () => ({
        tools: [{
            name: "test_echo",
            description: "Echoes back the input text",
            inputSchema: {
                type: "object",
                properties: { text: { type: "string", description: "Text to echo" } },
                required: ["text"],
            },
        }],
    })
);

server.setRequestHandler(
    { method: "tools/call" },
    async (request) => {
        if (request.params.name === "test_echo") {
            const text = request.params.arguments?.text ?? "";
            return { content: [{ type: "text", text: String(text) }] };
        }
        return { content: [{ type: "text", text: "Unknown tool" }], isError: true };
    }
);

const transport = new StdioServerTransport();
await server.connect(transport);
`

    await writeFile(scriptPath, script, "utf-8")

    return {
        scriptPath,
        cleanup: async () => {
            try {
                await rm(dir, { recursive: true, force: true })
            } catch {
                // Ignore cleanup errors
            }
        },
    }
}

export function trivialSignal(): AbortSignal {
    return AbortSignal.timeout(30_000)
}

export function standardSignal(): AbortSignal {
    return AbortSignal.timeout(60_000)
}

export function heavySignal(): AbortSignal {
    return AbortSignal.timeout(120_000)
}

export function findEvent<M>(events: HarnessEvent<M>[], type: string): HarnessEvent<M> | undefined {
    return events.find((e) => e.type === type)
}

export function findAllEvents<M>(events: HarnessEvent<M>[], type: string): HarnessEvent<M>[] {
    return events.filter((e) => e.type === type)
}

export function findAllMessages<M>(events: HarnessEvent<M>[]): M[] {
    return events.filter((e) => e.type === "message").map((e) => (e as { type: "message"; message: M }).message)
}

export function getCompleteEvent<M>(events: HarnessEvent<M>[]): Extract<HarnessEvent<M>, { type: "complete" }> | undefined {
    return events.find((e) => e.type === "complete") as Extract<HarnessEvent<M>, { type: "complete" }> | undefined
}

export function getSessionStartedEvent<M>(events: HarnessEvent<M>[]): Extract<HarnessEvent<M>, { type: "session_started" }> | undefined {
    return events.find((e) => e.type === "session_started") as Extract<HarnessEvent<M>, { type: "session_started" }> | undefined
}

export function getErrorEvents<M>(events: HarnessEvent<M>[]): Extract<HarnessEvent<M>, { type: "error" }>[] {
    return events.filter((e) => e.type === "error") as Extract<HarnessEvent<M>, { type: "error" }>[]
}

