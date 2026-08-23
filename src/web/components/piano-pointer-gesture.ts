export interface PianoPointerSample {
  pointerId: number
  pointerType: string
  clientX: number
}

export type PianoGestureAction =
  | { type: 'note-on'; pointerId: number; note: number }
  | { type: 'note-off'; pointerId: number; note: number }
  | { type: 'scroll-by'; delta: number }

interface ActivePointer extends PianoPointerSample {
  note: number | null
  suppressed: boolean
}

interface TouchPanState {
  lastCentroidX: number
}

/**
 * Interprets piano pointer input without touching the DOM:
 * one pointer glides across notes, while two or more touches pan the keyboard.
 */
export class PianoPointerGesture {
  private readonly pointers = new Map<number, ActivePointer>()
  private touchPan: TouchPanState | null = null

  hasPointer(pointerId: number): boolean {
    return this.pointers.has(pointerId)
  }

  get isTouchPanning(): boolean {
    return this.touchPan !== null
  }

  pointerDown(sample: PianoPointerSample, note: number | null): PianoGestureAction[] {
    if (this.pointers.has(sample.pointerId)) return []
    const pointer: ActivePointer = { ...sample, note: null, suppressed: false }
    this.pointers.set(sample.pointerId, pointer)

    if (sample.pointerType === 'touch' && this.touchPointers().length >= 2) {
      const actions = this.suppressTouchNotes()
      this.startTouchPan()
      return actions
    }

    return this.transitionNote(pointer, note)
  }

  pointerMove(sample: PianoPointerSample, note: number | null): PianoGestureAction[] {
    const pointer = this.pointers.get(sample.pointerId)
    if (!pointer) return []
    pointer.clientX = sample.clientX

    if (pointer.pointerType === 'touch' && this.touchPan) {
      const centroidX = this.touchCentroidX()
      const delta = this.touchPan.lastCentroidX - centroidX
      this.touchPan.lastCentroidX = centroidX
      return [{ type: 'scroll-by', delta }]
    }
    if (pointer.suppressed) return []
    return this.transitionNote(pointer, note)
  }

  pointerUp(pointerId: number): PianoGestureAction[] {
    const pointer = this.pointers.get(pointerId)
    if (!pointer) return []
    const actions = pointer.note === null
      ? []
      : [{ type: 'note-off', pointerId, note: pointer.note } satisfies PianoGestureAction]
    this.pointers.delete(pointerId)

    if (pointer.pointerType === 'touch' && this.touchPan) {
      const touches = this.touchPointers()
      if (touches.length >= 2) this.startTouchPan()
      else {
        this.touchPan = null
        for (const touch of touches) touch.suppressed = true
      }
    }
    return actions
  }

  cancelAll(): PianoGestureAction[] {
    const actions: PianoGestureAction[] = []
    for (const pointer of this.pointers.values()) {
      if (pointer.note !== null) actions.push({ type: 'note-off', pointerId: pointer.pointerId, note: pointer.note })
    }
    this.pointers.clear()
    this.touchPan = null
    return actions
  }

  private transitionNote(pointer: ActivePointer, note: number | null): PianoGestureAction[] {
    if (pointer.note === note) return []
    const actions: PianoGestureAction[] = []
    if (pointer.note !== null) actions.push({ type: 'note-off', pointerId: pointer.pointerId, note: pointer.note })
    pointer.note = note
    if (note !== null) actions.push({ type: 'note-on', pointerId: pointer.pointerId, note })
    return actions
  }

  private touchPointers(): ActivePointer[] {
    return [...this.pointers.values()].filter((pointer) => pointer.pointerType === 'touch')
  }

  private touchCentroidX(): number {
    const touches = this.touchPointers()
    return touches.reduce((sum, pointer) => sum + pointer.clientX, 0) / touches.length
  }

  private suppressTouchNotes(): PianoGestureAction[] {
    const actions: PianoGestureAction[] = []
    for (const pointer of this.touchPointers()) {
      pointer.suppressed = true
      if (pointer.note === null) continue
      actions.push({ type: 'note-off', pointerId: pointer.pointerId, note: pointer.note })
      pointer.note = null
    }
    return actions
  }

  private startTouchPan(): void {
    this.touchPan = { lastCentroidX: this.touchCentroidX() }
  }
}
