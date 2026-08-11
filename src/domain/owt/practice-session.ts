import type { OwtScore } from './ast.ts'
import { compareRational } from './rational.ts'

export interface PracticePrompt {
  pitches: number[]
  sourceLine: number
  sourceColumn: number
}

export function buildPracticePrompts(score: OwtScore): PracticePrompt[] {
  const preferred = score.tracks.find((track) => /melody|lead|旋律/i.test(track.name)) ?? score.tracks[0]
  if (!preferred) return []
  return preferred.events
    .filter((event) => event.kind === 'note')
    .slice()
    .sort((left, right) => compareRational(left.at, right.at) || left.line - right.line || left.column - right.column)
    .map((event) => event.kind === 'note' ? {
      pitches: [...new Set(event.pitches)].sort((left, right) => left - right),
      sourceLine: event.line,
      sourceColumn: event.column,
    } : undefined)
    .filter((prompt): prompt is PracticePrompt => prompt !== undefined)
}

export class PracticeSession {
  private index = 0
  private remaining = new Set<number>()

  constructor(readonly prompts: readonly PracticePrompt[]) {
    this.resetRemaining()
  }

  get current(): PracticePrompt | undefined {
    return this.prompts[this.index]
  }

  get position(): number {
    return this.index
  }

  get complete(): boolean {
    return this.index >= this.prompts.length
  }

  accept(note: number): { matched: boolean; advanced: boolean; complete: boolean } {
    if (this.complete || !this.remaining.has(note)) return { matched: false, advanced: false, complete: this.complete }
    this.remaining.delete(note)
    if (this.remaining.size > 0) return { matched: true, advanced: false, complete: false }
    this.index++
    this.resetRemaining()
    return { matched: true, advanced: true, complete: this.complete }
  }

  reset(): void {
    this.index = 0
    this.resetRemaining()
  }

  private resetRemaining(): void {
    this.remaining = new Set(this.current?.pitches ?? [])
  }
}
