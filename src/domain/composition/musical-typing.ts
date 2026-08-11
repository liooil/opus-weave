export type MusicalTypingMode = 'english' | 'pinyin'

export interface MusicalTypingStep {
  pitches: number[]
  nextDegree: number
}

const C_MAJOR_PENTATONIC = [60, 62, 64, 67, 69, 72, 74, 76, 79, 81] as const
const PINYIN_VOWEL_DEGREES: Record<string, number> = { a: 0, o: 1, e: 2, i: 3, u: 4, v: 2 }
const PINYIN_TONE_CONTOURS: Record<string, readonly number[]> = {
  '1': [0, 0],
  '2': [-1, 1],
  '3': [0, -1, 1],
  '4': [1, -1],
}

function clampDegree(value: number): number {
  return Math.max(0, Math.min(C_MAJOR_PENTATONIC.length - 1, value))
}

function nearestDegree(pitchClassDegree: number, previousDegree: number, direction: number): number {
  const candidates = [pitchClassDegree, pitchClassDegree + 5]
  return candidates.reduce((best, candidate) => {
    const distance = Math.abs(candidate - previousDegree)
    const bestDistance = Math.abs(best - previousDegree)
    if (distance !== bestDistance) return distance < bestDistance ? candidate : best
    return direction >= 0 ? Math.max(best, candidate) : Math.min(best, candidate)
  })
}

function englishDegree(character: string, previousDegree: number): number {
  const index = character.charCodeAt(0) - 97
  const pitchClassDegree = (index * 3 + Math.floor(index / 5)) % 5
  return nearestDegree(pitchClassDegree, previousDegree, index % 2 === 0 ? 1 : -1)
}

function pinyinDegree(character: string, previousDegree: number): number {
  const vowel = PINYIN_VOWEL_DEGREES[character]
  if (vowel !== undefined) return nearestDegree(vowel, previousDegree, 1)
  const index = character.charCodeAt(0) - 97
  const consonantGroup = Math.abs(index * 2 + 1) % 5
  return nearestDegree(consonantGroup, previousDegree, index % 3 === 0 ? -1 : 1)
}

export function musicalTypingStep(character: string, mode: MusicalTypingMode, previousDegree = 2): MusicalTypingStep | null {
  const normalized = character.toLowerCase()
  if (mode === 'pinyin' && PINYIN_TONE_CONTOURS[normalized]) {
    const contour = PINYIN_TONE_CONTOURS[normalized]!
    const degrees = contour.map((offset) => clampDegree(previousDegree + offset))
    return { pitches: degrees.map((degree) => C_MAJOR_PENTATONIC[degree]!), nextDegree: degrees.at(-1)! }
  }
  if (/^[a-z]$/.test(normalized)) {
    const nextDegree = mode === 'pinyin'
      ? pinyinDegree(normalized, previousDegree)
      : englishDegree(normalized, previousDegree)
    return { pitches: [C_MAJOR_PENTATONIC[nextDegree]!], nextDegree }
  }
  if (/^[\s,.;:!?，。！？]$/.test(character)) {
    const nextDegree = previousDegree >= 5 ? 5 : 0
    return { pitches: [C_MAJOR_PENTATONIC[nextDegree]!], nextDegree }
  }
  return null
}

function noteName(note: number): string {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  return `${names[note % 12]}${Math.floor(note / 12) - 1}`
}

export function musicalTypingPitches(text: string, mode: MusicalTypingMode): number[] {
  const pitches: number[] = []
  let degree = 2
  for (const character of text) {
    const step = musicalTypingStep(character, mode, degree)
    if (!step) continue
    pitches.push(...step.pitches)
    degree = step.nextDegree
  }
  return pitches
}

const CHORDS = [
  '[C3 E3 G3]:4',
  '[A2 C3 E3]:4',
  '[F2 A2 C3]:4',
  '[G2 B2 D3]:4',
] as const

export function pitchesToOwt(sourcePitches: readonly number[], text: string, trackName: string): string {
  const pitches = sourcePitches.length > 0 ? sourcePitches.slice() : [60]
  while (pitches.length % 8 !== 0) pitches.push(-1)
  const bars: string[] = []
  for (let index = 0; index < pitches.length; index += 8) {
    bars.push(`| ${pitches.slice(index, index + 8).map((pitch) => pitch < 0 ? 'R:1/2' : `${noteName(pitch)}:1/2`).join(' ')} |`)
  }
  const titleSource = text.trim().replace(/\s+/g, ' ').slice(0, 42)
  const title = (titleSource || 'Keyboard Performance').replace(/["\\]/g, '')
  const harmony = bars.map((_, index) => `| ${CHORDS[index % CHORDS.length]} |`).join('\n')
  return `owt 0.1 score

title "${title} — Keyboard Performance"
ppq 480
meter 1:1 4/4
tempo 1:1 104
key 1:1 C major

track "${trackName}" channel=1 program=0 velocity=92
${bars.join('\n')}

track "Harmony" channel=2 program=0 velocity=58
${harmony}
end
`
}

export function musicalTypingToOwt(text: string, mode: MusicalTypingMode): string {
  return pitchesToOwt(musicalTypingPitches(text, mode), text, mode === 'pinyin' ? 'Pinyin Melody' : 'English Melody')
}
