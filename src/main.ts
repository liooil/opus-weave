/**
 * OpusWeave — main entry point.
 *
 * 1. `mcp` and `owt` argv are handled BEFORE normal GUI startup.
 * 2. `owt play` compiles OWT and opens the GUI with startup MIDI.
 * 3. BunDesk desktop app: HTTP server + window; CLI actions on all three
 *    layers (CLI / HTTP API / GUI console).
 * 4. Linux (and Windows) use the Chromium-family browser provider because the
 *    product depends on WebMIDI, which WebKitGTK and WebView2 do not expose
 *    without extra permission plumbing.
 */
import { createDesktopApp } from 'bundesk'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtemp, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { mainMcp } from './mcp/server.ts'
import { OpusWeaveService } from './domain/services/opusweave-service.ts'
import { OpusWeaveError } from './shared/errors.ts'
import { optionalNumber, optionalString, printJson, requireString, type ActionArgs } from './cli/cli.ts'
import { runOwtCli, type OwtCliResult } from './cli/owt-cli.ts'
import { runCompositionCli } from './cli/composition-cli.ts'
import { proxyAiChat } from './ai/llama-proxy.ts'
import page from './web/index.html'
import { readFileSync } from 'node:fs'
import workletPath from '../node_modules/spessasynth_lib/dist/spessasynth_processor.min.js' with { type: 'file' }

const here = dirname(fileURLToPath(import.meta.url))
const argv = Bun.argv.slice(2)

// The AudioWorklet processor is embedded at build time (type: 'file' import)
// and materialized to a runtime path; read it once and serve it verbatim.
const workletBytes = readFileSync(workletPath)

const APP_ID = 'io.github.liooil.opusweave'
const VERSION = '0.1.0'
const service = new OpusWeaveService()

// ─── Non-GUI modes before desktop startup ───────────────────────────────────
if (argv[0] === 'mcp') {
  await mainMcp()
  // mainMcp resolves when the stdio transport closes (MCP client ended the
  // session). Exit naturally (event loop drain) — process.exit(0) truncates
  // buffered stdout responses on Windows and must never be used here.
} else if (argv[0] === 'owt') {
  const result = await runOwtCli(argv.slice(1), service)
  if (result.kind === 'play') await runDesktopApp(result)
} else if (argv[0] === 'composition') {
  await runCompositionCli(argv.slice(1), service)
} else {
  await runDesktopApp()
}

async function runDesktopApp(startupPlayback?: Extract<OwtCliResult, { kind: 'play' }>): Promise<void> {
  const smokeDataDirectory = argv.includes('--smoke') ? await mkdtemp(join(tmpdir(), 'opusweave-smoke-')) : undefined
  const app = createDesktopApp({
    id: APP_ID,
    version: VERSION,

    cli: {
      name: 'opus-weave',
      description: 'OpusWeave — from idea to score to performance. Run `opusweave` for the GUI, `opusweave mcp` for the MCP server.',
    },

    server: {
      hostname: '127.0.0.1', // loopback only; never expose the LAN by default
      port: 0,
      routes: {
        '/': page,
        '/spessasynth_processor.min.js': new Response(workletBytes, {
          headers: { 'content-type': 'application/javascript; charset=utf-8' },
        }),
        '/api/health': Response.json({ ok: true, version: VERSION }),
        '/api/ai/chat': { POST: proxyAiChat },
        '/api/startup-owt': startupPlayback
          ? new Response(startupPlayback.owt, {
              headers: { 'content-type': 'text/plain; charset=utf-8' },
            })
          : new Response(null, { status: 204 }),
      },
    },

    window: {
      path: '/',
      // 'browser' = Chromium-family app mode on Linux AND Windows (WebMIDI).
      // WebKitGTK and unpatched WebView2 do not expose Web MIDI.
      provider: 'browser',
      title: 'OpusWeave',
      width: 1280,
      height: 860,
      exitWithWindow: true,
    },

    singleInstance: smokeDataDirectory ? { dataDirectory: smokeDataDirectory } : {},

    actions: [
      {
        name: 'create-midi',
        description: 'Create a MIDI file from a CompositionSpec JSON file and write it to disk',
        args: [
          { name: 'spec', type: 'string', required: true, description: 'Path to a CompositionSpec JSON file' },
          { name: 'output', type: 'string', required: true, description: 'Output .mid file path' },
        ],
        async handler(args: ActionArgs) {
          const specPath = requireString(args, 'spec')
          const output = requireString(args, 'output')
          const raw = await Bun.file(resolve(here, '..', specPath)).text()
          const spec = JSON.parse(raw) as unknown
          const result = await service.createMidi(spec, output)
          printJson(result)
          return { ok: true, ...result }
        },
      },

      {
        name: 'inspect-midi',
        description: 'Parse a MIDI file and print structured information (tracks, tempos, time signatures, ranges, warnings) as JSON',
        args: [{ name: 'file', type: 'string', required: true, description: 'Input .mid file path' }],
        async handler(args: ActionArgs) {
          const file = requireString(args, 'file')
          const inspection = await service.inspectMidiFile(file)
          printJson(inspection)
          return { ok: true, ...inspection }
        },
      },

      {
        name: 'render-midi',
        description: 'Render MIDI + SoundFont to WAV using the system FluidSynth binary',
        args: [
          { name: 'midi', type: 'string', required: true, description: 'Input .mid file path' },
          { name: 'soundfont', type: 'string', required: true, description: 'Input .sf2/.sf3 SoundFont path' },
          { name: 'output', type: 'string', required: true, description: 'Output .wav file path' },
          { name: 'sample-rate', type: 'number', required: false, description: 'Sample rate in Hz (default 44100)' },
          { name: 'gain', type: 'number', required: false, description: 'FluidSynth gain (default 0.5)' },
        ],
        async handler(args: ActionArgs) {
          const result = await service.renderMidi({
            midi: requireString(args, 'midi'),
            soundfont: requireString(args, 'soundfont'),
            output: requireString(args, 'output'),
            sampleRate: optionalNumber(args, 'sample-rate', 44100),
            gain: optionalNumber(args, 'gain', 0.5),
          })
          printJson(result)
          return { ok: true, ...result }
        },
      },

      {
        name: 'doctor',
        description: 'Diagnose the environment: platform, Chromium, FluidSynth, SoundFont, app data directory, features',
        args: [{ name: 'soundfont', type: 'string', required: false, description: 'Optional SoundFont path to check' }],
        async handler(args: ActionArgs) {
          const report = await service.doctor({ soundfont: optionalString(args, 'soundfont') })
          printJson(report)
          return { ok: true, ...report }
        },
      },
    ],

    onReady: (context) => {
      console.log(`[opus-weave] ${VERSION} ready: ${context.url.href} env=${context.env}`)
    },
  })

  // ─── Headless smoke test ───────────────────────────────────────────────────
  if (argv.includes('--smoke')) {
    try {
      const result = await app.start(['--no-browser'])
      if (result.kind !== 'primary') throw new Error(`smoke start returned ${result.kind}`)
      const health = (await fetch(new URL('/api/health', result.url)).then((response) => response.json())) as { ok: boolean }
      console.log(`[smoke] server ok: ${result.url.href} health=${JSON.stringify(health)}`)
      await result.stop()
    } finally {
      if (smokeDataDirectory) await rm(smokeDataDirectory, { recursive: true, force: true })
    }
    process.exit(0)
  }

  try {
    await app.run()
  } catch (err) {
    if (err instanceof OpusWeaveError) {
      console.error(`[opus-weave] ${err.message}`)
    } else {
      console.error(`[opus-weave] fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}`)
    }
    process.exit(1)
  }
}
