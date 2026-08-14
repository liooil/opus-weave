import type { OwtScore, OwtScoreTrack, OwtDocument, ScoreEvent } from './ast.ts'
import { parseOwt } from './parser.ts'
import { addRational, compareRational, ZERO, type Rational } from './rational.ts'

export interface CompleteOwtPrefix {
  text: string
  document: OwtDocument
}

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

function canonicalCandidate(raw: string): CompleteOwtPrefix | undefined {
  const trimmed = raw.trim()
  if (!trimmed) return undefined
  const lines = trimmed.split('\n')
  const endLine = lines.findIndex((line) => line.trim() === 'end')
  const text = endLine >= 0 ? lines.slice(0, endLine + 1).join('\n') : `${trimmed}\nend`
  const parsed = parseOwt(`${text.trim()}\n`)
  if (!parsed.document) return undefined
  const hasVoice = parsed.document.tracks.some((track) => voiceEvents(track).length > 0)
  return hasVoice ? { text: `${text.trim()}\n`, document: parsed.document } : undefined
}

/**
 * Find the newest complete OWT prefix in a streamed response. A score is
 * playable once a complete measure has arrived; the unfinished current line
 * is ignored until the next chunk closes it.
 */
export function completeOwtPrefix(text: string): CompleteOwtPrefix | undefined {
  const normalized = text.replace(/\r\n?/g, '\n')
  const start = normalized.indexOf('owt 0.1 score')
  if (start < 0) return undefined
  const scoreText = normalized.slice(start)
  const lines = scoreText.split('\n')
  for (let count = lines.length; count > 0; count--) {
    const candidate = canonicalCandidate(lines.slice(0, count).join('\n'))
    if (candidate) return candidate
  }
  return undefined
}
