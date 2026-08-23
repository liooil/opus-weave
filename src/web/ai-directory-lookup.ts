import { aiProviderHint } from '../domain/ai/providers.ts'
import { modelDirectory, type ModelDirectoryModel, type ModelDirectoryProvider } from './models-directory.ts'

export interface AiDirectoryLookupConfig {
  baseUrl: string
  model: string
}

const OFFICIAL_DIRECTORY_PROVIDER_IDS = new Set(['openai', 'anthropic', 'deepseek', 'openrouter'])

function normalizeDirectoryUrl(url: string): string {
  return url.trim().toLowerCase().replace(/\/+$/, '')
}

/**
 * Find catalog metadata by exact endpoint first, then by a deliberately
 * recognized provider-compatible host. This treats URL variants such as
 * DeepSeek's optional `/v1` suffix and OpusWeave's managed proxy as the same
 * pricing family without assigning arbitrary proxy endpoints official rates.
 */
export function findAiDirectoryModel(
  config: AiDirectoryLookupConfig,
  directory: readonly ModelDirectoryProvider[] = modelDirectory,
): { provider: ModelDirectoryProvider; model: ModelDirectoryModel } | undefined {
  if (!config.baseUrl || !config.model) return undefined
  const base = normalizeDirectoryUrl(config.baseUrl)
  let provider = directory.find((entry) => normalizeDirectoryUrl(entry.api) === base)
  if (!provider) {
    let providerId: string | undefined
    try { providerId = aiProviderHint(config.baseUrl) } catch { providerId = undefined }
    if (providerId && OFFICIAL_DIRECTORY_PROVIDER_IDS.has(providerId)) {
      provider = directory.find((entry) => entry.id === providerId)
    }
  }
  const model = provider?.models.find((entry) => entry.id === config.model)
  return provider && model ? { provider, model } : undefined
}
