import { TempoMap } from '../composition/tempo-map.ts'
import type { OwtScore } from './ast.ts'
import { rationalToNumber } from './rational.ts'

export interface OwtSourceRange {
  start: number
  end: number
}

export interface OwtPlaybackToken extends OwtSourceRange {
  playbackId: string
  startSeconds: number
  endSeconds: number
}

function lineOffsets(text: string): number[] {
  const offsets = [0]
  for (let index = 0; index < text.length; index++) {
    if (text[index] === '\n') offsets.push(index + 1)
  }
  return offsets
}

function tokenEnd(text: string, start: number): number {
  const opening = text[start]
  if (opening === '<') {
    const close = text.indexOf('>', start + 1)
    return close < 0 ? text.length : close + 1
  }
  if (opening === '[') {
    const close = text.indexOf(']', start + 1)
    if (close < 0) return text.length
    let end = close + 1
    while (end < text.length && !/\s|\|/.test(text[end]!)) end++
    return end
  }
  let end = start
  while (end < text.length && !/\s|\|/.test(text[end]!)) end++
  return end
}

export function buildOwtPlaybackMap(text: string, score: OwtScore): OwtPlaybackToken[] {
  const offsets = lineOffsets(text)
  const tempoMap = new TempoMap({
    ppq: score.ppq,
    tempos: score.tempos.map((tempo) => ({ beat: rationalToNumber(tempo.at), bpm: tempo.bpm })),
    timeSignatures: score.meters.map((meter) => ({
      beat: rationalToNumber(meter.at),
      numerator: meter.numerator,
      denominator: meter.denominator,
    })),
    defaultTempo: score.tempos[0]?.bpm ?? 120,
  })
  const tokens: OwtPlaybackToken[] = []
  for (let trackIndex = 0; trackIndex < score.tracks.length; trackIndex++) {
    const track = score.tracks[trackIndex]!
    for (let eventIndex = 0; eventIndex < track.events.length; eventIndex++) {
      const event = track.events[eventIndex]!
      if (event.kind !== 'note' && event.kind !== 'rest') continue
      const lineStart = offsets[event.line - 1]
      if (lineStart === undefined || event.column < 1) continue
      const start = lineStart + event.column - 1
      const end = tokenEnd(text, start)
      if (end <= start) continue
      const startTick = tempoMap.beatToTick(rationalToNumber(event.at))
      const endTick = tempoMap.beatToTick(rationalToNumber(event.at) + rationalToNumber(event.duration))
      tokens.push({
        playbackId: `${trackIndex}:${eventIndex}`,
        start,
        end,
        startSeconds: tempoMap.tickToSeconds(startTick),
        endSeconds: tempoMap.tickToSeconds(endTick),
      })
    }
  }
  return tokens.sort((left, right) => left.startSeconds - right.startSeconds || left.start - right.start)
}

export function activeOwtSourceRanges(tokens: readonly OwtPlaybackToken[], seconds: number): OwtSourceRange[] {
  return tokens
    .filter((token) => seconds >= token.startSeconds && seconds < token.endSeconds)
    .map(({ start, end }) => ({ start, end }))
}

export function activeOwtPlaybackIds(tokens: readonly OwtPlaybackToken[], seconds: number): string[] {
  return tokens
    .filter((token) => seconds >= token.startSeconds && seconds < token.endSeconds)
    .map((token) => token.playbackId)
}

/** One cursor event per track at a playback position; active event wins, then next, then last. */
export function cursorOwtPlaybackTokens(tokens: readonly OwtPlaybackToken[], seconds: number): OwtPlaybackToken[] {
  const tracks = new Map<string, OwtPlaybackToken[]>()
  for (const token of tokens) {
    const track = token.playbackId.split(':', 1)[0]!
    tracks.set(track, [...(tracks.get(track) ?? []), token])
  }
  return [...tracks.values()].flatMap((trackTokens) => {
    const ordered = trackTokens.slice().sort((left, right) => left.startSeconds - right.startSeconds)
    const token = ordered.find((item) => seconds >= item.startSeconds && seconds < item.endSeconds)
      ?? ordered.find((item) => item.startSeconds >= seconds)
      ?? ordered.at(-1)
    return token ? [token] : []
  })
}

export function playbackStartForSourceRanges(tokens: readonly OwtPlaybackToken[], ranges: readonly OwtSourceRange[]): number {
  const selected = tokens.filter((token) => ranges.some((range) => token.start < range.end && token.end > range.start))
  return selected.length > 0 ? Math.min(...selected.map((token) => token.startSeconds)) : 0
}
