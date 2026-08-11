export type ScoreFileKind = 'owt' | 'midi' | 'ai-media'

/** Route the unified Open / Import input without sniffing file contents. */
export function scoreFileKind(name: string, mimeType = ''): ScoreFileKind {
  const lowerName = name.toLowerCase()
  const lowerType = mimeType.toLowerCase()
  if (lowerName.endsWith('.owt') || lowerName.endsWith('.txt') || lowerType === 'text/plain') return 'owt'
  if (lowerName.endsWith('.mid') || lowerName.endsWith('.midi') || lowerType === 'audio/midi' || lowerType === 'audio/x-midi') return 'midi'
  return 'ai-media'
}
