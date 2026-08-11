import { describe, expect, test } from 'bun:test'
import { MIDIBuilder } from 'spessasynth_core'
import { compileScoreText, compareTakeWithScore, midiToTake, quantizeTake, takeRangeByMeasure, takeToMidi } from '../domain/owt/integration.ts'
import { parseNoteName, parseOwt, parseOwtOrThrow } from '../domain/owt/parser.ts'
import { rational } from '../domain/owt/rational.ts'
import { serializeOwt, serializeScore, serializeTake } from '../domain/owt/serializer.ts'

const scoreFixture = await Bun.file('examples/twinkle.owt').text()
const takeFixture = await Bun.file('examples/twinkle-take.owt').text()

const invalidScoreFixture = await Bun.file('src/tests/fixtures/owt/invalid-score.owt').text()
describe('OWT 0.1 Score', () => {
  test('parses explicit notes, chords, maps, tracks, and exact rational cursors', () => {
    const document = parseOwtOrThrow(scoreFixture)
    expect(document.kind).toBe('score')
    if (document.kind !== 'score') return
    expect(parseNoteName('C4')).toBe(60)
    expect(document).toMatchObject({ ppq: 480, title: 'Twinkle Twinkle Little Star / 小星星' })
    expect(document.meters[0]).toMatchObject({ numerator: 4, denominator: 4 })
    expect(document.tempos[0]?.bpm).toBe(100)
    expect(document.keys[0]).toMatchObject({ tonic: 'C', mode: 'major' })
    expect(document.tracks).toHaveLength(2)
    expect(document.tracks[0]?.events.filter((event) => event.kind === 'note')).toHaveLength(14)
    const chord = document.tracks[1]?.events.find((event) => event.kind === 'note')
    expect(chord).toMatchObject({ pitches: [48, 52, 55], duration: { numerator: 4, denominator: 1 } })
  })

  test('serializes deterministically and round-trips through the shared CompositionSpec compiler', () => {
    const parsed = parseOwtOrThrow(scoreFixture)
    expect(parsed.kind).toBe('score')
    if (parsed.kind !== 'score') return
    const canonical = serializeScore(parsed)
    const reparsed = parseOwtOrThrow(canonical)
    expect(serializeOwt(reparsed)).toBe(canonical)
    const compiled = compileScoreText(canonical)
    expect(compiled.spec.tracks).toHaveLength(2)
    expect(compiled.spec.tracks[1]?.notes).toHaveLength(21)
    expect(compiled.midi.byteLength).toBeGreaterThan(100)
  })


  test('keeps controls at the current cursor and compiles program changes and velocity overrides', () => {
    const text = `owt 0.1 score\n\nmeter 1:1 4/4\ntempo 1:1 120\nkey 1:1 A minor\ntrack "Control" channel=1 program=0 velocity=80\n| <cc64=127> C4:1{v=64} <bend=9000> <program=40> R:3 |\nend\n`
    const compiled = compileScoreText(text)
    expect(compiled.spec.tracks[0]?.notes[0]).toMatchObject({ startBeat: 0, durationBeats: 1, velocity: 64 })
    expect(compiled.spec.tracks[0]?.controlChanges?.[0]).toMatchObject({ beat: 0, controller: 64, value: 127 })
    expect(compiled.spec.tracks[0]?.pitchBends?.[0]).toMatchObject({ beat: 1, value: 9000 })
    expect(compiled.spec.tracks[0]?.programChanges?.[0]).toMatchObject({ beat: 1, program: 40 })
    expect(compiled.spec.keySignatures?.[0]).toMatchObject({ beat: 0, tonic: 'A', mode: 'minor' })
  })
  test('reports source-located violations for implicit durations, channel ranges, values, and bars', () => {
    const invalid = parseOwt(invalidScoreFixture)
    expect(invalid.document).toBeUndefined()
    const codes = invalid.diagnostics.map((issue) => issue.code)
    expect(codes).toContain('score.channel.range')
    expect(codes).toContain('score.velocity.range')
    expect(codes).toContain('score.event.syntax')
    expect(codes).toContain('score.cc.range')
    expect(codes).toContain('score.bar.misaligned')
    expect(invalid.diagnostics.every((issue) => issue.line > 0 && issue.column > 0)).toBe(true)
  })
})

describe('OWT 0.1 Take', () => {
  test('parses and stably serializes exact millisecond notes and controls', () => {
    const parsed = parseOwtOrThrow(takeFixture)
    expect(parsed.kind).toBe('take')
    if (parsed.kind !== 'take') return
    expect(parsed.events).toHaveLength(11)
    expect(parsed.events[0]).toMatchObject({ kind: 'note', pitch: 60, atMs: 0, durationMs: 468.42, velocity: 73, channel: 1 })
    const canonical = serializeTake(parsed)
    expect(serializeTake(parseOwtOrThrow(canonical) as typeof parsed)).toBe(canonical)
  })

  test('pairs MIDI notes, normalizes Note On velocity zero, and preserves CC and bend', () => {
    const builder = new MIDIBuilder({ timeDivision: 1000, initialTempo: 60, format: 0, name: 'Pairing' })
    builder.noteOn(0, 0, 0, 60, 90)
    builder.controllerChange(100, 0, 0, 64, 127)
    builder.noteOn(500, 0, 0, 60, 0)
    builder.pitchWheel(600, 0, 0, 9000)
    builder.flush(true)
    const take = midiToTake(builder.writeMIDI(), { title: 'Pairing' })
    expect(take.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'note', pitch: 60, atMs: 0, durationMs: 500, velocity: 90, channel: 1 }),
      expect.objectContaining({ kind: 'cc', controller: 64, value: 127, atMs: 100 }),
      expect.objectContaining({ kind: 'bend', value: 9000, atMs: 600 }),
    ]))
    expect(midiToTake(takeToMidi(take)).events.filter((event) => event.kind === 'note')).toHaveLength(1)
  })
})

describe('OWT Take quantization and comparison', () => {
  test('quantizes notes and controls on a configurable grid while preserving velocity', () => {
    const take = parseOwtOrThrow(takeFixture)
    expect(take.kind).toBe('take')
    if (take.kind !== 'take') return
    const score = quantizeTake(take, { grid: rational(1, 4), bpm: 120, meter: { numerator: 4, denominator: 4 } })
    const notes = score.tracks.flatMap((track) => track.events.filter((event) => event.kind === 'note'))
    expect(notes[0]).toMatchObject({ at: { numerator: 0, denominator: 1 }, velocity: 73 })
    expect(score.tracks.flatMap((track) => track.events).some((event) => event.kind === 'cc')).toBe(true)
    expect(serializeScore(score)).toContain('C4:1{v=73}')
  })


  test('retrieves a bounded Exact Take view by measure', () => {
    const take = parseOwtOrThrow(takeFixture)
    if (take.kind !== 'take') return
    const range = takeRangeByMeasure(take, {
      fromMeasure: 2,
      toMeasure: 2,
      bpm: 120,
      meter: { numerator: 4, denominator: 4 },
    })
    expect(range.events.every((event) => event.atMs < 4000)).toBe(true)
    expect(range.events.some((event) => event.kind === 'note' && event.atMs + event.durationMs > 2000)).toBe(true)
  })
  test('compares performed pitches and timing against a score', () => {
    const take = parseOwtOrThrow(takeFixture)
    const score = parseOwtOrThrow(scoreFixture)
    if (take.kind !== 'take' || score.kind !== 'score') return
    const comparison = compareTakeWithScore(take, score)
    expect(comparison.expectedNotes).toBeGreaterThan(0)
    expect(comparison.performedNotes).toBe(7)
    expect(comparison.pitchMatches).toBeGreaterThan(0)
    expect(comparison.meanAbsoluteTimingErrorMs).not.toBeNull()
  })
})
