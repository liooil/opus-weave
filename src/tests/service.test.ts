import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { OpusWeaveService } from '../domain/services/opusweave-service.ts'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BasicMIDI } from 'spessasynth_core'

const service = new OpusWeaveService()
let dir: string

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'opus-weave-service-'))
})
afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

const validSpec = {
  title: 'Service',
  ppq: 480,
  tempos: [{ beat: 0, bpm: 120 }],
  tracks: [
    { name: 'A', channel: 0, program: 0, notes: [{ startBeat: 0, durationBeats: 1, pitch: 60, velocity: 90 }], controlChanges: [], pitchBends: [] },
  ],
}

describe('OpusWeaveService', () => {
  it('createMidi validates and writes a file', async () => {
    const out = join(dir, 'out.mid')
    const result = await service.createMidi(validSpec, out)
    expect(result.bytes).toBeGreaterThan(14)
    expect(result.trackCount).toBe(1)
    expect(result.noteCount).toBe(1)
    expect(result.path).toBe(out)
    expect(readFileSync(out).length).toBe(result.bytes)
    const midi = BasicMIDI.fromArrayBuffer(readFileSync(out).buffer.slice(0))
    expect(midi.format).toBe(1)
  })

  it('createMidi rejects invalid specs with precise errors', async () => {
    await expect(service.createMidi({ tracks: [{ name: 'X', notes: [{ startBeat: -1, durationBeats: 1, pitch: 60, velocity: 90 }] }] }, join(dir, 'bad.mid'))).rejects.toMatchObject({ code: 'invalid-spec' })
  })

  it('inspectMidiFile reports on a file created by createMidi', async () => {
    const out = join(dir, 'inspect.mid')
    await service.createMidi(validSpec, out)
    const info = await service.inspectMidiFile(out)
    expect(info.trackCount).toBe(2)
    expect(info.tracks[1]).toMatchObject({ name: 'A', program: 0, noteCount: 1, minNote: 60, maxNote: 60 })
    expect(info.tempos[0]).toMatchObject({ bpm: 120 })
  })

  it('validateComposition returns stats without throwing', () => {
    const r = service.validateComposition(validSpec)
    expect(r.errors).toEqual([])
    expect(r.stats.pitchRange).toEqual({ min: 60, max: 60 })
    expect(r.stats.durationBeats).toBe(1)
  })

  it('createExampleComposition is valid and multi-track', () => {
    const spec = service.createExampleComposition()
    const r = service.validateComposition(spec)
    expect(r.errors).toEqual([])
    expect(r.stats.trackCount).toBe(2)
    expect(r.stats.noteCount).toBeGreaterThan(5)
    expect(r.stats.pitchRange!.min).toBeLessThanOrEqual(38) // bass
    expect(spec.tempos!.length).toBeGreaterThanOrEqual(2) // tempo change included
  })

  it('example composition round-trips through build → inspect', async () => {
    const spec = service.createExampleComposition()
    const out = join(dir, 'example.mid')
    await service.createMidi(spec, out)
    const info = await service.inspectMidiFile(out)
    expect(info.format).toBe(1)
    expect(info.trackCount).toBe(3) // conductor + 2
    expect(info.tempos.length).toBeGreaterThanOrEqual(2)
    expect(info.warnings).toEqual([])
  })

  it('doctor reports platform, runtime and feature list', async () => {
    const report = await service.doctor({})
    expect(report.platform).toContain(process.platform)
    expect(report.runtime).toContain('bun')
    expect(report.features.length).toBeGreaterThan(0)
    expect(report.soundfont.checked).toBe(false)
  })

  it('doctor checks an explicitly given soundfont path', async () => {
    const sf = join(dir, 'bank.sf2')
    // exists case
    const { writeFileSync } = await import('node:fs')
    writeFileSync(sf, 'fake')
    const exists = await service.doctor({ soundfont: sf })
    expect(exists.soundfont).toMatchObject({ checked: true, exists: true })
    const missing = await service.doctor({ soundfont: join(dir, 'nope.sf2') })
    expect(missing.soundfont).toMatchObject({ checked: true, exists: false })
  })

  it('surfaces file-not-found for missing inspect targets', async () => {
    await expect(service.inspectMidiFile(join(dir, 'missing.mid'))).rejects.toMatchObject({ code: 'file-not-found' })
  })
})
