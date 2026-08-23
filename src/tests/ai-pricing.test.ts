import { describe, expect, test } from 'bun:test'
import { AI_USD_CNY_REFERENCE_RATE, normalizeAiBillingCurrencyPreference, resolveAiBillingCurrency, resolveAiTokenRates } from '../domain/ai/pricing.ts'

describe('AI billing currency and rates', () => {
  test('defaults from language, while account detection and manual choice take precedence', () => {
    expect(resolveAiBillingCurrency('auto', 'zh-CN')).toBe('CNY')
    expect(resolveAiBillingCurrency('auto', 'en-US')).toBe('USD')
    expect(resolveAiBillingCurrency('auto', 'zh-CN', 'USD')).toBe('USD')
    expect(resolveAiBillingCurrency('CNY', 'en-US', 'USD')).toBe('CNY')
    expect(normalizeAiBillingCurrencyPreference('EUR')).toBe('auto')
  })

  test('uses DeepSeek native CNY pricing and keeps its USD catalog pricing', () => {
    const usd = { input: 0.14, cacheRead: 0.0028, output: 0.28 }
    expect(resolveAiTokenRates('deepseek', 'deepseek-v4-flash', usd, 'CNY')).toEqual({
      currency: 'CNY',
      rates: { input: 1, cacheRead: 0.02, output: 2 },
      origin: 'provider-cny',
    })
    expect(resolveAiTokenRates('deepseek', 'deepseek-v4-flash', usd, 'USD')).toEqual({
      currency: 'USD',
      rates: usd,
      origin: 'catalog-usd',
    })
    expect(resolveAiTokenRates('deepseek', 'deepseek-v4-pro', usd, 'CNY')?.rates).toEqual({ input: 3, cacheRead: 0.025, output: 6 })
  })

  test('converts USD-only catalog rates into CNY at the documented reference rate', () => {
    const result = resolveAiTokenRates('openai', 'example', { input: 1, output: 2 }, 'CNY')
    expect(result?.origin).toBe('reference-conversion')
    expect(result?.rates.input).toBeCloseTo(AI_USD_CNY_REFERENCE_RATE)
    expect(result?.rates.output).toBeCloseTo(AI_USD_CNY_REFERENCE_RATE * 2)
  })
})
