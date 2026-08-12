/**
 * OpusWeave browser app — orchestrates the engine, WebMIDI manager,
 * recorder, mapping engine and MIDI learn. No layer reaches into
 * spessasynth classes directly (the engine wraps them).
 */
import { SpessaSynthEngine } from '../audio/spessa-synth-engine.ts'
import { selectAudioOutputDevice, type AudioOutputDevice, type SavedAudioOutput } from '../audio/audio-output.ts'
import { WebMidiManager, type MidiManagerState } from '../midi/web-midi-manager.ts'
import { MidiRecorder, type RecordedTake } from '../domain/midi/midi-recorder.ts'
import { applyTrackMutes, createMidiTempoMap, importMidi, inspectMidi, type MidiInspection } from '../domain/midi/midi-import.ts'
import { getArrangementNotes, replaceArrangementRange } from '../domain/midi/midi-arrangement.ts'
import { MappingEngine, noteName, type BuiltinComputerLayoutId, type ComputerKeyAssignment } from '../domain/devices/mapping-engine.ts'
import { MidiLearn } from '../domain/midi-learn.ts'
import { findProfileForPort, overrideControl, type DeviceProfile } from '../domain/devices/device-profile.ts'
import { midiplusTinyPlusProfile } from '../domain/devices/midiplus-tiny-plus.ts'
import { VirtualKeyboard } from './components/virtual-keyboard.ts'
import { enableHorizontalPointerScroll } from './components/horizontal-pointer-scroll.ts'
import type { BasicMIDI } from 'spessasynth_core'
import { getLocale, resolveLocale, setLocale, t, translateDocument, type TranslationValues } from './i18n.ts'
import { compileScoreText, extractMelodyFromMidi, extractMelodyFromRecording, type MelodyExtractionResult, type MelodyVoiceStrategy } from '../domain/owt/integration.ts'
import { parseOwt } from '../domain/owt/parser.ts'
import { parseRational, rational } from '../domain/owt/rational.ts'
import { serializeOwt } from '../domain/owt/serializer.ts'
import type { OwtDocument } from '../domain/owt/ast.ts'
import { activeOwtPlaybackIds, activeOwtSourceRanges, buildOwtPlaybackMap, cursorOwtPlaybackTokens, playbackStartForSourceRanges, type OwtPlaybackToken, type OwtSourceRange } from '../domain/owt/playback-map.ts'
import { owtLexicalRanges, renderOwtHighlight, type OwtDecoration, type OwtLexicalRange } from './components/owt-highlighter.ts'
import { ModalOwtEditor, normalizedSelection, owtMotionDestinations, type ModalEditorViewState, type OwtMotionDestination } from './editor/modal-editor.ts'
import { buildOwtSyntaxIndex, objectContaining, replaceOwtEventPitch, semanticDeletionEdits, type OwtTextObject } from './editor/owt-objects.ts'
import { buildPracticePrompts, PracticeSession } from '../domain/owt/practice-session.ts'
import { BUILTIN_OWT_EXAMPLES, builtinOwtExample } from '../domain/owt/builtin-examples.ts'
import { buildScoreViewModel } from '../domain/owt/score-views.ts'
import { renderJianpuScore, renderStaffScore } from './components/score-views.ts'
import { buildManualOwtPrompt, createOwtWithAi, DEFAULT_OWT_AI_CONFIG, DEFAULT_OWT_AI_PROMPT_TEMPLATES, hasConfiguredAiApi, testOwtAiConnection, type OwtAiConfig, type OwtAiPromptTemplates, type OwtAiRequest } from '../domain/ai/owt-ai.ts'
import { discoverAiModels, type AiProtocol } from '../domain/ai/providers.ts'
import { ConversationalImprovSession } from '../domain/ai/conversational-improv.ts'
import { mediaFileToAiAttachments } from './ai-media.ts'
import { scoreFileKind } from './open-file.ts'
import { nextThemePreference, normalizeThemePreference, resolveTheme, type ThemePreference } from './theme.ts'
import { decodeOwtHash, encodeOwtHash } from './owt-url-state.ts'
import builtInGmSoundFontUrl from './assets/opusweave-micro-gm.sf2' with { type: 'file' }
import freePianoSoundFontUrl from './assets/freepiano-mda-piano.sf2' with { type: 'file' }

// ─── DOM helpers ─────────────────────────────────────────────────────────────

function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id)
  if (!el) throw new Error(`Element #${id} not found`)
  return el as unknown as T
}

function setStatus(id: string, msg: string, kind: 'ok' | 'warn' | 'err' | '' = ''): void {
  const el = $<HTMLElement>(id)
  el.hidden = false
  delete el.dataset.statusKey
  delete el.dataset.statusValues
  el.textContent = msg
  el.className = `status${kind ? ` ${kind}` : ''}`
}

function setTranslatedStatus(
  id: string,
  key: string,
  values: TranslationValues = {},
  kind: 'ok' | 'warn' | 'err' | '' = '',
): void {
  const el = $<HTMLElement>(id)
  el.hidden = false
  el.dataset.statusKey = key
  el.dataset.statusValues = JSON.stringify(values)
  el.textContent = t(key, values)
  el.className = `status${kind ? ` ${kind}` : ''}`
}

function clearStatus(id: string): void {
  const el = $<HTMLElement>(id)
  el.hidden = true
  el.textContent = ''
  delete el.dataset.statusKey
  delete el.dataset.statusValues
}

function setTranslatedText(id: string, key: string, values: TranslationValues = {}): void {
  const el = $<HTMLElement>(id)
  el.dataset.textKey = key
  el.dataset.textValues = JSON.stringify(values)
  el.textContent = t(key, values)
}

function retranslateTrackedCopy(): void {
  for (const el of document.querySelectorAll<HTMLElement>('[data-status-key]')) {
    const values = JSON.parse(el.dataset.statusValues ?? '{}') as TranslationValues
    el.textContent = t(el.dataset.statusKey!, values)
  }
  for (const el of document.querySelectorAll<HTMLElement>('[data-text-key]')) {
    const values = JSON.parse(el.dataset.textValues ?? '{}') as TranslationValues
    el.textContent = t(el.dataset.textKey!, values)
  }
}

function showError(msg: string): void {
  const box = $<HTMLDivElement>('st-error')
  box.textContent = msg
  box.hidden = false
}

const localeButton = $<HTMLButtonElement>('language-toggle')
const themeButton = $<HTMLButtonElement>('theme-toggle')
const systemTheme = window.matchMedia('(prefers-color-scheme: dark)')
let themePreference: ThemePreference = normalizeThemePreference(window.localStorage.getItem('opusweave.theme'))
const initialLocale = resolveLocale(window.localStorage.getItem('opusweave.locale') ?? navigator.language)
setLocale(initialLocale)
renderThemePreference()
translateDocument()
retranslateTrackedCopy()
updateLanguageToggleCopy()

function updateLanguageToggleCopy(): void {
  const key = document.documentElement.lang === 'en'
    ? 'language.switchToChinese'
    : 'language.switchToEnglish'
  localeButton.title = t(key)
  localeButton.setAttribute('aria-label', t(key))
}

function renderThemePreference(): void {
  const effectiveTheme = resolveTheme(themePreference, systemTheme.matches)
  document.documentElement.dataset.theme = themePreference
  document.documentElement.dataset.effectiveTheme = effectiveTheme
  document.documentElement.style.colorScheme = effectiveTheme
  themeButton.dataset.themeState = themePreference
  themeButton.title = t(`theme.${themePreference}`)
  themeButton.setAttribute('aria-label', t(`theme.${themePreference}`))
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute(
    'content',
    effectiveTheme === 'dark' ? '#0b0c10' : '#f4f5ef',
  )
}

themeButton.addEventListener('click', () => {
  themePreference = nextThemePreference(themePreference)
  window.localStorage.setItem('opusweave.theme', themePreference)
  renderThemePreference()
})

systemTheme.addEventListener('change', () => {
  if (themePreference === 'system') renderThemePreference()
})

localeButton.addEventListener('click', () => {
  const locale = document.documentElement.lang === 'en' ? 'zh-CN' : 'en'
  setLocale(locale)
  window.localStorage.setItem('opusweave.locale', locale)
  translateDocument()
  retranslateTrackedCopy()
  renderMidiState(midiManager.getState())
  renderArrangement()
  renderLearnBindings()
  populatePresets()
  void refreshAudioOutputs(false)
  renderComputerKeyMap()
  updateComputerMapToggleCopy()
  modalEditor.refresh()
  if (practiceSession) renderPracticeGuide()
  updateConversationalImprovUi()
  renderAiComposeButton()
  if (activeScoreView === 'staff' || activeScoreView === 'jianpu') renderNotationViews()
  updateLanguageToggleCopy()
  renderThemePreference()
})

const workspaceTabs = [...document.querySelectorAll<HTMLButtonElement>('[data-page-target]')]
const workspacePages = [...document.querySelectorAll<HTMLElement>('[data-workspace-page]')]
const studioOnlyTopbarControls = [...document.querySelectorAll<HTMLElement>('[data-studio-only]')]

function showWorkspacePage(pageId: string): void {
  for (const control of studioOnlyTopbarControls) control.hidden = pageId !== 'studio'
  for (const page of workspacePages) {
    const active = page.dataset.workspacePage === pageId
    page.hidden = !active
    page.classList.toggle('active', active)
  }
  for (const tab of workspaceTabs) {
    const active = tab.dataset.pageTarget === pageId
    tab.classList.toggle('active', active)
    if (active) tab.setAttribute('aria-current', 'page')
    else tab.removeAttribute('aria-current')
  }
  window.scrollTo({ top: 0, behavior: 'smooth' })
  if (pageId === 'studio') requestAnimationFrame(scheduleKeyboardLinks)
}

for (const tab of workspaceTabs) {
  tab.addEventListener('click', () => showWorkspacePage(tab.classList.contains('active') ? 'studio' : tab.dataset.pageTarget!))
}

function fmtTime(secs: number): string {
  if (!Number.isFinite(secs) || secs < 0) secs = 0
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function downloadBuffer(buf: ArrayBuffer, name: string, mime: string): void {
  const blob = new Blob([buf], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

function downloadText(text: string, name: string): void {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

const DEFAULT_OWT_SCORE = `owt 0.1 score

title "New Melody"
ppq 480
meter 1:1 4/4
tempo 1:1 120
key 1:1 C major

track "Melody" channel=1 program=0 velocity=88

| C4:1 D4:1 E4:1 G4:1 |

end
`

// ─── State ───────────────────────────────────────────────────────────────────

let engine: SpessaSynthEngine | null = null
let loopPlayback = false
let builtInSoundFontPromise: Promise<void> | null = null
const BUILT_IN_SOUND_FONT_NAME = 'FreePiano mda Piano + OpusWeave Micro GM'
let loadedMidi: BasicMIDI | null = null
let loadedInspection: MidiInspection | null = null
const mutedTracks = new Set<number>()

interface TimelineSelection {
  trackIndex: number
  startTick: number
  endTick: number
}

let timelineSelection: TimelineSelection | null = null
let selectedTrackIndex = 0
let timelineBeatWidth = 64
let replacementTimer: number | undefined
let replacementRecording: { selection: TimelineSelection; durationMs: number } | null = null
let playbackPositionFrame = 0
const owtEditor = $<HTMLTextAreaElement>('owt-editor')
const owtHighlight = $<HTMLElement>('owt-highlight')
const owtEditorShell = document.querySelector<HTMLElement>('.owt-editor-shell')!
let owtLexicalTokens: OwtLexicalRange[] = []
let owtPlaybackTokens: OwtPlaybackToken[] = []
let owtPlaybackRanges: OwtSourceRange[] = []
let owtActiveRangeKey = ''
let scoreCursorSeconds = 0
let scoreCursorTokens: OwtPlaybackToken[] = []
let scoreCursorRanges: OwtSourceRange[] = []
let owtSyntaxIndex = buildOwtSyntaxIndex('')
let owtModalView: ModalEditorViewState | undefined
let owtValidationTimer = 0

function scheduleOwtValidation(): void {
  window.clearTimeout(owtValidationTimer)
  owtValidationTimer = window.setTimeout(() => {
    const result = parseOwt(owtEditor.value)
    renderOwtDiagnostics(result.diagnostics)
    if (!result.document) {
      setTranslatedStatus('owt-status', 'owt.invalid', { count: result.diagnostics.filter((item) => item.severity === 'error').length }, 'err')
    } else if ($('owt-status').dataset.statusKey === 'owt.invalid') {
      clearStatus('owt-status')
    }
  }, 180)
}
let owtDiagnostics: Array<{ line: number; column: number }> = []
let selectionPlaybackTimer: number | undefined
type ScoreViewId = 'owt' | 'timeline' | 'staff' | 'jianpu'
const SCORE_VIEW_PREFERENCE_KEY = 'opusweave.score-view'
const scoreViewTabs = [...document.querySelectorAll<HTMLButtonElement>('[data-score-view-target]')]
const scoreViewPanels = [...document.querySelectorAll<HTMLElement>('[data-score-view]')]
let activeScoreView: ScoreViewId = 'owt'
let owtRevision = 0
let timelineOwtRevision = -1
function rebuildScoreCursorMap(): boolean {
  const result = parseOwt(owtEditor.value)
  if (!result.document) return false
  owtPlaybackTokens = buildOwtPlaybackMap(owtEditor.value, result.document)
  return owtPlaybackTokens.length > 0
}

function setScoreCursor(seconds: number, reveal = false): void {
  if (owtPlaybackTokens.length === 0 && !rebuildScoreCursorMap()) return
  scoreCursorSeconds = Math.max(0, seconds)
  scoreCursorTokens = cursorOwtPlaybackTokens(owtPlaybackTokens, scoreCursorSeconds)
  scoreCursorRanges = scoreCursorTokens.map(({ start, end }) => ({ start, end }))
  renderOwtEditorHighlight()
  updateNotationCursorHighlight()
  updateTimelineCursorHighlight()
  if (reveal && scoreCursorRanges[0]) revealOwtSourceRange(scoreCursorRanges[0])
}

function setScoreCursorFromSelections(selections: readonly { anchor: number; head: number }[]): void {
  if (!rebuildScoreCursorMap()) return
  const ranges = selections.map(normalizedSelection)
  setScoreCursor(playbackStartForSourceRanges(owtPlaybackTokens, ranges))
}

let notationRefreshTimer: number | undefined
let notationActiveEventKey = ''

function renderNotationViews(): void {
  const result = parseOwt(owtEditor.value)
  if (!result.document) {
    const empty = `<div class="notation-empty">${t('scoreViews.invalid')}</div>`
    $('staff-score').innerHTML = empty
    $('jianpu-score').innerHTML = empty
    return
  }
  const model = buildScoreViewModel(result.document)
  $('staff-score').innerHTML = renderStaffScore(model)
  $('jianpu-score').innerHTML = renderJianpuScore(model)
  notationActiveEventKey = ''
  updateNotationPlaybackHighlight(engine?.getPlaybackPosition()?.seconds ?? -1)
  updateNotationCursorHighlight()
  for (const element of document.querySelectorAll<HTMLElement>('#staff-score [data-owt-event], #jianpu-score [data-owt-event]')) {
    element.addEventListener('click', () => {
      const token = owtPlaybackTokens.find((item) => item.playbackId === element.dataset.owtEvent)
      if (!token) return
      modalEditor.selectRange(token.start, token.end, true)
      setScoreCursor(token.startSeconds, true)
    })
  }
}

function scheduleNotationRefresh(): void {
  window.clearTimeout(notationRefreshTimer)
  notationRefreshTimer = window.setTimeout(() => {
    if (activeScoreView === 'staff' || activeScoreView === 'jianpu') renderNotationViews()
  }, 80)
}

function updateNotationCursorHighlight(): void {
  const cursorIds = new Set(scoreCursorTokens.map((token) => token.playbackId))
  document.querySelectorAll<HTMLElement>('#staff-score [data-owt-event], #jianpu-score [data-owt-event]').forEach((element) => {
    const cursor = cursorIds.has(element.dataset.owtEvent ?? '')
    element.classList.toggle('is-cursor', cursor)
    element.classList.toggle('is-selected', cursor)
    element.classList.toggle('is-playing', cursor)
  })
}

function updateTimelineCursorHighlight(): void {
  const root = $('timeline-cursors')
  root.replaceChildren()
  if (!loadedMidi || !loadedInspection) return
  const ppq = loadedMidi.timeDivision || 480
  const tempoMap = createMidiTempoMap(loadedMidi)
  for (const track of loadedInspection.tracks.filter((item) => item.noteCount > 0)) {
    const notes = getArrangementNotes(loadedMidi, track.index)
    const note = notes.find((item) => tempoMap.tickToSeconds(item.startTick) <= scoreCursorSeconds && tempoMap.tickToSeconds(item.endTick) > scoreCursorSeconds)
      ?? notes.find((item) => tempoMap.tickToSeconds(item.startTick) >= scoreCursorSeconds)
      ?? notes.at(-1)
    if (!note) continue
    const cursor = document.createElement('span')
    cursor.className = 'timeline-track-cursor is-playing'
    cursor.dataset.trackIndex = String(track.index)
    cursor.style.left = `${(note.startTick / ppq) * timelineBeatWidth}px`
    cursor.style.top = `${34 + track.index * 62}px`
    cursor.style.height = '62px'
    cursor.addEventListener('click', () => setScoreCursor(tempoMap.tickToSeconds(note.startTick)))
    root.appendChild(cursor)
  }
}
function syncTimelineFromCurrentOwt(): boolean {
  try {
    const compiled = compileScoreText(owtEditor.value)
    const fileName = `${(compiled.score.title || 'OWT Score').replace(/[^\p{L}\p{N}._-]+/gu, '-')}.mid`
    loadedMidi = importMidi(compiled.midi, fileName)
    loadedInspection = inspectMidi(compiled.midi, fileName)
    mutedTracks.clear()
    timelineSelection = null
    if (scoreCursorTokens[0]) {
      const owtTrackIndex = Number(scoreCursorTokens[0].playbackId.split(':')[0])
      const trackIndex = loadedInspection.tracks.filter((track) => track.noteCount > 0)[owtTrackIndex]?.index
      if (trackIndex !== undefined) {
        const notes = getArrangementNotes(loadedMidi, trackIndex)
        const tempoMap = createMidiTempoMap(loadedMidi)
        const note = notes.find((item) => tempoMap.tickToSeconds(item.startTick) <= scoreCursorSeconds && tempoMap.tickToSeconds(item.endTick) > scoreCursorSeconds) ?? notes[0]
        if (note) timelineSelection = { trackIndex, startTick: note.startTick, endTick: note.endTick }
      }
    }
    updateTimelineCursorHighlight()
    timelineOwtRevision = owtRevision
    $<HTMLElement>('st-file').textContent = fileName
    $<HTMLButtonElement>('btn-export-arrangement').disabled = false
    renderArrangement()
    setPlaybackUi(false)
    setTranslatedStatus('midi-status', 'scoreViews.timelineSynced', {}, 'ok')
    return true
  } catch (error) {
    setTranslatedStatus('midi-status', 'scoreViews.timelineInvalid', { error: error instanceof Error ? error.message : String(error) }, 'err')
    return false
  }
}

function showScoreView(view: ScoreViewId, persist = true): void {
  activeScoreView = view
  for (const panel of scoreViewPanels) {
    const active = panel.dataset.scoreView === view
    panel.hidden = !active
    panel.classList.toggle('active', active)
  }
  for (const tab of scoreViewTabs) {
    const active = tab.dataset.scoreViewTarget === view
    tab.classList.toggle('active', active)
    tab.setAttribute('aria-selected', String(active))
  }
  if (view === 'timeline' && timelineOwtRevision !== owtRevision) syncTimelineFromCurrentOwt()
  if (view === 'staff' || view === 'jianpu') renderNotationViews()
  if (persist) window.localStorage.setItem(SCORE_VIEW_PREFERENCE_KEY, view)
}

for (const tab of scoreViewTabs) tab.addEventListener('click', () => showScoreView(tab.dataset.scoreViewTarget as ScoreViewId))
$('btn-score-view-play').addEventListener('click', () => void Promise.resolve(handleModalCommand('play-pause')).catch((error) => {
  setTranslatedStatus('owt-status', 'owt.error', { error: error instanceof Error ? error.message : String(error) }, 'err')
}))

$('btn-loop-playback').addEventListener('click', () => {
  loopPlayback = !loopPlayback
  if (!replacementRecording && improvSession.state !== 'responding') engine?.setLooping(loopPlayback)
  renderLoopPlaybackUi()
  setTranslatedStatus('midi-status', loopPlayback ? 'playback.loopOn' : 'playback.loopOff', {}, 'ok')
})
function syncOwtHighlightScroll(): void {
  owtHighlight.scrollTop = owtEditor.scrollTop
  owtHighlight.scrollLeft = owtEditor.scrollLeft
  if (owtModalView?.selections[owtModalView.primary]) renderMotionDestinations(owtMotionDestinations(owtSyntaxIndex, owtModalView.selections[owtModalView.primary]!))
}

function modalDecorations(): OwtDecoration[] {
  if (!owtModalView) return []
  const decorations: OwtDecoration[] = []
  for (let index = 0; index < owtModalView.selections.length; index++) {
    const range = normalizedSelection(owtModalView.selections[index]!)
    decorations.push({
      start: range.start,
      end: range.end,
      className: index === owtModalView.primary ? 'owt-selection-primary' : 'owt-selection-secondary',
    })
    if (range.start === range.end && index !== owtModalView.primary) decorations.push({ start: range.start, end: range.end, className: 'owt-modal-cursor' })
  }
  for (const range of owtSyntaxIndex.diagnostics) decorations.push({ start: range.start, end: range.end, className: 'owt-diagnostic-range' })
  for (const range of scoreCursorRanges) decorations.push({ start: range.start, end: range.end, className: 'owt-score-cursor is-playing' })
  return decorations
}

function motionDestinationDecorations(): OwtDecoration[] {
  if (!owtModalView || owtModalView.mode === 'raw' || owtModalView.mode === 'insert' || owtModalView.selections.length === 0) return []
  const unique = new Map<string, OwtDecoration>()
  for (const destination of owtMotionDestinations(owtSyntaxIndex, owtModalView.selections[owtModalView.primary]!)) {
    const decoration = {
      start: destination.start,
      end: destination.end,
      className: destination.kind === 'measure' ? 'owt-motion-target owt-motion-target-measure' : 'owt-motion-target',
    }
    unique.set(`${decoration.start}:${decoration.end}:${decoration.className}`, decoration)
  }
  return [...unique.values()]
}

function positionForSourceOffset(offset: number): { left: number; top: number } {
  const before = owtEditor.value.slice(0, offset).split('\n')
  const line = before.length - 1
  const column = before.at(-1)?.length ?? 0
  const style = getComputedStyle(owtEditor)
  const lineHeight = Number.parseFloat(style.lineHeight) || 19
  const paddingTop = Number.parseFloat(style.paddingTop) || 0
  const paddingLeft = Number.parseFloat(style.paddingLeft) || 0
  const ruler = document.createElement('canvas').getContext('2d')!
  ruler.font = style.font
  return {
    left: paddingLeft + ruler.measureText(owtEditor.value.slice(offset - column, offset)).width - owtEditor.scrollLeft,
    top: paddingTop + line * lineHeight - owtEditor.scrollTop,
  }
}

function renderMotionDestinations(destinations: readonly OwtMotionDestination[]): void {
  const root = $('owt-motion-destinations')
  root.replaceChildren()
  const groups = new Map<string, OwtMotionDestination[]>()
  for (const destination of destinations) {
    const key = `${destination.kind}:${destination.start}:${destination.end}`
    groups.set(key, [...(groups.get(key) ?? []), destination])
  }
  for (const group of groups.values()) {
    const destination = group[0]!
    const position = positionForSourceOffset(destination.start)
    const badge = document.createElement('span')
    badge.className = `owt-motion-destination ${destination.kind}`
    badge.textContent = group.map((item) => item.keys).join(' / ')
    badge.style.left = `${Math.max(5, position.left)}px`
    badge.style.top = `${Math.max(18, position.top)}px`
    root.appendChild(badge)
  }
}

function renderOwtEditorHighlight(): void {
  const destinations = owtModalView && owtModalView.selections[owtModalView.primary]
    ? owtMotionDestinations(owtSyntaxIndex, owtModalView.selections[owtModalView.primary]!)
    : []
  owtHighlight.innerHTML = renderOwtHighlight(owtEditor.value, owtPlaybackRanges, owtLexicalTokens, [...modalDecorations(), ...motionDestinationDecorations()])
  renderMotionDestinations(destinations)
  syncOwtHighlightScroll()
}

function refreshOwtLexicalHighlight(): void {
  owtLexicalTokens = owtLexicalRanges(owtEditor.value)
  renderOwtEditorHighlight()
}

function clearOwtPlaybackContext(): void {
  window.clearTimeout(selectionPlaybackTimer)
  owtPlaybackTokens = []
  owtPlaybackRanges = []
  owtActiveRangeKey = ''
  updateNotationPlaybackHighlight(-1)
  renderOwtEditorHighlight()
}

function syncOwtUrlHash(text: string): void {
  const hash = encodeOwtHash(text)
  if (window.location.hash === hash) return
  window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}${hash}`)
}

function setOwtEditorText(text: string, record = false): void {
  owtEditor.scrollTop = 0
  owtEditor.scrollLeft = 0
  clearOwtPlaybackContext()
  modalEditor.setText(text, record)
  if (owtModalView?.mode !== 'raw') selectSemanticAt(0)
}

function revealOwtSourceRange(range: OwtSourceRange): void {
  const line = owtEditor.value.slice(0, range.start).split('\n').length - 1
  const style = getComputedStyle(owtEditor)
  const lineHeight = Number.parseFloat(style.lineHeight) || 19
  const paddingTop = Number.parseFloat(style.paddingTop) || 0
  const top = paddingTop + line * lineHeight
  const bottom = top + lineHeight
  if (top < owtEditor.scrollTop || bottom > owtEditor.scrollTop + owtEditor.clientHeight) {
    owtEditor.scrollTop = Math.max(0, top - owtEditor.clientHeight * 0.4)
    syncOwtHighlightScroll()
  }
}

function updateOwtPlaybackHighlight(seconds: number, duration: number): void {
  if (duration > 0) setScoreCursor(seconds)
  updateNotationPlaybackHighlight(duration > 0 ? seconds : -1)
  if (duration <= 0 || owtPlaybackTokens.length === 0) {
    if (owtActiveRangeKey !== '') {
      owtActiveRangeKey = ''
      owtPlaybackRanges = []
      renderOwtEditorHighlight()
    }
    return
  }
  const ranges = activeOwtSourceRanges(owtPlaybackTokens, seconds)
  const key = ranges.map((range) => `${range.start}:${range.end}`).join(',')
  if (key === owtActiveRangeKey) return
  owtActiveRangeKey = key
  owtPlaybackRanges = ranges
  renderOwtEditorHighlight()
  if (ranges[0]) revealOwtSourceRange(ranges[0])
}

function updateNotationPlaybackHighlight(seconds: number): void {
  const activeIds = seconds < 0 ? [] : activeOwtPlaybackIds(owtPlaybackTokens, seconds)
  const key = `${activeIds.join(',')}|${scoreCursorTokens.map((token) => token.playbackId).join(',')}|${playbackActive}`
  if (key === notationActiveEventKey) return
  notationActiveEventKey = key
  const active = new Set(activeIds)
  const cursors = new Set(scoreCursorTokens.map((token) => token.playbackId))
  document.querySelectorAll<HTMLElement>('#staff-score [data-owt-event], #jianpu-score [data-owt-event]').forEach((element) => {
    const id = element.dataset.owtEvent ?? ''
    const playing = active.has(id) || (!playbackActive && cursors.has(id))
    element.classList.toggle('is-playing', playing)
    if (playing) element.setAttribute('aria-current', 'true')
    else element.removeAttribute('aria-current')
  })
}

function modalHint(prefix: string): string {
  if (prefix === 'space') return t('modal.hintSpace')
  if (prefix === 'space-x') return t('modal.hintObjects')
  if (prefix === 'space-mode') return t('modal.hintModes')
  if (prefix === 'space-view') return t('modal.hintViews')
  if (prefix === 'space-action') return t('modal.hintActions')
  if (prefix === 'space-example') return t('modal.hintExamples')
  if (prefix === 'space-timeline') return t('modal.hintTimeline')
  if (prefix === 'space-ai') return t('modal.hintAi')
  if (prefix === 'g') return t('modal.hintGoto')
  if (prefix === ']' || prefix === '[') return t('modal.hintNavigate')
  return prefix
}

function renderModalStatus(state: ModalEditorViewState): void {
  owtModalView = state
  if (!playbackActive && state.mode !== 'insert' && state.mode !== 'raw') setScoreCursorFromSelections(state.selections)
  const mode = $<HTMLButtonElement>('owt-mode')
  mode.textContent = state.mode.toUpperCase()
  mode.className = `owt-mode ${state.mode}`
  const switchKey = state.mode === 'raw' ? 'simpleEdit.switchToNormal' : 'simpleEdit.switchToRaw'
  mode.dataset.i18nAriaLabel = switchKey
  mode.dataset.i18nTitle = switchKey
  mode.setAttribute('aria-label', t(switchKey))
  mode.title = t(switchKey)
  owtEditorShell.className = `owt-editor-shell ${state.mode}`
  owtEditorShell.dataset.editMode = state.mode === 'raw' ? 'raw' : 'score'
  $('owt-position').textContent = t('modal.position', { line: state.line, column: state.column })
  $('owt-selection-count').textContent = t('modal.selections', { count: state.selections.length })
  $('owt-pending').textContent = state.pending ? t('modal.pending', { keys: state.pending }) : ''
  const hints = $('owt-key-hints')
  if (state.pending) {
    hints.textContent = modalHint(state.pending)
    hints.hidden = false
  }
  renderOwtEditorHighlight()
}

const modalEditor = new ModalOwtEditor(
  owtEditor,
  $<HTMLInputElement>('owt-command'),
  $('owt-key-hints'),
  {
    onChange: () => {
      if (owtPlaybackTokens.length > 0) engine?.stop()
      if (practiceSession) stopPractice()
      owtRevision++
      scheduleNotationRefresh()
      owtPlaybackTokens = []
      owtPlaybackRanges = []
      scoreCursorTokens = []
      scoreCursorRanges = []
      owtSyntaxIndex = buildOwtSyntaxIndex(owtEditor.value, owtDiagnostics)
      owtActiveRangeKey = ''
      refreshOwtLexicalHighlight()
      scheduleOwtValidation()
      syncOwtUrlHash(owtEditor.value)
    },
    onRender: renderModalStatus,
    onCommand: (command, args) => handleModalCommand(command, args),
    getSyntaxIndex: () => owtSyntaxIndex,
  },
)

owtEditor.addEventListener('scroll', syncOwtHighlightScroll)

let semanticReplaceArmed = false

type EditableOwtObjectKind = 'event' | 'measure' | 'track'

function selectedSemanticObject(kind: EditableOwtObjectKind): OwtTextObject | undefined {
  const range = modalEditor.primaryRange()
  return objectContaining(owtSyntaxIndex, kind, range.start, range.end)
}

function selectSemanticObject(object: OwtTextObject | undefined, showStatus = true): void {
  if (!object) {
    setTranslatedStatus('owt-edit-status', 'simpleEdit.noObject', {}, 'warn')
    return
  }
  modalEditor.selectRange(object.start, object.end, true)
  if (showStatus) setTranslatedStatus('owt-edit-status', `simpleEdit.selected.${object.kind === 'rest' ? 'event' : object.kind}`, {}, 'ok')
}

function selectSemanticAt(position: number): void {
  const containing = owtSyntaxIndex.events
    .filter((object) => object.start <= position && object.end >= position)
    .sort((left, right) => (left.end - left.start) - (right.end - right.start))[0]
  selectSemanticObject(containing ?? owtSyntaxIndex.events.find((object) => object.start >= position) ?? owtSyntaxIndex.events[0], false)
}


function cancelSemanticPerformanceReplacement(showStatus = false): void {
  semanticReplaceArmed = false
  const button = $<HTMLButtonElement>('btn-owt-replace-play')
  button.classList.remove('active')
  button.setAttribute('aria-pressed', 'false')
  if (showStatus) setTranslatedStatus('owt-edit-status', 'simpleEdit.replaceCancelled')
}

function setHelixEditingMode(mode: 'normal' | 'raw'): void {
  if (mode === 'normal' && owtModalView?.mode === 'raw') formatEditorOwt(false)
  cancelSemanticPerformanceReplacement()
  modalEditor.setEditingMode(mode)
  $('owt-key-hints').hidden = true
  if (mode === 'normal') selectSemanticAt(modalEditor.primaryRange().start)
  else modalEditor.focus()
  clearStatus('owt-edit-status')
}

$('owt-mode').addEventListener('click', () => setHelixEditingMode(owtModalView?.mode === 'raw' ? 'normal' : 'raw'))

function deleteSelectedSemanticObject(): void {
  const ranges = modalEditor.selections.map(normalizedSelection)
  const edits = semanticDeletionEdits(owtEditor.value, owtSyntaxIndex, ranges)
  if (!edits.length) { setTranslatedStatus('owt-edit-status', 'simpleEdit.noObject', {}, 'warn'); return }
  const start = edits[0]!.from
  modalEditor.applyEdits(edits)
  selectSemanticAt(Math.min(start, owtEditor.value.length))
  setTranslatedStatus('owt-edit-status', 'simpleEdit.deleted', {}, 'ok')
}

function toggleSemanticPerformanceReplacement(): void {
  if (semanticReplaceArmed) {
    cancelSemanticPerformanceReplacement(true)
    return
  }
  if (!selectedSemanticObject('event')) {
    setTranslatedStatus('owt-edit-status', 'simpleEdit.eventOnly', {}, 'warn')
    return
  }
  semanticReplaceArmed = true
  const button = $<HTMLButtonElement>('btn-owt-replace-play')
  button.classList.add('active')
  button.setAttribute('aria-pressed', 'true')
  setTranslatedStatus('owt-edit-status', 'simpleEdit.playNow', {}, 'warn')
  $('live-panel').scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function handleSemanticReplacementNote(data: Uint8Array): boolean {
  if (!semanticReplaceArmed || (data[0]! & 0xf0) !== 0x90 || (data[2] ?? 0) === 0) return false
  const object = selectedSemanticObject('event')
  if (!object) { cancelSemanticPerformanceReplacement(); return false }
  const current = owtEditor.value.slice(object.start, object.end)
  const replacement = replaceOwtEventPitch(current, noteName(data[1]!))
  if (!replacement) { cancelSemanticPerformanceReplacement(); return false }
  modalEditor.replaceTextRange(object.start, object.end, replacement)
  cancelSemanticPerformanceReplacement()
  selectSemanticAt(object.start)
  setTranslatedStatus('owt-edit-status', 'simpleEdit.playReplaced', { note: noteName(data[1]!) }, 'ok')
  return true
}

$('btn-ai-improvise').addEventListener('click', () => {
  if (improvSession.active) stopConversationalImprov()
  else startConversationalImprov()
})
$('btn-owt-delete-object').addEventListener('click', deleteSelectedSemanticObject)
$('btn-owt-replace-play').addEventListener('click', toggleSemanticPerformanceReplacement)

const recorder = new MidiRecorder()
const improvSession = new ConversationalImprovSession()
let improvPhraseTimer: number | undefined
let improvAbortController: AbortController | undefined
let improvRequestSequence = 0
const mapping = new MappingEngine()
let practiceSession: PracticeSession | null = null
let practiceExpectedNotes: number[] = []
const midiLearn = new MidiLearn(window.localStorage)
const profiles: DeviceProfile[] = [midiplusTinyPlusProfile()]
let activeProfile: DeviceProfile | null = null
const PARAM_LABEL_KEYS: Record<string, string> = {
  'master-volume': 'params.masterVolume',
  'synth-panic': 'params.synthPanic',
  'octave-up': 'params.octaveUp',
  'octave-down': 'params.octaveDown',
}

function parameterLabel(paramId: string): string {
  return t(PARAM_LABEL_KEYS[paramId] ?? paramId)
}
/** User remaps for profile controls: controlId -> mapping (persisted). */
let profileOverrides: Record<string, { controller: number }> = {}

try {
  profileOverrides = JSON.parse(window.localStorage.getItem('opusweave.profile.overrides') ?? '{}') as Record<string, { controller: number }>
} catch {
  profileOverrides = {}
}

const midiManager = new WebMidiManager(window.localStorage)

const AUDIO_OUTPUT_STORAGE_KEY = 'opusweave.audio.output'
let audioOutputDevices: AudioOutputDevice[] = []
let savedAudioOutput: SavedAudioOutput | null = null
try {
  savedAudioOutput = JSON.parse(window.localStorage.getItem(AUDIO_OUTPUT_STORAGE_KEY) ?? 'null') as SavedAudioOutput | null
} catch {
  savedAudioOutput = null
}

interface MediaDevicesWithOutputSelection extends MediaDevices {
  selectAudioOutput?: (options?: { deviceId?: string }) => Promise<MediaDeviceInfo>
}

// Full MIDI keyboard; the viewport follows the two octaves mapped to QWERTY.
const keyboard = new VirtualKeyboard($('virtual-keyboard'), {
  minNote: 0,
  maxNote: 127,
  onNoteOn: (note) => handleMidiMessage(new Uint8Array([0x90, note, mapping.fixedVelocity]), performance.now()),
  onNoteOff: (note) => handleMidiMessage(new Uint8Array([0x80, note, 0x40]), performance.now()),
})

// ─── Audio engine (lazy, user-gesture created) ───────────────────────────────

async function ensureEngine(): Promise<SpessaSynthEngine> {
  if (engine) return engine
  engine = new SpessaSynthEngine(undefined, new URL('./spessasynth_processor.min.js', document.baseURI).href, {
    onPlaybackTime: (time, duration) => renderPlaybackPosition(time, duration),
    onPlaybackEnded: () => {
      setPlaybackUi(false)
      setTranslatedStatus('midi-status', 'playback.finished', {}, 'ok')
      updateTimelinePlayhead(scoreCursorSeconds, engine?.getPlaybackPosition()?.duration ?? 0)
      if (replacementRecording) window.setTimeout(finishReplacementRecording, 0)
      handleConversationalImprovPlaybackEnded()
    },
    onPlaybackState: (playing) => {
      clearPlaybackNotes()
      setPlaybackUi(playing)
      if (playing) startPlaybackPositionUpdates()
      else {
        const position = engine?.getPlaybackPosition()
        if (position && position.duration > 0) setScoreCursor(position.seconds)
        stopPlaybackPositionUpdates()
      }
    },
    onPlaybackNoteOn: (_channel, note) => updatePlaybackNote(note, true),
    onPlaybackNoteOff: (_channel, note) => updatePlaybackNote(note, false),
    onSoundFontLoaded: (info) => {
      setTranslatedText('st-soundfont', 'sound.summary', { name: info.name, count: info.presetCount })
    },
    onError: (msg) => showError(msg),
  })
  await engine.ensureReady()
  if (engine) setTranslatedText('st-audio', 'status.ready')
  engine.setLooping(loopPlayback)
  // Register learnable parameters against the engine.
  midiLearn.register({
    id: 'master-volume',
    label: t('params.masterVolume'),
    apply: (v) => engine?.setMasterVolume(v / 127),
  })
  midiLearn.register({
    id: 'synth-panic',
    label: t('params.synthPanic'),
    apply: () => engine?.panic(),
  })
  midiLearn.register({
    id: 'octave-up',
    label: t('params.octaveUp'),
    apply: () => changeOctave(1),
  })

  midiLearn.register({
    id: 'octave-down',
    label: t('params.octaveDown'),
    apply: () => changeOctave(-1),
  })
  return engine
}
function renderPlaybackPosition(time: number, duration: number): void {
  $<HTMLProgressElement>('progress').value = duration > 0 ? (time / duration) * 1000 : 0
  $<HTMLSpanElement>('playback-time').textContent = `${fmtTime(time)} / ${fmtTime(duration)}`
  updateTimelinePlayhead(time, duration)
  updateOwtPlaybackHighlight(time, duration)
}

function startPlaybackPositionUpdates(): void {
  cancelAnimationFrame(playbackPositionFrame)
  const update = (): void => {
    const position = engine?.getPlaybackPosition()
    if (!position) return
    renderPlaybackPosition(position.seconds, position.duration)
    if (playbackActive) playbackPositionFrame = requestAnimationFrame(update)
  }
  playbackPositionFrame = requestAnimationFrame(update)
}

function stopPlaybackPositionUpdates(): void {
  cancelAnimationFrame(playbackPositionFrame)
  playbackPositionFrame = 0
}

function audioOutputLabel(device: AudioOutputDevice, index: number): string {
  if (device.deviceId === 'default' || device.deviceId === '') {
    return device.label ? `${t('sound.systemDefault')} — ${device.label}` : t('sound.systemDefault')
  }
  return device.label || t('sound.unnamedOutput', { index: index + 1 })
}

function renderAudioOutputs(selected?: AudioOutputDevice | null): void {
  const select = $<HTMLSelectElement>('audio-output-select')
  select.innerHTML = ''
  for (let index = 0; index < audioOutputDevices.length; index++) {
    const device = audioOutputDevices[index]!
    const option = document.createElement('option')
    option.value = device.deviceId
    option.textContent = audioOutputLabel(device, index)
    select.appendChild(option)
  }
  if (selected) select.value = selected.deviceId
}

async function applyAudioOutput(device: AudioOutputDevice, persist: boolean): Promise<void> {
  const label = audioOutputLabel(device, audioOutputDevices.indexOf(device))
  try {
    const e = await ensureEngine()
    if (!e.supportsAudioOutputSelection()) {
      setTranslatedStatus('audio-output-status', 'sound.outputUnsupported', {}, 'warn')
      setTranslatedText('st-audio-output', 'sound.systemDefault')
      return
    }
    await e.setAudioOutput(device.deviceId)
    if (persist) {
      savedAudioOutput = { deviceId: device.deviceId, label: device.label }
      window.localStorage.setItem(AUDIO_OUTPUT_STORAGE_KEY, JSON.stringify(savedAudioOutput))
    }
    $<HTMLElement>('st-audio-output').textContent = label
    setTranslatedStatus('audio-output-status', 'sound.outputReady', { device: label }, 'ok')
  } catch (err) {
    setTranslatedStatus('audio-output-status', 'sound.outputError', {
      device: label,
      error: err instanceof Error ? err.message : String(err),
    }, 'err')
  }
}

async function refreshAudioOutputs(applySaved: boolean): Promise<void> {
  const select = $<HTMLSelectElement>('audio-output-select')
  const chooseButton = $<HTMLButtonElement>('btn-choose-audio-output')
  if (!navigator.mediaDevices || !('setSinkId' in AudioContext.prototype)) {
    audioOutputDevices = [{ deviceId: 'default', label: '' }]
    renderAudioOutputs(audioOutputDevices[0])
    select.disabled = true
    chooseButton.disabled = true
    setTranslatedText('st-audio-output', 'sound.systemDefault')
    setTranslatedStatus('audio-output-status', 'sound.outputUnsupported', {}, 'warn')
    return
  }
  const devices = await navigator.mediaDevices.enumerateDevices()
  audioOutputDevices = devices
    .filter((device) => device.kind === 'audiooutput')
    .map((device) => ({ deviceId: device.deviceId, label: device.label }))
  const mediaDevices = navigator.mediaDevices as MediaDevicesWithOutputSelection
  chooseButton.textContent = t(mediaDevices.selectAudioOutput ? 'sound.chooseOutput' : 'sound.revealOutputs')
  if (audioOutputDevices.length === 0) audioOutputDevices.push({ deviceId: 'default', label: '' })
  const selected = selectAudioOutputDevice(audioOutputDevices, savedAudioOutput)
  renderAudioOutputs(selected)
  select.disabled = false
  chooseButton.disabled = false
  if (selected) {
    $<HTMLElement>('st-audio-output').textContent = audioOutputLabel(selected, audioOutputDevices.indexOf(selected))
    if (applySaved && savedAudioOutput) await applyAudioOutput(selected, false)
    else setTranslatedStatus('audio-output-status', mediaDevices.selectAudioOutput ? 'sound.outputChooseHint' : 'sound.outputPermissionHint')
  }
}

$<HTMLSelectElement>('audio-output-select').addEventListener('change', (event) => {
  const deviceId = (event.target as HTMLSelectElement).value
  const device = audioOutputDevices.find((candidate) => candidate.deviceId === deviceId)
  if (device) void applyAudioOutput(device, true)
})

$('btn-choose-audio-output').addEventListener('click', async () => {
  const mediaDevices = navigator.mediaDevices as MediaDevicesWithOutputSelection
  try {
    if (mediaDevices.selectAudioOutput) {
      const selected = await mediaDevices.selectAudioOutput(savedAudioOutput?.deviceId ? { deviceId: savedAudioOutput.deviceId } : undefined)
      await refreshAudioOutputs(false)
      const device = audioOutputDevices.find((candidate) => candidate.deviceId === selected.deviceId)
        ?? { deviceId: selected.deviceId, label: selected.label }
      if (!audioOutputDevices.some((candidate) => candidate.deviceId === device.deviceId)) audioOutputDevices.push(device)
      renderAudioOutputs(device)
      await applyAudioOutput(device, true)
      return
    }
    const stream = await mediaDevices.getUserMedia({ audio: true })
    for (const track of stream.getTracks()) track.stop()
    await refreshAudioOutputs(true)
  } catch (err) {
    if (err instanceof DOMException && err.name === 'NotAllowedError') return
    setTranslatedStatus('audio-output-status', 'sound.outputError', {
      device: savedAudioOutput?.label || t('sound.systemDefault'),
      error: err instanceof Error ? err.message : String(err),
    }, 'err')
  }
})

navigator.mediaDevices?.addEventListener('devicechange', () => {
  void refreshAudioOutputs(true)
})

let playbackActive = false

function setPlaybackUi(playing: boolean): void {
  playbackActive = playing
  $<HTMLButtonElement>('btn-stop').disabled = !playing
  const button = $<HTMLButtonElement>('btn-score-view-play')
  const actionKey = playing ? 'playback.pause' : 'playback.play'
  const action = t(actionKey)
  button.setAttribute('aria-pressed', String(playing))
  button.dataset.i18nAriaLabel = actionKey
  button.dataset.i18nTitle = actionKey
  button.setAttribute('aria-label', action)
  button.title = action
  const icon = button.querySelector<HTMLElement>('.control-icon')
  if (icon) icon.textContent = playing ? 'Ⅱ' : '▶'
  const label = button.querySelector<HTMLElement>('.control-label')
  if (label) {
    label.dataset.i18n = actionKey
    label.textContent = action
  }
}

function renderLoopPlaybackUi(): void {
  const button = $<HTMLButtonElement>('btn-loop-playback')
  button.classList.toggle('active', loopPlayback)
  button.setAttribute('aria-pressed', String(loopPlayback))
}

function refreshPracticeExpectedVisuals(): void {
  keyboard.setExpected(practiceExpectedNotes)
  for (const keycap of computerKeycaps.values()) keycap.classList.remove('expected')
  for (const assignment of mapping.listComputerKeyAssignments()) {
    if (practiceExpectedNotes.includes(assignment.note)) computerKeycaps.get(assignment.key)?.classList.add('expected')
  }
  if (practiceExpectedNotes.length > 0) keyboard.scrollToRange(Math.min(...practiceExpectedNotes), Math.max(...practiceExpectedNotes), 'smooth')
}

function updatePracticeButton(): void {
  const button = $<HTMLButtonElement>('btn-owt-practice')
  const active = Boolean(practiceSession)
  const key = active ? 'practice.stop' : 'owt.practice'
  const label = button.querySelector<HTMLElement>('.control-label')
  if (label) {
    label.dataset.i18n = key
    label.textContent = t(key)
  }
  button.setAttribute('aria-pressed', String(active))
  button.setAttribute('aria-label', t(key))
  button.title = t(key)
  button.classList.toggle('active', active)
}

function renderPracticeGuide(): void {
  const guide = $('practice-guide')
  const prompt = practiceSession?.current
  if (!practiceSession || !prompt) {
    practiceExpectedNotes = []
    refreshPracticeExpectedVisuals()
    return
  }
  practiceExpectedNotes = prompt.pitches.slice()
  guide.hidden = false
  guide.classList.remove('wrong', 'complete')
  updatePracticeButton()
  $('practice-note').textContent = prompt.pitches.map(noteName).join(' + ')
  const assignment = mapping.listComputerKeyAssignments().find((candidate) => candidate.note === prompt.pitches[0])
  const computerKey = $<HTMLElement>('practice-computer-key')
  computerKey.hidden = !assignment
  computerKey.textContent = assignment?.key.toUpperCase() ?? ''
  $('practice-progress').textContent = t('practice.progress', { current: practiceSession.position + 1, total: practiceSession.prompts.length })
  refreshPracticeExpectedVisuals()
}

function stopPractice(hide = true): void {
  practiceSession = null
  practiceExpectedNotes = []
  refreshPracticeExpectedVisuals()
  updatePracticeButton()
  if (hide) $('practice-guide').hidden = true
}

function startPractice(): void {
  const score = parseEditorOwt()
  if (!score) return
  const prompts = buildPracticePrompts(score)
  if (prompts.length === 0) {
    setTranslatedStatus('owt-status', 'practice.noNotes', {}, 'warn')
    return
  }
  engine?.stop()
  clearOwtPlaybackContext()
  practiceSession = new PracticeSession(prompts)
  updatePracticeButton()
  renderPracticeGuide()
  setTranslatedStatus('owt-status', 'practice.started', { count: prompts.length }, 'ok')
  $('live-panel').scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function handlePracticeNote(data: Uint8Array): void {
  if (!practiceSession || (data[0]! & 0xf0) !== 0x90 || (data[2] ?? 0) === 0) return
  const result = practiceSession.accept(data[1]!)
  if (!result.matched) {
    const guide = $('practice-guide')
    guide.classList.add('wrong')
    window.setTimeout(() => guide.classList.remove('wrong'), 180)
    return
  }
  if (result.complete) {
    const guide = $('practice-guide')
    guide.classList.add('complete')
    $('practice-note').textContent = t('practice.complete')
    $('practice-progress').textContent = ''
    practiceSession = null
    practiceExpectedNotes = []
    refreshPracticeExpectedVisuals()
    updatePracticeButton()
    setTranslatedStatus('owt-status', 'practice.completed', {}, 'ok')
    return
  }
  renderPracticeGuide()
}

// ─── MIDI message pipeline (hardware + computer keyboard + virtual keys) ─────

function handleMidiMessage(data: Uint8Array, timestampMs: number): void {
  if (data.length < 1) return
  const status = data[0]!

  // MIDI Learn takes precedence (arming).
  if (midiLearn.isArmed) {
    const binding = midiLearn.onMessage(data, midiManager.getState().selectedInputId ?? '')
    if (binding) {
      setTranslatedStatus('learn-status', 'learn.bound', {
        parameter: parameterLabel(binding.paramId),
        kind: binding.kind,
        control: binding.controller ?? binding.note ?? '',
      }, 'ok')
      renderLearnBindings()
    }
    return
  }
  // Learned bindings applied on the fly.
  midiLearn.applyIncoming(data)

  // Device profile remap (editable CC remaps).
  const remapped = applyProfileRemap(data)
  if (!handleSemanticReplacementNote(remapped)) handleConversationalImprovInput(remapped, timestampMs)

  handlePracticeNote(remapped)
  // Live play-through to the SoundFont synth.
  if (engine?.hasSoundFont()) engine.send(remapped)

  // Recording.
  if (recorder.isRecording) recorder.push(remapped, timestampMs)

  // Monitor + virtual keyboard.
  appendMonitorLine(remapped)
  updateLiveNotes(remapped)

  // Panic binding guard: a CC123/120 anywhere stops everything.
  if ((status & 0xf0) === 0xb0 && (data[1] === 123 || data[1] === 120)) {
    keyboard.clearAll()
  }
}

/** Apply user-edited profile controller remaps (e.g. K1 CC93 → CC7). */
function applyProfileRemap(data: Uint8Array): Uint8Array {
  if (!activeProfile || (data[0]! & 0xf0) !== 0xb0 || data.length < 3) return data
  for (const [controlId, mapping] of Object.entries(profileOverrides)) {
    const original = activeProfile.controls[controlId]
    if (original?.kind === 'cc' && original.controller === data[1]) {
      const out = Uint8Array.from(data)
      out[1] = mapping.controller
      return out
    }
  }
  return data
}

// ─── Monitor ─────────────────────────────────────────────────────────────────

const MAX_MONITOR_LINES = 100

function appendMonitorLine(data: Uint8Array): void {
  const monitor = $<HTMLDivElement>('midi-monitor')
  const status = data[0]! & 0xf0
  const channel = (data[0]! & 0x0f) + 1
  let cssClass = 'msg-other'
  let text = ''

  if (status === 0x90 && data[2] !== 0) {
    cssClass = 'msg-noteon'
    text = `NOTE ON  ch${channel}  ${noteName(data[1]!)}(${data[1]!})  vel=${data[2]!}`
  } else if (status === 0x80 || (status === 0x90 && data[2] === 0)) {
    cssClass = 'msg-noteoff'
    text = `NOTE OFF ch${channel}  ${noteName(data[1]!)}(${data[1]!})`
  } else if (status === 0xb0) {
    cssClass = 'msg-cc'
    text = `CC       ch${channel}  cc=${data[1]!}  val=${data[2]!}`
  } else if (status === 0xe0) {
    cssClass = 'msg-pb'
    const pb = ((data[2]! << 7) | data[1]!) - 8192
    text = `PITCH BND ch${channel}  val=${pb}`
  } else {
    text = `0x${status.toString(16)} ` + Array.from(data).map((b) => b.toString(16).padStart(2, '0')).join(' ')
  }

  const div = document.createElement('div')
  div.className = cssClass
  div.textContent = text
  monitor.prepend(div)
  while (monitor.children.length > MAX_MONITOR_LINES) monitor.lastElementChild?.remove()
}

// ─── Live notes display ──────────────────────────────────────────────────────

const liveNotes = new Map<number, { el: HTMLElement; count: number }>()
const playbackNotes = new Map<number, number>()

function refreshPianoNote(note: number): void {
  keyboard.setPressed(note, liveNotes.has(note) || (playbackNotes.get(note) ?? 0) > 0)
}

function refreshComputerKeysForNote(note: number): void {
  for (const assignment of mapping.listComputerKeyAssignments()) {
    if (assignment.note === note) setComputerKeyActive(assignment.key)
  }
}

function updatePlaybackNote(note: number, pressed: boolean): void {
  const count = playbackNotes.get(note) ?? 0
  if (pressed) playbackNotes.set(note, count + 1)
  else if (count <= 1) playbackNotes.delete(note)
  else playbackNotes.set(note, count - 1)
  refreshPianoNote(note)
  refreshComputerKeysForNote(note)
}

function clearPlaybackNotes(): void {
  if (playbackNotes.size === 0) return
  const notes = [...playbackNotes.keys()]
  playbackNotes.clear()
  for (const note of notes) {
    refreshPianoNote(note)
    refreshComputerKeysForNote(note)
  }
}

function updateLiveNotes(data: Uint8Array): void {
  const status = data[0]! & 0xf0
  const note = data[1]!
  const vel = data[2] ?? 0
  if (status === 0x90 && vel > 0) {
    let entry = liveNotes.get(note)
    if (!entry) {
      const el = document.createElement('div')
      el.className = 'live-note'
      $('live-notes').appendChild(el)
      entry = { el, count: 0 }
      liveNotes.set(note, entry)
    }
    entry.count++
    entry.el.textContent = `${noteName(note)} ${note} · v${vel}`
    refreshPianoNote(note)
  } else if (status === 0x80 || (status === 0x90 && vel === 0)) {
    const entry = liveNotes.get(note)
    if (entry) {
      entry.count = Math.max(0, entry.count - 1)
      if (entry.count === 0) {
        entry.el.remove()
        liveNotes.delete(note)
      }
    }
    refreshPianoNote(note)
  }
}

// ─── WebMIDI manager wiring ──────────────────────────────────────────────────

function renderMidiState(state: MidiManagerState): void {
  setTranslatedText('st-midi', state.supported ? 'status.supported' : 'status.notSupported')
  setTranslatedText('st-perm', state.permissionGranted ? 'status.granted' : state.error ? 'status.denied' : 'status.notRequested')
  if (state.error) showError(state.error)

  // Input dropdown
  const sel = $<HTMLSelectElement>('midi-input-select')
  const prev = sel.value
  sel.innerHTML = `<option value="">${t('midi.noDevice')}</option>`
  for (const p of state.inputs) {
    const opt = document.createElement('option')
    opt.value = p.id
    opt.textContent = `${p.name}${isVirtual(p) ? ` (${t('midi.virtual')})` : ''}`
    sel.appendChild(opt)
  }
  if (state.selectedInputId && state.inputs.some((p) => p.id === state.selectedInputId)) sel.value = state.selectedInputId
  else if (prev && state.inputs.some((p) => p.id === prev)) sel.value = prev
  if (state.inputNote) $<HTMLSpanElement>('st-input').textContent = state.inputNote
  else if (state.selectedInputId) setTranslatedText('st-input', 'status.connected')
  else $<HTMLSpanElement>('st-input').textContent = '—'
  if (state.inputNote) setStatus('learn-status', state.inputNote, 'warn')

  // Output dropdown
  const outSel = $<HTMLSelectElement>('midi-output-select')
  const prevOut = outSel.value
  outSel.innerHTML = `<option value="">${t('midi.noDevice')}</option>`
  for (const p of state.outputs) {
    const opt = document.createElement('option')
    opt.value = p.id
    opt.textContent = `${p.name}${isVirtual(p) ? ` (${t('midi.virtual')})` : ''}`
    outSel.appendChild(opt)
  }
  if (state.selectedOutputId && state.outputs.some((p) => p.id === state.selectedOutputId)) outSel.value = state.selectedOutputId
  else if (prevOut && state.outputs.some((p) => p.id === prevOut)) outSel.value = prevOut

  renderPortDetails(state)
  wireActiveInput(state)
  detectProfile(state)
}

// Render on every state change AND once at boot with the initial state.
midiManager.subscribe(renderMidiState)

$('btn-request-midi').addEventListener('click', () => {
  void midiManager.requestPermission().catch(() => {
    // denial/error is surfaced via the state subscription
  })
})

function isVirtual(p: { name: string; manufacturer: string }): boolean {
  return /midi through|microsoft gs|synth|virtual|loopback/i.test(`${p.name} ${p.manufacturer}`)
}

function renderPortDetails(state: MidiManagerState): void {
  const box = $<HTMLDivElement>('port-details')
  box.innerHTML = ''
  const lines = [...state.inputs.map((p) => `IN  ${p.id} | ${p.name} | ${p.manufacturer || '?'} | ${p.state}/${p.connection}${isVirtual(p) ? ' | VIRTUAL' : ''}`),
    ...state.outputs.map((p) => `OUT ${p.id} | ${p.name} | ${p.manufacturer || '?'} | ${p.state}/${p.connection}${isVirtual(p) ? ' | VIRTUAL' : ''}`)]
  for (const line of lines) {
    const div = document.createElement('div')
    div.textContent = line
    if (line.includes('VIRTUAL')) div.className = 'virtual'
    box.appendChild(div)
  }
}

function wireActiveInput(state: MidiManagerState): void {
  if (!state.selectedInputId) return
  const input = midiManager.getSelectedInput()
  if (input) {
    input.onmidimessage = (ev) => {
      if (!ev.data) return
      handleMidiMessage(Uint8Array.from(ev.data), performance.now())
    }
  }
}

function detectProfile(state: MidiManagerState): void {
  const port = state.inputs.find((p) => p.id === state.selectedInputId)
  activeProfile = port ? findProfileForPort(profiles, port.name, port.manufacturer) : null
  const box = $<HTMLDivElement>('device-profile')
  if (!activeProfile) {
    box.hidden = true
    return
  }
  box.hidden = false
  $<HTMLElement>('profile-name').textContent = t('midi.profileMatched', { profile: activeProfile.name, device: port!.name })
  const controls = $<HTMLDivElement>('profile-controls')
  controls.innerHTML = ''
  for (const [id, control] of Object.entries(activeProfile.controls)) {
    if (control.kind !== 'cc') continue
    const label = document.createElement('label')
    label.textContent = `${id}: CC `
    const input = document.createElement('input')
    input.type = 'number'
    input.min = '0'
    input.max = '127'
    input.value = String(profileOverrides[id]?.controller ?? control.controller ?? 0)
    input.addEventListener('change', () => {
      const v = Number(input.value)
      if (!Number.isInteger(v) || v < 0 || v > 127) return
      profileOverrides = { ...profileOverrides, [id]: { controller: v } }
      window.localStorage.setItem('opusweave.profile.overrides', JSON.stringify(profileOverrides))
      setTranslatedStatus('learn-status', 'midi.remapped', {
        profile: activeProfile!.name,
        control: id,
        controller: v,
      }, 'ok')
    })
    label.appendChild(input)
    controls.appendChild(label)
  }
}

// ─── SoundFont ───────────────────────────────────────────────────────────────

async function loadBuiltInSoundFont(): Promise<void> {
  setTranslatedStatus('sf-status', 'sound.builtInLoading', {}, 'warn')
  try {
    const [gmResponse, pianoResponse] = await Promise.all([
      fetch(builtInGmSoundFontUrl),
      fetch(freePianoSoundFontUrl),
    ])
    if (!gmResponse.ok) throw new Error(`Micro GM: HTTP ${gmResponse.status}`)
    if (!pianoResponse.ok) throw new Error(`mda Piano: HTTP ${pianoResponse.status}`)
    const e = await ensureEngine()
    await e.loadSoundBank(await pianoResponse.arrayBuffer(), 'FreePiano mda Piano')
    const info = await e.addSoundBankLayer(
      await gmResponse.arrayBuffer(),
      'micro-gm-fallback',
      BUILT_IN_SOUND_FONT_NAME,
      false,
    )
    setTranslatedText('st-audio', 'status.readyAudio')
    setTranslatedStatus('sf-status', 'sound.builtInReady', { count: info.presetCount }, 'ok')
    populatePresets()
  } catch (err) {
    setTranslatedStatus('sf-status', 'sound.builtInError', {
      error: err instanceof Error ? err.message : String(err),
    }, 'err')
  }
}

$<HTMLInputElement>('sf-file').addEventListener('change', async (ev) => {
  const file = (ev.target as HTMLInputElement).files?.[0]
  if (!file) return
  if (builtInSoundFontPromise) await builtInSoundFontPromise
  setTranslatedStatus('sf-status', 'sound.loading', { file: file.name }, 'warn')
  try {
    const e = await ensureEngine()
    const info = await e.loadSoundBank(await file.arrayBuffer(), file.name)
    setTranslatedStatus('sf-status', 'sound.loaded', { name: info.name, count: info.presetCount }, 'ok')
    populatePresets()
  } catch (err) {
    setTranslatedStatus('sf-status', 'sound.error', { error: err instanceof Error ? err.message : String(err) }, 'err')
  }
})

function populatePresets(): void {
  const sel = $<HTMLSelectElement>('preset-select')
  sel.disabled = true
  sel.innerHTML = `<option value="">${t(engine?.hasSoundFont() ? 'sound.presets' : 'sound.initializing')}</option>`
  if (!engine?.hasSoundFont()) return
  const patches = engine.listPresets?.() ?? []
  for (const p of patches) {
    const opt = document.createElement('option')
    opt.value = String(p.program)
    opt.textContent = `${p.program}: ${p.name}`
    sel.appendChild(opt)
  }
  sel.disabled = patches.length === 0
}

$<HTMLSelectElement>('preset-select').addEventListener('change', (ev) => {
  const program = Number((ev.target as HTMLSelectElement).value)
  if (Number.isInteger(program)) engine?.send(new Uint8Array([0xc0, program]))
})

$<HTMLInputElement>('master-volume').addEventListener('input', (ev) => {
  const v = Number((ev.target as HTMLInputElement).value) / 100
  void ensureEngine().then((e) => e.setMasterVolume(v))
})

$('btn-panic').addEventListener('click', () => {
  void ensureEngine().then((e) => {
    e.panic()
    keyboard.clearAll()
    for (const n of [...liveNotes.keys()]) updateLiveNotes(new Uint8Array([0x80, n, 0]))
  })
})

// ─── Arrangement timeline ───────────────────────────────────────────────────

function arrangementTotalTicks(): number {
  if (!loadedMidi || !loadedInspection) return 0
  return Math.max(loadedMidi.lastVoiceEventTick, Math.round(loadedInspection.durationBeats * (loadedMidi.timeDivision || 480)))
}

function arrangementTrackName(trackIndex: number): string {
  const track = loadedInspection?.tracks[trackIndex]
  return track?.name || t('playback.track', { index: trackIndex })
}

function refreshArrangementInspection(): void {
  if (!loadedMidi) return
  const data = loadedMidi.writeMIDI()
  loadedMidi = importMidi(data, loadedMidi.fileName)
  loadedInspection = inspectMidi(data, loadedMidi.fileName)
  timelineOwtRevision = owtRevision
  $<HTMLButtonElement>('btn-export-arrangement').disabled = false
  renderArrangement()
  setPlaybackUi(false)
}

async function loadMidiData(buffer: ArrayBuffer, fileName: string): Promise<void> {
  if (replacementRecording) finishReplacementRecording()
  loadedMidi = importMidi(buffer, fileName)
  loadedInspection = inspectMidi(buffer, fileName)
  timelineOwtRevision = owtRevision
  mutedTracks.clear()
  timelineSelection = null
  selectedTrackIndex = loadedInspection.tracks.find((track) => track.noteCount > 0)?.index ?? 0
  $<HTMLSpanElement>('st-file').textContent = fileName
  $<HTMLButtonElement>('btn-export-arrangement').disabled = false
  const tempo = loadedInspection.tempos[0]?.bpm ?? 120
  $<HTMLSpanElement>('playback-tempo').textContent = `♩ ${tempo} BPM`
  const range = loadedInspection.tracks.flatMap((track) =>
    track.minNote !== null && track.maxNote !== null ? [track.minNote, track.maxNote] : [],
  )
  if (range.length >= 2) keyboard.setRange(Math.min(...range), Math.max(...range))
  renderArrangement()
  setTranslatedStatus('midi-status', 'playback.loaded', {
    file: fileName,
    duration: fmtTime(loadedInspection.durationSeconds),
  }, 'ok')
  setPlaybackUi(false)
}

function renderArrangement(): void {
  renderTrackList()
  renderTimeline()
  updateTimelineSelection()
  updateTimelineCursorHighlight()
  $('arranger-grid').classList.toggle('has-midi', Boolean(loadedMidi))
}

function renderTrackList(): void {
  const list = $<HTMLDivElement>('track-list')
  list.innerHTML = ''
  if (!loadedInspection) return
  for (const track of loadedInspection.tracks) {
    const row = document.createElement('div')
    row.className = `track-header${track.index === selectedTrackIndex ? ' selected' : ''}${mutedTracks.has(track.index) ? ' muted' : ''}`
    row.dataset.trackIndex = String(track.index)
    row.addEventListener('click', () => selectArrangementTrack(track.index))

    const muteBtn = document.createElement('button')
    muteBtn.className = 'mute-btn'
    muteBtn.textContent = 'M'
    muteBtn.title = t(mutedTracks.has(track.index) ? 'playback.unmute' : 'playback.mute')
    muteBtn.addEventListener('click', (event) => {
      event.stopPropagation()
      if (mutedTracks.has(track.index)) mutedTracks.delete(track.index)
      else mutedTracks.add(track.index)
      renderTrackList()
    })

    const copy = document.createElement('div')
    copy.className = 'track-header-copy'
    const name = document.createElement('strong')
    name.textContent = arrangementTrackName(track.index)
    const meta = document.createElement('span')
    meta.textContent = `${track.noteCount} notes · ch ${track.channels.join(',') || '—'}`
    copy.append(name, meta)
    row.append(muteBtn, copy)
    list.appendChild(row)
  }
}

function renderTimeline(): void {
  const content = $<HTMLDivElement>('timeline-content')
  const ruler = $<HTMLDivElement>('timeline-ruler')
  const tracks = $<HTMLDivElement>('timeline-tracks')
  ruler.innerHTML = ''
  tracks.innerHTML = ''
  if (!loadedMidi || !loadedInspection) {
    content.style.width = '100%'
    return
  }

  const ppq = loadedMidi.timeDivision || 480
  const totalBeats = Math.max(16, Math.ceil(arrangementTotalTicks() / ppq) + 1)
  const width = totalBeats * timelineBeatWidth
  content.style.width = `${width}px`
  content.style.setProperty('--beat-width', `${timelineBeatWidth}px`)

  for (let beat = 0; beat <= totalBeats; beat++) {
    const marker = document.createElement('div')
    marker.className = `ruler-beat${beat % 4 === 0 ? ' bar' : ''}`
    marker.style.left = `${beat * timelineBeatWidth}px`
    if (beat % 4 === 0) {
      const label = document.createElement('span')
      label.textContent = String(beat / 4 + 1)
      marker.appendChild(label)
    }
    ruler.appendChild(marker)
  }

  for (const track of loadedInspection.tracks) {
    const lane = document.createElement('div')
    lane.className = `timeline-track${track.index === selectedTrackIndex ? ' selected' : ''}`
    lane.dataset.trackIndex = String(track.index)
    const notes = getArrangementNotes(loadedMidi, track.index)
    const minNote = track.minNote ?? 0
    const pitchSpan = Math.max(1, (track.maxNote ?? minNote) - minNote)
    for (const note of notes) {
      const block = document.createElement('span')
      block.className = 'timeline-note'
      block.dataset.trackIndex = String(track.index)
      block.dataset.startTick = String(note.startTick)
      block.dataset.endTick = String(note.endTick)
      block.addEventListener('click', (event) => {
        event.stopPropagation()
        selectedTrackIndex = track.index
        timelineSelection = { trackIndex: track.index, startTick: note.startTick, endTick: note.endTick }
        setScoreCursor(createMidiTempoMap(loadedMidi!).tickToSeconds(note.startTick))
        renderArrangement()
      })
      block.style.left = `${(note.startTick / ppq) * timelineBeatWidth}px`
      block.style.width = `${Math.max(3, ((note.endTick - note.startTick) / ppq) * timelineBeatWidth)}px`
      block.style.top = `${7 + (1 - (note.note - minNote) / pitchSpan) * 40}px`
      block.title = `${noteName(note.note)} · ${note.startTick / ppq}–${note.endTick / ppq}`
      const selected = timelineSelection?.trackIndex === track.index && timelineSelection.startTick < note.endTick && timelineSelection.endTick > note.startTick
      block.classList.toggle('is-selected', selected)
      lane.appendChild(block)
    }
    tracks.appendChild(lane)
  }
}

function selectArrangementTrack(trackIndex: number): void {
  selectedTrackIndex = trackIndex
  if (timelineSelection) timelineSelection = { ...timelineSelection, trackIndex }
  renderArrangement()
}

function tickFromTimelinePointer(clientX: number): number {
  if (!loadedMidi) return 0
  const rect = $<HTMLDivElement>('timeline-content').getBoundingClientRect()
  const beat = Math.max(0, (clientX - rect.left) / timelineBeatWidth)
  const snappedBeat = Math.round(beat * 4) / 4
  return Math.min(arrangementTotalTicks(), Math.round(snappedBeat * (loadedMidi.timeDivision || 480)))
}

let selectionDrag: { trackIndex: number; anchorTick: number } | null = null
$<HTMLDivElement>('timeline-tracks').addEventListener('pointerdown', (event) => {
  if (!loadedMidi || event.button !== 0 || replacementRecording) return
  const lane = (event.target as HTMLElement).closest<HTMLElement>('.timeline-track')
  if (!lane) return
  const trackIndex = Number(lane.dataset.trackIndex)
  selectedTrackIndex = trackIndex
  const anchorTick = tickFromTimelinePointer(event.clientX)
  selectionDrag = { trackIndex, anchorTick }
  lane.setPointerCapture(event.pointerId)
  timelineSelection = { trackIndex, startTick: anchorTick, endTick: anchorTick + Math.max(1, Math.round((loadedMidi.timeDivision || 480) / 4)) }
  setScoreCursor(createMidiTempoMap(loadedMidi).tickToSeconds(anchorTick))
  renderTrackList()
  for (const track of document.querySelectorAll<HTMLElement>('.timeline-track')) {
    track.classList.toggle('selected', Number(track.dataset.trackIndex) === trackIndex)
  }
  updateTimelineSelection()
})
$<HTMLDivElement>('timeline-tracks').addEventListener('pointermove', (event) => {
  if (!selectionDrag || !loadedMidi) return
  const tick = tickFromTimelinePointer(event.clientX)
  const step = Math.max(1, Math.round((loadedMidi.timeDivision || 480) / 4))
  timelineSelection = tick < selectionDrag.anchorTick
    ? { trackIndex: selectionDrag.trackIndex, startTick: tick, endTick: selectionDrag.anchorTick }
    : { trackIndex: selectionDrag.trackIndex, startTick: selectionDrag.anchorTick, endTick: Math.max(selectionDrag.anchorTick + step, tick) }
  updateTimelineSelection()
})
window.addEventListener('pointerup', () => { selectionDrag = null })
$<HTMLDivElement>('timeline-viewport').addEventListener('scroll', (event) => {
  const viewport = event.currentTarget as HTMLDivElement
  $<HTMLDivElement>('track-list').style.transform = `translateY(${-viewport.scrollTop}px)`
})

function updateTimelineSelection(): void {
  const overlay = $<HTMLDivElement>('timeline-selection')
  const clearButton = $<HTMLButtonElement>('btn-clear-range')
  const replaceButton = $<HTMLButtonElement>('btn-replace-range')
  if (!timelineSelection || !loadedMidi) {
    overlay.hidden = true
    clearButton.disabled = true
    replaceButton.disabled = true
    setTranslatedText('arranger-selection-status', 'arranger.selectHint')
    return
  }
  const ppq = loadedMidi.timeDivision || 480
  overlay.hidden = false
  overlay.style.left = `${(timelineSelection.startTick / ppq) * timelineBeatWidth}px`
  overlay.style.top = `${34 + timelineSelection.trackIndex * 62}px`
  overlay.style.width = `${Math.max(2, ((timelineSelection.endTick - timelineSelection.startTick) / ppq) * timelineBeatWidth)}px`
  overlay.style.height = '62px'
  overlay.classList.toggle('recording', Boolean(replacementRecording))
  clearButton.disabled = Boolean(replacementRecording)
  replaceButton.disabled = Boolean(replacementRecording)
  setTranslatedText('arranger-selection-status', replacementRecording ? 'arranger.recording' : 'arranger.range', {
    track: arrangementTrackName(timelineSelection.trackIndex),
    start: (timelineSelection.startTick / ppq).toFixed(2),
    end: (timelineSelection.endTick / ppq).toFixed(2),
  })
}

function updateTimelinePlayhead(time: number, duration: number): void {
  const playhead = $<HTMLDivElement>('timeline-playhead')
  if (!loadedMidi || duration <= 0 || time <= 0) {
    playhead.hidden = true
    return
  }
  playhead.hidden = false
  const width = $<HTMLDivElement>('timeline-content').getBoundingClientRect().width
  playhead.style.left = `${Math.max(0, Math.min(width, (time / duration) * width))}px`
}

$<HTMLInputElement>('arranger-zoom').addEventListener('input', (event) => {
  timelineBeatWidth = Number((event.target as HTMLInputElement).value)
  renderTimeline()
  updateTimelineSelection()
})
$('btn-clear-range').addEventListener('click', () => {
  timelineSelection = null
  updateTimelineSelection()
})

async function playArrangement(startSeconds = 0, source = loadedMidi): Promise<void> {
  if (!source) return
  clearOwtPlaybackContext()
  const e = await ensureEngine()
  let playbackSource = source
  if (mutedTracks.size > 0) playbackSource = applyTrackMutes(source, mutedTracks)
  e.setLooping(loopPlayback && !replacementRecording)
  await e.playMidi(playbackSource.writeMIDI(), source.fileName ?? 'song.mid', startSeconds)
  setPlaybackUi(true)
}

$('btn-stop').addEventListener('click', () => {
  clearOwtPlaybackContext()
  if (replacementRecording) finishReplacementRecording()
  else engine?.stop()
  $<HTMLProgressElement>('progress').value = 0
})
$('btn-restart').addEventListener('click', () => {
  engine?.stop()
  void playArrangement()
})
$('btn-export-arrangement').addEventListener('click', () => {
  if (!loadedMidi) return
  const baseName = (loadedMidi.fileName ?? 'opusweave').replace(/\.(mid|midi)$/i, '')
  downloadBuffer(loadedMidi.writeMIDI(), `${baseName}-edited.mid`, 'audio/midi')
  setTranslatedStatus('midi-status', 'arranger.exported', {}, 'ok')
})

async function startReplacementRecording(): Promise<void> {
  if (!loadedMidi || !timelineSelection || replacementRecording || recorder.isRecording) return
  const selection = { ...timelineSelection }
  const tempoMap = createMidiTempoMap(loadedMidi)
  const startSeconds = tempoMap.tickToSeconds(selection.startTick)
  const durationMs = Math.max(50, (tempoMap.tickToSeconds(selection.endTick) - startSeconds) * 1000)
  const preview = replaceArrangementRange(loadedMidi, selection)
  replacementRecording = { selection, durationMs }
  recorder.start(performance.now())
  $<HTMLButtonElement>('btn-stop-replace').disabled = false
  $<HTMLButtonElement>('btn-replace-range').disabled = true
  updateTimelineSelection()
  try {
    await playArrangement(startSeconds, preview)
    replacementTimer = window.setTimeout(finishReplacementRecording, durationMs)
  } catch (err) {
    replacementRecording = null
    recorder.stop(performance.now())
    updateTimelineSelection()
    throw err
  }
}

function finishReplacementRecording(): void {
  if (!loadedMidi || !replacementRecording) return
  const context = replacementRecording
  replacementRecording = null
  if (replacementTimer !== undefined) window.clearTimeout(replacementTimer)
  replacementTimer = undefined
  const replacementTake = recorder.stop(performance.now())
  engine?.stop()
  loadedMidi = replaceArrangementRange(loadedMidi, {
    ...context.selection,
    take: replacementTake,
    selectionDurationMs: context.durationMs,
  })
  refreshArrangementInspection()
  timelineSelection = context.selection
  $<HTMLButtonElement>('btn-stop-replace').disabled = true
  updateTimelineSelection()
  const ppq = loadedMidi.timeDivision || 480
  setTranslatedStatus('midi-status', 'arranger.replaced', {
    track: arrangementTrackName(context.selection.trackIndex),
    start: (context.selection.startTick / ppq).toFixed(2),
    end: (context.selection.endTick / ppq).toFixed(2),
    events: replacementTake.events.length,
  }, 'ok')
}

$('btn-replace-range').addEventListener('click', () => void startReplacementRecording().catch((err) => {
  setTranslatedStatus('midi-status', 'playback.playError', { error: err instanceof Error ? err.message : String(err) }, 'err')
}))
$('btn-stop-replace').addEventListener('click', finishReplacementRecording)

// ─── OpusWeave Text workspace ────────────────────────────────────────────────

function renderOwtDiagnostics(diagnostics: Array<{ line: number; column: number; severity: string; code: string; message: string }>): void {
  owtDiagnostics = diagnostics.map(({ line, column }) => ({ line, column }))
  owtSyntaxIndex = buildOwtSyntaxIndex(owtEditor.value, owtDiagnostics)
  const box = $('owt-diagnostics')
  box.innerHTML = ''
  for (const diagnostic of diagnostics) {
    const row = document.createElement('div')
    row.className = `owt-diagnostic${diagnostic.severity === 'warning' ? ' warning' : ''}`
    row.textContent = `${diagnostic.line}:${diagnostic.column} [${diagnostic.code}] ${diagnostic.message}`

    box.appendChild(row)
  }
  renderOwtEditorHighlight()
}
function owtFileName(document: OwtDocument, extension: 'owt' | 'mid'): string {
  const title = document.title?.trim() || 'opusweave-melody'
  const safe = title.replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '') || 'opusweave-melody'
  return `${safe}.${extension}`
}

function parseEditorOwt(): OwtDocument | null {
  const result = parseOwt($<HTMLTextAreaElement>('owt-editor').value)
  renderOwtDiagnostics(result.diagnostics)
  if (!result.document) {
    setTranslatedStatus('owt-status', 'owt.invalid', { count: result.diagnostics.filter((item) => item.severity === 'error').length }, 'err')
    return null
  }
  return result.document
}

function validateEditorOwt(): OwtDocument | null {
  const document = parseEditorOwt()
  if (!document) return null
  const compiled = compileScoreText($<HTMLTextAreaElement>('owt-editor').value)
  const notes = compiled.spec.tracks.reduce((sum, track) => sum + track.notes.length, 0)
  const beats = compiled.spec.tracks.reduce((maximum, track) => Math.max(maximum, ...track.notes.map((note) => note.startBeat + note.durationBeats), 0), 0)
  setTranslatedStatus('owt-status', 'owt.valid', { tracks: compiled.spec.tracks.length, notes, beats }, 'ok')
  return document
}

function parseExtractionGrid(): ReturnType<typeof rational> {
  const text = $<HTMLInputElement>('owt-grid').value.trim()
  const fraction = parseRational(text)
  if (!fraction || fraction.numerator <= 0) throw new Error(`invalid grid: ${text}`)
  return rational(fraction.numerator * 4, fraction.denominator)
}

function extractionVoice(): MelodyVoiceStrategy {
  return $<HTMLSelectElement>('owt-voice').value as MelodyVoiceStrategy
}

function showExtractedMelody(result: MelodyExtractionResult, sourceKey: 'owt.midiImported'): void {
  setOwtEditorText(result.text, true)
  renderOwtDiagnostics([])
  setTranslatedStatus('owt-status', sourceKey, {
    notes: result.report.outputNotes,
    track: result.report.sourceTrackName,
    discarded: result.report.discardedNotes,
  }, 'ok')
}

async function playOwtRange(sourceRange?: { start: number; end?: number }, allowLoop = true): Promise<void> {
  const document = parseEditorOwt()
  if (!document) return
  const compiled = compileScoreText(owtEditor.value)
  const fileName = owtFileName(document, 'mid')
  await loadMidiData(compiled.midi, fileName)
  timelineOwtRevision = owtRevision
  owtPlaybackTokens = buildOwtPlaybackMap(owtEditor.value, compiled.score)
  owtPlaybackRanges = []
  owtActiveRangeKey = ''
  let startSeconds = 0
  let endSeconds: number | undefined
  if (sourceRange) {
    const startToken = owtPlaybackTokens.find((token) => token.start <= sourceRange.start && token.end > sourceRange.start)
      ?? owtPlaybackTokens.find((token) => token.start >= sourceRange.start)
    startSeconds = startToken?.startSeconds ?? 0
    if (sourceRange.end !== undefined && sourceRange.end > sourceRange.start) {
      const selected = owtPlaybackTokens.filter((token) => token.start < sourceRange.end! && token.end > sourceRange.start)
      endSeconds = selected.reduce((maximum, token) => Math.max(maximum, token.endSeconds), startSeconds)
    }
  }
  setScoreCursor(startSeconds)
  const player = await ensureEngine()
  player.setLooping(loopPlayback && allowLoop)
  await player.playMidi(compiled.midi, fileName, startSeconds)
  if (endSeconds !== undefined && endSeconds > startSeconds) {
    selectionPlaybackTimer = window.setTimeout(() => {
      if (loopPlayback && playbackActive && allowLoop) void playOwtRange(sourceRange, allowLoop)
      else player.stop()
    }, (endSeconds - startSeconds) * 1000)
  }
  setTranslatedStatus('owt-status', 'owt.playing', {}, 'ok')
  setTranslatedStatus('midi-status', 'playback.playing')
}

function handleModalCommand(command: string, args = ''): void | Promise<void> {
  const normalized = command === 'w' ? 'save' : command
  switch (normalized) {
    case 'play': case 'play-pause':
      if (playbackActive) engine?.pause()
      else if (activeScoreView === 'timeline' && loadedMidi) return playArrangement(scoreCursorSeconds)
      else return playOwtRange({ start: scoreCursorRanges[0]?.start ?? modalEditor.primaryRange().start })
      return
    case 'loop': $('btn-loop-playback').click(); return
    case 'play-from-cursor': {
      const range = modalEditor.primaryRange()
      return playOwtRange({ start: range.start })
    }
    case 'play-selection': {
      const range = modalEditor.primaryRange()
      return playOwtRange(range)
    }
    case 'pause': engine?.pause(); return
    case 'stop': engine?.stop(); clearOwtPlaybackContext(); return
    case 'save': $('btn-owt-save').click(); return
    case 'open': $<HTMLInputElement>('owt-file').click(); return
    case 'new': $('btn-owt-new-score').click(); return
    case 'validate': validateCurrentOwt(); return
    case 'format': formatEditorOwt(); return
    case 'export-midi': $('btn-owt-export-midi').click(); return
    case 'import-midi': case 'extract-midi': $<HTMLInputElement>('owt-file').click(); return
    case 'perform': $('btn-owt-practice').click(); return
    case 'mode-score': setHelixEditingMode('normal'); return
    case 'mode-raw': setHelixEditingMode('raw'); return
    case 'improv': $('btn-ai-improvise').click(); return
    case 'view-owt': case 'view-timeline': case 'view-staff': case 'view-jianpu':
      document.querySelector<HTMLButtonElement>(`[data-score-view-target="${normalized.slice(5)}"]`)?.click(); return
    case 'delete-object': $('btn-owt-delete-object').click(); return
    case 'replace-by-playing': $('btn-owt-replace-play').click(); return
    case 'play-example': void loadBuiltinExample(BUILTIN_OWT_EXAMPLES[0]?.id, true); return
    case 'timeline-restart': $('btn-restart').click(); return
    case 'timeline-export': $('btn-export-arrangement').click(); return
    case 'timeline-clear': $('btn-clear-range').click(); return
    case 'timeline-replace': $('btn-replace-range').click(); return
    case 'timeline-finish': $('btn-stop-replace').click(); return
    case 'ai-settings': showWorkspacePage('settings'); return
    case 'ai-test': showWorkspacePage('settings'); $('btn-ai-test').click(); return
    case 'ai-reset-templates': showWorkspacePage('settings'); $('btn-ai-reset-templates').click(); return
    case 'ai-compose': $('btn-ai-compose').click(); return
    case 'toggle-locale': localeButton.click(); return
    case 'toggle-theme': themeButton.click(); return
    case 'workspace-studio': showWorkspacePage('studio'); return
    case 'workspace-settings': showWorkspacePage('settings'); return
    case 'midi-enable': showWorkspacePage('settings'); $('btn-request-midi').click(); return
    case 'midi-refresh': showWorkspacePage('settings'); $('btn-refresh-midi').click(); return
    case 'panic': showWorkspacePage('settings'); $('btn-panic').click(); return
    case 'audio-output': showWorkspacePage('settings'); $('btn-choose-audio-output').click(); return
    case 'learn-volume': case 'learn-panic': case 'learn-octave-up': case 'learn-octave-down': {
      showWorkspacePage('settings')
      const target = command.replace('learn-', '')
      const control = document.querySelector<HTMLButtonElement>(`[data-learn="${target === 'volume' ? 'master-volume' : target === 'panic' ? 'synth-panic' : target}"]`)
      control?.click()
      return
    }
    case 'diagnostics': {
      const diagnostic = buildOwtSyntaxIndex(owtEditor.value, owtDiagnostics).diagnostics[0]
      if (diagnostic) modalEditor.selectRange(diagnostic.start, diagnostic.end)
      return
    }
    case 'set': {
      const [name, value] = args.split(/\s+/, 2)
      if (name === 'grid' && ['1/8', '1/16', '1/32'].includes(value ?? '')) $<HTMLSelectElement>('owt-grid').value = value!
      else if (name === 'voice' && ['continuous', 'highest', 'lowest'].includes(value ?? '')) $<HTMLSelectElement>('owt-voice').value = value!
      else setTranslatedStatus('owt-status', 'modal.unknownCommand', { command: `${command} ${args}` }, 'warn')
      return
    }
    case 'help': {
      const hints = $('owt-key-hints')
      hints.textContent = t('modal.help')
      hints.hidden = false
      return
    }
    default:
      setTranslatedStatus('owt-status', 'modal.unknownCommand', { command: `${command}${args ? ` ${args}` : ''}` }, 'warn')
  }
}

function validateCurrentOwt(): void {
  try {
    validateEditorOwt()
  } catch (err) {
    setTranslatedStatus('owt-status', 'owt.error', { error: err instanceof Error ? err.message : String(err) }, 'err')
  }
}

function formatEditorOwt(showStatus = true): void {
  const document = parseEditorOwt()
  if (!document) return
  setOwtEditorText(serializeOwt(document), true)
  renderOwtDiagnostics([])
  if (showStatus) setTranslatedStatus('owt-status', 'owt.formatted', {}, 'ok')
  else clearStatus('owt-status')
}

$('btn-owt-practice').addEventListener('click', () => {
  if (practiceSession) stopPractice()
  else startPractice()
})
$('btn-practice-stop').addEventListener('click', () => stopPractice())

$('btn-owt-export-midi').addEventListener('click', () => {
  const document = parseEditorOwt()
  if (!document) return
  try {
    const midi = compileScoreText($<HTMLTextAreaElement>('owt-editor').value).midi
    const fileName = owtFileName(document, 'mid')
    downloadBuffer(midi, fileName, 'audio/midi')
    setTranslatedStatus('owt-status', 'owt.exported', { file: fileName }, 'ok')
  } catch (err) {
    setTranslatedStatus('owt-status', 'owt.error', { error: err instanceof Error ? err.message : String(err) }, 'err')
  }
})

$('btn-owt-save').addEventListener('click', () => {
  const document = parseEditorOwt()
  if (!document) return
  const text = serializeOwt(document)
  const fileName = owtFileName(document, 'owt')
  downloadText(text, fileName)
  setTranslatedStatus('owt-status', 'owt.saved', { file: fileName }, 'ok')
})

$('btn-owt-new-score').addEventListener('click', () => {
  setOwtEditorText(DEFAULT_OWT_SCORE, true)
  renderOwtDiagnostics([])
  setTranslatedStatus('owt-status', 'owt.newReady', {}, 'ok')
})

const fileMenu = document.querySelector<HTMLDetailsElement>('.file-menu')!
for (const action of fileMenu.querySelectorAll('button')) action.addEventListener('click', () => { fileMenu.open = false })
fileMenu.addEventListener('toggle', () => {
  if (!fileMenu.open) fileMenu.querySelector<HTMLDetailsElement>('.file-submenu')!.open = false
})

// ─── Built-in examples, keyboard layouts and AI composition ─────────────────

const exampleMenu = $('owt-example-menu')
for (const example of BUILTIN_OWT_EXAMPLES) {
  const button = document.createElement('button')
  button.type = 'button'
  button.role = 'menuitem'
  button.dataset.exampleId = example.id
  const title = document.createElement('span')
  title.className = 'example-menu-title'
  title.textContent = example.title
  const composer = document.createElement('span')
  composer.className = 'example-menu-composer'
  composer.textContent = example.composer
  button.append(title, composer)
  button.addEventListener('click', () => void loadBuiltinExample(example.id, false))
  exampleMenu.appendChild(button)
}

async function loadBuiltinExample(id: string | undefined, play: boolean): Promise<void> {
  if (!id) return
  const example = builtinOwtExample(id)
  if (!example) return
  setOwtEditorText(example.text, true)
  renderOwtDiagnostics([])
  setTranslatedStatus('owt-status', 'examples.loaded', { title: example.title }, 'ok')
  fileMenu.open = false
  if (play) await playOwtRange()
}

const COMPUTER_LAYOUT_PREFERENCE_KEY = 'opusweave.computer-layout'
let keyboardSequenceGeneration = 0

function currentComputerLayout(): BuiltinComputerLayoutId {
  return mapping.currentComputerLayoutId as BuiltinComputerLayoutId
}


function setComputerKeyboardLayout(layout: BuiltinComputerLayoutId, persist = true): void {
  releaseComputerNotes()
  mapping.setComputerLayout(layout)
  $<HTMLSelectElement>('computer-layout').value = layout
  if (persist) window.localStorage.setItem(COMPUTER_LAYOUT_PREFERENCE_KEY, layout)
  updateOctaveLabel()
}

async function soundKeyboardLayoutMessages(messages: readonly Uint8Array[], generation: number): Promise<void> {
  await ensureEngine()
  for (const message of messages) {
    if (generation !== keyboardSequenceGeneration) return
    handleMidiMessage(message, performance.now())
    await new Promise((resolve) => window.setTimeout(resolve, 115))
    handleMidiMessage(new Uint8Array([0x80 | (message[0]! & 0x0f), message[1]!, 0x40]), performance.now())
  }
}

$<HTMLSelectElement>('computer-layout').addEventListener('change', (event) => {
  keyboardSequenceGeneration++
  setComputerKeyboardLayout((event.target as HTMLSelectElement).value as BuiltinComputerLayoutId)
})

const AI_CONFIG_KEY = 'opusweave.ai.config'

function storedAiConfig(): OwtAiConfig {
  try {
    const stored = JSON.parse(window.localStorage.getItem(AI_CONFIG_KEY) ?? '{}') as Partial<OwtAiConfig>
    return {
      ...DEFAULT_OWT_AI_CONFIG,
      ...stored,
      promptTemplates: { ...DEFAULT_OWT_AI_PROMPT_TEMPLATES, ...stored.promptTemplates },
    }
  } catch {
    return { ...DEFAULT_OWT_AI_CONFIG, promptTemplates: { ...DEFAULT_OWT_AI_PROMPT_TEMPLATES } }
  }
}

function renderAiConfig(config: OwtAiConfig): void {
  $<HTMLInputElement>('ai-endpoint').value = config.baseUrl
  $<HTMLInputElement>('ai-model').value = config.model
  $<HTMLInputElement>('ai-api-key').value = config.apiKey ?? ''
  $<HTMLSelectElement>('ai-protocol').value = config.protocol ?? 'auto'
  const templates = { ...DEFAULT_OWT_AI_PROMPT_TEMPLATES, ...config.promptTemplates }
  $<HTMLTextAreaElement>('ai-template-system').value = templates.system
  $<HTMLTextAreaElement>('ai-template-prompt').value = templates.prompt
  $<HTMLTextAreaElement>('ai-template-media').value = templates.scoreMedia
  $<HTMLTextAreaElement>('ai-template-improvise').value = templates.improvise
}

function currentAiPromptTemplates(): OwtAiPromptTemplates {
  return {
    system: $<HTMLTextAreaElement>('ai-template-system').value,
    prompt: $<HTMLTextAreaElement>('ai-template-prompt').value,
    scoreMedia: $<HTMLTextAreaElement>('ai-template-media').value,
    improvise: $<HTMLTextAreaElement>('ai-template-improvise').value,
  }
}

function currentAiConfig(): OwtAiConfig {
  return {
    baseUrl: $<HTMLInputElement>('ai-endpoint').value.trim(),
    model: $<HTMLInputElement>('ai-model').value.trim(),
    apiKey: $<HTMLInputElement>('ai-api-key').value || undefined,
    protocol: $<HTMLSelectElement>('ai-protocol').value as AiProtocol,
    temperature: DEFAULT_OWT_AI_CONFIG.temperature,
    maxTokens: DEFAULT_OWT_AI_CONFIG.maxTokens,
    promptTemplates: currentAiPromptTemplates(),
  }
}

function persistAiConfig(): void {
  window.localStorage.setItem(AI_CONFIG_KEY, JSON.stringify(currentAiConfig()))
}

function aiTransport(signal?: AbortSignal): { proxyUrl?: string; signal: AbortSignal } {
  const localDesktop = location.hostname === '127.0.0.1' || location.hostname === 'localhost'
  const timeout = AbortSignal.timeout(180_000)
  return { proxyUrl: localDesktop ? '/api/ai/chat' : undefined, signal: signal ? AbortSignal.any([signal, timeout]) : timeout }
}

let aiDiscoveryTimer: number | undefined
let aiDiscoveryController: AbortController | undefined

async function refreshAiModels(): Promise<void> {
  const config = currentAiConfig()
  if (!config.baseUrl) return
  aiDiscoveryController?.abort()
  aiDiscoveryController = new AbortController()
  const refresh = $<HTMLButtonElement>('btn-ai-refresh-models')
  const model = $<HTMLInputElement>('ai-model')
  refresh.disabled = true
  model.setAttribute('aria-busy', 'true')
  setTranslatedStatus('ai-status', 'ai.modelsLoading', {}, 'warn')
  try {
    const discovery = await discoverAiModels(config, aiTransport(aiDiscoveryController.signal))
    const options = $('ai-model-options')
    options.replaceChildren(...discovery.models.map((item) => {
      const option = document.createElement('option')
      option.value = item.id
      option.label = item.name === item.id ? item.id : `${item.name} — ${item.id}`
      return option
    }))
    if (!config.model || !discovery.models.some((item) => item.id === config.model)) model.value = discovery.models[0]?.id ?? ''
    if ((config.protocol ?? 'auto') === 'auto') $<HTMLSelectElement>('ai-protocol').value = discovery.protocol
    persistAiConfig()
    setTranslatedStatus('ai-status', 'ai.modelsLoaded', { count: discovery.models.length, provider: discovery.provider }, 'ok')
  } catch (error) {
    setTranslatedStatus('ai-status', 'ai.modelsError', { error: error instanceof Error ? error.message : String(error) }, 'err')
  } finally {
    refresh.disabled = false
    model.removeAttribute('aria-busy')
  }
}

function scheduleAiModelDiscovery(): void {
  window.clearTimeout(aiDiscoveryTimer)
  aiDiscoveryTimer = window.setTimeout(() => void refreshAiModels(), 500)
}

type AiComposeState = 'idle' | 'working' | 'success' | 'error'
let aiComposeState: AiComposeState = 'idle'

function renderAiComposeButton(): void {
  const button = $<HTMLButtonElement>('btn-ai-compose')
  const stateKeys: Record<AiComposeState, string> = {
    idle: 'ai.compose',
    working: 'ai.composing',
    success: 'ai.completed',
    error: 'ai.failed',
  }
  button.dataset.aiState = aiComposeState
  const copy = t(stateKeys[aiComposeState])
  const label = button.querySelector<HTMLElement>('.control-label')
  if (label) label.textContent = copy
  else button.textContent = copy
  button.setAttribute('aria-label', copy)
  button.title = copy
  button.setAttribute('aria-live', 'polite')
}

function setAiComposeState(state: AiComposeState): void {
  aiComposeState = state
  renderAiComposeButton()
}

function setAiBusy(busy: boolean): void {
  $<HTMLButtonElement>('btn-ai-test').disabled = busy
  $<HTMLButtonElement>('btn-ai-refresh-models').disabled = busy
  const composeButton = $<HTMLButtonElement>('btn-ai-compose')
  composeButton.disabled = busy
  composeButton.setAttribute('aria-busy', String(busy))
  $<HTMLButtonElement>('btn-ai-improvise').disabled = busy && !improvSession.active
}

async function applyAiRequest(request: OwtAiRequest, statusKey: string, statusValues: TranslationValues = {}): Promise<boolean> {
  if (improvSession.active) stopConversationalImprov(false)
  persistAiConfig()
  setAiComposeState('working')
  setAiBusy(true)
  setTranslatedStatus('ai-status', statusKey, statusValues, 'warn')
  try {
    const text = await createOwtWithAi(currentAiConfig(), request, aiTransport())
    setOwtEditorText(text, true)
    renderOwtDiagnostics([])
    if (!validateEditorOwt()) throw new Error('AI OWT validation failed')
    setTranslatedStatus('ai-status', 'ai.applied', {}, 'ok')
    await playOwtRange()
    setAiComposeState('success')
    return true
  } catch (error) {
    setTranslatedStatus('ai-status', 'ai.error', { error: error instanceof Error ? error.message : String(error) }, 'err')
    setAiComposeState('error')
    return false
  } finally {
    setAiBusy(false)
  }
}

function updateConversationalImprovUi(): void {
  const button = $<HTMLButtonElement>('btn-ai-improvise')
  const label = button.querySelector<HTMLElement>('.control-label')!
  const stateKeys = {
    off: 'ai.improvOff',
    listening: 'ai.improvListeningState',
    recording: 'ai.improvRecordingState',
    thinking: 'ai.improvThinkingState',
    responding: 'ai.improvRespondingState',
  } as const
  const active = improvSession.active
  const actionKey = active ? 'ai.improviseStop' : 'ai.improviseStart'
  button.setAttribute('aria-pressed', String(active))
  button.classList.toggle('active', active)
  button.dataset.improvState = improvSession.state
  button.dataset.i18nAriaLabel = actionKey
  button.dataset.i18nTitle = actionKey
  button.setAttribute('aria-label', t(actionKey))
  button.title = `${t(actionKey)} · ${t(stateKeys[improvSession.state])}`
  label.removeAttribute('data-i18n')
  label.textContent = active ? t(stateKeys[improvSession.state]) : t('simpleEdit.improvMode')
}

function stopConversationalImprov(showStatus = true): void {
  window.clearTimeout(improvPhraseTimer)
  improvAbortController?.abort()
  improvAbortController = undefined
  improvRequestSequence++
  if (improvSession.state === 'responding') {
    engine?.stop()
    clearOwtPlaybackContext()
  }
  improvSession.stop()
  updateConversationalImprovUi()
  if (showStatus) setTranslatedStatus('ai-status', 'ai.improvStopped')
}

function startConversationalImprov(): void {
  persistAiConfig()
  cancelSemanticPerformanceReplacement()
  engine?.stop()
  clearOwtPlaybackContext()
  improvSession.start()
  updateConversationalImprovUi()
  setTranslatedStatus('ai-status', 'ai.improvListening', {}, 'ok')
  void ensureEngine().catch((error) => {
    stopConversationalImprov(false)
    setTranslatedStatus('ai-status', 'ai.error', { error: error instanceof Error ? error.message : String(error) }, 'err')
  })
}

function scheduleConversationalImprovTurn(): void {
  window.clearTimeout(improvPhraseTimer)
  improvPhraseTimer = window.setTimeout(finishConversationalImprovPhrase, improvSession.silenceMs + 25)
}

function handleConversationalImprovInput(data: Uint8Array, timestampMs: number): void {
  const result = improvSession.push(data, timestampMs)
  if (!result.accepted) return
  if (result.interruptedAi) {
    improvAbortController?.abort()
    improvAbortController = undefined
    improvRequestSequence++
    engine?.stop()
    clearOwtPlaybackContext()
    setTranslatedStatus('ai-status', 'ai.improvInterrupted', {}, 'warn')
  } else if (result.phraseStarted) {
    setTranslatedStatus('ai-status', 'ai.improvHearing', {}, 'ok')
  }
  updateConversationalImprovUi()
  scheduleConversationalImprovTurn()
}

function finishConversationalImprovPhrase(): void {
  const phrase = improvSession.poll(performance.now())
  if (!phrase) return
  updateConversationalImprovUi()
  setTranslatedStatus('ai-status', 'ai.improvThinking', {}, 'warn')
  void requestConversationalImprovResponse(phrase)
}

async function requestConversationalImprovResponse(phrase: RecordedTake): Promise<void> {
  const requestSequence = ++improvRequestSequence
  const controller = new AbortController()
  improvAbortController = controller
  try {
    const phraseOwt = extractMelodyFromRecording(phrase, {
      title: 'Human Call',
      grid: rational(1, 4),
      voiceStrategy: 'continuous',
    }).text
    const text = await createOwtWithAi(currentAiConfig(), {
      task: 'improvise',
      instruction: '',
      currentOwt: phraseOwt,
    }, aiTransport(controller.signal))
    if (requestSequence !== improvRequestSequence || improvSession.state !== 'thinking') return
    setOwtEditorText(text, true)
    renderOwtDiagnostics([])
    if (!validateEditorOwt()) throw new Error('AI OWT validation failed')
    improvSession.markResponding()
    updateConversationalImprovUi()
    setTranslatedStatus('ai-status', 'ai.improvResponding', {}, 'ok')
    await playOwtRange(undefined, false)
  } catch (error) {
    if (requestSequence !== improvRequestSequence || !improvSession.active || improvSession.state === 'recording') return
    improvSession.markListening()
    updateConversationalImprovUi()
    setTranslatedStatus('ai-status', 'ai.error', { error: error instanceof Error ? error.message : String(error) }, 'err')
  } finally {
    if (requestSequence === improvRequestSequence) improvAbortController = undefined
  }
}

function handleConversationalImprovPlaybackEnded(): void {
  if (improvSession.state !== 'responding') return
  improvSession.markListening()
  updateConversationalImprovUi()
  setTranslatedStatus('ai-status', 'ai.improvListening', {}, 'ok')
}

renderAiConfig(storedAiConfig())
updateConversationalImprovUi()
renderAiComposeButton()
for (const id of ['ai-model', 'ai-protocol']) $(id).addEventListener('change', persistAiConfig)
for (const id of ['ai-endpoint', 'ai-api-key']) {
  $(id).addEventListener('input', () => { persistAiConfig(); scheduleAiModelDiscovery() })
}
for (const id of ['ai-template-system', 'ai-template-prompt', 'ai-template-media', 'ai-template-improvise']) {
  $(id).addEventListener('input', persistAiConfig)
}
$('btn-ai-reset-templates').addEventListener('click', () => {
  renderAiConfig({ ...currentAiConfig(), promptTemplates: { ...DEFAULT_OWT_AI_PROMPT_TEMPLATES } })
  persistAiConfig()
  setTranslatedStatus('ai-status', 'ai.promptTemplatesReset', {}, 'ok')
})
$('btn-ai-refresh-models').addEventListener('click', () => void refreshAiModels())
$('btn-ai-test').addEventListener('click', () => {
  const config = currentAiConfig()
  setAiBusy(true)
  setTranslatedStatus('ai-status', 'ai.testing', { model: config.model }, 'warn')
  void testOwtAiConnection(config, aiTransport()).then(() => {
    persistAiConfig()
    setTranslatedStatus('ai-status', 'ai.connected', { model: config.model }, 'ok')
  }).catch((error) => {
    setTranslatedStatus('ai-status', 'ai.error', { error: error instanceof Error ? error.message : String(error) }, 'err')
  }).finally(() => setAiBusy(false))
})

const aiPromptExampleKeys = [
  'ai.promptExample.rain',
  'ai.promptExample.typhoon',
  'ai.promptExample.firstSnow',
  'ai.promptExample.lastTrain',
  'ai.promptExample.spring',
  'ai.promptExample.seaWind',
] as const
let lastAiPromptExample = -1

function chooseAiPromptExample(): string {
  const offset = Math.floor(Math.random() * (aiPromptExampleKeys.length - (lastAiPromptExample < 0 ? 0 : 1)))
  const index = lastAiPromptExample < 0 || offset < lastAiPromptExample ? offset : offset + 1
  lastAiPromptExample = index
  return t(aiPromptExampleKeys[index]!)
}

const aiComposeDialog = $<HTMLDialogElement>('ai-compose-dialog')
const aiComposeForm = $<HTMLFormElement>('ai-compose-form')
const aiPrompt = $<HTMLTextAreaElement>('ai-prompt')
const aiManualDialog = $<HTMLDialogElement>('ai-manual-dialog')
const aiManualForm = $<HTMLFormElement>('ai-manual-form')
const aiManualPrompt = $<HTMLTextAreaElement>('ai-manual-prompt')
const aiManualStatus = $<HTMLElement>('ai-manual-status')

function showManualAiDialog(): void {
  aiManualPrompt.value = buildManualOwtPrompt(owtEditor.value, getLocale())
  aiManualStatus.className = 'manual-ai-status'
  aiManualStatus.textContent = t('ai.manualReady')
  aiManualDialog.showModal()
  requestAnimationFrame(() => aiManualPrompt.focus())
}

async function copyManualAiPrompt(): Promise<void> {
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable')
    await navigator.clipboard.writeText(aiManualPrompt.value)
    aiManualStatus.className = 'manual-ai-status ok'
    aiManualStatus.textContent = t('ai.manualCopied')
  } catch {
    aiManualPrompt.focus()
    aiManualPrompt.select()
    aiManualStatus.className = 'manual-ai-status err'
    aiManualStatus.textContent = t('ai.manualCopyFailed')
  }
}

$('btn-ai-compose').addEventListener('click', () => {
  aiPrompt.placeholder = chooseAiPromptExample()
  if (aiComposeState !== 'idle') setAiComposeState('idle')
  if (!hasConfiguredAiApi(currentAiConfig())) {
    showManualAiDialog()
    return
  }
  aiComposeDialog.showModal()
  requestAnimationFrame(() => aiPrompt.focus())
})

$('btn-ai-cancel').addEventListener('click', () => aiComposeDialog.close())
$('btn-ai-manual-close').addEventListener('click', () => aiManualDialog.close())

aiManualForm.addEventListener('submit', (event) => {
  event.preventDefault()
  void copyManualAiPrompt()
})

aiManualPrompt.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' || (!event.ctrlKey && !event.metaKey)) return
  event.preventDefault()
  aiManualForm.requestSubmit()
})

aiComposeForm.addEventListener('submit', (event) => {
  event.preventDefault()
  const instruction = aiPrompt.value.trim() || aiPrompt.placeholder.trim()
  aiPrompt.setCustomValidity('')
  aiComposeDialog.close()
  void applyAiRequest({ task: 'prompt', instruction, currentOwt: owtEditor.value }, 'ai.working')
})

aiPrompt.addEventListener('input', () => aiPrompt.setCustomValidity(''))
aiPrompt.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
  event.preventDefault()
  aiComposeForm.requestSubmit()
})

async function importOwtFile(file: File): Promise<void> {
  setOwtEditorText(await file.text(), true)
  showScoreView('owt')
  setTranslatedStatus('owt-status', 'owt.loaded', { file: file.name }, 'ok')
  validateEditorOwt()
}

async function performMidiImport(file: File): Promise<void> {
  setTranslatedStatus('owt-status', 'owt.importingMidi', { file: file.name }, 'warn')
  const buffer = await file.arrayBuffer()
  await loadMidiData(buffer, file.name)
  showExtractedMelody(extractMelodyFromMidi(buffer, {
    title: file.name.replace(/\.(?:mid|midi)$/i, ''),
    grid: parseExtractionGrid(),
    voiceStrategy: extractionVoice(),
  }), 'owt.midiImported')
  showScoreView('owt')
}

const midiImportDialog = $<HTMLDialogElement>('midi-import-dialog')
const midiImportForm = $<HTMLFormElement>('midi-import-form')
let pendingMidiImport: File | undefined

function requestMidiImport(file: File): void {
  pendingMidiImport = file
  midiImportDialog.showModal()
}

$('btn-midi-import-cancel').addEventListener('click', () => {
  pendingMidiImport = undefined
  midiImportDialog.close()
})

midiImportDialog.addEventListener('cancel', () => { pendingMidiImport = undefined })
midiImportForm.addEventListener('submit', (event) => {
  event.preventDefault()
  const file = pendingMidiImport
  pendingMidiImport = undefined
  midiImportDialog.close()
  if (file) void performMidiImport(file).catch((error) => {
    setTranslatedStatus('owt-status', 'owt.error', { error: error instanceof Error ? error.message : String(error) }, 'err')
  })
})

interface AiMediaImportOptions {
  instruction: string
  includeCurrentScore: boolean
  maxVideoFrames: number
}

async function performAiMediaImport(file: File, options: AiMediaImportOptions): Promise<void> {
  setTranslatedStatus('ai-status', 'ai.mediaReading', { file: file.name }, 'warn')
  const attachments = await mediaFileToAiAttachments(file, options.maxVideoFrames)
  await applyAiRequest({
    task: 'score-media',
    instruction: options.instruction,
    currentOwt: options.includeCurrentScore ? owtEditor.value : '',
    attachments,
  }, 'ai.mediaReading', { file: file.name })
  showScoreView('owt')
}

const aiMediaImportDialog = $<HTMLDialogElement>('ai-media-import-dialog')
const aiMediaImportForm = $<HTMLFormElement>('ai-media-import-form')
const aiMediaPrompt = $<HTMLTextAreaElement>('ai-media-prompt')
const aiMediaMode = $<HTMLSelectElement>('ai-media-mode')
const aiMediaFrames = $<HTMLInputElement>('ai-media-frames')
const aiMediaFramesField = $<HTMLLabelElement>('ai-media-frames-field')
let pendingAiMediaImport: File | undefined

function isMp4File(file: File): boolean {
  return file.type.toLowerCase() === 'video/mp4' || file.name.toLowerCase().endsWith('.mp4')
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function requestAiMediaImport(file: File): void {
  pendingAiMediaImport = file
  $<HTMLElement>('ai-media-file-name').textContent = file.name
  $<HTMLElement>('ai-media-file-meta').textContent = `${file.type || t('ai.mediaUnknownType')} · ${formatFileSize(file.size)}`
  aiMediaMode.value = 'transcribe'
  aiMediaFrames.value = '8'
  aiMediaFramesField.hidden = !isMp4File(file)
  aiMediaPrompt.value = t('ai.mediaPromptDefault')
  aiMediaPrompt.setCustomValidity('')
  if (!aiMediaImportDialog.open) aiMediaImportDialog.showModal()
  requestAnimationFrame(() => aiMediaPrompt.focus())
}

function cancelAiMediaImport(): void {
  pendingAiMediaImport = undefined
  aiMediaImportDialog.close()
}

$('btn-ai-media-cancel').addEventListener('click', cancelAiMediaImport)
aiMediaImportDialog.addEventListener('cancel', () => { pendingAiMediaImport = undefined })
aiMediaPrompt.addEventListener('input', () => aiMediaPrompt.setCustomValidity(''))
aiMediaImportForm.addEventListener('submit', (event) => {
  event.preventDefault()
  const instruction = aiMediaPrompt.value.trim()
  if (!instruction) {
    aiMediaPrompt.setCustomValidity(t('ai.promptRequired'))
    aiMediaPrompt.reportValidity()
    return
  }
  const file = pendingAiMediaImport
  const options: AiMediaImportOptions = {
    instruction,
    includeCurrentScore: aiMediaMode.value === 'edit',
    maxVideoFrames: Math.max(1, Math.min(16, Number(aiMediaFrames.value) || 8)),
  }
  pendingAiMediaImport = undefined
  aiMediaImportDialog.close()
  if (file) void performAiMediaImport(file, options).catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    setTranslatedStatus('owt-status', 'owt.error', { error: message }, 'err')
    setTranslatedStatus('ai-status', 'ai.error', { error: message }, 'err')
  })
})

async function openOrImportFile(file: File): Promise<void> {
  try {
    const kind = scoreFileKind(file.name, file.type)
    if (kind === 'owt') await importOwtFile(file)
    else if (kind === 'midi') requestMidiImport(file)
    else requestAiMediaImport(file)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    setTranslatedStatus('owt-status', 'owt.error', { error: message }, 'err')
    setTranslatedStatus('ai-status', 'ai.error', { error: message }, 'err')
  }
}

const unifiedFileInput = $<HTMLInputElement>('owt-file')
unifiedFileInput.addEventListener('change', () => {
  const file = unifiedFileInput.files?.[0]
  if (file) void openOrImportFile(file)
  unifiedFileInput.value = ''
  fileMenu.open = false
})

const studioDropTarget = document.querySelector<HTMLElement>('[data-workspace-page="studio"]')!
for (const eventName of ['dragenter', 'dragover']) studioDropTarget.addEventListener(eventName, (event) => {
  event.preventDefault()
  if (event instanceof DragEvent && event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
  studioDropTarget.classList.add('file-drop-active')
})
for (const eventName of ['dragleave', 'drop']) studioDropTarget.addEventListener(eventName, (event) => {
  event.preventDefault()
  studioDropTarget.classList.remove('file-drop-active')
})
studioDropTarget.addEventListener('drop', (event) => {
  const file = event.dataTransfer?.files[0]
  if (file) void openOrImportFile(file)
})
// ─── Computer keyboard (MappingEngine) ───────────────────────────────────────

const TEXT_INPUT: Record<string, true> = { INPUT: true, TEXTAREA: true, SELECT: true }
const VELOCITY_STEP = 10
const activeComputerNotes = new Map<string, Uint8Array[]>()
const pointerComputerKeys = new Set<string>()
const computerKeycaps = new Map<string, HTMLElement>()

interface ComputerKeyboardSectionSpec {
  id: string
  rows: readonly (readonly (string | null)[])[]
}

const STANDARD_QWERTY_ROWS = [
  ['`', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '='],
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p', '[', ']', '\\'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', ';', "'"],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.', '/'],
] as const

const WORD_MELODY_ROWS = [
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', ';'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.'],
  [' '],
] as const

const FREEPIANO_KEYBOARD_SECTIONS: readonly ComputerKeyboardSectionSpec[] = [
  {
    id: 'main',
    rows: [
      ['`', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '=', 'back'],
      ['tab', 'q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p', '[', ']', '\\'],
      ['caps', 'a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', ';', "'", 'enter'],
      ['shift', 'z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.', '/', 'rshift'],
    ],
  },
  {
    id: 'navigation',
    rows: [
      ['insert', 'home', 'pgup'],
      ['delete', 'end', 'pgdn'],
      [null, 'up', null],
      ['left', 'down', 'right'],
    ],
  },
  {
    id: 'numpad',
    rows: [
      ['numlock', 'num/', 'num*', 'num-'],
      ['num7', 'num8', 'num9', 'num+'],
      ['num4', 'num5', 'num6', null],
      ['num1', 'num2', 'num3', 'numenter'],
      ['num0', 'num.', null],
    ],
  },
] as const

const COMPUTER_KEY_LABELS: Readonly<Record<string, string>> = {
  ' ': 'Space', back: '⌫', tab: 'Tab', caps: 'Caps', enter: 'Enter', shift: 'Shift', rshift: 'Shift',
  left: '←', right: '→', up: '↑', down: '↓', insert: 'Ins', delete: 'Del', home: 'Home', end: 'End', pgup: 'PgUp', pgdn: 'PgDn',
  numlock: 'Num', 'num/': '/', 'num*': '×', 'num-': '−', 'num+': '+', 'num.': '.', numenter: 'Enter',
}

const COMPUTER_KEY_WIDTHS: Readonly<Record<string, number>> = {
  ' ': 6, back: 2, tab: 1.5, caps: 1.75, enter: 2.25, shift: 2.25, rshift: 2.75, num0: 2,
}

const COMPUTER_CODE_KEYS: Readonly<Record<string, string>> = {
  Backquote: '`', Digit1: '1', Digit2: '2', Digit3: '3', Digit4: '4', Digit5: '5', Digit6: '6', Digit7: '7', Digit8: '8', Digit9: '9', Digit0: '0', Minus: '-', Equal: '=',
  KeyQ: 'q', KeyW: 'w', KeyE: 'e', KeyR: 'r', KeyT: 't', KeyY: 'y', KeyU: 'u', KeyI: 'i', KeyO: 'o', KeyP: 'p', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
  KeyA: 'a', KeyS: 's', KeyD: 'd', KeyF: 'f', KeyG: 'g', KeyH: 'h', KeyJ: 'j', KeyK: 'k', KeyL: 'l', Semicolon: ';', Quote: "'",
  KeyZ: 'z', KeyX: 'x', KeyC: 'c', KeyV: 'v', KeyB: 'b', KeyN: 'n', KeyM: 'm', Comma: ',', Period: '.', Slash: '/', Space: ' ',
  Backspace: 'back', Tab: 'tab', CapsLock: 'caps', Enter: 'enter', ShiftLeft: 'shift', ShiftRight: 'rshift',
  ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', Insert: 'insert', Delete: 'delete', Home: 'home', End: 'end', PageUp: 'pgup', PageDown: 'pgdn',
  NumLock: 'numlock', NumpadDivide: 'num/', NumpadMultiply: 'num*', NumpadSubtract: 'num-', NumpadAdd: 'num+', NumpadDecimal: 'num.', NumpadEnter: 'numenter',
  Numpad0: 'num0', Numpad1: 'num1', Numpad2: 'num2', Numpad3: 'num3', Numpad4: 'num4', Numpad5: 'num5', Numpad6: 'num6', Numpad7: 'num7', Numpad8: 'num8', Numpad9: 'num9',
}

function keyboardSectionsForLayout(layout: BuiltinComputerLayoutId): readonly ComputerKeyboardSectionSpec[] {
  if (layout === 'freepiano') return FREEPIANO_KEYBOARD_SECTIONS
  if (layout === 'english') return [{ id: 'main', rows: WORD_MELODY_ROWS }]
  if (layout === 'pinyin') return [{ id: 'main', rows: WORD_MELODY_ROWS }]
  return [{ id: 'main', rows: STANDARD_QWERTY_ROWS }]
}

function computerKeyLabel(key: string): string {
  if (COMPUTER_KEY_LABELS[key]) return COMPUTER_KEY_LABELS[key]!
  if (key.startsWith('num') && /^num\d$/.test(key)) return key.slice(3)
  return key.toUpperCase()
}

function computerKeyWidth(key: string): number {
  const units = COMPUTER_KEY_WIDTHS[key] ?? 1
  return 44 * units + 5 * (units - 1)
}

function computerInputKey(event: KeyboardEvent): string {
  return COMPUTER_CODE_KEYS[event.code] ?? event.key.toLowerCase()
}

let keyboardMapInitialized = false
let keyboardLinkFrame = 0
const COMPUTER_MAP_PREFERENCE_KEY = 'opusweave.computer-map.visibility'
let computerMapExpanded = true

function updateComputerMapToggleCopy(): void {
  const button = $<HTMLButtonElement>('toggle-computer-map')
  const key = computerMapExpanded ? 'live.collapseMap' : 'live.expandMap'
  button.dataset.i18nTitle = key
  button.dataset.i18nAriaLabel = key
  button.title = t(key)
  button.setAttribute('aria-label', t(key))
  button.setAttribute('aria-expanded', String(computerMapExpanded))
}

function setComputerMapExpanded(expanded: boolean, persist = false): void {
  computerMapExpanded = expanded
  $<HTMLDivElement>('computer-map-content').hidden = !expanded
  updateComputerMapToggleCopy()
  if (persist) {
    window.localStorage.setItem(COMPUTER_MAP_PREFERENCE_KEY, expanded ? 'expanded' : 'collapsed')
  }
  if (expanded) requestAnimationFrame(scheduleKeyboardLinks)
  else ($('keyboard-links') as unknown as SVGSVGElement).innerHTML = ''
}

async function detectHardwareKeyboard(): Promise<boolean | null> {
  const keyboardApi = (navigator as Navigator & {
    keyboard?: { getLayoutMap?: () => Promise<{ size: number }> }
  }).keyboard
  if (keyboardApi?.getLayoutMap) {
    try {
      return (await keyboardApi.getLayoutMap()).size > 0
    } catch {
      // Permission or platform limitation; continue with input-capability hints.
    }
  }
  if (window.matchMedia('(any-pointer: fine)').matches) return true
  if (navigator.maxTouchPoints > 0 && window.matchMedia('(any-pointer: coarse)').matches) return false
  return null
}

async function initializeComputerMapDisclosure(): Promise<void> {
  const preference = window.localStorage.getItem(COMPUTER_MAP_PREFERENCE_KEY)
  if (preference === 'expanded' || preference === 'collapsed') {
    setComputerMapExpanded(preference === 'expanded')
    return
  }
  const detected = await detectHardwareKeyboard()
  setComputerMapExpanded(detected ?? true)
}

function renderComputerKeyMap(): void {
  computerKeycaps.clear()
  const root = $<HTMLDivElement>('computer-key-map')
  root.innerHTML = ''
  const layout = currentComputerLayout()
  root.dataset.layout = layout
  const usesPerformanceShortcuts = layout === 'default'
  for (const hint of document.querySelectorAll<HTMLElement>('.map-shortcut-hint')) {
    hint.hidden = !usesPerformanceShortcuts
  }
  const assignments = new Map(mapping.listComputerKeyAssignments().map((assignment) => [assignment.key, assignment]))
  const actionLabels: Record<string, { label: string; velocity?: boolean }> = usesPerformanceShortcuts ? {
    a: { label: t('live.octaveDownKey') },
    k: { label: t('live.octaveUpKey') },
    f: { label: t('live.velocityDownKey'), velocity: true },
    '4': { label: t('live.velocityUpKey'), velocity: true },
  } : {}

  for (const sectionSpec of keyboardSectionsForLayout(layout)) {
    const section = document.createElement('div')
    section.className = 'keyboard-map-section'
    section.dataset.keyboardSection = sectionSpec.id
    for (const rowKeys of sectionSpec.rows) {
      const row = document.createElement('div')
      row.className = 'qwerty-row'
      for (const keyName of rowKeys) {
        if (keyName === null) {
          const spacer = document.createElement('span')
          spacer.className = 'computer-key-spacer'
          row.appendChild(spacer)
          continue
        }
        const assignment = assignments.get(keyName)
        const notes = mapping.previewKeyPitches(keyName)
        const action = actionLabels[keyName]
        const keycap = document.createElement('span')
        keycap.className = 'computer-keycap'
        keycap.dataset.key = keyName
        keycap.style.setProperty('--computer-key-width', `${computerKeyWidth(keyName)}px`)

        if (assignment && notes.length > 0) {
          const pitchClass = ((assignment.note % 12) + 12) % 12
          if ([1, 3, 6, 8, 10].includes(pitchClass)) keycap.classList.add('accidental')
          keycap.dataset.note = String(assignment.note)
          const noteCopy = notes.map(noteName).join('→')
          keycap.title = `${computerKeyLabel(keyName)} → ${noteCopy}`
          if (isComputerKeyVisuallyActive(keyName)) keycap.classList.add('active')
          if (notes.some((note) => practiceExpectedNotes.includes(note))) keycap.classList.add('expected')
        } else if (action) {
          keycap.classList.add('action')
          if (action.velocity) keycap.classList.add('velocity-action')
          keycap.title = action.label
        } else {
          keycap.classList.add('unmapped')
        }

        const key = document.createElement('kbd')
        key.textContent = computerKeyLabel(keyName)
        const detail = document.createElement('small')
        detail.textContent = notes.length > 0 ? notes.map(noteName).join('→') : (action?.label ?? '—')
        keycap.append(key, detail)
        row.appendChild(keycap)
        computerKeycaps.set(keyName, keycap)
      }
      section.appendChild(row)
    }
    root.appendChild(section)
  }
  scheduleKeyboardLinks()
}

function scheduleKeyboardLinks(): void {
  cancelAnimationFrame(keyboardLinkFrame)
  keyboardLinkFrame = requestAnimationFrame(updateKeyboardLinks)
}

function updateKeyboardLinks(): void {
  const svg = $('keyboard-links') as unknown as SVGSVGElement
  svg.innerHTML = ''
  if (!computerMapExpanded) return
  const bridgeRect = svg.getBoundingClientRect()
  if (bridgeRect.width === 0 || bridgeRect.height === 0) return
  const pianoRect = $<HTMLDivElement>('virtual-keyboard').getBoundingClientRect()
  const assignments = mapping.listComputerKeyAssignments()
  svg.setAttribute('viewBox', `0 0 ${bridgeRect.width} ${bridgeRect.height}`)

  for (const assignment of assignments) {
    const keycap = computerKeycaps.get(assignment.key)
    const pianoKey = document.querySelector<HTMLElement>(`#virtual-keyboard [data-note="${assignment.note}"]`)
    if (!keycap || !pianoKey) continue
    const from = keycap.getBoundingClientRect()
    const to = pianoKey.getBoundingClientRect()
    const pianoCenter = to.left + to.width / 2
    if (pianoCenter < pianoRect.left || pianoCenter > pianoRect.right) continue

    const x1 = from.left + from.width / 2 - bridgeRect.left
    const x2 = pianoCenter - bridgeRect.left
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', `M ${x1} 0 C ${x1} ${bridgeRect.height * 0.55}, ${x2} ${bridgeRect.height * 0.45}, ${x2} ${bridgeRect.height}`)
    if (isComputerKeyVisuallyActive(assignment.key)) path.classList.add('active')
    svg.appendChild(path)
  }
}

function syncPianoToComputerMap(behavior: ScrollBehavior): void {
  const assignments = mapping.listComputerKeyAssignments()
  const minNote = assignments[0]!.note
  const maxNote = assignments[assignments.length - 1]!.note
  keyboard.setMappedRange(minNote, maxNote)
  requestAnimationFrame(() => {
    keyboard.scrollToRange(minNote, maxNote, behavior)
    scheduleKeyboardLinks()
  })
}

function isComputerKeyVisuallyActive(key: string): boolean {
  const note = mapping.keyToNote(key)
  return activeComputerNotes.has(key)
    || pointerComputerKeys.has(key)
    || (note !== null && (playbackNotes.get(note) ?? 0) > 0)
}

function setComputerKeyActive(key: string): void {
  computerKeycaps.get(key)?.classList.toggle('active', isComputerKeyVisuallyActive(key))
  scheduleKeyboardLinks()
}

function releaseComputerNotes(): void {
  const timestamp = performance.now()
  const heldNotes = [...activeComputerNotes]
  activeComputerNotes.clear()
  for (const [key, messages] of heldNotes) {
    for (const message of messages) handleMidiMessage(message, timestamp)
    setComputerKeyActive(key)
  }
}

function changeOctave(delta: number): void {
  releaseComputerNotes()
  mapping.shiftOctave(delta)
  updateOctaveLabel()
}

function updateOctaveLabel(): void {
  const octaves = mapping.currentOctaveShift / 12
  $<HTMLSpanElement>('oct-label').textContent = octaves > 0 ? `+${octaves}` : String(octaves)
  renderComputerKeyMap()
  syncPianoToComputerMap(keyboardMapInitialized ? 'smooth' : 'auto')
  keyboardMapInitialized = true
}

function setKeyboardVelocity(value: number): void {
  mapping.setVelocity(value)
  $<HTMLInputElement>('key-velocity').value = String(mapping.fixedVelocity)
}

function changeKeyboardVelocity(delta: number): void {
  setKeyboardVelocity(mapping.fixedVelocity + delta)
}

function startComputerPointerNote(key: string): (() => void) | undefined {
  const messages = mapping.keyDownMessages(key)
  if (messages.length === 0) return undefined
  renderComputerKeyMap()
  if (messages.length > 1) {
    pointerComputerKeys.add(key)
    setComputerKeyActive(key)
    void soundKeyboardLayoutMessages(messages, keyboardSequenceGeneration).finally(() => {
      pointerComputerKeys.delete(key)
      setComputerKeyActive(key)
    })
    return () => undefined
  }
  const noteOffs = messages.map((message) => new Uint8Array([0x80 | (message[0]! & 0x0f), message[1]!, 0x40]))
  let released = false
  pointerComputerKeys.add(key)
  setComputerKeyActive(key)
  for (const message of messages) handleMidiMessage(message, performance.now())
  return () => {
    if (released) return
    released = true
    for (const message of noteOffs) handleMidiMessage(message, performance.now())
    pointerComputerKeys.delete(key)
    setComputerKeyActive(key)
  }
}

function activateComputerMapControl(key: string): boolean {
  if (currentComputerLayout() !== 'default') return false
  switch (key) {
    case 'a': changeOctave(-1); return true
    case 'k': changeOctave(1); return true
    case 'f': changeKeyboardVelocity(-VELOCITY_STEP); return true
    case '4': changeKeyboardVelocity(VELOCITY_STEP); return true
    default: return false
  }
}

window.addEventListener('keydown', (ev) => {
  const target = ev.target as HTMLElement
  if (!ev.ctrlKey && !ev.metaKey && !ev.altKey && ev.key === 'F5') {
    ev.preventDefault()
    if (!ev.repeat) {
      void Promise.resolve(handleModalCommand('play-pause')).catch((error) => {
        console.error('Unable to toggle score playback from F5', error)
      })
    }
    return
  }
  if ((ev.ctrlKey || ev.metaKey) && !ev.altKey && ev.code === 'Space') {
    ev.preventDefault()
    if (!ev.repeat) {
      void Promise.resolve(handleModalCommand('play-pause')).catch((error) => {
        console.error('Unable to toggle score playback from the global shortcut', error)
      })
    }
    return
  }
  if (TEXT_INPUT[target.tagName]) return

  const plainShortcut = !ev.ctrlKey && !ev.metaKey && !ev.altKey
  if (currentComputerLayout() === 'default' && plainShortcut && (ev.code === 'KeyA' || ev.code === 'KeyK')) {
    ev.preventDefault()
    if (!ev.repeat) changeOctave(ev.code === 'KeyA' ? -1 : 1)
    return
  }
  if (currentComputerLayout() === 'default' && plainShortcut && (ev.code === 'KeyF' || ev.code === 'Digit4')) {
    ev.preventDefault()
    changeKeyboardVelocity(ev.code === 'KeyF' ? -VELOCITY_STEP : VELOCITY_STEP)
    return
  }
  if (ev.repeat) return

  const key = computerInputKey(ev)
  const messages = mapping.keyDownMessages(key)
  if (messages.length === 0) return
  ev.preventDefault()
  renderComputerKeyMap()
  if (messages.length > 1) {
    void soundKeyboardLayoutMessages(messages, keyboardSequenceGeneration)
    return
  }
  activeComputerNotes.set(key, messages.map((message) => new Uint8Array([0x80 | (message[0]! & 0x0f), message[1]!, 0x40])))
  setComputerKeyActive(key)
  for (const message of messages) handleMidiMessage(message, performance.now())
})

window.addEventListener('keyup', (ev) => {
  const target = ev.target as HTMLElement
  if (TEXT_INPUT[target.tagName]) return
  const key = computerInputKey(ev)
  const messages = activeComputerNotes.get(key)
  if (!messages) return
  ev.preventDefault()
  activeComputerNotes.delete(key)
  setComputerKeyActive(key)
  for (const message of messages) handleMidiMessage(message, performance.now())
})

window.addEventListener('blur', releaseComputerNotes)
$<HTMLDivElement>('computer-key-map').addEventListener('scroll', scheduleKeyboardLinks)
$<HTMLDivElement>('virtual-keyboard').addEventListener('scroll', scheduleKeyboardLinks)
window.addEventListener('resize', scheduleKeyboardLinks)

enableHorizontalPointerScroll($<HTMLDivElement>('computer-key-map'), {
  targetSelector: '.computer-keycap',
  onHoldStart: (target) => startComputerPointerNote(target.dataset.key ?? ''),
  onTap: (target) => {
    const key = target.dataset.key ?? ''
    if (activateComputerMapControl(key)) return
    const release = startComputerPointerNote(key)
    if (release) window.setTimeout(release, 160)
  },
})
$('toggle-computer-map').addEventListener('click', () => setComputerMapExpanded(!computerMapExpanded, true))

$('oct-up').addEventListener('click', () => changeOctave(1))
$('oct-down').addEventListener('click', () => changeOctave(-1))
$('velocity-up').addEventListener('click', () => changeKeyboardVelocity(VELOCITY_STEP))
$('velocity-down').addEventListener('click', () => changeKeyboardVelocity(-VELOCITY_STEP))

$<HTMLInputElement>('key-velocity').addEventListener('change', (ev) => {
  setKeyboardVelocity(Number((ev.target as HTMLInputElement).value))
})

// ─── MIDI Learn ──────────────────────────────────────────────────────────────

document.querySelectorAll<HTMLButtonElement>('[data-learn]').forEach((btn) => {
  btn.addEventListener('click', () => {
    void ensureEngine().then(() => {
      const paramId = btn.dataset.learn!
      if (paramId === 'master-volume') midiLearn.learn('master-volume')
      else if (paramId === 'synth-panic') midiLearn.learn('synth-panic')
      else if (paramId === 'octave-up') midiLearn.learn('octave-up')
      else if (paramId === 'octave-down') midiLearn.learn('octave-down')
      setTranslatedStatus('learn-status', 'learn.learning', { parameter: parameterLabel(paramId) }, 'warn')
    })
  })
})

function renderLearnBindings(): void {
  const list = $<HTMLUListElement>('learn-bindings')
  list.innerHTML = ''
  for (const b of midiLearn.listBindings()) {
    const li = document.createElement('li')
    li.textContent = `${parameterLabel(b.paramId)} ← ${b.kind} ${b.controller ?? b.note ?? ''}${b.deviceName ? ` (${b.deviceName})` : ''}`
    const remove = document.createElement('button')
    remove.textContent = '✕'
    remove.style.marginLeft = '8px'
    remove.addEventListener('click', () => {
      midiLearn.removeBinding(b.paramId)
      renderLearnBindings()
    })
    li.appendChild(remove)
    list.appendChild(li)
  }
}

// ─── Device disconnect / page close: stop hanging notes ─────────────────────

midiManager.subscribe((state) => {
  if (state.inputs.length === 0) {
    // device disconnected: release everything
    recorder.stopHeldNotes()
    engine?.panic()
    keyboard.clearAll()
  }
})

window.addEventListener('beforeunload', () => {
  recorder.stopHeldNotes()
  engine?.panic()
})

// ─── Boot ────────────────────────────────────────────────────────────────────

renderLearnBindings()
const savedComputerLayout = window.localStorage.getItem(COMPUTER_LAYOUT_PREFERENCE_KEY)
const initialComputerLayout: BuiltinComputerLayoutId = ['default', 'english', 'pinyin', 'freepiano'].includes(savedComputerLayout ?? '')
  ? savedComputerLayout as BuiltinComputerLayoutId
  : 'default'
setComputerKeyboardLayout(initialComputerLayout, false)
setPlaybackUi(false)
renderLoopPlaybackUi()
const initialOwtHashPresent = window.location.hash.startsWith('#owt=')
const initialOwtFromHash = decodeOwtHash(window.location.hash)
setOwtEditorText(initialOwtFromHash ?? DEFAULT_OWT_SCORE)
setHelixEditingMode('normal')
const savedScoreView = window.localStorage.getItem(SCORE_VIEW_PREFERENCE_KEY)
const initialScoreView: ScoreViewId = ['owt', 'timeline', 'staff', 'jianpu'].includes(savedScoreView ?? '')
  ? savedScoreView as ScoreViewId
  : 'owt'
showScoreView(initialScoreView, false)
renderMidiState(midiManager.getState())
showWorkspacePage('studio')
renderArrangement()
if (initialOwtHashPresent && initialOwtFromHash === null) {
  setTranslatedStatus('owt-status', 'owt.shareInvalid', {}, 'err')
} else if (initialOwtFromHash !== null) {
  setTranslatedStatus('owt-status', 'owt.shareLoaded', {}, 'ok')
}
window.addEventListener('hashchange', () => {
  const hashContainsScore = window.location.hash.startsWith('#owt=')
  const sharedOwt = decodeOwtHash(window.location.hash)
  if (sharedOwt === null) {
    if (hashContainsScore) setTranslatedStatus('owt-status', 'owt.shareInvalid', {}, 'err')
    return
  }
  if (sharedOwt === owtEditor.value) return
  setOwtEditorText(sharedOwt, true)
  showWorkspacePage('studio')
  showScoreView('owt')
  setTranslatedStatus('owt-status', 'owt.shareLoaded', {}, 'ok')
})
void initializeComputerMapDisclosure()
builtInSoundFontPromise = loadBuiltInSoundFont()
void builtInSoundFontPromise.then(() => refreshAudioOutputs(true))

if (initialOwtFromHash === null) {
  void fetch('/api/startup-midi').then(async (response) => {
    if (response.status === 204 || !response.ok) return
    const encodedTitle = response.headers.get('x-opusweave-title') ?? 'OWT Score'
    const title = decodeURIComponent(encodedTitle)
    await loadMidiData(await response.arrayBuffer(), `${title}.mid`)
    setTranslatedStatus('midi-status', 'playback.clickToStart', {}, 'warn')
    window.addEventListener('pointerdown', () => $<HTMLButtonElement>('btn-score-view-play').click(), { once: true, capture: true })
  }).catch((err: unknown) => {
    setTranslatedStatus('midi-status', 'playback.error', { error: err instanceof Error ? err.message : String(err) }, 'err')
  })
}

// Guard: exported MIDI from a take must re-import — validated by round-trip test in the suite.
