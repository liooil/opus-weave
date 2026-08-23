import type { DesktopWindowOptions, ProviderFailureKind } from 'bundesk'

export const RECOVERABLE_WINDOW_PROVIDER_FAILURES = [
  'unsupported',
  'unavailable',
  'launch-failed',
  'ready-failed',
  'closed-early',
] as const satisfies readonly ProviderFailureKind[]

export function desktopWindowProviderPolicy(
  platform: NodeJS.Platform,
): Pick<DesktopWindowOptions, 'provider' | 'fallback'> {
  if (platform === 'darwin') {
    return {
      // Preserve WebMIDI when a capable browser is installed, but always keep
      // the built-in WKWebView as the final no-installation-required fallback.
      provider: 'chromium-app',
      fallback: [
        { provider: 'firefox-window', on: RECOVERABLE_WINDOW_PROVIDER_FAILURES },
        { provider: 'wkwebview', on: RECOVERABLE_WINDOW_PROVIDER_FAILURES },
      ],
    }
  }

  return { provider: 'chromium-app' }
}
