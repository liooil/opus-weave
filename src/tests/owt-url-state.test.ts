import { describe, expect, test } from 'bun:test'
import { decodeOwtHash, encodeOwtHash } from '../web/owt-url-state.ts'

describe('OWT URL state', () => {
  test('round-trips Unicode OWT as a URL-safe hash', () => {
    const score = 'owt 0.1 score\n\ntitle "下雨了 / Après la pluie"\ntrack "旋律" channel=1 program=0 velocity=88\n| C4:1 D4:1 E4:1 F4:1 |\nend\n'
    const hash = encodeOwtHash(score)
    expect(hash).toMatch(/^#owt=[A-Za-z0-9_-]+$/)
    expect(decodeOwtHash(hash)).toBe(score)
  })

  test('handles scores larger than one encoder chunk', () => {
    const score = `owt 0.1 score\n${'| C4:1 D4:1 E4:1 F4:1 |\n'.repeat(5000)}end\n`
    expect(decodeOwtHash(encodeOwtHash(score))).toBe(score)
  })

  test('rejects unrelated, malformed and invalid UTF-8 hashes', () => {
    expect(decodeOwtHash('#section')).toBeNull()
    expect(decodeOwtHash('#owt=%%%')).toBeNull()
    expect(decodeOwtHash('#owt=A')).toBeNull()
    expect(decodeOwtHash('#owt=_w')).toBeNull()
  })
})
