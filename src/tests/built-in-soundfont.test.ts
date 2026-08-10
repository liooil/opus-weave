import { describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'
import { SoundBankLoader } from 'spessasynth_core'

const soundFontPath = resolve(import.meta.dir, '../web/assets/opusweave-micro-gm.sf2')

describe('built-in Micro GM SoundFont', () => {
  test('is compact, parseable, and covers General MIDI programs and drums', async () => {
    const file = Bun.file(soundFontPath)
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
