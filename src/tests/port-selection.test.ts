import { describe, it, expect } from 'bun:test'
import { selectPort, isVirtualThroughPort, type PortDescriptor, type StoredPort } from '../midi/midi-port-selection.ts'

const physical: PortDescriptor = { id: 'in-1', name: 'MIDIPLUS TINY+', manufacturer: 'MIDIPLUS', state: 'connected', connection: 'open', type: 'input' }
const through: PortDescriptor = { id: 'in-2', name: 'Midi Through', manufacturer: 'Microsoft', state: 'connected', connection: 'open', type: 'input' }
const second: PortDescriptor = { id: 'in-3', name: 'AKAI MPK', manufacturer: 'AKAI', state: 'connected', connection: 'open', type: 'input' }

const storedTiny: StoredPort = { id: 'in-1', name: 'MIDIPLUS TINY+', manufacturer: 'MIDIPLUS' }

describe('isVirtualThroughPort', () => {
  it('flags virtual routing ports but not physical keyboards', () => {
    expect(isVirtualThroughPort(through)).toBe(true)
    expect(isVirtualThroughPort({ ...through, name: 'Microsoft GS Wavetable Synth' })).toBe(true)
    expect(isVirtualThroughPort(physical)).toBe(false)
  })
})

describe('selectPort', () => {
  it('restores by exact id', () => {
    const r = selectPort(storedTiny, [through, physical])
    expect(r.port?.id).toBe('in-1')
    expect(r.reason).toContain('restored by id')
  })

  it('falls back by name/manufacturer when the id changed', () => {
    const replugged: PortDescriptor = { ...physical, id: 'in-99' }
    const r = selectPort(storedTiny, [through, replugged])
    expect(r.port?.id).toBe('in-99')
    expect(r.reason).toContain('matched by name')
  })

  it('falls back by name only when manufacturer differs', () => {
    const renamed: PortDescriptor = { ...physical, id: 'in-99', manufacturer: 'Generic' }
    const r = selectPort(storedTiny, [renamed])
    expect(r.port?.id).toBe('in-99')
    expect(r.reason).toContain('name only')
  })

  it('reports when the stored device is gone', () => {
    const r = selectPort(storedTiny, [through])
    expect(r.port).toBeNull()
    expect(r.reason).toContain('not connected')
  })

  it('prefers physical ports over Midi Through when nothing is stored', () => {
    const r = selectPort(null, [through, physical, second])
    expect(r.port?.id).toBe('in-1')
  })

  it('falls back to a through port when it is the only option', () => {
    const r = selectPort(null, [through])
    expect(r.port?.id).toBe('in-2')
  })

  it('handles an empty port list', () => {
    const r = selectPort(null, [])
    expect(r.port).toBeNull()
  })
})
