import { describe, expect, test } from 'bun:test'
import { nextThemePreference, normalizeThemePreference, resolveTheme } from '../web/theme.ts'

describe('theme preference', () => {
  test('defaults invalid or missing values to the system theme', () => {
    expect(normalizeThemePreference(null)).toBe('system')
    expect(normalizeThemePreference('sepia')).toBe('system')
    expect(normalizeThemePreference('light')).toBe('light')
  })

  test('cycles through light, dark and system', () => {
    expect(nextThemePreference('light')).toBe('dark')
    expect(nextThemePreference('dark')).toBe('system')
    expect(nextThemePreference('system')).toBe('light')
  })

  test('only consults the OS preference in system mode', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })
})
