import { describe, expect, test } from 'bun:test'
import { isNoteInRange } from '../web/components/virtual-keyboard.ts'
import { isPressureSensitive, pressureToVelocity } from '../web/pointer-pressure.ts'

describe('virtual keyboard MIDI range', () => {
  test('includes both ends of a connected keyboard note range', () => {
    const range = { min: 36, max: 67 }
    expect(isNoteInRange(35, range)).toBe(false)
    expect(isNoteInRange(36, range)).toBe(true)
    expect(isNoteInRange(60, range)).toBe(true)
    expect(isNoteInRange(67, range)).toBe(true)
    expect(isNoteInRange(68, range)).toBe(false)
  })

  test('does not highlight notes for a missing or invalid range', () => {
    expect(isNoteInRange(60, null)).toBe(false)
    expect(isNoteInRange(60, { min: 68, max: 36 })).toBe(false)
    expect(isNoteInRange(60, { min: -1, max: 67 })).toBe(false)
    expect(isNoteInRange(60, { min: 36, max: 128 })).toBe(false)
  })
})

describe('virtual keyboard pressure velocity', () => {
  test('maps normalized pressure to MIDI velocity in 1..127', () => {
    expect(pressureToVelocity(0)).toBe(1)
    expect(pressureToVelocity(0.5)).toBe(64)
    expect(pressureToVelocity(1)).toBe(127)
    expect(pressureToVelocity(0.01)).toBe(1)
    expect(pressureToVelocity(0.99)).toBe(126)
  })

  test('treats pen pressure as real pressure', () => {
    expect(isPressureSensitive({ pressure: 0.5, pointerType: 'pen' })).toBe(true)
    expect(isPressureSensitive({ pressure: 0.8, pointerType: 'pen' })).toBe(true)
  })

  test('ignores mouse and unsupported fixed touch pressure', () => {
    expect(isPressureSensitive({ pressure: 0.5, pointerType: 'mouse' })).toBe(false)
    expect(isPressureSensitive({ pressure: 0.5, pointerType: 'touch' })).toBe(false)
    expect(isPressureSensitive({ pressure: 1, pointerType: 'touch' })).toBe(false)
    expect(isPressureSensitive({ pressure: 0, pointerType: 'pen' })).toBe(false)
  })

  test('accepts variable touch pressure from pressure-sensitive screens', () => {
    expect(isPressureSensitive({ pressure: 0.2, pointerType: 'touch' })).toBe(true)
    expect(isPressureSensitive({ pressure: 0.75, pointerType: 'touch' })).toBe(true)
  })
})
