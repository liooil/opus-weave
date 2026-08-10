import { describe, it, expect } from 'bun:test'
import { MidiRecorder, takeToMidi, RECORD_PPQ } from '../domain/midi/midi-recorder.ts'
import { importMidi, inspectMidi } from '../domain/midi/midi-import.ts'

// 120 BPM → 1 beat = 500 ms = 480 ticks → 0.96 ticks/ms
const T0 = 1_000_000

function recorderWithEvents(events: Array<[number, number[]]>): MidiRecorder {
  const r = new MidiRecorder()
  r.start(T0)
  for (const [deltaMs, data] of events) r.push(new Uint8Array(data), T0 + deltaMs)
  return r
}

describe('MidiRecorder', () => {
  it('converts high-precision deltas to ticks', () => {
    const r = recorderWithEvents([
      [0, [0x90, 60, 100]],
      [500, [0x80, 60, 64]],
    ])
    const take = r.stop(T0 + 500)
    expect(take.durationMs).toBe(500)
    expect(take.events.map((e) => e.tick)).toEqual([0, Math.round(500 * (RECORD_PPQ / 500))])
    expect(take.events[1]!.tick).toBe(480)
  })

  it('normalizes Note On velocity 0 to Note Off', () => {
    const r = recorderWithEvents([[0, [0x90, 60, 100]], [300, [0x90, 60, 0]]])
    const take = r.stop(T0 + 300)
    const offs = take.events.filter((e) => (e.data[0]! & 0xf0) === 0x80)
    expect(offs).toHaveLength(1)
    expect(offs[0]!.data[0]).toBe(0x80) // channel 0
  })

  it('records sustain, modulation, other CCs and pitch bend verbatim', () => {
    const r = recorderWithEvents([
      [0, [0xb0, 64, 127]],
      [100, [0xb0, 1, 50]],
      [200, [0xe0, 0x00, 0x40]], // pitch bend +8192? value = 0 | 0x40<<7 = 8192
      [300, [0xb0, 64, 0]],
    ])
    const take = r.stop(T0 + 300)
    const ccs = take.events.filter((e) => (e.data[0]! & 0xf0) === 0xb0)
    expect(ccs.map((c) => [...c.data])).toEqual([
      [0xb0, 64, 127],
      [0xb0, 1, 50],
      [0xb0, 64, 0],
    ])
    const pb = take.events.find((e) => (e.data[0]! & 0xf0) === 0xe0)!
    expect(pb.data[1]).toBe(0)
    expect(pb.data[2]).toBe(0x40)
  })

  it('handles repeated note-on as note-on then note-off (no dangling)', () => {
    const r = recorderWithEvents([
      [0, [0x90, 60, 100]],
      [200, [0x90, 60, 100]], // repeated press
      [400, [0x80, 60, 64]],
    ])
    const take = r.stop(T0 + 400)
    const ons = take.events.filter((e) => (e.data[0]! & 0xf0) === 0x90)
    const offs = take.events.filter((e) => (e.data[0]! & 0xf0) === 0x80)
    expect(ons).toHaveLength(2)
    expect(offs).toHaveLength(2)
  })

  it('closes hanging notes on stop (sustain held at end)', () => {
    const r = recorderWithEvents([[0, [0x90, 60, 100]]])
    const take = r.stop(T0 + 1000)
    const offs = take.events.filter((e) => (e.data[0]! & 0xf0) === 0x80)
    expect(offs).toHaveLength(1)
    expect(offs[0]!.data[1]).toBe(60)
  })

  it('ignores messages while not recording', () => {
    const r = new MidiRecorder()
    r.push(new Uint8Array([0x90, 60, 100]), T0)
    expect(r.stop(T0).events).toHaveLength(0)
  })

  it('rejects negative deltas gracefully', () => {
    const r = new MidiRecorder()
    r.start(T0)
    r.push(new Uint8Array([0x90, 60, 100]), T0 - 100)
    const take = r.stop(T0)
    expect(take.events[0]!.tick).toBe(0)
  })

  it('exports a take to a MIDI that re-imports with the same notes', () => {
    const r = recorderWithEvents([
      [0, [0x90, 60, 100]],
      [250, [0x80, 60, 64]],
      [250, [0x90, 64, 90]],
      [500, [0x80, 64, 64]],
    ])
    const take = r.stop(T0 + 1000)
    const buf = takeToMidi(take)
    const midi = importMidi(buf)
    expect(midi.format).toBe(0)
    expect(midi.timeDivision).toBe(RECORD_PPQ)
    const notes = midi.tracks.flatMap((t) => t.events.filter((e) => e.statusByte === 0x90))
    expect(notes.map((n) => n.data[0])).toEqual([60, 64])
  })

  it('take export survives a full inspect round-trip with no warnings', () => {
    const r = recorderWithEvents([
      [0, [0x90, 60, 100]],
      [500, [0x80, 60, 64]],
    ])
    const info = inspectMidi(takeToMidi(r.stop(T0 + 500)))
    expect(info.format).toBe(0)
    expect(info.hangingNotes).toBe(0)
    expect(info.warnings).toEqual([])
  })
})
