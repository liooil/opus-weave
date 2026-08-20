import { describe, expect, test } from 'bun:test'
import { isPressureSensitive, pressureToVelocity } from '../web/pointer-pressure.ts'

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
