import { describe, expect, test } from 'bun:test'
import { AiProviderHttpError } from '../domain/ai/providers.ts'
import { isManagedProviderBaseUrl, isManagedQuotaExceededError, managedQuotaFromHeaders, MANAGED_PROVIDER, MANAGED_PROVIDER_ID } from '../web/managed-provider.ts'

describe('OpusWeave managed AI provider', () => {
  test('defines the fixed managed endpoint, protocol, and model', () => {
    expect(MANAGED_PROVIDER).toMatchObject({
      id: MANAGED_PROVIDER_ID,
      api: 'https://ai.xiteng.site/v1',
      protocol: 'openai-chat-completions',
      modelId: 'deepseek-v4-flash',
    })
    expect(isManagedProviderBaseUrl('https://ai.xiteng.site/v1/')).toBeTrue()
    expect(isManagedProviderBaseUrl('https://api.deepseek.com')).toBeFalse()
  })

  test('parses quota response headers without accepting incomplete values', () => {
    expect(managedQuotaFromHeaders(new Headers({
      'x-quota-spent-cny': '0.125',
      'x-quota-limit-cny': '10',
      'retry-after': '60',
    }))).toEqual({ spentCny: 0.125, limitCny: 10, retryAfter: '60' })
    expect(managedQuotaFromHeaders(new Headers({ 'x-quota-spent-cny': '1' }))).toBeUndefined()
    expect(managedQuotaFromHeaders(new Headers({ 'x-quota-spent-cny': '-1', 'x-quota-limit-cny': '10' }))).toBeUndefined()
  })

  test('recognizes managed quota exhaustion by HTTP status', () => {
    expect(isManagedQuotaExceededError(new AiProviderHttpError(429, 'quota exceeded', '3600'))).toBeTrue()
    expect(isManagedQuotaExceededError(new AiProviderHttpError(401, 'unauthorized'))).toBeFalse()
  })
})
