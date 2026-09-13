import { describe, expect, test } from 'bun:test'
import { BasicMIDI, SoundBankLoader, SpessaSynthProcessor, type SynthMethodOptions } from 'spessasynth_core'
import { SpessaSynthEngine } from '../audio/spessa-synth-engine.ts'
import { buildMidi } from '../domain/midi/midi-export.ts'

interface SynthCall {
  method: string
  args: number[]
}

describe('SpessaSynthEngine live MIDI delivery', () => {
  test('lists one selectable GM preset per program in sound-bank priority order', () => {
    const engine = Object.create(SpessaSynthEngine.prototype) as SpessaSynthEngine
    const seam = engine as unknown as { synth: { presetList: Array<{ bankMSB: number; program: number; name: string; isDrum: boolean }> } }
    seam.synth = { presetList: [
      { bankMSB: 0, program: 0, name: 'mda Piano FreePiano', isDrum: false },
      { bankMSB: 0, program: 0, name: 'Fluid Grand', isDrum: false },
      { bankMSB: 1, program: 0, name: 'Mellow Grand', isDrum: false },
      { bankMSB: 0, program: 1, name: 'Bright Grand', isDrum: false },
      { bankMSB: 0, program: 0, name: 'Standard Kit', isDrum: true },
    ] }

    expect(engine.listPresets()).toEqual([
      { program: 0, name: 'mda Piano FreePiano' },
      { program: 1, name: 'Bright Grand' },
    ])
  })

  test('resumes suspended audio and preserves queued note order', async () => {
    let state: AudioContextState = 'suspended'
    const { promise: resumeGate, resolve: resolveResume } = Promise.withResolvers<void>()
    let resumeCalls = 0

    const context = {
      get state() { return state },
      destination: {},
      currentTime: 0,
      audioWorklet: { addModule: async () => {} },
      createGain: () => ({
        gain: { value: 0, setTargetAtTime: () => {} },
        connect: () => {},
      }),
      resume: () => {
        resumeCalls++
        return resumeGate.then(() => { state = 'running' })
      },
      close: async () => {},
    } as unknown as AudioContext

    const calls: SynthCall[] = []
    const synth = {
      noteOn: (...args: number[]) => calls.push({ method: 'noteOn', args }),
      noteOff: (...args: number[]) => calls.push({ method: 'noteOff', args }),
      controllerChange: (...args: number[]) => calls.push({ method: 'controllerChange', args }),
      pitchWheel: (...args: number[]) => calls.push({ method: 'pitchWheel', args }),
      programChange: (...args: number[]) => calls.push({ method: 'programChange', args }),
    }

    const engine = new SpessaSynthEngine(context)
    // Test seam: WorkletSynthesizer construction is intentionally bypassed.
    const engineTestSeam = engine as unknown as { synth: typeof synth }
    engineTestSeam.synth = synth

    engine.send(new Uint8Array([0x90, 60, 100]))
    engine.send(new Uint8Array([0x80, 60, 0]))

    expect(resumeCalls).toBe(1)
    expect(calls).toEqual([])

    resolveResume()
    await resumeGate
    await Promise.resolve()

    expect(calls).toEqual([
      { method: 'noteOn', args: [0, 60, 100] },
      { method: 'noteOff', args: [0, 60] },
    ])
  })

  test('routes the AudioContext to an explicitly selected output sink', async () => {
    const selected: string[] = []
    const context = {
      state: 'running',
      destination: {},
      currentTime: 0,
      audioWorklet: { addModule: async () => {} },
      createGain: () => ({
        gain: { value: 0, setTargetAtTime: () => {} },
        connect: () => {},
      }),
      setSinkId: async (deviceId: string) => { selected.push(deviceId) },
      close: async () => {},
    } as unknown as AudioContext

    const engine = new SpessaSynthEngine(context)
    expect(engine.supportsAudioOutputSelection()).toBe(true)
    await engine.setAudioOutput('monitor-t32p-30')
    expect(selected).toEqual(['monitor-t32p-30'])
  })

  test('applies loop state to the current and newly loaded sequence', async () => {
    const context = {
      state: 'running',
      destination: {},
      currentTime: 0,
      audioWorklet: { addModule: async () => {} },
      createGain: () => ({
        gain: { value: 0, setTargetAtTime: () => {} },
        connect: () => {},
      }),
      resume: async () => {},
      close: async () => {},
    } as unknown as AudioContext
    const sequencer = {
      loopCount: 0,
      currentTime: 0,
      loadNewSongList: () => {},
      play: () => {},
    }
    const engine = new SpessaSynthEngine(context)
    engine.setLooping(true)
    const seam = engine as unknown as { synth: object; sequencer: typeof sequencer }
    seam.synth = {}
    seam.sequencer = sequencer
    await engine.playMidi(new ArrayBuffer(1), 'loop.mid')
    expect(sequencer.loopCount).toBe(Infinity)
    engine.setLooping(false)
    expect(sequencer.loopCount).toBe(0)
  })

  test('keeps a live preset override in the MIDI replayed by every loop', async () => {
    const context = {
      state: 'running',
      destination: {},
      currentTime: 0,
      audioWorklet: { addModule: async () => {} },
      createGain: () => ({
        gain: { value: 0, setTargetAtTime: () => {} },
        connect: () => {},
      }),
      resume: async () => {},
      close: async () => {},
    } as unknown as AudioContext
    let loadedBinary: ArrayBuffer | undefined
    const sequencer = {
      loopCount: 0,
      currentTime: 0,
      loadNewSongList: (songs: Array<{ binary: ArrayBuffer }>) => { loadedBinary = songs[0]?.binary },
      play: () => {},
    }
    const engine = new SpessaSynthEngine(context)
    const programState = { current: 0, locked: false }
    const synth = {
      midiChannels: [{
        setSystemParameter: (parameter: string, value: boolean) => {
          if (parameter === 'presetLock') programState.locked = value
        },
      }],
      programChange: (_channel: number, program: number) => {
        if (!programState.locked) programState.current = program
      },
    }
    const seam = engine as unknown as { synth: typeof synth; sequencer: typeof sequencer }
    seam.synth = synth
    seam.sequencer = sequencer
    engine.setLooping(true)
    engine.send(new Uint8Array([0xc0, 73]))

    expect(programState).toEqual({ current: 73, locked: true })
    // SpessaSynth resets the channel, then replays the sequence's program
    // changes at every hard loop. A user-selected preset must survive both.
    synth.programChange(0, 0)
    synth.programChange(0, 40)
    expect(programState).toEqual({ current: 73, locked: true })

    await engine.playMidi(buildMidi({
      ppq: 480,
      tempos: [{ beat: 0, bpm: 120 }],
      tracks: [{
        name: 'Melody',
        channel: 0,
        program: 0,
        programChanges: [{ beat: 1, program: 40 }],
        notes: [{ startBeat: 0, durationBeats: 2, pitch: 60, velocity: 100 }],
      }, {
        name: 'Accompaniment',
        channel: 1,
        program: 48,
        notes: [{ startBeat: 0, durationBeats: 2, pitch: 48, velocity: 80 }],
      }],
    }), 'preset-loop.mid')

    expect(sequencer.loopCount).toBe(Infinity)
    const replay = BasicMIDI.fromArrayBuffer(loadedBinary!)
    const programs = replay.tracks.flatMap((track) => track.events
      .filter((event) => (event.statusByte & 0xf0) === 0xc0)
      .map((event) => ({ channel: event.statusByte & 0x0f, program: event.data[0] })))
    expect(programs.filter((event) => event.channel === 0).map((event) => event.program)).toEqual([73, 73])
    expect(programs.filter((event) => event.channel === 1).map((event) => event.program)).toEqual([48])

    const programChanges: number[] = []
    seam.synth = {
      midiChannels: [],
      programChange: (_channel: number, program: number) => programChanges.push(program),
    }
    const preserveProgramOverride = engine as unknown as { preserveProgramOverride(channel: number, program: number): void }
    preserveProgramOverride.preserveProgramOverride(0, 0)
    expect(programChanges).toEqual([73])
    preserveProgramOverride.preserveProgramOverride(1, 48)
    expect(programChanges).toEqual([73])
  })
})

test('schedules a dedicated live voice on the audio clock and mutes pending onsets on stop', async () => {
  const context = {
    state: 'running', destination: {}, currentTime: 10,
    createGain: () => ({ gain: { value: 0 }, connect: () => {} }),
  } as unknown as AudioContext
  const calls: Array<[string, ...unknown[]]> = []
  const synth = {
    midiChannels: Array.from({ length: 16 }, () => ({ setDrums: (value: boolean) => calls.push(['drums', value]), setSystemParameter: (...args: unknown[]) => calls.push(['channel', ...args]) })),
    addNewChannel() { this.midiChannels.push({ setDrums: (value: boolean) => calls.push(['ai-drums', value]), setSystemParameter: (...args: unknown[]) => calls.push(['ai-channel', ...args]) }) },
    programChange: (...args: unknown[]) => calls.push(['program', ...args]),
    pitchWheel: (...args: unknown[]) => calls.push(['pitch', ...args]),
    noteOn: (...args: unknown[]) => calls.push(['on', ...args]),
    noteOff: (...args: unknown[]) => calls.push(['off', ...args]),
    controllerChange: (...args: unknown[]) => calls.push(['cc', ...args]),
  }
  const engine = new SpessaSynthEngine(context)
  ;(engine as unknown as { synth: typeof synth }).synth = synth
  await engine.beginRealtimeVoice()
  expect(engine.audioTime).toBe(10)
  expect(synth.midiChannels).toHaveLength(17)
  expect(calls).toContainEqual(['ai-drums', false])
  expect(calls).toContainEqual(['cc', 16, 7, 100])
  expect(calls).toContainEqual(['cc', 16, 11, 127])
  engine.scheduleRealtimeNote(48, 70, 10.1)
  engine.scheduleRealtimeNote(48, 0, 10.15)
  expect(calls).toContainEqual(['on', 16, 48, 70, { time: 10.1 }])
  expect(calls).toContainEqual(['off', 16, 48, { time: 10.15 }])
  engine.stopRealtimeVoice()
  expect(calls.slice(-2)).toEqual([['ai-channel', 'isMuted', true], ['cc', 16, 120, 0]])
  const restarting = engine.beginRealtimeVoice()
  await Promise.resolve()
  engine.stopRealtimeVoice()
  await restarting
  expect(calls.at(-2)).toEqual(['ai-channel', 'isMuted', true])
  expect(synth.midiChannels).toHaveLength(17)
})


test('the initialized extra channel produces audible scheduled piano samples', async () => {
  const core = new SpessaSynthProcessor(44_100, { effectsEnabled: false })
  await core.processorInitialized
  core.soundBankManager.addSoundBank(SoundBankLoader.fromArrayBuffer(await Bun.file('src/web/assets/freepiano-mda-piano.sf2').arrayBuffer()), 'piano')
  const context = {
    state: 'running', destination: {}, get currentTime() { return core.currentTime },
    createGain: () => ({ gain: { value: 0 }, connect: () => {} }),
  } as unknown as AudioContext
  const bridge = {
    get midiChannels() { return core.midiChannels },
    addNewChannel: () => core.createMIDIChannel(),
    programChange: core.programChange,
    controllerChange: core.controllerChange,
    pitchWheel: (channel: number, value: number) => core.pitchWheel(channel, value + 8192),
    noteOn: (channel: number, pitch: number, velocity: number, options: SynthMethodOptions) => core.processMessage(new Uint8Array([0x90 | channel % 16, pitch, velocity]), channel - channel % 16, options),
    noteOff: (channel: number, pitch: number, options: SynthMethodOptions) => core.processMessage(new Uint8Array([0x80 | channel % 16, pitch, 0]), channel - channel % 16, options),
  }
  const engine = new SpessaSynthEngine(context)
  ;(engine as unknown as { synth: typeof bridge }).synth = bridge
  try {
    await engine.beginRealtimeVoice()
    engine.setRealtimeVolume(0.65)
    engine.scheduleRealtimeNote(60, 90, 0.1)
    let peak = 0
    let earlyPeak = 0
    while (core.currentTime < 0.25) {
      const time = core.currentTime
      const left = new Float32Array(128)
      const right = new Float32Array(128)
      core.process(left, right)
      const blockPeak = Math.max(...left.map(Math.abs), ...right.map(Math.abs))
      if (time < 0.09) earlyPeak = Math.max(earlyPeak, blockPeak)
      peak = Math.max(peak, blockPeak)
    }
    expect(earlyPeak).toBe(0)
    expect(peak).toBeGreaterThan(0.001)
    engine.scheduleRealtimeNote(64, 90, core.currentTime + 0.1)
    engine.stopRealtimeVoice()
    let stoppedPeak = 0
    for (let i = 0; i < 100; i++) {
      const left = new Float32Array(128)
      const right = new Float32Array(128)
      core.process(left, right)
      stoppedPeak = Math.max(stoppedPeak, ...left.map(Math.abs), ...right.map(Math.abs))
    }
    expect(stoppedPeak).toBe(0)
  } finally {
    core.destroySynthProcessor()
  }
})
