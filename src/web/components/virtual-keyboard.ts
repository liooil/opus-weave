/**
 * VirtualKeyboard — renders a piano keyboard for an arbitrary note range.
 * Not fixed at 88 keys: a 32-key MIDIPLUS TINY+ (C2..G4) or the range of the
 * loaded MIDI both get a sane layout. Click-to-play optional.
 */
import { noteName } from '../../domain/devices/mapping-engine.ts'
import { enableHorizontalPointerScroll } from './horizontal-pointer-scroll.ts'
import { isPressureSensitive, pressureToVelocity } from '../pointer-pressure.ts'

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

function isBlack(note: number): boolean {
  const pc = ((note % 12) + 12) % 12
  return pc === 1 || pc === 3 || pc === 6 || pc === 8 || pc === 10
}

export class VirtualKeyboard {
  private readonly root: HTMLElement
  private readonly keys = new Map<number, HTMLElement>()
  private readonly expected = new Set<number>()
  private readonly computerLabels = new Map<number, string[]>()

  constructor(container: HTMLElement, private readonly opts: VirtualKeyboardOptions) {
    this.root = container
    this.render()
    enableHorizontalPointerScroll(this.root, {
      targetSelector: '.vk-key',
      onHoldStart: (target, event) => this.startPointerNote(target, event),
      onTap: (target, _event, startEvent) => {
        const release = this.startPointerNote(target, startEvent)
        if (release) window.setTimeout(release, 160)
      },
    })
  }

  private render(): void {
    this.root.innerHTML = ''
    this.keys.clear()
    for (let note = this.opts.minNote; note <= this.opts.maxNote; note++) {
      const el = document.createElement('div')
      el.className = `vk-key${isBlack(note) ? ' black' : ''}`
      if (this.expected.has(note)) el.classList.add('expected')
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

  private startPointerNote(target: HTMLElement, event?: PointerEvent): (() => void) | undefined {
    const note = Number(target.dataset.note)
    if (!Number.isInteger(note)) return undefined
    this.opts.onNoteOn?.(note, this.pointerVelocity(event))
    let released = false
    return () => {
      if (released) return
      released = true
      this.opts.onNoteOff?.(note)
    }
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
