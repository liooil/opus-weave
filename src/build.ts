/**
 * OpusWeave build script — produces a single-file binary for the current
 * platform using bundesk's bundler.
 *
 * Usage:
 *   bun src/build.ts             # native platform
 *   bun src/build.ts --linux     # cross-compile Linux x64
 *   bun src/build.ts --windows   # cross-compile Windows x64
 */
import { buildDesktopApp, type DesktopAppConfig } from 'bundesk'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

const base = {
  root,
  entrypoint: 'src/main.ts',
  minify: true,
}

const configs: DesktopAppConfig[] = []

const args = Bun.argv.slice(2)

if (args.includes('--windows')) {
  configs.push({
    ...base,
    target: 'bun-windows-x64',
    outfile: 'dist/opus-weave.exe',
    windows: {
      console: 'detached',
      icon: 'src/web/assets/app-icon.ico',
      title: 'OpusWeave',
      version: '0.1.0',
    },
  })
} else if (args.includes('--linux')) {
  configs.push({ ...base, target: 'bun-linux-x64', outfile: 'dist/opus-weave' })
} else if (process.platform === 'win32') {
  configs.push({
    ...base,
    target: 'bun-windows-x64',
    outfile: 'dist/opus-weave.exe',
    windows: { console: 'detached', icon: 'src/web/assets/app-icon.ico', title: 'OpusWeave', version: '0.1.0' },
  })
} else if (process.platform === 'darwin') {
  configs.push({
    ...base,
    target: 'bun-darwin-arm64',
    outfile: 'dist/OpusWeave.app',
    macos: {
      bundleIdentifier: 'io.github.liooil.opusweave',
      displayName: 'OpusWeave',
      icon: 'src/web/assets/AppIcon.icns',
      minimumSystemVersion: '11.0',
    },
  })
} else {
  configs.push({ ...base, target: 'bun-linux-x64', outfile: 'dist/opus-weave' })
}

for (const cfg of configs) {
  console.log(`Building for ${cfg.target}…`)
  await buildDesktopApp(cfg)
}
