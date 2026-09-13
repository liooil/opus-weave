/** Official model alias migration, verified 2026-09-12 against DeepSeek's API docs. */
export const DEEPSEEK_FLASH_MODEL = 'deepseek-flash'

export function currentDeepSeekModel(baseUrl: string, model: string): string {
  try {
    if (new URL(baseUrl).hostname.toLowerCase() !== 'api.deepseek.com') return model
  } catch { return model }
  return ['deepseek-v4-flash', 'deepseek-v4-flash-vision-exp'].includes(model.trim()) ? DEEPSEEK_FLASH_MODEL : model
}
