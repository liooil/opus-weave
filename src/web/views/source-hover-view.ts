export interface SourceHoverField {
  label: string
  description: string
}

export type Translate = (key: string, values?: Record<string, string | number>) => string

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id)
  if (!element) throw new Error(`Element #${id} not found`)
  return element as T
}

function position(clientX: number, clientY: number): void {
  const card = byId<HTMLElement>('source-hover-card')
  const gap = 14
  card.style.left = `${Math.max(12, Math.min(clientX + gap, window.innerWidth - card.offsetWidth - 12))}px`
  card.style.top = `${Math.max(12, Math.min(clientY + gap, window.innerHeight - card.offsetHeight - 12))}px`
}

function show(raw: string, fields: readonly SourceHoverField[], event: PointerEvent | FocusEvent): void {
  const card = byId<HTMLElement>('source-hover-card')
  byId('source-hover-raw').textContent = raw
  const list = byId<HTMLDListElement>('source-hover-fields')
  list.replaceChildren(...fields.flatMap((field) => {
    const term = document.createElement('dt')
    const description = document.createElement('dd')
    term.textContent = field.label
    description.textContent = field.description
    return [term, description]
  }))
  card.hidden = false
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  position(event instanceof PointerEvent ? event.clientX : rect.right, event instanceof PointerEvent ? event.clientY : rect.top)
}

function hide(): void { byId('source-hover-card').hidden = true }

export function attachSourceHover(target: HTMLElement, raw: string, fields: () => readonly SourceHoverField[]): void {
  target.removeAttribute('title')
  target.addEventListener('pointerenter', (event) => show(raw, fields(), event))
  target.addEventListener('pointermove', (event) => position(event.clientX, event.clientY))
  target.addEventListener('pointerleave', hide)
  target.addEventListener('focus', (event) => show(raw, fields(), event))
  target.addEventListener('blur', hide)
}

function midiPitchNumber(pitch: string): number | null {
  const match = /^([A-G])([#b]?)(-?\d+)$/.exec(pitch)
  if (!match) return null
  const semitones: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
  return (Number(match[3]) + 1) * 12 + semitones[match[1]!]! + (match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0)
}

export function describeOwtSourceToken(raw: string, t: Translate): SourceHoverField[] {
  const control = /^<(cc(\d+)|bend|program)=(-?\d+)>$/.exec(raw)
  if (control) return [
    { label: t('sourceHover.type'), description: t('sourceHover.type.control') },
    { label: t('sourceHover.control'), description: control[2] ? t('sourceHover.control.cc', { controller: control[2] }) : t(`sourceHover.control.${control[1]}`) },
    { label: t('sourceHover.value'), description: t('sourceHover.value.control', { value: control[3]! }) },
  ]
  const velocity = /\{v=(\d+)\}$/.exec(raw)?.[1]
  const core = raw.replace(/\{v=\d+\}$/, '')
  const separator = core.lastIndexOf(':')
  if (separator < 0) return [{ label: t('sourceHover.type'), description: t('sourceHover.type.event') }]
  const pitchText = core.slice(0, separator)
  const duration = core.slice(separator + 1)
  const pitches = pitchText.startsWith('[') ? pitchText.slice(1, -1).trim().split(/\s+/) : pitchText === 'R' ? [] : [pitchText]
  const fields: SourceHoverField[] = [{ label: t('sourceHover.type'), description: t(pitches.length === 0 ? 'sourceHover.type.rest' : pitches.length > 1 ? 'sourceHover.type.chord' : 'sourceHover.type.note') }]
  if (pitches.length > 0) {
    const values = pitches.map((pitch) => { const midi = midiPitchNumber(pitch); return midi === null ? pitch : `${pitch} (MIDI ${midi})` }).join(', ')
    fields.push({ label: t(pitches.length > 1 ? 'sourceHover.pitches' : 'sourceHover.pitch'), description: t('sourceHover.pitch.description', { value: values }) })
  }
  fields.push({ label: t('sourceHover.duration'), description: t('sourceHover.duration.description', { value: duration }) })
  if (velocity) fields.push({ label: t('sourceHover.velocity'), description: t('sourceHover.velocity.description', { value: velocity }) })
  return fields
}
