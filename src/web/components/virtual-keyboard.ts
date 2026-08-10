/**
 * VirtualKeyboard — renders a piano keyboard for an arbitrary note range.
 * Not fixed at 88 keys: a 32-key MIDIPLUS TINY+ (C2..G4) or the range of the
 * loaded MIDI both get a sane layout. Click-to-play optional.
 */
import { noteName } from '../../domain/devices/mapping-engine.ts'

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

  constructor(container: HTMLElement, private readonly opts: VirtualKeyboardOptions) {
    this.root = container
    this.render()
  }

  private render(): void {
    this.root.innerHTML = ''
    this.keys.clear()
    for (let note = this.opts.minNote; note <= this.opts.maxNote; note++) {
      const el = document.createElement('div')
      el.className = `vk-key${isBlack(note) ? ' black' : ''}`
      const label = document.createElement('span')
      label.className = 'vk-label'
      label.textContent = noteName(note)
      el.appendChild(label)
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault()
        this.opts.onNoteOn?.(note)
      })
      el.addEventListener('pointerup', () => this.opts.onNoteOff?.(note))
      el.addEventListener('pointerleave', () => this.opts.onNoteOff?.(note))
      this.root.appendChild(el)
      this.keys.set(note, el)
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

  /** Re-render for a new range (e.g. after loading a MIDI with a wider range). */
  setRange(minNote: number, maxNote: number): void {
    this.opts.minNote = minNote
    this.opts.maxNote = maxNote
    this.render()
  }
}
