import type { ImprovState, WorkspaceStore } from '../state/workspace-store.ts'

export interface ImprovActions {
  abortRequest(): void
  stopPlayback(): void
}

export class ImprovController {
  constructor(private readonly store: WorkspaceStore, private readonly actions: ImprovActions) {}

  get state(): ImprovState {
    return this.store.state.improv
  }

  start(): void {
    this.store.update({ improv: { kind: 'listening' } })
  }

  beginPhrase(): void {
    if (this.state.kind === 'responding') this.actions.stopPlayback()
    this.actions.abortRequest()
    this.store.update({ improv: { kind: 'recording' } })
  }

  finishPhrase(): void {
    if (this.state.kind === 'recording') this.store.update({ improv: { kind: 'thinking' } })
  }

  beginResponse(): void {
    if (this.state.kind === 'thinking') this.store.update({ improv: { kind: 'responding' } })
  }

  responseEnded(): void {
    if (this.state.kind === 'responding') this.store.update({ improv: { kind: 'listening' } })
  }

  fail(error: unknown): void {
    this.store.update({ improv: { kind: 'error', message: error instanceof Error ? error.message : String(error) } })
  }

  recover(): void {
    if (this.state.kind === 'error') this.store.update({ improv: { kind: 'listening' } })
  }

  stop(): void {
    this.actions.abortRequest()
    this.actions.stopPlayback()
    this.store.update({ improv: { kind: 'off' } })
  }
}
