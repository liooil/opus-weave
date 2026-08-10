/**
 * midi-recorder — records live MIDI input into a take using high-precision
 * timestamps, independent of the GUI.
 *
 * - Note On velocity 0 is normalized to Note Off.
 * - Note On/Off, CC, Pitch Bend (and any other channel message) are kept
 *   verbatim with their absolute tick (computed from elapsed ms).
 * - Duplicate key presses are tracked so a repeated Note On is recorded as
 *   Note On then Note Off, never as a dangling note.
 * - Export produces a Type 0 SMF with a fixed tempo so the take can be
 *   re-imported and played by the app itself.
 */
import { MIDIBuilder } from 'spessasynth_core'
import { DEFAULT_TEMPO_BPM } from '../composition/composition-spec.ts'

export const RECORD_PPQ = 480

export interface RecordedMidiEvent {
  /** Absolute tick from take start. */
  tick: number
  /** Raw MIDI bytes (status + data). */
  data: Uint8Array
}

export interface RecordedTake {
  events: RecordedMidiEvent[]
  /** Wall-clock duration of the take in ms. */
  durationMs: number
}

interface ActiveNote {
  channel: number
  note: number
}

export class MidiRecorder {
  private events: RecordedMidiEvent[] = []
  private startTime = 0
  private recording = false
  private readonly activeNotes = new Map<string, ActiveNote>()

  /** Note keys currently held down: `ch:note` -> tick of the last note-on. */
  private readonly held = new Map<string, number>()

  get isRecording(): boolean {
    return this.recording
  }

  /** Begin a new take; the first event's delta is measured from nowMs. */
  start(nowMs: number): void {
    this.events = []
    this.held.clear()
    this.startTime = nowMs
    this.recording = true
  }

  /** Feed one raw MIDI message with a high-resolution timestamp (ms). */
  push(data: Uint8Array, timestampMs: number): void {
    if (!this.recording || data.length < 1) return
    const status = data[0]!
    const tick = Math.max(0, Math.round(((timestampMs - this.startTime) * RECORD_PPQ) / (60000 / DEFAULT_TEMPO_BPM)))

    if ((status & 0xf0) === 0x90 && data.length >= 3) {
      const channel = status & 0x0f
      const note = data[1]!
      const velocity = data[2]!
      if (velocity === 0) {
        // Note On velocity 0 is Note Off.
        this.push(new Uint8Array([0x80 | channel, note, 0x40]), timestampMs)
        return
      }
      const key = `${channel}:${note}`
      if (this.held.has(key)) {
        // Repeated Note On while held — close the previous one first.
        this.events.push({ tick: this.held.get(key)!, data: new Uint8Array([0x80 | channel, note, 0x40]) })
      }
      this.held.set(key, tick)
      this.events.push({ tick, data: Uint8Array.from(data) })
      return
    }

    if ((status & 0xf0) === 0x80 && data.length >= 3) {
      const key = `${status & 0x0f}:${data[1]!}`
      if (this.held.has(key)) {
        this.held.delete(key)
      }
      this.events.push({ tick, data: Uint8Array.from(data) })
      return
    }

    // CC, pitch bend, program change, aftertouch: record verbatim.
    this.events.push({ tick, data: Uint8Array.from(data) })
  }

  /** Close any notes still held (device disconnect, page close). */
  stopHeldNotes(): void {
    for (const [key, tick] of this.held) {
      const [ch, note] = key.split(':')
      this.events.push({ tick, data: new Uint8Array([0x80 | Number(ch), Number(note), 0x40]) })
    }
    this.held.clear()
  }

  /** End the take. Emits note-offs for any still-held notes first. */
  stop(nowMs: number): RecordedTake {
    if (!this.recording) return { events: [], durationMs: 0 }
    this.stopHeldNotes()
    this.recording = false
    const durationMs = Math.max(0, nowMs - this.startTime)
    return { events: this.events, durationMs }
  }

  clear(): void {
    this.events = []
    this.held.clear()
    this.recording = false
  }
}

/**
 * Convert a take to a Type 0 SMF at the recorder's fixed tempo.
 * Uses track 0 (the single track the builder creates for format 0).
 */
export function takeToMidi(take: RecordedTake, tempoBpm = DEFAULT_TEMPO_BPM): ArrayBuffer {
  const builder = new MIDIBuilder({ timeDivision: RECORD_PPQ, initialTempo: tempoBpm, format: 0, name: 'OpusWeave Recording' })

  for (const ev of take.events) {
    const status = ev.data[0]!
    const channel = status & 0x0f
    const kind = status & 0xf0
    const d = ev.data
    switch (kind) {
      case 0x90:
        builder.noteOn(ev.tick, 0, channel, d[1]!, d[2]!)
        break
      case 0x80:
        builder.noteOff(ev.tick, 0, channel, d[1]!)
        break
      case 0xb0:
        builder.controllerChange(ev.tick, 0, channel, d[1]!, d[2]!)
        break
      case 0xe0:
        builder.pitchWheel(ev.tick, 0, channel, (d[2]! << 7) | d[1]!)
        break
      case 0xc0:
        builder.programChange(ev.tick, 0, channel, d[1]!)
        break
      default:
        break
    }
  }
  return builder.writeMIDI()
}
