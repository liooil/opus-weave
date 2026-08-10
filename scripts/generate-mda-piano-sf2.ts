import {
  BasicInstrument,
  BasicPreset,
  BasicSample,
  BasicSoundBank,
  GeneratorTypes,
  SampleTypes,
} from 'spessasynth_core'
import { dirname, resolve } from 'node:path'
import { mkdirSync } from 'node:fs'

// Pinned MIT-licensed mdaPiano source. FreePiano 1.8 uses this instrument by
// default (data/freepiano.cfg: "instrument path mdaPiano").
const MDA_COMMIT = '8ea6ef97946a617d73e48d245777e57fb984357f'
const SAMPLE_SOURCE = `https://raw.githubusercontent.com/elk-audio/mda-vst2/${MDA_COMMIT}/plugins/mdaPianoData.h`
const OUTPUT = resolve(import.meta.dir, '../src/web/assets/freepiano-mda-piano.sf2')
const SAMPLE_RATE = 22_050

interface KeyGroup {
  root: number
  high: number
  start: number
  end: number
  loopLength: number
}

// Exact key groups from the original mdaPiano v1.0 source.
const KEY_GROUPS: KeyGroup[] = [
  { root: 36, high: 37, start: 0, end: 36_275, loopLength: 14_774 },
  { root: 40, high: 41, start: 36_278, end: 83_135, loopLength: 16_268 },
  { root: 43, high: 45, start: 83_137, end: 146_756, loopLength: 33_541 },
  { root: 48, high: 49, start: 146_758, end: 204_997, loopLength: 21_156 },
  { root: 52, high: 53, start: 204_999, end: 244_908, loopLength: 17_191 },
  { root: 55, high: 57, start: 244_910, end: 290_978, loopLength: 23_286 },
  { root: 60, high: 61, start: 290_980, end: 342_948, loopLength: 18_002 },
  { root: 64, high: 65, start: 342_950, end: 391_750, loopLength: 19_746 },
  { root: 67, high: 69, start: 391_752, end: 436_915, loopLength: 22_253 },
  { root: 72, high: 73, start: 436_917, end: 468_807, loopLength: 8_852 },
  { root: 76, high: 77, start: 468_809, end: 492_772, loopLength: 9_693 },
  { root: 79, high: 81, start: 492_774, end: 532_293, loopLength: 10_596 },
  { root: 84, high: 85, start: 532_295, end: 560_192, loopLength: 6_011 },
  { root: 88, high: 89, start: 560_194, end: 574_121, loopLength: 3_414 },
  { root: 93, high: 127, start: 574_123, end: 586_343, loopLength: 2_399 },
]

// mdaPiano's default patch moves key-group boundaries upward as velocity
// increases (its "Velocity to Hardness" behavior). These bands reproduce the
// integer offsets used by the original implementation.
const VELOCITY_BANDS = [
  { min: 1, max: 56, hardnessOffset: 0, filterCents: 10_850 },
  { min: 57, max: 73, hardnessOffset: 1, filterCents: 11_000 },
  { min: 74, max: 89, hardnessOffset: 2, filterCents: 11_150 },
  { min: 90, max: 106, hardnessOffset: 3, filterCents: 11_300 },
  { min: 107, max: 123, hardnessOffset: 4, filterCents: 11_450 },
  { min: 124, max: 127, hardnessOffset: 5, filterCents: 11_600 },
]

function secondsToTimecents(seconds: number): number {
  return Math.round(1200 * Math.log2(seconds))
}

function mdaDecaySeconds(note: number): number {
  const timeConstant = Math.exp(1.6 - 0.033 * note)
  return 11.5129 * timeConstant // -100 dB, matching the SF2 zero-sustain target
}

function mdaReleaseSeconds(note: number): number {
  const timeConstant = Math.exp(-1 - 0.017 * note)
  return 11.5129 * timeConstant
}

async function readPcm(): Promise<Int16Array> {
  const response = await fetch(SAMPLE_SOURCE)
  if (!response.ok) throw new Error(`mdaPiano source download failed: HTTP ${response.status}`)
  const source = await response.text()
  const body = source.match(/short\s+pianoData\[\]\s*=\s*\{([\s\S]*?)\};/)?.[1]
  if (!body) throw new Error('mdaPianoData.h does not contain pianoData')
  const values = body.match(/-?\d+/g)?.map(Number) ?? []
  if (values.length !== 586_349) throw new Error(`expected 586349 PCM samples, got ${values.length}`)
  return Int16Array.from(values)
}

const pcm = await readPcm()
const bank = new BasicSoundBank('sf2')
bank.soundBankInfo = {
  ...bank.soundBankInfo,
  creationDate: new Date('2008-01-01T00:00:00.000Z'),
  name: 'FreePiano mda Piano',
  engineer: 'Paul Kellett; SoundFont adaptation by OpusWeave',
  product: 'OpusWeave FreePiano-compatible default piano',
  copyright: 'mdaPiano samples and source © Paul Kellett, MIT License',
  comment: `Derived from mdaPiano v1.0 sample data at ${MDA_COMMIT}.`,
}

const samples = KEY_GROUPS.map((group) => {
  // mdaPiano reads one interpolation guard after end. Preserve it in the
  // sample while keeping the loop end at the original end + 1.
  const source = pcm.subarray(group.start, group.end + 2)
  const loopEnd = group.end + 1 - group.start
  const loopStart = loopEnd - group.loopLength
  const sample = new BasicSample(
    `mda ${group.root}`,
    SAMPLE_RATE,
    group.root,
    0,
    SampleTypes.monoSample,
    loopStart,
    loopEnd,
  )
  sample.setAudioData(Float32Array.from(source, (value) => value / 32_768), SAMPLE_RATE)
  return sample
})

const instrument = new BasicInstrument()
instrument.name = 'mda Piano'

for (const band of VELOCITY_BANDS) {
  let lowKey = 0
  for (let index = 0; index < KEY_GROUPS.length; index++) {
    const group = KEY_GROUPS[index]!
    const highKey = index === KEY_GROUPS.length - 1
      ? 127
      : Math.min(127, group.high + band.hardnessOffset)
    if (lowKey <= highKey) {
      const zone = instrument.createZone(samples[index]!)
      zone.keyRange = { min: lowKey, max: highKey }
      zone.velRange = { min: band.min, max: band.max }
      zone.setGenerator(GeneratorTypes.sampleModes, 1)
      zone.setGenerator(GeneratorTypes.initialFilterFc, band.filterCents)
      zone.setGenerator(GeneratorTypes.decayVolEnv, secondsToTimecents(mdaDecaySeconds(group.root)))
      zone.setGenerator(GeneratorTypes.sustainVolEnv, 1000)
      zone.setGenerator(GeneratorTypes.releaseVolEnv, secondsToTimecents(mdaReleaseSeconds(group.root)))
      zone.setGenerator(GeneratorTypes.pan, Math.max(-500, Math.min(500, (group.root - 60) * 20)))
    }
    lowKey = highKey + 1
  }
}

const preset = new BasicPreset(bank)
preset.name = 'mda Piano FreePiano'
preset.program = 0
preset.bankMSB = 0
preset.bankLSB = 0
preset.createZone(instrument)

bank.addSamples(...samples)
bank.addInstruments(instrument)
bank.addPresets(preset)

mkdirSync(dirname(OUTPUT), { recursive: true })
await Bun.write(OUTPUT, bank.writeSF2({
  software: 'OpusWeave mdaPiano SoundFont generator',
  writeDefaultModulators: true,
  writeExtendedLimits: false,
}))
console.log(`Wrote ${OUTPUT} (${Bun.file(OUTPUT).size} bytes)`)
