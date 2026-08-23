/**
 * VirtualKeyboard — renders a piano keyboard for an arbitrary note range.
 * Note names are always present; computer-key mappings and the playable range
 * of a connected MIDI keyboard are tracked as separate visual states.
 */
import { noteName } from '../../domain/devices/mapping-engine.ts'
import { isPointerOnNativeScrollbar } from './horizontal-pointer-scroll.ts'
import { isPressureSensitive, pressureToVelocity } from '../pointer-pressure.ts'
import { PianoPointerGesture, type PianoGestureAction, type PianoPointerSample } from './piano-pointer-gesture.ts'

export interface VirtualKeyboardOptions {
  /** Lowest MIDI note to render. */
  minNote: number
  /** Highest MIDI note to render (inclusive). */
  maxNote: number
  /** Called on key pointer-down with the MIDI note and optional pressure-based velocity. */
  onNoteOn?: (note: number, velocity?: number) => void
  /** Called on key pointer-up / leave with the MIDI note. */
  onNoteOff?: (note: number) => void
}

export interface MidiNoteRange {
  min: number
  max: number
}

/** True when a valid MIDI note belongs to a valid inclusive MIDI range. */
export function isNoteInRange(note: number, range: MidiNoteRange | null | undefined): boolean {
  return Boolean(
    range
    && Number.isInteger(note)
    && note >= 0
    && note <= 127
    && Number.isInteger(range.min)
    && Number.isInteger(range.max)
    && range.min >= 0
    && range.max <= 127
    && range.min <= range.max
    && note >= range.min
    && note <= range.max,
  )
}

function isBlack(note: number): boolean {
  const pc = ((note % 12) + 12) % 12
  return pc === 1 || pc === 3 || pc === 6 || pc === 8 || pc === 10
}

export class VirtualKeyboard {
  private readonly root: HTMLElement
  private readonly keys = new Map<number, HTMLElement>()
  private readonly expected = new Set<number>()
  private readonly computerLabels = new Map<number, string[]>()
  private readonly pointerGesture = new PianoPointerGesture()
  private midiPlayableRange: MidiNoteRange | null = null

  constructor(container: HTMLElement, private readonly opts: VirtualKeyboardOptions) {
    this.root = container
    this.render()
    this.enablePointerPerformance()
  }

  private render(): void {
    this.root.innerHTML = ''
    this.keys.clear()
    for (let note = this.opts.minNote; note <= this.opts.maxNote; note++) {
      const el = document.createElement('div')
      el.className = `vk-key${isBlack(note) ? ' black' : ''}`
      if (this.expected.has(note)) el.classList.add('expected')
      if (isNoteInRange(note, this.midiPlayableRange)) el.classList.add('midi-playable')
      el.dataset.note = String(note)
      const label = document.createElement('span')
      label.className = 'vk-label'
      label.textContent = noteName(note)
      el.appendChild(label)
      const computerLabel = document.createElement('span')
      computerLabel.className = 'vk-computer-key'
      el.appendChild(computerLabel)
      this.root.appendChild(el)
      this.keys.set(note, el)
      this.updateComputerKeyLabel(note, el)
    }
  }

  private pointerVelocity(event: PointerEvent | undefined): number | undefined {
    if (!event || !isPressureSensitive(event)) return undefined
    return pressureToVelocity(event.pressure)
  }

  private enablePointerPerformance(): void {
    this.root.addEventListener('pointerdown', (event) => {
      if ((event.pointerType === 'mouse' && event.button !== 0) || isPointerOnNativeScrollbar(this.root, event)) return
      event.preventDefault()
      const actions = this.pointerGesture.pointerDown(this.pointerSample(event), this.noteFromEventTarget(event))
      this.root.setPointerCapture(event.pointerId)
      this.applyGestureActions(actions, event)
    })
    this.root.addEventListener('pointermove', (event) => {
      if (!this.pointerGesture.hasPointer(event.pointerId)) return
      event.preventDefault()
      const actions = this.pointerGesture.pointerMove(this.pointerSample(event), this.noteAtPoint(event.clientX, event.clientY))
      this.applyGestureActions(actions, event)
    })
    const endPointer = (event: PointerEvent) => {
      if (!this.pointerGesture.hasPointer(event.pointerId)) return
      event.preventDefault()
      this.applyGestureActions(this.pointerGesture.pointerUp(event.pointerId), event)
      if (this.root.hasPointerCapture(event.pointerId)) this.root.releasePointerCapture(event.pointerId)
    }
    this.root.addEventListener('pointerup', endPointer)
    this.root.addEventListener('pointercancel', endPointer)
    this.root.addEventListener('lostpointercapture', (event) => {
      if (!this.pointerGesture.hasPointer(event.pointerId)) return
      this.applyGestureActions(this.pointerGesture.pointerUp(event.pointerId), event)
    })
    window.addEventListener('blur', () => this.applyGestureActions(this.pointerGesture.cancelAll()))
  }

  private pointerSample(event: PointerEvent): PianoPointerSample {
    return { pointerId: event.pointerId, pointerType: event.pointerType, clientX: event.clientX }
  }

  private noteFromEventTarget(event: PointerEvent): number | null {
    return this.noteFromElement(event.target as Element | null)
  }

  private noteAtPoint(clientX: number, clientY: number): number | null {
    return this.noteFromElement(document.elementFromPoint(clientX, clientY))
  }

  private noteFromElement(element: Element | null): number | null {
    const key = element?.closest<HTMLElement>('.vk-key') ?? null
    if (!key || !this.root.contains(key)) return null
    const note = Number(key.dataset.note)
    return Number.isInteger(note) ? note : null
  }

  private applyGestureActions(actions: readonly PianoGestureAction[], event?: PointerEvent): void {
    for (const action of actions) {
      if (action.type === 'note-on') this.opts.onNoteOn?.(action.note, this.pointerVelocity(event))
      else if (action.type === 'note-off') this.opts.onNoteOff?.(action.note)
      else this.root.scrollLeft += action.delta
    }
    this.root.classList.toggle('is-touch-panning', this.pointerGesture.isTouchPanning)
  }

  /** Highlight a pressed note. */
  setPressed(note: number, pressed: boolean): void {
    const el = this.keys.get(note)
    if (el) el.classList.toggle('playing', pressed)
  }

  clearAll(): void {
    for (const el of this.keys.values()) el.classList.remove('playing')
  }

  setExpected(notes: readonly number[]): void {
    this.expected.clear()
    for (const note of notes) this.expected.add(note)
    for (const [note, el] of this.keys) el.classList.toggle('expected', this.expected.has(note))
  }

  /** Mark the exact notes currently reachable from the computer keyboard. */
  setMappedNotes(notes: ReadonlySet<number>): void {
    for (const [note, el] of this.keys) {
      el.classList.toggle('mapped', notes.has(note))
    }
  }

  /** Highlight the notes playable on the selected physical MIDI keyboard. */
  setMidiPlayableRange(range: MidiNoteRange | null | undefined): void {
    this.midiPlayableRange = range ? { ...range } : null
    for (const [note, el] of this.keys) {
      el.classList.toggle('midi-playable', isNoteInRange(note, this.midiPlayableRange))
    }
  }

  /** Show computer-key labels on the mapped piano keys. */
  setComputerKeyLabels(labels: ReadonlyMap<number, readonly string[]>): void {
    this.computerLabels.clear()
    for (const [note, keys] of labels) this.computerLabels.set(note, [...keys])
    for (const [note, el] of this.keys) this.updateComputerKeyLabel(note, el)
  }

  private updateComputerKeyLabel(note: number, el: HTMLElement): void {
    const computer = el.querySelector<HTMLElement>('.vk-computer-key')
    const labels = this.computerLabels.get(note)
    if (computer) {
      computer.textContent = labels && labels.length > 0
        ? labels.length > 3 ? `${labels.slice(0, 3).join('/')}…` : labels.join('/')
        : ''
    }
  }

  /** Center a note range in the horizontal piano viewport. */
  scrollToRange(minNote: number, maxNote: number, behavior: ScrollBehavior = 'smooth'): void {
    const first = this.keys.get(minNote)
    const last = this.keys.get(maxNote)
    if (!first || !last) return
    const rootRect = this.root.getBoundingClientRect()
    const firstRect = first.getBoundingClientRect()
    const lastRect = last.getBoundingClientRect()
    const rangeStart = firstRect.left - rootRect.left + this.root.scrollLeft
    const rangeEnd = lastRect.right - rootRect.left + this.root.scrollLeft
    const left = Math.max(0, (rangeStart + rangeEnd - this.root.clientWidth) / 2)
    this.root.scrollTo({ left, behavior })
  }

}
