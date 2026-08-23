import { resolve } from 'node:path'
import type { OpusWeaveService } from '../domain/services/opusweave-service.ts'
import { optionalNumber, optionalString, parseLongOptions, printJson, requireString } from './cli.ts'

const serviceCommands = ['create-midi', 'inspect-midi', 'render-midi', 'doctor'] as const
type ServiceCommand = typeof serviceCommands[number]

function isServiceCommand(value: string | undefined): value is ServiceCommand {
  return serviceCommands.some((command) => command === value)
}

/**
 * Runs the service-backed commands that BunDesk used to expose as framework
 * actions. Returns false when argv belongs to the desktop runtime instead.
 */
export async function runServiceCli(
  argv: string[],
  service: OpusWeaveService,
): Promise<boolean> {
  const command = argv[0]
  if (!isServiceCommand(command)) return false

  if (command === 'create-midi') {
    const args = parseLongOptions(command, argv.slice(1), ['spec', 'output'])
    const specPath = requireString(args, 'spec')
    const output = requireString(args, 'output')
    const raw = await Bun.file(resolve(specPath)).text()
    printJson(await service.createMidi(JSON.parse(raw) as unknown, output))
    return true
  }

  if (command === 'inspect-midi') {
    const args = parseLongOptions(command, argv.slice(1), ['file'])
    printJson(await service.inspectMidiFile(requireString(args, 'file')))
    return true
  }

  if (command === 'render-midi') {
    const args = parseLongOptions(command, argv.slice(1), ['midi', 'soundfont', 'output', 'sample-rate', 'gain'])
    printJson(await service.renderMidi({
      midi: requireString(args, 'midi'),
      soundfont: requireString(args, 'soundfont'),
      output: requireString(args, 'output'),
      sampleRate: optionalNumber(args, 'sample-rate', 44100),
      gain: optionalNumber(args, 'gain', 0.5),
    }))
    return true
  }

  const args = parseLongOptions(command, argv.slice(1), ['soundfont'])
  printJson(await service.doctor({ soundfont: optionalString(args, 'soundfont') }))
  return true
}
