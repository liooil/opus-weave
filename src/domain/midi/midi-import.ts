/**
 * midi-import — parse an SMF and produce a structured inspection.
 *
 * Shared by the CLI `inspect-midi` command, the MCP `inspect_midi` tool and
 * the GUI (track list, mute mapping). Corrupt files surface as
 * OpusWeaveError('midi-corrupt') instead of raw parser exceptions.
 */
import { BasicMIDI } from 'spessasynth_core'
import { OpusWeaveError } from '../../shared/errors.ts'
import { TempoMap } from '../composition/tempo-map.ts'

export interface TrackInspection {
  index: number
  name: string
  channels: number[]
  /** First program change seen (null when the track has none). */
  program: number | null
  noteCount: number
  minNote: number | null
  maxNote: number | null
  hasControlChanges: boolean
  hasPitchBend: boolean
}

export interface MidiInspection {
  format: number
  ppq: number
  durationSeconds: number
  durationBeats: number
  trackCount: number
  tracks: TrackInspection[]
  tempos: Array<{ tick: number; bpm: number }>
  timeSignatures: Array<{ tick: number; numerator: number; denominator: number }>
  /** Note-ons without a matching note-off; reported as a warning. */
  hangingNotes: number
  warnings: string[]
}

const STATUS_NOTE_ON = 0x90
const STATUS_NOTE_OFF = 0x80
const STATUS_CC = 0xb0
const STATUS_PITCH_BEND = 0xe0
const STATUS_PROGRAM = 0xc0

/** Parse an SMF ArrayBuffer into a BasicMIDI, mapping parse failures to a domain error. */
export function importMidi(data: ArrayBuffer, fileName?: string): BasicMIDI {
  try {
    return BasicMIDI.fromArrayBuffer(data, fileName)
  } catch (err) {
    throw new OpusWeaveError('midi-corrupt', `could not parse MIDI file: ${err instanceof Error ? err.message : String(err)}`)
  }
}

export function createMidiTempoMap(midi: BasicMIDI): TempoMap {
  const ppq = midi.timeDivision || 480
  // Read the real set-tempo meta events directly. spessasynth's `tempoChanges`
  // always prepends a synthesized `{tick: 0, tempo: 120}` entry, so deriving the
  // map from it would report 120 for any file whose actual first tempo differs.
  const tempos: Array<{ tick: number; bpm: number }> = []
  for (const track of midi.tracks) {
    for (const event of track.events) {
      if (event.statusByte !== 0x51 || event.data.length < 3) continue
      const microseconds = (event.data[0]! << 16) | (event.data[1]! << 8) | event.data[2]!
      tempos.push({ tick: event.ticks, bpm: 60_000_000 / microseconds })
    }
  }
  tempos.sort((a, b) => a.tick - b.tick)
  return new TempoMap({
    ppq,
    tempos: tempos.map((tempo) => ({ beat: tempo.tick / ppq, bpm: tempo.bpm })),
    defaultTempo: 120,
  })
}

export function inspectMidi(data: ArrayBuffer, fileName?: string): MidiInspection {
  const midi = importMidi(data, fileName)
  const ppq = midi.timeDivision || 480
  const tempoMap = createMidiTempoMap(midi)

  const tracks: TrackInspection[] = []
  let hangingNotes = 0
  const warnings: string[] = []

  // Time signature meta events (FF 58 04 nn dd cc bb), any track.
  const timeSignatures: Array<{ tick: number; numerator: number; denominator: number }> = []
  for (const track of midi.tracks) {
    for (const ev of track.events) {
      if (ev.statusByte !== 0x58 || ev.data.length < 2) continue
      const denominator = Math.pow(2, ev.data[1]!)
      if (Number.isInteger(denominator) && denominator >= 1) {
        timeSignatures.push({ tick: ev.ticks, numerator: ev.data[0]!, denominator })
      }
    }
  }
  timeSignatures.sort((a, b) => a.tick - b.tick)

  // Track per-channel note state to detect hanging notes. Implicit note-offs
  // at end-of-track are expected in real files, so a hanging count is a
  // warning, not an error.
  const activeNotes = new Map<string, number>() // `${track}:${ch}:${note}` -> count
  const countNote = (key: string, on: boolean): void => {
    const cur = activeNotes.get(key) ?? 0
    if (on) activeNotes.set(key, cur + 1)
    else if (cur > 1) activeNotes.set(key, cur - 1)
    else activeNotes.delete(key)
  }

  for (let i = 0; i < midi.tracks.length; i++) {
    const track = midi.tracks[i]!
    const channels = new Set<number>()
    let program: number | null = null
    let noteCount = 0
    let minNote = Infinity
    let maxNote = -Infinity
    let hasCC = false
    let hasPB = false

    for (const ev of track.events) {
      const status = ev.statusByte & 0xf0
      const ch = ev.statusByte & 0x0f
      // Only channel voice messages (0x80–0xEF) carry a channel; meta events
      // (0xFF-encoded with a sub-status < 0xF0) must not pollute the set.
      if (ev.statusByte >= 0x80 && ev.statusByte < 0xf0) channels.add(ch)
      if (status === STATUS_PROGRAM) {
        program = ev.data[0] ?? null
      } else if (status === STATUS_CC) {
        hasCC = true
      } else if (status === STATUS_PITCH_BEND) {
        hasPB = true
      } else if (status === STATUS_NOTE_ON) {
        // parsed data = [note, velocity] (2 bytes)
        const vel = ev.data[1] ?? 0
        const note = ev.data[0] ?? 0
        if (vel > 0) {
          noteCount++
          minNote = Math.min(minNote, note)
          maxNote = Math.max(maxNote, note)
          countNote(`${i}:${ch}:${note}`, true)
        } else {
          countNote(`${i}:${ch}:${note}`, false)
        }
      } else if (status === STATUS_NOTE_OFF) {
        countNote(`${i}:${ch}:${ev.data[0] ?? 0}`, false)
      }
    }

    tracks.push({
      index: i,
      name: track.name,
      channels: [...channels].sort((a, b) => a - b),
      program,
      noteCount,
      minNote: noteCount > 0 ? minNote : null,
      maxNote: noteCount > 0 ? maxNote : null,
      hasControlChanges: hasCC,
      hasPitchBend: hasPB,
    })
  }

  hangingNotes = activeNotes.size
  if (hangingNotes > 0) {
    warnings.push(`${hangingNotes} hanging note-on event(s) without a matching note-off (implicit end-of-track note-offs are normal)`)
  }

  const durationBeats = midi.lastVoiceEventTick > 0 ? midi.lastVoiceEventTick / ppq : tempoMap.tickToSeconds(midi.duration * ppq)

  return {
    format: midi.format,
    ppq,
    durationSeconds: Number(midi.duration.toFixed(3)),
    durationBeats: Number(durationBeats.toFixed(3)),
    trackCount: midi.tracks.length,
    tracks,
    tempos: tempoMap.tempos.map((t) => ({ tick: t.tick, bpm: Math.round(t.bpm * 1000) / 1000 })),
    timeSignatures,
    hangingNotes,
    warnings,
  }
}

/** Applied mutes: strip all events of muted tracks from a copy of the MIDI. */
export function applyTrackMutes(midi: BasicMIDI, mutedTrackIndexes: ReadonlySet<number>): BasicMIDI {
  if (mutedTrackIndexes.size === 0) return midi
  const copy = BasicMIDI.copyFrom(midi)
  for (let i = 0; i < copy.tracks.length; i++) {
    if (mutedTrackIndexes.has(i)) {
      const track = copy.tracks[i]!
      // Keep only the end-of-track marker so the chunk stays valid.
      for (let j = track.events.length - 1; j >= 0; j--) {
        if (track.events[j]!.statusByte !== 0x2f) track.deleteEvent(j)
      }
    }
  }
  copy.flush(true)
  return copy
}
