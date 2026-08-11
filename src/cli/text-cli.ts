import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { OpusWeaveService } from '../domain/services/opusweave-service.ts'
import { parseRational, rational, type Rational } from '../domain/owt/rational.ts'

export type TextCliResult =
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

function parseMeter(text = '4/4'): { numerator: number; denominator: number } {
  const match = /^(\d+)\/(\d+)$/.exec(text)
  if (!match) throw new Error(`invalid meter ${text}; expected numerator/denominator`)
  const numerator = Number(match[1])
  const denominator = Number(match[2])
  if (!Number.isInteger(numerator) || numerator < 1 || !Number.isInteger(denominator) || denominator < 1 || (denominator & (denominator - 1)) !== 0) {
    throw new Error(`invalid meter ${text}`)
  }
  return { numerator, denominator }
}

/** CLI grids use conventional whole-note fractions: 1/16 becomes OWT quarter-unit 1/4. */
export function parseQuantizationGrid(text = '1/16'): Rational {
  const fraction = parseRational(text)
  if (!fraction) throw new Error(`invalid grid ${text}; expected a fraction such as 1/16`)
  return rational(fraction.numerator * 4, fraction.denominator)
}

async function outputText(text: string, output?: string): Promise<void> {
  if (output) await writeFile(resolve(output), text, 'utf8')
  else process.stdout.write(text)
}

export async function runTextCli(args: string[], service: OpusWeaveService): Promise<TextCliResult> {
  const command = args[0]
  const parsed = parseArgs(args.slice(1))
  const input = parsed.positional[0]
  if (!command || !input) {
    throw new Error('usage: opusweave text <validate|play|to-midi|from-midi> <file> [options]')
  }

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
    if (!output) throw new Error('text to-midi requires -o <output.mid>')
    const result = await service.compileOwtScore(await Bun.file(resolve(input)).text(), output)
    console.log(JSON.stringify(result, null, 2))
    return { kind: 'done' }
  }

  if (command === 'from-midi') {
    const imported = await service.importMidiAsTake(input)
    const view = parsed.flags.view ?? 'exact'
    if (view === 'exact') {
      await outputText(imported.text, parsed.flags.output)
      return { kind: 'done' }
    }
    if (view !== 'quantized') throw new Error(`unsupported view ${view}; expected exact or quantized`)
    const bpm = Number(parsed.flags.bpm ?? 120)
    if (!Number.isFinite(bpm) || bpm <= 0) throw new Error('--bpm must be a positive number')
    const result = service.quantizeTakeText(imported.text, {
      grid: parseQuantizationGrid(parsed.flags.grid),
      bpm,
      meter: parseMeter(parsed.flags.meter),
      title: imported.take.title ? `${imported.take.title}, quantized` : undefined,
    })
    await outputText(result.text, parsed.flags.output)
    return { kind: 'done' }
  }

  throw new Error(`unknown text command: ${command}`)
}
