import { describe, expect, test } from 'bun:test'
import { appendAiUsageRecord, createAiUsageRecord, emptyAiUsageSession, parseAiUsageSession } from '../web/ai-usage-stats.ts'

const usage = { inputTokens: 1000, cachedInputTokens: 800, cacheWriteInputTokens: 0, outputTokens: 250, reasoningTokens: 90, totalTokens: 1250 }

describe('AI usage session statistics', () => {
  test('aggregates priced and unpriced requests without inventing costs', () => {
    const priced = createAiUsageRecord('DeepSeek', 'deepseek-v4-flash', usage, {
      USD: { input: 0.14, cacheRead: 0.0028, output: 0.28 },
      CNY: { input: 1, cacheRead: 0.02, output: 2 },
    })
    const unpriced = createAiUsageRecord('Custom', 'local-model', usage)
    const session = appendAiUsageRecord(appendAiUsageRecord(emptyAiUsageSession(), priced), unpriced)
    expect(session).toMatchObject({
      requestCount: 2,
      pricedRequestCounts: { CNY: 1, USD: 1 },
      unpricedRequestCounts: { CNY: 1, USD: 1 },
    })
    expect(session.usage).toMatchObject({ inputTokens: 2000, cachedInputTokens: 1600, outputTokens: 500, reasoningTokens: 180 })
    expect(session.estimatedCosts.USD).toBeCloseTo(0.00010024)
    expect(session.estimatedCosts.CNY).toBeCloseTo(0.000716)
    expect(session.last?.estimatedCosts).toEqual({})
  })

  test('round-trips valid session data and rejects malformed storage', () => {
    const session = appendAiUsageRecord(emptyAiUsageSession(), createAiUsageRecord('DeepSeek', 'deepseek-v4-flash', usage, {
      USD: { input: 0.14, cacheRead: 0.0028, output: 0.28 },
      CNY: { input: 1, cacheRead: 0.02, output: 2 },
    }))
    expect(parseAiUsageSession(JSON.stringify(session))).toEqual(session)
    expect(parseAiUsageSession('{oops')).toEqual(emptyAiUsageSession())
    expect(parseAiUsageSession(JSON.stringify({ ...session, requestCount: -1 }))).toEqual(emptyAiUsageSession())
  })
})
