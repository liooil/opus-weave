import { describe, it, expect } from 'bun:test'
import { MidiLearn } from '../domain/midi-learn.ts'

class MemoryStorage implements Storage {
  private map = new Map<string, string>()
  getItem(k: string): string | null { return this.map.get(k) ?? null }
  setItem(k: string, v: string): void { this.map.set(k, v) }
  removeItem(k: string): void { this.map.delete(k) }
  clear(): void { this.map.clear() }
  key(i: number): string | null { return [...this.map.keys()][i] ?? null }
  get length(): number { return this.map.size }
}

function fresh() {
  const storage = new MemoryStorage()
  const learn = new MidiLearn(storage)
  const applied: string[] = []
  learn.register({ id: 'volume', label: 'Volume', apply: () => applied.push('volume') })
  learn.register({ id: 'panic', label: 'Panic', apply: () => applied.push('panic') })
  return { storage, learn, applied }
}

describe('MidiLearn', () => {
  it('binds a CC to an armed parameter and persists it', () => {
    const { storage, learn } = fresh()
    learn.learn('volume')
    expect(learn.isArmed).toBe(true)
    const binding = learn.onMessage(new Uint8Array([0xb0, 7, 100]), 'MIDIPLUS')
    expect(binding).toMatchObject({ paramId: 'volume', kind: 'cc', controller: 7, deviceName: 'MIDIPLUS' })
    expect(learn.isArmed).toBe(false)
    expect(storage.getItem('opusweave.midi-learn.bindings')).toContain('"controller":7')
  })

  it('binds notes and pitch bends', () => {
    const { learn } = fresh()
    learn.learn('panic')
    const noteBinding = learn.onMessage(new Uint8Array([0x90, 60, 100]))
    expect(noteBinding).toMatchObject({ kind: 'note', note: 60 })
    learn.learn('volume')
    const pb = learn.onMessage(new Uint8Array([0xe0, 0, 0x40]))
    expect(pb).toMatchObject({ kind: 'pitchBend' })
  })

  it('ignores non-control messages while armed', () => {
    const { learn } = fresh()
    learn.learn('volume')
    expect(learn.onMessage(new Uint8Array([0xf8]))).toBeNull() // clock
    expect(learn.isArmed).toBe(true)
  })

  it('applies learned bindings on incoming messages', () => {
    const { learn, applied } = fresh()
    learn.learn('volume')
    learn.onMessage(new Uint8Array([0xb0, 7, 50]))
    learn.applyIncoming(new Uint8Array([0xb0, 7, 90]))
    expect(applied).toEqual(['volume'])
  })

  it('does not apply when a different controller arrives', () => {
    const { learn, applied } = fresh()
    learn.learn('volume')
    learn.onMessage(new Uint8Array([0xb0, 7, 50]))
    learn.applyIncoming(new Uint8Array([0xb0, 1, 90])) // mod wheel
    expect(applied).toEqual([])
  })

  it('re-learns a parameter by replacing the old binding', () => {
    const { learn } = fresh()
    learn.learn('volume')
    learn.onMessage(new Uint8Array([0xb0, 7, 50]))
    learn.learn('volume')
    learn.onMessage(new Uint8Array([0xb0, 11, 50]))
    const bindings = learn.listBindings()
    expect(bindings).toHaveLength(1)
    expect(bindings[0]!.controller).toBe(11)
  })

  it('survives reload via persisted storage', () => {
    const storage = new MemoryStorage()
    const first = new MidiLearn(storage)
    first.register({ id: 'volume', label: 'Volume', apply: () => {} })
    first.learn('volume')
    first.onMessage(new Uint8Array([0xb0, 7, 50]))

    const second = new MidiLearn(storage)
    const applied: string[] = []
    second.register({ id: 'volume', label: 'Volume', apply: () => applied.push('volume') })
    second.applyIncoming(new Uint8Array([0xb0, 7, 30]))
    expect(applied).toEqual(['volume'])
  })

  it('removes bindings', () => {
    const { learn } = fresh()
    learn.learn('volume')
    learn.onMessage(new Uint8Array([0xb0, 7, 50]))
    learn.removeBinding('volume')
    expect(learn.listBindings()).toHaveLength(0)
  })
})
