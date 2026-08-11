import type { RecordedTake } from '../midi/midi-recorder.ts'
import { RecentPerformanceCapture } from './recent-performance.ts'

export type ImprovTurnState = 'off' | 'listening' | 'recording' | 'thinking' | 'responding'

export interface ImprovInputResult {
  accepted: boolean
  phraseStarted: boolean
  interruptedAi: boolean
}

function noteKey(data: Uint8Array): string {
  return `${data[0]! & 0x0f}:${data[1]!}`
}

export class ConversationalImprovSession {
  private readonly capture = new RecentPerformanceCapture(30_000, 30_000)
  private readonly heldNotes = new Set<string>()
  private noteOnCount = 0
  private lastInputAt = 0
  private currentState: ImprovTurnState = 'off'

  constructor(readonly silenceMs = 1_200, readonly minimumNotes = 1) {}

  get state(): ImprovTurnState {
    return this.currentState
  }

  get active(): boolean {
    return this.currentState !== 'off'
  }

  start(): void {
    this.resetPhrase()
    this.currentState = 'listening'
  }

  stop(): void {
    this.resetPhrase()
    this.currentState = 'off'
  }

  push(data: Uint8Array, timestampMs: number): ImprovInputResult {
    if (!this.active || data.length < 3) return { accepted: false, phraseStarted: false, interruptedAi: false }
    const kind = data[0]! & 0xf0
    if (kind !== 0x80 && kind !== 0x90) return { accepted: false, phraseStarted: false, interruptedAi: false }
    const isNoteOn = kind === 0x90 && data[2]! > 0
    const isNoteOff = kind === 0x80 || (kind === 0x90 && data[2] === 0)
    if (!isNoteOn && this.currentState !== 'recording') return { accepted: false, phraseStarted: false, interruptedAi: false }
    const interruptedAi = isNoteOn && (this.currentState === 'thinking' || this.currentState === 'responding')
    const phraseStarted = this.currentState !== 'recording'
    if (phraseStarted) {
      this.resetPhrase()
      this.currentState = 'recording'
    }
    if (isNoteOn) {
      this.heldNotes.add(noteKey(data))
      this.noteOnCount++
    } else if (isNoteOff) {
      this.heldNotes.delete(noteKey(data))
    }
    this.capture.push(data, timestampMs)
    this.lastInputAt = timestampMs
    return { accepted: true, phraseStarted, interruptedAi }
  }

  poll(timestampMs: number): RecordedTake | null {
    if (this.currentState !== 'recording' || this.noteOnCount < this.minimumNotes || this.heldNotes.size > 0) return null
    if (timestampMs - this.lastInputAt < this.silenceMs) return null
    const take = this.capture.take(timestampMs)
    if (!take) return null
    this.currentState = 'thinking'
    this.resetPhrase(false)
    return take
  }

  markResponding(): void {
    if (this.currentState === 'thinking') this.currentState = 'responding'
  }

  markListening(): void {
    if (this.active) {
      this.resetPhrase()
      this.currentState = 'listening'
    }
  }

  private resetPhrase(clearState = true): void {
    this.capture.clear()
    this.heldNotes.clear()
    this.noteOnCount = 0
    this.lastInputAt = 0
    if (clearState && this.currentState === 'recording') this.currentState = 'listening'
  }
}
