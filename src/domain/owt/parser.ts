import {
  OwtSyntaxError,
  type KeyDirective,
  type MeterDirective,
  type OwtDiagnostic,
  type OwtDocument,
  type OwtParseResult,
  type OwtScore,
  type OwtScoreTrack,
  type ScoreEvent,
  type ScorePosition,
  type TempoDirective,
} from './ast.ts'
import {
  ONE,
  ZERO,
  addRational,
  compareRational,
  multiplyRational,
  parseRational,
  rational,
  type Rational,
} from './rational.ts'

const NOTE_PATTERN = /^([A-Ga-g])([#b]?)(-?\d+)$/
const SCORE_NOTE_PATTERN = /^([^:]+):(\d+(?:\/\d+)?)(?:\{([^}]*)\})?$/
const POSITION_PATTERN = /^(\d+):(\d+(?:\/\d+)?)$/
const ATTR_PATTERN = /([A-Za-z][\w-]*)=([^\s,}]+)/g
const PITCH_CLASS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }


interface ParseContext {
  diagnostics: OwtDiagnostic[]
  lines: string[]
  ended: boolean
}

function issue(ctx: ParseContext, line: number, column: number, code: string, message: string): void {
  ctx.diagnostics.push({ severity: 'error', line, column, code, message })
}

function stripComment(line: string): string {
  let quoted = false
  let escaped = false
  for (let i = 0; i < line.length; i++) {
    const char = line[i]!
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\' && quoted) {
      escaped = true
      continue
    }
    if (char === '"') {
      quoted = !quoted
      continue
    }
    if (char === '#' && !quoted && (i === 0 || /\s/.test(line[i - 1]!))) return line.slice(0, i)
  }
  return line
}

function parseQuotedValue(text: string): string | null {
  const match = /^"((?:\\.|[^"\\])*)"$/.exec(text.trim())
  if (!match) return null
  try {
    return JSON.parse(`"${match[1]}"`) as string
  } catch {
    return null
  }
}

export function parseNoteName(text: string): number | null {
  const match = NOTE_PATTERN.exec(text)
  if (!match) return null
  const letter = match[1]!.toUpperCase()
  const accidental = match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0
  const octave = Number(match[3])
  const pitch = (octave + 1) * 12 + PITCH_CLASS[letter]! + accidental
  return Number.isInteger(pitch) && pitch >= 0 && pitch <= 127 ? pitch : null
}

export function formatNoteName(pitch: number): string {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  return `${names[pitch % 12]}${Math.floor(pitch / 12) - 1}`
}

function parsePosition(text: string): ScorePosition | null {
  const match = POSITION_PATTERN.exec(text)
  if (!match) return null
  const beat = parseRational(match[2]!)
  const measure = Number(match[1])
  if (!beat || measure < 1 || compareRational(beat, ONE) < 0) return null
  return { measure, beat }
}

function meterAtMeasure(measure: number, meters: MeterDirective[]): MeterDirective {
  let selected = meters[0] ?? {
    position: { measure: 1, beat: ONE },
    at: ZERO,
    numerator: 4,
    denominator: 4,
  }
  for (const meter of meters) {
    if (meter.position.measure <= measure && meter.position.beat.numerator === 1 && meter.position.beat.denominator === 1) selected = meter
    else if (meter.position.measure > measure) break
  }
  return selected
}

export function scorePositionToQuarter(position: ScorePosition, meters: MeterDirective[]): Rational {
  let at = ZERO
  for (let measure = 1; measure < position.measure; measure++) {
    const meter = meterAtMeasure(measure, meters)
    at = addRational(at, rational(meter.numerator * 4, meter.denominator))
  }
  const current = meterAtMeasure(position.measure, meters)
  const beatOffset = addRational(position.beat, rational(-1))
  return addRational(at, multiplyRational(beatOffset, rational(4, current.denominator)))
}

function isMeasureBoundary(cursor: Rational, meters: MeterDirective[]): boolean {
  if (compareRational(cursor, ZERO) === 0) return true
  let at = ZERO
  for (let measure = 1; measure <= 100000; measure++) {
    const meter = meterAtMeasure(measure, meters)
    at = addRational(at, rational(meter.numerator * 4, meter.denominator))
    const comparison = compareRational(at, cursor)
    if (comparison === 0) return true
    if (comparison > 0) return false
  }
  return false
}

function parseAttributes(text: string): Record<string, string> {
  const values: Record<string, string> = {}
  for (const match of text.matchAll(ATTR_PATTERN)) values[match[1]!] = match[2]!
  return values
}

function scoreTokens(line: string): Array<{ text: string; column: number }> {
  const tokens: Array<{ text: string; column: number }> = []
  let index = 0
  while (index < line.length) {
    while (/\s/.test(line[index] ?? '')) index++
    if (index >= line.length) break
    const start = index
    const opening = line[index]
    if (opening === '|') {
      tokens.push({ text: '|', column: start + 1 })
      index++
      continue
    }
    if (opening === '<') {
      const end = line.indexOf('>', index + 1)
      if (end < 0) {
        tokens.push({ text: line.slice(index), column: start + 1 })
        break
      }
      tokens.push({ text: line.slice(index, end + 1), column: start + 1 })
      index = end + 1
      continue
    }
    if (opening === '[') {
      const close = line.indexOf(']', index + 1)
      if (close < 0) {
        tokens.push({ text: line.slice(index), column: start + 1 })
        break
      }
      index = close + 1
      while (index < line.length && !/\s|\|/.test(line[index]!)) index++
      tokens.push({ text: line.slice(start, index), column: start + 1 })
      continue
    }
    while (index < line.length && !/\s|\|/.test(line[index]!)) index++
    tokens.push({ text: line.slice(start, index), column: start + 1 })
  }
  return tokens
}

function parseVelocity(attrs: string | undefined, ctx: ParseContext, line: number, column: number): number | undefined {
  if (!attrs) return undefined
  const values = parseAttributes(attrs)
  const unknown = Object.keys(values).filter((key) => key !== 'v')
  if (unknown.length > 0) issue(ctx, line, column, 'score.attribute.unsupported', `unsupported note attribute: ${unknown.join(', ')}`)
  if (values.v === undefined) return undefined
  const velocity = Number(values.v)
  if (!Number.isInteger(velocity) || velocity < 1 || velocity > 127) {
    issue(ctx, line, column, 'score.velocity.range', `velocity must be an integer from 1 to 127, got ${values.v}`)
    return undefined
  }
  return velocity
}

function parseScoreEvent(
  token: string,
  cursor: Rational,
  line: number,
  column: number,
  ctx: ParseContext,
): { event?: ScoreEvent; advance?: Rational } {
  if (token.startsWith('<')) {
    const control = /^<(?:(cc)(\d+)|(bend)|(program))=(\d+)>$/.exec(token)
    if (!control) {
      issue(ctx, line, column, 'score.control.syntax', `invalid control event: ${token}`)
      return {}
    }
    const value = Number(control[5])
    if (control[1]) {
      const controller = Number(control[2])
      if (controller < 0 || controller > 127 || value < 0 || value > 127) {
        issue(ctx, line, column, 'score.cc.range', 'CC controller and value must be integers from 0 to 127')
        return {}
      }
      return { event: { kind: 'cc', at: cursor, controller, value, line, column } }
    }
    if (control[3]) {
      if (value < 0 || value > 16383) {
        issue(ctx, line, column, 'score.bend.range', 'pitch bend must be an integer from 0 to 16383')
        return {}
      }
      return { event: { kind: 'bend', at: cursor, value, line, column } }
    }
    if (value < 0 || value > 127) {
      issue(ctx, line, column, 'score.program.range', 'program must be an integer from 0 to 127')
      return {}
    }
    return { event: { kind: 'program', at: cursor, program: value, line, column } }
  }

  const match = SCORE_NOTE_PATTERN.exec(token)
  if (!match) {
    issue(ctx, line, column, 'score.event.syntax', `invalid score event or missing explicit duration: ${token}`)
    return {}
  }
  const duration = parseRational(match[2]!)
  if (!duration || compareRational(duration, ZERO) <= 0) {
    issue(ctx, line, column, 'score.duration.invalid', `duration must be a positive integer or rational, got ${match[2]}`)
    return {}
  }
  const velocity = parseVelocity(match[3], ctx, line, column)
  const head = match[1]!
  if (head === 'R') return { event: { kind: 'rest', at: cursor, duration, line, column }, advance: duration }

  const noteTexts = head.startsWith('[') && head.endsWith(']')
    ? head.slice(1, -1).trim().split(/\s+/)
    : [head]
  if (noteTexts.length === 0 || noteTexts.some((note) => note.length === 0)) {
    issue(ctx, line, column, 'score.chord.empty', 'chord must contain at least one note')
    return {}
  }
  const pitches: number[] = []
  for (const noteText of noteTexts) {
    const pitch = parseNoteName(noteText)
    if (pitch === null) {
      issue(ctx, line, column, 'score.note.invalid', `invalid note name or out-of-range pitch: ${noteText}`)
      return {}
    }
    pitches.push(pitch)
  }
  return { event: { kind: 'note', at: cursor, pitches, duration, velocity, line, column }, advance: duration }
}

function resolveMapPositions(score: OwtScore): void {
  score.meters.sort((a, b) => a.position.measure - b.position.measure || compareRational(a.position.beat, b.position.beat))
  for (const meter of score.meters) meter.at = scorePositionToQuarter(meter.position, score.meters)
  score.tempos.sort((a, b) => a.position.measure - b.position.measure || compareRational(a.position.beat, b.position.beat))
  for (const tempo of score.tempos) tempo.at = scorePositionToQuarter(tempo.position, score.meters)
  score.keys.sort((a, b) => a.position.measure - b.position.measure || compareRational(a.position.beat, b.position.beat))
  for (const key of score.keys) key.at = scorePositionToQuarter(key.position, score.meters)
}

function parseScore(ctx: ParseContext): OwtScore {
  const score: OwtScore = { kind: 'score', version: '0.1', ppq: 480, meters: [], tempos: [], keys: [], tracks: [] }
  let currentTrack: OwtScoreTrack | null = null
  let cursor = ZERO
  let sawTrack = false

  for (let lineIndex = 1; lineIndex < ctx.lines.length; lineIndex++) {
    const source = stripComment(ctx.lines[lineIndex]!).trim()
    const line = lineIndex + 1
    if (!source) continue
    if (source === 'end') {
      ctx.ended = true
      if (ctx.lines.slice(lineIndex + 1).some((rest) => stripComment(rest).trim().length > 0)) {
        issue(ctx, line, 1, 'document.trailing', 'content is not allowed after end')
      }
      break
    }
    if (source.startsWith('title ')) {
      if (sawTrack) issue(ctx, line, 1, 'score.directive.order', 'title must appear before tracks')
      const title = parseQuotedValue(source.slice(6))
      if (title === null) issue(ctx, line, 7, 'document.title.syntax', 'title must be a quoted string')
      else score.title = title
      continue
    }
    if (source.startsWith('ppq ')) {
      if (sawTrack) issue(ctx, line, 1, 'score.directive.order', 'ppq must appear before tracks')
      const ppq = Number(source.slice(4).trim())
      if (!Number.isInteger(ppq) || ppq < 1 || ppq > 32767) issue(ctx, line, 5, 'score.ppq.range', 'ppq must be an integer from 1 to 32767')
      else score.ppq = ppq
      continue
    }
    if (/^(meter|tempo|key)\s/.test(source)) {
      if (sawTrack) issue(ctx, line, 1, 'score.directive.order', 'meter, tempo, and key directives must appear before tracks in OWT 0.1')
      const parts = source.split(/\s+/)
      const position = parsePosition(parts[1] ?? '')
      if (!position) {
        issue(ctx, line, source.indexOf(parts[1] ?? '') + 1, 'score.position.invalid', 'position must use measure:beat with one-based values')
        continue
      }
      if (parts[0] === 'meter') {
        const meter = /^(\d+)\/(\d+)$/.exec(parts[2] ?? '')
        if (!meter) {
          issue(ctx, line, 1, 'score.meter.syntax', 'meter must use numerator/denominator')
          continue
        }
        const numerator = Number(meter[1])
        const denominator = Number(meter[2])
        if (numerator < 1 || numerator > 64 || denominator < 1 || (denominator & (denominator - 1)) !== 0) {
          issue(ctx, line, 1, 'score.meter.range', 'meter numerator must be 1–64 and denominator must be a power of two')
          continue
        }
        if (compareRational(position.beat, ONE) !== 0) issue(ctx, line, 1, 'score.meter.position', 'meter changes must occur at beat 1')
        score.meters.push({ position, at: ZERO, numerator, denominator })
      } else if (parts[0] === 'tempo') {
        const bpm = Number(parts[2])
        if (!Number.isFinite(bpm) || bpm <= 0 || bpm > 1000) issue(ctx, line, 1, 'score.tempo.range', 'tempo must be greater than 0 and at most 1000 BPM')
        else score.tempos.push({ position, at: ZERO, bpm })
      } else {
        const tonic = parts[2] ?? ''
        const mode = parts[3]
        if (!/^[A-G](?:#|b)?$/.test(tonic) || (mode !== 'major' && mode !== 'minor')) {
          issue(ctx, line, 1, 'score.key.syntax', 'key must use a tonic such as C, F#, or Bb followed by major or minor')
        } else score.keys.push({ position, at: ZERO, tonic, mode })
      }
      continue
    }
    if (source.startsWith('track ')) {
      sawTrack = true
      const match = /^track\s+("(?:\\.|[^"\\])*")(.*)$/.exec(source)
      if (!match) {
        issue(ctx, line, 1, 'score.track.syntax', 'track requires a quoted name and channel/program/velocity attributes')
        currentTrack = null
        continue
      }
      const name = parseQuotedValue(match[1]!)!
      const attrs = parseAttributes(match[2]!)
      const channel = Number(attrs.channel ?? score.tracks.length + 1)
      const program = Number(attrs.program ?? 0)
      const velocity = Number(attrs.velocity ?? 80)
      if (!Number.isInteger(channel) || channel < 1 || channel > 16) issue(ctx, line, 1, 'score.channel.range', 'track channel must be an integer from 1 to 16')
      if (!Number.isInteger(program) || program < 0 || program > 127) issue(ctx, line, 1, 'score.program.range', 'track program must be an integer from 0 to 127')
      if (!Number.isInteger(velocity) || velocity < 1 || velocity > 127) issue(ctx, line, 1, 'score.velocity.range', 'track velocity must be an integer from 1 to 127')
      currentTrack = { name, channel, program, velocity, events: [] }
      score.tracks.push(currentTrack)
      cursor = ZERO
      continue
    }
    if (!currentTrack) {
      issue(ctx, line, 1, 'score.track.required', 'score events must appear inside a track')
      continue
    }

    for (const token of scoreTokens(source)) {
      if (token.text === '|') {
        if (!isMeasureBoundary(cursor, score.meters)) issue(ctx, line, token.column, 'score.bar.misaligned', 'bar boundary does not match the active meter')
        continue
      }
      const parsed = parseScoreEvent(token.text, cursor, line, token.column, ctx)
      if (parsed.event) currentTrack.events.push(parsed.event)
      if (parsed.advance) cursor = addRational(cursor, parsed.advance)
    }
  }

  if (!ctx.ended) issue(ctx, ctx.lines.length, 1, 'document.end.missing', 'document must end with end')
  if (score.tracks.length === 0) issue(ctx, 1, 1, 'score.track.missing', 'score must contain at least one track')
  if (score.meters.length === 0) score.meters.push({ position: { measure: 1, beat: ONE }, at: ZERO, numerator: 4, denominator: 4 })
  if (score.tempos.length === 0) score.tempos.push({ position: { measure: 1, beat: ONE }, at: ZERO, bpm: 120 })
  resolveMapPositions(score)
  return score
}


export function parseOwt(text: string): OwtParseResult {
  const lines = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n')
  const diagnostics: OwtDiagnostic[] = []
  const ctx: ParseContext = { diagnostics, lines, ended: false }
  const firstIndex = lines.findIndex((line) => stripComment(line).trim().length > 0)
  if (firstIndex < 0) return { diagnostics: [{ severity: 'error', line: 1, column: 1, code: 'document.empty', message: 'OWT document is empty' }] }
  const header = stripComment(lines[firstIndex]!).trim()
  const match = /^owt\s+(\S+)\s+score$/.exec(header)
  if (!match) return { diagnostics: [{ severity: 'error', line: firstIndex + 1, column: 1, code: 'document.header.invalid', message: 'expected: owt 0.1 score' }] }
  if (match[1] !== '0.1') return { diagnostics: [{ severity: 'error', line: firstIndex + 1, column: 5, code: 'document.version.unsupported', message: `unsupported OWT version ${match[1]}; expected 0.1` }] }
  if (firstIndex !== 0) lines.splice(0, firstIndex)
  const document: OwtDocument = parseScore(ctx)
  return diagnostics.some((item) => item.severity === 'error') ? { diagnostics } : { document, diagnostics }
}

export function parseOwtOrThrow(text: string): OwtDocument {
  const result = parseOwt(text)
  if (!result.document) throw new OwtSyntaxError(result.diagnostics)
  return result.document
}
