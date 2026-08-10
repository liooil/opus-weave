import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const outdir = resolve(root, 'dist/pages')

rmSync(outdir, { recursive: true, force: true })
mkdirSync(outdir, { recursive: true })

const result = await Bun.build({
  entrypoints: [resolve(root, 'src/web/index.html')],
  outdir,
  target: 'browser',
  minify: true,
  sourcemap: 'none',
})

if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exitCode = 1
} else {
  copyFileSync(
    resolve(root, 'node_modules/spessasynth_lib/dist/spessasynth_processor.min.js'),
    resolve(outdir, 'spessasynth_processor.min.js'),
  )
  copyFileSync(resolve(root, 'src/web/assets/app-icon-256.png'), resolve(outdir, 'pwa-icon-256.png'))
  copyFileSync(resolve(root, 'src/web/assets/app-icon-512.png'), resolve(outdir, 'pwa-icon-512.png'))

  const manifest = {
    id: './',
    name: 'OpusWeave Studio',
    short_name: 'OpusWeave',
    description: 'An executable MIDI score workstation for humans and AI.',
    start_url: './',
    scope: './',
    display: 'standalone',
    background_color: '#0b0c10',
    theme_color: '#0b0c10',
    icons: [
      { src: './pwa-icon-256.png', sizes: '256x256', type: 'image/png' },
      { src: './pwa-icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  }
  writeFileSync(resolve(outdir, 'manifest.webmanifest'), `${JSON.stringify(manifest, null, 2)}\n`)

  const htmlPath = resolve(outdir, 'index.html')
  const html = readFileSync(htmlPath, 'utf8')
  const pwaHead = `  <link rel="manifest" href="./manifest.webmanifest" />
  <meta name="application-name" content="OpusWeave" />
  <script>
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./service-worker.js', { scope: './' })
          .catch((error) => console.error('Service Worker registration failed:', error))
      })
    }
  </script>
`
  if (!html.includes('</head>')) throw new Error('Built index.html has no closing head element')
  writeFileSync(htmlPath, html.replace('</head>', `${pwaHead}</head>`))

  const precacheFiles = readdirSync(outdir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name !== '.nojekyll' && entry.name !== 'service-worker.js')
    .map((entry) => entry.name)
    .sort()
  const cacheHash = createHash('sha256')
  for (const file of precacheFiles) {
    cacheHash.update(file)
    cacheHash.update(readFileSync(resolve(outdir, file)))
  }
  const cacheName = `opusweave-${cacheHash.digest('hex').slice(0, 16)}`
  const precacheUrls = precacheFiles.map((file) => `./${file}`)
  const serviceWorker = `const CACHE_NAME = ${JSON.stringify(cacheName)}
const PRECACHE_URLS = ${JSON.stringify(precacheUrls, null, 2)}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names.filter((name) => name.startsWith('opusweave-') && name !== CACHE_NAME)
          .map((name) => caches.delete(name)),
      ))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin) return

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME)
    const cached = await cache.match(request, { ignoreSearch: true })
    if (cached) return cached

    try {
      const response = await fetch(request)
      if (response.ok && url.pathname.startsWith(new URL(self.registration.scope).pathname)) {
        await cache.put(request, response.clone())
      }
      return response
    } catch {
      if (request.mode === 'navigate') {
        const fallback = await cache.match('./index.html')
        if (fallback) return fallback
      }
      return Response.error()
    }
  })())
})
`
  writeFileSync(resolve(outdir, 'service-worker.js'), serviceWorker)
  writeFileSync(resolve(outdir, '.nojekyll'), '')
  console.log(`Static PWA built at ${outdir} with cache ${cacheName}`)
}
