import type { KeyDirective, MeterDirective, OwtScore } from './ast.ts'
import { rationalToNumber } from './rational.ts'

export interface ScoreViewEvent {
  playbackId: string
  kind: 'note' | 'rest'
  pitches: number[]
  duration: number
  measure: number
  beat: number
}

export interface ScoreViewMeasure {
  number: number
  numerator: number
  denominator: number
  quarterLength: number
  events: ScoreViewEvent[]
}

export interface ScoreViewTrack {
  name: string
  measures: ScoreViewMeasure[]
}

export interface ScoreViewModel {
  title: string
  tempo: number
  key: { tonic: string; mode: 'major' | 'minor' }
  meter: { numerator: number; denominator: number }
  tracks: ScoreViewTrack[]
}

function meterAtMeasure(measure: number, meters: readonly MeterDirective[]): MeterDirective {
  let current = meters[0] ?? {
    position: { measure: 1, beat: { numerator: 1, denominator: 1 } },
    at: { numerator: 0, denominator: 1 }, numerator: 4, denominator: 4,
  }
  for (const meter of meters) {
    if (meter.position.measure > measure) break
    current = meter
  }
  return current
}

function locateQuarter(quarter: number, meters: readonly MeterDirective[]): { measure: number; beat: number; meter: MeterDirective } {
  let start = 0
  for (let measure = 1; measure < 10000; measure++) {
    const meter = meterAtMeasure(measure, meters)
    const length = meter.numerator * 4 / meter.denominator
    if (quarter < start + length - 1e-9) return { measure, beat: quarter - start, meter }
    start += length
  }
  const meter = meterAtMeasure(1, meters)
  return { measure: 1, beat: quarter, meter }
}

export function buildScoreViewModel(score: OwtScore): ScoreViewModel {
  const initialMeter = meterAtMeasure(1, score.meters)
  const initialKey = score.keys[0] ?? ({ tonic: 'C', mode: 'major' } as KeyDirective)
  const tracks: ScoreViewTrack[] = []
  let maximumMeasure = 1

  for (let trackIndex = 0; trackIndex < score.tracks.length; trackIndex++) {
    const track = score.tracks[trackIndex]!
    const byMeasure = new Map<number, ScoreViewMeasure>()
    for (let eventIndex = 0; eventIndex < track.events.length; eventIndex++) {
      const event = track.events[eventIndex]!
      if (event.kind !== 'note' && event.kind !== 'rest') continue
      const at = rationalToNumber(event.at)
      const position = locateQuarter(at, score.meters)
      const duration = rationalToNumber(event.duration)
      const measure = byMeasure.get(position.measure) ?? {
        number: position.measure,
        numerator: position.meter.numerator,
        denominator: position.meter.denominator,
        quarterLength: position.meter.numerator * 4 / position.meter.denominator,
        events: [],
      }
      measure.events.push({
        playbackId: `${trackIndex}:${eventIndex}`,
        kind: event.kind,
        pitches: event.kind === 'note' ? event.pitches.slice() : [],
        duration,
        measure: position.measure,
        beat: position.beat,
      })
      byMeasure.set(position.measure, measure)
      maximumMeasure = Math.max(maximumMeasure, position.measure)
    }
    tracks.push({ name: track.name, measures: [...byMeasure.values()].sort((left, right) => left.number - right.number) })
  }

  for (const track of tracks) {
    const existing = new Map(track.measures.map((measure) => [measure.number, measure]))
    track.measures = Array.from({ length: maximumMeasure }, (_, index) => {
      const number = index + 1
      const meter = meterAtMeasure(number, score.meters)
      return existing.get(number) ?? {
        number, numerator: meter.numerator, denominator: meter.denominator,
        quarterLength: meter.numerator * 4 / meter.denominator, events: [],
      }
    })
  }

  return {
    title: score.title ?? 'Untitled score',
    tempo: score.tempos[0]?.bpm ?? 120,
    key: { tonic: initialKey.tonic, mode: initialKey.mode },
    meter: { numerator: initialMeter.numerator, denominator: initialMeter.denominator },
    tracks,
  }
}

const PITCH_LETTER_STEP = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6] as const

export function staffPosition(pitch: number): { y: number; accidental: boolean } {
  const pitchClass = ((pitch % 12) + 12) % 12
  const octave = Math.floor(pitch / 12) - 1
  const diatonic = octave * 7 + PITCH_LETTER_STEP[pitchClass]!
  const referenceE4 = 4 * 7 + 2
  return { y: 80 - (diatonic - referenceE4) * 5, accidental: [1, 3, 6, 8, 10].includes(pitchClass) }
}

const TONIC_PITCH_CLASS: Record<string, number> = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5,
  'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11,
}

export interface JianpuPitch {
  degree: number
  accidental: '' | '#' | 'b'
  octave: number
}

function floorDiv(value: number, divisor: number): number {
  return Math.floor(value / divisor)
}

export function jianpuPitch(pitch: number, tonic: string, mode: 'major' | 'minor'): JianpuPitch {
  const tonicClass = TONIC_PITCH_CLASS[tonic] ?? 0
  const scale = mode === 'minor' ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11]
  const relative = pitch - (60 + tonicClass)
  const octave = floorDiv(relative, 12)
  const pitchInOctave = ((relative % 12) + 12) % 12
  let bestDegree = 0
  let bestDistance = 99
  let accidental: JianpuPitch['accidental'] = ''
  for (let index = 0; index < scale.length; index++) {
    let distance = pitchInOctave - scale[index]!
    if (distance > 6) distance -= 12
    if (distance < -6) distance += 12
    if (Math.abs(distance) < Math.abs(bestDistance)) {
      bestDegree = index
      bestDistance = distance
      accidental = distance === 1 ? '#' : distance === -1 ? 'b' : ''
    }
  }
  return { degree: bestDegree + 1, accidental, octave }
}

export function durationMarks(duration: number): { underlines: number; dashes: number; label: string } {
  if (Math.abs(duration - 4) < 1e-9) return { underlines: 0, dashes: 3, label: '' }
  if (Math.abs(duration - 2) < 1e-9) return { underlines: 0, dashes: 1, label: '' }
  if (Math.abs(duration - 1) < 1e-9) return { underlines: 0, dashes: 0, label: '' }
  if (Math.abs(duration - 0.5) < 1e-9) return { underlines: 1, dashes: 0, label: '' }
  if (Math.abs(duration - 0.25) < 1e-9) return { underlines: 2, dashes: 0, label: '' }
  return { underlines: 0, dashes: 0, label: String(Number(duration.toFixed(3))) }
}
