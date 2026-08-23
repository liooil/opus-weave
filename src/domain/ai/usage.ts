/** Provider-neutral token counts for one completed AI request. */
export interface AiTokenUsage {
  /** All input tokens, including cache reads and cache writes. */
  inputTokens: number
  /** Input tokens served from a provider cache. This is a subset of inputTokens. */
  cachedInputTokens: number
  /** Input tokens written to a provider cache. This is a subset of inputTokens. */
  cacheWriteInputTokens: number
  /** All generated tokens. Reasoning tokens are included here. */
  outputTokens: number
  /** Hidden/separate reasoning tokens. This is a subset of outputTokens. */
  reasoningTokens: number
  totalTokens: number
}

/** Prices per one million tokens, expressed in one caller-selected currency. */
export interface AiTokenRatesPerMillion {
  input?: number
  output?: number
  cacheRead?: number
  cacheWrite?: number
}

export interface AiUsageCostEstimate {
  uncachedInput: number
  cachedInput: number
  cacheWriteInput: number
  output: number
  total: number
  /** False when at least one used token category has no known rate. */
  complete: boolean
}

export const EMPTY_AI_TOKEN_USAGE: AiTokenUsage = {
  inputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteInputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  totalTokens: 0,
}

export function addAiTokenUsage(...values: readonly AiTokenUsage[]): AiTokenUsage {
  return values.reduce<AiTokenUsage>((sum, value) => ({
    inputTokens: sum.inputTokens + value.inputTokens,
    cachedInputTokens: sum.cachedInputTokens + value.cachedInputTokens,
    cacheWriteInputTokens: sum.cacheWriteInputTokens + value.cacheWriteInputTokens,
    outputTokens: sum.outputTokens + value.outputTokens,
    reasoningTokens: sum.reasoningTokens + value.reasoningTokens,
    totalTokens: sum.totalTokens + value.totalTokens,
  }), { ...EMPTY_AI_TOKEN_USAGE })
}

/**
 * Merge cumulative snapshots belonging to the same streaming request.
 * Providers may repeat usage in multiple chunks, so summing would overcount.
 */
export function mergeAiTokenUsageSnapshots(previous: AiTokenUsage | undefined, next: AiTokenUsage): AiTokenUsage {
  if (!previous) return next
  const merged = {
    inputTokens: Math.max(previous.inputTokens, next.inputTokens),
    cachedInputTokens: Math.max(previous.cachedInputTokens, next.cachedInputTokens),
    cacheWriteInputTokens: Math.max(previous.cacheWriteInputTokens, next.cacheWriteInputTokens),
    outputTokens: Math.max(previous.outputTokens, next.outputTokens),
    reasoningTokens: Math.max(previous.reasoningTokens, next.reasoningTokens),
    totalTokens: 0,
  }
  merged.totalTokens = Math.max(previous.totalTokens, next.totalTokens, merged.inputTokens + merged.outputTokens)
  return merged
}

/**
 * Estimate a request cost from catalog rates. Reasoning is already part of
 * outputTokens and is deliberately not charged a second time.
 */
export function estimateAiUsageCost(
  usage: AiTokenUsage,
  rates: AiTokenRatesPerMillion,
): AiUsageCostEstimate | undefined {
  const cached = Math.min(usage.inputTokens, usage.cachedInputTokens)
  const cacheWrite = Math.min(Math.max(0, usage.inputTokens - cached), usage.cacheWriteInputTokens)
  const uncached = Math.max(0, usage.inputTokens - cached - cacheWrite)
  let complete = true
  let pricedCategory = false

  const price = (tokens: number, rate: number | undefined): number => {
    if (tokens === 0) return 0
    if (rate === undefined || !Number.isFinite(rate) || rate < 0) {
      complete = false
      return 0
    }
    pricedCategory = true
    return tokens * rate / 1_000_000
  }

  const uncachedInput = price(uncached, rates.input)
  // If a catalog has no special cache rate, use its ordinary input rate.
  const cachedInput = price(cached, rates.cacheRead ?? rates.input)
  // Cache writes can carry a provider-specific multiplier; do not silently
  // substitute the ordinary input rate when the catalog omits it.
  const cacheWriteInput = price(cacheWrite, rates.cacheWrite)
  const output = price(usage.outputTokens, rates.output)
  if (!pricedCategory) return undefined
  return {
    uncachedInput,
    cachedInput,
    cacheWriteInput,
    output,
    total: uncachedInput + cachedInput + cacheWriteInput + output,
    complete,
  }
}
