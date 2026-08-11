import { describe, expect, test } from 'bun:test'
import { buildScoreViewModel, durationMarks, jianpuPitch, staffPosition } from '../domain/owt/score-views.ts'
import { parseOwtOrThrow } from '../domain/owt/parser.ts'
import { renderJianpuScore, renderStaffScore } from '../web/components/score-views.ts'

const twinkle = await Bun.file('examples/twinkle.owt').text()

describe('score view models', () => {
  test('groups OWT events into synchronized measures and tracks', () => {
    const model = buildScoreViewModel(parseOwtOrThrow(twinkle))
    expect(model).toMatchObject({ title: 'Twinkle Twinkle Little Star / 小星星', tempo: 100, meter: { numerator: 4, denominator: 4 } })
    expect(model.tracks).toHaveLength(2)
    expect(model.tracks[0]!.measures).toHaveLength(4)
    expect(model.tracks[0]!.measures[0]!.events.map((event) => event.beat)).toEqual([0, 1, 2, 3])
    expect(model.tracks[1]!.measures[0]!.events[0]!.pitches).toEqual([48, 52, 55])
  })

  test('maps MIDI pitches onto a treble staff', () => {
    expect(staffPosition(64)).toEqual({ y: 80, accidental: false }) // E4 bottom line
    expect(staffPosition(60)).toEqual({ y: 90, accidental: false }) // C4 ledger line
    expect(staffPosition(66)).toMatchObject({ accidental: true })
  })

  test('maps keys and accidentals to Jianpu degrees', () => {
    expect(jianpuPitch(60, 'C', 'major')).toEqual({ degree: 1, accidental: '', octave: 0 })
    expect(jianpuPitch(72, 'C', 'major')).toEqual({ degree: 1, accidental: '', octave: 1 })
    expect(jianpuPitch(66, 'C', 'major')).toEqual({ degree: 4, accidental: '#', octave: 0 })
    expect(jianpuPitch(69, 'A', 'minor')).toEqual({ degree: 1, accidental: '', octave: 0 })
  })

  test('renders conventional duration marks', () => {
    expect(durationMarks(4)).toEqual({ underlines: 0, dashes: 3, label: '' })
    expect(durationMarks(0.5)).toEqual({ underlines: 1, dashes: 0, label: '' })
    expect(durationMarks(0.25)).toEqual({ underlines: 2, dashes: 0, label: '' })
  })

  test('renders staff SVG and Jianpu HTML from the same model', () => {
    const model = buildScoreViewModel(parseOwtOrThrow(twinkle))
    const staff = renderStaffScore(model)
    const jianpu = renderJianpuScore(model)
    expect(staff).toContain('staff-line')
    expect(staff).toContain('𝄞')
    expect(jianpu).toContain('jianpu-measure')
    expect(jianpu).toContain('1=C')
  })
})
