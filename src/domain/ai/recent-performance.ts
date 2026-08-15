import { DEFAULT_TEMPO_BPM } from '../composition/composition-spec.ts'
import { RECORD_PPQ, type RecordedMidiEvent, type RecordedTake } from '../midi/midi-recorder.ts'

interface TimedMessage {
  timestampMs: number
  data: Uint8Array
}

export class RecentPerformanceCapture {
  private messages: TimedMessage[] = []

  constructor(private readonly maxAgeMs = 30_000, private readonly phraseGapMs = 5_000) {}

  push(data: Uint8Array, timestampMs: number): void {
    if (data.length < 3) return
    const kind = data[0]! & 0xf0
    if (kind !== 0x80 && kind !== 0x90) return
    const isNoteOn = kind === 0x90 && data[2]! > 0
    const previous = this.messages.at(-1)
    if (isNoteOn && previous && timestampMs - previous.timestampMs > this.phraseGapMs) this.messages = []
    this.messages.push({ timestampMs, data: Uint8Array.from(data) })
    const cutoff = timestampMs - this.maxAgeMs
    const firstRecent = this.messages.findIndex((message) => message.timestampMs >= cutoff)
    if (firstRecent > 0) this.messages.splice(0, firstRecent)
  }

  clear(): void {
    this.messages = []
  }

  take(nowMs: number): RecordedTake | null {
    const phrase = this.recentPhrase(nowMs)
    if (!phrase) return null
    return this.materialize(phrase, nowMs, false)
  }

  /** Like take(), but closes notes that are still held so live OWT previews stay valid. */
  preview(nowMs: number): RecordedTake | null {
    const phrase = this.recentPhrase(nowMs)
    if (!phrase) return null
    return this.materialize(phrase, nowMs, true)
  }

  private recentPhrase(nowMs: number): TimedMessage[] | null {
    const cutoff = nowMs - this.maxAgeMs
    const source = this.messages.filter((message) => message.timestampMs >= cutoff)
    const firstNoteOn = source.findIndex((message) => (message.data[0]! & 0xf0) === 0x90 && message.data[2]! > 0)
    if (firstNoteOn < 0) return null
    return source.slice(firstNoteOn)
  }

  private materialize(phrase: TimedMessage[], nowMs: number, closeHeld: boolean): RecordedTake {
    const start = phrase[0]!.timestampMs
    const tickPerMs = RECORD_PPQ / (60000 / DEFAULT_TEMPO_BPM)
    const tickAt = (timestampMs: number): number => Math.max(0, Math.round((timestampMs - start) * tickPerMs))
    const events: RecordedMidiEvent[] = []
    const held = new Set<string>()
    for (const message of phrase) {
      const data = message.data
      const status = data[0]!
      const kind = status & 0xf0
      if (kind !== 0x80 && kind !== 0x90) continue
      const channel = status & 0x0f
      const key = `${channel}:${data[1]!}`
      const tick = tickAt(message.timestampMs)
      if (kind === 0x90 && data[2]! > 0) {
        if (held.has(key)) events.push({ tick, data: new Uint8Array([0x80 | channel, data[1]!, 0x40]) })
        held.add(key)
        events.push({ tick, data: Uint8Array.from(data) })
      } else {
        if (held.has(key)) held.delete(key)
        events.push({ tick, data: Uint8Array.from(data) })
      }
    }
    const durationMs = Math.max(1, nowMs - start)
    if (closeHeld) {
      const endTick = tickAt(nowMs)
      for (const key of held.keys()) {
        const [channel, note] = key.split(':')
        events.push({ tick: endTick, data: new Uint8Array([0x80 | Number(channel), Number(note), 0x40]) })
      }
    }
    return { events, durationMs }
  }
}
