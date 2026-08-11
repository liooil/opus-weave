import type { OwtSourceRange } from '../../domain/owt/playback-map.ts'

export interface OwtLexicalRange extends OwtSourceRange {
  className: string
}

export interface OwtDecoration extends OwtSourceRange {
  className: string
}

const TOKEN_PATTERN = /"(?:\\.|[^"\\])*"|<[^>\n]*>|\[[^\]\n]*\](?::\d+(?:\/\d+)?)?(?:\{[^}\n]*\})?|(?:[A-Ga-g](?:#|b)?-?\d+|R):\d+(?:\/\d+)?(?:\{[^}\n]*\})?|\b(?:owt|score|title|ppq|meter|tempo|key|track|end|major|minor)\b|\b(?:channel|program|velocity|v)(?==)|\d+(?::\d+(?:\/\d+)?|\/\d+)?|\|/g

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function tokenClass(token: string): string {
  if (token.startsWith('"')) return 'owt-syntax-string'
  if (token.startsWith('<')) return 'owt-syntax-control'
  if (token.startsWith('[')) return 'owt-syntax-chord'
  if (/^(?:[A-Ga-g](?:#|b)?-?\d+|R):/.test(token)) return token.startsWith('R:') ? 'owt-syntax-rest' : 'owt-syntax-note'
  if (token === '|') return 'owt-syntax-bar'
  if (/^(?:channel|program|velocity|v)$/.test(token)) return 'owt-syntax-attribute'
  if (/^\d/.test(token)) return 'owt-syntax-number'
  return 'owt-syntax-keyword'
}

function commentStart(line: string): number {
  for (let index = 0; index < line.length; index++) {
    if (line[index] === '#' && (index === 0 || /\s/.test(line[index - 1]!))) return index
  }
  return -1
}

export function owtLexicalRanges(text: string): OwtLexicalRange[] {
  const ranges: OwtLexicalRange[] = []
  let offset = 0
  for (const line of text.split('\n')) {
    const comment = commentStart(line)
    const code = comment < 0 ? line : line.slice(0, comment)
    TOKEN_PATTERN.lastIndex = 0
    for (const match of code.matchAll(TOKEN_PATTERN)) {
      const start = offset + match.index!
      ranges.push({ start, end: start + match[0].length, className: tokenClass(match[0]) })
    }
    if (comment >= 0) ranges.push({ start: offset + comment, end: offset + line.length, className: 'owt-syntax-comment' })
    offset += line.length + 1
  }
  return ranges
}

export function renderOwtHighlight(
  text: string,
  activeRanges: readonly OwtSourceRange[] = [],
  lexical = owtLexicalRanges(text),
  decorations: readonly OwtDecoration[] = [],
): string {
  const boundaries = new Set<number>([0, text.length])
  for (const range of lexical) {
    boundaries.add(range.start)
    boundaries.add(range.end)
  }
  for (const range of activeRanges) {
    boundaries.add(Math.max(0, Math.min(text.length, range.start)))
    boundaries.add(Math.max(0, Math.min(text.length, range.end)))
  }
  for (const range of decorations) {
    boundaries.add(Math.max(0, Math.min(text.length, range.start)))
    boundaries.add(Math.max(0, Math.min(text.length, range.end)))
  }
  const points = [...boundaries].sort((left, right) => left - right)
  let html = ''
  for (let index = 0; index < points.length - 1; index++) {
    const start = points[index]!
    const end = points[index + 1]!
    if (end <= start) continue
    for (const decoration of decorations) {
      if (decoration.start === start && decoration.end === start) html += `<span class="${decoration.className}">​</span>`
    }
    const classes: string[] = []
    const syntax = lexical.find((range) => range.start <= start && range.end >= end)
    if (syntax) classes.push(syntax.className)
    if (activeRanges.some((range) => range.start < end && range.end > start)) classes.push('owt-token-playing')
    for (const decoration of decorations) {
      if (decoration.start < end && decoration.end > start) classes.push(decoration.className)
    }
    const value = escapeHtml(text.slice(start, end))
    html += classes.length > 0 ? `<span class="${classes.join(' ')}">${value}</span>` : value
  }
  for (const decoration of decorations) {
    if (decoration.start === text.length && decoration.end === text.length) html += `<span class="${decoration.className}">​</span>`
  }
  return html.endsWith('\n') ? `${html} ` : html
}
