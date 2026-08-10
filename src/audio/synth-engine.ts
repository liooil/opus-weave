/**
 * synth-engine — the audio backend contract.
 *
 * The GUI depends on this interface, never on spessasynth classes directly.
 * Browser playback uses SpessaSynthEngine; tests use MockSynthEngine; offline
 * rendering uses FluidSynthRenderer (audio-renderer.ts).
 */

export interface SoundFontInfo {
  name: string
  presetCount: number
}

export interface SynthEngine {
  /** Load a SoundFont from bytes (.sf2/.sf3/.sfogg or whatever the backend supports). */
  loadSoundBank(data: ArrayBuffer, name?: string): Promise<SoundFontInfo>
  /** Send one raw MIDI message (Note On/Off, CC, Pitch Bend, Program…). */
  send(message: Uint8Array, timestamp?: number): void
  /** Play a whole SMF through the internal sequencer, optionally from an offset. */
  playMidi(data: ArrayBuffer, fileName?: string, startSeconds?: number): Promise<void>
  pause(): void
  stop(): void
  /** Kill all sounding notes immediately (Panic). */
  panic(): void
  setMasterVolume(value: number): void
  /** Free resources; safe to call multiple times. */
  dispose(): void
  /** True when a SoundFont is loaded. */
  hasSoundFont(): boolean
  /** Presets available in the loaded sound bank (program + name). */
  listPresets(): Array<{ program: number; name: string }>
}

export class SynthEngineError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SynthEngineError'
  }
}
