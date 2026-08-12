import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { BasicSoundBank, SoundBankLoader, SpessaSynthProcessor } from 'spessasynth_core'

const gmSoundFontPath = resolve(import.meta.dir, '../web/assets/soundfonts/FluidR3Mono_GM.sf3')
const pianoSoundFontPath = resolve(import.meta.dir, '../web/assets/freepiano-mda-piano.sf2')

describe('built-in FluidR3Mono GM SoundFont', () => {
  test('is a separately packaged, parseable full General MIDI bank', async () => {
    const file = Bun.file(gmSoundFontPath)
    expect(await file.exists()).toBe(true)
    expect(file.size).toBeGreaterThan(10 * 1024 * 1024)
    expect(file.size).toBeLessThan(16 * 1024 * 1024)

    const buffer = await file.arrayBuffer()
    expect(createHash('sha256').update(new Uint8Array(buffer)).digest('hex')).toBe('cfcd66d89e8386823400eca64934b14fbea7bf48ba1f00d21189af1262794ec2')
    const bank = SoundBankLoader.fromArrayBuffer(buffer)
    expect(bank.soundBankInfo.name).toContain('FluidR3Mono')

    const melodicPrograms = new Set(
      bank.presets
        .filter((preset) => preset.bankMSB === 0 && !preset.isDrum)
        .map((preset) => preset.program),
    )
    expect(melodicPrograms.size).toBe(128)
    for (let program = 0; program < 128; program++) expect(melodicPrograms.has(program)).toBe(true)

    expect(bank.presets.some((preset) => preset.isDrum && preset.program === 0)).toBe(true)
    expect(bank.samples.length).toBeGreaterThan(1_000)
  })

  test('provides genuinely distinct presets within piano and chromatic-percussion families', async () => {
    const bank = SoundBankLoader.fromArrayBuffer(await Bun.file(gmSoundFontPath).arrayBuffer())
    const names = (programs: number[]) => programs.map((program) => {
      const preset = bank.presets.find((candidate) => candidate.bankMSB === 0 && !candidate.isDrum && candidate.program === program)
      return `${preset?.name}:${preset?.zones[0]?.instrument?.name}`
    })
    expect(new Set(names([0, 1, 2, 3, 4, 5, 6, 7])).size).toBe(8)
    expect(new Set(names([8, 9, 10, 11, 12, 13, 14, 15])).size).toBe(8)
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

  test('overrides program 0 while retaining FluidR3Mono GM instruments', async () => {
    const [gmBuffer, pianoBuffer] = await Promise.all([
      Bun.file(gmSoundFontPath).arrayBuffer(),
      Bun.file(pianoSoundFontPath).arrayBuffer(),
    ])
    await BasicSoundBank.isSF3DecoderReady
    const synth = new SpessaSynthProcessor(44_100)
    synth.soundBankManager.addSoundBank(SoundBankLoader.fromArrayBuffer(pianoBuffer), 'main')
    synth.soundBankManager.addSoundBank(SoundBankLoader.fromArrayBuffer(gmBuffer), 'fluid-r3-mono-gm')
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
