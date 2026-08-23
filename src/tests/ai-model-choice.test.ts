import { describe, expect, test } from 'bun:test'
import { AI_CUSTOM_MODEL_VALUE, resolveAiModelChoice, selectedAiModelId } from '../web/ai-model-choice.ts'

describe('AI model choice', () => {
  const available = ['gpt-5', 'gpt-5-mini']

  test('selects a saved model when it is available', () => {
    expect(resolveAiModelChoice('gpt-5-mini', available)).toEqual({
      selection: 'gpt-5-mini',
      customModel: '',
    })
  })

  test('uses Custom for a saved model absent from discovery', () => {
    expect(resolveAiModelChoice('local-special', available)).toEqual({
      selection: AI_CUSTOM_MODEL_VALUE,
      customModel: 'local-special',
    })
  })

  test('defaults to the first discovered model when no model is saved', () => {
    expect(resolveAiModelChoice('', available)).toEqual({
      selection: 'gpt-5',
      customModel: '',
    })
    expect(resolveAiModelChoice('', [])).toEqual({
      selection: AI_CUSTOM_MODEL_VALUE,
      customModel: '',
    })
  })

  test('only reads the manual input while Custom is selected', () => {
    expect(selectedAiModelId('gpt-5', 'ignored')).toBe('gpt-5')
    expect(selectedAiModelId(AI_CUSTOM_MODEL_VALUE, '  local-special  ')).toBe('local-special')
  })
})
