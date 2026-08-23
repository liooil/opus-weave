import { describe, expect, test } from 'bun:test'
import { resolveComputerLayoutPreference } from '../web/keyboard/computer-layout-preference.ts'
import { keyboardSectionsForLayout } from '../web/keyboard/layout-view-model.ts'

describe('computer keyboard layout preference', () => {
  test('defaults to no mapping on touch-only devices', () => {
    expect(resolveComputerLayoutPreference(null, {
      locale: 'zh-CN',
      hasHardwareKeyboard: false,
      hasMidiInput: false,
    })).toBe('none')
  })

  test('defaults to no mapping when a MIDI input is available', () => {
    expect(resolveComputerLayoutPreference(null, {
      locale: 'en',
      hasHardwareKeyboard: true,
      hasMidiInput: true,
    })).toBe('none')
  })

  test('uses locale defaults when a computer keyboard is available or unknown', () => {
    expect(resolveComputerLayoutPreference(null, {
      locale: 'en',
      hasHardwareKeyboard: true,
      hasMidiInput: false,
    })).toBe('english')
    expect(resolveComputerLayoutPreference(null, {
      locale: 'zh-CN',
      hasHardwareKeyboard: null,
      hasMidiInput: false,
    })).toBe('pinyin')
  })

  test('never overrides an explicit user selection', () => {
    expect(resolveComputerLayoutPreference('freepiano', {
      locale: 'zh-CN',
      hasHardwareKeyboard: false,
      hasMidiInput: true,
    })).toBe('freepiano')
    expect(resolveComputerLayoutPreference('none', {
      locale: 'en',
      hasHardwareKeyboard: true,
      hasMidiInput: false,
    })).toBe('none')
  })

  test('renders no computer key rows for the no-mapping layout', () => {
    expect(keyboardSectionsForLayout('none')).toEqual([])
  })
})
