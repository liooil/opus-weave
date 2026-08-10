import { describe, it, expect } from 'bun:test'
import { TempoMap } from '../domain/composition/tempo-map.ts'

describe('TempoMap', () => {
  it('rounds beats to ticks in one central place', () => {
    const map = new TempoMap({ ppq: 480, tempos: [] })
    expect(map.beatToTick(0)).toBe(0)
    expect(map.beatToTick(0.5)).toBe(240)
    expect(map.beatToTick(1.5)).toBe(720)
    expect(map.beatToTick(0.25)).toBe(120)
    expect(map.beatToTick(1 / 3)).toBe(160)
  })

  it('inserts a default tempo at tick 0 when none is given', () => {
    const map = new TempoMap({ ppq: 480, tempos: [{ beat: 2, bpm: 200 }] })
    expect(map.tempos).toEqual([
      { tick: 0, bpm: 120 },
      { tick: 960, bpm: 200 },
    ])
  })

  it('does not duplicate a tempo at beat 0', () => {
    const map = new TempoMap({ ppq: 480, tempos: [{ beat: 0, bpm: 90 }] })
    expect(map.tempos).toEqual([{ tick: 0, bpm: 90 }])
  })

  it('sorts tempo events by beat', () => {
    const map = new TempoMap({
      ppq: 480,
      tempos: [
        { beat: 2, bpm: 200 },
        { beat: 1, bpm: 150 },
        { beat: 0, bpm: 100 },
      ],
    })
    expect(map.tempos.map((t) => t.bpm)).toEqual([100, 150, 200])
  })

  it('computes seconds integrating over tempo changes', () => {
    // 120 BPM for 1 beat (0.5 s), then 240 BPM for 1 beat (0.25 s)
    const map = new TempoMap({
      ppq: 480,
      tempos: [
        { beat: 0, bpm: 120 },
        { beat: 1, bpm: 240 },
      ],
    })
    expect(map.tickToSeconds(0)).toBe(0)
    expect(map.tickToSeconds(480)).toBeCloseTo(0.5, 6)
    expect(map.tickToSeconds(960)).toBeCloseTo(0.75, 6)
  })

  it('tickToSeconds is monotonic and handles ticks between changes', () => {
    const map = new TempoMap({ ppq: 480, tempos: [{ beat: 0, bpm: 120 }] })
    expect(map.tickToSeconds(240)).toBeCloseTo(0.25, 6)
    expect(map.tickToSeconds(960)).toBeCloseTo(1.0, 6)
  })

  it('sorts and converts time signatures', () => {
    const map = new TempoMap({
      ppq: 480,
      timeSignatures: [
        { beat: 4, numerator: 3, denominator: 8 },
        { beat: 0, numerator: 4, denominator: 4 },
      ],
    })
    expect(map.timeSignatures).toEqual([
      { tick: 0, numerator: 4, denominator: 4 },
      { tick: 1920, numerator: 3, denominator: 8 },
    ])
  })
})
