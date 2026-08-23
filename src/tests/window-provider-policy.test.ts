import { describe, expect, test } from 'bun:test'
import { desktopWindowProviderPolicy, RECOVERABLE_WINDOW_PROVIDER_FAILURES } from '../window-provider-policy.ts'

describe('desktop window provider policy', () => {
  test('preserves browser capabilities before falling back to native WKWebView on macOS', () => {
    expect(desktopWindowProviderPolicy('darwin')).toEqual({
      provider: 'chromium-app',
      fallback: [
        { provider: 'firefox-window', on: RECOVERABLE_WINDOW_PROVIDER_FAILURES },
        { provider: 'wkwebview', on: RECOVERABLE_WINDOW_PROVIDER_FAILURES },
      ],
    })
  })

  test('falls back for every recoverable failure without hiding invalid configuration', () => {
    expect(RECOVERABLE_WINDOW_PROVIDER_FAILURES).toEqual([
      'unsupported',
      'unavailable',
      'launch-failed',
      'ready-failed',
      'closed-early',
    ])
    expect(RECOVERABLE_WINDOW_PROVIDER_FAILURES).not.toContain('invalid-config')
  })

  test('keeps the existing Chromium policy on Windows and Linux', () => {
    expect(desktopWindowProviderPolicy('win32')).toEqual({ provider: 'chromium-app' })
    expect(desktopWindowProviderPolicy('linux')).toEqual({ provider: 'chromium-app' })
  })
})
