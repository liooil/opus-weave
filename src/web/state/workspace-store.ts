export type PlaybackSource = 'owt' | 'selection' | 'midi' | 'ai-improv'

export type TransportState =
  | { kind: 'idle'; positionSeconds: number; loop: boolean }
  | { kind: 'loading'; source: PlaybackSource; loop: boolean }
  | { kind: 'playing'; source: PlaybackSource; positionSeconds: number; loop: boolean }
  | { kind: 'paused'; source: PlaybackSource; positionSeconds: number; loop: boolean }
  | { kind: 'error'; message: string; loop: boolean }

export type ImprovState =
  | { kind: 'off' }
  | { kind: 'listening' }
  | { kind: 'recording' }
  | { kind: 'thinking' }
  | { kind: 'responding' }
  | { kind: 'error'; message: string }

export type CompositionWorkflowState =
  | { kind: 'idle'; mode: 'sketch' | 'full' }
  | { kind: 'planning' }
  | { kind: 'composing'; sectionId: string; completed: string[] }
  | { kind: 'repairing'; sectionId: string; attempt: number }
  | { kind: 'assembling'; completed: string[] }
  | { kind: 'validating' }
  | { kind: 'complete'; owt: string }
  | { kind: 'cancelled' }
  | { kind: 'error'; message: string; sectionId?: string }

export interface WorkspaceState {
  owt: string
  documentVersion: number
  selectedRanges: ReadonlyArray<{ start: number; end: number }>
  midiLoaded: boolean
  recording: boolean
  transport: TransportState
  improv: ImprovState
  composition: CompositionWorkflowState
  error?: string
}

type Listener = (state: Readonly<WorkspaceState>) => void

export class WorkspaceStore {
  private listeners = new Set<Listener>()

  constructor(private value: WorkspaceState) {}

  get state(): Readonly<WorkspaceState> {
    return this.value
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    listener(this.value)
    return () => this.listeners.delete(listener)
  }

  update(update: Partial<WorkspaceState> | ((state: Readonly<WorkspaceState>) => WorkspaceState)): void {
    this.value = typeof update === 'function' ? update(this.value) : { ...this.value, ...update }
    for (const listener of this.listeners) listener(this.value)
  }

  loadDocument(owt: string): void {
    this.update((state) => ({
      ...state,
      owt,
      documentVersion: state.documentVersion + 1,
      selectedRanges: [],
      midiLoaded: false,
      recording: false,
      transport: { kind: 'idle', positionSeconds: 0, loop: state.transport.loop },
      improv: { kind: 'off' },
      composition: { kind: 'idle', mode: 'sketch' },
      error: undefined,
    }))
  }
}
