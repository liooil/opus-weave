import { BasicMIDI, MIDIBuilder } from 'spessasynth_core'
import type { CompositionSpec, CompositionTrack } from '../composition/composition-spec.ts'
import { TempoMap } from '../composition/tempo-map.ts'
import { buildMidi } from '../midi/midi-export.ts'
import { importMidi } from '../midi/midi-import.ts'
import { RECORD_PPQ, type RecordedTake } from '../midi/midi-recorder.ts'
import type {
  OwtScore,
  OwtScoreTrack,
  OwtTake,
  QuantizeOptions,
  ScoreEvent,
  TakeEvent,
  TakeNoteEvent,
} from './ast.ts'
import { parseOwtOrThrow } from './parser.ts'
import {
  ZERO,
  addRational,
  compareRational,
  multiplyRational,
  rational,
  rationalToNumber,
  type Rational,
} from './rational.ts'
import { serializeTake } from './serializer.ts'

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
  const document = parseOwtOrThrow(text)
  if (document.kind !== 'score') throw new Error('expected an OWT score document')
  const spec = scoreToCompositionSpec(document)
  return { score: document, spec, midi: buildMidi(spec) }
}

function midiTempoMap(midi: BasicMIDI): TempoMap {
  const ppq = midi.timeDivision || 480
  const sourceChanges = midi.tempoChanges.length > 1 ? midi.tempoChanges.slice(0, -1) : midi.tempoChanges
  const changes = sourceChanges
    .filter((change) => change.ticks >= 0)
    .map((change) => ({ beat: change.ticks / ppq, bpm: change.tempo }))
  return new TempoMap({ ppq, tempos: changes, defaultTempo: changes.find((change) => change.beat === 0)?.bpm ?? 120 })
}

interface PendingNote {
  atMs: number
  velocity: number
  line: number
  column: number
}

function takeEventOrder(event: TakeEvent): number {
  if (event.kind === 'note') return 0
  if (event.kind === 'cc') return 1
  return 2
}

export function midiToTake(data: ArrayBuffer, options: { title?: string; source?: string } = {}): OwtTake {
  const midi = importMidi(data, options.title)
  const tempoMap = midiTempoMap(midi)
  const events = midi.tracks
    .flatMap((track, trackIndex) => track.events.map((event) => ({ event, trackIndex })))
    .sort((left, right) => left.event.ticks - right.event.ticks || left.trackIndex - right.trackIndex)
  const takeEvents: TakeEvent[] = []
  const pending = new Map<string, PendingNote[]>()

  for (const { event } of events) {
    if (event.statusByte < 0x80 || event.statusByte >= 0xf0) continue
    const kind = event.statusByte & 0xf0
    const channel = (event.statusByte & 0x0f) + 1
    const atMs = tempoMap.tickToSeconds(event.ticks) * 1000
    if (kind === 0x90 && (event.data[1] ?? 0) > 0) {
      const pitch = event.data[0] ?? 0
      const key = `${channel}:${pitch}`
      const queue = pending.get(key) ?? []
      queue.push({ atMs, velocity: event.data[1]!, line: 0, column: 0 })
      pending.set(key, queue)
    } else if (kind === 0x80 || (kind === 0x90 && (event.data[1] ?? 0) === 0)) {
      const pitch = event.data[0] ?? 0
      const key = `${channel}:${pitch}`
      const queue = pending.get(key)
      const start = queue?.shift()
      if (queue?.length === 0) pending.delete(key)
      if (start) takeEvents.push({
        kind: 'note', pitch, atMs: start.atMs, durationMs: Math.max(0, atMs - start.atMs),
        velocity: start.velocity, channel, line: start.line, column: start.column,
      })
    } else if (kind === 0xb0) {
      takeEvents.push({ kind: 'cc', controller: event.data[0] ?? 0, value: event.data[1] ?? 0, atMs, channel, line: 0, column: 0 })
    } else if (kind === 0xe0) {
      takeEvents.push({ kind: 'bend', value: ((event.data[1] ?? 0) << 7) | (event.data[0] ?? 0), atMs, channel, line: 0, column: 0 })
    }
  }

  const endMs = tempoMap.tickToSeconds(midi.lastVoiceEventTick) * 1000
  for (const [key, queue] of pending) {
    const [channel, pitch] = key.split(':').map(Number)
    for (const start of queue) {
      takeEvents.push({ kind: 'note', pitch: pitch!, atMs: start.atMs, durationMs: Math.max(0, endMs - start.atMs), velocity: start.velocity, channel: channel!, line: 0, column: 0 })
    }
  }
  takeEvents.sort((a, b) => a.atMs - b.atMs || a.channel - b.channel || takeEventOrder(a) - takeEventOrder(b))
  return { kind: 'take', version: '0.1', title: options.title, source: options.source, unit: 'ms', events: takeEvents }
}

export function recordedTakeToOwt(take: RecordedTake, options: { title?: string; source?: string } = {}): OwtTake {
  const builder = new MIDIBuilder({ timeDivision: RECORD_PPQ, initialTempo: 120, format: 0, name: options.title ?? 'Recorded Take' })
  for (const event of take.events) {
    const status = event.data[0]!
    const channel = status & 0x0f
    const kind = status & 0xf0
    if (kind === 0x90) builder.noteOn(event.tick, 0, channel, event.data[1]!, event.data[2]!)
    else if (kind === 0x80) builder.noteOff(event.tick, 0, channel, event.data[1]!)
    else if (kind === 0xb0) builder.controllerChange(event.tick, 0, channel, event.data[1]!, event.data[2]!)
    else if (kind === 0xe0) builder.pitchWheel(event.tick, 0, channel, (event.data[2]! << 7) | event.data[1]!)
  }
  builder.flush(true)
  const result = midiToTake(builder.writeMIDI(), options)
  return result
}

export function takeToMidi(take: OwtTake): ArrayBuffer {
  const ppq = 1000
  const builder = new MIDIBuilder({ timeDivision: ppq, initialTempo: 60, format: 0, name: take.title ?? 'OWT Take' })
  for (const event of take.events) {
    const tick = Math.round(event.atMs)
    const channel = event.channel - 1
    if (event.kind === 'note') {
      builder.noteOn(tick, 0, channel, event.pitch, event.velocity)
      builder.noteOff(Math.round(event.atMs + event.durationMs), 0, channel, event.pitch)
    } else if (event.kind === 'cc') builder.controllerChange(tick, 0, channel, event.controller, event.value)
    else builder.pitchWheel(tick, 0, channel, event.value)
  }
  builder.flush(true)
  return builder.writeMIDI()
}

function quantized(value: number, grid: Rational): Rational {
  const gridValue = rationalToNumber(grid)
  return multiplyRational(rational(Math.round(value / gridValue)), grid)
}

interface VoiceTrack {
  track: OwtScoreTrack
  end: Rational
}

export function quantizeTake(take: OwtTake, options: QuantizeOptions): OwtScore {
  if (compareRational(options.grid, ZERO) <= 0) throw new Error('quantization grid must be positive')
  if (!Number.isFinite(options.bpm) || options.bpm <= 0) throw new Error('quantization BPM must be positive')
  const quarterMs = 60000 / options.bpm
  const byChannel = new Map<number, TakeNoteEvent[]>()
  for (const event of take.events) {
    if (event.kind !== 'note') continue
    const notes = byChannel.get(event.channel) ?? []
    notes.push(event)
    byChannel.set(event.channel, notes)
  }
  const tracks: OwtScoreTrack[] = []
  const primaryByChannel = new Map<number, OwtScoreTrack>()

  for (const [channel, notes] of [...byChannel.entries()].sort((a, b) => a[0] - b[0])) {
    notes.sort((a, b) => a.atMs - b.atMs || a.pitch - b.pitch)
    const voices: VoiceTrack[] = []
    for (const note of notes) {
      const at = quantized(note.atMs / quarterMs, options.grid)
      const rawDuration = Math.max(rationalToNumber(options.grid), note.durationMs / quarterMs)
      const duration = quantized(rawDuration, options.grid)
      let voice = voices.find((candidate) => compareRational(candidate.end, at) <= 0)
      if (!voice) {
        const suffix = voices.length === 0 ? '' : ` ${voices.length + 1}`
        const track: OwtScoreTrack = {
          name: `Recorded ch${channel}${suffix}`,
          channel,
          program: options.program ?? 0,
          velocity: 80,
          events: [],
        }
        voice = { track, end: ZERO }
        voices.push(voice)
        tracks.push(track)
        if (!primaryByChannel.has(channel)) primaryByChannel.set(channel, track)
      }
      const simultaneous = voice.track.events.find((event) =>
        event.kind === 'note' && compareRational(event.at, at) === 0 && compareRational(event.duration, duration) === 0 && event.velocity === note.velocity,
      )
      if (simultaneous?.kind === 'note') simultaneous.pitches.push(note.pitch)
      else voice.track.events.push({ kind: 'note', at, duration, pitches: [note.pitch], velocity: note.velocity, line: 0, column: 0 })
      voice.end = addRational(at, duration)
    }
  }

  for (const event of take.events) {
    if (event.kind === 'note') continue
    let track = primaryByChannel.get(event.channel)
    if (!track) {
      track = { name: `Recorded ch${event.channel}`, channel: event.channel, program: options.program ?? 0, velocity: 80, events: [] }
      primaryByChannel.set(event.channel, track)
      tracks.push(track)
    }
    const at = quantized(event.atMs / quarterMs, options.grid)
    if (event.kind === 'cc') track.events.push({ kind: 'cc', at, controller: event.controller, value: event.value, line: 0, column: 0 })
    else track.events.push({ kind: 'bend', at, value: event.value, line: 0, column: 0 })
  }
  for (const track of tracks) track.events.sort((a, b) => compareRational(a.at, b.at) || takeEventOrderFromScore(a) - takeEventOrderFromScore(b))

  return {
    kind: 'score', version: '0.1', title: options.title ?? `${take.title ?? 'Take'}, quantized`, ppq: options.ppq ?? 480,
    meters: [{ position: { measure: 1, beat: rational(1) }, at: ZERO, ...options.meter }],
    tempos: [{ position: { measure: 1, beat: rational(1) }, at: ZERO, bpm: options.bpm }],
    keys: [], tracks,
  }
}

function takeEventOrderFromScore(event: ScoreEvent): number {
  if (event.kind === 'cc') return 0
  if (event.kind === 'bend') return 1
  if (event.kind === 'program') return 2
  if (event.kind === 'note') return 3
  return 4
}

function scoreQuarterToMs(score: OwtScore, quarter: Rational): number {
  const target = rationalToNumber(quarter)
  const tempos = score.tempos.slice().sort((a, b) => compareRational(a.at, b.at))
  let milliseconds = 0
  let previousBeat = 0
  let bpm = tempos[0]?.bpm ?? 120
  for (const tempo of tempos) {
    const beat = rationalToNumber(tempo.at)
    if (beat >= target) break
    milliseconds += (beat - previousBeat) * (60000 / bpm)
    previousBeat = beat
    bpm = tempo.bpm
  }
  return milliseconds + (target - previousBeat) * (60000 / bpm)
}

export interface TakeComparison {
  expectedNotes: number
  performedNotes: number
  pitchMatches: number
  missedNotes: number
  extraNotes: number
  meanAbsoluteTimingErrorMs: number | null
  noteResults: Array<{ expectedPitch: number; performedPitch?: number; timingErrorMs?: number }>
}

export function compareTakeWithScore(take: OwtTake, score: OwtScore): TakeComparison {
  const expected = score.tracks.flatMap((track) => track.events.flatMap((event) => event.kind === 'note'
    ? event.pitches.map((pitch) => ({ pitch, atMs: scoreQuarterToMs(score, event.at) }))
    : [])).sort((a, b) => a.atMs - b.atMs || a.pitch - b.pitch)
  const performed = take.events.filter((event): event is TakeNoteEvent => event.kind === 'note').slice().sort((a, b) => a.atMs - b.atMs || a.pitch - b.pitch)
  const length = Math.max(expected.length, performed.length)
  const noteResults: TakeComparison['noteResults'] = []
  let pitchMatches = 0
  let timingTotal = 0
  let timingCount = 0
  for (let index = 0; index < length; index++) {
    const wanted = expected[index]
    const actual = performed[index]
    if (!wanted) continue
    const result: TakeComparison['noteResults'][number] = { expectedPitch: wanted.pitch }
    if (actual) {
      result.performedPitch = actual.pitch
      result.timingErrorMs = actual.atMs - wanted.atMs
      timingTotal += Math.abs(result.timingErrorMs)
      timingCount++
      if (actual.pitch === wanted.pitch) pitchMatches++
    }
    noteResults.push(result)
  }
  return {
    expectedNotes: expected.length,
    performedNotes: performed.length,
    pitchMatches,
    missedNotes: Math.max(0, expected.length - performed.length),
    extraNotes: Math.max(0, performed.length - expected.length),
    meanAbsoluteTimingErrorMs: timingCount > 0 ? timingTotal / timingCount : null,
    noteResults,
  }
}

export function takeRangeByMeasure(
  take: OwtTake,
  options: { fromMeasure: number; toMeasure: number; bpm: number; meter: { numerator: number; denominator: number } },
): OwtTake {
  if (!Number.isInteger(options.fromMeasure) || options.fromMeasure < 1) throw new Error('fromMeasure must be a positive integer')
  if (!Number.isInteger(options.toMeasure) || options.toMeasure < options.fromMeasure) throw new Error('toMeasure must be greater than or equal to fromMeasure')
  if (!Number.isFinite(options.bpm) || options.bpm <= 0) throw new Error('range BPM must be positive')
  if (!Number.isInteger(options.meter.numerator) || options.meter.numerator < 1) throw new Error('meter numerator must be positive')
  if (!Number.isInteger(options.meter.denominator) || options.meter.denominator < 1 || (options.meter.denominator & (options.meter.denominator - 1)) !== 0) {
    throw new Error('meter denominator must be a positive power of two')
  }
  const measureMs = options.meter.numerator * (4 / options.meter.denominator) * (60000 / options.bpm)
  const start = (options.fromMeasure - 1) * measureMs
  const end = options.toMeasure * measureMs
  return {
    ...take,
    events: take.events.filter((event) => event.atMs < end && (event.kind !== 'note' ? event.atMs >= start : event.atMs + event.durationMs > start)),
  }
}

export function midiFileToTakeText(data: ArrayBuffer, options: { title?: string; source?: string } = {}): string {
  return serializeTake(midiToTake(data, options))
}
