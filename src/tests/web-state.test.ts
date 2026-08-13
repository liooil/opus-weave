import { describe, expect, test } from 'bun:test'
import { ImprovController } from '../web/controllers/improv-controller.ts'
import { TransportController } from '../web/controllers/transport-controller.ts'
import { WorkspaceStore, type WorkspaceState } from '../web/state/workspace-store.ts'

function createStore(): WorkspaceStore {
  const state: WorkspaceState = {
    owt: 'old', documentVersion: 0, selectedRanges: [{ start: 1, end: 2 }], midiLoaded: true, recording: true,
    transport: { kind: 'idle', positionSeconds: 0, loop: false }, improv: { kind: 'off' },
    composition: { kind: 'idle', mode: 'sketch' }, error: 'old error',
  }
  return new WorkspaceStore(state)
}

describe('workspace controllers', () => {
  test('models transport play, loop, pause, return, errors and recovery explicitly', () => {
    const store = createStore()
    const calls: string[] = []
    const transport = new TransportController(store, {
      pause: () => calls.push('pause'), stop: () => calls.push('stop'), panic: () => calls.push('panic'),
      clearPlaybackMapping: () => calls.push('clear'),
    })
    transport.setLoop(true)
    transport.beginLoading('selection')
    expect(transport.state).toEqual({ kind: 'loading', source: 'selection', loop: true })
    transport.markPlaying('selection', 4)
    expect(transport.state).toEqual({ kind: 'playing', source: 'selection', positionSeconds: 4, loop: true })
    transport.updatePosition(7)
    transport.pause()
    expect(transport.state).toEqual({ kind: 'paused', source: 'selection', positionSeconds: 7, loop: true })
    transport.returnToBeginning()
    expect(transport.state).toEqual({ kind: 'idle', positionSeconds: 0, loop: true })
    expect(calls).toEqual(['pause', 'stop', 'clear'])

    const failing = new TransportController(store, { pause() {}, stop() {}, panic() {}, clearPlaybackMapping() {} })
    failing.fail(new Error('audio'))
    expect(failing.state.kind).toBe('error')
    failing.recover()
    expect(failing.state.kind).toBe('idle')
  })

  test('models improv barge-in, cancellation and recovery', () => {
    const store = createStore()
    const calls: string[] = []
    const improv = new ImprovController(store, { abortRequest: () => calls.push('abort'), stopPlayback: () => calls.push('stop') })
    improv.start()
    improv.beginPhrase()
    improv.finishPhrase()
    improv.beginResponse()
    improv.beginPhrase()
    expect(improv.state.kind).toBe('recording')
    expect(calls).toEqual(['abort', 'stop', 'abort'])
    improv.fail('network')
    expect(improv.state).toEqual({ kind: 'error', message: 'network' })
    improv.recover()
    expect(improv.state.kind).toBe('listening')
    improv.stop()
    expect(improv.state.kind).toBe('off')
  })

  test('opening a new document clears stale playback, selection, recording, improv and errors', () => {
    const store = createStore()
    store.update({ transport: { kind: 'playing', source: 'midi', positionSeconds: 2, loop: true }, improv: { kind: 'thinking' } })
    store.loadDocument('new')
    expect(store.state).toMatchObject({ owt: 'new', documentVersion: 1, selectedRanges: [], midiLoaded: false, recording: false, error: undefined })
    expect(store.state.transport).toEqual({ kind: 'idle', positionSeconds: 0, loop: true })
    expect(store.state.improv).toEqual({ kind: 'off' })
  })
})
