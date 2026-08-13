import { BasicMIDI } from 'spessasynth_core'

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
      })
    }
  }

  return notes.sort((left, right) => left.startTick - right.startTick || left.note - right.note)
}

export function getArrangementNotes(midi: BasicMIDI, trackIndex: number): ArrangementNote[] {
  return pairTrackNotes(midi, trackIndex).map(({ onIndex: _on, offIndex: _off, ...note }) => note)
}
