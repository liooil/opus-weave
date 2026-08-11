import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runOwtCli } from '../cli/owt-cli.ts'
import { OpusWeaveService } from '../domain/services/opusweave-service.ts'
import { parseOwtOrThrow } from '../domain/owt/parser.ts'

const directory = mkdtempSync(join(tmpdir(), 'opusweave-owt-cli-'))
afterAll(() => rmSync(directory, { recursive: true, force: true }))

describe('OWT CLI workflows', () => {
  test('validates, exports MIDI, and extracts a simple OWT melody', async () => {
    const service = new OpusWeaveService()
    const midiPath = join(directory, 'twinkle.mid')
    const melodyPath = join(directory, 'twinkle-melody.owt')

    expect(service.validateOwt(await Bun.file('examples/twinkle.owt').text()).valid).toBe(true)
    expect(await runOwtCli(['to-midi', 'examples/twinkle.owt', '-o', midiPath], service)).toEqual({ kind: 'done' })
    expect(await Bun.file(midiPath).exists()).toBe(true)

    expect(await runOwtCli(['from-midi', midiPath, '--grid', '1/16', '--voice', 'continuous', '-o', melodyPath], service)).toEqual({ kind: 'done' })
    const melody = parseOwtOrThrow(await Bun.file(melodyPath).text())
    expect(melody.kind).toBe('score')
    expect(melody.tracks).toHaveLength(1)
    expect(melody.tracks[0]?.name).toBe('Melody')
  })

  test('prepares OWT play as a GUI startup MIDI payload', async () => {
    const result = await runOwtCli(['play', 'examples/twinkle.owt'], new OpusWeaveService())
    expect(result.kind).toBe('play')
    if (result.kind !== 'play') return
    expect(result.midi.byteLength).toBeGreaterThan(100)
    expect(result.title).toContain('Twinkle')
  })
})
