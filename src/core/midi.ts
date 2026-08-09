/**
 * OpusWeave core MIDI logic — shared between GUI, CLI, and MCP.
 * Uses spessasynth_core's MIDIBuilder for constructing MIDI files.
 */
import { MIDIBuilder } from 'spessasynth_core'

export interface NoteInput {
  /** MIDI note number 0–127 */
  note: number
  /** MIDI velocity 1–127 */
  velocity: number
  /** Start time in quarter-note beats (e.g. 0, 1, 1.5) */
  startBeat: number
  /** Duration in quarter-note beats */
  durationBeats: number
  /** MIDI channel 0–15 (default 0) */
  channel?: number
}

export interface TrackInput {
  name: string
  /** GM program number 0–127 */
  program?: number
  /** MIDI channel to use for all notes (default: track index, capped at 15) */
  channel?: number
  notes: NoteInput[]
}

export interface CreateMidiOptions {
  /** BPM tempo (default 120) */
  tempo?: number
  /** Ticks per quarter note (default 480) */
  timeDivision?: number
  /** MIDI file name / title */
  name?: string
  tracks: TrackInput[]
}

/**
 * Build a Standard MIDI File (Type 1) from structured options.
 * Returns an ArrayBuffer with the raw .mid data.
 */
export function buildMidi(options: CreateMidiOptions): ArrayBuffer {
  const {
    tempo = 120,
    timeDivision = 480,
    name = 'Untitled',
    tracks,
  } = options

  const builder = new MIDIBuilder({ timeDivision, initialTempo: tempo, format: 1, name })

  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i]!
    const channel = track.channel ?? Math.min(i, 15)
    builder.addTrack(track.name, 0)
    const trackIndex = i + 1 // track 0 is the conductor track

    if (track.program !== undefined) {
      builder.programChange(0, trackIndex, channel, track.program)
    }

    for (const note of track.notes) {
      const startTick = Math.round(note.startBeat * timeDivision)
      const endTick = Math.round((note.startBeat + note.durationBeats) * timeDivision)
      const ch = note.channel ?? channel
      builder.noteOn(startTick, trackIndex, ch, note.note, note.velocity)
      builder.noteOff(endTick, trackIndex, ch, note.note)
    }
  }

  return builder.writeMIDI()
}

/**
 * Parse a Standard MIDI File from an ArrayBuffer.
 * Re-exports BasicMIDI.fromArrayBuffer for use in the server / CLI.
 */
export { BasicMIDI } from 'spessasynth_core'
