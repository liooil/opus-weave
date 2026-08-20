import type { OwtDiagnostic } from '../../domain/owt/ast.ts'
import { owtLexicalRanges } from '../components/owt-highlighter.ts'

export type OwtObjectKind = 'document' | 'track' | 'measure' | 'event' | 'note' | 'rest' | 'pitch' | 'duration' | 'directive' | 'diagnostic'

export interface OwtTextObject {
  kind: OwtObjectKind
  start: number
  end: number
  value?: string
}

export interface OwtDiagnosticRange extends OwtTextObject {
  severity: 'error' | 'warning'
  code: string
  message: string
  line: number
  column: number
}

export type OwtSelectionLevel = 'event' | 'measure' | 'track'
export interface OwtSemanticEdit { from: number; to: number; insert: string }

export function selectionLevelForClickCount(clickCount: number): OwtSelectionLevel {
  if (clickCount >= 3) return 'track'
  if (clickCount === 2) return 'measure'
  return 'event'
}

export interface OwtSyntaxIndex {
  document: OwtTextObject
  tracks: OwtTextObject[]
  measures: OwtTextObject[]
  events: OwtTextObject[]
  notes: OwtTextObject[]
  rests: OwtTextObject[]
  pitches: OwtTextObject[]
  durations: OwtTextObject[]
  directives: OwtTextObject[]
  diagnostics: OwtDiagnosticRange[]
}

function lines(text: string): Array<{ start: number; end: number; text: string }> {
  const output: Array<{ start: number; end: number; text: string }> = []
  let start = 0
  for (const line of text.split('\n')) {
    output.push({ start, end: start + line.length, text: line })
    start += line.length + 1
  }
  return output
}

export function buildOwtSyntaxIndex(text: string, diagnostics: readonly OwtDiagnostic[] = []): OwtSyntaxIndex {
  const lexical = owtLexicalRanges(text)
  const sourceLines = lines(text)
  const notes: OwtTextObject[] = []
  const rests: OwtTextObject[] = []
  const pitches: OwtTextObject[] = []
  const durations: OwtTextObject[] = []
  const events: OwtTextObject[] = []
  const directives: OwtTextObject[] = []

  for (const token of lexical) {
    const value = text.slice(token.start, token.end)
    if (token.className === 'owt-syntax-note' || token.className === 'owt-syntax-chord' || token.className === 'owt-syntax-rest' || token.className === 'owt-syntax-control') {
      const kind = token.className === 'owt-syntax-rest' ? 'rest' : 'event'
      const event = { kind: kind as 'event' | 'rest', start: token.start, end: token.end, value }
      events.push(event)
      if (kind === 'rest') rests.push(event)
      else if (token.className !== 'owt-syntax-control') notes.push({ kind: 'note', start: token.start, end: token.end, value })

      const colon = value.lastIndexOf(':')
      if (colon >= 0) {
        const durationMatch = /^\d+(?:\/\d+)?/.exec(value.slice(colon + 1))
        if (durationMatch) durations.push({ kind: 'duration', start: token.start + colon + 1, end: token.start + colon + 1 + durationMatch[0].length, value: durationMatch[0] })
        const head = value.slice(0, colon)
        if (head.startsWith('[')) {
          for (const match of head.matchAll(/[A-Ga-g](?:#|b)?-?\d+/g)) {
            pitches.push({ kind: 'pitch', start: token.start + match.index!, end: token.start + match.index! + match[0].length, value: match[0] })
          }
        } else if (/^[A-Ga-g]/.test(head)) pitches.push({ kind: 'pitch', start: token.start, end: token.start + head.length, value: head })
      }
    }
  }

  for (const line of sourceLines) {
    if (/^\s*(?:title|ppq|meter|tempo|key)\b/.test(line.text)) directives.push({ kind: 'directive', start: line.start, end: line.end })
  }

  const trackStarts = sourceLines.filter((line) => /^\s*track\b/.test(line.text))
  const endLine = sourceLines.find((line) => /^\s*end\s*$/.test(line.text))
  const tracks = trackStarts.map((line, index) => ({
    kind: 'track' as const,
    start: line.start,
    end: trackStarts[index + 1]?.start ?? endLine?.start ?? text.length,
  }))

  const bars = lexical.filter((token) => token.className === 'owt-syntax-bar')
  const measures: OwtTextObject[] = []
  for (const line of sourceLines) {
    const lineBars = bars.filter((bar) => bar.start >= line.start && bar.end <= line.end)
    for (let index = 0; index + 1 < lineBars.length; index++) {
      const startBar = lineBars[index]!
      const endBar = lineBars[index + 1]!
      if (!text.slice(startBar.end, endBar.start).trim()) continue
      measures.push({ kind: 'measure', start: startBar.start, end: endBar.end })
    }
  }

  const diagnosticObjects: OwtDiagnosticRange[] = diagnostics.flatMap((diagnostic) => {
    const line = sourceLines[diagnostic.line - 1]
    if (!line) return []
    const start = Math.min(line.end, line.start + Math.max(0, diagnostic.column - 1))
    let end = start
    while (end < line.end && !/\s|\|/.test(text[end]!)) end++
    return [{
      kind: 'diagnostic' as const,
      start,
      end: Math.max(start + 1, end),
      severity: diagnostic.severity,
      code: diagnostic.code,
      message: diagnostic.message,
      line: diagnostic.line,
      column: diagnostic.column,
    }]
  })

  return {
    document: { kind: 'document', start: 0, end: text.length },
    tracks,
    measures,
    events,
    notes,
    rests,
    pitches,
    durations,
    directives,
    diagnostics: diagnosticObjects,
  }
}

export function objectsOfKind(index: OwtSyntaxIndex, kind: OwtObjectKind): OwtTextObject[] {
  switch (kind) {
    case 'document': return [index.document]
    case 'track': return index.tracks
    case 'measure': return index.measures
    case 'event': return index.events
    case 'note': return index.notes
    case 'rest': return index.rests
    case 'pitch': return index.pitches
    case 'duration': return index.durations
    case 'directive': return index.directives
    case 'diagnostic': return index.diagnostics
  }
}

export function nextObject(index: OwtSyntaxIndex, kind: OwtObjectKind, position: number, direction: 1 | -1): OwtTextObject | undefined {
  const objects = objectsOfKind(index, kind).slice().sort((left, right) => left.start - right.start)
  if (direction > 0) return objects.find((object) => object.start > position) ?? objects[0]
  return objects.slice().reverse().find((object) => object.start < position) ?? objects.at(-1)
}

export function objectContaining(index: OwtSyntaxIndex, kind: OwtObjectKind, start: number, end: number): OwtTextObject | undefined {
  return objectsOfKind(index, kind)
    .filter((object) => object.start <= start && object.end >= end)
    .sort((left, right) => (left.end - left.start) - (right.end - right.start))[0]
}

/** Snap a native textarea selection to a continuous range of OWT objects. */
export function semanticRangeFromNativeSelection(
  index: OwtSyntaxIndex,
  level: OwtSelectionLevel,
  start: number,
  end: number,
): { start: number; end: number } | undefined {
  const objects = objectsOfKind(index, level).slice().sort((left, right) => left.start - right.start)
  if (!objects.length) return undefined
  const normalizedStart = Math.min(start, end)
  const normalizedEnd = Math.max(start, end)
  const endPoint = normalizedEnd > normalizedStart ? normalizedEnd - 1 : normalizedStart
  const near = (position: number): OwtTextObject => objects.find((object) => object.start <= position && object.end > position)
    ?? objects.find((object) => object.start >= position)
    ?? objects.at(-1)!
  const first = near(normalizedStart)
  const last = near(endPoint)
  return { start: Math.min(first.start, last.start), end: Math.max(first.end, last.end) }
}

export function selectionLevelForRange(index: OwtSyntaxIndex, start: number, end: number): OwtSelectionLevel | undefined {
  const matchesLevel = (level: OwtSelectionLevel): boolean => {
    const objects = objectsOfKind(index, level).filter((object) => object.start >= start && object.end <= end)
    return objects.length > 0 && objects[0]!.start === start && objects.at(-1)!.end === end
  }
  if (matchesLevel('track')) return 'track'
  if (matchesLevel('measure')) return 'measure'
  if (objectsOfKind(index, 'event').some((object) => object.start >= start && object.end <= end)) return 'event'
  return undefined
}

export function replaceOwtEventWithRest(eventText: string): string | null {
  const colon = eventText.lastIndexOf(':')
  if (colon < 0) return null
  return `R${eventText.slice(colon)}`
}

/** Delete score objects without exposing raw source-text behavior to score mode. */
export function semanticDeletionEdits(
  text: string,
  index: OwtSyntaxIndex,
  ranges: readonly { start: number; end: number }[],
): OwtSemanticEdit[] {
  const edits: OwtSemanticEdit[] = []
  for (const range of ranges) {
    const level = selectionLevelForRange(index, range.start, range.end)
    if (level === 'track') {
      edits.push({ from: range.start, to: range.end, insert: '' })
      continue
    }
    if (level === 'measure') {
      const lineStart = text.lastIndexOf('\n', Math.max(0, range.start - 1)) + 1
      const nextNewline = text.indexOf('\n', range.end)
      const lineEnd = nextNewline < 0 ? text.length : nextNewline
      const fillsLines = !text.slice(lineStart, range.start).trim() && !text.slice(range.end, lineEnd).trim()
      edits.push(fillsLines
        ? { from: lineStart, to: nextNewline < 0 ? lineEnd : lineEnd + 1, insert: '' }
        : { from: Math.min(range.end, range.start + 1), to: range.end, insert: '' })
      continue
    }
    for (const event of index.events.filter((object) => object.start >= range.start && object.end <= range.end)) {
      const insert = replaceOwtEventWithRest(text.slice(event.start, event.end))
      if (insert !== null) edits.push({ from: event.start, to: event.end, insert })
    }
  }
  const unique = new Map(edits.map((edit) => [`${edit.from}:${edit.to}`, edit]))
  return [...unique.values()].sort((left, right) => left.from - right.from)
}

export function syntaxParent(index: OwtSyntaxIndex, start: number, end: number): OwtTextObject {
  const candidates = [...index.pitches, ...index.durations, ...index.events, ...index.measures, ...index.tracks, index.document]
    .filter((object) => object.start <= start && object.end >= end && (object.start < start || object.end > end))
    .sort((left, right) => (left.end - left.start) - (right.end - right.start))
  return candidates[0] ?? index.document
}

export function syntaxChild(index: OwtSyntaxIndex, start: number, end: number): OwtTextObject | undefined {
  const candidates = [...index.tracks, ...index.measures, ...index.events, ...index.pitches, ...index.durations]
    .filter((object) => object.start >= start && object.end <= end && (object.start > start || object.end < end))
    .sort((left, right) => (right.end - right.start) - (left.end - left.start))
  return candidates[0]
}

/** Replace an OWT event's pitch/chord/rest while preserving duration and attributes. */
export function replaceOwtEventPitch(eventText: string, pitch: string): string | null {
  const colon = eventText.lastIndexOf(':')
  if (colon < 0) return null
  return `${pitch}${eventText.slice(colon)}`
}
