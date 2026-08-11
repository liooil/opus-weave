/**
 * mapping-engine — maps input sources (computer keys, hardware controls) to
 * MIDI messages. UI event handlers never hardcode synth calls: they go
 * through this engine.
 */
import type { ControlMapping } from './device-profile.ts'
import { musicalTypingStep, type MusicalTypingMode } from '../composition/musical-typing.ts'

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const

/** Human-readable name for a MIDI note, e.g. 60 -> "C4". */
export function noteName(note: number): string {
  const name = NOTE_NAMES[((note % 12) + 12) % 12]!
  const octave = Math.floor(note / 12) - 1
  return `${name}${octave}`
}

export type BuiltinComputerLayoutId = 'default' | 'english' | 'pinyin' | 'freepiano'

export interface ComputerKeyboardLayout {
  id: string
  /** Static key offsets from baseNote. Omit offsets for a stateful musical-text layout. */
  keys: Record<string, number>
  baseNote: number
  musicalMode?: MusicalTypingMode
}

export interface ComputerKeyAssignment {
  key: string
  semitoneOffset: number
  note: number
}

const DEFAULT_LAYOUT: ComputerKeyboardLayout = {
  id: 'default',
  baseNote: 48,
  keys: {
    z: 0, s: 1, x: 2, d: 3, c: 4, v: 5, g: 6, b: 7, h: 8, n: 9, j: 10, m: 11,
    q: 12, '2': 13, w: 14, '3': 15, e: 16, r: 17, '5': 18, t: 19, '6': 20, y: 21, '7': 22, u: 23,
  },
}

function musicalKeys(mode: MusicalTypingMode): ComputerKeyboardLayout {
  const keys: Record<string, number> = {}
  for (const key of 'abcdefghijklmnopqrstuvwxyz') keys[key] = 0
  for (const key of [' ', ',', '.', ';']) keys[key] = 0
  if (mode === 'pinyin') for (const key of ['1', '2', '3', '4']) keys[key] = 0
  return { id: mode, baseNote: 48, keys, musicalMode: mode }
}

/** Main-key section of FreePiano 1.8's canonical data/freepiano.map. */
const FREEPIANO_CLASSIC_LAYOUT: ComputerKeyboardLayout = {
  id: 'freepiano',
  baseNote: 36,
  keys: {
    z: 0, x: 2, c: 4, v: 5, b: 7, n: 9, m: 11, ',': 12, '.': 14, '/': 16,
    a: 12, s: 14, d: 16, f: 17, g: 19, h: 21, j: 23, k: 24, l: 26, ';': 28, "'": 29,
    q: 24, w: 26, e: 28, r: 29, t: 31, y: 33, u: 35, i: 36, o: 38, p: 40, '[': 41, ']': 43, '\\': 45,
    '`': 35, '1': 36, '2': 38, '3': 40, '4': 41, '5': 43, '6': 45, '7': 47, '8': 48, '9': 50, '0': 52, '-': 53, '=': 55,
  },
}

export const BUILTIN_COMPUTER_LAYOUTS: Readonly<Record<BuiltinComputerLayoutId, ComputerKeyboardLayout>> = {
  default: DEFAULT_LAYOUT,
  english: musicalKeys('english'),
  pinyin: musicalKeys('pinyin'),
  freepiano: FREEPIANO_CLASSIC_LAYOUT,
}

export interface KeyToMidiResult {
  note: number
  /** True when this key press should produce a Note On (false = keyup Note Off). */
  on: boolean
}

export class MappingEngine {
  private layout: ComputerKeyboardLayout
  private octaveShift: number
  private velocity: number
  private channel: number
  private musicalDegree = 2

  constructor(opts?: { baseNote?: number; octaveShift?: number; velocity?: number; channel?: number; layout?: BuiltinComputerLayoutId | ComputerKeyboardLayout }) {
    const requested = opts?.layout ?? 'default'
    const source = typeof requested === 'string' ? BUILTIN_COMPUTER_LAYOUTS[requested] : requested
    this.layout = { ...source, baseNote: opts?.baseNote ?? source.baseNote, keys: { ...source.keys } }
    this.octaveShift = opts?.octaveShift ?? 0
    this.velocity = opts?.velocity ?? 100
    this.channel = opts?.channel ?? 0
  }

  setComputerLayout(layout: BuiltinComputerLayoutId | ComputerKeyboardLayout): void {
    const source = typeof layout === 'string' ? BUILTIN_COMPUTER_LAYOUTS[layout] : layout
    this.layout = { ...source, keys: { ...source.keys } }
    this.musicalDegree = 2
    this.clampOctaveShift()
  }

  get currentComputerLayoutId(): string {
    return this.layout.id
  }

  previewKeyPitches(key: string): number[] {
    return this.resolveKeyPitches(key.toLowerCase(), false)
  }

  private resolveKeyPitches(key: string, commit: boolean): number[] {
    if (!(key in this.layout.keys)) return []
    if (this.layout.musicalMode) {
      const step = musicalTypingStep(key, this.layout.musicalMode, this.musicalDegree)
      if (!step) return []
      if (commit) this.musicalDegree = step.nextDegree
      return step.pitches.map((pitch) => pitch + this.octaveShift).filter((pitch) => pitch >= 0 && pitch <= 127)
    }
    const offset = this.layout.keys[key]
    if (offset === undefined) return []
    const note = this.layout.baseNote + offset + this.octaveShift
    return note >= 0 && note <= 127 ? [note] : []
  }

  keyToNote(key: string): number | null {
    return this.previewKeyPitches(key)[0] ?? null
  }

  listComputerKeyAssignments(): ComputerKeyAssignment[] {
    return Object.keys(this.layout.keys).flatMap((key) => {
      const note = this.previewKeyPitches(key)[0]
      return note === undefined ? [] : [{ key, semitoneOffset: note - this.layout.baseNote - this.octaveShift, note }]
    }).sort((left, right) => left.note - right.note || left.key.localeCompare(right.key))
  }

  private layoutPitchRange(): { minimum: number; maximum: number } {
    const pitches = this.layout.musicalMode
      ? Object.keys(this.layout.keys).flatMap((key) => musicalTypingStep(key, this.layout.musicalMode!, 2)?.pitches ?? [])
      : Object.values(this.layout.keys).map((offset) => this.layout.baseNote + offset)
    return { minimum: Math.min(...pitches), maximum: Math.max(...pitches) }
  }
  private clampOctaveShift(): void {
    const range = this.layoutPitchRange()
    const minimumShift = Math.ceil(-range.minimum / 12) * 12
    const maximumShift = Math.floor((127 - range.maximum) / 12) * 12
    this.octaveShift = Math.max(minimumShift, Math.min(maximumShift, this.octaveShift))
  }

  shiftOctave(delta: number): void {
    this.octaveShift += delta * 12
    this.clampOctaveShift()
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

  keyDownMessages(key: string): Uint8Array[] {
    return this.resolveKeyPitches(key.toLowerCase(), true).map((note) => new Uint8Array([0x90 | this.channel, note, this.velocity]))
  }

  keyDownMessage(key: string): Uint8Array | null {
    return this.keyDownMessages(key)[0] ?? null
  }

  keyUpMessage(key: string): Uint8Array | null {
    const note = this.keyToNote(key)
    return note === null ? null : new Uint8Array([0x80 | this.channel, note, 0x40])
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
