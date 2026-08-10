/**
 * mapping-engine — maps input sources (computer keys, hardware controls) to
 * MIDI messages. UI event handlers never hardcode synth calls: they go
 * through this engine.
 */
import type { ControlMapping } from './device-profile.ts'

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const

/** Human-readable name for a MIDI note, e.g. 60 -> "C4". */
export function noteName(note: number): string {
  const name = NOTE_NAMES[((note % 12) + 12) % 12]!
  const octave = Math.floor(note / 12) - 1
  return `${name}${octave}`
}

export interface ComputerKeyMapping {
  /** Keyboard layout: key (lowercase, e.g. 'a') -> semitone offset from base. */
  layout: Record<string, number>
}

/** Default 2-octave row mapping: Z..M (white keys) + S..L (black keys). */
const DEFAULT_LAYOUT: Record<string, number> = {
  z: 0, s: 1, x: 2, d: 3, c: 4, v: 5, g: 6, b: 7, h: 8, n: 9, j: 10, m: 11,
  q: 12, '2': 13, w: 14, '3': 15, e: 16, r: 17, '5': 18, t: 19, '6': 20, y: 21, '7': 22, u: 23,
}

export interface KeyToMidiResult {
  note: number
  /** True when this key press should produce a Note On (false = keyup Note Off). */
  on: boolean
}

export class MappingEngine {
  /** Base MIDI note for the lowest key ('z'). */
  private baseNote: number
  /** Octave shift in semitones (12 * octave). */
  private octaveShift: number
  /** Fixed velocity for computer-keyboard playing. */
  private velocity: number
  /** Channel used for computer-keyboard output. */
  private channel: number

  constructor(opts?: { baseNote?: number; octaveShift?: number; velocity?: number; channel?: number }) {
    this.baseNote = opts?.baseNote ?? 48 // C3
    this.octaveShift = opts?.octaveShift ?? 0
    this.velocity = opts?.velocity ?? 100
    this.channel = opts?.channel ?? 0
  }

  /** Map a computer key to a MIDI note; null when the key is not mapped. */
  keyToNote(key: string): number | null {
    const offset = DEFAULT_LAYOUT[key]
    if (offset === undefined) return null
    return this.baseNote + offset + this.octaveShift
  }

  shiftOctave(delta: number): void {
    this.octaveShift += delta * 12
  }

  get currentOctaveShift(): number {
    return this.octaveShift
  }

  setVelocity(v: number): void {
    this.velocity = Math.max(1, Math.min(127, Math.round(v)))
  }

  get fixedVelocity(): number {
    return this.velocity
  }

  setChannel(ch: number): void {
    this.channel = Math.max(0, Math.min(15, ch))
  }

  /** Build a Note On message for a computer key (keydown). */
  keyDownMessage(key: string): Uint8Array | null {
    const note = this.keyToNote(key)
    if (note === null) return null
    return new Uint8Array([0x90 | this.channel, note, this.velocity])
  }

  /** Build a Note Off message for a computer key (keyup). */
  keyUpMessage(key: string): Uint8Array | null {
    const note = this.keyToNote(key)
    if (note === null) return null
    return new Uint8Array([0x80 | this.channel, note, 0x40])
  }

  /** Build a message for a hardware control from a profile mapping. */
  controlMessage(mapping: ControlMapping, value: number): Uint8Array | null {
    switch (mapping.kind) {
      case 'cc':
        return new Uint8Array([0xb0 | this.channel, mapping.controller ?? 0, Math.max(0, Math.min(127, Math.round(value)))])
      case 'note': {
        const on = value > 0
        return new Uint8Array([(on ? 0x90 : 0x80) | this.channel, mapping.note ?? 0, on ? Math.max(1, Math.min(127, Math.round(value))) : 0x40])
      }
      case 'pitchBend': {
        const v = Math.max(0, Math.min(16383, Math.round(value)))
        return new Uint8Array([0xe0 | this.channel, v & 0x7f, (v >> 7) & 0x7f])
      }
      default:
        return null
    }
  }
}
