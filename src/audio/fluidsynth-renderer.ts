/**
 * fluidsynth-renderer — offline MIDI + SoundFont → WAV via the system
 * `fluidsynth` binary. Optional backend; never auto-installs anything.
 *
 * Spawns with an argument array (no shell string interpolation), checks the
 * output extension, captures stdout/stderr and the exit code, and gives
 * copy-pasteable install advice when the binary is missing.
 */
import { existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { OpusWeaveError } from '../shared/errors.ts'
import { ensureWavExtension, type AudioRenderer, type RenderAudioOptions, type RenderResult } from './audio-renderer.ts'
import { inspectMidi } from '../domain/midi/midi-import.ts'

export const FLUIDSYNTH_INSTALL_ADVICE = [
  'FluidSynth is not installed or not in $PATH.',
  '  macOS:      brew install fluid-synth',
  '  Debian/Ubuntu: sudo apt install fluidsynth',
  '  Fedora:     sudo dnf install fluidsynth',
  '  Windows:    winget install FluidSynth.FluidSynth (or build from source)',
  'It is only needed for offline WAV rendering; GUI playback works without it.',
].join('\n')

export async function detectFluidSynth(): Promise<{ available: boolean; version: string | null; advice: string }> {
  try {
    const proc = Bun.spawn(['fluidsynth', '--version'], { stdout: 'pipe', stderr: 'pipe' })
    const [code, stdout] = await Promise.all([proc.exited, new Response(proc.stdout).text()])
    if (code !== 0) return { available: false, version: null, advice: FLUIDSYNTH_INSTALL_ADVICE }
    const version = stdout.split('\n')[0]?.trim() ?? null
    return { available: true, version, advice: '' }
  } catch {
    return { available: false, version: null, advice: FLUIDSYNTH_INSTALL_ADVICE }
  }
}

export class FluidSynthRenderer implements AudioRenderer {
  async render(options: RenderAudioOptions): Promise<RenderResult> {
    const { midiPath, soundfontPath, outputPath, sampleRate = 44100, gain = 0.5 } = options

    if (!existsSync(midiPath)) throw new OpusWeaveError('file-not-found', `MIDI file not found: ${midiPath}`)
    if (!existsSync(soundfontPath)) throw new OpusWeaveError('file-not-found', `SoundFont not found: ${soundfontPath}`)
    ensureWavExtension(outputPath)

    const detection = await detectFluidSynth()
    if (!detection.available) {
      throw new OpusWeaveError('fluidsynth-missing', FLUIDSYNTH_INSTALL_ADVICE)
    }

    const proc = Bun.spawn(
      ['fluidsynth', '-ni', '-g', String(gain), '-r', String(sampleRate), '-F', outputPath, soundfontPath, midiPath],
      { stdout: 'pipe', stderr: 'pipe' },
    )
    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])

    const warnings: string[] = []
    if (exitCode !== 0) {
      throw new OpusWeaveError(
        'fluidsynth-failed',
        `fluidsynth exited with code ${exitCode}\nstdout: ${stdout}\nstderr: ${stderr}`,
      )
    }
    if (!existsSync(outputPath)) {
      throw new OpusWeaveError('fluidsynth-failed', 'fluidsynth reported success but produced no output file')
    }

    let durationSeconds: number | null = null
    try {
      const data = await readFile(midiPath)
      const bytes = new Uint8Array(data).buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
      durationSeconds = inspectMidi(bytes).durationSeconds
    } catch {
      // duration is best-effort
    }

    return {
      outputPath,
      bytes: statSync(outputPath).size,
      fluidsynthVersion: detection.version,
      durationSeconds,
      warnings,
    }
  }
}
