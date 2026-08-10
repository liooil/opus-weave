/**
 * device-profile — device profiles with editable control defaults.
 *
 * A profile identifies a hardware device by loose manufacturer/name matching
 * (never a single hard-coded port id) and maps its knobs/pads/buttons to MIDI
 * messages. Defaults are editable at runtime; they are NOT treated as
 * immutable facts about the device.
 */
import { OpusWeaveError } from '../../shared/errors.ts'

export type ControlKind = 'cc' | 'note' | 'pitchBend' | 'transport'

export interface ControlMapping {
  kind: ControlKind
  /** Controller number for `cc`. */
  controller?: number
  /** Note number for `note`. */
  note?: number
  /** Message type for `transport` (cc/note/sysex/mmc). */
  transportType?: 'cc' | 'note' | 'sysex' | 'mmc'
  /** Value for transport triggers. */
  value?: number
}

export interface DeviceMatchRule {
  field: 'name' | 'manufacturer'
  /** Regular expression source. */
  pattern: string
  flags?: string
}

export interface DeviceProfile {
  /** Stable profile id (e.g. 'midiplus-tiny-plus'). */
  id: string
  /** Human-readable profile name. */
  name: string
  match: DeviceMatchRule[]
  /** Editable control bindings: control id -> message mapping. */
  controls: Record<string, ControlMapping>
  /** Default note range of the keyboard (for virtual keyboard sizing). */
  noteRange?: { min: number; max: number }
}

/** True when a profile matches the given port name/manufacturer. */
export function profileMatchesPort(profile: DeviceProfile, name: string | undefined, manufacturer: string | undefined): boolean {
  for (const rule of profile.match) {
    const haystack = rule.field === 'name' ? (name ?? '') : (manufacturer ?? '')
    try {
      if (new RegExp(rule.pattern, rule.flags).test(haystack)) return true
    } catch {
      // invalid pattern in a profile is a profile bug, not a port bug
      continue
    }
  }
  return false
}

export function findProfileForPort(profiles: DeviceProfile[], name: string | undefined, manufacturer: string | undefined): DeviceProfile | null {
  for (const p of profiles) {
    if (profileMatchesPort(p, name, manufacturer)) return p
  }
  return null
}

/** Apply a user override for one control; keeps the rest of the profile intact. */
export function overrideControl(profile: DeviceProfile, controlId: string, mapping: ControlMapping): DeviceProfile {
  if (!(controlId in profile.controls)) {
    throw new OpusWeaveError('invalid-spec', `control '${controlId}' does not exist in profile '${profile.id}'`)
  }
  return { ...profile, controls: { ...profile.controls, [controlId]: mapping } }
}

/** Resolve a control message into raw MIDI bytes (or null for transport/sysex that has no single byte form). */
export function controlToMidiBytes(mapping: ControlMapping, channel: number, value: number): Uint8Array | null {
  switch (mapping.kind) {
    case 'cc':
      return new Uint8Array([0xb0 | channel, mapping.controller ?? 0, value & 0x7f])
    case 'note':
      return new Uint8Array([0x90 | channel, mapping.note ?? 0, value & 0x7f])
    case 'pitchBend':
      return new Uint8Array([0xe0 | channel, value & 0x7f, (value >> 7) & 0x7f])
    default:
      return null
  }
}
