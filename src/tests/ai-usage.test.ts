import { describe, expect, test } from 'bun:test'
import { addAiTokenUsage, estimateAiUsageCost, mergeAiTokenUsageSnapshots, type AiTokenUsage } from '../domain/ai/usage.ts'

const usage: AiTokenUsage = {
  inputTokens: 1_000_000,
  cachedInputTokens: 250_000,
  cacheWriteInputTokens: 0,
  outputTokens: 500_000,
  reasoningTokens: 100_000,
  totalTokens: 1_500_000,
}

describe('AI usage accounting', () => {
  test('prices DeepSeek cache hits, misses and output separately', () => {
    const cost = estimateAiUsageCost(usage, { input: 0.14, cacheRead: 0.0028, output: 0.28 })
    expect(cost?.complete).toBe(true)
    expect(cost?.uncachedInput).toBeCloseTo(0.105)
    expect(cost?.cachedInput).toBeCloseTo(0.0007)
    expect(cost?.cacheWriteInput).toBe(0)
    expect(cost?.output).toBeCloseTo(0.14)
    expect(cost?.total).toBeCloseTo(0.2457)
  })

  test('does not charge reasoning tokens twice', () => {
    const withReasoning = estimateAiUsageCost(usage, { input: 1, output: 2 })
    const withoutReasoning = estimateAiUsageCost({ ...usage, reasoningTokens: 0 }, { input: 1, output: 2 })
    expect(withReasoning?.total).toBe(withoutReasoning?.total)
  })

  test('marks estimates partial when a used category has no price', () => {
    const partial = estimateAiUsageCost(usage, { input: 0.14 })
    expect(partial?.complete).toBe(false)
    expect(partial?.total).toBeCloseTo(0.14)
    expect(estimateAiUsageCost({ ...usage, cacheWriteInputTokens: 100 }, { input: 0.14, output: 0.28 })?.complete).toBe(false)
    expect(estimateAiUsageCost(usage, {})).toBeUndefined()
  })

  test('takes maxima for repeated stream snapshots and sums separate requests', () => {
    const first = { ...usage, outputTokens: 1, reasoningTokens: 0, totalTokens: 1_000_001 }
    const final = { ...usage, outputTokens: 500_000, totalTokens: 1_500_000 }
    expect(mergeAiTokenUsageSnapshots(first, final)).toEqual(usage)
    expect(addAiTokenUsage(usage, usage)).toMatchObject({
      inputTokens: 2_000_000,
      cachedInputTokens: 500_000,
      outputTokens: 1_000_000,
      reasoningTokens: 200_000,
      totalTokens: 3_000_000,
    })
  })
})
