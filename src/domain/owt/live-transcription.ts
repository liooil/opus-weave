/**
 * LiveOwtTranscriber — turns an incoming MIDI stream into committed OWT note
 * events as soon as each note ends. This is the real-time counterpart to the
 * offline `extractMelodyFromRecording` path: it does not wait for a whole
 * phrase, and it does not try to select/arrange a melody. Each performer/track
 * owns one transcriber.
 */
import type { ScoreNoteEvent } from './ast.ts'
import { compareRational, rational, type Rational } from './rational.ts'
import { RECORD_PPQ } from '../midi/midi-recorder.ts'
import { DEFAULT_TEMPO_BPM } from '../composition/composition-spec.ts'

interface PendingNote {
  channel: number
  pitch: number
  velocity: number
  startTick: number
}

export interface LiveTranscriberOptions {
  /** Quantization grid in quarter-note units. Defaults to a sixteenth note (1/4). */
  grid?: Rational
  ppq?: number
  bpm?: number
  /** If set, only MIDI messages on this zero-based channel are transcribed. */
  channel?: number
}

export class LiveOwtTranscriber {
  private readonly ppq: number
  private readonly bpm: number
  private readonly gridTicks: number
  private readonly channelFilter: number | undefined
  private startTime = 0
  private active = false
  private readonly held = new Map<string, PendingNote>()
  private committed: ScoreNoteEvent[] = []

  constructor(options: LiveTranscriberOptions = {}) {
    this.ppq = options.ppq ?? RECORD_PPQ
    this.bpm = options.bpm ?? DEFAULT_TEMPO_BPM
    const grid = options.grid ?? rational(1, 4)
    this.gridTicks = Math.max(1, Math.round(this.ppq * (grid.numerator / grid.denominator)))
    this.channelFilter = options.channel
  }

  get isActive(): boolean {
    return this.active
  }

  get events(): readonly ScoreNoteEvent[] {
    return this.committed
  }

  start(nowMs: number): void {
    this.clear()
    this.startTime = nowMs
    this.active = true
  }

  stop(nowMs: number): void {
    if (!this.active) return
    this.closeHeld(nowMs)
    this.active = false
  }

  clear(): void {
    this.held.clear()
    this.committed = []
    this.startTime = 0
    this.active = false
  }

  push(data: Uint8Array, timestampMs: number): void {
    if (!this.active || data.length < 3) return
    const status = data[0]!
    const channel = status & 0x0f
    if (this.channelFilter !== undefined && channel !== this.channelFilter) return
    const kind = status & 0xf0
    const isNoteOn = kind === 0x90 && data[2]! > 0
    const isNoteOff = kind === 0x80 || (kind === 0x90 && data[2] === 0)
    if (!isNoteOn && !isNoteOff) return

    const key = `${channel}:${data[1]!}`
    const tick = this.timestampToTick(timestampMs)

    if (isNoteOn) {
      const existing = this.held.get(key)
      if (existing) this.commitNote(existing, tick)
      this.held.set(key, { channel, pitch: data[1]!, velocity: data[2]!, startTick: tick })
      return
    }

    const pending = this.held.get(key)
    if (!pending) return
    this.held.delete(key)
    this.commitNote(pending, tick)
  }

  /** Returns a defensive copy of all committed note events, sorted by start. */
  snapshot(): ScoreNoteEvent[] {
    return this.committed.map((event) => ({ ...event, pitches: [...event.pitches] }))
  }

  private timestampToTick(timestampMs: number): number {
    return Math.max(0, Math.round(((timestampMs - this.startTime) * this.ppq) / (60000 / this.bpm)))
  }

  private closeHeld(nowMs: number): void {
    const tick = this.timestampToTick(nowMs)
    for (const pending of this.held.values()) this.commitNote(pending, tick)
    this.held.clear()
  }

  private commitNote(pending: PendingNote, endTick: number): void {
    const startTick = Math.max(0, pending.startTick)
    const end = Math.max(endTick, startTick + 1)
    const quantizedStart = Math.round(startTick / this.gridTicks) * this.gridTicks
    let quantizedEnd = Math.round(end / this.gridTicks) * this.gridTicks
    if (quantizedEnd <= quantizedStart) quantizedEnd = quantizedStart + this.gridTicks

    const event: ScoreNoteEvent = {
      kind: 'note',
      at: rational(quantizedStart, this.ppq),
      duration: rational(quantizedEnd - quantizedStart, this.ppq),
      pitches: [pending.pitch],
      velocity: pending.velocity,
      line: 0,
      column: 0,
    }

    const index = this.committed.findIndex((existing) => compareRational(existing.at, event.at) > 0)
    if (index === -1) this.committed.push(event)
    else this.committed.splice(index, 0, event)
  }
}
