/**
 * OpusWeave — main entry point.
 * Runs the BunDesk desktop application: HTTP server + browser window.
 * On Linux, uses the Chromium browser provider for WebMIDI support.
 */
import { createDesktopApp } from 'bundesk'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildMidi, type CreateMidiOptions } from './core/midi.ts'
import { renderAudio, writeTmpMidi, deleteTmpFile } from './core/fluidsynth.ts'
import page from './page/index.html'

const here = dirname(fileURLToPath(import.meta.url))

// Serve the spessasynth AudioWorklet processor file needed by the browser
const workletPath = resolve(here, '../node_modules/spessasynth_lib/dist/spessasynth_processor.min.js')
const workletBytes = readFileSync(workletPath)

const APP_ID = 'io.github.liooil.opusweave'
const VERSION = '0.1.0'

const app = createDesktopApp({
  id: APP_ID,
  version: VERSION,

  cli: {
    name: 'opus-weave',
    description: 'OpusWeave — from idea to score to performance',
  },

  server: {
    hostname: '127.0.0.1',
    port: 0,
    routes: {
      '/': page,
      '/spessasynth_processor.min.js': new Response(workletBytes, {
        headers: { 'content-type': 'application/javascript; charset=utf-8' },
      }),
      '/api/health': Response.json({ ok: true, version: VERSION }),
    },
  },

  window: {
    path: '/',
    // Use 'browser' on Linux to get Chromium/Chrome which supports WebMIDI.
    // WebKitGTK (webkit) does NOT support WebMIDI.
    provider: process.platform === 'linux' ? 'browser' : process.platform === 'win32' ? 'webview' : 'browser',
    title: 'OpusWeave',
    width: 1200,
    height: 820,
    exitWithWindow: true,
  },

  singleInstance: {},

  actions: [
    {
      name: 'create-midi',
      description: 'Create a MIDI file from structured JSON data and write it to disk',
      args: [
        {
          name: 'output',
          type: 'string',
          required: true,
          description: 'Output .mid file path',
        },
        {
          name: 'data',
          type: 'string',
          required: true,
          description: 'JSON string matching CreateMidiOptions (tempo, timeDivision, name, tracks[])',
        },
      ],
      async handler(args) {
        const output = String(args['output'])
        const raw = String(args['data'])
        let options: CreateMidiOptions
        try {
          options = JSON.parse(raw) as CreateMidiOptions
        } catch {
          throw new Error('Invalid JSON for --data argument')
        }
        const buf = buildMidi(options)
        await Bun.write(output, buf)
        return { ok: true, path: output, bytes: buf.byteLength }
      },
    },

    {
      name: 'render-audio',
      description: 'Render MIDI + SoundFont to WAV using system FluidSynth',
      args: [
        { name: 'midi', type: 'string', required: true, description: 'Input .mid file path' },
        { name: 'soundfont', type: 'string', required: true, description: 'Input .sf2/.sf3 SoundFont path' },
        { name: 'output', type: 'string', required: true, description: 'Output .wav file path' },
        { name: 'sampleRate', type: 'number', required: false, description: 'Sample rate (default 44100)' },
        { name: 'gain', type: 'number', required: false, description: 'Gain (default 0.5)' },
      ],
      async handler(args) {
        const midiPath = resolve(String(args['midi']))
        const soundfontPath = resolve(String(args['soundfont']))
        const outputPath = resolve(String(args['output']))
        const sampleRate = args['sampleRate'] !== undefined ? Number(args['sampleRate']) : 44100
        const gain = args['gain'] !== undefined ? Number(args['gain']) : 0.5
        await renderAudio({ midiPath, soundfontPath, outputPath, sampleRate, gain })
        return { ok: true, output: outputPath }
      },
    },

    {
      name: 'create-midi-from-file',
      description: 'Create a MIDI file from a JSON file on disk',
      args: [
        { name: 'input', type: 'string', required: true, description: 'Input .json file path' },
        { name: 'output', type: 'string', required: true, description: 'Output .mid file path' },
      ],
      async handler(args) {
        const inputPath = resolve(String(args['input']))
        const outputPath = resolve(String(args['output']))
        const raw = await Bun.file(inputPath).text()
        const options = JSON.parse(raw) as CreateMidiOptions
        const buf = buildMidi(options)
        await Bun.write(outputPath, buf)
        return { ok: true, path: outputPath, bytes: buf.byteLength }
      },
    },
  ],

  onReady: (context) => {
    console.log(`[opus-weave] ${VERSION} ready: ${context.url.href} env=${context.env}`)
  },
})

if (Bun.argv.slice(2).includes('--smoke')) {
  const result = await app.start(['--no-browser'])
  if (result.kind === 'primary') {
    const health = await fetch(new URL('/api/health', result.url)).then((r) => r.json()) as { ok: boolean }
    console.log(`[smoke] server ok: ${result.url.href} health=${JSON.stringify(health)}`)
    await result.stop()
    process.exit(0)
  }
  if (result.kind === 'action') {
    console.log('[smoke] action result:', result.result)
    process.exit(0)
  }
  process.exit(1)
}

await app.run()
