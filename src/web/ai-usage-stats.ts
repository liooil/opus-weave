import { addAiTokenUsage, EMPTY_AI_TOKEN_USAGE, estimateAiUsageCost, type AiTokenRatesPerMillion, type AiTokenUsage } from '../domain/ai/usage.ts'
import { AI_BILLING_CURRENCIES, type AiBillingCurrency } from '../domain/ai/pricing.ts'

export type AiUsageRatesByCurrency = Partial<Record<AiBillingCurrency, AiTokenRatesPerMillion>>
export type AiUsageCostsByCurrency = Partial<Record<AiBillingCurrency, number>>
export type AiUsageCompletenessByCurrency = Record<AiBillingCurrency, boolean>
export type AiUsageTotalsByCurrency = Record<AiBillingCurrency, number>

export interface AiUsageRecord {
  provider: string
  model: string
  usage: AiTokenUsage
  estimatedCosts: AiUsageCostsByCurrency
  hasCompleteRates: AiUsageCompletenessByCurrency
}

export interface AiUsageSessionStats {
  requestCount: number
  usage: AiTokenUsage
  estimatedCosts: AiUsageTotalsByCurrency
  pricedRequestCounts: AiUsageTotalsByCurrency
  unpricedRequestCounts: AiUsageTotalsByCurrency
  last?: AiUsageRecord
}

export function emptyAiUsageSession(): AiUsageSessionStats {
  return {
    requestCount: 0,
    usage: { ...EMPTY_AI_TOKEN_USAGE },
    estimatedCosts: { CNY: 0, USD: 0 },
    pricedRequestCounts: { CNY: 0, USD: 0 },
    unpricedRequestCounts: { CNY: 0, USD: 0 },
  }
}

export function createAiUsageRecord(
  provider: string,
  model: string,
  usage: AiTokenUsage,
  ratesByCurrency: AiUsageRatesByCurrency = {},
): AiUsageRecord {
  const estimatedCosts: AiUsageCostsByCurrency = {}
  const hasCompleteRates: AiUsageCompletenessByCurrency = { CNY: false, USD: false }
  for (const currency of AI_BILLING_CURRENCIES) {
    const rates = ratesByCurrency[currency]
    const estimate = rates ? estimateAiUsageCost(usage, rates) : undefined
    if (estimate?.complete === true) {
      estimatedCosts[currency] = estimate.total
      hasCompleteRates[currency] = true
    }
  }
  return {
    provider,
    model,
    usage,
    estimatedCosts,
    hasCompleteRates,
  }
}

export function appendAiUsageRecord(session: AiUsageSessionStats, record: AiUsageRecord): AiUsageSessionStats {
  const estimatedCosts = { ...session.estimatedCosts }
  const pricedRequestCounts = { ...session.pricedRequestCounts }
  const unpricedRequestCounts = { ...session.unpricedRequestCounts }
  for (const currency of AI_BILLING_CURRENCIES) {
    estimatedCosts[currency] += record.estimatedCosts[currency] ?? 0
    pricedRequestCounts[currency] += record.hasCompleteRates[currency] ? 1 : 0
    unpricedRequestCounts[currency] += record.hasCompleteRates[currency] ? 0 : 1
  }
  return {
    requestCount: session.requestCount + 1,
    usage: addAiTokenUsage(session.usage, record.usage),
    estimatedCosts,
    pricedRequestCounts,
    unpricedRequestCounts,
    last: record,
  }
}

/** Reprice the only request in a session after catalog matching improves. */
export function repriceSingleAiUsageSession(
  session: AiUsageSessionStats,
  ratesByCurrency: AiUsageRatesByCurrency,
): AiUsageSessionStats {
  if (session.requestCount !== 1 || !session.last) return session
  const replacement = createAiUsageRecord(session.last.provider, session.last.model, session.last.usage, ratesByCurrency)
  const improvesEstimate = AI_BILLING_CURRENCIES.some((currency) => !session.last!.hasCompleteRates[currency] && replacement.hasCompleteRates[currency])
  return improvesEstimate ? appendAiUsageRecord(emptyAiUsageSession(), replacement) : session
}

function safeNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

function safeUsage(value: unknown): AiTokenUsage | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const usage = value as Record<string, unknown>
  const inputTokens = safeNonNegativeInteger(usage.inputTokens)
  const cachedInputTokens = safeNonNegativeInteger(usage.cachedInputTokens)
  const cacheWriteInputTokens = safeNonNegativeInteger(usage.cacheWriteInputTokens)
  const outputTokens = safeNonNegativeInteger(usage.outputTokens)
  const reasoningTokens = safeNonNegativeInteger(usage.reasoningTokens)
  const totalTokens = safeNonNegativeInteger(usage.totalTokens)
  if ([inputTokens, cachedInputTokens, cacheWriteInputTokens, outputTokens, reasoningTokens, totalTokens].some((item) => item === undefined)) return undefined
  return { inputTokens: inputTokens!, cachedInputTokens: cachedInputTokens!, cacheWriteInputTokens: cacheWriteInputTokens!, outputTokens: outputTokens!, reasoningTokens: reasoningTokens!, totalTokens: totalTokens! }
}

function safeCurrencyNumbers(value: unknown, integer: boolean): AiUsageTotalsByCurrency | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const numbers = value as Record<string, unknown>
  const result = {} as AiUsageTotalsByCurrency
  for (const currency of AI_BILLING_CURRENCIES) {
    const amount = numbers[currency]
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || (integer && !Number.isSafeInteger(amount))) return undefined
    result[currency] = amount
  }
  return result
}

function safeCurrencyBooleans(value: unknown): AiUsageCompletenessByCurrency | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const booleans = value as Record<string, unknown>
  if (typeof booleans.CNY !== 'boolean' || typeof booleans.USD !== 'boolean') return undefined
  return { CNY: booleans.CNY, USD: booleans.USD }
}

function safeEstimatedCosts(value: unknown): AiUsageCostsByCurrency | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const costs = value as Record<string, unknown>
  const result: AiUsageCostsByCurrency = {}
  for (const currency of AI_BILLING_CURRENCIES) {
    const amount = costs[currency]
    if (amount === undefined) continue
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) return undefined
    result[currency] = amount
  }
  return result
}

/** Restore only data written by this module; malformed/old values start fresh. */
export function parseAiUsageSession(value: string | null): AiUsageSessionStats {
  if (!value) return emptyAiUsageSession()
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>
    const usage = safeUsage(parsed.usage)
    const requestCount = safeNonNegativeInteger(parsed.requestCount)
    const estimatedCosts = safeCurrencyNumbers(parsed.estimatedCosts, false)
    const pricedRequestCounts = safeCurrencyNumbers(parsed.pricedRequestCounts, true)
    const unpricedRequestCounts = safeCurrencyNumbers(parsed.unpricedRequestCounts, true)
    if (!usage || requestCount === undefined || !estimatedCosts || !pricedRequestCounts || !unpricedRequestCounts) return emptyAiUsageSession()
    const lastValue = parsed.last && typeof parsed.last === 'object' && !Array.isArray(parsed.last) ? parsed.last as Record<string, unknown> : undefined
    const lastUsage = safeUsage(lastValue?.usage)
    const lastEstimatedCosts = safeEstimatedCosts(lastValue?.estimatedCosts)
    const lastCompleteRates = safeCurrencyBooleans(lastValue?.hasCompleteRates)
    const last = lastValue && lastUsage && lastEstimatedCosts && lastCompleteRates && typeof lastValue.provider === 'string' && typeof lastValue.model === 'string'
      ? {
          provider: lastValue.provider,
          model: lastValue.model,
          usage: lastUsage,
          estimatedCosts: lastEstimatedCosts,
          hasCompleteRates: lastCompleteRates,
        }
      : undefined
    return { requestCount, usage, estimatedCosts, pricedRequestCounts, unpricedRequestCounts, ...(last ? { last } : {}) }
  } catch {
    return emptyAiUsageSession()
  }
}
