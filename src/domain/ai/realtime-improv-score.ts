import type { OwtScore, OwtScoreTrack, ScoreEvent } from '../owt/ast.ts'
import { rational } from '../owt/rational.ts'
import { serializeOwt } from '../owt/serializer.ts'
import type { ImprovNote } from './realtime-improv.ts'

/** Quantized archive of performed notes. Future plans never enter this function. */
export function improvScore(human: ImprovNote[], ai: ImprovNote[], origin: number, bpm: number): string {
  const position = { measure: 1, beat: rational(1) }
  const tracks: OwtScoreTrack[] = []
  for (const [name, notes, channel] of [['Human', human, 1], ['AI', ai, 2]] as const) {
    // OWT tracks are sequential. Separate overlapping human notes into voices.
    const voices: Array<{ end: number; events: ScoreEvent[] }> = []
    const quantized = notes.map((note) => ({
      ...note,
      at: Math.max(0, Math.round((note.start - origin) * bpm / 60 * 4)),
      length: Math.max(1, Math.round(note.duration * bpm / 60 * 4)),
    })).sort((a, b) => a.at - b.at || a.pitch - b.pitch)
    for (const note of quantized) {
      let voice = voices.find((voice) => voice.end <= note.at)
      if (!voice) { voice = { end: 0, events: [] }; voices.push(voice) }
      const append = (end: number, rest: boolean) => {
        while (voice!.end < end) {
          const from = voice!.end
          const to = Math.min(end, (Math.floor(from / 16) + 1) * 16)
          const common = { at: rational(from, 4), duration: rational(to - from, 4), line: 0, column: 0 }
          voice!.events.push(rest ? { ...common, kind: 'rest' } : { ...common, kind: 'note', pitches: [note.pitch], velocity: note.velocity })
          voice!.end = to
        }
      }
      append(note.at, true)
      append(note.at + note.length, false)
    }
    if (!voices.length) voices.push({ end: 0, events: [] })
    for (const voice of voices) {
      const end = Math.ceil(voice.end / 16) * 16
      if (end > voice.end) voice.events.push({ kind: 'rest', at: rational(voice.end, 4), duration: rational(end - voice.end, 4), line: 0, column: 0 })
    }
    for (const [index, voice] of voices.entries()) tracks.push({ name: voices.length > 1 ? `${name} ${index + 1}` : name, channel, program: 0, velocity: 80, events: voice.events })
  }
  const score: OwtScore = { kind: 'score', version: '0.1', title: 'Live duet', ppq: 480, meters: [{ position, at: rational(0), numerator: 4, denominator: 4 }], tempos: [{ position, at: rational(0), bpm }], keys: [], tracks }
  return serializeOwt(score)
}
