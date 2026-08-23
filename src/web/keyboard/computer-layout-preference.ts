import type { BuiltinComputerLayoutId } from '../../domain/devices/mapping-engine.ts'
import type { Locale } from '../i18n.ts'

export interface ComputerLayoutEnvironment {
  locale: Locale
  hasHardwareKeyboard: boolean | null
  hasMidiInput: boolean
}

/**
 * Resolve the active computer-keyboard layout without overriding an explicit
 * user choice. Unknown keyboard availability keeps the locale-aware desktop
 * default; only a positively detected touch-only device disables mapping.
 */
export function resolveComputerLayoutPreference(
  savedLayout: BuiltinComputerLayoutId | null,
  environment: ComputerLayoutEnvironment,
): BuiltinComputerLayoutId {
  if (savedLayout) return savedLayout
  if (environment.hasMidiInput || environment.hasHardwareKeyboard === false) return 'none'
  return environment.locale === 'zh-CN' ? 'pinyin' : 'english'
}
