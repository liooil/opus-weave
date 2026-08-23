import { describe, expect, test } from 'bun:test'
import { incrementalTextPatch, shouldFollowScrollEnd } from '../web/rendering/incremental-render.ts'

describe('incremental rendering', () => {
  test('appends cumulative stream suffixes without replacing existing text', () => {
    expect(incrementalTextPatch('owt 0.1', 'owt 0.1 score')).toEqual({ kind: 'append', text: ' score' })
    expect(incrementalTextPatch('same', 'same')).toEqual({ kind: 'none' })
  })

  test('replaces text when a stream revises an earlier prefix', () => {
    expect(incrementalTextPatch('C4:1', 'D4:1')).toEqual({ kind: 'replace', text: 'D4:1' })
    expect(incrementalTextPatch('longer', 'long')).toEqual({ kind: 'replace', text: 'long' })
  })

  test('auto-follows only while the viewport remains near its end', () => {
    expect(shouldFollowScrollEnd(192, 100, 300)).toBe(true)
    expect(shouldFollowScrollEnd(120, 100, 300)).toBe(false)
    expect(shouldFollowScrollEnd(0, 200, 100)).toBe(true)
  })
})
