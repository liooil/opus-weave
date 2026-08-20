/**
 * offline-wav-renderer — renders MIDI to a WAV Blob entirely in the browser
 * using the same spessasynth worklet as live playback.
 *
 * This is the GUI counterpart of the CLI FluidSynth WAV renderer. It does not
 * require any external binary; it just needs an AudioContext-capable browser.
 */
import { BasicMIDI } from 'spessasynth_core'
import { WorkletSynthesizer, audioBufferToWav } from 'spessasynth_lib'

export interface OfflineWavRenderOptions {
  /** Standard MIDI file bytes to render. */
  midi: ArrayBuffer
  /** SoundFont/SF3 buffers to load, in priority order (first is primary). */
  soundFonts: ArrayBuffer[]
  /** URL of the spessasynth AudioWorklet processor module. */
  workletUrl: string
  sampleRate?: number
  /** Extra silence appended after the last MIDI event, in seconds. */
  tailSeconds?: number
}

/**
 * Renders a MIDI file through an OfflineAudioContext and returns a WAV Blob.
 */
export async function renderMidiToWavBlob(options: OfflineWavRenderOptions): Promise<Blob> {
  const sampleRate = options.sampleRate ?? 44100
  const tailSeconds = options.tailSeconds ?? 1
  const midi = BasicMIDI.fromArrayBuffer(options.midi)
  const length = Math.max(1, Math.ceil((midi.duration + tailSeconds) * sampleRate))
  const context = new OfflineAudioContext(2, length, sampleRate)

  await context.audioWorklet.addModule(options.workletUrl)
  const synth = new WorkletSynthesizer(context)
  synth.connect(context.destination)

  try {
    await synth.startOfflineRender({
      midiSequence: midi,
      loopCount: 0,
      soundBankList: options.soundFonts.map((soundBankBuffer) => ({
        bankOffset: 0,
        soundBankBuffer,
      })),
    })
    const rendered = await context.startRendering()
    return audioBufferToWav(rendered)
  } finally {
    synth.destroy()
  }
}
