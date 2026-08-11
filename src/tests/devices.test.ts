import { describe, it, expect } from 'bun:test'
import {
  findProfileForPort,
  profileMatchesPort,
  overrideControl,
  controlToMidiBytes,
  type DeviceProfile,
} from '../domain/devices/device-profile.ts'
import { midiplusTinyPlusProfile } from '../domain/devices/midiplus-tiny-plus.ts'
import { MappingEngine, noteName } from '../domain/devices/mapping-engine.ts'

describe('MIDIPLUS TINY+ profile', () => {
  const profile = midiplusTinyPlusProfile()

  it('matches by loose name regex (not a fixed id)', () => {
    expect(findProfileForPort([profile], 'MIDIPLUS TINY+ MIDI Keyboard', 'MIDIPLUS Co.,Ltd.')?.id).toBe('midiplus-tiny-plus')
    expect(findProfileForPort([profile], 'TINY+', 'MIDIPLUS')?.id).toBe('midiplus-tiny-plus')
    expect(findProfileForPort([profile], 'AKAI MPK Mini', 'AKAI')).toBeNull()
  })

  it('has the documented default control mapping', () => {
    expect(profile.controls['k1']!).toMatchObject({ kind: 'cc', controller: 93 })
    expect(profile.controls['k2']!).toMatchObject({ kind: 'cc', controller: 91 })
    expect(profile.controls['k3']!).toMatchObject({ kind: 'cc', controller: 71 })
    expect(profile.controls['k4']!).toMatchObject({ kind: 'cc', controller: 74 })
    expect(profile.controls['mod']!).toMatchObject({ kind: 'cc', controller: 1 })
    expect(profile.controls['sustain']!).toMatchObject({ kind: 'cc', controller: 64 })
    expect(profile.controls['pitchBend']!.kind).toBe('pitchBend')
    expect(profile.noteRange).toEqual({ min: 36, max: 67 }) // 32 keys
  })

  it('allows overriding a control default without mutating the original', () => {
    const remapped = overrideControl(profile, 'k1', { kind: 'cc', controller: 7 })
    expect(remapped.controls['k1']).toEqual({ kind: 'cc', controller: 7 })
    expect(profile.controls['k1']).toMatchObject({ kind: 'cc', controller: 93 })
  })

  it('rejects overrides for unknown controls', () => {
    expect(() => overrideControl(profile, 'nope', { kind: 'cc', controller: 1 })).toThrow()
  })
})

describe('profileMatchesPort', () => {
  it('matches on manufacturer only when name is empty', () => {
    const profile: DeviceProfile = { id: 'x', name: 'X', match: [{ field: 'manufacturer', pattern: 'roland', flags: 'i' }], controls: {} }
    expect(profileMatchesPort(profile, '', 'Roland Corp.')).toBe(true)
    expect(profileMatchesPort(profile, 'Some Name', 'Yamaha')).toBe(false)
  })
})

describe('controlToMidiBytes', () => {
  it('encodes cc, note and pitch bend bytes on the right channel', () => {
    expect([...controlToMidiBytes({ kind: 'cc', controller: 93 }, 2, 100)!]).toEqual([0xb2, 93, 100])
    expect([...controlToMidiBytes({ kind: 'note', note: 60 }, 5, 127)!]).toEqual([0x95, 60, 127])
    expect([...controlToMidiBytes({ kind: 'pitchBend' }, 0, 9000)!]).toEqual([0xe0, 9000 & 0x7f, (9000 >> 7) & 0x7f])
  })

  it('returns null for transport mappings (no single byte form)', () => {
    expect(controlToMidiBytes({ kind: 'transport', transportType: 'mmc' }, 0, 1)).toBeNull()
  })
})

describe('MappingEngine (computer keyboard)', () => {
  it('maps keys to notes and back', () => {
    const m = new MappingEngine({ baseNote: 48 })
    expect(m.keyDownMessage('z')).toEqual(new Uint8Array([0x90, 48, 100]))
    expect(m.keyUpMessage('z')).toEqual(new Uint8Array([0x80, 48, 0x40]))
    expect(m.keyToNote('q')).toBe(60)
    expect(m.keyToNote('x')).toBe(50)
  })

  it('applies octave shifts', () => {
    const m = new MappingEngine({ baseNote: 48 })
    m.shiftOctave(1)
    expect(m.keyToNote('z')).toBe(60)
    expect(m.keyDownMessage('z')![1]).toBe(60)
    m.shiftOctave(-1)
    expect(m.keyToNote('z')).toBe(48)
  })

  it('lists the visible computer-key map and updates it with octave shifts', () => {
    const m = new MappingEngine({ baseNote: 48 })
    const initial = m.listComputerKeyAssignments()
    expect(initial).toHaveLength(24)
    expect(initial[0]).toEqual({ key: 'z', semitoneOffset: 0, note: 48 })
    expect(initial[23]).toEqual({ key: 'u', semitoneOffset: 23, note: 71 })

    m.shiftOctave(1)
    expect(m.listComputerKeyAssignments()[0]!.note).toBe(60)
  })

  it('keeps octave shortcuts inside the MIDI note range', () => {
    const m = new MappingEngine({ baseNote: 48 })
    m.shiftOctave(100)
    expect(m.listComputerKeyAssignments().at(-1)!.note).toBeLessThanOrEqual(127)
    m.shiftOctave(-100)
    expect(m.listComputerKeyAssignments()[0]!.note).toBeGreaterThanOrEqual(0)
  })

  it('uses fixed velocity', () => {
    const m = new MappingEngine({ baseNote: 48, velocity: 33 })
    expect(m.keyDownMessage('z')![2]).toBe(33)
    m.setVelocity(127)
    expect(m.keyDownMessage('z')![2]).toBe(127)
  })

  it('returns null for unmapped keys', () => {
    const m = new MappingEngine()
    expect(m.keyToNote('`')).toBeNull()
    expect(m.keyDownMessage(' ')).toBeNull()
  })

  it('sends on the configured channel', () => {
    const m = new MappingEngine({ baseNote: 48, channel: 9 })
    expect(m.keyDownMessage('z')![0]).toBe(0x99)
  })

  it('switches to English and Pinyin melodic layouts', () => {
    const m = new MappingEngine({ layout: 'english' })
    expect(m.keyDownMessages('h')).toHaveLength(1)
    expect(m.listComputerKeyAssignments()).toHaveLength(30)
    expect(m.keyDownMessages('1')).toHaveLength(0)
    m.setComputerLayout('pinyin')
    expect(m.listComputerKeyAssignments()).toHaveLength(30)
    expect(m.keyDownMessages('2')).toHaveLength(0)
    expect(m.keyDownMessages('n')).toHaveLength(1)
  })

  it('matches the complete note-playing portion of the FreePiano 1.8 classic map', () => {
    const m = new MappingEngine({ layout: 'freepiano' })
    expect(m.listComputerKeyAssignments()).toHaveLength(80)
    expect(m.keyToNote('shift')).toBe(35)
    expect(m.keyToNote('z')).toBe(36)
    expect(m.keyToNote('a')).toBe(48)
    expect(m.keyToNote('q')).toBe(60)
    expect(m.keyToNote('1')).toBe(72)
    expect(m.keyToNote('=')).toBe(91)
    expect(m.keyToNote('back')).toBe(91)
    expect(m.keyToNote('left')).toBe(48)
    expect(m.keyToNote('num0')).toBe(55)
    expect(m.keyToNote('num1')).toBe(60)
    expect(m.keyToNote('num9')).toBe(74)
    expect(m.keyToNote('num+')).toBe(76)
    expect(m.keyToNote('numenter')).toBe(59)
    expect(m.keyToNote('pgup')).toBe(93)
  })

  it('accepts a custom layout contract for future editors', () => {
    const m = new MappingEngine()
    m.setComputerLayout({ id: 'custom', baseNote: 60, keys: { a: 0, b: 7 } })
    expect(m.currentComputerLayoutId).toBe('custom')
    expect(m.keyToNote('a')).toBe(60)
    expect(m.keyToNote('b')).toBe(67)
  })

  it('encodes device control messages through the same engine', () => {
    const m = new MappingEngine({ channel: 1 })
    expect([...m.controlMessage({ kind: 'cc', controller: 1 }, 64)!]).toEqual([0xb1, 1, 64])
    const pb = m.controlMessage({ kind: 'pitchBend' }, 16383)!
    expect((pb[2]! << 7) | pb[1]!).toBe(16383)
  })
})

describe('noteName', () => {
  it('names notes with octaves (middle C = C4)', () => {
    expect(noteName(60)).toBe('C4')
    expect(noteName(61)).toBe('C#4')
    expect(noteName(0)).toBe('C-1')
    expect(noteName(127)).toBe('G9')
  })
})
