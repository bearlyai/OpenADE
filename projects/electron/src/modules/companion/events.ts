import type { ServerResponse } from "node:http"
import type { CompanionEvent } from "../../../../shared/companion/src"

interface EventEnvelope {
    id: number
    event: CompanionEvent
}

const MAX_REPLAY_EVENTS = 200

export class CompanionEventHub {
    private clients = new Map<ServerResponse, string>()
    private clientsByDeviceId = new Map<string, Set<ServerResponse>>()
    private replay: EventEnvelope[] = []
    private nextId = 1

    addClient(deviceId: string, response: ServerResponse, lastEventId?: number): void {
        response.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no",
        })

        for (const envelope of this.replay) {
            if (lastEventId !== undefined && envelope.id <= lastEventId) continue
            this.write(response, envelope)
        }

        this.clients.set(response, deviceId)
        const deviceClients = this.clientsByDeviceId.get(deviceId) ?? new Set<ServerResponse>()
        deviceClients.add(response)
        this.clientsByDeviceId.set(deviceId, deviceClients)

        response.on("close", () => {
            this.removeClient(response)
        })
    }

    publish(event: CompanionEvent): void {
        const envelope = { id: this.nextId++, event }
        this.replay.push(envelope)
        if (this.replay.length > MAX_REPLAY_EVENTS) {
            this.replay.splice(0, this.replay.length - MAX_REPLAY_EVENTS)
        }

        for (const client of this.clients.keys()) {
            this.write(client, envelope)
        }
    }

    closeDevice(deviceId: string): void {
        const clients = this.clientsByDeviceId.get(deviceId)
        if (!clients) return

        for (const client of clients) {
            client.end()
            this.removeClient(client)
        }
    }

    closeAll(): void {
        for (const client of this.clients.keys()) {
            client.end()
        }
        this.clients.clear()
        this.clientsByDeviceId.clear()
    }

    private removeClient(response: ServerResponse): void {
        const deviceId = this.clients.get(response)
        this.clients.delete(response)
        if (!deviceId) return

        const deviceClients = this.clientsByDeviceId.get(deviceId)
        if (!deviceClients) return
        deviceClients.delete(response)
        if (deviceClients.size === 0) {
            this.clientsByDeviceId.delete(deviceId)
        }
    }

    private write(response: ServerResponse, envelope: EventEnvelope): void {
        response.write(`id: ${envelope.id}\n`)
        response.write(`event: ${envelope.event.type}\n`)
        response.write(`data: ${JSON.stringify(envelope.event)}\n\n`)
    }
}
