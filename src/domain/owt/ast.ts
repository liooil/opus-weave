import type { Rational } from './rational.ts'

export type OwtDocument = OwtScore | OwtTake
export type OwtDocumentKind = OwtDocument['kind']

export interface SourceLocation {
  line: number
  column: number
}

export interface OwtDiagnostic extends SourceLocation {
  severity: 'error' | 'warning'
  code: string
  message: string
}

export interface OwtParseResult {
  document?: OwtDocument
  diagnostics: OwtDiagnostic[]
}

export interface ScorePosition {
  measure: number
  beat: Rational
}

export interface MeterDirective {
  position: ScorePosition
  at: Rational
  numerator: number
  denominator: number
}

export interface TempoDirective {
  position: ScorePosition
  at: Rational
  bpm: number
}

export interface KeyDirective {
  position: ScorePosition
  at: Rational
  tonic: string
  mode: 'major' | 'minor'
}

interface ScoreEventBase extends SourceLocation {
  at: Rational
}

export interface ScoreNoteEvent extends ScoreEventBase {
  kind: 'note'
  pitches: number[]
  duration: Rational
  velocity?: number
}

export interface ScoreRestEvent extends ScoreEventBase {
  kind: 'rest'
  duration: Rational
}

export interface ScoreControlChangeEvent extends ScoreEventBase {
  kind: 'cc'
  controller: number
  value: number
}

export interface ScorePitchBendEvent extends ScoreEventBase {
  kind: 'bend'
  value: number
}

export interface ScoreProgramChangeEvent extends ScoreEventBase {
  kind: 'program'
  program: number
}

export type ScoreEvent =
  | ScoreNoteEvent
  | ScoreRestEvent
  | ScoreControlChangeEvent
  | ScorePitchBendEvent
  | ScoreProgramChangeEvent

export interface OwtScoreTrack {
  name: string
  channel: number
  program: number
  velocity: number
  events: ScoreEvent[]
}

export interface OwtScore {
  kind: 'score'
  version: '0.1'
  title?: string
  ppq: number
  meters: MeterDirective[]
  tempos: TempoDirective[]
  keys: KeyDirective[]
  tracks: OwtScoreTrack[]
}

interface TakeEventBase extends SourceLocation {
  atMs: number
  channel: number
}

export interface TakeNoteEvent extends TakeEventBase {
  kind: 'note'
  pitch: number
  durationMs: number
  velocity: number
}

export interface TakeControlChangeEvent extends TakeEventBase {
  kind: 'cc'
  controller: number
  value: number
}

export interface TakePitchBendEvent extends TakeEventBase {
  kind: 'bend'
  value: number
}

export type TakeEvent = TakeNoteEvent | TakeControlChangeEvent | TakePitchBendEvent

export interface OwtTake {
  kind: 'take'
  version: '0.1'
  title?: string
  source?: string
  unit: 'ms'
  events: TakeEvent[]
}

export interface QuantizeOptions {
  grid: Rational
  bpm: number
  meter: { numerator: number; denominator: number }
  ppq?: number
  title?: string
  program?: number
}

export class OwtSyntaxError extends Error {
  constructor(readonly diagnostics: OwtDiagnostic[]) {
    super(diagnostics.map((issue) => `${issue.line}:${issue.column} ${issue.message}`).join('; '))
    this.name = 'OwtSyntaxError'
  }
}
