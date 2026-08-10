/**
 * audio-renderer — offline MIDI→audio rendering contract (CLI only).
 * The GUI never uses this; it plays through the browser SynthEngine.
 */
import { OpusWeaveError } from '../shared/errors.ts'

export interface RenderAudioOptions {
  midiPath: string
  soundfontPath: string
  outputPath: string
  sampleRate?: number
  gain?: number
}

export interface RenderResult {
  outputPath: string
  bytes: number
  /** FluidSynth version, when detectable. */
  fluidsynthVersion: string | null
  /** Estimated duration in seconds from the MIDI tempo map, when readable. */
  durationSeconds: number | null
  warnings: string[]
}

export interface AudioRenderer {
  render(options: RenderAudioOptions): Promise<RenderResult>
}

export function ensureWavExtension(outputPath: string): void {
  if (!/\.wav$/i.test(outputPath)) {
    throw new OpusWeaveError('invalid-output-path', `output must end in .wav, got: ${outputPath}`)
  }
}
