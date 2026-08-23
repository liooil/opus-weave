/**
 * web-midi-manager — browser-side WebMIDI port management.
 *
 * Responsibilities: permission request, port enumeration with full details,
 * hot-plug listening, input/output selection with persistence and
 * name/manufacturer fallback after reconnects, and virtual-port flagging.
 * The manager is UI-free; it notifies subscribers of changes.
 */
import { OpusWeaveError } from '../shared/errors.ts'
import { isVirtualThroughPort, selectPort, type PortDescriptor, type StoredPort } from './midi-port-selection.ts'

const INPUT_KEY = 'opusweave.midi.input-port'
const OUTPUT_KEY = 'opusweave.midi.output-port'
const ENABLED_KEY = 'opusweave.midi.enabled'

interface MidiAccessLike {
  inputs: Map<string, MIDIInput>
  outputs: Map<string, MIDIOutput>
  onstatechange: ((ev: Event) => void) | null
}

interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

type MidiPermissionQuery = () => Promise<PermissionState | null>

export interface MidiPortInfo extends PortDescriptor {
  kind: 'input' | 'output'
}

export type MidiManagerListener = (state: MidiManagerState) => void

export interface MidiManagerState {
  supported: boolean
  permissionGranted: boolean
  inputs: MidiPortInfo[]
  outputs: MidiPortInfo[]
  selectedInputId: string | null
  selectedOutputId: string | null
  /** Input connection note from port selection (restore/fallback reasons). */
  inputNote: string
  error: string | null
}

export class WebMidiManager {
  private access: MidiAccessLike | null = null
  private state: MidiManagerState
  private readonly listeners = new Set<MidiManagerListener>()
  /** Injected requestMIDIAccess for tests. */
  private readonly requestAccess: (opts?: { sysex?: boolean }) => Promise<MidiAccessLike>
  /** Returns null when this browser cannot query the MIDI permission. */
  private readonly queryPermission: MidiPermissionQuery

  constructor(
    private readonly storage: StorageLike,
    requestAccess?: (opts?: { sysex?: boolean }) => Promise<MidiAccessLike>,
    queryPermission?: MidiPermissionQuery,
  ) {
    this.requestAccess =
      requestAccess ??
      (async (opts) => {
        const access = await navigator.requestMIDIAccess(opts)
        return access as unknown as MidiAccessLike
      })
    this.queryPermission = queryPermission ?? (async () => {
      if (typeof navigator === 'undefined' || !navigator.permissions?.query) return null
      try {
        const status = await navigator.permissions.query({ name: 'midi', sysex: false } as PermissionDescriptor)
        return status.state
      } catch {
        return null
      }
    })
    this.state = {
      supported: Boolean(requestAccess) || (typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator),
      permissionGranted: false,
      inputs: [],
      outputs: [],
      selectedInputId: null,
      selectedOutputId: null,
      inputNote: '',
      error: null,
    }
  }

  getState(): MidiManagerState {
    return this.state
  }

  subscribe(fn: MidiManagerListener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  /** Request WebMIDI access. `sysex` is only used when the user explicitly enables it. */
  async requestPermission(sysex = false): Promise<void> {
    if (!this.state.supported) {
      this.setState({ error: 'WebMIDI is not supported in this browser' })
      throw new OpusWeaveError('webmidi-unsupported', 'WebMIDI is not supported in this browser')
    }
    try {
      this.access = await this.requestAccess({ sysex })
      this.access.onstatechange = () => this.refreshPorts()
      this.rememberEnabled(true)
      this.setState({ permissionGranted: true, error: null })
      this.refreshPorts()
    } catch (err) {
      this.setState({ error: `WebMIDI permission denied: ${err instanceof Error ? err.message : String(err)}` })
      throw new OpusWeaveError('webmidi-denied', `WebMIDI permission was denied (${err instanceof Error ? err.message : String(err)})`)
    }
  }

  /**
   * Restore Web MIDI after reload without opening a new permission prompt.
   * A real `granted` result is authoritative. The stored opt-in is only used
   * when the browser does not implement MIDI permission queries.
   */
  async restorePermission(): Promise<boolean> {
    if (!this.state.supported || this.state.permissionGranted) return this.state.permissionGranted

    let permission: PermissionState | null = null
    try {
      permission = await this.queryPermission()
    } catch {
      permission = null
    }
    if (this.state.permissionGranted) return true
    if (permission === 'prompt' || permission === 'denied') return false
    if (permission === null && !this.wasEnabled()) return false

    try {
      await this.requestPermission(false)
      return true
    } catch {
      // A browser without permission-query support may have forgotten or
      // revoked its grant. Fall back to the explicit button on the next load.
      if (permission === null) {
        this.rememberEnabled(false)
        this.setState({ error: null })
      }
      return false
    }
  }

  /** Current input port, if any. */
  getSelectedInput(): MIDIInput | null {
    if (!this.access || !this.state.selectedInputId) return null
    return this.access.inputs.get(this.state.selectedInputId) ?? null
  }

  getSelectedOutput(): MIDIOutput | null {
    if (!this.access || !this.state.selectedOutputId) return null
    return this.access.outputs.get(this.state.selectedOutputId) ?? null
  }

  selectInput(id: string): void {
    const port = this.access?.inputs.get(id)
    const stored: StoredPort = {
      id,
      name: port?.name ?? '',
      manufacturer: port?.manufacturer ?? '',
    }
    this.storage.setItem(INPUT_KEY, JSON.stringify(stored))
    this.setState({ selectedInputId: id, inputNote: '' })
  }

  selectOutput(id: string): void {
    this.storage.setItem(OUTPUT_KEY, id)
    this.setState({ selectedOutputId: id })
  }

  clearSelection(): void {
    this.storage.setItem(INPUT_KEY, '')
    this.setState({ selectedInputId: null, inputNote: '' })
  }

  private refreshPorts(): void {
    if (!this.access) return
    const inputs: MidiPortInfo[] = [...this.access.inputs.values()].map((p) => ({
      id: p.id,
      name: p.name ?? '',
      manufacturer: p.manufacturer ?? '',
      state: p.state,
      connection: p.connection,
      type: p.type,
      kind: 'input',
    }))
    const outputs: MidiPortInfo[] = [...this.access.outputs.values()].map((p) => ({
      id: p.id,
      name: p.name ?? '',
      manufacturer: p.manufacturer ?? '',
      state: p.state,
      connection: p.connection,
      type: p.type,
      kind: 'output',
    }))

    let storedInput: StoredPort | null = null
    try {
      const raw = this.storage.getItem(INPUT_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as StoredPort
        if (parsed && typeof parsed.id === 'string') storedInput = parsed
      }
    } catch {
      storedInput = null
    }
    const selection = selectPort(storedInput, inputs)
    const storedOutput = this.storage.getItem(OUTPUT_KEY)

    this.setState({
      inputs,
      outputs,
      selectedInputId: selection.port?.id ?? null,
      inputNote: selection.reason,
      selectedOutputId: storedOutput && this.access.outputs.has(storedOutput) ? storedOutput : null,
    })
  }

  private setState(patch: Partial<MidiManagerState>): void {
    this.state = { ...this.state, ...patch }
    for (const fn of [...this.listeners]) fn(this.state)
  }

  private wasEnabled(): boolean {
    try {
      return this.storage.getItem(ENABLED_KEY) === 'true'
    } catch {
      return false
    }
  }

  private rememberEnabled(enabled: boolean): void {
    try {
      this.storage.setItem(ENABLED_KEY, String(enabled))
    } catch {
      // Storage can be unavailable in private/locked-down contexts; MIDI
      // remains usable for the current page session.
    }
  }
}

export { isVirtualThroughPort }
