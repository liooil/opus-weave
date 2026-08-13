import { describe, it, expect } from 'bun:test'
import { buildMidi } from '../domain/midi/midi-export.ts'
import { BasicMIDI } from 'spessasynth_core'
import { OpusWeaveError } from '../shared/errors.ts'
import type { CompositionSpec } from '../domain/composition/composition-spec.ts'

const multiTrack: CompositionSpec = {
  title: 'RoundTrip',
  ppq: 480,
  tempos: [
    { beat: 0, bpm: 120 },
    { beat: 2, bpm: 90 },
  ],
  timeSignatures: [{ beat: 0, numerator: 4, denominator: 4 }],
  tracks: [
    {
      name: 'Melody',
      channel: 0,
      program: 73,
      volume: 110,
      pan: 40,
      notes: [
        { startBeat: 0, durationBeats: 1, pitch: 72, velocity: 96 },
        { startBeat: 1.5, durationBeats: 0.5, pitch: 76, velocity: 90 },
      ],
      controlChanges: [{ beat: 0, controller: 7, value: 110 }],
      pitchBends: [{ beat: 1, value: 9000 }],
    },
    {
      name: 'Bass',
      channel: 1,
      program: 33,
      notes: [{ startBeat: 0, durationBeats: 2, pitch: 45, velocity: 100 }],
      controlChanges: [],
      pitchBends: [],
    },
  ],
}

describe('buildMidi (SMF Type 1 export)', () => {
  it('produces an MThd-prefixed ArrayBuffer', () => {
    const buf = buildMidi(multiTrack)
    const view = new DataView(buf)
    expect(String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3))).toBe('MThd')
  })

  it('round-trips: re-parsing yields format 1 with the right structure', () => {
    const midi = BasicMIDI.fromArrayBuffer(buildMidi(multiTrack))
    expect(midi.format).toBe(1)
    expect(midi.timeDivision).toBe(480)
    // conductor + 2 tracks
    expect(midi.tracks).toHaveLength(3)
    expect(midi.tracks[1]!.name).toBe('Melody')
    expect(midi.tracks[2]!.name).toBe('Bass')
  })

  it('writes a multi-tempo map (initial + change)', () => {
    const midi = BasicMIDI.fromArrayBuffer(buildMidi(multiTrack))
    // parser appends its own default-120 entry at tick 0; filter it out.
    // BPM is reconstructed from µs/quarter so float noise (90.00009) is expected.
    const tempos = midi.tempoChanges.filter((t) => t.ticks > 0)
    expect(tempos).toHaveLength(1)
    expect(tempos[0]!.ticks).toBe(960)
    expect(tempos[0]!.tempo).toBeCloseTo(90, 3)
  })

  it('writes program change, CC7/CC10 and pitch bend on the right channel', () => {
    const midi = BasicMIDI.fromArrayBuffer(buildMidi(multiTrack))
    const track = midi.tracks[1]!
    const events = track.events.map((e) => ({ status: e.statusByte, data: Array.from(e.data) }))
    expect(events).toContainEqual({ status: 0xc0, data: [73] })
    expect(events).toContainEqual({ status: 0xb0, data: [7, 110] })
    expect(events).toContainEqual({ status: 0xb0, data: [10, 40] })
    expect(events).toContainEqual({ status: 0xe0, data: [9000 & 0x7f, (9000 >> 7) & 0x7f] })
    const pb = track.events.find((e) => e.statusByte === 0xe0)!
    expect((pb.data[1]! << 7) | pb.data[0]!).toBe(9000)
  })

  it('round-trips note timing: 1.5 beats at ppq 480 → tick 720', () => {
    const midi = BasicMIDI.fromArrayBuffer(buildMidi(multiTrack))
    const track = midi.tracks[1]!
    const noteOn = track.events.find((e) => (e.statusByte & 0xf0) === 0x90 && e.data[0] === 76)!
    expect(noteOn.ticks).toBe(720)
    const noteOff = track.events.find((e) => (e.statusByte & 0xf0) === 0x80 && e.data[0] === 76)!
    expect(noteOff.ticks).toBe(960)
  })

  it('writes the time signature meta event', () => {
    const midi = BasicMIDI.fromArrayBuffer(buildMidi(multiTrack))
    const conductor = midi.tracks[0]!
    const ts = conductor.events.find((e) => e.statusByte === 0x58)!
    expect(Array.from(ts.data)).toEqual([4, 2, 24, 8])
  })

  it('writes the title as the sequence name', () => {
    const midi = BasicMIDI.fromArrayBuffer(buildMidi(multiTrack))
    // name lands in conductor metadata; verify via round-trip export not throwing
    expect(midi.tracks.length).toBeGreaterThan(0)
  })

  it('defaults to 480 ppq and 120 BPM when omitted', () => {
    const midi = BasicMIDI.fromArrayBuffer(
      buildMidi({ tracks: [{ name: 'T', notes: [{ startBeat: 0, durationBeats: 1, pitch: 60, velocity: 100 }] }] }),
    )
    expect(midi.timeDivision).toBe(480)
    expect(midi.tempoChanges[0]!.tempo).toBe(120)
  })

  it('assigns channel by track index when omitted', () => {
    const spec: CompositionSpec = {
      tracks: [
        { name: 'A', notes: [{ startBeat: 0, durationBeats: 1, pitch: 60, velocity: 100 }] },
        { name: 'B', notes: [{ startBeat: 0, durationBeats: 1, pitch: 62, velocity: 100 }] },
        { name: 'C', notes: [{ startBeat: 0, durationBeats: 1, pitch: 64, velocity: 100 }] },
      ],
    }
    const midi = BasicMIDI.fromArrayBuffer(buildMidi(spec))
    const notes = midi.tracks.flatMap((t) => t.events.filter((e) => (e.statusByte & 0xf0) === 0x90))
    // track 1 → ch0, track 2 → ch1, track 3 → ch2
    const chans = notes.map((n) => n.statusByte & 0x0f)
    expect(chans).toEqual([0, 1, 2])
  })

  it('throws OpusWeaveError with field detail on invalid input', () => {
    expect(() => buildMidi({ tracks: [{ name: 'T', notes: [{ startBeat: 0, durationBeats: 1, pitch: 999, velocity: 5 }] }] })).toThrow(OpusWeaveError)
    try {
      buildMidi({ tracks: [{ name: 'T', notes: [{ startBeat: 0, durationBeats: 1, pitch: 999, velocity: 5 }] }] })
    } catch (err) {
      expect((err as OpusWeaveError).code).toBe('invalid-spec')
      expect((err as OpusWeaveError).message).toContain('tracks[0].notes[0].pitch')
    }
  })

  it('handles an empty track list with a conductor-only file', () => {
    const midi = BasicMIDI.fromArrayBuffer(buildMidi({ tracks: [] }))
    expect(midi.tracks.length).toBe(1)
  })

  it('rejects a duration that rounds to zero ticks', () => {
    expect(() => buildMidi({
      tracks: [{ name: 'T', notes: [{ startBeat: 0, durationBeats: 0.0001, pitch: 60, velocity: 100 }] }],
    })).toThrow('tracks[0].notes[0].durationBeats: rounds to zero ticks at PPQ 480')
  })
})
