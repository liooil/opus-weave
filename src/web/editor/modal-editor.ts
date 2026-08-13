import { buildOwtSyntaxIndex, nextObject, objectContaining, objectsOfKind, selectionLevelForClickCount, semanticRangeFromNativeSelection, syntaxChild, syntaxParent, type OwtObjectKind, type OwtSyntaxIndex } from './owt-objects.ts'

export type EditorMode = 'normal' | 'insert' | 'select' | 'command' | 'raw'

export interface EditorSelection { anchor: number; head: number }
export interface TextEdit { from: number; to: number; insert: string }
export interface ModalEditorViewState {
  mode: EditorMode
  selections: EditorSelection[]
  primary: number
  pending: string
  line: number
  column: number
}
export interface ModalEditorCallbacks {
  onChange: (text: string) => void
  onRender: (state: ModalEditorViewState) => void
  onCommand: (command: string, args?: string) => void | Promise<void>
  getSyntaxIndex?: () => OwtSyntaxIndex
}
interface Snapshot { text: string; selections: EditorSelection[]; primary: number }

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

export function normalizedSelection(selection: EditorSelection): { start: number; end: number } {
  return selection.anchor <= selection.head ? { start: selection.anchor, end: selection.head } : { start: selection.head, end: selection.anchor }
}
export function applyTextEdits(text: string, edits: readonly TextEdit[]): string {
  let output = text
  for (const edit of edits.slice().sort((a, b) => b.from - a.from)) output = output.slice(0, edit.from) + edit.insert + output.slice(edit.to)
  return output
}
export function cursorsAfterEdits(edits: readonly TextEdit[], atEnd: boolean): EditorSelection[] {
  const indexed = edits.map((edit, index) => ({ edit, index })).sort((a, b) => a.edit.from - b.edit.from)
  const output: EditorSelection[] = new Array(edits.length)
  let delta = 0
  for (const { edit, index } of indexed) {
    const position = edit.from + delta + (atEnd ? edit.insert.length : 0)
    output[index] = { anchor: position, head: position }
    delta += edit.insert.length - (edit.to - edit.from)
  }
  return output
}
function cloneSelections(value: readonly EditorSelection[]): EditorSelection[] { return value.map((selection) => ({ ...selection })) }
function boundaries(text: string): number[] {
  const result = [...graphemes.segment(text)].map((part) => part.index)
  if (result.at(-1) !== text.length) result.push(text.length)
  return result.length ? result : [0]
}
export function previousGrapheme(text: string, position: number): number {
  for (const boundary of boundaries(text).reverse()) if (boundary < position) return boundary
  return 0
}

export interface OwtSemanticMotion {
  kind: 'event' | 'measure' | 'track'
  direction: 1 | -1
}

/** Map horizontal Helix motions onto neighboring OWT events. */
export function owtSemanticMotion(key: string): OwtSemanticMotion | undefined {
  switch (key) {
    case 'h': case 'b': case 'ArrowLeft': return { kind: 'event', direction: -1 }
    case 'l': case 'w': case 'e': case 'ArrowRight': return { kind: 'event', direction: 1 }
    default: return undefined
  }
}

export interface OwtMotionDestination {
  keys: string
  kind: 'event' | 'measure'
  direction: 1 | -1
  start: number
  end: number
}

/** Resolve the exact semantic objects selected by horizontal motion keys. */
export function owtMotionDestinations(index: OwtSyntaxIndex, selection: EditorSelection): OwtMotionDestination[] {
  const range = normalizedSelection(selection)
  const destinations: OwtMotionDestination[] = []
  const motions: Array<{ keys: string; kind: 'event'; direction: 1 | -1 }> = [
    { keys: 'h/b', kind: 'event', direction: -1 },
    { keys: 'l/w/e', kind: 'event', direction: 1 },
  ]
  for (const motion of motions) {
    const objects = objectsOfKind(index, motion.kind).slice().sort((left, right) => left.start - right.start)
    const currentIndex = objects.findIndex((object) => object.start <= range.start && object.end > range.start)
    const object = currentIndex >= 0
      ? objects[(currentIndex + motion.direction + objects.length) % objects.length]
      : nextObject(index, motion.kind, range.start, motion.direction)
    if (object) destinations.push({ ...motion, start: object.start, end: object.end })
  }
  return destinations
}
export function nextGrapheme(text: string, position: number): number {
  for (const boundary of boundaries(text)) if (boundary > position) return boundary
  return text.length
}
function cursor(text: string, position: number): EditorSelection {
  if (!text.length) return { anchor: 0, head: 0 }
  const start = Math.min(Math.max(0, position), text.length - 1)
  return { anchor: start, head: nextGrapheme(text, start) }
}
function lineStart(text: string, position: number): number { return text.lastIndexOf('\n', Math.max(0, position - 1)) + 1 }
function lineEnd(text: string, position: number): number { const end = text.indexOf('\n', position); return end < 0 ? text.length : end }
function lineColumn(text: string, position: number): { line: number; column: number } {
  const chunks = text.slice(0, position).split('\n')
  return { line: chunks.length, column: (chunks.at(-1)?.length ?? 0) + 1 }
}
function vertical(text: string, position: number, direction: 1 | -1): number {
  const start = lineStart(text, position)
  const column = position - start
  if (direction < 0) {
    if (!start) return position
    const end = start - 1
    const previousStart = lineStart(text, end)
    return previousStart === end ? previousStart : Math.min(previousStart + column, previousGrapheme(text, end))
  }
  const end = lineEnd(text, position)
  if (end === text.length) return position
  const next = end + 1
  const nextEnd = lineEnd(text, next)
  return next === nextEnd ? next : Math.min(next + column, previousGrapheme(text, nextEnd))
}

/** Move the active selection vertically, preserving its text column like Helix j/k. */
export function helixVerticalSelection(text: string, selection: EditorSelection, direction: 1 | -1, extend = false): EditorSelection {
  const forward = selection.head >= selection.anchor
  const active = forward && selection.head > selection.anchor ? previousGrapheme(text, selection.head) : selection.head
  const target = cursor(text, vertical(text, active, direction))
  if (!extend) return target
  return { anchor: selection.anchor, head: direction > 0 ? target.head : target.anchor }
}
export class ModalOwtEditor {
  mode: EditorMode = 'normal'
  selections: EditorSelection[] = [{ anchor: 0, head: 0 }]
  primary = 0
  pending = ''
  private count = ''
  private register = ''
  private undoStack: Snapshot[] = []
  private redoStack: Snapshot[] = []
  private insertStart?: Snapshot
  private pendingTimer?: number
  private composing = false

  constructor(readonly textarea: HTMLTextAreaElement, private readonly prompt: HTMLInputElement, private readonly hints: HTMLElement, private readonly callbacks: ModalEditorCallbacks) {
    textarea.addEventListener('keydown', (event) => this.keydown(event))
    textarea.addEventListener('input', () => this.nativeInput())
    textarea.addEventListener('compositionstart', () => { this.composing = true })
    textarea.addEventListener('compositionend', () => { this.composing = false; this.nativeInput() })
    textarea.addEventListener('mouseup', (event) => this.mouseSelection(event))
    textarea.addEventListener('copy', (event) => this.copy(event))
    textarea.addEventListener('paste', (event) => this.pasteEvent(event))
    prompt.addEventListener('keydown', (event) => this.promptKeydown(event))
    this.enterMode('normal')
  }

  get text(): string { return this.textarea.value }
  focus(): void { this.textarea.focus() }
  refresh(): void { this.render() }
  primaryRange(): { start: number; end: number } { return normalizedSelection(this.selections[this.primary] ?? { anchor: 0, head: 0 }) }
  setEditingMode(mode: 'normal' | 'raw'): void {
    this.mode = mode
    this.textarea.readOnly = mode !== 'raw'
    this.selections = [mode === 'raw'
      ? { anchor: this.textarea.selectionStart, head: this.textarea.selectionEnd }
      : this.eventSelectionAt(this.primaryRange().start)]
    this.primary = 0
    this.clearPending(); this.sync(); this.render()
  }
  selectRange(start: number, end: number, normal = false): void {
    this.selections = [{ anchor: Math.max(0, start), head: Math.min(this.text.length, Math.max(start, end)) }]
    this.primary = 0
    this.mode = this.mode === 'raw' ? 'raw' : normal ? 'normal' : 'select'
    this.textarea.readOnly = this.mode !== 'raw'
    this.sync(); this.render()
  }
  replaceTextRange(start: number, end: number, insert: string): void {
    this.commit([{ from: Math.max(0, start), to: Math.min(this.text.length, Math.max(start, end)), insert }], true)
    const insertedStart = Math.max(0, start)
    this.selectRange(insertedStart, insertedStart + insert.length)
  }
  deleteTextRange(start: number, end: number): void { this.replaceTextRange(start, end, '') }
  insertText(at: number, insert: string): void { this.replaceTextRange(at, at, insert) }
  setText(text: string, record = false): void {
    if (record) this.pushUndo()
    this.textarea.value = text; this.selections = [this.mode === 'raw' ? cursor(text, 0) : this.eventSelectionAt(0)]; this.primary = 0
    this.sync(); this.callbacks.onChange(text); this.render()
  }

  private snapshot(): Snapshot { return { text: this.text, selections: cloneSelections(this.selections), primary: this.primary } }
  private pushUndo(snapshot = this.snapshot()): void { this.undoStack.push(snapshot); if (this.undoStack.length > 300) this.undoStack.shift(); this.redoStack = [] }
  private restore(snapshot: Snapshot): void {
    this.textarea.value = snapshot.text; this.selections = cloneSelections(snapshot.selections); this.primary = Math.min(snapshot.primary, this.selections.length - 1)
    this.sync(); this.callbacks.onChange(this.text); this.render()
  }
  undo(): void { const value = this.undoStack.pop(); if (!value) return; this.redoStack.push(this.snapshot()); this.restore(value) }
  redo(): void { const value = this.redoStack.pop(); if (!value) return; this.undoStack.push(this.snapshot()); this.restore(value) }

  private commit(edits: TextEdit[], atEnd: boolean, record = true): void {
    if (!edits.length) return
    if (record) this.pushUndo()
    this.textarea.value = applyTextEdits(this.text, edits)
    this.selections = cursorsAfterEdits(edits, atEnd)
    this.primary = Math.min(this.primary, this.selections.length - 1)
    this.sync(); this.callbacks.onChange(this.text); this.render()
  }
  private enterMode(mode: EditorMode, insertStart?: Snapshot): void {
    if (this.mode === 'insert' && mode !== 'insert' && this.insertStart && this.insertStart.text !== this.text) this.pushUndo(this.insertStart)
    this.mode = mode; this.textarea.readOnly = mode !== 'insert'
    if (mode === 'insert') {
      this.insertStart = insertStart ?? this.snapshot()
      this.selections = this.selections.map((selection) => { const range = normalizedSelection(selection); return { anchor: range.start, head: range.start } })
    } else if (mode === 'normal') {
      this.insertStart = undefined
      this.selections = this.selections.map((selection) => this.eventSelectionAt(normalizedSelection(selection).start))
    }
    this.clearPending(); this.sync(); this.render()
  }
  private sync(): void {
    const selection = this.selections[this.primary] ?? { anchor: 0, head: 0 }
    const range = normalizedSelection(selection)
    this.textarea.setSelectionRange(range.start, range.end, selection.head < selection.anchor ? 'backward' : 'forward')
  }
  private render(): void {
    const position = lineColumn(this.text, this.primaryRange().start)
    this.callbacks.onRender({ mode: this.mode, selections: cloneSelections(this.selections), primary: this.primary, pending: this.pending, line: position.line, column: position.column })
  }
  applyEdits(edits: TextEdit[]): void {
    this.commit(edits, false)
    this.enterMode('normal')
  }

  private eventSelectionAt(position: number): EditorSelection {
    if (this.mode === 'raw') return cursor(this.text, position)
    const index = this.syntax()
    const event = index.events.find((item) => item.start <= position && item.end > position)
      ?? index.events.find((item) => item.start >= position)
      ?? index.events.at(-1)
    return event ? { anchor: event.start, head: event.end } : cursor(this.text, position)
  }

  private selectTracks(extend: boolean): void {
    const index = this.syntax()
    this.selections = this.selections.map((selection) => {
      const range = normalizedSelection(selection)
      const track = objectContaining(index, 'track', range.start, range.end) ?? nextObject(index, 'track', Math.max(-1, range.start - 1), 1)
      if (!track) return selection
      return extend ? { anchor: selection.anchor, head: track.end } : { anchor: track.start, head: track.end }
    })
    this.mode = 'select'; this.sync(); this.render()
  }
  private duplicateLine(direction: 1 | -1): void {
    const additions = this.selections.map((selection) => {
      const range = normalizedSelection(selection), target = vertical(this.text, range.start, direction), delta = target - range.start
      return { anchor: Math.max(0, selection.anchor + delta), head: Math.max(0, selection.head + delta) }
    })
    this.selections.push(...additions); this.primary = this.selections.length - 1; this.sync(); this.render()
  }
  private moveVertical(direction: 1 | -1): void {
    this.selections = this.selections.map((selection) => helixVerticalSelection(this.text, selection, direction, this.mode === 'select'))
    this.sync(); this.render()
  }

  private deleteSelections(change = false): void {
    const before = this.snapshot()
    this.register = this.selections.map((selection) => { const range = normalizedSelection(selection); return this.text.slice(range.start, range.end) }).join('\n')
    const edits = this.selections.map((selection) => { const range = normalizedSelection(selection); return { from: range.start, to: range.end, insert: '' } })
    this.commit(edits, false, !change)
    if (change) this.enterMode('insert', before)
    else this.enterMode('normal')
  }
  private insertAll(value: string): void {
    const edits = this.selections.map((selection) => { const range = normalizedSelection(selection); return { from: range.start, to: range.end, insert: value } })
    this.commit(edits, true, false)
  }
  private async yank(): Promise<void> {
    const value = this.selections.map((selection) => { const range = normalizedSelection(selection); return this.text.slice(range.start, range.end) }).join('\n')
    this.register = value; await navigator.clipboard?.writeText(value).catch(() => undefined)
  }
  private paste(after: boolean): void {
    void navigator.clipboard?.readText().catch(() => this.register).then((value) => {
      const insert = value || this.register; if (!insert) return
      const edits = this.selections.map((selection) => { const range = normalizedSelection(selection), at = after ? range.end : range.start; return { from: at, to: at, insert } })
      this.commit(edits, true); this.enterMode('normal')
    })
  }
  private replaceCharacter(value: string): void {
    const edits = this.selections.map((selection) => { const range = normalizedSelection(selection); return { from: range.start, to: range.end, insert: value } })
    this.commit(edits, true); this.enterMode('normal')
  }
  private openLine(direction: 1 | -1): void {
    const before = this.snapshot()
    const edits = this.selections.map((selection) => {
      const range = normalizedSelection(selection)
      const at = direction > 0 ? lineEnd(this.text, range.end) : lineStart(this.text, range.start)
      return { from: at, to: at, insert: '\n' }
    })
    this.commit(edits, true, false); this.enterMode('insert', before)
  }
  private indent(direction: 1 | -1): void {
    const lineStarts = [...new Set(this.selections.flatMap((selection) => {
      const range = normalizedSelection(selection), starts: number[] = []
      let at = lineStart(this.text, range.start); const end = lineEnd(this.text, range.end)
      while (at <= end) { starts.push(at); const next = this.text.indexOf('\n', at); if (next < 0) break; at = next + 1 }
      return starts
    }))]
    const edits = lineStarts.map((start) => direction > 0 ? { from: start, to: start, insert: '  ' } : { from: start, to: this.text.startsWith('  ', start) ? start + 2 : start, insert: '' })
    this.commit(edits, direction > 0)
  }
  private toggleComments(): void {
    const lineStarts = [...new Set(this.selections.map((selection) => lineStart(this.text, normalizedSelection(selection).start)))]
    const allCommented = lineStarts.every((start) => /^\s*#/.test(this.text.slice(start, lineEnd(this.text, start))))
    const edits = lineStarts.map((start) => {
      const line = this.text.slice(start, lineEnd(this.text, start)), indent = /^\s*/.exec(line)![0].length, at = start + indent
      return allCommented ? { from: at, to: this.text[at + 1] === ' ' ? at + 2 : at + 1, insert: '' } : { from: at, to: at, insert: '# ' }
    })
    this.commit(edits, !allCommented)
  }

  private syntax(): OwtSyntaxIndex { return this.callbacks.getSyntaxIndex?.() ?? buildOwtSyntaxIndex(this.text) }
  private semanticMove(kind: OwtObjectKind, direction: 1 | -1): void {
    const index = this.syntax()
    this.selections = this.selections.map((selection) => {
      const range = normalizedSelection(selection)
      const objects = objectsOfKind(index, kind).slice().sort((left, right) => left.start - right.start)
      const point = this.mode === 'select'
        ? Math.max(0, selection.head - (direction > 0 ? 1 : 0))
        : range.start
      const currentIndex = objects.findIndex((item) => item.start <= point && item.end > point)
      const object = currentIndex >= 0
        ? objects[(currentIndex + direction + objects.length) % objects.length]
        : nextObject(index, kind, point, direction)
      if (!object) return selection
      if (this.mode === 'select') return { anchor: selection.anchor, head: direction > 0 ? object.end : object.start }
      return { anchor: object.start, head: object.end }
    })
    this.sync(); this.render()
  }

  private semanticBoundary(scope: 'document' | 'track', atEnd: boolean): void {
    const index = this.syntax()
    const current = this.primaryRange()
    const track = scope === 'track' ? objectContaining(index, 'track', current.start, current.end) : undefined
    const events = track ? index.events.filter((event) => event.start >= track.start && event.end <= track.end) : index.events
    const object = atEnd ? events.at(-1) : events[0]
    if (!object) return
    this.selections = [{ anchor: object.start, head: object.end }]
    this.primary = 0; this.sync(); this.render()
  }
  private selectObjects(kind: OwtObjectKind, all: boolean): void {
    const index = this.syntax(), current = this.primaryRange()
    const values = objectsOfKind(index, kind)
    if (all) this.selections = values.map((value) => ({ anchor: value.start, head: value.end }))
    else {
      const value = values.find((item) => item.start <= current.start && item.end >= current.end) ?? nextObject(index, kind, current.start, 1)
      if (value) this.selections = [{ anchor: value.start, head: value.end }]
    }
    if (this.selections.length) { this.primary = 0; this.mode = 'select'; this.sync(); this.render() }
  }
  private samePitch(): void {
    const index = this.syntax(), current = this.primaryRange()
    const pitch = index.pitches.find((item) => item.start <= current.start && item.end >= current.start); if (!pitch?.value) return
    this.selections = index.pitches.filter((item) => item.value?.toLowerCase() === pitch.value!.toLowerCase()).map((item) => ({ anchor: item.start, head: item.end }))
    this.primary = 0; this.mode = 'select'; this.sync(); this.render()
  }
  private expand(): void { const index = this.syntax(); this.selections = this.selections.map((selection) => { const r = normalizedSelection(selection), p = syntaxParent(index, r.start, r.end); return { anchor: p.start, head: p.end } }); this.mode = 'select'; this.sync(); this.render() }
  private shrink(): void { const index = this.syntax(); this.selections = this.selections.map((selection) => { const r = normalizedSelection(selection), c = syntaxChild(index, r.start, r.end); return c ? { anchor: c.start, head: c.end } : selection }); this.sync(); this.render() }

  private setPending(value: string): void {
    this.pending = value; window.clearTimeout(this.pendingTimer); this.pendingTimer = window.setTimeout(() => this.clearPending(), 1500)
    this.hints.hidden = false; this.render()
  }
  private clearPending(): void { this.pending = ''; window.clearTimeout(this.pendingTimer); this.hints.hidden = true; this.render() }
  private promptOpen(): void {
    this.mode = 'command'; this.prompt.hidden = false
    this.prompt.value = ':'
    this.prompt.focus(); this.prompt.setSelectionRange(this.prompt.value.length, this.prompt.value.length); this.render()
  }
  private promptClose(): void { this.prompt.hidden = true; this.prompt.value = ''; this.textarea.focus(); this.enterMode('normal') }
  private promptKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') { event.preventDefault(); this.promptClose(); return }
    if (event.key !== 'Enter') return
    event.preventDefault(); const value = this.prompt.value.slice(1).trim()
    this.commandLine(value)
    this.promptClose()
  }
  private commandLine(value: string): void {
    const [command, ...args] = value.split(/\s+/); if (!command) return
    if (command === 'goto') {
      const wanted = Math.max(1, Number(args[0]) || 1), starts = [0]
      for (let index = 0; index < this.text.length; index++) if (this.text[index] === '\n') starts.push(index + 1)
      this.selections = [cursor(this.text, starts[wanted - 1] ?? Math.max(0, this.text.length - 1))]; return
    }
    void this.callbacks.onCommand(command, args.join(' '))
  }
  private copy(event: ClipboardEvent): void {
    if (this.mode === 'raw') return
    const value = this.selections.map((selection) => { const range = normalizedSelection(selection); return this.text.slice(range.start, range.end) }).join('\n')
    if (!value) return; event.preventDefault(); event.clipboardData?.setData('text/plain', value); this.register = value
  }
  private pasteEvent(event: ClipboardEvent): void {
    if (this.mode === 'raw') return
    if (this.mode !== 'insert' || this.selections.length === 1) return
    event.preventDefault(); const value = event.clipboardData?.getData('text/plain') ?? ''; if (value) this.insertAll(value)
  }
  private nativeInput(): void {
    if (this.mode === 'raw') {
      this.selections = [{ anchor: this.textarea.selectionStart, head: this.textarea.selectionEnd }]
      this.callbacks.onChange(this.text); this.render(); return
    }
    if (this.mode !== 'insert' || this.selections.length !== 1) return
    this.selections = [{ anchor: this.textarea.selectionStart, head: this.textarea.selectionEnd }]; this.callbacks.onChange(this.text); this.render()
  }
  private mouseSelection(event: MouseEvent): void {
    const start = this.textarea.selectionStart, end = this.textarea.selectionEnd
    if (this.mode === 'raw') {
      this.selections = [{ anchor: start, head: end }]; this.primary = 0; this.render(); return
    }
    const clickCount = Math.max(1, Math.min(3, event.detail || 1))
    const level = selectionLevelForClickCount(clickCount)
    const range = semanticRangeFromNativeSelection(this.syntax(), level, start, end)
    if (!range) return
    const backward = this.textarea.selectionDirection === 'backward'
    const selection = backward ? { anchor: range.end, head: range.start } : { anchor: range.start, head: range.end }
    if (event.altKey) { this.selections.push(selection); this.primary = this.selections.length - 1 } else { this.selections = [selection]; this.primary = 0 }
    const oneEvent = level === 'event' && this.syntax().events.some((object) => object.start === range.start && object.end === range.end)
    this.mode = oneEvent && start === end ? 'normal' : 'select'
    this.sync(); this.render()
  }

  private pendingKey(key: string): boolean {
    const prefix = this.pending
    if (prefix === 'replace') { if (key.length === 1) this.replaceCharacter(key); this.clearPending(); return true }
    if (prefix === 'g') {
      if (key === 'g') this.semanticBoundary('document', false)
      else if (key === 'e') this.semanticBoundary('document', true)
      else if (key === 'h') this.semanticBoundary('track', false)
      else if (key === 'l') this.semanticBoundary('track', true)
      this.clearPending(); return true
    }
    if (prefix === ']' || prefix === '[') { const map: Record<string, OwtObjectKind> = { n: 'note', r: 'rest', b: 'measure', t: 'track', d: 'directive', e: 'diagnostic' }; if (map[key]) this.semanticMove(map[key]!, prefix === ']' ? 1 : -1); this.clearPending(); return true }
    if (prefix === 'space') {
      if (key === 'x') { this.setPending('space-x'); return true }
      if (key === 'm') { this.setPending('space-mode'); return true }
      if (key === 'g') { this.setPending('space-view'); return true }
      if (key === 'a') { this.setPending('space-action'); return true }
      if (key === 'l') { this.setPending('space-example'); return true }
      if (key === 't') { this.setPending('space-timeline'); return true }
      if (key === 'z') { this.setPending('space-ai'); return true }
      if (key === 'b') { this.setPending('space-workspace'); return true }
      const map: Record<string, string> = { p: 'play-pause', P: 'play-from-cursor', r: 'play-selection', s: 'return-to-start', w: 'save', o: 'open', n: 'new', v: 'validate', f: 'format', e: 'export-midi', i: 'import-midi', d: 'diagnostics', q: 'perform', '?': 'help' }
      if (map[key]) void this.callbacks.onCommand(map[key]!); this.clearPending(); return true
    }
    if (prefix === 'space-x') {
      const one: Record<string, OwtObjectKind> = { n: 'note', p: 'pitch', d: 'duration', b: 'measure', t: 'track', a: 'document' }, all: Record<string, OwtObjectKind> = { N: 'note', R: 'rest', D: 'duration', B: 'measure', E: 'diagnostic' }
      if (key === 'P') this.samePitch(); else if (one[key]) this.selectObjects(one[key]!, false); else if (all[key]) this.selectObjects(all[key]!, true)
      this.clearPending(); return true
    }
    if (prefix === 'space-mode') {
      const map: Record<string, string> = { s: 'mode-score', r: 'mode-raw' }
      if (map[key]) void this.callbacks.onCommand(map[key]!)
      this.clearPending(); return true
    }
    if (prefix === 'space-view') {
      const map: Record<string, string> = { o: 'view-owt', t: 'view-timeline', s: 'view-staff', j: 'view-jianpu', n: 'view-next' }
      if (map[key]) void this.callbacks.onCommand(map[key]!)
      this.clearPending(); return true
    }
    if (prefix === 'space-action') {
      const map: Record<string, string> = { p: 'replace-by-playing' }
      if (map[key]) void this.callbacks.onCommand(map[key]!)
      this.clearPending(); return true
    }
    if (prefix === 'space-example') {
      if (key === 'p') void this.callbacks.onCommand('play-example')
      this.clearPending(); return true
    }
    if (prefix === 'space-timeline') {
      const map: Record<string, string> = { r: 'timeline-restart', l: 'loop', e: 'timeline-export', c: 'timeline-clear', p: 'timeline-replace', f: 'timeline-finish' }
      if (map[key]) void this.callbacks.onCommand(map[key]!)
      this.clearPending(); return true
    }
    if (prefix === 'space-ai') {
      const map: Record<string, string> = { s: 'ai-settings', c: 'ai-compose', i: 'improv', l: 'toggle-locale', h: 'toggle-theme' }
      if (map[key]) void this.callbacks.onCommand(map[key]!)
      this.clearPending(); return true
    }
    if (prefix === 'space-workspace') {
      const map: Record<string, string> = { s: 'workspace-studio', c: 'workspace-settings' }
      if (map[key]) void this.callbacks.onCommand(map[key]!)
      this.clearPending(); return true
    }
    return false
  }

  private keydown(event: KeyboardEvent): void {
    if (this.composing || event.isComposing) return
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void this.callbacks.onCommand('save'); return }
    if (this.mode === 'raw') return
    if (this.mode === 'insert') {
      if (event.key === 'Escape') { event.preventDefault(); this.enterMode('normal') }
      else if (this.selections.length > 1 && !event.ctrlKey && !event.metaKey && !event.altKey && event.key.length === 1) { event.preventDefault(); this.insertAll(event.key) }
      else if (this.selections.length > 1 && event.key === 'Backspace') {
        event.preventDefault(); const edits = this.selections.map((selection) => { const range = normalizedSelection(selection); return { from: range.start === range.end ? previousGrapheme(this.text, range.start) : range.start, to: range.end, insert: '' } }); this.commit(edits, false, false)
      }
      return
    }
    if (event.ctrlKey || event.metaKey) {
      if (event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? this.redo() : this.undo() }
      else if (event.key === '/') { event.preventDefault(); this.toggleComments() }
      return
    }
    if (event.altKey) {
      if (event.key === 'o' || event.key === 'O' || event.key === 'ArrowUp') { event.preventDefault(); this.expand() }
      else if (event.key === 'i' || event.key === 'ArrowDown') { event.preventDefault(); this.shrink() }
      else if (event.key === 'c') { event.preventDefault(); this.duplicateLine(-1) }
      else if (event.key === ',') { event.preventDefault(); if (this.selections.length > 1) this.selections.splice(this.primary, 1); this.primary = Math.max(0, Math.min(this.primary, this.selections.length - 1)); this.sync(); this.render() }
      return
    }
    event.preventDefault()
    if (this.pending && this.pendingKey(event.key)) return
    if (/^[1-9]$/.test(event.key) || (this.count && event.key === '0')) { this.count += event.key; this.render(); return }
    const repeat = Math.max(1, Number(this.count) || 1); this.count = ''
    if (event.key === 'j' || event.key === 'ArrowDown' || event.key === 'k' || event.key === 'ArrowUp') {
      const direction = event.key === 'j' || event.key === 'ArrowDown' ? 1 : -1
      for (let index = 0; index < repeat; index++) this.moveVertical(direction)
      return
    }
    const semanticMotion = owtSemanticMotion(event.key)
    if (semanticMotion) {
      for (let index = 0; index < repeat; index++) this.semanticMove(semanticMotion.kind, semanticMotion.direction)
      return
    }
    switch (event.key) {
      case 'Escape': this.enterMode('normal'); break
      case 'Home': this.semanticBoundary('track', false); break
      case 'End': this.semanticBoundary('track', true); break
      case 'g': this.setPending('g'); break
      case ']': this.setPending(']'); break
      case '[': this.setPending('['); break
      case ' ': this.setPending('space'); break
      case 'r': this.setPending('replace'); break
      case 'v': this.mode = this.mode === 'select' ? 'normal' : 'select'; this.textarea.readOnly = true; this.render(); break
      case 'i': this.enterMode('insert'); break
      case 'a': this.selections = this.selections.map((selection) => { const at = normalizedSelection(selection).end; return { anchor: at, head: at } }); this.enterMode('insert'); break
      case 'I': this.selections = this.selections.map((selection) => { const at = lineStart(this.text, normalizedSelection(selection).start); return { anchor: at, head: at } }); this.enterMode('insert'); break
      case 'A': this.selections = this.selections.map((selection) => { const at = lineEnd(this.text, normalizedSelection(selection).end); return { anchor: at, head: at } }); this.enterMode('insert'); break
      case 'o': this.openLine(1); break
      case 'O': this.openLine(-1); break
      case 'd': void this.callbacks.onCommand('delete-object'); break
      case 'c': this.deleteSelections(true); break
      case 'y': void this.yank(); break
      case 'p': this.paste(true); break
      case 'P': this.paste(false); break
      case 'u': this.undo(); break
      case 'U': this.redo(); break
      case '>': this.indent(1); break
      case '<': this.indent(-1); break
      case 'x': this.selectTracks(this.mode === 'select'); break
      case 'X': this.selectTracks(true); break
      case '%': this.selections = [{ anchor: 0, head: this.text.length }]; this.mode = 'select'; this.sync(); this.render(); break
      case ';': this.enterMode('normal'); break
      case ',': this.selections = [this.selections[this.primary]!]; this.primary = 0; this.sync(); this.render(); break
      case 'C': this.duplicateLine(1); break
      case ':': this.promptOpen(); break
    }
  }
}
