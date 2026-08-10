import { describe, it, expect } from 'bun:test'
import { buildMidi } from '../domain/midi/midi-export.ts'
import { importMidi, inspectMidi, applyTrackMutes } from '../domain/midi/midi-import.ts'
import { BasicMIDI } from 'spessasynth_core'
import { OpusWeaveError } from '../shared/errors.ts'

const spec = {
  title: 'InspectMe',
  ppq: 480,
  tempos: [
    { beat: 0, bpm: 120 },
    { beat: 1, bpm: 180 },
  ],
  timeSignatures: [{ beat: 0, numerator: 3, denominator: 8 }],
  tracks: [
    {
      name: 'Lead',
      channel: 0,
      program: 80,
      notes: [
        { startBeat: 0, durationBeats: 1, pitch: 60, velocity: 90 },
        { startBeat: 1, durationBeats: 1, pitch: 100, velocity: 90 },
      ],
      controlChanges: [{ beat: 0, controller: 64, value: 127 }],
      pitchBends: [{ beat: 0.5, value: 8192 }],
    },
  ],
}

describe('inspectMidi', () => {
  it('reports format, ppq, tracks, tempos and ranges', () => {
    const info = inspectMidi(buildMidi(spec))
    expect(info.format).toBe(1)
    expect(info.ppq).toBe(480)
    expect(info.trackCount).toBe(2)
    expect(info.tracks[1]).toMatchObject({
      name: 'Lead',
      channels: [0],
      program: 80,
      noteCount: 2,
      minNote: 60,
      maxNote: 100,
      hasControlChanges: true,
      hasPitchBend: true,
    })
    expect(info.tempos).toEqual([
      { tick: 0, bpm: 120 },
      { tick: 480, bpm: 180 },
    ])
    expect(info.timeSignatures).toEqual([{ tick: 0, numerator: 3, denominator: 8 }])
  })

  it('computes duration seconds from the tempo map', () => {
    // 1 beat @120 (0.5s) + 1 beat @180 (0.333s) ≈ 0.833s
    const info = inspectMidi(buildMidi(spec))
    expect(info.durationSeconds).toBeCloseTo(0.833, 2)
  })

  it('flags hanging notes (note-on without note-off)', () => {
    // Build a MIDI then drop the note-off via raw manipulation.
    const midi = BasicMIDI.fromArrayBuffer(buildMidi(spec))
    const track = midi.tracks[1]!
    const offIndex = track.events.findIndex((e) => e.statusByte === 0x80)
    track.deleteEvent(offIndex)
    midi.flush(true)
    const info = inspectMidi(midi.writeMIDI())
    expect(info.hangingNotes).toBeGreaterThan(0)
    expect(info.warnings.some((w) => w.includes('hanging'))).toBe(true)
  })

  it('reports empty tracks without notes cleanly', () => {
    const info = inspectMidi(buildMidi({ tracks: [{ name: 'Empty', notes: [], controlChanges: [], pitchBends: [] }] }))
    expect(info.tracks[1]!.noteCount).toBe(0)
    expect(info.tracks[1]!.minNote).toBeNull()
  })
})

describe('importMidi / corrupt files', () => {
  it('parses a valid file', () => {
    const midi = importMidi(buildMidi(spec), 'x.mid')
    expect(midi.format).toBe(1)
  })

  it('throws OpusWeaveError(midi-corrupt) for garbage bytes', () => {
    const garbage = new Uint8Array([0x4d, 0x54, 0x68, 0x64, 0xff, 0xff, 0xff, 0xff]).buffer
    expect(() => importMidi(garbage)).toThrow(OpusWeaveError)
    try {
      importMidi(garbage)
    } catch (err) {
      expect((err as OpusWeaveError).code).toBe('midi-corrupt')
    }
  })

  it('throws for truncated/empty buffers', () => {
    expect(() => importMidi(new ArrayBuffer(0))).toThrow(OpusWeaveError)
  })
})

describe('applyTrackMutes', () => {
  it('strips muted tracks from a copy without touching the original', () => {
    const original = BasicMIDI.fromArrayBuffer(buildMidi(spec))
    const muted = applyTrackMutes(original, new Set([1]))
    expect(original.tracks[1]!.events.filter((e) => e.statusByte === 0x90)).toHaveLength(2)
    expect(muted.tracks[1]!.events.filter((e) => e.statusByte === 0x90)).toHaveLength(0)
    // still a parseable file
    const reparsed = BasicMIDI.fromArrayBuffer(muted.writeMIDI())
    expect(reparsed.tracks).toHaveLength(2)
  })

  it('returns the same instance when nothing is muted', () => {
    const midi = BasicMIDI.fromArrayBuffer(buildMidi(spec))
    expect(applyTrackMutes(midi, new Set())).toBe(midi)
  })
})
