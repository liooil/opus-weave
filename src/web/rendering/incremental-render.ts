export type IncrementalTextPatch =
  | { kind: 'none' }
  | { kind: 'append'; text: string }
  | { kind: 'replace'; text: string }

/** Prefer appending a streamed suffix; replace only when the producer revises earlier text. */
export function incrementalTextPatch(current: string, next: string): IncrementalTextPatch {
  if (current === next) return { kind: 'none' }
  if (next.startsWith(current)) return { kind: 'append', text: next.slice(current.length) }
  return { kind: 'replace', text: next }
}

/** Whether a scroll viewport was following its end before its contents changed. */
export function shouldFollowScrollEnd(
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
  tolerance = 8,
): boolean {
  return scrollHeight - clientHeight - scrollTop <= tolerance
}
