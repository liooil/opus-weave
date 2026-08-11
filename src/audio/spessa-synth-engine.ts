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
  onPlaybackNoteOn?: (channel: number, note: number, velocity: number) => void
  onPlaybackNoteOff?: (channel: number, note: number) => void
  onSoundFontLoaded?: (info: SoundFontInfo) => void
  onError?: (message: string) => void
}

interface AudioContextWithSink extends AudioContext {
  sinkId?: string
  setSinkId?: (deviceId: string) => Promise<void>
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
  private soundBankEventSequence = 0
  private playbackActive = false

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
      synth.eventHandler.addEvent('noteOn', 'opusweave-playback', (event) => {
        if (this.playbackActive) this.callbacks.onPlaybackNoteOn?.(event.channel, event.midiNote, event.velocity)
      })
      synth.eventHandler.addEvent('noteOff', 'opusweave-playback', (event) => {
        if (this.playbackActive) this.callbacks.onPlaybackNoteOff?.(event.channel, event.midiNote)
      })
      this.sequencer.eventHandler.addEvent('songEnded', 'opusweave', () => {
        this.playbackActive = false
        this.callbacks.onPlaybackEnded?.()
        this.callbacks.onPlaybackState?.(false)
      })
    } catch (err) {
      throw new SynthEngineError(`audio engine init failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /** Wait until the AudioWorklet publishes the preset list produced by an operation. */
  private async waitForPresetListChange(operation: () => void | Promise<void>): Promise<void> {
    const synth = this.synth!
    const eventId = `opusweave-soundbank-${++this.soundBankEventSequence}`
    let resolveChange: (() => void) | undefined
    const changed = new Promise<void>((resolve) => { resolveChange = resolve })
    synth.eventHandler.addEvent('presetListChange', eventId, () => resolveChange?.())
    try {
      await operation()
      await changed
    } finally {
      synth.eventHandler.removeEvent('presetListChange', eventId)
    }
  }

  async loadSoundBank(data: ArrayBuffer, name?: string): Promise<SoundFontInfo> {
    await this.ensureReady()
    const synth = this.synth!
    try {
      await this.waitForPresetListChange(() => synth.soundBankManager.addSoundBank(data, 'main'))
      if (synth.soundBankManager.priorityOrder[0] !== 'main') {
        await this.waitForPresetListChange(() => {
          synth.soundBankManager.priorityOrder = [
            'main',
            ...synth.soundBankManager.priorityOrder.filter((id) => id !== 'main'),
          ]
        })
      }
      const presetCount = synth.presetList.length
      const info: SoundFontInfo = { name: name ?? 'SoundFont', presetCount }
      this.soundFont = info
      this.callbacks.onSoundFontLoaded?.(info)
      return info
    } catch (err) {
      throw new SynthEngineError(`failed to load SoundFont: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /** Add a sound bank layer while retaining the main bank. */
  async addSoundBankLayer(data: ArrayBuffer, id: string, name?: string, makePrimary = true): Promise<SoundFontInfo> {
    await this.ensureReady()
    const synth = this.synth!
    try {
      await this.waitForPresetListChange(() => synth.soundBankManager.addSoundBank(data, id))
      if (makePrimary) {
        await this.waitForPresetListChange(() => {
          synth.soundBankManager.priorityOrder = [
            id,
            ...synth.soundBankManager.priorityOrder.filter((bankId) => bankId !== id),
          ]
        })
      }
      const info: SoundFontInfo = {
        name: name ?? this.soundFont?.name ?? 'SoundFont',
        presetCount: synth.presetList.length,
      }
      this.soundFont = info
      this.callbacks.onSoundFontLoaded?.(info)
      return info
    } catch (err) {
      throw new SynthEngineError(`failed to load SoundFont layer: ${err instanceof Error ? err.message : String(err)}`)
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

  async playMidi(data: ArrayBuffer, fileName?: string, startSeconds = 0): Promise<void> {
    await this.ensureReady()
    const seq = this.sequencer!
    if (this.ctx.state === 'suspended') await this.ctx.resume()
    seq.loadNewSongList([{ binary: data, fileName: fileName ?? 'song.mid' }])
    if (startSeconds > 0) seq.currentTime = startSeconds
    this.playbackActive = true
    this.callbacks.onPlaybackState?.(true)
    seq.play()
  }

  getPlaybackPosition(): { seconds: number; duration: number } {
    const seq = this.sequencer
    return { seconds: seq?.currentTime ?? 0, duration: seq?.midiData?.duration ?? 0 }
  }

  pause(): void {
    this.playbackActive = false
    this.sequencer?.pause()
    this.callbacks.onPlaybackState?.(false)
  }

  stop(): void {
    this.playbackActive = false
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

  supportsAudioOutputSelection(): boolean {
    return typeof (this.ctx as AudioContextWithSink).setSinkId === 'function'
  }

  async setAudioOutput(deviceId: string): Promise<void> {
    const context = this.ctx as AudioContextWithSink
    if (!context.setSinkId) throw new SynthEngineError('audio output selection is not supported by this browser')
    try {
      await context.setSinkId(deviceId)
    } catch (err) {
      throw new SynthEngineError(`failed to select audio output: ${err instanceof Error ? err.message : String(err)}`)
    }
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
    this.playbackActive = false
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
