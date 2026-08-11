import type { OwtDocument, OwtScore, OwtScoreTrack, ScoreEvent, ScorePosition } from './ast.ts'
import { formatNoteName, scorePositionToQuarter } from './parser.ts'
import {
  ZERO,
  addRational,
  compareRational,
  formatRational,
  subtractRational,
  type Rational,
} from './rational.ts'

function quote(value: string): string {
  return JSON.stringify(value)
}

function formatPosition(position: ScorePosition): string {
  return `${position.measure}:${formatRational(position.beat)}`
}

function eventToken(event: ScoreEvent, defaultVelocity: number): string {
  switch (event.kind) {
    case 'rest':
      return `R:${formatRational(event.duration)}`
    case 'cc':
      return `<cc${event.controller}=${event.value}>`
    case 'bend':
      return `<bend=${event.value}>`
    case 'program':
      return `<program=${event.program}>`
    case 'note': {
      const head = event.pitches.length === 1
        ? formatNoteName(event.pitches[0]!)
        : `[${event.pitches.map(formatNoteName).join(' ')}]`
      const velocity = event.velocity !== undefined && event.velocity !== defaultVelocity ? `{v=${event.velocity}}` : ''
      return `${head}:${formatRational(event.duration)}${velocity}`
    }
  }
}

function nextMeasureBoundary(cursor: Rational, score: OwtScore): Rational {
  for (let measure = 1; measure <= 100000; measure++) {
    const boundary = scorePositionToQuarter({ measure: measure + 1, beat: { numerator: 1, denominator: 1 } }, score.meters)
    if (compareRational(boundary, cursor) > 0) return boundary
  }
  throw new Error('score exceeds supported measure range')
}

function serializeTrack(track: OwtScoreTrack, score: OwtScore): string[] {
  const lines = [`track ${quote(track.name)} channel=${track.channel} program=${track.program} velocity=${track.velocity}`, '']
  const events = track.events.slice().sort((a, b) => compareRational(a.at, b.at) || a.line - b.line || a.column - b.column)
  let cursor = ZERO
  let boundary = nextMeasureBoundary(cursor, score)
  let tokens = ['|']

  const flushMeasure = (): void => {
    tokens.push('|')
    lines.push(tokens.join(' '))
    tokens = ['|']
    boundary = nextMeasureBoundary(cursor, score)
  }

  for (const event of events) {
    if (compareRational(event.at, cursor) > 0) {
      const gap = subtractRational(event.at, cursor)
      tokens.push(`R:${formatRational(gap)}`)
      cursor = event.at
    }
    while (compareRational(cursor, boundary) === 0) flushMeasure()
    tokens.push(eventToken(event, track.velocity))
    if (event.kind === 'note' || event.kind === 'rest') {
      cursor = addRational(cursor, event.duration)
      while (compareRational(cursor, boundary) === 0) flushMeasure()
    }
  }
  if (tokens.length > 1) lines.push(tokens.join(' '))
  if (lines.at(-1) === '') lines.pop()
  return lines
}

export function serializeScore(score: OwtScore): string {
  const lines = ['owt 0.1 score', '']
  if (score.title !== undefined) lines.push(`title ${quote(score.title)}`)
  lines.push(`ppq ${score.ppq}`)
  for (const meter of score.meters) lines.push(`meter ${formatPosition(meter.position)} ${meter.numerator}/${meter.denominator}`)
  for (const tempo of score.tempos) lines.push(`tempo ${formatPosition(tempo.position)} ${Number(tempo.bpm.toFixed(6))}`)
  for (const key of score.keys) lines.push(`key ${formatPosition(key.position)} ${key.tonic} ${key.mode}`)
  lines.push('')
  for (let index = 0; index < score.tracks.length; index++) {
    lines.push(...serializeTrack(score.tracks[index]!, score))
    if (index < score.tracks.length - 1) lines.push('')
  }
  lines.push('', 'end')
  return `${lines.join('\n')}\n`
}


export function serializeOwt(document: OwtDocument): string {
  return serializeScore(document)
}
