import { ImprovTiming } from './improv-timing.ts'

/** Continuous, clock-driven duet. All times are seconds on the audio clock. */
export interface ImprovNote {
  start: number
  duration: number
  pitch: number
  velocity: number
}

export interface ImprovPlan {
  version: number
  start: number
  beats: number
  bpm: number
  human: ImprovNote[]
  held: number[]
  ai: ImprovNote[]
  /** Target position within a 4/4 bar, in sixteenth-note units. */
  barOffset?: number
  observedAt?: number
}

export type ImprovRole = 'accompany' | 'bass' | 'counterpoint'

/** Line protocol: N offset duration pitch velocity; offset/duration in sixteenth-note units. */
export class ImprovEventParser {
  private consumed = 0
  private previousEnd = 0
  ended = false
  private count = 0
  rejected = 0

  constructor(private readonly units: number, private readonly emit: (offset: number, duration: number, pitch: number, velocity: number) => void) {}

  push(text: string, final = false): void {
    if (text.length > 16_384) throw new Error('Improv response exceeds the event budget')
    const end = final ? text.length : text.lastIndexOf('\n') + 1
    if (end <= this.consumed) return
    const lines = text.slice(this.consumed, end).split('\n')
    this.consumed = end
    for (const raw of lines) {
      const line = raw.trim()
      if (!line) continue
      if (this.ended) { this.rejected++; continue }
      if (line === 'END') { this.ended = true; continue }
      const match = /^N (\d+) (\d+) (\d+) (\d+)$/.exec(line)
      if (!match) { this.rejected++; continue }
      const [offset, duration, pitch, velocity] = match.slice(1).map(Number) as [number, number, number, number]
      if (offset < this.previousEnd || offset >= this.units || duration < 1 || duration > 16 || offset + duration > this.units || pitch < 36 || pitch > 96 || velocity < 1 || velocity > 110 || this.count >= 32) {
        this.rejected++
        continue
      }
      this.previousEnd = offset + duration
      this.count++
      this.emit(offset, duration, pitch, velocity)
    }
  }
}

export class RealtimeImprovSession {
  readonly guard = 0.15
  readonly timing = new ImprovTiming()
  active = false
  bpm = 120
  origin = 0
  version = 0
  generating = false
  dropped = 0
  firstEventMs: number | null = null
  private endedAt = 0
  private humanNotes: ImprovNote[] = []
  private held = new Map<string, ImprovNote>()
  private pressed = new Set<string>()
  private sustain = new Set<number>()
  private committed: ImprovNote[] = []
  private pending: ImprovNote[] = []
  private offs: Array<{ time: number; pitch: number }> = []
  private lastInput = -Infinity
  private nextRequestAt = 0
  private inputRevision = 0
  private plannedInputRevision = -1
  private firstArrival: number | undefined
  private lateArrivals = 0
  private requestAt = 0
  private accepted = 0
  private replacementStarted = false
  private failures = 0

  constructor(private readonly send: (pitch: number, velocity: number, time: number) => void) {}

  start(now: number, bpm: number): void {
    this.active = true
    this.bpm = Math.max(40, Math.min(200, Math.round(bpm)))
    this.origin = now
    this.endedAt = now
    this.version++
    this.generating = false
    this.dropped = 0
    this.firstEventMs = null
    this.humanNotes = []
    this.held.clear()
    this.pressed.clear()
    this.sustain.clear()
    this.committed = []
    this.pending = []
    this.offs = []
    this.lastInput = -Infinity
    this.nextRequestAt = now
    this.timing.reset()
    this.inputRevision = 0
    this.plannedInputRevision = -1
    this.failures = 0
  }

  input(data: Uint8Array, now: number): void {
    if (!this.active || data.length < 3) return
    const kind = data[0]! & 0xf0
    const channel = data[0]! & 15
    if (kind === 0xb0) {
      if (data[1] === 64 || data[1] === 120 || data[1] === 123) this.inputRevision++
      if (data[1] === 64) {
        if (data[2]! >= 64) this.sustain.add(channel)
        else {
          this.sustain.delete(channel)
          for (const [key, note] of this.held) {
            if (key.startsWith(`${channel}:`) && !this.pressed.has(key)) {
              note.duration = Math.max(0.01, now - note.start)
              this.held.delete(key)
            }
          }
        }
      } else if (data[1] === 120 || data[1] === 123) {
        for (const [key, note] of this.held) {
          if (!key.startsWith(`${channel}:`)) continue
          note.duration = Math.max(0.01, now - note.start)
          this.held.delete(key)
          this.pressed.delete(key)
        }
      }
      return
    }
    if (kind !== 0x90 && kind !== 0x80) return
    this.inputRevision++
    const key = `${channel}:${data[1]}`
    const isOn = kind === 0x90 && data[2]! > 0
    if (isOn) this.pressed.add(key)
    else this.pressed.delete(key)
    if (!isOn && this.sustain.has(channel)) { this.lastInput = now; return }
    const previous = this.held.get(key)
    if (previous) { previous.duration = Math.max(0.01, now - previous.start); this.held.delete(key) }
    if (isOn) {
      const note = { start: now, duration: 0, pitch: data[1]!, velocity: data[2]! }
      this.humanNotes.push(note)
      this.held.set(key, note)
    }
    this.lastInput = now
  }

  tick(now: number): void {
    if (!this.active) return
    const due: Array<{ time: number; pitch: number; velocity: number }> = []
    this.pending = this.pending.filter((note) => {
      if (note.start > now + this.guard) return true
      if (note.start < now) { this.dropped++; return false }
      this.committed.push(note)
      due.push({ time: note.start, pitch: note.pitch, velocity: note.velocity })
      this.offs.push({ time: note.start + note.duration, pitch: note.pitch })
      return false
    })
    this.offs = this.offs.filter((off) => {
      if (off.time > now + this.guard) return true
      due.push({ ...off, time: Math.max(now, off.time), velocity: 0 })
      return false
    })
    // Release old notes before retriggering the same pitch at a boundary.
    due.sort((a, b) => a.time - b.time || a.velocity - b.velocity)
    for (const event of due) this.send(event.pitch, event.velocity, event.time)
  }

  /** Role changes require a fresh plan but do not interrupt an in-flight request. */
  requestUpdate(): void { this.inputRevision++ }

  plan(now: number): ImprovPlan | null {
    if (!this.active || this.generating || now < this.nextRequestAt || this.humanNotes.length === 0 || (this.held.size === 0 && now - this.lastInput > 8)) return null
    const refillAt = this.timing.lead + this.timing.cadence + 60 / this.bpm
    if (this.inputRevision === this.plannedInputRevision && this.buffered(now) > refillAt) return null
    this.plannedInputRevision = this.inputRevision
    this.firstArrival = undefined
    this.lateArrivals = 0
    this.generating = true
    this.requestAt = now
    this.accepted = 0
    this.replacementStarted = false
    const beat = 60 / this.bpm
    // After warm-up, align to eighth notes to avoid an extra full-beat delay.
    const grid = this.timing.samples >= 3 ? beat / 2 : beat
    const start = this.origin + Math.ceil((now + this.timing.lead - this.origin) / grid) * grid
    const human = this.human(now).filter((note) => note.start + note.duration >= now - 8).slice(-64)
    return {
      version: ++this.version, start, beats: this.timing.windowBeats(this.bpm), bpm: this.bpm, human,
      barOffset: Math.round((start - this.origin) / (beat / 4)) % 16, observedAt: now,
      held: [...this.held.values()].map((note) => note.pitch),
      ai: [...this.committed, ...this.pending].filter((note) => note.start + note.duration >= now - 4 && note.start < start).slice(-32),
    }
  }

  accept(plan: ImprovPlan, offset: number, duration: number, pitch: number, velocity: number, now: number, participation = 0.65): boolean {
    if (!this.active || plan.version !== this.version) return false
    this.firstArrival ??= Math.max(0, now - this.requestAt)
    const unit = 60 / plan.bpm / 4
    const note = { start: plan.start + offset * unit, duration: duration * unit, pitch, velocity: Math.max(1, Math.round(velocity * participation)) }
    if (note.start <= now + this.guard) { this.dropped++; this.lateArrivals++; return false }
    // Preserve queued audio and sounding notes. Replace only the remaining future.
    const retained = this.replacementStarted ? this.pending : this.pending.filter((old) => old.start < note.start)
    // One AI voice: reject overlaps before discarding any usable previous plan.
    if ([...this.committed.slice(-32), ...retained].some((old) => old.start < note.start + note.duration - 0.001 && old.start + old.duration > note.start + 0.001)) return false
    this.pending = retained
    this.replacementStarted = true
    this.pending.push(note)
    this.pending.sort((a, b) => a.start - b.start)
    if (this.accepted++ === 0) this.firstEventMs = Math.round((now - this.requestAt) * 1000)
    return true
  }

  finish(plan: ImprovPlan, now: number, failed = false): void {
    if (plan.version !== this.version || !this.active) return
    this.generating = false
    this.timing.observe(this.firstArrival, now - this.requestAt, this.lateArrivals > 0, failed)
    this.failures = failed ? this.failures + 1 : 0
    this.nextRequestAt = failed ? now + Math.min(30, 2 ** this.failures) : Math.max(now + 0.05, this.requestAt + this.timing.cadence)
  }

  human(now: number): ImprovNote[] {
    return this.humanNotes.map((note) => ({ ...note, duration: note.duration || Math.max(0.01, (this.active ? now : this.endedAt) - note.start) }))
  }

  played(now: number): ImprovNote[] {
    const end = this.active ? now : this.endedAt
    return this.committed.filter((note) => note.start < end).map((note) => ({ ...note, duration: Math.min(note.duration, end - note.start) }))
  }

  future(now: number): ImprovNote[] {
    return [...this.committed.filter((note) => note.start >= now), ...this.pending]
  }

  buffered(now: number): number {
    return Math.max(0, ...[...this.pending, ...this.committed.slice(-32)].map((note) => note.start + note.duration - now))
  }

  stop(now: number): void {
    if (!this.active) return
    for (const note of this.held.values()) note.duration = Math.max(0.01, now - note.start)
    this.held.clear()
    this.pressed.clear()
    this.sustain.clear()
    this.active = false
    this.endedAt = now
    this.version++
    this.generating = false
    this.pending = []
    this.offs = []
  }
}
