/**
 * OpusWeave browser app — orchestrates the engine, WebMIDI manager,
 * recorder, mapping engine and MIDI learn. No layer reaches into
 * spessasynth classes directly (the engine wraps them).
 */
import { SpessaSynthEngine } from '../audio/spessa-synth-engine.ts'
import { selectAudioOutputDevice, type AudioOutputDevice, type SavedAudioOutput } from '../audio/audio-output.ts'
import { WebMidiManager, type MidiManagerState } from '../midi/web-midi-manager.ts'
import { MidiRecorder, type RecordedTake } from '../domain/midi/midi-recorder.ts'
import { MappingEngine, noteName, type BuiltinComputerLayoutId, type ComputerKeyAssignment } from '../domain/devices/mapping-engine.ts'
import { MidiLearn } from '../domain/midi-learn.ts'
import { findProfileForPort, overrideControl, type DeviceProfile } from '../domain/devices/device-profile.ts'
import { midiplusTinyPlusProfile } from '../domain/devices/midiplus-tiny-plus.ts'
import { VirtualKeyboard } from './components/virtual-keyboard.ts'
import { enableHorizontalPointerScroll } from './components/horizontal-pointer-scroll.ts'
import { getLocale, resolveLocale, setLocale, t, translateDocument, type TranslationValues } from './i18n.ts'
import { compileScoreText, extractMelodyFromMidi, extractMelodyFromRecording, type MelodyExtractionResult, type MelodyVoiceStrategy } from '../domain/owt/integration.ts'
import { parseOwt } from '../domain/owt/parser.ts'
import { parseRational, rational, rationalToNumber } from '../domain/owt/rational.ts'
import { serializeOwt } from '../domain/owt/serializer.ts'
import { appendOwtScores, completeOwtPrefix } from '../domain/owt/streaming.ts'
import { buildOwt01Reference } from '../domain/owt/reference.ts'
import type { OwtDocument } from '../domain/owt/ast.ts'
import { activeOwtPlaybackIds, activeOwtSourceRanges, buildOwtPlaybackMap, cursorOwtPlaybackTokens, playbackStartForSourceRanges, type OwtPlaybackToken, type OwtSourceRange } from '../domain/owt/playback-map.ts'
import { owtLexicalRanges, renderOwtHighlight, type OwtDecoration, type OwtLexicalRange } from './components/owt-highlighter.ts'
import { ModalOwtEditor, normalizedSelection, owtMotionDestinations, type ModalEditorViewState, type OwtMotionDestination } from './editor/modal-editor.ts'
import { buildOwtSyntaxIndex, objectContaining, replaceOwtEventPitch, semanticDeletionEdits, type OwtTextObject } from './editor/owt-objects.ts'
import { buildPracticePrompts, PracticeSession } from '../domain/owt/practice-session.ts'
import { BUILTIN_OWT_EXAMPLES, builtinOwtExample } from '../domain/owt/builtin-examples.ts'
import { buildScoreViewModel, type ScoreViewModel } from '../domain/owt/score-views.ts'
import { renderJianpuScore, renderStaffScore } from './components/score-views.ts'
import { buildManualOwtPrompt, createOwtWithAi, defaultOwtAiPromptTemplates, DEFAULT_OWT_AI_CONFIG, hasConfiguredAiApi, testOwtAiConnection, validateOwtAiPromptTemplates, type OwtAiConfig, type OwtAiPromptTemplates, type OwtAiRequest } from '../domain/ai/owt-ai.ts'
import { discoverAiModels, type AiProtocol } from '../domain/ai/providers.ts'
import { ConversationalImprovSession } from '../domain/ai/conversational-improv.ts'
import { mediaFileToAiAttachments } from './ai-media.ts'
import { scoreFileKind } from './open-file.ts'
import { nextThemePreference, normalizeThemePreference, resolveTheme, type ThemePreference } from './theme.ts'
import { decodeOwtHash, encodeOwtHash } from './owt-url-state.ts'
import { createFullCompositionWorkflow } from './controllers/composition-controller.ts'
import type { FullCompositionStage, FullCompositionStreamUpdate } from '../domain/ai/full-composition.ts'
import { repairCommonOwtErrors } from '../domain/owt/repair.ts'
import { attachSourceHover, describeOwtSourceToken, type SourceHoverField } from './views/source-hover-view.ts'
import { computerInputKey, computerKeyLabel, computerKeyWidth, keyboardSectionsForLayout } from './keyboard/layout-view-model.ts'
import { byId as $, clearStatus, retranslateTrackedCopy, setStatus, setTranslatedStatus, setTranslatedText, showError } from './views/status-view.ts'
import { WorkspaceStore, type WorkspaceState } from './state/workspace-store.ts'
import { TransportController } from './controllers/transport-controller.ts'
import { ImprovController } from './controllers/improv-controller.ts'
import builtInGmSoundFontUrl from './assets/soundfonts/FluidR3Mono_GM.sf3' with { type: 'file' }
import builtInGmLicenseUrl from './assets/soundfonts/FluidR3Mono_License.md' with { type: 'file' }
import freePianoSoundFontUrl from './assets/freepiano-mda-piano.sf2' with { type: 'file' }


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
  const settingsTheme = document.querySelector<HTMLSelectElement>('#settings-theme')
  if (settingsTheme) settingsTheme.value = themePreference
}


themeButton.addEventListener('click', () => {
  themePreference = nextThemePreference(themePreference)
  window.localStorage.setItem('opusweave.theme', themePreference)
  renderThemePreference()
  markSettingsSaved()
})

systemTheme.addEventListener('change', () => {
  if (themePreference === 'system') renderThemePreference()
})

localeButton.addEventListener('click', () => {
  const previousDefaults = defaultOwtAiPromptTemplates(getLocale())
  const templatesUseDefaults = Object.entries(previousDefaults).every(([key, value]) => currentAiPromptTemplates()[key as keyof OwtAiPromptTemplates] === value)
  const locale = document.documentElement.lang === 'en' ? 'zh-CN' : 'en'
  setLocale(locale)
  window.localStorage.setItem('opusweave.locale', locale)
  translateDocument()
  if (templatesUseDefaults) {
    renderAiConfig({ ...currentAiConfig(), locale, promptTemplates: defaultOwtAiPromptTemplates(locale) })
    persistAiConfig()
  }
  retranslateTrackedCopy()
  renderMidiState(midiManager.getState())
  if (timelineModel) renderTimelineView()
  renderLearnBindings()
  populatePresets()
  void refreshAudioOutputs(false)
  renderComputerKeyMap()
  updateComputerMapToggleCopy()
  modalEditor.refresh()
  if (practiceSession) renderPracticeGuide()
  updateConversationalImprovUi()
  renderAiComposeButton()
  renderScoreViewCycleButton()
  renderOwtReference()
  if (activeScoreView === 'staff' || activeScoreView === 'jianpu') renderNotationViews()
  updateLanguageToggleCopy()
  const settingsLanguage = document.querySelector<HTMLSelectElement>('#settings-language')
  if (settingsLanguage) settingsLanguage.value = locale
  updateAiSettingsState()
  markSettingsSaved()
  renderThemePreference()
})

const workspaceTabs = [...document.querySelectorAll<HTMLButtonElement>('[data-page-target]')]
const workspacePages = [...document.querySelectorAll<HTMLElement>('[data-workspace-page]')]
const studioOnlyTopbarControls = [...document.querySelectorAll<HTMLElement>('[data-studio-only]')]

function showWorkspacePage(pageId: string): void {
  for (const control of studioOnlyTopbarControls) {
    control.hidden = pageId !== 'studio' || (control.id === 'btn-owt-repair' && !owtHasErrors)
  }
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

const settingsNavItems = [...document.querySelectorAll<HTMLButtonElement>('[data-settings-target]')]
const settingsPanels = [...document.querySelectorAll<HTMLElement>('[data-settings-panel]')]
const settingsShell = document.querySelector<HTMLElement>('.settings-shell')!

function showSettingsPanel(panelId: string): void {
  for (const item of settingsNavItems) {
    const active = item.dataset.settingsTarget === panelId
    item.classList.toggle('active', active)
    if (active) item.setAttribute('aria-current', 'page')
    else item.removeAttribute('aria-current')
  }
  for (const panel of settingsPanels) {
    const active = panel.dataset.settingsPanel === panelId
    panel.hidden = !active
    panel.classList.toggle('active', active)
  }
  settingsShell.classList.add('showing-panel')
  if (matchMedia('(max-width: 700px)').matches) window.scrollTo({ top: 0, behavior: 'smooth' })
}

for (const item of settingsNavItems) item.addEventListener('click', () => showSettingsPanel(item.dataset.settingsTarget!))
$('settings-mobile-back').addEventListener('click', () => settingsShell.classList.remove('showing-panel'))

let settingsSavedTimer: number | undefined

function renderSettingsSaveState(key: 'settings.saved' | 'settings.saving' | 'settings.saveError', kind: 'is-saved' | 'is-saving' | 'is-error'): void {
  const state = $('settings-save-state')
  state.className = `settings-save-state ${kind}`
  const copy = state.querySelector<HTMLElement>('span:last-child')
  if (copy) copy.textContent = t(key)
}

function markSettingsSaving(): void {
  window.clearTimeout(settingsSavedTimer)
  renderSettingsSaveState('settings.saving', 'is-saving')
  settingsSavedTimer = window.setTimeout(markSettingsSaved, 280)
}

function markSettingsSaved(): void {
  window.clearTimeout(settingsSavedTimer)
  renderSettingsSaveState('settings.saved', 'is-saved')
}

$<HTMLSelectElement>('settings-theme').value = themePreference
$<HTMLSelectElement>('settings-language').value = getLocale()
$<HTMLSelectElement>('settings-theme').addEventListener('change', (event) => {
  themePreference = (event.target as HTMLSelectElement).value as ThemePreference
  window.localStorage.setItem('opusweave.theme', themePreference)
  renderThemePreference()
  markSettingsSaved()
})
$<HTMLSelectElement>('settings-language').addEventListener('change', (event) => {
  if ((event.target as HTMLSelectElement).value !== getLocale()) localeButton.click()
})

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
let bundledPianoReady = false
let builtInGmReady = false
let customSoundFontName: string | null = null
const BUILT_IN_SOUND_FONT_NAME = 'FreePiano mda Piano + FluidR3Mono GM'
let timelineModel: ScoreViewModel | null = null
let timelineBeatWidth = 64
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

const initialWorkspaceState: WorkspaceState = {
  owt: DEFAULT_OWT_SCORE,
  documentVersion: 0,
  selectedRanges: [],
  midiLoaded: false,
  recording: false,
  transport: { kind: 'idle', positionSeconds: 0, loop: false },
  improv: { kind: 'off' },
  composition: { kind: 'idle', mode: 'sketch' },
}
const workspaceStore = new WorkspaceStore(initialWorkspaceState)
const transportController = new TransportController(workspaceStore, {
  pause: () => engine?.pause(),
  stop: () => engine?.stop(),
  panic: () => engine?.panic(),
  clearPlaybackMapping: clearOwtPlaybackContext,
})
const improvController = new ImprovController(workspaceStore, {
  abortRequest: () => improvAbortController?.abort(),
  stopPlayback: () => engine?.stop(),
})

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
let owtHasErrors = false
let selectionPlaybackTimer: number | undefined
type ScoreViewId = 'owt' | 'timeline' | 'staff' | 'jianpu'
const SCORE_VIEW_ORDER: readonly ScoreViewId[] = ['owt', 'timeline', 'staff', 'jianpu']
const SCORE_VIEW_ICONS: Record<ScoreViewId, string> = { owt: '<>', timeline: '▥', staff: '𝄞', jianpu: '1' }
const SCORE_VIEW_PREFERENCE_KEY = 'opusweave.score-view'
const scoreViewTabs = [...document.querySelectorAll<HTMLButtonElement>('[data-score-view-target]')]
const scoreViewPanels = [...document.querySelectorAll<HTMLElement>('[data-score-view]')]
const scoreViewCycleButton = $<HTMLButtonElement>('btn-score-view-cycle')
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
    const token = owtPlaybackTokens.find((item) => item.playbackId === element.dataset.owtEvent)
    if (token) {
      const raw = owtEditor.value.slice(token.start, token.end)
      attachSourceHover(element, raw, () => describeOwtSourceToken(raw, t))
    }
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
  document.querySelectorAll<HTMLElement>('#timeline-tracks [data-owt-event]').forEach((element) => element.classList.remove('is-selected'))
  if (!timelineModel) return
  for (const token of scoreCursorTokens) {
    const trackIndex = Number(token.playbackId.split(':', 1)[0])
    const event = document.querySelector<HTMLElement>(`#timeline-tracks [data-owt-event="${CSS.escape(token.playbackId)}"]`)
    if (!event || !Number.isInteger(trackIndex)) continue
    event.classList.add('is-selected')
    const cursor = document.createElement('span')
    cursor.className = 'timeline-track-cursor is-playing'
    cursor.dataset.trackIndex = String(trackIndex)
    cursor.style.left = event.style.left
    cursor.style.top = `${34 + trackIndex * 62}px`
    cursor.style.height = '62px'
    root.appendChild(cursor)
  }
}

function syncTimelineFromCurrentOwt(): boolean {
  const result = parseOwt(owtEditor.value)
  if (!result.document) {
    timelineModel = null
    renderTimelineView()
    setTranslatedStatus('timeline-status', 'scoreViews.timelineInvalid', {
      error: result.diagnostics.find((item) => item.severity === 'error')?.message ?? t('scoreViews.invalid'),
    }, 'err')
    return false
  }
  timelineModel = buildScoreViewModel(result.document)
  owtPlaybackTokens = buildOwtPlaybackMap(owtEditor.value, result.document)
  scoreCursorTokens = cursorOwtPlaybackTokens(owtPlaybackTokens, scoreCursorSeconds)
  scoreCursorRanges = scoreCursorTokens.map(({ start, end }) => ({ start, end }))
  timelineOwtRevision = owtRevision
  renderTimelineView()
  setTranslatedStatus('timeline-status', 'scoreViews.timelineSynced', {}, 'ok')
  return true
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
  renderScoreViewCycleButton()
  if (persist) window.localStorage.setItem(SCORE_VIEW_PREFERENCE_KEY, view)
}

function nextScoreView(view: ScoreViewId = activeScoreView): ScoreViewId {
  return SCORE_VIEW_ORDER[(SCORE_VIEW_ORDER.indexOf(view) + 1) % SCORE_VIEW_ORDER.length]!
}

function renderScoreViewCycleButton(): void {
  const next = nextScoreView()
  const currentLabel = t(`scoreViews.${activeScoreView}`)
  const nextLabel = t(`scoreViews.${next}`)
  const action = t('scoreViews.cycle', { current: currentLabel, next: nextLabel })
  const icon = $<HTMLElement>('score-view-cycle-icon')
  icon.textContent = SCORE_VIEW_ICONS[activeScoreView]
  icon.classList.toggle('text-icon', activeScoreView === 'owt' || activeScoreView === 'jianpu')
  $('score-view-cycle-label').textContent = currentLabel
  scoreViewCycleButton.title = action
  scoreViewCycleButton.setAttribute('aria-label', action)
}

function cycleScoreView(): void {
  showScoreView(nextScoreView())
}

for (const tab of scoreViewTabs) tab.addEventListener('click', () => showScoreView(tab.dataset.scoreViewTarget as ScoreViewId))
scoreViewCycleButton.addEventListener('click', cycleScoreView)
$('btn-score-view-play').addEventListener('click', () => void Promise.resolve(handleModalCommand('play-pause')).catch((error) => {
  setTranslatedStatus('owt-status', 'owt.error', { error: error instanceof Error ? error.message : String(error) }, 'err')
}))

$('btn-loop-playback').addEventListener('click', () => {
  loopPlayback = !loopPlayback
  transportController.setLoop(loopPlayback)
  if (improvSession.state !== 'responding') engine?.setLooping(loopPlayback)
  renderLoopPlaybackUi()
  setTranslatedStatus('owt-status', loopPlayback ? 'playback.loopOn' : 'playback.loopOff', {}, 'ok')
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

type SemanticEditMode = 'replace' | 'insert-before' | 'insert-after'
let semanticEditMode: SemanticEditMode | null = null

const SEMANTIC_EDIT_BUTTONS = ['btn-owt-replace-play', 'btn-owt-insert-before', 'btn-owt-insert-after'] as const

function semanticEditButton(mode: SemanticEditMode): string {
  return mode === 'replace' ? 'btn-owt-replace-play' : mode === 'insert-before' ? 'btn-owt-insert-before' : 'btn-owt-insert-after'
}

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
  semanticEditMode = null
  for (const id of SEMANTIC_EDIT_BUTTONS) {
    const button = $<HTMLButtonElement>(id)
    button.classList.remove('active')
    button.setAttribute('aria-pressed', 'false')
  }
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

function armSemanticPerformanceEdit(mode: SemanticEditMode): void {
  if (semanticEditMode === mode) {
    cancelSemanticPerformanceReplacement(true)
    return
  }
  if (!selectedSemanticObject('event')) {
    setTranslatedStatus('owt-edit-status', 'simpleEdit.eventOnly', {}, 'warn')
    return
  }
  semanticEditMode = mode
  for (const id of SEMANTIC_EDIT_BUTTONS) {
    const button = $<HTMLButtonElement>(id)
    const active = id === semanticEditButton(mode)
    button.classList.toggle('active', active)
    button.setAttribute('aria-pressed', String(active))
  }
  setTranslatedStatus('owt-edit-status', 'simpleEdit.playNow', {}, 'warn')
  $('live-panel').scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function handleSemanticPerformanceNote(data: Uint8Array): boolean {
  if (!semanticEditMode || (data[0]! & 0xf0) !== 0x90 || (data[2] ?? 0) === 0) return false
  const object = selectedSemanticObject('event')
  if (!object) { cancelSemanticPerformanceReplacement(); return false }
  const current = owtEditor.value.slice(object.start, object.end)
  const colon = current.lastIndexOf(':')
  if (colon < 0) { cancelSemanticPerformanceReplacement(); return false }
  const played = noteName(data[1]!)
  const mode = semanticEditMode
  if (mode === 'replace') {
    const replacement = replaceOwtEventPitch(current, played)
    if (!replacement) { cancelSemanticPerformanceReplacement(); return false }
    modalEditor.replaceTextRange(object.start, object.end, replacement)
    selectSemanticAt(object.start)
    setTranslatedStatus('owt-edit-status', 'simpleEdit.playReplaced', { note: played }, 'ok')
  } else {
    const token = `${played}${current.slice(colon)}`
    if (mode === 'insert-before') modalEditor.replaceTextRange(object.start, object.start, `${token} `)
    else modalEditor.replaceTextRange(object.end, object.end, ` ${token}`)
    selectSemanticAt(mode === 'insert-before' ? object.start : object.end)
    setTranslatedStatus('owt-edit-status', 'simpleEdit.inserted', {}, 'ok')
  }
  cancelSemanticPerformanceReplacement()
  return true
}

$('btn-ai-improvise').addEventListener('click', () => {
  if (improvSession.active) stopConversationalImprov()
  else startConversationalImprov()
})
$('btn-owt-delete-object').addEventListener('click', deleteSelectedSemanticObject)
$('btn-owt-replace-play').addEventListener('click', () => armSemanticPerformanceEdit('replace'))
$('btn-owt-insert-before').addEventListener('click', () => armSemanticPerformanceEdit('insert-before'))
$('btn-owt-insert-after').addEventListener('click', () => armSemanticPerformanceEdit('insert-after'))

const recorder = new MidiRecorder()
const improvSession = new ConversationalImprovSession()
let improvPhraseTimer: number | undefined
let improvAbortController: AbortController | undefined
let improvRequestSequence = 0
let improvScoreText = ''
let improvResponseStreaming = false
const mapping = new MappingEngine()
let practiceSession: PracticeSession | null = null
let practiceExpectedNotes: number[] = []
const midiLearn = new MidiLearn(window.localStorage)
const profiles: DeviceProfile[] = [midiplusTinyPlusProfile()]
let activeProfile: DeviceProfile | null = null
const PARAM_LABEL_KEYS: Record<string, string> = {
  'master-volume': 'params.masterVolume',
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
      transportController.finish()
      setPlaybackUi(false)
      setTranslatedStatus('timeline-status', 'playback.finished', {}, 'ok')
      updateTimelinePlayhead(scoreCursorSeconds, engine?.getPlaybackPosition()?.duration ?? 0)
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
  transportController.updatePosition(time)
  $<HTMLProgressElement>('progress').value = duration > 0 ? (time / duration) * 1000 : 0
  $<HTMLProgressElement>('header-playback-progress').value = duration > 0 ? (time / duration) * 1000 : 0
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
      markSettingsSaved()
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
  $<HTMLButtonElement>('btn-return-to-start').disabled = scoreCursorSeconds <= 0 && !playing
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
  if (!handleSemanticPerformanceNote(remapped)) handleConversationalImprovInput(remapped, timestampMs)

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
  const permissionCard = $('midi-permission-card')
  const configuredView = $('midi-configured-view')
  permissionCard.hidden = state.permissionGranted
  configuredView.hidden = !state.permissionGranted
  $<HTMLButtonElement>('btn-request-midi').disabled = !state.supported
  const midiNavState = $('settings-midi-state')
  midiNavState.textContent = t(state.permissionGranted ? 'status.connected' : 'settings.notEnabled')
  midiNavState.classList.toggle('ok', state.permissionGranted)
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

$('btn-refresh-midi').addEventListener('click', () => {
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

type BuiltInSoundFontState = 'loading' | 'ready' | 'unavailable'

function setBuiltInSoundFontState(state: BuiltInSoundFontState): void {
  $('built-in-soundfont').dataset.state = state
  setTranslatedText('built-in-soundfont-state', `sound.state${state[0]!.toUpperCase()}${state.slice(1)}`)
  $<HTMLButtonElement>('btn-retry-built-in-soundfont').hidden = state !== 'unavailable'
}

async function loadBundledPiano(): Promise<void> {
  if (bundledPianoReady) return
  const response = await fetch(freePianoSoundFontUrl)
  if (!response.ok) throw new Error(`mda Piano: HTTP ${response.status}`)
  const e = await ensureEngine()
  await e.loadSoundBank(await response.arrayBuffer(), 'FreePiano mda Piano')
  bundledPianoReady = true
  setTranslatedText('st-audio', 'status.readyAudio')
  populatePresets()
}

async function loadBuiltInSoundFont(): Promise<void> {
  if (builtInGmReady) return
  setBuiltInSoundFontState('loading')
  setTranslatedStatus('sf-status', 'sound.builtInLoading', {}, 'warn')
  // Start the large request immediately, but keep it independent from the
  // small piano layer and from application startup.
  const gmResponsePromise = fetch(builtInGmSoundFontUrl)

  try {
    await loadBundledPiano()
  } catch (err) {
    console.warn('FreePiano piano layer unavailable', err)
  }

  try {
    const gmResponse = await gmResponsePromise
    if (!gmResponse.ok) throw new Error(`FluidR3Mono GM: HTTP ${gmResponse.status}`)
    const e = await ensureEngine()
    const data = await gmResponse.arrayBuffer()
    const info = e.hasSoundFont()
      ? await e.addSoundBankLayer(data, 'fluid-r3-mono-gm', BUILT_IN_SOUND_FONT_NAME, false)
      : await e.loadSoundBank(data, 'FluidR3Mono GM')
    builtInGmReady = true
    setBuiltInSoundFontState('ready')
    setTranslatedText('st-audio', 'status.readyAudio')
    setTranslatedStatus('sf-status', 'sound.builtInReady', { count: info.presetCount }, 'ok')
    if (customSoundFontName) {
      setTranslatedText('st-soundfont', 'sound.summary', { name: customSoundFontName, count: info.presetCount })
    }
    populatePresets()
  } catch (err) {
    setBuiltInSoundFontState('unavailable')
    setTranslatedStatus('sf-status', bundledPianoReady ? 'sound.builtInUnavailable' : 'sound.builtInError', {
      error: err instanceof Error ? err.message : String(err),
    }, 'warn')
    if (bundledPianoReady) setTranslatedText('st-soundfont', 'sound.pianoOnly')
  }
}

$<HTMLAnchorElement>('fluidr3mono-license').href = builtInGmLicenseUrl

$<HTMLButtonElement>('btn-retry-built-in-soundfont').addEventListener('click', () => {
  if (builtInSoundFontPromise && $('built-in-soundfont').dataset.state === 'loading') return
  builtInSoundFontPromise = loadBuiltInSoundFont()
})

document.querySelectorAll<HTMLButtonElement>('[data-soundfont-download]').forEach((button) => {
  button.addEventListener('click', () => {
    const url = button.dataset.soundfontDownload
    if (!url) return
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.target = '_blank'
    anchor.rel = 'noopener noreferrer'
    anchor.click()
    const name = button.closest('.soundfont-download-option')?.querySelector('strong')?.textContent ?? 'SoundFont'
    setTranslatedStatus('sf-status', 'sound.downloadOpened', { name }, 'warn')
  })
})

$<HTMLInputElement>('sf-file').addEventListener('change', async (ev) => {
  const file = (ev.target as HTMLInputElement).files?.[0]
  if (!file) return
  setTranslatedStatus('sf-status', 'sound.loading', { file: file.name }, 'warn')
  try {
    const e = await ensureEngine()
    const info = await e.loadSoundBank(await file.arrayBuffer(), file.name)
    customSoundFontName = info.name
    setTranslatedStatus('sf-status', 'sound.loaded', { name: info.name, count: info.presetCount }, 'ok')
    populatePresets()
  } catch (err) {
    setTranslatedStatus('sf-status', 'sound.error', { error: err instanceof Error ? err.message : String(err) }, 'err')
  }
})

const GM_PRESET_FAMILIES = [
  { emoji: '🎹', key: 'sound.family.piano' },
  { emoji: '🔔', key: 'sound.family.chromaticPercussion' },
  { emoji: '⛪', key: 'sound.family.organ' },
  { emoji: '🎸', key: 'sound.family.guitar' },
  { emoji: '🎸', key: 'sound.family.bass' },
  { emoji: '🎻', key: 'sound.family.strings' },
  { emoji: '🎼', key: 'sound.family.ensemble' },
  { emoji: '🎺', key: 'sound.family.brass' },
  { emoji: '🎷', key: 'sound.family.reed' },
  { emoji: '🪈', key: 'sound.family.pipe' },
  { emoji: '⚡', key: 'sound.family.synthLead' },
  { emoji: '🌌', key: 'sound.family.synthPad' },
  { emoji: '✨', key: 'sound.family.synthEffects' },
  { emoji: '🪕', key: 'sound.family.ethnic' },
  { emoji: '🥁', key: 'sound.family.percussive' },
  { emoji: '🌊', key: 'sound.family.soundEffects' },
] as const

function presetFamily(program: number): typeof GM_PRESET_FAMILIES[number] {
  return GM_PRESET_FAMILIES[Math.max(0, Math.min(15, Math.floor(program / 8)))]!
}

function appendGroupedPresets(
  select: HTMLSelectElement,
  patches: readonly { program: number; name: string }[],
): void {
  const groups = new Map<number, HTMLOptGroupElement>()
  for (const patch of patches) {
    const familyIndex = Math.max(0, Math.min(15, Math.floor(patch.program / 8)))
    let group = groups.get(familyIndex)
    if (!group) {
      const family = presetFamily(patch.program)
      group = document.createElement('optgroup')
      group.label = `${family.emoji} ${t(family.key)}`
      groups.set(familyIndex, group)
      select.appendChild(group)
    }
    const option = document.createElement('option')
    option.value = String(patch.program)
    option.textContent = `${patch.program}: ${patch.name}`
    group.appendChild(option)
  }
}

function populatePresets(): void {
  const sel = $<HTMLSelectElement>('preset-select')
  sel.disabled = true
  sel.innerHTML = `<option value="">${t(engine?.hasSoundFont() ? 'sound.presets' : 'sound.initializing')}</option>`
  if (!engine?.hasSoundFont()) return
  const patches = engine.listPresets?.() ?? []
  appendGroupedPresets(sel, patches)
  sel.disabled = patches.length === 0
}

$<HTMLSelectElement>('preset-select').addEventListener('change', (ev) => {
  const program = Number((ev.target as HTMLSelectElement).value)
  if (Number.isInteger(program)) engine?.send(new Uint8Array([0xc0, program]))
})

$<HTMLInputElement>('master-volume').addEventListener('input', (ev) => {
  const value = Number((ev.target as HTMLInputElement).value)
  $<HTMLOutputElement>('master-volume-value').value = `${value}%`
  markSettingsSaving()
  void ensureEngine().then((e) => e.setMasterVolume(value / 100))
})

$('btn-test-audio').addEventListener('click', async () => {
  const e = await ensureEngine()
  e.send(new Uint8Array([0x90, 60, 96]))
  window.setTimeout(() => e.send(new Uint8Array([0x80, 60, 0])), 480)
})

// ─── OWT score timeline ──────────────────────────────────────────────────────

function timelineMeasureStarts(model: ScoreViewModel): number[] {
  const starts: number[] = []
  let beat = 0
  for (const measure of model.tracks[0]?.measures ?? []) {
    starts.push(beat)
    beat += measure.quarterLength
  }
  return starts
}

function renderTimelineView(): void {
  const list = $<HTMLDivElement>('track-list')
  const content = $<HTMLDivElement>('timeline-content')
  const ruler = $<HTMLDivElement>('timeline-ruler')
  const tracks = $<HTMLDivElement>('timeline-tracks')
  list.replaceChildren()
  ruler.replaceChildren()
  tracks.replaceChildren()
  $('arranger-grid').classList.toggle('has-score', Boolean(timelineModel))
  if (!timelineModel) {
    content.style.width = '100%'
    updateTimelineCursorHighlight()
    return
  }

  const measureStarts = timelineMeasureStarts(timelineModel)
  const measures = timelineModel.tracks[0]?.measures ?? []
  const totalBeats = Math.max(16, (measureStarts.at(-1) ?? 0) + (measures.at(-1)?.quarterLength ?? 0))
  content.style.width = `${totalBeats * timelineBeatWidth}px`
  content.style.setProperty('--beat-width', `${timelineBeatWidth}px`)

  for (let index = 0; index < measures.length; index++) {
    const measure = measures[index]!
    const start = measureStarts[index] ?? 0
    const bar = document.createElement('div')
    bar.className = 'ruler-beat bar'
    bar.style.left = `${start * timelineBeatWidth}px`
    const label = document.createElement('span')
    label.textContent = String(measure.number)
    bar.appendChild(label)
    ruler.appendChild(bar)
    for (let beat = 1; beat < measure.quarterLength; beat++) {
      const marker = document.createElement('div')
      marker.className = 'ruler-beat'
      marker.style.left = `${(start + beat) * timelineBeatWidth}px`
      ruler.appendChild(marker)
    }
  }

  for (let trackIndex = 0; trackIndex < timelineModel.tracks.length; trackIndex++) {
    const track = timelineModel.tracks[trackIndex]!
    const events = track.measures.flatMap((measure) => measure.events)
    const notes = events.filter((event) => event.kind === 'note')
    const rests = events.length - notes.length
    const header = document.createElement('div')
    header.className = 'track-header'
    const copy = document.createElement('div')
    copy.className = 'track-header-copy'
    const name = document.createElement('strong')
    name.textContent = track.name
    const meta = document.createElement('span')
    meta.textContent = t('arranger.eventSummary', { notes: notes.length, rests })
    copy.append(name, meta)
    header.appendChild(copy)
    list.appendChild(header)

    const lane = document.createElement('div')
    lane.className = 'timeline-track'
    lane.dataset.trackIndex = String(trackIndex)
    const pitches = notes.flatMap((event) => event.pitches)
    const minPitch = pitches.length > 0 ? Math.min(...pitches) : 60
    const maxPitch = pitches.length > 0 ? Math.max(...pitches) : 72
    const pitchSpan = Math.max(1, maxPitch - minPitch)
    for (const measure of track.measures) {
      const measureStart = measureStarts[measure.number - 1] ?? 0
      for (const event of measure.events) {
        const block = document.createElement('span')
        block.className = event.kind === 'rest' ? 'timeline-note timeline-rest' : 'timeline-note'
        block.dataset.owtEvent = event.playbackId
        block.tabIndex = 0
        block.setAttribute('role', 'button')
        const token = owtPlaybackTokens.find((item) => item.playbackId === event.playbackId)
        const raw = token ? owtEditor.value.slice(token.start, token.end) : event.kind === 'rest' ? 'R' : event.pitches.map(noteName).join(' ')
        block.setAttribute('aria-label', raw)
        block.style.left = `${(measureStart + event.beat) * timelineBeatWidth}px`
        block.style.width = `${Math.max(3, event.duration * timelineBeatWidth)}px`
        block.style.top = event.kind === 'rest'
          ? '26px'
          : `${7 + (1 - (Math.max(...event.pitches) - minPitch) / pitchSpan) * 40}px`
        if (token) {
          block.addEventListener('click', () => {
            modalEditor.selectRange(token.start, token.end, true)
            setScoreCursor(token.startSeconds, true)
          })
          attachSourceHover(block, raw, () => describeOwtSourceToken(raw, t))
        }
        lane.appendChild(block)
      }
    }
    tracks.appendChild(lane)
  }
  updateTimelineCursorHighlight()
}

$<HTMLDivElement>('timeline-viewport').addEventListener('scroll', (event) => {
  const viewport = event.currentTarget as HTMLDivElement
  $<HTMLDivElement>('track-list').style.transform = `translateY(${-viewport.scrollTop}px)`
})

$<HTMLInputElement>('arranger-zoom').addEventListener('input', (event) => {
  timelineBeatWidth = Number((event.target as HTMLInputElement).value)
  renderTimelineView()
})

function updateTimelinePlayhead(time: number, duration: number): void {
  const playhead = $<HTMLDivElement>('timeline-playhead')
  if (!timelineModel || duration <= 0 || time <= 0) {
    playhead.hidden = true
    return
  }
  playhead.hidden = false
  const width = $<HTMLDivElement>('timeline-content').getBoundingClientRect().width
  playhead.style.left = `${Math.max(0, Math.min(width, (time / duration) * width))}px`
}

function returnToBeginning(): void {
  transportController.returnToBeginning()
  setScoreCursor(0)
  $<HTMLProgressElement>('progress').value = 0
  $<HTMLProgressElement>('header-playback-progress').value = 0
  $<HTMLSpanElement>('playback-time').textContent = `0:00 / ${fmtTime(engine?.getPlaybackPosition().duration ?? 0)}`
  updateTimelinePlayhead(0, engine?.getPlaybackPosition().duration ?? 0)
  $<HTMLButtonElement>('btn-return-to-start').disabled = true
}

$('btn-return-to-start').addEventListener('click', returnToBeginning)

// ─── OpusWeave Text workspace ────────────────────────────────────────────────

function renderOwtDiagnostics(diagnostics: Array<{ line: number; column: number; severity: string; code: string; message: string }>): void {
  owtDiagnostics = diagnostics.map(({ line, column }) => ({ line, column }))
  owtHasErrors = diagnostics.some((diagnostic) => diagnostic.severity === 'error')
  const repairVisible = owtHasErrors && Boolean(document.querySelector<HTMLElement>('[data-workspace-page="studio"]')?.classList.contains('active'))
  $<HTMLButtonElement>('btn-owt-repair').hidden = !repairVisible
  $<HTMLLabelElement>('owt-repair-options').hidden = !repairVisible || !diagnostics.some((diagnostic) => diagnostic.code === 'score.bar.misaligned')
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

interface OwtPlaybackOptions {
  text?: string
  startSeconds?: number
}

async function playOwtRange(sourceRange?: { start: number; end?: number }, allowLoop = true, options: OwtPlaybackOptions = {}): Promise<void> {
  transportController.beginLoading(sourceRange ? 'selection' : 'owt')
  const sourceText = options.text ?? owtEditor.value
  const document = options.text === undefined ? parseEditorOwt() : parseOwt(sourceText).document
  if (!document) return
  const compiled = compileScoreText(sourceText)
  const fileName = owtFileName(document, 'mid')
  if (options.text === undefined && activeScoreView === 'timeline' && timelineOwtRevision !== owtRevision) syncTimelineFromCurrentOwt()
  owtPlaybackTokens = buildOwtPlaybackMap(sourceText, compiled.score)
  owtPlaybackRanges = []
  owtActiveRangeKey = ''
  let startSeconds = Math.max(0, options.startSeconds ?? 0)
  let endSeconds: number | undefined
  if (sourceRange && options.startSeconds === undefined) {
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
  transportController.markPlaying(sourceRange ? 'selection' : 'owt', startSeconds)
  setTranslatedStatus('owt-status', 'owt.playing', {}, 'ok')
  setTranslatedStatus('timeline-status', 'playback.playing')
}

function handleModalCommand(command: string, args = ''): void | Promise<void> {
  const normalized = command === 'w' ? 'save' : command
  switch (normalized) {
    case 'play': case 'play-pause':
      if (playbackActive) transportController.pause()
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
    case 'return-to-start': case 'stop': returnToBeginning(); return
    case 'save': $('btn-owt-save').click(); return
    case 'open': $<HTMLInputElement>('owt-file').click(); return
    case 'new': $('btn-owt-new-score').click(); return
    case 'validate': validateCurrentOwt(); return
    case 'format': formatEditorOwt(); return
    case 'export-midi': $('btn-owt-export-midi').click(); return
    case 'pause': transportController.pause(); return
    case 'perform': $('btn-owt-practice').click(); return
    case 'mode-score': setHelixEditingMode('normal'); return
    case 'mode-raw': setHelixEditingMode('raw'); return
    case 'improv': $('btn-ai-improvise').click(); return
    case 'view-owt': case 'view-timeline': case 'view-staff': case 'view-jianpu':
      document.querySelector<HTMLButtonElement>(`[data-score-view-target="${normalized.slice(5)}"]`)?.click(); return
    case 'view-next': cycleScoreView(); return
    case 'delete-object': $('btn-owt-delete-object').click(); return
    case 'replace-by-playing': $('btn-owt-replace-play').click(); return
    case 'insert-before': $('btn-owt-insert-before').click(); return
    case 'insert-after': $('btn-owt-insert-after').click(); return
    case 'play-example': void loadBuiltinExample(BUILTIN_OWT_EXAMPLES[0]?.id, true); return
    case 'timeline-restart': returnToBeginning(); return
    case 'ai-settings': showWorkspacePage('settings'); return
    case 'ai-compose': $('btn-ai-compose').click(); return
    case 'toggle-locale': localeButton.click(); return
    case 'toggle-theme': themeButton.click(); return
    case 'workspace-studio': showWorkspacePage('studio'); return
    case 'workspace-settings': showWorkspacePage('settings'); return
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
    case 'help': showOwtReferenceDialog(); return
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

$('btn-owt-repair').addEventListener('click', () => {
  const splitCrossBoundaryEvents = $<HTMLInputElement>('owt-repair-split-events').checked
  const result = repairCommonOwtErrors(owtEditor.value, { splitCrossBoundaryEvents })
  if (result.changes.length === 0) {
    setTranslatedStatus('owt-status', 'owt.repairNoChange', {}, 'warn')
    return
  }
  setOwtEditorText(result.text, true)
  validateCurrentOwt()
  setTranslatedStatus('owt-status', result.valid ? 'owt.repaired' : 'owt.repairPartial', { count: result.changes.length }, result.valid ? 'ok' : 'warn')
})

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
  const defaults = defaultOwtAiPromptTemplates(getLocale())
  try {
    const stored = JSON.parse(window.localStorage.getItem(AI_CONFIG_KEY) ?? '{}') as Partial<OwtAiConfig>
    return {
      ...DEFAULT_OWT_AI_CONFIG,
      ...stored,
      locale: getLocale(),
      promptTemplates: { ...defaults, ...stored.promptTemplates },
    }
  } catch {
    return { ...DEFAULT_OWT_AI_CONFIG, locale: getLocale(), promptTemplates: defaults }
  }
}

type AiProviderChoice = 'openai' | 'anthropic' | 'deepseek' | 'openrouter' | 'ollama' | 'llamacpp' | 'custom'

const AI_PROVIDER_DEFAULTS: Record<Exclude<AiProviderChoice, 'custom'>, { baseUrl: string; protocol: AiProtocol }> = {
  openai: { baseUrl: 'https://api.openai.com/v1', protocol: 'openai-responses' },
  anthropic: { baseUrl: 'https://api.anthropic.com/v1', protocol: 'anthropic-messages' },
  deepseek: { baseUrl: 'https://api.deepseek.com', protocol: 'openai-chat-completions' },
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', protocol: 'openai-chat-completions' },
  ollama: { baseUrl: 'http://127.0.0.1:11434', protocol: 'ollama-native' },
  llamacpp: { baseUrl: 'http://127.0.0.1:8080', protocol: 'openai-chat-completions' },
}

function inferAiProvider(config: Pick<OwtAiConfig, 'baseUrl' | 'protocol'>): AiProviderChoice {
  const url = config.baseUrl.toLowerCase()
  if (url.includes('api.openai.com')) return 'openai'
  if (url.includes('api.anthropic.com')) return 'anthropic'
  if (url.includes('api.deepseek.com')) return 'deepseek'
  if (url.includes('openrouter.ai')) return 'openrouter'
  if ((config.protocol ?? 'auto') === 'ollama-native' || url.includes(':11434')) return 'ollama'
  if (url.includes(':8080') || url.includes('llama.cpp')) return 'llamacpp'
  return config.baseUrl ? 'custom' : 'openai'
}

function renderAiProviderUi(provider: AiProviderChoice): void {
  const local = provider === 'ollama' || provider === 'llamacpp'
  $('ai-api-key-field').hidden = local
  $('ai-protocol-field').hidden = provider !== 'custom'
}

function renderAiConfig(config: OwtAiConfig): void {
  $<HTMLInputElement>('ai-endpoint').value = config.baseUrl
  $<HTMLInputElement>('ai-model').value = config.model
  $<HTMLInputElement>('ai-api-key').value = config.apiKey ?? ''
  $<HTMLSelectElement>('ai-protocol').value = config.protocol ?? 'auto'
  const provider = inferAiProvider(config)
  $<HTMLSelectElement>('ai-provider').value = provider
  renderAiProviderUi(provider)
  $<HTMLSelectElement>('ai-thinking-mode').value = config.thinkingMode ?? ''
  $<HTMLSelectElement>('ai-reasoning-effort').value = config.reasoningEffort ?? ''
  $<HTMLInputElement>('ai-temperature').value = config.temperature === undefined ? '' : String(config.temperature)
  $<HTMLInputElement>('ai-top-p').value = config.topP === undefined ? '' : String(config.topP)
  $<HTMLInputElement>('ai-max-tokens').value = String(config.maxTokens ?? DEFAULT_OWT_AI_CONFIG.maxTokens)
  $<HTMLInputElement>('ai-thinking-budget').value = String(config.thinkingBudgetTokens ?? DEFAULT_OWT_AI_CONFIG.thinkingBudgetTokens)
  $<HTMLInputElement>('ai-retry-count').value = String(config.retryCount ?? DEFAULT_OWT_AI_CONFIG.retryCount)
  $<HTMLInputElement>('ai-auto-repair').checked = config.autoRepair !== false
  const templates = { ...defaultOwtAiPromptTemplates(config.locale ?? getLocale()), ...config.promptTemplates }
  $<HTMLTextAreaElement>('ai-template-system').value = templates.system
  $<HTMLTextAreaElement>('ai-template-prompt').value = templates.prompt
  $<HTMLTextAreaElement>('ai-template-media').value = templates.scoreMedia
  $<HTMLTextAreaElement>('ai-template-improvise').value = templates.improvise
}

function optionalAiNumber(id: string, minimum: number, maximum: number): number | undefined {
  const input = $<HTMLInputElement>(id)
  if (input.value.trim() === '' || !Number.isFinite(input.valueAsNumber)) return undefined
  return Math.max(minimum, Math.min(maximum, input.valueAsNumber))
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
  const thinkingMode = $<HTMLSelectElement>('ai-thinking-mode').value
  const reasoningEffort = $<HTMLSelectElement>('ai-reasoning-effort').value
  return {
    baseUrl: $<HTMLInputElement>('ai-endpoint').value.trim(),
    model: $<HTMLInputElement>('ai-model').value.trim(),
    apiKey: $<HTMLInputElement>('ai-api-key').value || undefined,
    protocol: $<HTMLSelectElement>('ai-protocol').value as AiProtocol,
    locale: getLocale(),
    thinkingMode: thinkingMode ? thinkingMode as NonNullable<OwtAiConfig['thinkingMode']> : undefined,
    reasoningEffort: reasoningEffort ? reasoningEffort as NonNullable<OwtAiConfig['reasoningEffort']> : undefined,
    temperature: optionalAiNumber('ai-temperature', 0, 2),
    topP: optionalAiNumber('ai-top-p', 0, 1),
    maxTokens: Math.trunc(optionalAiNumber('ai-max-tokens', 1, 1_000_000) ?? 4096),
    thinkingBudgetTokens: Math.trunc(optionalAiNumber('ai-thinking-budget', 1024, 1_000_000) ?? 2048),
    retryCount: Math.max(0, Math.min(10, Math.trunc($<HTMLInputElement>('ai-retry-count').valueAsNumber || 0))),
    autoRepair: $<HTMLInputElement>('ai-auto-repair').checked,
    promptTemplates: currentAiPromptTemplates(),
  }
}

function persistAiConfig(): void {
  markSettingsSaving()
  try {
    const config = currentAiConfig()
    window.localStorage.setItem(AI_CONFIG_KEY, JSON.stringify(config))
    updateAiSettingsState()
  } catch {
    window.clearTimeout(settingsSavedTimer)
    renderSettingsSaveState('settings.saveError', 'is-error')
  }
}

function updateAiSettingsState(): void {
  const config = currentAiConfig()
  const aiState = $('settings-ai-state')
  aiState.textContent = t(config.baseUrl && config.model ? 'settings.configured' : 'settings.notConfigured')
  aiState.classList.toggle('ok', Boolean(config.baseUrl && config.model))
}

function aiTransport(signal?: AbortSignal): { signal: AbortSignal } {
  const timeout = AbortSignal.timeout(180_000)
  return { signal: signal ? AbortSignal.any([signal, timeout]) : timeout }
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
    updateConversationalImprovUi()
  }
}

function scheduleAiModelDiscovery(): void {
  window.clearTimeout(aiDiscoveryTimer)
  aiDiscoveryTimer = window.setTimeout(() => void refreshAiModels(), 500)
}

type AiComposeState = 'idle' | 'working' | 'success' | 'error'
let aiComposeState: AiComposeState = 'idle'
let aiBusy = false

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
  aiBusy = busy
  $<HTMLButtonElement>('btn-ai-test').disabled = busy
  $<HTMLButtonElement>('btn-ai-refresh-models').disabled = busy
  const composeButton = $<HTMLButtonElement>('btn-ai-compose')
  composeButton.disabled = busy
  composeButton.setAttribute('aria-busy', String(busy))
  $<HTMLButtonElement>('btn-ai-test-templates').disabled = busy
  updateConversationalImprovUi()
}

function createAiEditorStream(): { update: (text: string) => void; finish: (text: string) => void } {
  let frame = 0
  let pending = ''
  let recordInitialState = true
  const render = (): void => {
    frame = 0
    const scrollTop = owtEditor.scrollTop
    const scrollLeft = owtEditor.scrollLeft
    modalEditor.setText(pending, recordInitialState)
    recordInitialState = false
    owtEditor.scrollTop = scrollTop
    owtEditor.scrollLeft = scrollLeft
  }
  return {
    update: (text) => {
      pending = text
      if (!frame) frame = requestAnimationFrame(render)
    },
    finish: (text) => {
      if (frame) cancelAnimationFrame(frame)
      pending = text
      render()
    },
  }
}

type AiPlaybackStream = {
  update: (text: string) => void
  finish: (text: string) => Promise<boolean>
  cancel: (stopPlayback?: boolean) => void
}

function createAiPlaybackStream(allowLoop: boolean, onStarted?: () => void): AiPlaybackStream {
  let disposed = false
  let started = false
  let playbackStarted = false
  let playbackFailed = false
  let latestPlayableText = ''
  let playedText = ''
  let pendingRefreshText = ''
  let startPromise: Promise<void> | undefined
  let refreshPromise: Promise<void> | undefined

  const start = (text: string, loop: boolean, startSeconds = 0): Promise<void> => {
    playbackStarted = true
    return playOwtRange(undefined, loop, { text, startSeconds }).then(() => {
      playedText = text
      onStarted?.()
    })
  }

  const startInitial = (text: string): void => {
    started = true
    startPromise = start(text, false).catch(() => {
      playbackFailed = true
      started = false
    })
  }

  const refresh = (): void => {
    if (disposed || !started || refreshPromise || playbackFailed) return
    refreshPromise = (async () => {
      await startPromise
      while (!disposed && pendingRefreshText) {
        const text = pendingRefreshText
        pendingRefreshText = ''
        if (!text || text === playedText) continue
        const position = engine?.getPlaybackPosition().seconds ?? 0
        try {
          await start(text, false, position)
        } catch {
          playbackFailed = true
          break
        }
      }
    })().finally(() => {
      refreshPromise = undefined
      if (!disposed && pendingRefreshText && !playbackFailed) refresh()
    })
  }

  return {
    update: (text) => {
      if (disposed) return
      const prefix = completeOwtPrefix(text)
      if (!prefix || prefix.text === latestPlayableText) return
      latestPlayableText = prefix.text
      if (!started) startInitial(prefix.text)
      else {
        pendingRefreshText = prefix.text
        refresh()
      }
    },
    finish: async (text) => {
      if (disposed) return false
      const prefix = completeOwtPrefix(text)
      if (!prefix || playbackFailed) return false
      latestPlayableText = prefix.text
      if (!started) startInitial(prefix.text)
      else pendingRefreshText = prefix.text
      refresh()
      await startPromise
      await refreshPromise
      if (disposed || !prefix) return false
      try {
        // The stream previews use looping=false. Start the finalized score at
        // the current position when possible, while restarting from zero if
        // the preview has already reached its end.
        const position = engine?.getPlaybackPosition().seconds ?? 0
        const resumeAt = playbackActive || prefix.text !== playedText ? position : 0
        await start(prefix.text, allowLoop, resumeAt)
      } catch {
        playbackFailed = true
        return false
      }
      latestPlayableText = prefix.text
      return true
    },
    cancel: (stopPlayback = false) => {
      disposed = true
      pendingRefreshText = ''
      if (stopPlayback && playbackStarted && playbackActive) engine?.stop()
    },
  }
}

type AiReasoningStream = {
  begin: () => void
  update: (text: string) => void
  finish: () => void
  clear: () => void
}

const aiReasoningPanel = $<HTMLDetailsElement>('ai-reasoning-panel')
const aiReasoningLastLine = $('ai-reasoning-last-line')
const aiReasoningState = $('ai-reasoning-state')
const aiReasoningOutput = $('ai-reasoning-stream')
let activeAiReasoningStream: AiReasoningStream | undefined

function createAiReasoningStream(): AiReasoningStream {
  let pending = ''
  let disposed = false
  let hasRendered = false
  const setState = (key: string): void => {
    aiReasoningState.removeAttribute('data-i18n')
    setTranslatedText('ai-reasoning-state', key)
  }
  const lastLine = (text: string): string => {
    const lines = text.split(/\r?\n/)
    return [...lines].reverse().find((line) => line.trim().length > 0)?.trim() ?? ''
  }
  const render = (): void => {
    aiReasoningOutput.textContent = pending
    aiReasoningLastLine.textContent = lastLine(pending)
    aiReasoningOutput.scrollTop = aiReasoningOutput.scrollHeight
  }
  return {
    begin: () => {
      disposed = false
      hasRendered = false
      pending = ''
      aiReasoningOutput.textContent = ''
      aiReasoningLastLine.textContent = ''
      aiReasoningPanel.hidden = true
      aiReasoningPanel.open = false
      setState('ai.reasoningStreaming')
    },
    update: (text) => {
      if (disposed) return
      if (text.startsWith(pending)) {
        const delta = text.slice(pending.length)
        if (delta) aiReasoningOutput.append(document.createTextNode(delta))
      } else {
        aiReasoningOutput.textContent = text
      }
      pending = text
      aiReasoningLastLine.textContent = lastLine(pending)
      aiReasoningOutput.scrollTop = aiReasoningOutput.scrollHeight
      aiReasoningPanel.hidden = false
      if (!hasRendered) {
        aiReasoningPanel.open = true
        hasRendered = true
      }
      setState('ai.reasoningStreaming')
    },
    finish: () => {
      if (disposed) return
      if (!pending.trim()) {
        aiReasoningPanel.hidden = true
        aiReasoningPanel.open = false
        disposed = true
        return
      }
      disposed = true
      pending = pending.trim()
      render()
      setState('ai.reasoningComplete')
    },
    clear: () => {
      disposed = true
      hasRendered = false
      pending = ''
      aiReasoningOutput.textContent = ''
      aiReasoningLastLine.textContent = ''
      aiReasoningPanel.hidden = true
      aiReasoningPanel.open = false
      aiReasoningState.removeAttribute('data-text-key')
      aiReasoningState.removeAttribute('data-text-values')
      aiReasoningState.dataset.i18n = 'ai.reasoningStreaming'
      aiReasoningState.textContent = t('ai.reasoningStreaming')
    },
  }
}

function beginAiReasoningStream(): AiReasoningStream {
  activeAiReasoningStream?.clear()
  const stream = createAiReasoningStream()
  activeAiReasoningStream = stream
  stream.begin()
  return stream
}

function finishAiReasoningStream(stream: AiReasoningStream): void {
  if (activeAiReasoningStream !== stream) {
    stream.clear()
    return
  }
  stream.finish()
  activeAiReasoningStream = undefined
}

function clearAiReasoningStream(): void {
  activeAiReasoningStream?.clear()
  activeAiReasoningStream = undefined
}

async function applyAiRequest(request: OwtAiRequest, statusKey: string, statusValues: TranslationValues = {}): Promise<boolean> {
  if (improvSession.active) stopConversationalImprov(false)
  persistAiConfig()
  setAiComposeState('working')
  setAiBusy(true)
  setTranslatedStatus('ai-status', statusKey, statusValues, 'warn')
  const stream = createAiEditorStream()
  const reasoningStream = beginAiReasoningStream()
  const playbackStream = createAiPlaybackStream(true)
  clearOwtPlaybackContext()
  try {
    const text = await createOwtWithAi(currentAiConfig(), request, {
      ...aiTransport(),
      onUpdate: (value) => {
        stream.update(value)
        playbackStream.update(value)
      },
      onReasoningUpdate: reasoningStream.update,
    })
    stream.finish(text)
    renderOwtDiagnostics([])
    if (!validateEditorOwt()) throw new Error('AI OWT validation failed')
    setTranslatedStatus('ai-status', 'ai.applied', {}, 'ok')
    if (!await playbackStream.finish(text)) await playOwtRange()
    setAiComposeState('success')
    return true
  } catch (error) {
    setTranslatedStatus('ai-status', 'ai.error', { error: error instanceof Error ? error.message : String(error) }, 'err')
    setAiComposeState('error')
    playbackStream.cancel(true)
    return false
  } finally {
    playbackStream.cancel()
    finishAiReasoningStream(reasoningStream)
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
  const configured = hasConfiguredAiApi(currentAiConfig())
  const unavailable = !active && !configured
  const actionKey = active ? 'ai.improviseStop' : 'ai.improviseStart'
  workspaceStore.update({ improv: improvSession.state === 'off' ? { kind: 'off' } : { kind: improvSession.state } })
  const accessibleCopy = unavailable ? t('ai.improviseNeedsModel') : t(actionKey)
  button.disabled = unavailable || (aiBusy && !active)
  button.dataset.aiAvailable = String(configured)
  button.setAttribute('aria-pressed', String(active))
  button.classList.toggle('active', active)
  button.dataset.improvState = improvSession.state
  button.dataset.i18nAriaLabel = actionKey
  button.dataset.i18nTitle = actionKey
  button.setAttribute('aria-label', accessibleCopy)
  button.title = unavailable ? accessibleCopy : `${accessibleCopy} · ${t(stateKeys[improvSession.state])}`
  label.removeAttribute('data-i18n')
  label.textContent = active ? t(stateKeys[improvSession.state]) : t('simpleEdit.improvMode')
}

function stopConversationalImprov(showStatus = true): void {
  window.clearTimeout(improvPhraseTimer)
  improvAbortController?.abort()
  improvAbortController = undefined
  improvRequestSequence++
  improvResponseStreaming = false
  clearAiReasoningStream()
  improvScoreText = ''
  if (improvSession.state === 'responding') {
    engine?.stop()
    clearOwtPlaybackContext()
  }
  improvSession.stop()
  updateConversationalImprovUi()
  if (showStatus) setTranslatedStatus('ai-status', 'ai.improvStopped')
}

function startConversationalImprov(): void {
  if (!hasConfiguredAiApi(currentAiConfig())) {
    updateConversationalImprovUi()
    setTranslatedStatus('ai-status', 'ai.improviseNeedsModel', {}, 'warn')
    return
  }
  persistAiConfig()
  improvScoreText = ''
  improvResponseStreaming = false
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
    improvResponseStreaming = false
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
  improvResponseStreaming = true
  const reasoningStream = beginAiReasoningStream()
  const playbackStream = createAiPlaybackStream(false, () => {
    if (requestSequence !== improvRequestSequence || (improvSession.state !== 'thinking' && improvSession.state !== 'responding')) return
    improvSession.markResponding()
    updateConversationalImprovUi()
    setTranslatedStatus('ai-status', 'ai.improvResponding', {}, 'ok')
  })
  const responseStream = createAiEditorStream()
  try {
    const phraseOwt = extractMelodyFromRecording(phrase, {
      title: 'Human Call',
      grid: rational(1, 4),
      voiceStrategy: 'continuous',
    }).text
    const phraseDocument = parseOwt(phraseOwt).document
    if (!phraseDocument) throw new Error('Recorded phrase could not be converted to OWT')
    const currentDocument = improvScoreText ? parseOwt(improvScoreText).document : undefined
    const turnOwt = serializeOwt(appendOwtScores(currentDocument, phraseDocument))
    improvScoreText = turnOwt
    setOwtEditorText(turnOwt, true)
    renderOwtDiagnostics([])
    const text = await createOwtWithAi(currentAiConfig(), {
      task: 'improvise',
      instruction: '',
      currentOwt: turnOwt,
    }, {
      ...aiTransport(controller.signal),
      onUpdate: (value) => {
        if (requestSequence !== improvRequestSequence) return
        const prefix = completeOwtPrefix(value)
        if (!prefix) return
        const merged = serializeOwt(appendOwtScores(parseOwt(turnOwt).document, prefix.document))
        responseStream.update(merged)
        playbackStream.update(merged)
      },
      onReasoningUpdate: (value) => {
        if (requestSequence === improvRequestSequence) reasoningStream.update(value)
      },
    })
    if (requestSequence !== improvRequestSequence || (improvSession.state !== 'thinking' && improvSession.state !== 'responding')) return
    const responseDocument = parseOwt(text).document
    if (!responseDocument) throw new Error('AI returned invalid OWT')
    const merged = serializeOwt(appendOwtScores(parseOwt(turnOwt).document, responseDocument))
    responseStream.finish(merged)
    improvScoreText = merged
    renderOwtDiagnostics([])
    if (!validateEditorOwt()) throw new Error('AI OWT validation failed')
    if (!await playbackStream.finish(merged)) {
      improvSession.markResponding()
      updateConversationalImprovUi()
      setTranslatedStatus('ai-status', 'ai.improvResponding', {}, 'ok')
      await playOwtRange(undefined, false)
    }
  } catch (error) {
    playbackStream.cancel(true)
    if (requestSequence !== improvRequestSequence || !improvSession.active || improvSession.state === 'recording') return
    improvSession.markListening()
    updateConversationalImprovUi()
    setTranslatedStatus('ai-status', 'ai.error', { error: error instanceof Error ? error.message : String(error) }, 'err')
  } finally {
    if (requestSequence === improvRequestSequence) improvResponseStreaming = false
    playbackStream.cancel()
    finishAiReasoningStream(reasoningStream)
    if (requestSequence === improvRequestSequence) improvAbortController = undefined
  }
}

function handleConversationalImprovPlaybackEnded(): void {
  if (improvResponseStreaming || improvSession.state !== 'responding') return
  improvSession.markListening()
  updateConversationalImprovUi()
  setTranslatedStatus('ai-status', 'ai.improvListening', {}, 'ok')
}

const initialAiConfig = storedAiConfig()
renderAiConfig(initialAiConfig)
updateAiSettingsState()
updateConversationalImprovUi()
renderAiComposeButton()
for (const id of ['ai-model', 'ai-protocol', 'ai-thinking-mode', 'ai-reasoning-effort', 'ai-retry-count', 'ai-auto-repair']) {
  $(id).addEventListener('change', () => { persistAiConfig(); updateConversationalImprovUi() })
}
$('ai-model').addEventListener('input', () => { persistAiConfig(); updateConversationalImprovUi() })
for (const id of ['ai-temperature', 'ai-top-p', 'ai-max-tokens', 'ai-thinking-budget']) {
  $(id).addEventListener('input', persistAiConfig)
}
for (const id of ['ai-endpoint', 'ai-api-key']) {
  $(id).addEventListener('input', () => { persistAiConfig(); updateConversationalImprovUi(); scheduleAiModelDiscovery() })
}
for (const id of ['ai-template-system', 'ai-template-prompt', 'ai-template-media', 'ai-template-improvise']) {
  $(id).addEventListener('input', persistAiConfig)
}

$<HTMLSelectElement>('ai-provider').addEventListener('change', (event) => {
  const provider = (event.target as HTMLSelectElement).value as AiProviderChoice
  renderAiProviderUi(provider)
  if (provider !== 'custom') {
    const defaults = AI_PROVIDER_DEFAULTS[provider]
    $<HTMLInputElement>('ai-endpoint').value = defaults.baseUrl
    $<HTMLSelectElement>('ai-protocol').value = defaults.protocol
  }
  persistAiConfig()
  updateConversationalImprovUi()
  scheduleAiModelDiscovery()
})

$('btn-ai-key-visibility').addEventListener('click', () => {
  const input = $<HTMLInputElement>('ai-api-key')
  const visible = input.type === 'text'
  input.type = visible ? 'password' : 'text'
  $('btn-ai-key-visibility').textContent = t(visible ? 'settings.show' : 'settings.hide')
})

const promptTemplateTabs = [...document.querySelectorAll<HTMLButtonElement>('[data-prompt-target]')]
const promptTemplatePanels = [...document.querySelectorAll<HTMLElement>('[data-prompt-panel]')]
for (const tab of promptTemplateTabs) {
  tab.addEventListener('click', () => {
    const target = tab.dataset.promptTarget
    for (const item of promptTemplateTabs) {
      const active = item === tab
      item.classList.toggle('active', active)
      item.setAttribute('aria-selected', String(active))
    }
    for (const panel of promptTemplatePanels) {
      const active = panel.dataset.promptPanel === target
      panel.hidden = !active
      panel.classList.toggle('active', active)
    }
  })
}
$('btn-ai-reset-templates').addEventListener('click', () => {
  renderAiConfig({ ...currentAiConfig(), promptTemplates: defaultOwtAiPromptTemplates(getLocale()) })
  persistAiConfig()
  setTranslatedStatus('ai-status', 'ai.promptTemplatesReset', {}, 'ok')
})
const promptTestCases = [
  { id: 'compose', instructionKey: 'ai.promptTest.composeInstruction', currentOwt: DEFAULT_OWT_SCORE },
  { id: 'edit', instructionKey: 'ai.promptTest.editInstruction', currentOwt: BUILTIN_OWT_EXAMPLES[0]!.text },
  { id: 'continue', instructionKey: 'ai.promptTest.continueInstruction', currentOwt: BUILTIN_OWT_EXAMPLES[1]!.text },
] as const
const aiPromptTestDialog = $<HTMLDialogElement>('ai-prompt-test-dialog')

function promptTestResultCard(id: string, instruction: string): HTMLElement {
  const card = document.createElement('article')
  card.className = 'ai-prompt-test-result running'
  card.dataset.testId = id
  const heading = document.createElement('div')
  heading.className = 'ai-prompt-test-result-head'
  const title = document.createElement('strong')
  title.textContent = t(`ai.promptTest.${id}Title`)
  const state = document.createElement('span')
  state.textContent = t('ai.promptTest.running')
  heading.append(title, state)
  const request = document.createElement('p')
  request.textContent = instruction
  const output = document.createElement('pre')
  card.append(heading, request, output)
  return card
}

function summarizePromptTestOwt(text: string): string {
  const parsed = parseOwt(text)
  if (!parsed.document) throw new Error(parsed.diagnostics.map((item) => `${item.line}:${item.column} ${item.message}`).join('; '))
  const notes = parsed.document.tracks.reduce((count, track) => count + track.events.filter((event) => event.kind === 'note').length, 0)
  if (parsed.document.tracks.length === 0 || notes === 0) throw new Error(t('ai.promptTest.noNotes'))
  return t('ai.promptTest.summary', { tracks: parsed.document.tracks.length, notes })
}

async function runPromptTemplateExamples(): Promise<void> {
  const config = currentAiConfig()
  const issues = validateOwtAiPromptTemplates(currentAiPromptTemplates())
  if (issues.length > 0) {
    const issue = issues[0]!
    throw new Error(issue.kind === 'empty'
      ? t('ai.promptTemplateEmpty', { field: issue.field })
      : t('ai.promptUnknownVariable', { field: issue.field, variable: issue.variable ?? '' }))
  }
  if (!hasConfiguredAiApi(config)) throw new Error(t('ai.promptTest.modelRequired'))
  persistAiConfig()
  const results = $('ai-prompt-test-results')
  results.replaceChildren()
  aiPromptTestDialog.showModal()
  setAiBusy(true)
  let passed = 0
  for (const testCase of promptTestCases) {
    const instruction = t(testCase.instructionKey)
    const card = promptTestResultCard(testCase.id, instruction)
    results.appendChild(card)
    const state = card.querySelector<HTMLElement>('.ai-prompt-test-result-head span')!
    const output = card.querySelector<HTMLPreElement>('pre')!
    try {
      const text = await createOwtWithAi(config, { task: 'prompt', instruction, currentOwt: testCase.currentOwt }, aiTransport())
      const summary = summarizePromptTestOwt(text)
      card.classList.replace('running', 'passed')
      state.textContent = t('ai.promptTest.passed')
      output.textContent = `${summary}\n\n${text}`
      passed++
    } catch (error) {
      card.classList.replace('running', 'failed')
      state.textContent = t('ai.promptTest.failed')
      output.textContent = error instanceof Error ? error.message : String(error)
    }
  }
  setAiBusy(false)
  setTranslatedStatus('ai-status', passed === promptTestCases.length ? 'ai.promptTest.complete' : 'ai.promptTest.incomplete', {
    passed,
    total: promptTestCases.length,
  }, passed === promptTestCases.length ? 'ok' : 'err')
}

$('btn-ai-test-templates').addEventListener('click', () => {
  void runPromptTemplateExamples().catch((error) => {
    setAiBusy(false)
    setTranslatedStatus('ai-status', 'ai.promptTemplatesInvalid', { error: error instanceof Error ? error.message : String(error) }, 'err')
  })
})
$('btn-ai-prompt-test-close').addEventListener('click', () => aiPromptTestDialog.close())
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
let fullCompositionWorkflow: ReturnType<typeof createFullCompositionWorkflow> | undefined

function applyFullCompositionResult(owt: string, updateEditor = true): void {
  if (updateEditor) setOwtEditorText(owt, true)
  validateCurrentOwt()
  aiComposeDialog.close()
  setAiComposeState('success')
}

function renderFullCompositionStage(stage: FullCompositionStage): void {
  workspaceStore.update({ composition: stage })
  const panel = $('ai-full-progress')
  panel.hidden = false
  const stageKey = stage.kind === 'composing' || stage.kind === 'repairing'
    ? `ai.full.${stage.kind}`
    : stage.kind === 'error' ? 'ai.failed' : `ai.full.${stage.kind}`
  $('ai-full-stage').textContent = t(stageKey, 'sectionId' in stage && stage.sectionId ? { section: stage.sectionId } : {})
  const plan = fullCompositionWorkflow?.plan
  if (!plan) return
  const completed = new Set('completed' in stage ? stage.completed : fullCompositionWorkflow?.composedSections.map((section) => section.id))
  const current = 'sectionId' in stage ? stage.sectionId : undefined
  const list = $<HTMLOListElement>('ai-full-sections')
  list.replaceChildren(...plan.sections.map((section) => {
    const item = document.createElement('li')
    const marker = completed.has(section.id) ? '✓' : current === section.id ? (stage.kind === 'error' ? '!' : '…') : '○'
    item.textContent = `${marker} ${section.name} · ${section.bars} bars · ${section.tempoStart}${section.tempoEnd ? `→${section.tempoEnd}` : ''} BPM`
    if (stage.kind === 'error' && current === section.id) {
      const retry = document.createElement('button')
      retry.type = 'button'
      retry.className = 'quiet'
      retry.textContent = t('sound.retry')
      retry.addEventListener('click', () => {
        retry.disabled = true
        const reasoningStream = beginAiReasoningStream()
        void fullCompositionWorkflow!.composeSection(section.id).then(() => {
          applyFullCompositionResult(fullCompositionWorkflow!.finalize().owt)
        }).catch((error: unknown) => {
          setStatus('ai-status', error instanceof Error ? error.message : String(error), 'err')
          retry.disabled = false
        }).finally(() => {
          finishAiReasoningStream(reasoningStream)
        })
      })
      item.append(' ', retry)
    }
    return item
  }))
}

function renderFullCompositionStream(update: FullCompositionStreamUpdate): void {
  if (update.kind === 'reasoning') activeAiReasoningStream?.update(update.text)
  else if (update.phase !== 'plan') activeFullCompositionStream?.update(update.text)
}

let activeFullCompositionStream: ReturnType<typeof createAiEditorStream> | undefined
const aiManualDialog = $<HTMLDialogElement>('ai-manual-dialog')
const aiManualForm = $<HTMLFormElement>('ai-manual-form')
const aiManualPrompt = $<HTMLTextAreaElement>('ai-manual-prompt')
const aiManualStatus = $<HTMLElement>('ai-manual-status')
const owtReferenceDialog = $<HTMLDialogElement>('owt-reference-dialog')

function renderOwtReference(): void {
  $('owt-reference-content').textContent = buildOwt01Reference(getLocale())
  const status = $('owt-reference-status')
  status.className = 'manual-ai-status'
  status.textContent = t('owt.referenceReady')
}

function showOwtReferenceDialog(): void {
  renderOwtReference()
  document.querySelector<HTMLDetailsElement>('.file-menu')?.removeAttribute('open')
  owtReferenceDialog.showModal()
  requestAnimationFrame(() => $('owt-reference-content').focus())
}

async function copyOwtReference(): Promise<void> {
  const status = $('owt-reference-status')
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable')
    await navigator.clipboard.writeText(buildOwt01Reference(getLocale()))
    status.className = 'manual-ai-status ok'
    status.textContent = t('owt.referenceCopied')
  } catch {
    const selection = window.getSelection()
    const range = document.createRange()
    range.selectNodeContents($('owt-reference-content'))
    selection?.removeAllRanges()
    selection?.addRange(range)
    status.className = 'manual-ai-status err'
    status.textContent = t('owt.referenceCopyFailed')
  }
}

renderOwtReference()
$('btn-owt-reference').addEventListener('click', showOwtReferenceDialog)
$('btn-owt-reference-close').addEventListener('click', () => owtReferenceDialog.close())
$('btn-owt-reference-copy').addEventListener('click', () => void copyOwtReference())
owtReferenceDialog.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' || (!event.ctrlKey && !event.metaKey)) return
  event.preventDefault()
  void copyOwtReference()
})

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
  $('ai-full-progress').hidden = true
  aiComposeDialog.showModal()
  requestAnimationFrame(() => aiPrompt.focus())
})

$('btn-ai-cancel').addEventListener('click', () => aiComposeDialog.close())
$('btn-ai-full-cancel').addEventListener('click', () => fullCompositionWorkflow?.cancel())
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
  const mode = new FormData(aiComposeForm).get('ai-compose-mode')
  if (mode !== 'full') {
    aiComposeDialog.close()
    void applyAiRequest({ task: 'prompt', instruction, currentOwt: owtEditor.value }, 'ai.working')
    return
  }
  persistAiConfig()
  aiComposeDialog.close()
  setAiComposeState('working')
  setAiBusy(true)
  setTranslatedStatus('ai-status', 'ai.working', {}, 'warn')
  activeFullCompositionStream = createAiEditorStream()
  const reasoningStream = beginAiReasoningStream()
  clearOwtPlaybackContext()
  fullCompositionWorkflow = createFullCompositionWorkflow(currentAiConfig(), { ...aiTransport(), onReasoningUpdate: (text) => activeAiReasoningStream?.update(text) }, renderFullCompositionStage, renderFullCompositionStream)
  void fullCompositionWorkflow.run(instruction).then(({ owt }) => {
    activeFullCompositionStream?.finish(owt)
    applyFullCompositionResult(owt, false)
    setTranslatedStatus('ai-status', 'ai.applied', {}, 'ok')
  }).catch((error: unknown) => {
    if (error instanceof DOMException && error.name === 'AbortError') return
    setStatus('ai-status', error instanceof Error ? error.message : String(error), 'err')
    setAiComposeState('error')
  }).finally(() => {
    activeFullCompositionStream = undefined
    finishAiReasoningStream(reasoningStream)
    setAiBusy(false)
  })
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
    for (const [rowIndex, rowKeys] of sectionSpec.rows.entries()) {
      const row = document.createElement('div')
      row.className = 'qwerty-row'
      row.style.setProperty('--keyboard-row-offset', `${(sectionSpec.rowOffsets?.[rowIndex] ?? 0) * 49}px`)
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
  // Computer-keyboard performance only owns unmodified keys. Leave Ctrl,
  // Command and Alt combinations to the browser, operating system, or the
  // focused editor so copy/paste and native editing shortcuts keep working.
  if (ev.ctrlKey || ev.metaKey || ev.altKey) return
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
    recorder.stopHeldNotes(performance.now())
    engine?.panic()
    keyboard.clearAll()
  }
})

window.addEventListener('beforeunload', () => {
  recorder.stopHeldNotes(performance.now())
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
renderTimelineView()
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
  void fetch('/api/startup-owt').then(async (response) => {
    if (response.status === 204 || !response.ok) return
    setOwtEditorText(await response.text(), true)
    validateEditorOwt()
    showScoreView('owt')
    setTranslatedStatus('owt-status', 'playback.clickToStart', {}, 'warn')
    window.addEventListener('pointerdown', () => $<HTMLButtonElement>('btn-score-view-play').click(), { once: true, capture: true })
  }).catch((err: unknown) => {
    setTranslatedStatus('owt-status', 'playback.error', { error: err instanceof Error ? err.message : String(err) }, 'err')
  })
}

// Guard: exported MIDI from a take must re-import — validated by round-trip test in the suite.
