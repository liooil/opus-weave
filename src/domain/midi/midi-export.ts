/**
 * midi-export — build a Standard MIDI File (Type 1) from a CompositionSpec.
 *
 * Uses spessasynth_core's MIDIBuilder for binary encoding; all semantic
 * placement (tempo map, time signature, program changes, CC, pitch bend,
 * note on/off pairs) lives here so CLI, MCP and GUI share one exporter.
 */
import { MIDIBuilder, MIDIMessageType } from 'spessasynth_core'
import { OpusWeaveError } from '../../shared/errors.ts'
import {
  DEFAULT_PPQ,
  resolveTrackChannel,
  type CompositionSpec,
  type CompositionTrack,
} from '../composition/composition-spec.ts'
import { formatIssues, validateCompositionSpec } from '../composition/validation.ts'
import { TempoMap } from '../composition/tempo-map.ts'

export const TIME_SIGNATURE_META = 0x58
export const SET_TEMPO_META = 0x51

/**
 * Validate and encode a composition as an SMF Type 1 file.
 * Throws OpusWeaveError('invalid-spec') when validation fails.
 */
export function buildMidi(spec: CompositionSpec): ArrayBuffer {
  const { errors, warnings } = validateCompositionSpec(spec)
  if (errors.length > 0) {
    throw new OpusWeaveError('invalid-spec', `invalid composition spec: ${formatIssues(errors)}`, errors.map((e) => `${e.field}: ${e.message}`))
  }

  const ppq = spec.ppq ?? DEFAULT_PPQ
  const defaultTempo = spec.tempos?.[0]?.bpm ?? 120
  const tempoMap = new TempoMap({ ppq, tempos: spec.tempos, timeSignatures: spec.timeSignatures, defaultTempo })

  const builder = new MIDIBuilder({
    timeDivision: ppq,
    initialTempo: defaultTempo,
    format: 1,
    name: spec.title ?? 'Untitled',
  })

  // Track 0 is the conductor track the builder creates automatically:
  // tempo map + time signatures live here.
  for (const ts of tempoMap.timeSignatures) {
    // FF 58 04 nn dd cc bb; dd = log2(denominator)
    builder.addEvent(ts.tick, 0, TIME_SIGNATURE_META as MIDIMessageType, [
      ts.numerator,
      Math.log2(ts.denominator),
      0x18, // clocks per click (default)
      0x08, // 32nd notes per quarter (default)
    ])
  }
  // setTempo already writes the initial tempo; write the remaining changes.
  for (const t of tempoMap.tempos) {
    if (t.tick === 0) continue
    builder.setTempo(t.tick, t.bpm)
  }

  for (let i = 0; i < spec.tracks.length; i++) {
    writeTrack(builder, spec.tracks[i]!, i, tempoMap)
  }

  // Events must be in tick order before writing: writeMIDIInternal computes
  // deltas from the array order, so an out-of-order event would corrupt the
  // absolute timing of everything after it.
  builder.flush(true)
  return builder.writeMIDI()
}

function writeTrack(builder: MIDIBuilder, track: CompositionTrack, trackIndex: number, tempoMap: TempoMap): void {
  const trackNumber = trackIndex + 1 // 0 is the conductor track
  const channel = resolveTrackChannel(track, trackIndex)

  builder.addTrack(track.name, 0)

  if (track.program !== undefined) {
    builder.programChange(0, trackNumber, channel, track.program)
  }
  if (track.volume !== undefined) {
    builder.controllerChange(0, trackNumber, channel, 7, track.volume)
  }
  if (track.pan !== undefined) {
    builder.controllerChange(0, trackNumber, channel, 10, track.pan)
  }

  for (const cc of track.controlChanges ?? []) {
    builder.controllerChange(tempoMap.beatToTick(cc.beat), trackNumber, channel, cc.controller, cc.value)
  }
  for (const pb of track.pitchBends ?? []) {
    builder.pitchWheel(tempoMap.beatToTick(pb.beat), trackNumber, channel, pb.value)
  }
  for (const note of track.notes) {
    const startTick = tempoMap.beatToTick(note.startBeat)
    const endTick = tempoMap.beatToTick(note.startBeat + note.durationBeats)
    if (endTick <= startTick) {
      // durationBeats > 0 is enforced by validation; guard against float
      // rounding collapsing a tiny duration to zero ticks.
      continue
    }
    builder.noteOn(startTick, trackNumber, channel, note.pitch, note.velocity)
    builder.noteOff(endTick, trackNumber, channel, note.pitch)
  }
}
