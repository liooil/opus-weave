/**
 * spessa-synth-engine — browser SynthEngine backed by spessasynth_lib.
 *
 * AudioWorklet synthesis; the worklet module URL is injectable so the GUI
 * (dev server route / built asset) and tests can differ. Waits for the
 * synthesizer to be ready before accepting notes; master volume goes through
 * a GainNode; panic sends all-notes-off + controller reset.
 */
import { WorkletSynthesizer, Sequencer } from 'spessasynth_lib'
import { BasicMIDI, type MIDIController } from 'spessasynth_core'
import { SynthEngineError, type SoundFontInfo, type SynthEngine } from './synth-engine.ts'

interface EngineCallbacks {
  onPlaybackTime?: (seconds: number, duration: number) => void
  onPlaybackEnded?: () => void
  onPlaybackState?: (playing: boolean) => void
  onSoundFontLoaded?: (info: SoundFontInfo) => void
  onError?: (message: string) => void
}

export class SpessaSynthEngine implements SynthEngine {
  private ctx: AudioContext
  private synth: WorkletSynthesizer | null = null
  private sequencer: Sequencer | null = null
  private gainNode: GainNode
  private soundFont: SoundFontInfo | null = null
  private disposed = false
  private pendingMessages: Uint8Array[] = []
  private resumePromise: Promise<void> | null = null

  constructor(
    /** Inject a pre-created AudioContext (tests use a mock). */
    context?: AudioContext,
    /** Worklet module URL. Defaults to the app's served route. */
    private readonly workletUrl: string = '/spessasynth_processor.min.js',
    private readonly callbacks: EngineCallbacks = {},
  ) {
    this.ctx = context ?? new AudioContext()
    this.gainNode = this.ctx.createGain()
    this.gainNode.gain.value = 0.8
    this.gainNode.connect(this.ctx.destination)
  }

  /** Must be called (after a user gesture) before any synthesis. */
  async ensureReady(): Promise<void> {
    if (this.synth) return
    try {
      await this.ctx.audioWorklet.addModule(this.workletUrl)
      const synth = new WorkletSynthesizer(this.ctx)
      synth.connect(this.gainNode)
      await synth.isReady
      this.synth = synth
      this.sequencer = new Sequencer(synth)
      this.sequencer.eventHandler.addEvent('timeChange', 'opusweave', (time: number) => {
        const duration = this.sequencer?.midiData?.duration ?? 0
        this.callbacks.onPlaybackTime?.(time, duration)
      })
      this.sequencer.eventHandler.addEvent('songEnded', 'opusweave', () => {
        this.callbacks.onPlaybackEnded?.()
        this.callbacks.onPlaybackState?.(false)
      })
    } catch (err) {
      throw new SynthEngineError(`audio engine init failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  async loadSoundBank(data: ArrayBuffer, name?: string): Promise<SoundFontInfo> {
    await this.ensureReady()
    const synth = this.synth!
    try {
      await synth.soundBankManager.addSoundBank(data, 'main')
      const presetCount = synth.presetList.length
      const info: SoundFontInfo = { name: name ?? 'SoundFont', presetCount }
      this.soundFont = info
      this.callbacks.onSoundFontLoaded?.(info)
      return info
    } catch (err) {
      throw new SynthEngineError(`failed to load SoundFont: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  send(message: Uint8Array, _timestamp?: number): void {
    if (!this.synth) return
    if (this.resumePromise || this.ctx.state === 'suspended') {
      this.pendingMessages.push(Uint8Array.from(message))
      if (!this.resumePromise) {
        this.resumePromise = this.ctx.resume()
          .then(() => {
            const queued = this.pendingMessages
            this.pendingMessages = []
            for (const pending of queued) this.deliverMessage(pending)
          })
          .catch((err: unknown) => {
            this.pendingMessages = []
            this.callbacks.onError?.(`audio resume failed: ${err instanceof Error ? err.message : String(err)}`)
          })
          .finally(() => {
            this.resumePromise = null
          })
      }
      return
    }
    this.deliverMessage(message)
  }

  private deliverMessage(message: Uint8Array): void {
    const synth = this.synth
    if (!synth) return
    const status = message[0]!
    const channel = status & 0x0f
    switch (status & 0xf0) {
      case 0x90:
        if (message[2] === 0) synth.noteOff(channel, message[1]!)
        else synth.noteOn(channel, message[1]!, message[2]!)
        break
      case 0x80:
        synth.noteOff(channel, message[1]!)
        break
      case 0xb0:
        synth.controllerChange(channel, message[1]! as MIDIController, message[2]!)
        break
      case 0xe0:
        synth.pitchWheel(channel, ((message[2]! << 7) | message[1]!) - 8192)
        break
      case 0xc0:
        synth.programChange(channel, message[1]!)
        break
    }
  }

  async playMidi(data: ArrayBuffer, fileName?: string): Promise<void> {
    await this.ensureReady()
    const seq = this.sequencer!
    if (this.ctx.state === 'suspended') await this.ctx.resume()
    seq.loadNewSongList([{ binary: data, fileName: fileName ?? 'song.mid' }])
    seq.play()
    this.callbacks.onPlaybackState?.(true)
  }

  pause(): void {
    this.sequencer?.pause()
    this.callbacks.onPlaybackState?.(false)
  }

  stop(): void {
    const seq = this.sequencer
    if (seq) {
      seq.pause()
      seq.currentTime = 0
    }
    this.callbacks.onPlaybackState?.(false)
    this.callbacks.onPlaybackTime?.(0, 0)
  }

  panic(): void {
    const synth = this.synth
    if (!synth) return
    for (let ch = 0; ch < 16; ch++) {
      synth.controllerChange(ch, 123, 0) // all notes off
      synth.controllerChange(ch, 120, 0) // all sound off
    }
  }

  setMasterVolume(value: number): void {
    const v = Math.max(0, Math.min(1, value))
    this.gainNode.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02)
  }

  hasSoundFont(): boolean {
    return this.soundFont !== null
  }

  listPresets(): Array<{ program: number; name: string }> {
    const synth = this.synth
    if (!synth) return []
    return synth.presetList
      .filter((preset) => !preset.isDrum)
      .map((preset) => ({ program: preset.program, name: preset.name }))
  }

  get loadedSoundFont(): SoundFontInfo | null {
    return this.soundFont
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.sequencer = null
    this.synth = null
    this.soundFont = null
    this.pendingMessages = []
    this.resumePromise = null
    void this.ctx.close()
  }
}

/** Parse an SMF for inspection (shared by GUI player loader). */
export function parseMidi(data: ArrayBuffer, fileName?: string): BasicMIDI {
  return BasicMIDI.fromArrayBuffer(data, fileName)
}
