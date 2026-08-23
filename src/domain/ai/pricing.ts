import type { AiTokenRatesPerMillion } from './usage.ts'

export const AI_BILLING_CURRENCIES = ['CNY', 'USD'] as const
export type AiBillingCurrency = typeof AI_BILLING_CURRENCIES[number]
export type AiBillingCurrencyPreference = 'auto' | AiBillingCurrency

/**
 * Offline reference conversion used when a provider publishes only USD rates.
 * SAFE's 2026-08-20 central parity quote was USD 100 = CNY 678.08.
 * https://www.safe.gov.cn/AppStructured/hlw/RMBQuery.do
 */
export const AI_USD_CNY_REFERENCE_RATE = 6.7808
export const AI_USD_CNY_REFERENCE_DATE = '2026-08-20'

export type AiTokenRateOrigin = 'catalog-usd' | 'provider-cny' | 'reference-conversion'

export interface ResolvedAiTokenRates {
  currency: AiBillingCurrency
  rates: AiTokenRatesPerMillion
  origin: AiTokenRateOrigin
}

export function normalizeAiBillingCurrencyPreference(value: unknown): AiBillingCurrencyPreference {
  return value === 'CNY' || value === 'USD' ? value : 'auto'
}

export function resolveAiBillingCurrency(
  preference: AiBillingCurrencyPreference,
  locale: string,
  detectedAccountCurrency?: AiBillingCurrency,
): AiBillingCurrency {
  if (preference !== 'auto') return preference
  if (detectedAccountCurrency) return detectedAccountCurrency
  return locale.toLowerCase().startsWith('zh') ? 'CNY' : 'USD'
}

function convertRates(rates: AiTokenRatesPerMillion, multiplier: number): AiTokenRatesPerMillion {
  const convert = (value: number | undefined): number | undefined => value === undefined ? undefined : value * multiplier
  return {
    input: convert(rates.input),
    output: convert(rates.output),
    cacheRead: convert(rates.cacheRead),
    cacheWrite: convert(rates.cacheWrite),
  }
}

/**
 * DeepSeek's published CNY tariff; aliases currently point to V4 Flash.
 * https://api-docs.deepseek.com/zh-cn/quick_start/pricing
 */
function deepSeekCnyRates(modelId: string): AiTokenRatesPerMillion | undefined {
  switch (modelId.trim().toLowerCase()) {
    case 'deepseek-v4-pro':
      return { input: 3, cacheRead: 0.025, output: 6 }
    case 'deepseek-v4-flash':
    case 'deepseek-chat':
    case 'deepseek-reasoner':
      return { input: 1, cacheRead: 0.02, output: 2 }
    default:
      return undefined
  }
}

/**
 * Resolve a catalog's USD rates into the requested display/billing currency.
 * Native provider pricing wins over reference conversion when it is known.
 */
export function resolveAiTokenRates(
  providerId: string,
  modelId: string,
  catalogUsdRates: AiTokenRatesPerMillion | undefined,
  currency: AiBillingCurrency,
): ResolvedAiTokenRates | undefined {
  if (currency === 'CNY' && providerId.toLowerCase() === 'deepseek') {
    const rates = deepSeekCnyRates(modelId)
    if (rates) return { currency, rates, origin: 'provider-cny' }
  }
  if (!catalogUsdRates) return undefined
  if (currency === 'USD') return { currency, rates: catalogUsdRates, origin: 'catalog-usd' }
  return {
    currency,
    rates: convertRates(catalogUsdRates, AI_USD_CNY_REFERENCE_RATE),
    origin: 'reference-conversion',
  }
}
