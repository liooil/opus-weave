export interface AudioOutputDevice {
  deviceId: string
  label: string
}

export interface SavedAudioOutput {
  deviceId: string
  label: string
}

/** Device IDs may change after reconnect; restore by ID, then label, then system default. */
export function selectAudioOutputDevice(
  devices: readonly AudioOutputDevice[],
  saved?: SavedAudioOutput | null,
): AudioOutputDevice | null {
  if (devices.length === 0) return null
  if (saved?.deviceId) {
    const exact = devices.find((device) => device.deviceId === saved.deviceId)
    if (exact) return exact
  }
  if (saved?.label) {
    const sameLabel = devices.find((device) => device.label === saved.label)
    if (sameLabel) return sameLabel
  }
  return devices.find((device) => device.deviceId === 'default' || device.deviceId === '') ?? devices[0]!
}
