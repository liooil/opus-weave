import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { OpusWeaveService } from '../domain/services/opusweave-service.ts'
import { parseRational, rational, type Rational } from '../domain/owt/rational.ts'
import type { MelodyVoiceStrategy } from '../domain/owt/integration.ts'

export type OwtCliResult =
  | { kind: 'done' }
  | { kind: 'play'; midi: Uint8Array<ArrayBuffer>; title?: string }

interface ParsedArgs {
  positional: string[]
  flags: Record<string, string>
}

function parseArgs(args: string[]): ParsedArgs {
  const positional: string[] = []
  const flags: Record<string, string> = {}
  for (let index = 0; index < args.length; index++) {
    const value = args[index]!
    if (value === '-o' || value.startsWith('--')) {
      const name = value === '-o' ? 'output' : value.slice(2)
      const next = args[index + 1]
      if (!next || next.startsWith('-')) throw new Error(`${value} requires a value`)
      flags[name] = next
      index++
    } else positional.push(value)
  }
  return { positional, flags }
}

/** CLI grids use conventional whole-note fractions: 1/16 becomes OWT quarter-unit 1/4. */
export function parseQuantizationGrid(text = '1/16'): Rational {
  const fraction = parseRational(text)
  if (!fraction || fraction.numerator <= 0) throw new Error(`invalid grid ${text}; expected a positive fraction such as 1/16`)
  return rational(fraction.numerator * 4, fraction.denominator)
}

async function outputText(text: string, output?: string): Promise<void> {
  if (output) await writeFile(resolve(output), text, 'utf8')
  else process.stdout.write(text)
}

function positiveInteger(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer`)
  return parsed
}

export async function runOwtCli(args: string[], service: OpusWeaveService): Promise<OwtCliResult> {
  const command = args[0]
  const parsed = parseArgs(args.slice(1))
  const input = parsed.positional[0]
  if (!command || !input) throw new Error('usage: opusweave owt <validate|play|to-midi|from-midi> <file> [options]')

  if (command === 'validate') {
    const result = service.validateOwt(await Bun.file(resolve(input)).text())
    console.log(JSON.stringify(result, null, 2))
    if (!result.valid) process.exitCode = 1
    return { kind: 'done' }
  }

  if (command === 'play') {
    const playback = service.prepareOwtPlayback(await Bun.file(resolve(input)).text())
    return { kind: 'play', midi: Uint8Array.from(Buffer.from(playback.midiBase64, 'base64')), title: playback.title }
  }

  if (command === 'to-midi') {
    const output = parsed.flags.output
    if (!output) throw new Error('owt to-midi requires -o <output.mid>')
    const result = await service.compileOwtScore(await Bun.file(resolve(input)).text(), output)
    console.log(JSON.stringify(result, null, 2))
    return { kind: 'done' }
  }

  if (command === 'from-midi') {
    const voice = parsed.flags.voice ?? 'continuous'
    if (voice !== 'continuous' && voice !== 'highest' && voice !== 'lowest') {
      throw new Error('--voice must be continuous, highest, or lowest')
    }
    const track = positiveInteger(parsed.flags.track, '--track')
    const result = await service.importMidiAsOwt(input, {
      grid: parseQuantizationGrid(parsed.flags.grid),
      trackIndex: track === undefined ? undefined : track - 1,
      channel: positiveInteger(parsed.flags.channel, '--channel'),
      voiceStrategy: voice as MelodyVoiceStrategy,
      preserveVelocity: parsed.flags['preserve-velocity'] === 'true',
    })
    await outputText(result.text, parsed.flags.output)
    if (parsed.flags.output) console.log(JSON.stringify(result.report, null, 2))
    return { kind: 'done' }
  }

  throw new Error(`unknown owt command: ${command}`)
}
