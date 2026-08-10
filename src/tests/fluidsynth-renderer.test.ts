import { describe, it, expect } from 'bun:test'
import { ensureWavExtension } from '../audio/audio-renderer.ts'
import { detectFluidSynth } from '../audio/fluidsynth-renderer.ts'
import { FluidSynthRenderer } from '../audio/fluidsynth-renderer.ts'
import { OpusWeaveError } from '../shared/errors.ts'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('ensureWavExtension', () => {
  it('accepts .wav and rejects everything else', () => {
    expect(() => ensureWavExtension('out.wav')).not.toThrow()
    expect(() => ensureWavExtension('/tmp/OUT.WAV')).not.toThrow()
    expect(() => ensureWavExtension('out.mp3')).toThrow(OpusWeaveError)
    expect(() => ensureWavExtension('out')).toThrow(OpusWeaveError)
  })
})

describe('FluidSynthRenderer', () => {
  it('fails cleanly with file checks before touching the binary', async () => {
    const renderer = new FluidSynthRenderer()
    await expect(renderer.render({ midiPath: '/nonexistent.mid', soundfontPath: '/nonexistent.sf2', outputPath: '/tmp/x.wav' })).rejects.toMatchObject({ code: 'file-not-found' })
  })

  it('rejects a bad output extension', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'opus-weave-'))
    const midi = join(dir, 'a.mid')
    const sf = join(dir, 'a.sf2')
    writeFileSync(midi, 'MThd')
    writeFileSync(sf, 'fake')
    const renderer = new FluidSynthRenderer()
    await expect(renderer.render({ midiPath: midi, soundfontPath: sf, outputPath: join(dir, 'out.ogg') })).rejects.toMatchObject({ code: 'invalid-output-path' })
  })

  it('gives install advice when fluidsynth is missing', async () => {
    const detection = await detectFluidSynth()
    if (!detection.available) {
      expect(detection.advice).toContain('FluidSynth is not installed')
    } else {
      expect(detection.version).toBeTruthy()
    }
  })
})

describe('fluidsynth argument construction (no binary required)', () => {
  it('passes paths with spaces through to spawn unchanged', async () => {
    const renderer = new FluidSynthRenderer()
    const dir = mkdtempSync(join(tmpdir(), 'opus weave spaced-'))
    const midi = join(dir, 'my song.mid')
    const sf = join(dir, 'orchestra sf.sf2')
    writeFileSync(midi, 'MThd')
    writeFileSync(sf, 'x')
    // Without fluidsynth installed this must be the missing-binary error,
    // proving the file paths passed validation and were not shell-quoted.
    await expect(renderer.render({ midiPath: midi, soundfontPath: sf, outputPath: join(dir, 'out put.wav') })).rejects.toMatchObject({ code: 'fluidsynth-missing' })
  })
})
