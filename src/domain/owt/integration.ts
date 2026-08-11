import { BasicMIDI } from 'spessasynth_core'
import type { CompositionSpec, CompositionTrack } from '../composition/composition-spec.ts'
import { buildMidi } from '../midi/midi-export.ts'
import { getArrangementNotes, type ArrangementNote } from '../midi/midi-arrangement.ts'
import { createMidiTempoMap, importMidi } from '../midi/midi-import.ts'
import { takeToMidi as recordedTakeToMidi, type RecordedTake } from '../midi/midi-recorder.ts'
import type { OwtScore, OwtScoreTrack } from './ast.ts'
import { parseOwtOrThrow } from './parser.ts'
import { ONE, ZERO, rational, rationalToNumber, type Rational } from './rational.ts'
import { serializeScore } from './serializer.ts'

export function scoreToCompositionSpec(score: OwtScore): CompositionSpec {
  return {
    title: score.title,
    ppq: score.ppq,
    timeSignatures: score.meters.map((meter) => ({
      beat: rationalToNumber(meter.at),
      numerator: meter.numerator,
      denominator: meter.denominator,
    })),
    tempos: score.tempos.map((tempo) => ({ beat: rationalToNumber(tempo.at), bpm: tempo.bpm })),
    keySignatures: score.keys.map((key) => ({ beat: rationalToNumber(key.at), tonic: key.tonic, mode: key.mode })),
    tracks: score.tracks.map(scoreTrackToCompositionTrack),
  }
}

function scoreTrackToCompositionTrack(track: OwtScoreTrack): CompositionTrack {
  const output: CompositionTrack = {
    name: track.name,
    channel: track.channel - 1,
    program: track.program,
    notes: [],
    controlChanges: [],
    pitchBends: [],
    programChanges: [],
  }
  for (const event of track.events) {
    const beat = rationalToNumber(event.at)
    if (event.kind === 'note') {
      for (const pitch of event.pitches) {
        output.notes.push({
          startBeat: beat,
          durationBeats: rationalToNumber(event.duration),
          pitch,
          velocity: event.velocity ?? track.velocity,
        })
      }
    } else if (event.kind === 'cc') output.controlChanges!.push({ beat, controller: event.controller, value: event.value })
    else if (event.kind === 'bend') output.pitchBends!.push({ beat, value: event.value })
    else if (event.kind === 'program') output.programChanges!.push({ beat, program: event.program })
  }
  return output
}

export function compileScoreText(text: string): { score: OwtScore; spec: CompositionSpec; midi: ArrayBuffer } {
  const score = parseOwtOrThrow(text)
  const spec = scoreToCompositionSpec(score)
  return { score, spec, midi: buildMidi(spec) }
}

export type MelodyVoiceStrategy = 'continuous' | 'highest' | 'lowest'

export interface MelodyExtractionOptions {
  /** Quantization grid in OWT quarter-note units. Defaults to a sixteenth note (1/4). */
  grid?: Rational
  /** Zero-based source MIDI track. Automatic selection when omitted. */
  trackIndex?: number
  /** Human-facing MIDI channel 1–16. Automatic selection when omitted. */
  channel?: number
  voiceStrategy?: MelodyVoiceStrategy
  preserveVelocity?: boolean
  title?: string
}

export interface MelodyExtractionReport {
  sourceTrackIndex: number
  sourceTrackName: string
  sourceChannel: number
  inputNotes: number
  outputNotes: number
  discardedNotes: number
  discardedTracks: number
  ignoredEvents: number
  grid: Rational
  voiceStrategy: MelodyVoiceStrategy
}

export interface MelodyExtractionResult {
  score: OwtScore
  text: string
  report: MelodyExtractionReport
}

interface MelodyCandidate {
  trackIndex: number
  trackName: string
  channel: number
  notes: ArrangementNote[]
  score: number
}

interface QuantizedNote {
  pitch: number
  velocity: number
  startTick: number
  endTick: number
}

const KEY_SIGNATURES_MAJOR = ['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#']
const KEY_SIGNATURES_MINOR = ['Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#', 'G#', 'D#', 'A#']

function signedByte(value: number): number {
  return value > 127 ? value - 256 : value
}

function firstKeySignature(midi: BasicMIDI): OwtScore['keys'][number] | undefined {
  let earliest: { tick: number; accidentals: number; minor: boolean } | undefined
  for (const track of midi.tracks) {
    for (const event of track.events) {
      if (event.statusByte !== 0x59 || event.data.length < 2) continue
      const candidate = { tick: event.ticks, accidentals: signedByte(event.data[0]!), minor: event.data[1] === 1 }
      if (!earliest || candidate.tick < earliest.tick) earliest = candidate
    }
  }
  if (!earliest || earliest.accidentals < -7 || earliest.accidentals > 7) return undefined
  const names = earliest.minor ? KEY_SIGNATURES_MINOR : KEY_SIGNATURES_MAJOR
  return {
    position: { measure: 1, beat: ONE },
    at: ZERO,
    tonic: names[earliest.accidentals + 7]!,
    mode: earliest.minor ? 'minor' : 'major',
  }
}

function firstMeter(midi: BasicMIDI): { numerator: number; denominator: number } {
  let earliest: { tick: number; numerator: number; denominator: number } | undefined
  for (const track of midi.tracks) {
    for (const event of track.events) {
      if (event.statusByte !== 0x58 || event.data.length < 2) continue
      const denominator = 2 ** event.data[1]!
      if (!Number.isInteger(denominator) || denominator < 1) continue
      const candidate = { tick: event.ticks, numerator: event.data[0]!, denominator }
      if (!earliest || candidate.tick < earliest.tick) earliest = candidate
    }
  }
  return earliest ?? { numerator: 4, denominator: 4 }
}

function programForChannel(midi: BasicMIDI, trackIndex: number, channel: number): number {
  const track = midi.tracks[trackIndex]
  if (!track) return 0
  const event = track.events.find((candidate) => (candidate.statusByte & 0xf0) === 0xc0 && (candidate.statusByte & 0x0f) === channel)
  return event?.data[0] ?? 0
}

function normalizeTrackName(value: string): string {
  if (![...value].some((character) => character.charCodeAt(0) >= 0x80 && character.charCodeAt(0) <= 0xff)) return value
  const bytes = Uint8Array.from([...value], (character) => character.charCodeAt(0))
  const decoded = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  return decoded.includes('\uFFFD') ? value : decoded
}

function candidateScore(trackName: string, notes: ArrangementNote[]): number {
  const name = trackName.toLowerCase()
  const averagePitch = notes.reduce((sum, note) => sum + note.note, 0) / notes.length
  let overlaps = 0
  let previousEnd = -Infinity
  for (const note of notes.slice().sort((left, right) => left.startTick - right.startTick || left.endTick - right.endTick)) {
    if (note.startTick < previousEnd) overlaps++
    previousEnd = Math.max(previousEnd, note.endTick)
  }
  const monophonicRatio = 1 - overlaps / notes.length
  let score = monophonicRatio * 40 + averagePitch * 0.25 + Math.min(20, Math.log2(notes.length + 1) * 4)
  if (/melody|lead|vocal|voice|solo|主旋律|旋律/.test(name)) score += 60
  if (/bass|drum|perc|chord|accomp|pad|低音|鼓|和弦|伴奏/.test(name)) score -= 45
  return score
}

function collectCandidates(midi: BasicMIDI, options: MelodyExtractionOptions): MelodyCandidate[] {
  const candidates: MelodyCandidate[] = []
  for (let trackIndex = 0; trackIndex < midi.tracks.length; trackIndex++) {
    if (options.trackIndex !== undefined && trackIndex !== options.trackIndex) continue
    const trackName = normalizeTrackName(midi.tracks[trackIndex]?.name || `Track ${trackIndex + 1}`)
    const byChannel = new Map<number, ArrangementNote[]>()
    for (const note of getArrangementNotes(midi, trackIndex)) {
      if (note.channel === 9) continue
      if (options.channel !== undefined && note.channel !== options.channel - 1) continue
      const notes = byChannel.get(note.channel) ?? []
      notes.push(note)
      byChannel.set(note.channel, notes)
    }
    for (const [channel, notes] of byChannel) {
      candidates.push({ trackIndex, trackName, channel, notes, score: candidateScore(trackName, notes) })
    }
  }
  return candidates.sort((left, right) => right.score - left.score || left.trackIndex - right.trackIndex || left.channel - right.channel)
}

function chooseVoice(notes: ArrangementNote[], ppq: number, grid: Rational, strategy: MelodyVoiceStrategy): QuantizedNote[] {
  const gridTicks = Math.max(1, Math.round(ppq * rationalToNumber(grid)))
  const groups = new Map<number, QuantizedNote[]>()
  for (const note of notes) {
    const startTick = Math.max(0, Math.round(note.startTick / gridTicks) * gridTicks)
    const rawEnd = Math.round(note.endTick / gridTicks) * gridTicks
    const endTick = Math.max(startTick + gridTicks, rawEnd)
    const group = groups.get(startTick) ?? []
    group.push({ pitch: note.note, velocity: note.velocity, startTick, endTick })
    groups.set(startTick, group)
  }

  const selected: QuantizedNote[] = []
  let previousPitch: number | undefined
  for (const [, group] of [...groups].sort((left, right) => left[0] - right[0])) {
    let note: QuantizedNote
    if (strategy === 'highest') note = group.reduce((best, candidate) => candidate.pitch > best.pitch ? candidate : best)
    else if (strategy === 'lowest') note = group.reduce((best, candidate) => candidate.pitch < best.pitch ? candidate : best)
    else if (previousPitch === undefined) {
      note = group.reduce((best, candidate) => candidate.pitch > best.pitch ? candidate : best)
    } else {
      note = group.reduce((best, candidate) => {
        const candidateValue = -Math.abs(candidate.pitch - previousPitch!) * 2 + candidate.pitch * 0.08 + (candidate.endTick - candidate.startTick) / gridTicks
        const bestValue = -Math.abs(best.pitch - previousPitch!) * 2 + best.pitch * 0.08 + (best.endTick - best.startTick) / gridTicks
        return candidateValue > bestValue ? candidate : best
      })
    }
    const previous = selected.at(-1)
    if (previous && previous.endTick > note.startTick) previous.endTick = Math.max(previous.startTick + gridTicks, note.startTick)
    selected.push({ ...note })
    previousPitch = note.pitch
  }
  return selected
}

function countIgnoredEvents(midi: BasicMIDI): number {
  let count = 0
  for (const track of midi.tracks) {
    for (const event of track.events) {
      const kind = event.statusByte & 0xf0
      if (event.statusByte >= 0x80 && event.statusByte < 0xf0 && kind !== 0x80 && kind !== 0x90) count++
    }
  }
  return count
}

export function extractMelodyFromMidi(data: ArrayBuffer, options: MelodyExtractionOptions = {}): MelodyExtractionResult {
  const midi = importMidi(data, options.title)
  const ppq = midi.timeDivision || 480
  const grid = options.grid ?? rational(1, 4)
  if (rationalToNumber(grid) <= 0) throw new Error('melody extraction grid must be positive')
  if (options.channel !== undefined && (!Number.isInteger(options.channel) || options.channel < 1 || options.channel > 16)) {
    throw new Error('melody extraction channel must be an integer from 1 to 16')
  }
  const strategy = options.voiceStrategy ?? 'continuous'
  const candidates = collectCandidates(midi, options)
  const source = candidates[0]
  if (!source) throw new Error('MIDI contains no non-drum notes to extract')

  const selected = chooseVoice(source.notes, ppq, grid, strategy)
  const velocities = selected.map((note) => note.velocity).sort((left, right) => left - right)
  const defaultVelocity = velocities.length > 0 ? velocities[Math.floor(velocities.length / 2)]! : 88
  const track: OwtScoreTrack = {
    name: 'Melody',
    channel: source.channel + 1,
    program: programForChannel(midi, source.trackIndex, source.channel),
    velocity: defaultVelocity,
    events: selected.map((note) => ({
      kind: 'note' as const,
      at: rational(note.startTick, ppq),
      duration: rational(note.endTick - note.startTick, ppq),
      pitches: [note.pitch],
      velocity: options.preserveVelocity ? note.velocity : undefined,
      line: 0,
      column: 0,
    })),
  }
  const meter = firstMeter(midi)
  const tempo = createMidiTempoMap(midi).tempos[0]?.bpm ?? 120
  const key = firstKeySignature(midi)
  const score: OwtScore = {
    kind: 'score',
    version: '0.1',
    title: options.title,
    ppq,
    meters: [{ position: { measure: 1, beat: ONE }, at: ZERO, ...meter }],
    tempos: [{ position: { measure: 1, beat: ONE }, at: ZERO, bpm: tempo }],
    keys: key ? [key] : [],
    tracks: [track],
  }
  const totalNotes = candidates.reduce((sum, candidate) => sum + candidate.notes.length, 0)
  return {
    score,
    text: serializeScore(score),
    report: {
      sourceTrackIndex: source.trackIndex,
      sourceTrackName: source.trackName,
      sourceChannel: source.channel + 1,
      inputNotes: source.notes.length,
      outputNotes: selected.length,
      discardedNotes: Math.max(0, totalNotes - selected.length),
      discardedTracks: Math.max(0, new Set(candidates.map((candidate) => candidate.trackIndex)).size - 1),
      ignoredEvents: countIgnoredEvents(midi),
      grid,
      voiceStrategy: strategy,
    },
  }
}

export function extractMelodyFromRecording(take: RecordedTake, options: MelodyExtractionOptions = {}): MelodyExtractionResult {
  return extractMelodyFromMidi(recordedTakeToMidi(take), { title: options.title ?? 'OpusWeave Recording', ...options })
}

export function midiFileToOwtText(data: ArrayBuffer, options: MelodyExtractionOptions = {}): string {
  return extractMelodyFromMidi(data, options).text
}
