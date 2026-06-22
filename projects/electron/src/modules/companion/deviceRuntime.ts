import type {
    RemoteDeviceDropAllResult,
    RemoteDeviceListResult,
    RemoteDeviceRevokeRequest,
    RemoteDeviceRevokeResult,
    RemoteDeviceSelfRevokeResult,
} from "../../../../shared/companion/src"
import { OPENADE_NOTIFICATION, OPENADE_REMOTE_METHOD } from "../../../../openade-client/src"
import { RuntimeHandlerError, type RuntimeHandlerContext, type RuntimeServer } from "../../../../runtime/src"
import { dropAllDevices, listDevices, revokeDevice } from "./auth"
import { closeRemoteDeviceStreams } from "./runtimeDeviceStreams"

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null
}

function parseRevokeRequest(params: unknown): RemoteDeviceRevokeRequest {
    if (!isRecord(params)) {
        throw new RuntimeHandlerError("invalid_params", "Device revoke params must be an object")
    }
    const deviceId = params.deviceId
    if (typeof deviceId !== "string" || deviceId.length === 0) {
        throw new RuntimeHandlerError("invalid_params", "deviceId is required")
    }
    return { deviceId }
}

function notifyDevicesChanged(server: RuntimeServer): void {
    server.notify(OPENADE_NOTIFICATION.remoteDeviceChanged, { type: "devices_changed", at: new Date().toISOString() })
}

function closeRemoteDeviceStreamsAfterResponse(server: RuntimeServer, deviceId?: string): void {
    const timer = setTimeout(() => {
        notifyDevicesChanged(server)
        closeRemoteDeviceStreams(deviceId)
    }, 25)
    timer.unref?.()
}

function selfDeviceId(context: RuntimeHandlerContext): string {
    const deviceId = context.connection.metadata?.deviceId
    if (typeof deviceId !== "string" || deviceId.length === 0) {
        throw new RuntimeHandlerError("permission_denied", "Self revoke is only available to paired remote devices")
    }
    return deviceId
}

export function registerRemoteDeviceRuntimeMethods(server: RuntimeServer): void {
    server.register(OPENADE_REMOTE_METHOD.remoteDeviceList, (): RemoteDeviceListResult => ({ devices: listDevices() }))

    server.register(OPENADE_REMOTE_METHOD.remoteDeviceRevoke, (params): RemoteDeviceRevokeResult => {
        const { deviceId } = parseRevokeRequest(params)
        const revoked = revokeDevice(deviceId)
        if (revoked) {
            notifyDevicesChanged(server)
            closeRemoteDeviceStreams(deviceId)
        }
        return { ok: true, revoked, devices: listDevices() }
    })

    server.register(OPENADE_REMOTE_METHOD.remoteDeviceDropAll, (): RemoteDeviceDropAllResult => {
        dropAllDevices()
        notifyDevicesChanged(server)
        closeRemoteDeviceStreams()
        return { ok: true, devices: listDevices() }
    })

    server.register(OPENADE_REMOTE_METHOD.remoteDeviceSelfRevoke, (_params, context): RemoteDeviceSelfRevokeResult => {
        const deviceId = selfDeviceId(context)
        const revoked = revokeDevice(deviceId)
        closeRemoteDeviceStreamsAfterResponse(server, deviceId)
        return { ok: true, revoked }
    })
}
