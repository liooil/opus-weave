import type { PlaybackSource, TransportState, WorkspaceStore } from '../state/workspace-store.ts'

export interface TransportActions {
  pause(): void
  stop(): void
  panic(): void
  clearPlaybackMapping(): void
}

export class TransportController {
  constructor(private readonly store: WorkspaceStore, private readonly actions: TransportActions) {}

  get state(): TransportState {
    return this.store.state.transport
  }

  setLoop(loop: boolean): void {
    this.store.update((state) => ({ ...state, transport: { ...state.transport, loop } }))
  }

  beginLoading(source: PlaybackSource): void {
    this.store.update({ transport: { kind: 'loading', source, loop: this.state.loop } })
  }

  markPlaying(source: PlaybackSource, positionSeconds = 0): void {
    this.store.update({ transport: { kind: 'playing', source, positionSeconds: Math.max(0, positionSeconds), loop: this.state.loop } })
  }

  fail(error: unknown): void {
    this.store.update({ transport: { kind: 'error', message: error instanceof Error ? error.message : String(error), loop: this.state.loop } })
  }

  pause(): void {
    const current = this.state
    if (current.kind !== 'playing') return
    this.actions.pause()
    this.store.update({ transport: { kind: 'paused', source: current.source, positionSeconds: current.positionSeconds, loop: current.loop } })
  }

  updatePosition(positionSeconds: number): void {
    const current = this.state
    if (current.kind !== 'playing' && current.kind !== 'paused') return
    this.store.update({ transport: { ...current, positionSeconds: Math.max(0, positionSeconds) } })
  }

  finish(): void {
    this.store.update({ transport: { kind: 'idle', positionSeconds: 0, loop: this.state.loop } })
  }

  returnToBeginning(): void {
    this.actions.stop()
    this.actions.clearPlaybackMapping()
    this.store.update({ transport: { kind: 'idle', positionSeconds: 0, loop: this.state.loop } })
  }

  loadDocument(): void {
    this.actions.stop()
    this.actions.clearPlaybackMapping()
    this.store.update({ transport: { kind: 'idle', positionSeconds: 0, loop: this.state.loop } })
  }

  panic(): void {
    this.actions.panic()
    this.actions.clearPlaybackMapping()
    this.store.update({ transport: { kind: 'idle', positionSeconds: 0, loop: this.state.loop } })
  }

  recover(): void {
    if (this.state.kind === 'error') this.store.update({ transport: { kind: 'idle', positionSeconds: 0, loop: this.state.loop } })
  }
}
