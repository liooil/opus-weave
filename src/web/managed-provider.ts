import { AiProviderHttpError, type AiProtocol } from '../domain/ai/providers.ts'

export const MANAGED_PROVIDER_ID = 'opusweave-managed'

export const MANAGED_PROVIDER = {
  id: MANAGED_PROVIDER_ID,
  name: 'OpusWeave 托管（DeepSeek V4 Flash · 每日共享免费额度）',
  api: 'https://ai.xiteng.site/v1',
  protocol: 'openai-chat-completions' satisfies AiProtocol,
  modelId: 'deepseek-v4-flash',
  modelName: 'DeepSeek V4 Flash（托管）',
} as const

export interface ManagedQuota {
  spentCny: number
  limitCny: number
  retryAfter?: string
}

interface ManagedProviderConnection {
  baseUrl: string
  model: string
  protocol: AiProtocol
}

/** New or completely empty UI profiles start with the managed provider. */
export function defaultManagedConnectionWhenUnset(
  config: { baseUrl?: unknown; model?: unknown },
): Partial<ManagedProviderConnection> {
  const hasBaseUrl = typeof config.baseUrl === 'string' && config.baseUrl.trim().length > 0
  const hasModel = typeof config.model === 'string' && config.model.trim().length > 0
  if (hasBaseUrl || hasModel) return {}
  return {
    baseUrl: MANAGED_PROVIDER.api,
    model: MANAGED_PROVIDER.modelId,
    protocol: MANAGED_PROVIDER.protocol,
  }
}

function normalizedProviderUrl(value: string): string {
  return value.trim().toLowerCase().replace(/\/+$/, '')
}

/** Managed mode is derived from the endpoint, so no extra setting is persisted. */
export function isManagedProviderBaseUrl(baseUrl: string): boolean {
  return normalizedProviderUrl(baseUrl) === normalizedProviderUrl(MANAGED_PROVIDER.api)
}

function finiteNonNegativeHeader(headers: Headers, name: string): number | undefined {
  const raw = headers.get(name)
  if (raw === null || raw.trim() === '') return undefined
  const value = Number(raw)
  return Number.isFinite(value) && value >= 0 ? value : undefined
}

export function managedQuotaFromHeaders(headers: Headers): ManagedQuota | undefined {
  const spentCny = finiteNonNegativeHeader(headers, 'x-quota-spent-cny')
  const limitCny = finiteNonNegativeHeader(headers, 'x-quota-limit-cny')
  if (spentCny === undefined || limitCny === undefined) return undefined
  return {
    spentCny,
    limitCny,
    retryAfter: headers.get('retry-after') ?? undefined,
  }
}

export function isManagedQuotaExceededError(error: unknown): boolean {
  return error instanceof AiProviderHttpError && error.status === 429
}
