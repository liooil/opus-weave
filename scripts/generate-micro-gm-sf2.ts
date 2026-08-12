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

const OUTPUT = resolve(import.meta.dir, '../src/web/assets/opusweave-micro-gm.sf2')
const SAMPLE_RATE = 22_050
const CYCLE_LENGTH = 256
const ROOT_KEY = 41
const PITCH_CORRECTION = -24

const GM_NAMES = [
  'Acoustic Grand Piano', 'Bright Acoustic Piano', 'Electric Grand Piano', 'Honky-tonk Piano', 'Electric Piano 1', 'Electric Piano 2', 'Harpsichord', 'Clavinet',
  'Celesta', 'Glockenspiel', 'Music Box', 'Vibraphone', 'Marimba', 'Xylophone', 'Tubular Bells', 'Dulcimer',
  'Drawbar Organ', 'Percussive Organ', 'Rock Organ', 'Church Organ', 'Reed Organ', 'Accordion', 'Harmonica', 'Tango Accordion',
  'Acoustic Guitar (nylon)', 'Acoustic Guitar (steel)', 'Electric Guitar (jazz)', 'Electric Guitar (clean)', 'Electric Guitar (muted)', 'Overdriven Guitar', 'Distortion Guitar', 'Guitar Harmonics',
  'Acoustic Bass', 'Electric Bass (finger)', 'Electric Bass (pick)', 'Fretless Bass', 'Slap Bass 1', 'Slap Bass 2', 'Synth Bass 1', 'Synth Bass 2',
  'Violin', 'Viola', 'Cello', 'Contrabass', 'Tremolo Strings', 'Pizzicato Strings', 'Orchestral Harp', 'Timpani',
  'String Ensemble 1', 'String Ensemble 2', 'Synth Strings 1', 'Synth Strings 2', 'Choir Aahs', 'Voice Oohs', 'Synth Voice', 'Orchestra Hit',
  'Trumpet', 'Trombone', 'Tuba', 'Muted Trumpet', 'French Horn', 'Brass Section', 'Synth Brass 1', 'Synth Brass 2',
  'Soprano Sax', 'Alto Sax', 'Tenor Sax', 'Baritone Sax', 'Oboe', 'English Horn', 'Bassoon', 'Clarinet',
  'Piccolo', 'Flute', 'Recorder', 'Pan Flute', 'Blown Bottle', 'Shakuhachi', 'Whistle', 'Ocarina',
  'Lead 1 (square)', 'Lead 2 (sawtooth)', 'Lead 3 (calliope)', 'Lead 4 (chiff)', 'Lead 5 (charang)', 'Lead 6 (voice)', 'Lead 7 (fifths)', 'Lead 8 (bass + lead)',
  'Pad 1 (new age)', 'Pad 2 (warm)', 'Pad 3 (polysynth)', 'Pad 4 (choir)', 'Pad 5 (bowed)', 'Pad 6 (metallic)', 'Pad 7 (halo)', 'Pad 8 (sweep)',
  'FX 1 (rain)', 'FX 2 (soundtrack)', 'FX 3 (crystal)', 'FX 4 (atmosphere)', 'FX 5 (brightness)', 'FX 6 (goblins)', 'FX 7 (echoes)', 'FX 8 (sci-fi)',
  'Sitar', 'Banjo', 'Shamisen', 'Koto', 'Kalimba', 'Bag Pipe', 'Fiddle', 'Shanai',
  'Tinkle Bell', 'Agogo', 'Steel Drums', 'Woodblock', 'Taiko Drum', 'Melodic Tom', 'Synth Drum', 'Reverse Cymbal',
  'Guitar Fret Noise', 'Breath Noise', 'Seashore', 'Bird Tweet', 'Telephone Ring', 'Helicopter', 'Applause', 'Gunshot',
] as const

interface FamilyConfig {
  name: string
  waveform: 'triangle' | 'bell' | 'organ' | 'square' | 'saw' | 'pulse' | 'sine' | 'noise'
  attack: number
  decay: number
  sustainCentibels: number
  release: number
  filterCents: number
}

const FAMILIES: FamilyConfig[] = [
  { name: 'Piano', waveform: 'triangle', attack: 0.003, decay: 2.2, sustainCentibels: 1100, release: 0.65, filterCents: 11_200 },
  { name: 'Chromatic Percussion', waveform: 'bell', attack: 0.002, decay: 1.8, sustainCentibels: 1200, release: 0.45, filterCents: 12_000 },
  { name: 'Organ', waveform: 'organ', attack: 0.012, decay: 8, sustainCentibels: 0, release: 0.25, filterCents: 12_500 },
  { name: 'Guitar', waveform: 'triangle', attack: 0.004, decay: 1.4, sustainCentibels: 1050, release: 0.45, filterCents: 10_900 },
  { name: 'Bass', waveform: 'square', attack: 0.006, decay: 1.8, sustainCentibels: 650, release: 0.35, filterCents: 8_800 },
  { name: 'Strings', waveform: 'saw', attack: 0.09, decay: 2.8, sustainCentibels: 180, release: 0.8, filterCents: 10_200 },
  { name: 'Ensemble', waveform: 'organ', attack: 0.18, decay: 3.5, sustainCentibels: 140, release: 1.1, filterCents: 10_000 },
  { name: 'Brass', waveform: 'saw', attack: 0.035, decay: 2.4, sustainCentibels: 220, release: 0.42, filterCents: 10_700 },
  { name: 'Reed', waveform: 'pulse', attack: 0.025, decay: 2.8, sustainCentibels: 160, release: 0.35, filterCents: 10_500 },
  { name: 'Pipe', waveform: 'sine', attack: 0.045, decay: 3.2, sustainCentibels: 110, release: 0.5, filterCents: 11_700 },
  { name: 'Synth Lead', waveform: 'square', attack: 0.008, decay: 1.8, sustainCentibels: 100, release: 0.22, filterCents: 12_200 },
  { name: 'Synth Pad', waveform: 'organ', attack: 0.42, decay: 4.5, sustainCentibels: 160, release: 1.8, filterCents: 9_800 },
  { name: 'Synth Effects', waveform: 'bell', attack: 0.16, decay: 3.6, sustainCentibels: 360, release: 1.25, filterCents: 11_500 },
  { name: 'Ethnic', waveform: 'triangle', attack: 0.008, decay: 1.7, sustainCentibels: 850, release: 0.48, filterCents: 11_100 },
  { name: 'Percussive', waveform: 'bell', attack: 0.002, decay: 1.15, sustainCentibels: 1250, release: 0.3, filterCents: 12_400 },
  { name: 'Sound Effects', waveform: 'noise', attack: 0.012, decay: 2.4, sustainCentibels: 700, release: 0.7, filterCents: 10_800 },
]

function secondsToTimecents(seconds: number): number {
  return Math.round(1200 * Math.log2(seconds))
}

function waveform(kind: FamilyConfig['waveform']): Float32Array {
  let noiseState = 0x4f505553
  return Float32Array.from({ length: CYCLE_LENGTH + 1 }, (_, index) => {
    const phase = (index % CYCLE_LENGTH) / CYCLE_LENGTH
    if (kind === 'triangle') return (2 / Math.PI) * Math.asin(Math.sin(phase * Math.PI * 2))
    if (kind === 'bell') return 0.72 * Math.sin(phase * Math.PI * 2) + 0.2 * Math.sin(phase * Math.PI * 6) + 0.08 * Math.sin(phase * Math.PI * 10)
    if (kind === 'organ') return 0.72 * Math.sin(phase * Math.PI * 2) + 0.2 * Math.sin(phase * Math.PI * 4) + 0.08 * Math.sin(phase * Math.PI * 6)
    if (kind === 'square') return phase < 0.5 ? 0.82 : -0.82
    if (kind === 'saw') return 0.82 * (phase * 2 - 1)
    if (kind === 'pulse') return phase < 0.28 ? 0.78 : -0.78
    if (kind === 'sine') return Math.sin(phase * Math.PI * 2)
    noiseState = (Math.imul(noiseState, 1_664_525) + 1_013_904_223) >>> 0
    return ((noiseState / 0xffff_ffff) * 2 - 1) * 0.72
  })
}

function decayingNoise(seconds: number, seed: number, tonal = false): Float32Array {
  let state = seed >>> 0
  const length = Math.round(seconds * SAMPLE_RATE)
  return Float32Array.from({ length }, (_, index) => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
    const noise = (state / 0xffff_ffff) * 2 - 1
    const tone = Math.sin(index * Math.PI * 2 * (tonal ? 90 : 260) / SAMPLE_RATE)
    return (noise * (tonal ? 0.28 : 0.72) + tone * (tonal ? 0.72 : 0.28)) * Math.exp(-index / (length * 0.2))
  })
}

const bank = new BasicSoundBank('sf2')
bank.soundBankInfo = {
  ...bank.soundBankInfo,
  creationDate: new Date('2026-08-12T00:00:00.000Z'),
  name: 'OpusWeave Micro GM',
  engineer: 'OpusWeave contributors',
  product: 'OpusWeave deterministic compact General MIDI fallback',
  copyright: 'Generated waveforms dedicated to the public domain under CC0-1.0',
  comment: 'Single-cycle melodic waveforms with family-specific SF2 envelopes; one-shot procedural drums.',
}

const melodicSamples = new Map<FamilyConfig['waveform'], BasicSample>()
for (const kind of [...new Set(FAMILIES.map((family) => family.waveform))]) {
  const sample = new BasicSample(kind, SAMPLE_RATE, ROOT_KEY, PITCH_CORRECTION, SampleTypes.monoSample, 0, CYCLE_LENGTH)
  sample.setAudioData(waveform(kind), SAMPLE_RATE)
  melodicSamples.set(kind, sample)
}

const instruments = FAMILIES.map((family) => {
  const instrument = new BasicInstrument()
  instrument.name = `GM ${family.name}`
  const zone = instrument.createZone(melodicSamples.get(family.waveform)!)
  zone.setGenerator(GeneratorTypes.sampleModes, 1)
  zone.setGenerator(GeneratorTypes.attackVolEnv, secondsToTimecents(family.attack))
  zone.setGenerator(GeneratorTypes.decayVolEnv, secondsToTimecents(family.decay))
  zone.setGenerator(GeneratorTypes.sustainVolEnv, family.sustainCentibels)
  zone.setGenerator(GeneratorTypes.releaseVolEnv, secondsToTimecents(family.release))
  zone.setGenerator(GeneratorTypes.initialFilterFc, family.filterCents)
  return instrument
})

const presets = GM_NAMES.map((name, program) => {
  const preset = new BasicPreset(bank)
  preset.name = name
  preset.program = program
  preset.bankMSB = 0
  preset.bankLSB = 0
  preset.createZone(instruments[Math.floor(program / 8)]!)
  return preset
})

const drumSpecs = [
  { name: 'kick', low: 35, high: 36, seconds: 0.55, tonal: true },
  { name: 'snare', low: 37, high: 40, seconds: 0.42, tonal: false },
  { name: 'tom', low: 41, high: 50, seconds: 0.52, tonal: true },
  { name: 'hat', low: 51, high: 59, seconds: 0.24, tonal: false },
  { name: 'clap', low: 60, high: 69, seconds: 0.38, tonal: false },
  { name: 'cymbal', low: 70, high: 81, seconds: 0.95, tonal: false },
]
const drumInstrument = new BasicInstrument()
drumInstrument.name = 'GM Standard Drum Kit'
const drumSamples = drumSpecs.map((spec, index) => {
  const data = decayingNoise(spec.seconds, 0x4f50_0000 + index, spec.tonal)
  const sample = new BasicSample(spec.name, SAMPLE_RATE, 60, 0, SampleTypes.monoSample, 0, data.length)
  sample.setAudioData(data, SAMPLE_RATE)
  const zone = drumInstrument.createZone(sample)
  zone.keyRange = { min: spec.low, max: spec.high }
  zone.setGenerator(GeneratorTypes.overridingRootKey, 60)
  return sample
})
const drumPreset = new BasicPreset(bank)
drumPreset.name = 'Standard Drum Kit'
drumPreset.program = 0
drumPreset.bankMSB = 128
drumPreset.bankLSB = 0
drumPreset.createZone(drumInstrument)

bank.addSamples(...melodicSamples.values(), ...drumSamples)
bank.addInstruments(...instruments, drumInstrument)
bank.addPresets(...presets, drumPreset)

mkdirSync(dirname(OUTPUT), { recursive: true })
await Bun.write(OUTPUT, bank.writeSF2({
  software: 'OpusWeave Micro GM SoundFont generator',
  writeDefaultModulators: true,
  writeExtendedLimits: false,
}))
console.log(`Wrote ${OUTPUT} (${Bun.file(OUTPUT).size} bytes)`)
