import { parseOwt } from './parser.ts'

export interface OwtRepairResult {
  text: string
  changes: string[]
  valid: boolean
}

const DIRECTIVES = ['owt', 'title', 'ppq', 'meter', 'tempo', 'key', 'track', 'end'] as const

export function repairCommonOwtErrors(source: string): OwtRepairResult {
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
  return { text, changes: [...new Set(changes)], valid: parseOwt(text).document !== undefined }
}
