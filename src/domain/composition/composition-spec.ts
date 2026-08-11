/**
 * CompositionSpec — OpusWeave's structured input model for creating MIDI.
 *
 * This is an AI/API input model only. It is NOT a new musical notation
 * standard: the persistent output format is Standard MIDI File (SMF).
 *
 * All numbers are validated at runtime before use (see validation.ts).
 */

export interface CompositionNote {
  /** Start time in quarter-note beats. Must be >= 0. */
  startBeat: number
  /** Duration in quarter-note beats. Must be > 0. */
  durationBeats: number
  /** MIDI note number 0–127. */
  pitch: number
  /** Velocity 1–127. */
  velocity: number
}

export interface ControlChangeEvent {
  /** Time in quarter-note beats. Must be >= 0. */
  beat: number
  /** MIDI controller number 0–127. */
  controller: number
  /** Controller value 0–127. */
  value: number
}

export interface PitchBendEvent {
  /** Time in quarter-note beats. Must be >= 0. */
  beat: number
  /** 14-bit pitch wheel value 0–16383, center 8192. */
  value: number
}

export interface ProgramChangeEvent {
  /** Time in quarter-note beats. Must be >= 0. */
  beat: number
  /** GM program number 0–127. */
  program: number
}

export interface CompositionTrack {
  /** Track name (MIDI track-name meta event). */
  name: string
  /** MIDI channel 0–15. Defaults to the track index (capped at 15) when omitted. */
  channel?: number
  /** GM program number 0–127. */
  program?: number
  /** Track volume 0–127, emitted as CC7 at the start of the track. */
  volume?: number
  /** Track pan 0–127 (64 = center), emitted as CC10 at the start of the track. */
  pan?: number
  notes: CompositionNote[]
  controlChanges?: ControlChangeEvent[]
  pitchBends?: PitchBendEvent[]
  programChanges?: ProgramChangeEvent[]
}


export interface TimeSignatureEvent {
  /** Time in quarter-note beats. Must be >= 0. */
  beat: number
  numerator: number
  /** Denominator as an integer (2, 4, 8, …). Must be a power of two. */
  denominator: number
}

export interface TempoEvent {
  /** Time in quarter-note beats. Must be >= 0. */
  beat: number
  /** Tempo in BPM. Must be > 0. */
  bpm: number
}

export interface KeySignatureEvent {
  /** Time in quarter-note beats. Must be >= 0. */
  beat: number
  /** Tonic using C, F#, Bb, and similar spellings. */
  tonic: string
  mode: 'major' | 'minor'
}

export interface CompositionSpec {
  /** Sequence title. */
  title?: string
  /** Ticks per quarter note. Default 480. */
  ppq?: number
  timeSignatures?: TimeSignatureEvent[]
  tempos?: TempoEvent[]
  keySignatures?: KeySignatureEvent[]
  tracks: CompositionTrack[]
}

export const DEFAULT_PPQ = 480
export const DEFAULT_TEMPO_BPM = 120
export const MAX_CHANNEL = 15

/** Defaults applied at export time for fields the caller may omit. */
export function resolveTrackChannel(track: CompositionTrack, trackIndex: number): number {
  return track.channel ?? Math.min(trackIndex, MAX_CHANNEL)
}
