import { describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'
import { GeneratorTypes, SoundBankLoader, SpessaSynthProcessor } from 'spessasynth_core'

const gmSoundFontPath = resolve(import.meta.dir, '../web/assets/opusweave-micro-gm.sf2')
const pianoSoundFontPath = resolve(import.meta.dir, '../web/assets/freepiano-mda-piano.sf2')

describe('built-in Micro GM SoundFont', () => {
  test('is compact, parseable, and covers General MIDI programs and drums', async () => {
    const file = Bun.file(gmSoundFontPath)
    expect(await file.exists()).toBe(true)
    expect(file.size).toBeLessThan(256 * 1024)

    const bank = SoundBankLoader.fromArrayBuffer(await file.arrayBuffer())
    expect(bank.soundBankInfo.name).toBe('OpusWeave Micro GM')

    const melodicPrograms = new Set(
      bank.presets
        .filter((preset) => preset.bankMSB === 0 && !preset.isDrum)
        .map((preset) => preset.program),
    )
    expect(melodicPrograms.size).toBe(128)
    for (let program = 0; program < 128; program++) expect(melodicPrograms.has(program)).toBe(true)

    expect(bank.presets.some((preset) => preset.isDrum && preset.program === 0)).toBe(true)
    expect(bank.samples.length).toBeGreaterThanOrEqual(8)
  })

  test('loops every melodic family with explicit articulation envelopes', async () => {
    const bank = SoundBankLoader.fromArrayBuffer(await Bun.file(gmSoundFontPath).arrayBuffer())
    const melodic = bank.instruments.filter((instrument) => !instrument.name.includes('Drum'))
    expect(melodic).toHaveLength(16)
    for (const instrument of melodic) {
      const zone = instrument.zones[0]!
      const generators = new Map([...zone.generators].map((generator) => [generator.type, generator.value]))
      expect(generators.get(GeneratorTypes.sampleModes)).toBe(1)
      expect(generators.has(GeneratorTypes.attackVolEnv)).toBe(true)
      expect(generators.has(GeneratorTypes.decayVolEnv)).toBe(true)
      expect(generators.has(GeneratorTypes.sustainVolEnv)).toBe(true)
      expect(generators.has(GeneratorTypes.releaseVolEnv)).toBe(true)
      expect(zone.sample!.loopEnd).toBeGreaterThan(zone.sample!.loopStart)
    }
    const drums = bank.instruments.find((instrument) => instrument.name.includes('Drum'))!
    for (const zone of drums.zones) {
      const generators = new Map([...zone.generators].map((generator) => [generator.type, generator.value]))
      expect(generators.get(GeneratorTypes.sampleModes)).toBeUndefined()
    }
  })

  test('sustains a melodic preset beyond its single-cycle sample and releases to silence', async () => {
    const bank = SoundBankLoader.fromArrayBuffer(await Bun.file(gmSoundFontPath).arrayBuffer())
    const synth = new SpessaSynthProcessor(44_100)
    synth.soundBankManager.addSoundBank(bank, 'main')
    synth.programChange(0, 40)
    synth.noteOn(0, 60, 100)
    let heldEnergy = 0
    for (let block = 0; block < 220; block++) {
      const left = new Float32Array(128)
      const right = new Float32Array(128)
      synth.process(left, right)
      if (block >= 180) heldEnergy = Math.max(heldEnergy, ...left.map(Math.abs))
    }
    expect(heldEnergy).toBeGreaterThan(0.001)
    synth.noteOff(0, 60)
    let releaseEnergy = 0
    for (let block = 0; block < 500; block++) {
      const left = new Float32Array(128)
      const right = new Float32Array(128)
      synth.process(left, right)
      if (block >= 470) releaseEnergy = Math.max(releaseEnergy, ...left.map(Math.abs))
    }
    expect(releaseEnergy).toBeLessThan(0.0001)
    synth.destroySynthProcessor()
  })
})

describe('FreePiano-compatible default piano', () => {
  test('uses the original mdaPiano sample set and key groups', async () => {
    const file = Bun.file(pianoSoundFontPath)
    expect(await file.exists()).toBe(true)
    expect(file.size).toBeLessThan(1.5 * 1024 * 1024)

    const bank = SoundBankLoader.fromArrayBuffer(await file.arrayBuffer())
    expect(bank.soundBankInfo.name).toBe('FreePiano mda Piano')
    expect(bank.presets).toHaveLength(1)
    expect(bank.presets[0]).toMatchObject({ bankMSB: 0, program: 0 })
    expect(bank.presets[0]!.name).toStartWith('mda Piano')
    expect(bank.samples).toHaveLength(15)
    expect(bank.instruments[0]!.zones).toHaveLength(90)
  })

  test('overrides program 0 while retaining Micro GM instruments', async () => {
    const [gmBuffer, pianoBuffer] = await Promise.all([
      Bun.file(gmSoundFontPath).arrayBuffer(),
      Bun.file(pianoSoundFontPath).arrayBuffer(),
    ])
    const synth = new SpessaSynthProcessor(44_100)
    synth.soundBankManager.addSoundBank(SoundBankLoader.fromArrayBuffer(pianoBuffer), 'main')
    synth.soundBankManager.addSoundBank(SoundBankLoader.fromArrayBuffer(gmBuffer), 'micro-gm-fallback')
    const piano = synth.soundBankManager.presetList.find((preset) => preset.bankMSB === 0 && preset.program === 0 && !preset.isDrum)
    const violin = synth.soundBankManager.presetList.find((preset) => preset.bankMSB === 0 && preset.program === 40 && !preset.isDrum)
    expect(piano?.name).toStartWith('mda Piano')
    expect(violin?.name).toBeTruthy()

    synth.noteOn(0, 60, 100)
    const left = new Float32Array(128)
    const right = new Float32Array(128)
    synth.process(left, right)
    expect(left.some((sample) => Math.abs(sample) > 0.0001)).toBe(true)
    synth.destroySynthProcessor()
  })
})
