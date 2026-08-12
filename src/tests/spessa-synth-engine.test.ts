import { describe, expect, test } from 'bun:test'
import { BasicMIDI } from 'spessasynth_core'
import { SpessaSynthEngine } from '../audio/spessa-synth-engine.ts'
import { buildMidi } from '../domain/midi/midi-export.ts'

interface SynthCall {
  method: string
  args: number[]
}

describe('SpessaSynthEngine live MIDI delivery', () => {
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
