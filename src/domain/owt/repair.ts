import { parseOwt, scorePositionToQuarter, scoreTokenDuration, scoreTokens, stripComment } from './parser.ts'
import { addRational, compareRational, formatRational, rational, subtractRational, ZERO, type Rational } from './rational.ts'
import type { OwtScore } from './ast.ts'

export interface OwtRepairResult {
  text: string
  changes: string[]
  valid: boolean
}

export interface OwtRepairOptions {
  /** Split a timed event when a bar boundary falls inside its duration. */
  splitCrossBoundaryEvents?: boolean
}

const DIRECTIVES = ['owt', 'title', 'ppq', 'meter', 'tempo', 'key', 'track', 'end'] as const
const STRUCTURAL_REPAIR_ERRORS = new Set(['score.bar.misaligned', 'score.track.incompleteMeasure'])

interface TextPatch {
  start: number
  end: number
  text: string
}

interface RepairEvent {
  start: number
  end: number
  text: string
  at: Rational
  endAt: Rational
}

interface RepairBar {
  start: number
  end: number
}

function lineStartOffsets(text: string): number[] {
  const offsets = [0]
  for (let index = 0; index < text.length; index++) if (text[index] === '\n') offsets.push(index + 1)
  return offsets
}

function splitTimedEvent(text: string, left: Rational, right: Rational): string | undefined {
  const match = /^(.+?):(\d+(?:\/\d+)?)(\{[^}]*\})?$/.exec(text)
  if (!match) return undefined
  const head = match[1]!
  const attrs = match[3] ?? ''
  return `${head}:${formatRational(left)}${attrs} | ${head}:${formatRational(right)}${attrs}`
}

function boundaryAtMeasure(measure: number, score: OwtScore): Rational {
  return scorePositionToQuarter({ measure, beat: rational(1) }, score.meters)
}

function isMeasureBoundary(cursor: Rational, score: OwtScore): boolean {
  if (compareRational(cursor, ZERO) === 0) return true
  for (let measure = 2; measure <= 100000; measure++) {
    const boundary = boundaryAtMeasure(measure, score)
    const comparison = compareRational(boundary, cursor)
    if (comparison === 0) return true
    if (comparison > 0) return false
  }
  return false
}

function nextBoundary(cursor: Rational, score: OwtScore): Rational | undefined {
  for (let measure = 2; measure <= 100000; measure++) {
    const boundary = boundaryAtMeasure(measure, score)
    if (compareRational(boundary, cursor) > 0) return boundary
  }
  return undefined
}

function lastBoundaryAfter(segmentStart: Rational, cursor: Rational, score: OwtScore): Rational | undefined {
  let result: Rational | undefined
  for (let measure = 2; measure <= 100000; measure++) {
    const boundary = boundaryAtMeasure(measure, score)
    if (compareRational(boundary, cursor) >= 0) break
    if (compareRational(boundary, segmentStart) > 0) result = boundary
  }
  return result
}

function applyPatches(text: string, patches: TextPatch[]): string {
  const ordered = patches.slice().sort((left, right) => right.start - left.start || right.end - left.end)
  let output = text
  for (const patch of ordered) output = `${output.slice(0, patch.start)}${patch.text}${output.slice(patch.end)}`
  return output
}

function repairBarBoundaries(text: string, options: OwtRepairOptions): { text: string; changes: string[] } {
  const parsed = parseOwt(text)
  const score = parsed.document ?? parsed.partialDocument
  if (!score || !parsed.diagnostics.some((diagnostic) => STRUCTURAL_REPAIR_ERRORS.has(diagnostic.code))) return { text, changes: [] }
  if (parsed.diagnostics.some((diagnostic) => diagnostic.severity === 'error' && !STRUCTURAL_REPAIR_ERRORS.has(diagnostic.code))) return { text, changes: [] }

  const offsets = lineStartOffsets(text)
  const patches: TextPatch[] = []
  const changes = new Set<string>()
  let trackIndex = -1
  let cursor = ZERO
  let segmentStart = ZERO
  let segmentEvents: RepairEvent[] = []
  let unsupportedToken = false
  let unresolvedSegment = false

  const finishTrack = (insertAt: number): void => {
    if (unresolvedSegment || isMeasureBoundary(cursor, score)) return
    const upper = nextBoundary(cursor, score)
    if (!upper) return
    const gap = subtractRational(upper, cursor)
    if (compareRational(gap, ZERO) <= 0) return
    patches.push({ start: insertAt, end: insertAt, text: `R:${formatRational(gap)}\n` })
    changes.add('track-fill-rest')
    cursor = upper
    segmentStart = upper
    segmentEvents = []
  }

  const handleBar = (bar: RepairBar): void => {
    if (isMeasureBoundary(cursor, score)) {
      segmentStart = cursor
      segmentEvents = []
      unresolvedSegment = false
      return
    }
    const upper = nextBoundary(cursor, score)
    if (!upper) {
      segmentStart = cursor
      segmentEvents = []
      unresolvedSegment = true
      return
    }

    const lower = lastBoundaryAfter(segmentStart, cursor, score)
    if (lower) {
      const eventAtBoundary = segmentEvents.find((event) => compareRational(event.at, lower) === 0)
      if (eventAtBoundary) {
        patches.push({ start: bar.start, end: bar.end, text: '' })
        patches.push({ start: eventAtBoundary.start, end: eventAtBoundary.start, text: '| ' })
        changes.add('bar-move')
        segmentStart = lower
        segmentEvents = segmentEvents.filter((event) => compareRational(event.at, lower) >= 0)
        unresolvedSegment = false
        return
      }

      const crossing = segmentEvents.find((event) => compareRational(event.at, lower) < 0 && compareRational(event.endAt, lower) > 0)
      if (crossing && options.splitCrossBoundaryEvents) {
        const left = subtractRational(lower, crossing.at)
        const right = subtractRational(crossing.endAt, lower)
        const replacement = compareRational(left, ZERO) > 0 && compareRational(right, ZERO) > 0
          ? splitTimedEvent(crossing.text, left, right)
          : undefined
        if (replacement) {
          patches.push({ start: bar.start, end: bar.end, text: '' })
          patches.push({ start: crossing.start, end: crossing.end, text: replacement })
          changes.add('bar-split-event')
          segmentStart = lower
          segmentEvents = segmentEvents
            .filter((event) => compareRational(event.endAt, lower) > 0)
            .map((event) => event === crossing ? { ...event, at: lower } : event)
          unresolvedSegment = false
          return
        }
      }

      // The boundary falls inside a timed event. Without the explicit option,
      // leave this bar untouched rather than changing the musical articulation.
      segmentStart = cursor
      segmentEvents = []
      unresolvedSegment = true
      return
    }

    const gap = subtractRational(upper, cursor)
    if (compareRational(gap, ZERO) > 0) {
      patches.push({ start: bar.start, end: bar.start, text: `R:${formatRational(gap)} ` })
      changes.add('bar-fill-rest')
      cursor = upper
      segmentStart = upper
      segmentEvents = []
      unresolvedSegment = false
    }
  }

  for (const [lineIndex, rawLine] of text.split('\n').entries()) {
    const stripped = stripComment(rawLine)
    const leading = stripped.length - stripped.trimStart().length
    const source = stripped.trim()
    if (!source) continue
    if (/^track\s+/.test(source)) {
      if (trackIndex >= 0) finishTrack(offsets[lineIndex]! + leading)
      trackIndex++
      cursor = ZERO
      segmentStart = ZERO
      segmentEvents = []
      unresolvedSegment = false
      continue
    }
    if (source === 'end') {
      finishTrack(offsets[lineIndex]! + leading)
      break
    }
    if (trackIndex < 0 || /^(?:owt|title|ppq|meter|tempo|key)\b/.test(source)) continue

    const lineOffset = offsets[lineIndex]! + leading
    for (const token of scoreTokens(source)) {
      const start = lineOffset + token.column - 1
      const end = start + token.text.length
      if (token.text === '|') {
        handleBar({ start, end })
        continue
      }
      const duration = scoreTokenDuration(token.text)
      if (!duration) {
        if (!token.text.startsWith('<')) unsupportedToken = true
        continue
      }
      const event: RepairEvent = { start, end, text: token.text, at: cursor, endAt: addRational(cursor, duration) }
      segmentEvents.push(event)
      cursor = event.endAt
    }
  }

  if (unsupportedToken || patches.length === 0) return { text, changes: [] }
  return { text: applyPatches(text, patches), changes: [...changes] }
}

export function repairCommonOwtErrors(source: string, options: OwtRepairOptions = {}): OwtRepairResult {
  const changes: string[] = []
  const fenced = /```(?:owt|text)?\s*([\s\S]*?)```/i.exec(source)
  let text = fenced?.[1] ?? source
  if (fenced) changes.push('markdown-fence')

  const normalized = text
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replaceAll('：', ':')
    .replaceAll('＝', '=')
    .replaceAll('｜', '|')
    .replace(/\r\n?/g, '\n')
  if (normalized !== text) changes.push('typography')
  text = normalized.trim()

  const header = text.search(/^\s*owt\s+0\.1\s+score\s*$/im)
  if (header > 0) {
    text = text.slice(header)
    changes.push('leading-prose')
  }
  if (!/^\s*owt\s+0\.1\s+score\s*$/im.test(text)) {
    text = `owt 0.1 score\n\n${text}`
    changes.push('header')
  }

  text = text.split('\n').map((line) => {
    const match = /^(\s*)([A-Za-z]+)(\b.*)$/.exec(line)
    if (!match) return line
    const keyword = DIRECTIVES.find((candidate) => candidate === match[2]!.toLowerCase())
    if (!keyword || match[2] === keyword) return line
    changes.push('keyword-case')
    return `${match[1]}${keyword}${match[3]}`
  }).join('\n')

  if (!/(?:^|\n)end\s*$/.test(text)) {
    text = `${text.trimEnd()}\n\nend`
    changes.push('end')
  }
  text = `${text.trim()}\n`

  const barRepair = repairBarBoundaries(text, options)
  if (barRepair.changes.length > 0) {
    text = barRepair.text
    changes.push(...barRepair.changes)
  }
  return { text, changes: [...new Set(changes)], valid: parseOwt(text).document !== undefined }
}
