import { describe, expect, test } from 'bun:test'
import { selectAudioOutputDevice } from '../audio/audio-output.ts'

const devices = [
  { deviceId: 'default', label: 'Default - Speakers' },
  { deviceId: 'monitor-new', label: 'T32p-30 (5)' },
  { deviceId: 'laptop', label: 'Speakers (Realtek Audio)' },
]

describe('audio output device restoration', () => {
  test('restores by exact device ID', () => {
    expect(selectAudioOutputDevice(devices, { deviceId: 'laptop', label: 'Speakers (Realtek Audio)' })).toEqual(devices[2]!)
  })

  test('falls back by label when a reconnected device gets a new ID', () => {
    expect(selectAudioOutputDevice(devices, { deviceId: 'monitor-old', label: 'T32p-30 (5)' })).toEqual(devices[1]!)
  })

  test('uses the operating-system default when no saved device matches', () => {
    expect(selectAudioOutputDevice(devices, { deviceId: 'missing', label: 'Missing' })).toEqual(devices[0]!)
    expect(selectAudioOutputDevice([], null)).toBeNull()
  })

  test('recognizes the empty browser sink ID as the system default', () => {
    const browserDevices = [{ deviceId: '', label: '' }, { deviceId: 'monitor', label: 'T32p-30 (5)' }]
    expect(selectAudioOutputDevice(browserDevices, null)).toEqual(browserDevices[0]!)
  })
})
