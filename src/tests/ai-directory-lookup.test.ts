import { describe, expect, test } from 'bun:test'
import { findAiDirectoryModel } from '../web/ai-directory-lookup.ts'

describe('AI model directory lookup', () => {
  test('matches optional path variants of an official DeepSeek endpoint', () => {
    for (const baseUrl of [
      'https://api.deepseek.com',
      'https://api.deepseek.com/v1',
      'https://api.deepseek.com/v1/chat/completions',
    ]) {
      const result = findAiDirectoryModel({ baseUrl, model: 'deepseek-chat' })
      expect(result?.provider.id).toBe('deepseek')
      expect(result?.model.cost).toEqual({ input: 0.14, output: 0.28, cache_read: 0.0028 })
    }
  })

  test('does not assign official rates to an unrecognized proxy', () => {
    expect(findAiDirectoryModel({ baseUrl: 'https://proxy.example/v1', model: 'deepseek-chat' })).toBeUndefined()
  })

  test('uses DeepSeek metadata for the managed model endpoint', () => {
    const result = findAiDirectoryModel({ baseUrl: 'https://ai.xiteng.site/v1', model: 'deepseek-v4-flash' })
    expect(result?.provider.id).toBe('deepseek')
    expect(result?.model.cost).toEqual({ input: 0.14, output: 0.28, cache_read: 0.0028 })
  })
})
