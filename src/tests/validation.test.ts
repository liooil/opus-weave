import { describe, it, expect } from 'bun:test'
import { validateCompositionSpec } from '../domain/composition/validation.ts'

const valid = {
  title: 'T',
  ppq: 480,
  tempos: [{ beat: 0, bpm: 120 }],
  timeSignatures: [{ beat: 0, numerator: 4, denominator: 4 }],
  tracks: [
    {
      name: 'Piano',
      channel: 0,
      program: 0,
      volume: 100,
      pan: 64,
      notes: [{ startBeat: 0, durationBeats: 1, pitch: 60, velocity: 96 }],
      controlChanges: [{ beat: 0, controller: 7, value: 100 }],
      pitchBends: [{ beat: 0, value: 8192 }],
    },
  ],
}

describe('validateCompositionSpec', () => {
  it('accepts a valid spec with zero errors', () => {
    const r = validateCompositionSpec(valid)
    expect(r.errors).toEqual([])
    expect(r.warnings).toEqual([])
    expect(r.stats.trackCount).toBe(1)
    expect(r.stats.noteCount).toBe(1)
    expect(r.stats.durationBeats).toBe(1)
    expect(r.stats.pitchRange).toEqual({ min: 60, max: 60 })
  })

  it('rejects non-object specs', () => {
    for (const bad of [null, 42, 'x', [], undefined]) {
      const r = validateCompositionSpec(bad)
      expect(r.errors.length).toBeGreaterThan(0)
    }
  })

  it('rejects missing tracks', () => {
    const r = validateCompositionSpec({})
    expect(r.errors.some((e) => e.field === 'tracks')).toBe(true)
  })

  it('warns on an empty track list without erroring', () => {
    const r = validateCompositionSpec({ tracks: [] })
    expect(r.errors).toEqual([])
    expect(r.warnings.some((w) => w.field === 'tracks')).toBe(true)
  })

  it('names the exact track/event/field for out-of-range pitch', () => {
    const r = validateCompositionSpec({
      tracks: [{ name: 'T', notes: [{ startBeat: 0, durationBeats: 1, pitch: 128, velocity: 96 }] }],
    })
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0]!.field).toBe('tracks[0].notes[0].pitch')
    expect(r.errors[0]!.trackIndex).toBe(0)
    expect(r.errors[0]!.eventIndex).toBe(0)
  })

  it('rejects out-of-range MIDI values as errors', () => {
    const cases: Array<[string, unknown]> = [
      ['tracks[0].notes[0].velocity', 0],
      ['tracks[0].notes[0].pitch', -1],
      ['tracks[0].program', 128],
      ['tracks[0].channel', 16],
      ['tracks[0].controlChanges[0].controller', 128],
      ['tracks[0].controlChanges[0].value', -1],
      ['tracks[0].pitchBends[0].value', 16384],
    ]
    for (const [field, value] of cases) {
      const spec = structuredClone(valid)
      // fields use bracket notation: tracks[0].notes[0].pitch
      const tokens = [...field.matchAll(/([A-Za-z]+)|\[(\d+)\]/g)]
      let node: unknown = spec
      for (let i = 0; i < tokens.length - 1; i++) {
        const m = tokens[i]!
        node = m[1] !== undefined ? (node as Record<string, unknown>)[m[1]] : (node as unknown[])[Number(m[2])]
      }
      const last = tokens[tokens.length - 1]!
      if (last[1] !== undefined) (node as Record<string, unknown>)[last[1]] = value
      else (node as unknown[])[Number(last[2])] = value
      const r = validateCompositionSpec(spec)
      expect(r.errors.some((e) => e.field === field), `expected error for ${field}`).toBe(true)
    }
  })

  it('rejects negative start times', () => {
    const r = validateCompositionSpec({
      tracks: [{ name: 'T', notes: [{ startBeat: -0.5, durationBeats: 1, pitch: 60, velocity: 96 }] }],
    })
    expect(r.errors.some((e) => e.field === 'tracks[0].notes[0].startBeat')).toBe(true)
  })

  it('rejects zero or negative durations', () => {
    for (const d of [0, -1]) {
      const r = validateCompositionSpec({
        tracks: [{ name: 'T', notes: [{ startBeat: 0, durationBeats: d, pitch: 60, velocity: 96 }] }],
      })
      expect(r.errors.some((e) => e.field === 'tracks[0].notes[0].durationBeats')).toBe(true)
    }
  })

  it('rejects non-power-of-two time signature denominators', () => {
    const r = validateCompositionSpec({
      tracks: [],
      timeSignatures: [{ beat: 0, numerator: 4, denominator: 3 }],
    })
    expect(r.errors.some((e) => e.field === 'timeSignatures[0].denominator')).toBe(true)
  })

  it('rejects invalid tempos', () => {
    const r = validateCompositionSpec({ tracks: [], tempos: [{ beat: 0, bpm: 0 }] })
    expect(r.errors.some((e) => e.field === 'tempos[0].bpm')).toBe(true)
  })

  it('rejects non-integer values where integers are required', () => {
    const r = validateCompositionSpec({
      tracks: [{ name: 'T', notes: [{ startBeat: 0, durationBeats: 1, pitch: 60.5, velocity: 96 }] }],
    })
    expect(r.errors.some((e) => e.field === 'tracks[0].notes[0].pitch')).toBe(true)
  })

  it('computes stats: density, pitch range, duration across tracks', () => {
    const r = validateCompositionSpec({
      tempos: [{ beat: 0, bpm: 100 }],
      tracks: [
        { name: 'A', notes: [{ startBeat: 0, durationBeats: 1, pitch: 40, velocity: 90 }] },
        { name: 'B', notes: [{ startBeat: 2, durationBeats: 3, pitch: 90, velocity: 90 }] },
      ],
    })
    expect(r.stats.trackDensities).toEqual([1, 1])
    expect(r.stats.pitchRange).toEqual({ min: 40, max: 90 })
    expect(r.stats.durationBeats).toBe(5)
    expect(r.stats.noteCount).toBe(2)
  })
})
