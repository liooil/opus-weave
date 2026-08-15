import { describe, expect, test } from 'bun:test'
import { MIDIBuilder } from 'spessasynth_core'
import { compileScoreText, extractMelodyFromMidi } from '../domain/owt/integration.ts'
import { parseNoteName, parseOwt, parseOwtOrThrow } from '../domain/owt/parser.ts'
import { rational } from '../domain/owt/rational.ts'
import { serializeOwt, serializeScore } from '../domain/owt/serializer.ts'

const scoreFixture = await Bun.file('examples/twinkle.owt').text()
const invalidScoreFixture = await Bun.file('src/tests/fixtures/owt/invalid-score.owt').text()

describe('OWT 0.1', () => {
  test('parses explicit notes, chords, maps, tracks, and exact rational cursors', () => {
    const document = parseOwtOrThrow(scoreFixture)
    expect(parseNoteName('C4')).toBe(60)
    expect(document).toMatchObject({ kind: 'score', ppq: 480, title: 'Twinkle Twinkle Little Star / 小星星' })
    expect(document.meters[0]).toMatchObject({ numerator: 4, denominator: 4 })
    expect(document.tempos[0]?.bpm).toBe(100)
    expect(document.keys[0]).toMatchObject({ tonic: 'C', mode: 'major' })
    expect(document.tracks).toHaveLength(2)
    expect(document.tracks[0]?.events.filter((event) => event.kind === 'note')).toHaveLength(14)
    const chord = document.tracks[1]?.events.find((event) => event.kind === 'note')
    expect(chord).toMatchObject({ pitches: [48, 52, 55], duration: { numerator: 4, denominator: 1 } })
  })

  test('serializes deterministically and compiles through the shared composition model', () => {
    const parsed = parseOwtOrThrow(scoreFixture)
    const canonical = serializeScore(parsed)
    const reparsed = parseOwtOrThrow(canonical)
    expect(serializeOwt(reparsed)).toBe(canonical)
    const compiled = compileScoreText(canonical)
    expect(compiled.spec.tracks).toHaveLength(2)
    expect(compiled.spec.tracks[1]?.notes).toHaveLength(21)
    expect(compiled.midi.byteLength).toBeGreaterThan(100)
  })

  test('breaks canonical lines at phrase ends and wraps after four measures otherwise', () => {
    const canonical = serializeScore(parseOwtOrThrow(scoreFixture))
    expect(canonical).toContain('| C4:1 C4:1 G4:1 G4:1 | A4:1 A4:1 G4:2 |')
    expect(canonical).toContain('| F4:1 F4:1 E4:1 E4:1 | D4:1 D4:1 C4:2 |')
    const stream = `owt 0.1 score\n\nmeter 1:1 4/4\ntrack "T" channel=1\n${Array.from({ length: 5 }, () => '| C4:1 D4:1 E4:1 F4:1 |').join(' ')}\nend\n`
    const streamLines = serializeScore(parseOwtOrThrow(stream)).split('\n').filter((line) => line.startsWith('|'))
    expect(streamLines).toEqual([
      '| C4:1 D4:1 E4:1 F4:1 | C4:1 D4:1 E4:1 F4:1 | C4:1 D4:1 E4:1 F4:1 | C4:1 D4:1 E4:1 F4:1 |',
      '| C4:1 D4:1 E4:1 F4:1 |',
    ])
    const breath = `owt 0.1 score\n\nmeter 1:1 4/4\ntrack "T" channel=1\n| C4:1 D4:1 R:2 | E4:1 F4:1 G4:1 A4:1 |\nend\n`
    expect(serializeScore(parseOwtOrThrow(breath))).toContain('| C4:1 D4:1 R:2 |\n| E4:1 F4:1 G4:1 A4:1 |')
  })

  test('keeps supported score controls and velocity overrides', () => {
    const text = `owt 0.1 score\n\nmeter 1:1 4/4\ntempo 1:1 120\nkey 1:1 A minor\ntrack "Control" channel=1 program=0 velocity=80\n| <cc64=127> C4:1{v=64} <bend=9000> <program=40> R:3 |\nend\n`
    const compiled = compileScoreText(text)
    expect(compiled.spec.tracks[0]?.notes[0]).toMatchObject({ startBeat: 0, durationBeats: 1, velocity: 64 })
    expect(compiled.spec.tracks[0]?.controlChanges?.[0]).toMatchObject({ beat: 0, controller: 64, value: 127 })
    expect(compiled.spec.tracks[0]?.pitchBends?.[0]).toMatchObject({ beat: 1, value: 9000 })
    expect(compiled.spec.tracks[0]?.programChanges?.[0]).toMatchObject({ beat: 1, program: 40 })
  })

  test('rejects removed Take documents', () => {
    const result = parseOwt('owt 0.1 take\n\nunit ms\n\nend\n')
    expect(result.document).toBeUndefined()
    expect(result.diagnostics[0]).toMatchObject({ code: 'document.header.invalid' })
  })

  test('reports source-located score violations', () => {
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

  test('rejects unknown and duplicate track and note attributes with locations', () => {
    const cases = [
      ['track "Bad" channe=1', 'score.track.attribute.unsupported'],
      ['track "Bad" channel=1 channel=2', 'score.track.attribute.duplicate'],
      ['track "Bad" channel=1\n| C4:4{v=80,v=90} |', 'score.attribute.duplicate'],
    ] as const
    for (const [track, code] of cases) {
      const result = parseOwt(`owt 0.1 score\nmeter 1:1 4/4\n${track}\n| C4:4 |\nend\n`)
      expect(result.document).toBeUndefined()
      expect(result.diagnostics.find((item) => item.code === code)).toMatchObject({ line: expect.any(Number), column: expect.any(Number) })
    }
  })

  test('rejects out-of-measure positions, zero-tick durations, and incomplete final measures', () => {
    const position = parseOwt('owt 0.1 score\nmeter 1:1 4/4\ntempo 1:5 120\ntrack "M" channel=1\n| C4:4 |\nend\n')
    expect(position.diagnostics.map((item) => item.code)).toContain('score.position.outOfMeasure')
    const zeroTick = parseOwt('owt 0.1 score\nppq 1\ntrack "M" channel=1\n| C4:1/3 R:11/3 |\nend\n')
    expect(zeroTick.diagnostics.map((item) => item.code)).toContain('score.duration.zeroTick')
    const incomplete = parseOwt('owt 0.1 score\ntrack "M" channel=1\nC4:1\nend\n')
    expect(incomplete.diagnostics.map((item) => item.code)).toContain('score.track.incompleteMeasure')
  })

  test('relaxes bar validation only for lenient parsing', () => {
    const lenientText = `owt 0.1 score
meter 1:1 4/4
track "M" channel=1
| C4:2 D4:2 E4:2 |
end
`
    const strict = parseOwt(lenientText)
    expect(strict.document).toBeUndefined()
    expect(strict.diagnostics.map((item) => item.code)).toContain('score.bar.misaligned')
    const lenient = parseOwt(lenientText, { lenientBars: true })
    expect(lenient.document).toBeDefined()
    expect(lenient.diagnostics.some((item) => item.code === 'score.bar.misaligned')).toBe(false)
    expect(lenient.diagnostics.some((item) => item.code === 'score.track.incompleteMeasure')).toBe(false)
  })

  test('warns only when shared MIDI channels have conflicting programs', () => {
    const result = parseOwt('owt 0.1 score\ntrack "A" channel=1 program=0\n| C4:4 |\ntrack "B" channel=1 program=40\n| C3:4 |\nend\n')
    expect(result.document).toBeDefined()
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ severity: 'warning', code: 'score.channel.programConflict' }))
  })
})

describe('lossy MIDI melody extraction', () => {
  test('selects the named melody track and emits a simple one-track OWT score', () => {
    const source = compileScoreText(scoreFixture)
    const extracted = extractMelodyFromMidi(source.midi, { title: 'Extracted' })
    expect(extracted.report.sourceTrackName).toStartWith('Melody')
    expect(extracted.report).toMatchObject({ inputNotes: 14, outputNotes: 14 })
    expect(extracted.score.tracks).toHaveLength(1)
    expect(extracted.score.tracks[0]?.name).toBe('Melody')
    expect(extracted.text).not.toContain('{v=')
    expect(parseOwtOrThrow(extracted.text).tracks[0]?.events.filter((event) => event.kind === 'note')).toHaveLength(14)
  })

  test('supports explicit highest-note extraction from a chord track', () => {
    const source = compileScoreText(scoreFixture)
    const extracted = extractMelodyFromMidi(source.midi, { trackIndex: 2, voiceStrategy: 'highest' })
    const pitches = extracted.score.tracks[0]!.events
      .filter((event) => event.kind === 'note')
      .flatMap((event) => event.kind === 'note' ? event.pitches : [])
    expect(pitches.slice(0, 4)).toEqual([55, 60, 55, 60])
    expect(extracted.report.sourceTrackIndex).toBe(2)
  })

  test('quantizes off-grid MIDI and ignores performance controls', () => {
    const builder = new MIDIBuilder({ timeDivision: 480, initialTempo: 120, format: 0, name: 'Loose melody' })
    builder.noteOn(37, 0, 0, 60, 73)
    builder.controllerChange(100, 0, 0, 64, 127)
    builder.noteOff(241, 0, 0, 60)
    builder.noteOn(269, 0, 0, 62, 91)
    builder.pitchWheel(300, 0, 0, 9000)
    builder.noteOff(501, 0, 0, 62)
    builder.flush(true)

    const extracted = extractMelodyFromMidi(builder.writeMIDI(), { grid: rational(1, 4) })
    const notes = extracted.score.tracks[0]!.events.filter((event) => event.kind === 'note')
    expect(notes[0]).toMatchObject({ at: { numerator: 0, denominator: 1 }, duration: { numerator: 1, denominator: 2 } })
    expect(notes[1]).toMatchObject({ at: { numerator: 1, denominator: 2 }, duration: { numerator: 1, denominator: 2 } })
    expect(extracted.report.ignoredEvents).toBe(2)
    expect(extracted.text).not.toContain('<cc')
    expect(extracted.text).not.toContain('<bend')
  })
})
