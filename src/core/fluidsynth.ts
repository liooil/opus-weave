/**
 * FluidSynth integration — render MIDI + SoundFont to WAV via the system
 * `fluidsynth` binary. This is an optional external backend; the function
 * throws a descriptive error if FluidSynth is not installed.
 */
import { join } from 'node:path'
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'

export interface RenderAudioOptions {
  /** Absolute path to the input .mid file */
  midiPath: string
  /** Absolute path to the .sf2 / .sf3 SoundFont file */
  soundfontPath: string
  /** Absolute path for the output .wav file */
  outputPath: string
  /** Sample rate in Hz (default 44100) */
  sampleRate?: number
  /** Gain (default 0.5) */
  gain?: number
}

/**
 * Render MIDI + SoundFont to WAV using the system `fluidsynth` binary.
 * Throws if FluidSynth is not found or returns a non-zero exit code.
 */
export async function renderAudio(options: RenderAudioOptions): Promise<void> {
  const {
    midiPath,
    soundfontPath,
    outputPath,
    sampleRate = 44100,
    gain = 0.5,
  } = options

  if (!existsSync(midiPath)) throw new Error(`MIDI file not found: ${midiPath}`)
  if (!existsSync(soundfontPath)) throw new Error(`SoundFont not found: ${soundfontPath}`)

  const proc = Bun.spawn(
    [
      'fluidsynth',
      '-ni',
      '-g', String(gain),
      '-r', String(sampleRate),
      '-F', outputPath,
      soundfontPath,
      midiPath,
    ],
    {
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )

  const [exitCode, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stderr).text(),
  ])

  if (exitCode !== 0) {
    throw new Error(`fluidsynth exited with code ${exitCode}:\n${stderr}`)
  }
}

/**
 * Write an ArrayBuffer to a temporary file and return its path.
 * The caller is responsible for deleting the file when done.
 */
export function writeTmpMidi(data: ArrayBuffer, prefix = 'opus-weave-'): string {
  const dir = tmpdir()
  const path = join(dir, `${prefix}${Date.now()}.mid`)
  writeFileSync(path, Buffer.from(data))
  return path
}

export { unlinkSync as deleteTmpFile }
