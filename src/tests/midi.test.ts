/**
 * Unit tests for the core MIDI building logic.
 */
import { describe, it, expect } from 'bun:test'
import { buildMidi, BasicMIDI } from '../core/midi.ts'

describe('buildMidi', () => {
  it('creates a valid MIDI ArrayBuffer', () => {
    const buf = buildMidi({
      tempo: 120,
      name: 'Test',
      tracks: [
        {
          name: 'Piano',
          program: 0,
          notes: [
            { note: 60, velocity: 100, startBeat: 0, durationBeats: 1 },
            { note: 64, velocity: 90,  startBeat: 1, durationBeats: 1 },
            { note: 67, velocity: 80,  startBeat: 2, durationBeats: 1 },
          ],
        },
      ],
    })

    expect(buf).toBeInstanceOf(ArrayBuffer)
    expect(buf.byteLength).toBeGreaterThan(14) // at least a header chunk

    // Check it starts with "MThd"
    const view = new DataView(buf)
    expect(view.getUint8(0)).toBe(0x4d) // M
    expect(view.getUint8(1)).toBe(0x54) // T
    expect(view.getUint8(2)).toBe(0x68) // h
    expect(view.getUint8(3)).toBe(0x64) // d
  })

  it('produces a parseable MIDI file', () => {
    const buf = buildMidi({
      tempo: 90,
      name: 'Parseable',
      tracks: [
        {
          name: 'Track A',
          channel: 0,
          program: 48,
          notes: [
            { note: 48, velocity: 64, startBeat: 0, durationBeats: 2 },
          ],
        },
        {
          name: 'Track B',
          channel: 1,
          program: 24,
          notes: [
            { note: 72, velocity: 80, startBeat: 0.5, durationBeats: 0.5 },
          ],
        },
      ],
    })

    // Must not throw
    const midi = BasicMIDI.fromArrayBuffer(buf, 'test.mid')
    expect(midi.format).toBe(1)
    // Conductor track (index 0) + 2 user tracks
    expect(midi.tracks.length).toBe(3)
    expect(midi.duration).toBeGreaterThan(0)
  })

  it('respects custom tempo and timeDivision', () => {
    const buf = buildMidi({
      tempo: 200,
      timeDivision: 960,
      name: 'Fast',
      tracks: [
        {
          name: 'Fast track',
          notes: [{ note: 60, velocity: 100, startBeat: 0, durationBeats: 1 }],
        },
      ],
    })

    const midi = BasicMIDI.fromArrayBuffer(buf)
    expect(midi.timeDivision).toBe(960)
  })

  it('handles an empty track list gracefully', () => {
    const buf = buildMidi({ tracks: [] })
    expect(buf.byteLength).toBeGreaterThan(0)
    const midi = BasicMIDI.fromArrayBuffer(buf)
    // only the conductor (tempo) track
    expect(midi.tracks.length).toBeGreaterThanOrEqual(1)
  })
})
