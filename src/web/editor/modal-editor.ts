import { buildOwtSyntaxIndex, nextObject, objectsOfKind, syntaxChild, syntaxParent, type OwtObjectKind, type OwtSyntaxIndex } from './owt-objects.ts'

export type EditorMode = 'normal' | 'insert' | 'select' | 'command' | 'semantic' | 'raw'
export type PromptKind = 'command' | 'search-forward' | 'search-backward' | 'select-regex'
export type EditorInteractionMode = 'helix' | 'semantic' | 'raw'

export interface EditorSelection { anchor: number; head: number }
export interface TextEdit { from: number; to: number; insert: string }
export interface ModalEditorViewState {
  mode: EditorMode
  selections: EditorSelection[]
  primary: number
  pending: string
  line: number
  column: number
  searchRanges: Array<{ start: number; end: number }>
}
export interface ModalEditorCallbacks {
  onChange: (text: string) => void
  onRender: (state: ModalEditorViewState) => void
  onCommand: (command: string, args?: string) => void | Promise<void>
  getSyntaxIndex?: () => OwtSyntaxIndex
}
interface Snapshot { text: string; selections: EditorSelection[]; primary: number }

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const words = new Intl.Segmenter(undefined, { granularity: 'word' })

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
    return Math.min(lineStart(text, end) + column, end)
  }
  const end = lineEnd(text, position)
  if (end === text.length) return position
  const next = end + 1
  return Math.min(next + column, lineEnd(text, next))
}
function wordPosition(text: string, position: number, kind: 'next' | 'previous' | 'end'): number {
  const items = [...words.segment(text)].filter((part) => part.isWordLike)
  if (kind === 'next') return items.find((part) => part.index > position)?.index ?? text.length
  if (kind === 'previous') return items.slice().reverse().find((part) => part.index < position)?.index ?? 0
  const item = items.find((part) => part.index + part.segment.length > position) ?? items.find((part) => part.index > position)
  return item ? item.index + item.segment.length : text.length
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
  private promptKind: PromptKind = 'command'
  private lastSearchDirection: 1 | -1 = 1
  private searchRanges: Array<{ start: number; end: number }> = []
  private composing = false
  private interactionMode: EditorInteractionMode = 'helix'

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
  setInteractionMode(mode: EditorInteractionMode): void {
    this.interactionMode = mode
    this.mode = mode === 'raw' ? 'raw' : mode === 'semantic' ? 'semantic' : 'normal'
    this.textarea.readOnly = mode !== 'raw'
    this.selections = [mode === 'raw'
      ? { anchor: this.textarea.selectionStart, head: this.textarea.selectionEnd }
      : cursor(this.text, this.primaryRange().start)]
    this.primary = 0
    this.clearPending(); this.sync(); this.render()
  }
  selectRange(start: number, end: number): void {
    this.selections = [{ anchor: Math.max(0, start), head: Math.min(this.text.length, Math.max(start, end)) }]
    this.primary = 0
    this.mode = this.interactionMode === 'semantic' ? 'semantic' : 'select'
    this.textarea.readOnly = this.interactionMode !== 'raw'
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
    this.textarea.value = text; this.selections = [cursor(text, 0)]; this.primary = 0; this.searchRanges = []
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
      this.selections = this.selections.map((selection) => cursor(this.text, normalizedSelection(selection).start))
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
    this.callbacks.onRender({ mode: this.mode, selections: cloneSelections(this.selections), primary: this.primary, pending: this.pending, line: position.line, column: position.column, searchRanges: this.searchRanges.slice() })
  }

  private target(kind: string, position: number): number {
    switch (kind) {
      case 'left': return previousGrapheme(this.text, position)
      case 'right': return nextGrapheme(this.text, position)
      case 'up': return vertical(this.text, position, -1)
      case 'down': return vertical(this.text, position, 1)
      case 'word-next': return wordPosition(this.text, position, 'next')
      case 'word-prev': return wordPosition(this.text, position, 'previous')
      case 'word-end': return wordPosition(this.text, position, 'end')
      case 'line-start': return lineStart(this.text, position)
      case 'line-end': return lineEnd(this.text, position)
      case 'file-start': return 0
      case 'file-end': return Math.max(0, this.text.length - 1)
      default: return position
    }
  }
  private move(kind: string): void {
    this.selections = this.selections.map((selection) => {
      const range = normalizedSelection(selection)
      const position = this.mode === 'select' ? selection.head : range.start
      const target = this.target(kind, position)
      return this.mode === 'select' ? { anchor: selection.anchor, head: target } : cursor(this.text, target)
    })
    this.sync(); this.render()
  }
  private selectLines(extend: boolean): void {
    this.selections = this.selections.map((selection) => {
      const range = normalizedSelection(selection), start = lineStart(this.text, range.start), end = Math.min(this.text.length, lineEnd(this.text, range.end) + 1)
      return extend ? { anchor: selection.anchor, head: end } : { anchor: start, head: end }
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
    this.selections = this.selections.map((selection) => { const object = nextObject(index, kind, normalizedSelection(selection).start, direction); return object ? { anchor: object.start, head: object.end } : selection })
    this.sync(); this.render()
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
  private promptOpen(kind: PromptKind): void {
    this.promptKind = kind; this.mode = 'command'; this.prompt.hidden = false
    this.prompt.value = kind === 'command' ? ':' : kind === 'search-backward' ? '?' : '/'
    this.prompt.focus(); this.prompt.setSelectionRange(this.prompt.value.length, this.prompt.value.length); this.render()
  }
  private promptClose(): void { this.prompt.hidden = true; this.prompt.value = ''; this.textarea.focus(); this.enterMode('normal') }
  private promptKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') { event.preventDefault(); this.promptClose(); return }
    if (event.key !== 'Enter') return
    event.preventDefault(); const value = this.prompt.value.slice(1).trim()
    if (this.promptKind === 'command') this.commandLine(value)
    else if (this.promptKind === 'select-regex') this.selectRegex(value)
    else this.search(value, this.promptKind === 'search-forward' ? 1 : -1)
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
  private search(query: string, direction: 1 | -1): void {
    if (!query) return; this.lastSearchDirection = direction; this.searchRanges = []
    try { const regex = new RegExp(query, 'giu'); for (const match of this.text.matchAll(regex)) if (match[0].length) this.searchRanges.push({ start: match.index!, end: match.index! + match[0].length }) }
    catch { let at = 0; const source = this.text.toLowerCase(), wanted = query.toLowerCase(); while ((at = source.indexOf(wanted, at)) >= 0) { this.searchRanges.push({ start: at, end: at + query.length }); at += Math.max(1, query.length) } }
    this.searchNext(direction)
  }
  private searchNext(direction = this.lastSearchDirection): void {
    if (!this.searchRanges.length) return; const position = this.primaryRange().start
    const range = direction > 0 ? this.searchRanges.find((item) => item.start > position) ?? this.searchRanges[0] : this.searchRanges.slice().reverse().find((item) => item.start < position) ?? this.searchRanges.at(-1)
    if (range) this.selections = [{ anchor: range.start, head: range.end }]; this.primary = 0; this.sync(); this.render()
  }
  private selectRegex(query: string): void {
    if (!query) return; const output: EditorSelection[] = []
    try { const regex = new RegExp(query, 'gu'); for (const selection of this.selections) { const range = normalizedSelection(selection); for (const match of this.text.slice(range.start, range.end).matchAll(regex)) if (match[0].length) output.push({ anchor: range.start + match.index!, head: range.start + match.index! + match[0].length }) } } catch { return }
    if (output.length) { this.selections = output; this.primary = 0; this.mode = 'select'; this.sync(); this.render() }
  }

  private copy(event: ClipboardEvent): void {
    if (this.interactionMode === 'raw') return
    const value = this.selections.map((selection) => { const range = normalizedSelection(selection); return this.text.slice(range.start, range.end) }).join('\n')
    if (!value) return; event.preventDefault(); event.clipboardData?.setData('text/plain', value); this.register = value
  }
  private pasteEvent(event: ClipboardEvent): void {
    if (this.interactionMode === 'raw') return
    if (this.mode !== 'insert' || this.selections.length === 1) return
    event.preventDefault(); const value = event.clipboardData?.getData('text/plain') ?? ''; if (value) this.insertAll(value)
  }
  private nativeInput(): void {
    if (this.interactionMode === 'raw') {
      this.selections = [{ anchor: this.textarea.selectionStart, head: this.textarea.selectionEnd }]
      this.callbacks.onChange(this.text); this.render(); return
    }
    if (this.mode !== 'insert' || this.selections.length !== 1) return
    this.selections = [{ anchor: this.textarea.selectionStart, head: this.textarea.selectionEnd }]; this.callbacks.onChange(this.text); this.render()
  }
  private mouseSelection(event: MouseEvent): void {
    const start = this.textarea.selectionStart, end = this.textarea.selectionEnd
    if (this.interactionMode === 'raw') {
      this.selections = [{ anchor: start, head: end }]; this.primary = 0; this.render(); return
    }
    const selection = start === end && this.mode !== 'insert' ? cursor(this.text, start) : { anchor: start, head: end }
    if (event.altKey) { this.selections.push(selection); this.primary = this.selections.length - 1 } else { this.selections = [selection]; this.primary = 0 }
    if (start !== end && this.mode === 'normal') this.mode = 'select'; this.sync(); this.render()
  }

  private pendingKey(key: string): boolean {
    const prefix = this.pending
    if (prefix === 'replace') { if (key.length === 1) this.replaceCharacter(key); this.clearPending(); return true }
    if (prefix === 'g') { const map: Record<string, string> = { g: 'file-start', e: 'file-end', h: 'line-start', l: 'line-end' }; if (map[key]) this.move(map[key]!); this.clearPending(); return true }
    if (prefix === ']' || prefix === '[') { const map: Record<string, OwtObjectKind> = { n: 'note', r: 'rest', b: 'measure', t: 'track', d: 'directive', e: 'diagnostic' }; if (map[key]) this.semanticMove(map[key]!, prefix === ']' ? 1 : -1); this.clearPending(); return true }
    if (prefix === 'space') {
      if (key === 'x') { this.setPending('space-x'); return true }
      const map: Record<string, string> = { p: 'play-pause', P: 'play-from-cursor', r: 'play-selection', s: 'stop', w: 'save', o: 'open', n: 'new', v: 'validate', f: 'format', e: 'export-midi', i: 'import-midi', d: 'diagnostics', q: 'perform', '?': 'help' }
      if (map[key]) void this.callbacks.onCommand(map[key]!); this.clearPending(); return true
    }
    if (prefix === 'space-x') {
      const one: Record<string, OwtObjectKind> = { n: 'note', p: 'pitch', d: 'duration', b: 'measure', t: 'track', a: 'document' }, all: Record<string, OwtObjectKind> = { N: 'note', R: 'rest', D: 'duration', B: 'measure', E: 'diagnostic' }
      if (key === 'P') this.samePitch(); else if (one[key]) this.selectObjects(one[key]!, false); else if (all[key]) this.selectObjects(all[key]!, true)
      this.clearPending(); return true
    }
    return false
  }

  private keydown(event: KeyboardEvent): void {
    if (this.composing || event.isComposing) return
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void this.callbacks.onCommand('save'); return }
    if (this.interactionMode === 'raw') return
    if (this.interactionMode === 'semantic') {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? this.redo() : this.undo() }
      else if (!(event.ctrlKey || event.metaKey) || !['c', 'a'].includes(event.key.toLowerCase())) event.preventDefault()
      return
    }
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
      if (event.key === 'o' || event.key === 'ArrowUp') { event.preventDefault(); this.expand() }
      else if (event.key === 'i' || event.key === 'ArrowDown') { event.preventDefault(); this.shrink() }
      else if (event.key === 'c') { event.preventDefault(); this.duplicateLine(-1) }
      else if (event.key === ',') { event.preventDefault(); if (this.selections.length > 1) this.selections.splice(this.primary, 1); this.primary = Math.max(0, Math.min(this.primary, this.selections.length - 1)); this.sync(); this.render() }
      return
    }
    event.preventDefault()
    if (this.pending && this.pendingKey(event.key)) return
    if (/^[1-9]$/.test(event.key) || (this.count && event.key === '0')) { this.count += event.key; this.render(); return }
    const repeat = Math.max(1, Number(this.count) || 1); this.count = ''
    const move = (kind: string) => { for (let index = 0; index < repeat; index++) this.move(kind) }
    switch (event.key) {
      case 'Escape': this.enterMode('normal'); break
      case 'h': case 'ArrowLeft': move('left'); break
      case 'j': case 'ArrowDown': move('down'); break
      case 'k': case 'ArrowUp': move('up'); break
      case 'l': case 'ArrowRight': move('right'); break
      case 'w': move('word-next'); break
      case 'b': move('word-prev'); break
      case 'e': move('word-end'); break
      case 'Home': move('line-start'); break
      case 'End': move('line-end'); break
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
      case 'd': this.deleteSelections(); break
      case 'c': this.deleteSelections(true); break
      case 'y': void this.yank(); break
      case 'p': this.paste(true); break
      case 'P': this.paste(false); break
      case 'u': this.undo(); break
      case 'U': this.redo(); break
      case '>': this.indent(1); break
      case '<': this.indent(-1); break
      case 'x': this.selectLines(this.mode === 'select'); break
      case 'X': this.selectLines(true); break
      case '%': this.selections = [{ anchor: 0, head: this.text.length }]; this.mode = 'select'; this.sync(); this.render(); break
      case ';': this.selections = this.selections.map((selection) => cursor(this.text, normalizedSelection(selection).start)); this.mode = 'normal'; this.sync(); this.render(); break
      case ',': this.selections = [this.selections[this.primary]!]; this.primary = 0; this.sync(); this.render(); break
      case 'C': this.duplicateLine(1); break
      case '/': this.promptOpen('search-forward'); break
      case '?': this.promptOpen('search-backward'); break
      case 'n': this.searchNext(); break
      case 'N': this.searchNext(this.lastSearchDirection === 1 ? -1 : 1); break
      case 's': this.promptOpen('select-regex'); break
      case ':': this.promptOpen('command'); break
    }
  }
}
