import { describe, expect, test } from 'bun:test'
import { buildMidi } from '../domain/midi/midi-export.ts'
import { importMidi } from '../domain/midi/midi-import.ts'
import { getArrangementNotes, replaceArrangementRange } from '../domain/midi/midi-arrangement.ts'
import type { RecordedTake } from '../domain/midi/midi-recorder.ts'

describe('MIDI arrangement range editing', () => {
  const source = () => importMidi(buildMidi({
    ppq: 480,
    tempos: [{ beat: 0, bpm: 120 }],
    tracks: [{
      name: 'Lead',
      channel: 0,
      notes: [
        { pitch: 60, velocity: 90, startBeat: 0, durationBeats: 4 },
        { pitch: 64, velocity: 80, startBeat: 1, durationBeats: 1 },
      ],
    }],
  }))

  test('silences a selected range and splits notes crossing both boundaries', () => {
    const edited = replaceArrangementRange(source(), {
      trackIndex: 1,
      startTick: 480,
      endTick: 1440,
    })

    expect(getArrangementNotes(edited, 1)).toEqual([
      { trackIndex: 1, channel: 0, note: 60, velocity: 90, startTick: 0, endTick: 480 },
      { trackIndex: 1, channel: 0, note: 60, velocity: 90, startTick: 1440, endTick: 1920 },
    ])
    expect(() => importMidi(edited.writeMIDI())).not.toThrow()
  })

  test('maps a live take into the selected track range', () => {
    const take: RecordedTake = {
      durationMs: 1000,
      events: [
        { tick: 0, data: new Uint8Array([0x90, 67, 100]) },
        { tick: 480, data: new Uint8Array([0x80, 67, 0x40]) },
      ],
    }
    const edited = replaceArrangementRange(source(), {
      trackIndex: 1,
      startTick: 480,
      endTick: 1440,
      selectionDurationMs: 1000,
      take,
    })

    expect(getArrangementNotes(edited, 1)).toContainEqual({
      trackIndex: 1,
      channel: 0,
      note: 67,
      velocity: 100,
      startTick: 480,
      endTick: 960,
    })
  })
})
