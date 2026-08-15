import type { OwtScore, OwtScoreTrack, ScoreEvent } from './ast.ts'
import { addRational, compareRational, ZERO, type Rational } from './rational.ts'

function eventDuration(event: ScoreEvent): Rational | undefined {
  return event.kind === 'note' || event.kind === 'rest' ? event.duration : undefined
}

function eventEnd(event: ScoreEvent): Rational {
  const duration = eventDuration(event)
  return duration ? addRational(event.at, duration) : event.at
}

function trackEnd(track: OwtScoreTrack): Rational {
  return track.events.reduce((end, event) => compareRational(eventEnd(event), end) > 0 ? eventEnd(event) : end, ZERO)
}

function scoreEnd(score: OwtScore): Rational {
  return score.tracks.reduce((end, track) => compareRational(trackEnd(track), end) > 0 ? trackEnd(track) : end, ZERO)
}

function voiceEvents(track: OwtScoreTrack): ScoreEvent[] {
  return track.events.filter((event) => event.kind === 'note' || event.kind === 'rest')
}

function eventEqual(left: ScoreEvent, right: ScoreEvent): boolean {
  if (left.kind !== right.kind || compareRational(left.at, right.at) !== 0) return false
  if (left.kind === 'note' && right.kind === 'note') {
    return compareRational(left.duration, right.duration) === 0
      && left.pitches.length === right.pitches.length
      && left.pitches.every((pitch, index) => pitch === right.pitches[index])
  }
  if (left.kind === 'rest' && right.kind === 'rest') return compareRational(left.duration, right.duration) === 0
  return left.kind === right.kind
}

function matchingTrack(tracks: readonly OwtScoreTrack[], target: OwtScoreTrack, fallbackIndex: number, used: Set<OwtScoreTrack>): OwtScoreTrack | undefined {
  const exact = tracks.find((track) => !used.has(track) && track.name === target.name && track.channel === target.channel)
  if (exact) return exact
  const channel = tracks.find((track) => !used.has(track) && track.channel === target.channel)
  if (channel) return channel
  const fallback = tracks[fallbackIndex]
  return fallback && !used.has(fallback) ? fallback : undefined
}

function hasScorePrefix(base: OwtScore, candidate: OwtScore): boolean {
  // A streamed full-score response may not have emitted all of the user's
  // events yet. Compare the events that are available in either direction so
  // that such a prefix remains attached to the base score instead of being
  // shifted and appended a second time as a fragment.
  const used = new Set<OwtScoreTrack>()
  let matched = 0
  for (let index = 0; index < candidate.tracks.length; index++) {
    const candidateTrack = candidate.tracks[index]!
    const baseTrack = matchingTrack(base.tracks, candidateTrack, index, used)
    if (!baseTrack) continue
    used.add(baseTrack)
    const baseVoice = voiceEvents(baseTrack)
    const candidateVoice = voiceEvents(candidateTrack)
    const shared = Math.min(baseVoice.length, candidateVoice.length)
    for (let eventIndex = 0; eventIndex < shared; eventIndex++) {
      if (!eventEqual(baseVoice[eventIndex]!, candidateVoice[eventIndex]!)) return false
    }
    matched++
  }
  return matched > 0
}

function shiftedEvent(event: ScoreEvent, offset: Rational): ScoreEvent {
  return { ...event, at: addRational(event.at, offset), line: 0, column: 0 }
}

function copyTrack(track: OwtScoreTrack, events = track.events): OwtScoreTrack {
  return { ...track, events: events.map((event) => ({ ...event, line: 0, column: 0 })) }
}

function appendCombinedScore(base: OwtScore, candidate: OwtScore): OwtScore {
  const baseEnd = scoreEnd(base)
  const tracks = base.tracks.map((track) => copyTrack(track))
  const used = new Set<OwtScoreTrack>()

  for (let index = 0; index < candidate.tracks.length; index++) {
    const candidateTrack = candidate.tracks[index]!
    const baseTrack = matchingTrack(base.tracks, candidateTrack, index, used)
    if (baseTrack) {
      used.add(baseTrack)
      const target = tracks[base.tracks.indexOf(baseTrack)]!
      const offset = trackEnd(baseTrack)
      target.events.push(...candidateTrack.events
        .filter((event) => compareRational(event.at, offset) >= 0)
        .map((event) => ({ ...event, line: 0, column: 0 })))
      continue
    }
    const tail = candidateTrack.events.filter((event) => compareRational(event.at, baseEnd) >= 0)
    if (tail.length > 0) tracks.push(copyTrack(candidateTrack, tail))
  }
  return { ...base, tracks }
}

function appendFragmentScore(base: OwtScore, fragment: OwtScore): OwtScore {
  const offset = scoreEnd(base)
  const tracks = base.tracks.map((track) => copyTrack(track))
  const used = new Set<OwtScoreTrack>()
  for (let index = 0; index < fragment.tracks.length; index++) {
    const fragmentTrack = fragment.tracks[index]!
    const baseTrack = matchingTrack(base.tracks, fragmentTrack, index, used)
    if (baseTrack) {
      used.add(baseTrack)
      tracks[base.tracks.indexOf(baseTrack)]!.events.push(...fragmentTrack.events.map((event) => shiftedEvent(event, offset)))
    } else {
      tracks.push(copyTrack(fragmentTrack, fragmentTrack.events.map((event) => shiftedEvent(event, offset))))
    }
  }
  return { ...base, tracks }
}

/**
 * Keep the user's score as the source of truth, then append either the tail of
 * an AI response that already contains that score or a response fragment.
 */
export function appendOwtScores(base: OwtScore | undefined, response: OwtScore): OwtScore {
  if (!base) return response
  return hasScorePrefix(base, response) ? appendCombinedScore(base, response) : appendFragmentScore(base, response)
}

/**
 * Append one newly performed track after the end of the current combined
 * score. Conversational improv uses this for the human phrase so repeated or
 * abbreviated phrases can never be mistaken for a streamed full-score prefix.
 */
export function appendOwtTrack(base: OwtScore | undefined, track: OwtScore): OwtScore {
  if (!base) return track
  if (track.tracks.length !== 1) throw new Error('appendOwtTrack expects a single-track OWT score')
  const sourceTrack = track.tracks[0]!
  const offset = scoreEnd(base)
  const tracks = base.tracks.map((item) => copyTrack(item))
  const targetIndex = base.tracks.findIndex((item) => item.name === sourceTrack.name && item.channel === sourceTrack.channel)
  const shifted = sourceTrack.events.map((event) => shiftedEvent(event, offset))
  if (targetIndex >= 0) tracks[targetIndex]!.events.push(...shifted)
  else tracks.push(copyTrack(sourceTrack, shifted))
  return { ...base, tracks }
}

/**
 * Write a newly performed phrase into the first (human) track of the fixed
 * two-track improvisation score. The first phrase also establishes the human
 * track identity; the second track is always reserved for the AI response.
 */
export function appendOwtUserTrack(base: OwtScore, phrase: OwtScore): OwtScore {
  if (phrase.tracks.length !== 1) throw new Error('appendOwtUserTrack expects a single-track OWT score')
  const source = phrase.tracks[0]!
  const human = base.tracks[0] ? copyTrack(base.tracks[0]!) : copyTrack(source)
  if (human.events.length === 0) {
    human.channel = source.channel
    human.program = source.program
    human.velocity = source.velocity
  }
  const ai = base.tracks[1] ? copyTrack(base.tracks[1]!) : {
    name: 'AI Response',
    channel: human.channel === 16 ? 1 : human.channel + 1,
    program: 0,
    velocity: 88,
    events: [],
  }
  if (ai.events.length === 0 && ai.channel === human.channel) ai.channel = human.channel === 16 ? 1 : human.channel + 1
  const offset = scoreEnd(base)
  human.events.push(...source.events.map((event) => shiftedEvent(event, offset)))
  return { ...base, tracks: [human, ai] }
}
