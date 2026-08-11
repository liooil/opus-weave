import { describe, expect, test } from 'bun:test'
import { scoreFileKind } from '../web/open-file.ts'

describe('unified score opening', () => {
  test('routes OWT and text directly to the editor', () => {
    expect(scoreFileKind('score.owt')).toBe('owt')
    expect(scoreFileKind('score.txt', 'text/plain')).toBe('owt')
  })

  test('routes MIDI through deterministic conversion', () => {
    expect(scoreFileKind('performance.mid')).toBe('midi')
    expect(scoreFileKind('performance.bin', 'audio/x-midi')).toBe('midi')
  })

  test('routes score images and MP4 to AI', () => {
    expect(scoreFileKind('staff.png', 'image/png')).toBe('ai-media')
    expect(scoreFileKind('jianpu.mp4', 'video/mp4')).toBe('ai-media')
  })
})
