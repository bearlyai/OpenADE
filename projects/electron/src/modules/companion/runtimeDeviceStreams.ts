type RemoteDeviceStreamCloser = (deviceId?: string) => void

const streamClosers = new Set<RemoteDeviceStreamCloser>()

export function registerRemoteDeviceStreamCloser(closer: RemoteDeviceStreamCloser): () => void {
    streamClosers.add(closer)
    return () => streamClosers.delete(closer)
}

export function closeRemoteDeviceStreams(deviceId?: string): void {
    for (const closer of streamClosers) closer(deviceId)
}
