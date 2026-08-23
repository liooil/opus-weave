import { describe, expect, test } from 'bun:test'
import { WebMidiManager } from '../midi/web-midi-manager.ts'

const ENABLED_KEY = 'opusweave.midi.enabled'
const INPUT_KEY = 'opusweave.midi.input-port'

class MemoryStorage {
  readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

function midiInput(id = 'tiny-1'): MIDIInput {
  return {
    id,
    name: 'MIDIPLUS TINY+',
    manufacturer: 'MIDIPLUS',
    state: 'connected',
    connection: 'open',
    type: 'input',
  } as MIDIInput
}

function midiAccess(inputs: MIDIInput[] = []): {
  inputs: Map<string, MIDIInput>
  outputs: Map<string, MIDIOutput>
  onstatechange: ((event: Event) => void) | null
} {
  return {
    inputs: new Map(inputs.map((input) => [input.id, input])),
    outputs: new Map(),
    onstatechange: null,
  }
}

describe('WebMidiManager permission restoration', () => {
  test('automatically reacquires granted access and restores the selected input', async () => {
    const storage = new MemoryStorage()
    storage.setItem(INPUT_KEY, JSON.stringify({ id: 'tiny-1', name: 'MIDIPLUS TINY+', manufacturer: 'MIDIPLUS' }))
    let requests = 0
    let requestedOptions: { sysex?: boolean } | undefined
    const manager = new WebMidiManager(
      storage,
      async (options) => {
        requests++
        requestedOptions = options
        return midiAccess([midiInput()])
      },
      async () => 'granted',
    )

    expect(await manager.restorePermission()).toBe(true)
    expect(requests).toBe(1)
    expect(requestedOptions).toEqual({ sysex: false })
    expect(manager.getState().permissionGranted).toBe(true)
    expect(manager.getState().selectedInputId).toBe('tiny-1')
    expect(manager.getSelectedInput()?.name).toBe('MIDIPLUS TINY+')
    expect(storage.getItem(ENABLED_KEY)).toBe('true')
  })

  test('never turns a prompt or denial into an automatic permission request', async () => {
    for (const permission of ['prompt', 'denied'] as const) {
      const storage = new MemoryStorage()
      storage.setItem(ENABLED_KEY, 'true')
      let requests = 0
      const manager = new WebMidiManager(
        storage,
        async () => {
          requests++
          return midiAccess()
        },
        async () => permission,
      )

      expect(await manager.restorePermission()).toBe(false)
      expect(requests).toBe(0)
      expect(manager.getState().permissionGranted).toBe(false)
    }
  })

  test('does not request access again when a manual grant wins the startup race', async () => {
    const storage = new MemoryStorage()
    let finishQuery!: (permission: PermissionState) => void
    let requests = 0
    const manager = new WebMidiManager(
      storage,
      async () => {
        requests++
        return midiAccess()
      },
      () => new Promise((resolve) => { finishQuery = resolve }),
    )

    const restoring = manager.restorePermission()
    await manager.requestPermission()
    finishQuery('granted')

    expect(await restoring).toBe(true)
    expect(requests).toBe(1)
  })

  test('uses a remembered opt-in only when permission querying is unavailable', async () => {
    const storage = new MemoryStorage()
    storage.setItem(ENABLED_KEY, 'true')
    let requests = 0
    const manager = new WebMidiManager(
      storage,
      async () => {
        requests++
        return midiAccess()
      },
      async () => null,
    )

    expect(await manager.restorePermission()).toBe(true)
    expect(requests).toBe(1)
  })

  test('does nothing without a grant or a remembered opt-in', async () => {
    const storage = new MemoryStorage()
    let requests = 0
    const manager = new WebMidiManager(
      storage,
      async () => {
        requests++
        return midiAccess()
      },
      async () => null,
    )

    expect(await manager.restorePermission()).toBe(false)
    expect(requests).toBe(0)
  })

  test('remembers a successful manual grant for browsers without permission queries', async () => {
    const storage = new MemoryStorage()
    const manager = new WebMidiManager(storage, async () => midiAccess(), async () => null)

    await manager.requestPermission()
    expect(storage.getItem(ENABLED_KEY)).toBe('true')
  })

  test('forgets the fallback opt-in when silent restoration is rejected', async () => {
    const storage = new MemoryStorage()
    storage.setItem(ENABLED_KEY, 'true')
    const manager = new WebMidiManager(
      storage,
      async () => { throw new DOMException('denied', 'NotAllowedError') },
      async () => null,
    )

    expect(await manager.restorePermission()).toBe(false)
    expect(storage.getItem(ENABLED_KEY)).toBe('false')
    expect(manager.getState().permissionGranted).toBe(false)
    expect(manager.getState().error).toBeNull()
  })
})
