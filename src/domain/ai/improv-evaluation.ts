import { ImprovEventParser, type ImprovPlan, type ImprovRole } from './realtime-improv.ts'
import { buildImprovPrompt } from './improv-prompt.ts'

export interface ImprovCase { id: string; role: ImprovRole; plan: ImprovPlan }
const base: ImprovPlan = { version: 1, start: 4, beats: 4, bpm: 120, barOffset: 0, observedAt: 3.5, human: [], held: [], ai: [] }
export const improvCases: ImprovCase[] = [
  { id: 'c-major-bass', role: 'bass', plan: { ...base, held: [60, 64, 67], human: [60, 64, 67].map(pitch => ({ start: 3, duration: 0.5, pitch, velocity: 85 })) } },
  { id: 'busy-d-minor', role: 'accompany', plan: { ...base, barOffset: 6, held: [74], human: [62, 65, 69, 72, 74, 72, 69, 74].map((pitch, i) => ({ start: 1.75 + i * 0.25, duration: 0.2, pitch, velocity: 90 })) } },
  { id: 'chromatic-held', role: 'counterpoint', plan: { ...base, held: [61, 65, 68], human: [61, 65, 68].map(pitch => ({ start: 3, duration: 0.5, pitch, velocity: 75 })) } },
  { id: 'carried-note', role: 'counterpoint', plan: { ...base, held: [60], ai: [{ start: 3.75, duration: 0.9, pitch: 67, velocity: 60 }] } },
  { id: 'no-space', role: 'bass', plan: { ...base, held: [60], ai: [{ start: 3.9, duration: 2.2, pitch: 48, velocity: 60 }] } },
  { id: 'harmony-change', role: 'bass', plan: { ...base, beats: 8, held: [65, 69, 72], human: [...[60, 64, 67].map(pitch => ({ start: 1, duration: 1, pitch, velocity: 80 })), ...[65, 69, 72].map(pitch => ({ start: 3, duration: 0.5, pitch, velocity: 80 }))] } },
]

/** Hard validity is separate from musical review flags, which are not aesthetic verdicts. */
export function evaluateImprov(text: string, fixture: ImprovCase) {
  const notes: number[][] = []
  const parser = new ImprovEventParser(fixture.plan.beats * 4, (...note) => notes.push(note))
  parser.push(text, true)
  const { earliest } = buildImprovPrompt(fixture.plan, fixture.role)
  const carryCollisions = notes.filter(n => n[0]! < earliest).length
  const densityExceeded = notes.length > (fixture.plan.beats <= 4 ? 6 : 12)
  return {
    valid: parser.ended && parser.rejected === 0 && carryCollisions === 0 && !densityExceeded,
    rejected: parser.rejected, ended: parser.ended, carryCollisions, densityExceeded, notes,
    review: {
      silent: notes.length === 0,
      bassOutsideRegister: fixture.role === 'bass' ? notes.filter(n => n[2]! > 55).length : 0,
      largeLeaps: notes.slice(1).filter((n, i) => Math.abs(n[2]! - notes[i]![2]!) > 12).length,
      // Held notes may release before TARGET; flag for listening, never reject as wrong harmony.
      sustainedSemitoneClashes: notes.filter(n => n[1]! >= 4 && fixture.plan.held.some(p => Math.abs(p - n[2]!) === 1)).length,
    },
  }
}
