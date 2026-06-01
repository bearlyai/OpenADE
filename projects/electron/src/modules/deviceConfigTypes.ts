export interface DeviceConfig {
    deviceId: string
    telemetryDisabled?: boolean
}

export interface DeviceConfigResult extends DeviceConfig {
    /** True when this process had to generate a device ID because no valid config was found. */
    wasGenerated: boolean
    /** True when the config file existed but could not be parsed or read. */
    readFailed: boolean
}
