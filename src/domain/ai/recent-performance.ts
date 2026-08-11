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
    const cutoff = nowMs - this.maxAgeMs
    const source = this.messages.filter((message) => message.timestampMs >= cutoff)
    const firstNoteOn = source.findIndex((message) => (message.data[0]! & 0xf0) === 0x90 && message.data[2]! > 0)
    if (firstNoteOn < 0) return null
    const phrase = source.slice(firstNoteOn)
    const start = phrase[0]!.timestampMs
    const tickPerMs = RECORD_PPQ / (60000 / DEFAULT_TEMPO_BPM)
    const events: RecordedMidiEvent[] = phrase.map((message) => ({
      tick: Math.max(0, Math.round((message.timestampMs - start) * tickPerMs)),
      data: Uint8Array.from(message.data),
    }))
    return { events, durationMs: Math.max(1, nowMs - start) }
  }
}
