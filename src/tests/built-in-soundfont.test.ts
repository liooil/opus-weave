import { describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'
import { SoundBankLoader, SpessaSynthProcessor } from 'spessasynth_core'

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
