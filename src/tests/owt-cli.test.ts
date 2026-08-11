import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runTextCli } from '../cli/text-cli.ts'
import { OpusWeaveService } from '../domain/services/opusweave-service.ts'
import { parseOwtOrThrow } from '../domain/owt/parser.ts'

const directory = mkdtempSync(join(tmpdir(), 'opusweave-owt-cli-'))
afterAll(() => rmSync(directory, { recursive: true, force: true }))

describe('OWT CLI workflows', () => {
  test('validates, compiles, imports exact Take, and quantizes MIDI', async () => {
    const service = new OpusWeaveService()
    const midiPath = join(directory, 'twinkle.mid')
    const takePath = join(directory, 'twinkle-take.owt')
    const scorePath = join(directory, 'twinkle-quantized.owt')

    const validation = service.validateOwt(await Bun.file('examples/twinkle.owt').text())
    expect(validation.valid).toBe(true)

    expect(await runTextCli(['to-midi', 'examples/twinkle.owt', '-o', midiPath], service)).toEqual({ kind: 'done' })
    expect(await Bun.file(midiPath).exists()).toBe(true)

    expect(await runTextCli(['from-midi', midiPath, '--view', 'exact', '-o', takePath], service)).toEqual({ kind: 'done' })
    expect(parseOwtOrThrow(await Bun.file(takePath).text()).kind).toBe('take')

    expect(await runTextCli([
      'from-midi', midiPath, '--view', 'quantized', '--grid', '1/16', '--bpm', '100', '-o', scorePath,
    ], service)).toEqual({ kind: 'done' })
    expect(parseOwtOrThrow(await Bun.file(scorePath).text()).kind).toBe('score')
  })

  test('prepares text play as a GUI startup MIDI payload', async () => {
    const result = await runTextCli(['play', 'examples/twinkle.owt'], new OpusWeaveService())
    expect(result.kind).toBe('play')
    if (result.kind !== 'play') return
    expect(result.midi.byteLength).toBeGreaterThan(100)
    expect(result.title).toContain('Twinkle')
  })
})
