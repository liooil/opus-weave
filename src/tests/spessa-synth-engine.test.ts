import { describe, expect, test } from 'bun:test'
import { SpessaSynthEngine } from '../audio/spessa-synth-engine.ts'

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
})
