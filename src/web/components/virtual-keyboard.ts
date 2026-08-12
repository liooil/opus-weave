/**
 * VirtualKeyboard — renders a piano keyboard for an arbitrary note range.
 * Not fixed at 88 keys: a 32-key MIDIPLUS TINY+ (C2..G4) or the range of the
 * loaded MIDI both get a sane layout. Click-to-play optional.
 */
import { noteName } from '../../domain/devices/mapping-engine.ts'
import { enableHorizontalPointerScroll } from './horizontal-pointer-scroll.ts'

export interface VirtualKeyboardOptions {
  /** Lowest MIDI note to render. */
  minNote: number
  /** Highest MIDI note to render (inclusive). */
  maxNote: number
  /** Called on key pointer-down with the MIDI note. */
  onNoteOn?: (note: number) => void
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

  constructor(container: HTMLElement, private readonly opts: VirtualKeyboardOptions) {
    this.root = container
    this.render()
    enableHorizontalPointerScroll(this.root, {
      targetSelector: '.vk-key',
      onHoldStart: (target) => this.startPointerNote(target),
      onTap: (target) => {
        const release = this.startPointerNote(target)
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
      this.root.appendChild(el)
      this.keys.set(note, el)
    }
  }

  private startPointerNote(target: HTMLElement): (() => void) | undefined {
    const note = Number(target.dataset.note)
    if (!Number.isInteger(note)) return undefined
    this.opts.onNoteOn?.(note)
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

  /** Mark the notes currently reachable from the computer keyboard. */
  setMappedRange(minNote: number, maxNote: number): void {
    for (const [note, el] of this.keys) {
      el.classList.toggle('mapped', note >= minNote && note <= maxNote)
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
