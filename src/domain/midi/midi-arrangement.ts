import { BasicMIDI, MIDIMessage, MIDIMessageType } from 'spessasynth_core'
import { RECORD_PPQ, type RecordedTake } from './midi-recorder.ts'

export interface ArrangementNote {
  trackIndex: number
  channel: number
  note: number
  velocity: number
  startTick: number
  endTick: number
}

interface PairedNote extends ArrangementNote {
  onIndex: number
  offIndex: number | null
  onStatus: number
  offStatus: number
  offData: Uint8Array
}

function pairTrackNotes(midi: BasicMIDI, trackIndex: number): PairedNote[] {
  const track = midi.tracks[trackIndex]
  if (!track) return []
  const pending = new Map<string, Array<{ index: number; tick: number; status: number; velocity: number }>>()
  const notes: PairedNote[] = []
  const fallbackEnd = Math.max(midi.lastVoiceEventTick, 1)

  for (let index = 0; index < track.events.length; index++) {
    const event = track.events[index]!
    const kind = event.statusByte & 0xf0
    const channel = event.statusByte & 0x0f
    const note = event.data[0]
    if (note === undefined) continue
    const velocity = event.data[1] ?? 0
    const key = `${channel}:${note}`
    const isOn = kind === 0x90 && velocity > 0
    const isOff = kind === 0x80 || (kind === 0x90 && velocity === 0)

    if (isOn) {
      const queue = pending.get(key) ?? []
      queue.push({ index, tick: event.ticks, status: event.statusByte, velocity })
      pending.set(key, queue)
    } else if (isOff) {
      const queue = pending.get(key)
      const start = queue?.shift()
      if (!start) continue
      if (queue?.length === 0) pending.delete(key)
      notes.push({
        trackIndex,
        channel,
        note,
        velocity: start.velocity,
        startTick: start.tick,
        endTick: Math.max(start.tick + 1, event.ticks),
        onIndex: start.index,
        offIndex: index,
        onStatus: start.status,
        offStatus: event.statusByte,
        offData: Uint8Array.from(event.data),
      })
    }
  }

  for (const [key, queue] of pending) {
    const [channel, note] = key.split(':').map(Number)
    for (const start of queue) {
      notes.push({
        trackIndex,
        channel: channel!,
        note: note!,
        velocity: start.velocity,
        startTick: start.tick,
        endTick: Math.max(start.tick + 1, fallbackEnd),
        onIndex: start.index,
        offIndex: null,
        onStatus: start.status,
        offStatus: 0x80 | channel!,
        offData: new Uint8Array([note!, 0x40]),
      })
    }
  }

  return notes.sort((left, right) => left.startTick - right.startTick || left.note - right.note)
}

export function getArrangementNotes(midi: BasicMIDI, trackIndex: number): ArrangementNote[] {
  return pairTrackNotes(midi, trackIndex).map(({ onIndex: _on, offIndex: _off, onStatus: _status, offStatus: _offStatus, offData: _offData, ...note }) => note)
}

function message(ticks: number, status: number, data: ArrayLike<number>): MIDIMessage {
  return new MIDIMessage(ticks, status as MIDIMessageType, Uint8Array.from(data))
}

export function replaceArrangementRange(
  midi: BasicMIDI,
  options: {
    trackIndex: number
    startTick: number
    endTick: number
    take?: RecordedTake | null
    /** Wall-clock length represented by the selected range. */
    selectionDurationMs?: number
  },
): BasicMIDI {
  const { trackIndex } = options
  const startTick = Math.max(0, Math.round(options.startTick))
  const endTick = Math.max(startTick + 1, Math.round(options.endTick))
  if (!midi.tracks[trackIndex]) throw new RangeError(`Track ${trackIndex} does not exist`)

  const copy = BasicMIDI.copyFrom(midi)
  const track = copy.tracks[trackIndex]!
  const pairedNotes = pairTrackNotes(copy, trackIndex)
  const deleteIndexes = new Set<number>()
  const pairedIndexes = new Set<number>()
  const additions: MIDIMessage[] = []

  for (const note of pairedNotes) {
    pairedIndexes.add(note.onIndex)
    if (note.offIndex !== null) pairedIndexes.add(note.offIndex)
    if (note.startTick >= endTick || note.endTick <= startTick) continue

    deleteIndexes.add(note.onIndex)
    if (note.offIndex !== null) deleteIndexes.add(note.offIndex)

    if (note.startTick < startTick) {
      additions.push(message(note.startTick, note.onStatus, [note.note, note.velocity]))
      additions.push(message(startTick, 0x80 | note.channel, [note.note, 0x40]))
    }
    if (note.endTick > endTick) {
      additions.push(message(endTick, note.onStatus, [note.note, note.velocity]))
      additions.push(message(note.endTick, note.offStatus, note.offData))
    }
  }

  for (let index = 0; index < track.events.length; index++) {
    if (pairedIndexes.has(index)) continue
    const event = track.events[index]!
    const isChannelMessage = event.statusByte >= 0x80 && event.statusByte < 0xf0
    if (isChannelMessage && event.ticks >= startTick && event.ticks < endTick) deleteIndexes.add(index)
  }

  for (const index of [...deleteIndexes].sort((left, right) => right - left)) track.deleteEvent(index)
  const endOfTrackIndex = track.events.findIndex((event) => event.statusByte === 0x2f)
  if (endOfTrackIndex >= 0) track.deleteEvent(endOfTrackIndex)

  const take = options.take
  if (take) {
    const selectedTicks = endTick - startTick
    const selectionDurationMs = Math.max(1, options.selectionDurationMs ?? take.durationMs)
    for (const event of take.events) {
      const elapsedMs = (event.tick / RECORD_PPQ) * 500
      const relative = Math.max(0, Math.min(1, elapsedMs / selectionDurationMs))
      additions.push(message(startTick + Math.round(relative * selectedTicks), event.data[0]!, event.data.slice(1)))
    }
  }

  for (const event of additions) track.pushEvent(event)
  copy.flush(true)
  return copy
}
