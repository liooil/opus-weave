export const THEME_PREFERENCES = ['light', 'dark', 'system'] as const

export type ThemePreference = typeof THEME_PREFERENCES[number]
export type EffectiveTheme = Exclude<ThemePreference, 'system'>

export function normalizeThemePreference(value: string | null): ThemePreference {
  return THEME_PREFERENCES.includes(value as ThemePreference) ? value as ThemePreference : 'system'
}

export function nextThemePreference(theme: ThemePreference): ThemePreference {
  if (theme === 'light') return 'dark'
  if (theme === 'dark') return 'system'
  return 'light'
}

export function resolveTheme(theme: ThemePreference, systemPrefersDark: boolean): EffectiveTheme {
  if (theme === 'system') return systemPrefersDark ? 'dark' : 'light'
  return theme
}
