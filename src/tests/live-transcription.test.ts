import { describe, expect, test } from 'bun:test'
import { LiveOwtTranscriber } from '../domain/owt/live-transcription.ts'
import { compareRational, rationalToNumber } from '../domain/owt/rational.ts'

const T0 = 1_000_000

describe('LiveOwtTranscriber', () => {
  test('commits a note immediately when the note ends', () => {
    const t = new LiveOwtTranscriber()
    t.start(T0)
    t.push(new Uint8Array([0x90, 60, 100]), T0)
    expect(t.events).toHaveLength(0)
    t.push(new Uint8Array([0x80, 60, 64]), T0 + 500)
    const events = t.snapshot()
    expect(events).toHaveLength(1)
    expect(events[0]!.pitches).toEqual([60])
    expect(events[0]!.velocity).toBe(100)
    // 500 ms at 120 BPM = 1 beat = 480 ticks; 1/16 grid = 120 ticks.
    expect(events[0]!.at).toEqual({ numerator: 0, denominator: 1 })
    expect(events[0]!.duration).toEqual({ numerator: 1, denominator: 1 })
  })

  test('quantizes short notes to at least one grid cell', () => {
    const t = new LiveOwtTranscriber()
    t.start(T0)
    t.push(new Uint8Array([0x90, 64, 90]), T0)
    t.push(new Uint8Array([0x80, 64, 64]), T0 + 30)
    const event = t.snapshot()[0]!
    expect(event.at).toEqual({ numerator: 0, denominator: 1 })
    expect(rationalToNumber(event.duration)).toBe(0.25) // one 16th
  })

  test('keeps overlapping notes sorted by start', () => {
    const t = new LiveOwtTranscriber()
    t.start(T0)
    // A starts at 0, B starts at 0.5 beat, B ends before A.
    t.push(new Uint8Array([0x90, 60, 100]), T0)
    t.push(new Uint8Array([0x90, 64, 90]), T0 + 250)
    t.push(new Uint8Array([0x80, 64, 64]), T0 + 400)
    t.push(new Uint8Array([0x80, 60, 64]), T0 + 500)
    const events = t.snapshot()
    expect(events).toHaveLength(2)
    expect(events[0]!.pitches).toEqual([60])
    expect(events[1]!.pitches).toEqual([64])
    expect(compareRational(events[0]!.at, events[1]!.at)).toBeLessThan(0)
  })

  test('handles repeated note-on by closing the previous note', () => {
    const t = new LiveOwtTranscriber()
    t.start(T0)
    t.push(new Uint8Array([0x90, 60, 100]), T0)
    t.push(new Uint8Array([0x90, 60, 110]), T0 + 250)
    t.push(new Uint8Array([0x80, 60, 64]), T0 + 500)
    const events = t.snapshot()
    expect(events).toHaveLength(2)
    expect(events[0]!.velocity).toBe(100)
    expect(events[1]!.velocity).toBe(110)
  })

  test('closes held notes on stop', () => {
    const t = new LiveOwtTranscriber()
    t.start(T0)
    t.push(new Uint8Array([0x90, 60, 100]), T0)
    t.stop(T0 + 500)
    const events = t.snapshot()
    expect(events).toHaveLength(1)
    expect(events[0]!.duration).toEqual({ numerator: 1, denominator: 1 })
  })

  test('ignores non-note messages and notes before start', () => {
    const t = new LiveOwtTranscriber()
    t.push(new Uint8Array([0x90, 60, 100]), T0)
    t.start(T0)
    t.push(new Uint8Array([0xb0, 64, 127]), T0)
    expect(t.events).toHaveLength(0)
  })
})
