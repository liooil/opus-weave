import { afterAll, afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runOwtCli } from '../cli/owt-cli.ts'
import { OpusWeaveService } from '../domain/services/opusweave-service.ts'
import { parseOwtOrThrow } from '../domain/owt/parser.ts'

const directory = mkdtempSync(join(tmpdir(), 'opusweave-owt-cli-'))
afterAll(() => rmSync(directory, { recursive: true, force: true }))
afterEach(() => { process.exitCode = 0 })

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

  test('formats canonical OWT, removes comments, and supports --check', async () => {
    const service = new OpusWeaveService()
    const input = join(directory, 'format-input.owt')
    const output = join(directory, 'format-output.owt')
    writeFileSync(input, 'owt 0.1 score\n# formatter removes comments\ntitle "格式化 ♯"\ntrack "旋律" velocity=88 channel=1 program=0\n| C#4:1 D4:1 E4:1 R:1 |\nend\n')
    await runOwtCli(['fmt', input, '-o', output], service)
    const canonical = await Bun.file(output).text()
    expect(canonical).not.toContain('# formatter')
    expect(service.formatOwt(canonical)).toBe(canonical)
    await runOwtCli(['fmt', output, '--check'], service)
    expect(process.exitCode).toBe(0)
    await runOwtCli(['fmt', input, '--check'], service)
    expect(process.exitCode).toBe(1)
  })

  test('prepares OWT play as a canonical GUI startup score', async () => {
    const result = await runOwtCli(['play', 'examples/twinkle.owt'], new OpusWeaveService())
    expect(result.kind).toBe('play')
    if (result.kind !== 'play') return
    expect(parseOwtOrThrow(result.owt).title).toContain('Twinkle')
    expect(result.owt).toEndWith('end\n')
  })
})
