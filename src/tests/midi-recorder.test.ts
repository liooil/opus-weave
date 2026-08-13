import { describe, it, expect } from 'bun:test'
import { MidiRecorder, takeToMidi, RECORD_PPQ } from '../domain/midi/midi-recorder.ts'
import { importMidi, inspectMidi } from '../domain/midi/midi-import.ts'
import { getArrangementNotes } from '../domain/midi/midi-arrangement.ts'

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

  it('closes a repeated note at the second Note On tick without a zero-length note', () => {
    const r = recorderWithEvents([
      [0, [0x90, 60, 100]],
      [200, [0x90, 60, 100]],
      [400, [0x80, 60, 64]],
    ])
    const take = r.stop(T0 + 400)
    expect(take.events.map((event) => ({
      kind: event.data[0]! & 0xf0,
      tick: event.tick,
    }))).toEqual([
      { kind: 0x90, tick: 0 },
      { kind: 0x80, tick: 192 },
      { kind: 0x90, tick: 192 },
      { kind: 0x80, tick: 384 },
    ])
    const midi = importMidi(takeToMidi(take))
    const notes = midi.tracks.flatMap((_, index) => getArrangementNotes(midi, index))
    expect(notes.map((note) => [note.startTick, note.endTick])).toEqual([[0, 192], [192, 384]])
    expect(notes.every((note) => note.endTick > note.startTick)).toBe(true)
  })

  it('closes a hanging note at the stop tick', () => {
    const r = recorderWithEvents([[0, [0x90, 60, 100]]])
    const take = r.stop(T0 + 1000)
    const off = take.events.find((event) => (event.data[0]! & 0xf0) === 0x80)
    expect(off?.tick).toBe(960)
    const midi = importMidi(takeToMidi(take))
    const note = midi.tracks.flatMap((_, index) => getArrangementNotes(midi, index))[0]
    expect([note?.startTick, note?.endTick]).toEqual([0, 960])
  })

  it('closes a hanging note at the device disconnect tick', () => {
    const r = recorderWithEvents([[0, [0x91, 64, 90]]])
    r.stopHeldNotes(T0 + 375)
    const take = r.stop(T0 + 500)
    const off = take.events.find((event) => (event.data[0]! & 0xf0) === 0x80)
    expect(off?.tick).toBe(360)
    expect([...off!.data]).toEqual([0x81, 64, 0x40])
    expect(take.events.filter((event) => (event.data[0]! & 0xf0) === 0x80)).toHaveLength(1)
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
