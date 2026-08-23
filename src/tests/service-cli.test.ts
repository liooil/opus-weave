import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parseLongOptions } from '../cli/cli.ts'
import { runServiceCli } from '../cli/service-cli.ts'
import { OpusWeaveService } from '../domain/services/opusweave-service.ts'

const temporaryDirectories: string[] = []

afterAll(async () => {
  await Promise.all(temporaryDirectories.map((path) => rm(path, { recursive: true, force: true })))
})

describe('application-owned service CLI', () => {
  test('parses both long-option forms and rejects invalid input', () => {
    expect(parseLongOptions('example', ['--one', 'first', '--two=second'], ['one', 'two'])).toEqual({
      one: 'first',
      two: 'second',
    })
    expect(() => parseLongOptions('example', ['unexpected'], ['one'])).toThrow('unexpected positional argument')
    expect(() => parseLongOptions('example', ['--unknown', 'value'], ['one'])).toThrow('unknown option --unknown')
    expect(() => parseLongOptions('example', ['--one'], ['one'])).toThrow('option --one requires a value')
  })

  test('keeps create-midi available without starting BunDesk', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'opusweave-service-cli-'))
    temporaryDirectories.push(directory)
    const service = new OpusWeaveService()
    const specPath = join(directory, 'composition.json')
    const midiPath = join(directory, 'composition.mid')
    await Bun.write(specPath, JSON.stringify(service.createExampleComposition()))

    expect(await runServiceCli([
      'create-midi',
      '--spec', specPath,
      '--output', midiPath,
    ], service)).toBe(true)

    expect(await Bun.file(midiPath).exists()).toBe(true)
    expect(Bun.file(midiPath).size).toBeGreaterThan(0)
    expect(await runServiceCli(['not-a-service-command'], service)).toBe(false)
  })
})
