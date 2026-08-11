import { MappingEngine, type BuiltinComputerLayoutId } from '../devices/mapping-engine.ts'
import { pitchesToOwt } from './musical-typing.ts'

const TRACK_NAMES: Record<BuiltinComputerLayoutId, string> = {
  default: 'OpusWeave Keyboard',
  english: 'English Word Melody',
  pinyin: 'Pinyin Melody',
  freepiano: 'FreePiano Classic',
}

export function keyboardLayoutTextPitches(text: string, layout: BuiltinComputerLayoutId): number[] {
  const mapping = new MappingEngine({ layout })
  const pitches: number[] = []
  for (const character of text) {
    for (const message of mapping.keyDownMessages(character)) pitches.push(message[1]!)
  }
  return pitches
}

export function keyboardLayoutTextToOwt(text: string, layout: BuiltinComputerLayoutId): string {
  return pitchesToOwt(keyboardLayoutTextPitches(text, layout), text, TRACK_NAMES[layout])
}
