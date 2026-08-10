/**
 * midiplus-tiny-plus — the first built-in device profile.
 *
 * MIDIPLUS TINY+ is a 32-key USB MIDI keyboard. Defaults follow the
 * documented TINY+ behavior; users can remap every control, so these values
 * are starting points, not guarantees.
 */
import type { DeviceProfile } from './device-profile.ts'

export function midiplusTinyPlusProfile(): DeviceProfile {
  return {
    id: 'midiplus-tiny-plus',
    name: 'MIDIPLUS TINY+ Default',
    match: [
      { field: 'name', pattern: 'midiplus|tiny', flags: 'i' },
      { field: 'manufacturer', pattern: 'midiplus', flags: 'i' },
    ],
    noteRange: { min: 36, max: 67 }, // 32 keys, C2..G4
    controls: {
      'k1': { kind: 'cc', controller: 93 }, // K1 default: CC93
      'k2': { kind: 'cc', controller: 91 }, // K2 default: CC91 (reverb)
      'k3': { kind: 'cc', controller: 71 }, // K3 default: CC71 (resonance)
      'k4': { kind: 'cc', controller: 74 }, // K4 default: CC74 (cutoff)
      'mod': { kind: 'cc', controller: 1 }, // Modulation wheel
      'sustain': { kind: 'cc', controller: 64 }, // Sustain pedal
      'pitchBend': { kind: 'pitchBend' },
      'pad1': { kind: 'note', note: 60 },
      'pad2': { kind: 'note', note: 62 },
      'pad3': { kind: 'note', note: 64 },
      'pad4': { kind: 'note', note: 65 },
      'play': { kind: 'transport', transportType: 'cc', controller: 0, value: 1 },
      'stop': { kind: 'transport', transportType: 'cc', controller: 0, value: 0 },
      'rec': { kind: 'transport', transportType: 'mmc' },
    },
  }
}
