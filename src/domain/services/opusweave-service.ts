/**
 * OpusWeaveService — the single domain service shared by CLI, MCP and GUI.
 * No layer re-implements MIDI processing; everything routes through here.
 */
import { writeFile } from 'node:fs/promises'
import { existsSync, readdirSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { BasicMIDI } from 'spessasynth_core'
import { OpusWeaveError } from '../../shared/errors.ts'
import { buildMidi } from '../midi/midi-export.ts'
import { inspectMidi, type MidiInspection } from '../midi/midi-import.ts'
import { validateCompositionSpec, type ValidationResult } from '../composition/validation.ts'
import { DEFAULT_PPQ } from '../composition/composition-spec.ts'
import type { CompositionSpec } from '../composition/composition-spec.ts'
import { TempoMap } from '../composition/tempo-map.ts'
import { FluidSynthRenderer, detectFluidSynth } from '../../audio/fluidsynth-renderer.ts'
import type { RenderResult } from '../../audio/audio-renderer.ts'
import { parseOwt } from '../owt/parser.ts'
import { serializeScore } from '../owt/serializer.ts'
import { compileScoreText, extractMelodyFromMidi, type MelodyExtractionOptions, type MelodyExtractionResult } from '../owt/integration.ts'
import type { OwtDiagnostic } from '../owt/ast.ts'

export interface CreateMidiResult {
  bytes: number
  trackCount: number
  noteCount: number
  durationBeats: number
  warnings: string[]
  /** Absolute output path when one was requested. */
  path?: string
}

export interface OwtValidationResult {
  valid: boolean
  diagnostics: OwtDiagnostic[]
  composition?: ValidationResult
}

export interface DoctorReport {
  platform: string
  runtime: string
  chromium: { available: boolean; paths: string[] }
  fluidsynth: { available: boolean; version: string | null; advice: string }
  appDataDir: string
  soundfont: { checked: boolean; exists: boolean; path?: string }
  features: string[]
}

const CHROMIUM_CANDIDATES = ['chrome', 'chromium', 'chromium-browser', 'google-chrome', 'msedge', 'microsoft-edge']

export class OpusWeaveService {
  private readonly renderer = new FluidSynthRenderer()

  /** Validate + encode a spec; optionally writes the file. Returns summary. */
  async createMidi(spec: unknown, outputPath?: string): Promise<CreateMidiResult> {
    const { errors, warnings, stats } = validateCompositionSpec(spec)
    if (errors.length > 0) {
      throw new OpusWeaveError(
        'invalid-spec',
        `invalid composition spec (${errors.length} error(s)): ${errors.map((e) => `${e.field}: ${e.message}`).join('; ')}`,
      )
    }
    const buf = buildMidi(spec as CompositionSpec)
    const resolved = outputPath ? resolve(outputPath) : undefined
    if (resolved) {
      await writeFile(resolved, new Uint8Array(buf))
    }
    return {
      bytes: buf.byteLength,
      trackCount: stats.trackCount,
      noteCount: stats.noteCount,
      durationBeats: stats.durationBeats,
      warnings: warnings.map((w) => `${w.field}: ${w.message}`),
      path: resolved,
    }
  }

  /** Inspect a MIDI file on disk. */
  async inspectMidiFile(filePath: string): Promise<MidiInspection> {
    if (!existsSync(filePath)) throw new OpusWeaveError('file-not-found', `MIDI file not found: ${filePath}`)
    const file = Bun.file(resolve(filePath))
    const bytes = new Uint8Array(await file.arrayBuffer())
    return inspectMidi(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), filePath)
  }

  /** Validate a spec and return errors/warnings/stats (never throws). */
  validateComposition(spec: unknown): ValidationResult {
    return validateCompositionSpec(spec)
  }

  validateOwt(text: string): OwtValidationResult {
    const parsed = parseOwt(text)
    if (!parsed.document) return { valid: false, diagnostics: parsed.diagnostics }
    const composition = validateCompositionSpec(compileScoreText(text).spec)
    return {
      valid: composition.errors.length === 0,
      diagnostics: parsed.diagnostics,
      composition,
    }
  }

  async compileOwtScore(text: string, outputPath?: string): Promise<CreateMidiResult & { text: string }> {
    const compiled = compileScoreText(text)
    const result = await this.createMidi(compiled.spec, outputPath)
    return { ...result, text: serializeScore(compiled.score) }
  }

  prepareOwtPlayback(text: string): { midiBase64: string; bytes: number; title?: string; text: string } {
    const compiled = compileScoreText(text)
    return {
      midiBase64: Buffer.from(compiled.midi).toString('base64'),
      bytes: compiled.midi.byteLength,
      title: compiled.score.title,
      text: serializeScore(compiled.score),
    }
  }

  async importMidiAsOwt(filePath: string, options: MelodyExtractionOptions = {}): Promise<MelodyExtractionResult> {
    if (!existsSync(filePath)) throw new OpusWeaveError('file-not-found', `MIDI file not found: ${filePath}`)
    const file = Bun.file(resolve(filePath))
    return extractMelodyFromMidi(await file.arrayBuffer(), { title: options.title ?? basename(filePath), ...options })
  }

  /** Render MIDI + SoundFont to WAV via FluidSynth. */
  async renderMidi(options: { midi: string; soundfont: string; output: string; sampleRate?: number; gain?: number }): Promise<RenderResult> {
    return this.renderer.render({
      midiPath: resolve(options.midi),
      soundfontPath: resolve(options.soundfont),
      outputPath: resolve(options.output),
      sampleRate: options.sampleRate,
      gain: options.gain,
    })
  }

  /** A short, non-scale demo: two tracks, tempo change, CC, pitch bend. */
  createExampleComposition(): CompositionSpec {
    return {
      title: 'OpusWeave Example',
      ppq: 480,
      tempos: [
        { beat: 0, bpm: 120 },
        { beat: 4, bpm: 100 },
      ],
      timeSignatures: [{ beat: 0, numerator: 4, denominator: 4 }],
      tracks: [
        {
          name: 'Melody',
          channel: 0,
          program: 73, // flute
          volume: 110,
          pan: 64,
          notes: [
            { startBeat: 0, durationBeats: 0.5, pitch: 72, velocity: 96 },
            { startBeat: 0.5, durationBeats: 0.5, pitch: 76, velocity: 96 },
            { startBeat: 1, durationBeats: 1, pitch: 79, velocity: 100 },
            { startBeat: 2, durationBeats: 0.5, pitch: 77, velocity: 96 },
            { startBeat: 2.5, durationBeats: 0.5, pitch: 79, velocity: 96 },
            { startBeat: 3, durationBeats: 1, pitch: 81, velocity: 100 },
          ],
          controlChanges: [
            { beat: 0, controller: 7, value: 110 },
            { beat: 2, controller: 1, value: 40 },
          ],
          pitchBends: [{ beat: 3.5, value: 9000 }],
        },
        {
          name: 'Bass',
          channel: 1,
          program: 33, // electric bass
          volume: 90,
          notes: [
            { startBeat: 0, durationBeats: 1, pitch: 45, velocity: 90 },
            { startBeat: 1, durationBeats: 1, pitch: 41, velocity: 90 },
            { startBeat: 2, durationBeats: 1, pitch: 43, velocity: 90 },
            { startBeat: 3, durationBeats: 1, pitch: 38, velocity: 90 },
          ],
          controlChanges: [],
          pitchBends: [],
        },
      ],
    }
  }

  /** Environment diagnostics for `opusweave doctor`. */
  async doctor(options: { soundfont?: string }): Promise<DoctorReport> {
    const fluidsynth = await detectFluidSynth()
    const chromiumPaths: string[] = []
    for (const name of CHROMIUM_CANDIDATES) {
      try {
        const which = Bun.which(name)
        if (which) chromiumPaths.push(which)
      } catch {
        // not found
      }
    }

    const appDataDir = join(homedir(), process.platform === 'win32' ? 'AppData/Roaming' : process.platform === 'darwin' ? 'Library/Application Support' : '.config', 'opus-weave')

    const soundfont = options.soundfont
      ? { checked: true, exists: existsSync(resolve(options.soundfont)), path: options.soundfont }
      : { checked: false, exists: false }

    return {
      platform: `${platform()} ${process.arch}`,
      runtime: `bun ${Bun.version}`,
      chromium: { available: chromiumPaths.length > 0, paths: chromiumPaths },
      fluidsynth: { available: fluidsynth.available, version: fluidsynth.version, advice: fluidsynth.advice },
      appDataDir,
      soundfont,
      features: [
        'SMF import/export (spessasynth_core)',
        'OWT 0.1 Score/Take parsing, quantization and comparison',
        'SoundFont synthesis (spessasynth_lib, browser)',
        'FluidSynth offline rendering (optional)',
        'MCP server (stdio)',
        'WebMIDI input (browser with Chromium)',
      ],
    }
  }

  /** Round-trip check: build → parse. Returns the parsed file. */
  buildAndParse(spec: unknown): BasicMIDI {
    const buf = buildMidi(spec as CompositionSpec)
    const ppq = (spec as CompositionSpec).ppq ?? DEFAULT_PPQ
    const durationBeats = validateCompositionSpec(spec).stats.durationBeats
    const tempoMap = new TempoMap({ ppq, tempos: (spec as CompositionSpec).tempos, defaultTempo: 120 })
    const midi = BasicMIDI.fromArrayBuffer(buf)
    void tempoMap.durationSeconds(midi.lastVoiceEventTick)
    void durationBeats
    return midi
  }
}
