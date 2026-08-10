/**
 * midi-learn — minimal MIDI Learn: arm a target parameter, then move a knob,
 * pad or button on the physical device to bind it. Bindings persist in local
 * storage and are matched by device name so reconnects keep working.
 */
import type { ControlKind } from './devices/device-profile.ts'

export interface LearnedBinding {
  /** Target parameter id (e.g. 'master-volume'). */
  paramId: string
  /** Human label for the target. */
  paramLabel: string
  kind: ControlKind
  /** Controller number for cc bindings. */
  controller?: number
  /** Note number for note bindings. */
  note?: number
  /** Device port name the binding was learned from (for display only). */
  deviceName?: string
}

export interface LearnableParameter {
  id: string
  label: string
  /** Setter invoked when a bound control fires. */
  apply: (value: number) => void
}

interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const STORAGE_KEY = 'opusweave.midi-learn.bindings'

export class MidiLearn {
  private bindings: LearnedBinding[] = []
  private armedParam: LearnableParameter | null = null
  private readonly params = new Map<string, LearnableParameter>()

  constructor(private readonly storage: StorageLike) {
    try {
      const raw = storage.getItem(STORAGE_KEY)
      if (raw) this.bindings = JSON.parse(raw) as LearnedBinding[]
    } catch {
      this.bindings = []
    }
  }

  register(param: LearnableParameter): void {
    this.params.set(param.id, param)
  }

  /** Arm a parameter; the next matching MIDI message binds to it. */
  learn(paramId: string): void {
    this.armedParam = this.params.get(paramId) ?? null
  }

  get isArmed(): boolean {
    return this.armedParam !== null
  }

  get armedParamLabel(): string | null {
    return this.armedParam?.label ?? null
  }

  /** Feed a raw MIDI message; returns the newly created binding, if any. */
  onMessage(data: Uint8Array, deviceName?: string): LearnedBinding | null {
    const armed = this.armedParam
    if (!armed || data.length < 2) return null

    const status = data[0]!
    const kind: ControlKind | null = (status & 0xf0) === 0xb0 ? 'cc' : (status & 0xf0) === 0x90 ? 'note' : (status & 0xf0) === 0xe0 ? 'pitchBend' : null
    if (!kind) return null

    const binding: LearnedBinding =
      kind === 'cc'
        ? { paramId: armed.id, paramLabel: armed.label, kind, controller: data[1]!, deviceName }
        : kind === 'note'
          ? { paramId: armed.id, paramLabel: armed.label, kind, note: data[1]!, deviceName }
          : { paramId: armed.id, paramLabel: armed.label, kind, deviceName }

    // Replace an existing binding for the same target.
    this.bindings = this.bindings.filter((b) => b.paramId !== armed.id)
    this.bindings.push(binding)
    this.persist()
    this.armedParam = null
    return binding
  }

  /** Apply any binding that matches an incoming message; returns the applied parameter label. */
  applyIncoming(data: Uint8Array): string | null {
    if (data.length < 2) return null
    const status = data[0]!
    const kind: ControlKind = (status & 0xf0) === 0xb0 ? 'cc' : (status & 0xf0) === 0x90 ? 'note' : (status & 0xf0) === 0xe0 ? 'pitchBend' : 'cc'
    for (const b of this.bindings) {
      let match = false
      if (b.kind === 'cc' && kind === 'cc') match = b.controller === data[1]
      else if (b.kind === 'note' && kind === 'note') match = b.note === data[1]
      else if (b.kind === 'pitchBend' && kind === 'pitchBend') match = true
      if (match) {
        const param = this.params.get(b.paramId)
        if (param) {
          const value = (status & 0xf0) === 0xe0 ? ((data[2]! << 7) | data[1]!) : data[2] ?? 0
          param.apply(value)
          return param.label
        }
      }
    }
    return null
  }

  listBindings(): LearnedBinding[] {
    return [...this.bindings]
  }

  removeBinding(paramId: string): void {
    this.bindings = this.bindings.filter((b) => b.paramId !== paramId)
    this.persist()
  }

  private persist(): void {
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(this.bindings))
    } catch {
      // storage full/unavailable — bindings stay in memory for this session
    }
  }
}
