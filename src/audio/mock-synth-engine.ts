/**
 * mock-synth-engine — in-memory SynthEngine for tests and headless demos.
 * No audio devices, no DOM: records every call for assertions.
 */
import type { SoundFontInfo, SynthEngine } from './synth-engine.ts'

export interface MockCall {
  method: string
  args: unknown[]
}

export class MockSynthEngine implements SynthEngine {
  readonly calls: MockCall[] = []
  private font: SoundFontInfo | null = null
  private volume = 0.8

  private record(method: string, args: unknown[]): void {
    this.calls.push({ method, args })
  }

  async loadSoundBank(data: ArrayBuffer, name = 'MockBank'): Promise<SoundFontInfo> {
    this.record('loadSoundBank', [data.byteLength, name])
    this.font = { name, presetCount: 1 }
    return this.font
  }

  send(message: Uint8Array, _timestamp?: number): void {
    this.record('send', [[...message]])
  }

  async playMidi(data: ArrayBuffer, fileName?: string): Promise<void> {
    this.record('playMidi', [data.byteLength, fileName])
  }

  pause(): void {
    this.record('pause', [])
  }

  stop(): void {
    this.record('stop', [])
  }

  panic(): void {
    this.record('panic', [])
  }

  setMasterVolume(value: number): void {
    this.volume = value
    this.record('setMasterVolume', [value])
  }

  async setAudioOutput(deviceId: string): Promise<void> {
    this.record('setAudioOutput', [deviceId])
  }

  supportsAudioOutputSelection(): boolean {
    return true
  }

  get masterVolume(): number {
    return this.volume
  }

  dispose(): void {
    this.record('dispose', [])
  }

  hasSoundFont(): boolean {
    return this.font !== null
  }

  listPresets(): Array<{ program: number; name: string }> {
    return [{ program: 0, name: 'Mock Grand Piano' }]
  }
}
