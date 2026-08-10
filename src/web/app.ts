/**
 * OpusWeave browser app — orchestrates the engine, WebMIDI manager,
 * recorder, mapping engine and MIDI learn. No layer reaches into
 * spessasynth classes directly (the engine wraps them).
 */
import { SpessaSynthEngine } from '../audio/spessa-synth-engine.ts'
import { WebMidiManager, type MidiManagerState } from '../midi/web-midi-manager.ts'
import { MidiRecorder, takeToMidi, type RecordedTake } from '../domain/midi/midi-recorder.ts'
import { applyTrackMutes, importMidi, inspectMidi, type MidiInspection } from '../domain/midi/midi-import.ts'
import { MappingEngine, noteName, type ComputerKeyAssignment } from '../domain/devices/mapping-engine.ts'
import { MidiLearn } from '../domain/midi-learn.ts'
import { findProfileForPort, overrideControl, type DeviceProfile } from '../domain/devices/device-profile.ts'
import { midiplusTinyPlusProfile } from '../domain/devices/midiplus-tiny-plus.ts'
import { VirtualKeyboard } from './components/virtual-keyboard.ts'
import { enableHorizontalPointerScroll } from './components/horizontal-pointer-scroll.ts'
import type { BasicMIDI } from 'spessasynth_core'
import { resolveLocale, setLocale, t, translateDocument, type TranslationValues } from './i18n.ts'
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
  el.dataset.statusKey = key
  el.dataset.statusValues = JSON.stringify(values)
  el.textContent = t(key, values)
  el.className = `status${kind ? ` ${kind}` : ''}`
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
const initialLocale = resolveLocale(window.localStorage.getItem('opusweave.locale') ?? navigator.language)
setLocale(initialLocale)
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

localeButton.addEventListener('click', () => {
  const locale = document.documentElement.lang === 'en' ? 'zh-CN' : 'en'
  setLocale(locale)
  window.localStorage.setItem('opusweave.locale', locale)
  translateDocument()
  retranslateTrackedCopy()
  renderMidiState(midiManager.getState())
  renderTrackList()
  renderLearnBindings()
  populatePresets()
  renderComputerKeyMap()
  updateComputerMapToggleCopy()
  updateLanguageToggleCopy()
})

const workspaceNavLinks = [...document.querySelectorAll<HTMLAnchorElement>('[data-nav-target]')]
let navigationLockUntil = 0
let navigationFrame = 0

function setActiveWorkspaceNavigation(targetId: string): void {
  for (const link of workspaceNavLinks) {
    const active = link.dataset.navTarget === targetId
    link.classList.toggle('active', active)
    if (active) link.setAttribute('aria-current', 'location')
    else link.removeAttribute('aria-current')
  }
}

function updateWorkspaceNavigation(): void {
  if (performance.now() < navigationLockUntil) return
  const headerBottom = document.querySelector<HTMLElement>('.topbar')?.getBoundingClientRect().bottom ?? 0
  const targetIds = window.innerWidth <= 820
    ? ['midi-panel', 'playback-panel', 'live-panel']
    : ['playback-panel', 'live-panel']
  let closestId = targetIds[0]!
  let closestDistance = Number.POSITIVE_INFINITY

  for (const id of targetIds) {
    const target = document.getElementById(id)
    if (!target) continue
    const rect = target.getBoundingClientRect()
    if (rect.bottom <= headerBottom) continue
    const distance = Math.abs(rect.top - headerBottom - 12)
    if (distance < closestDistance) {
      closestDistance = distance
      closestId = id
    }
  }
  setActiveWorkspaceNavigation(closestId)
}

function scheduleWorkspaceNavigationUpdate(): void {
  cancelAnimationFrame(navigationFrame)
  navigationFrame = requestAnimationFrame(updateWorkspaceNavigation)
}

for (const link of workspaceNavLinks) {
  link.addEventListener('click', (event) => {
    const targetId = link.dataset.navTarget!
    const target = document.getElementById(targetId)
    if (!target) return
    event.preventDefault()
    navigationLockUntil = performance.now() + 700
    setActiveWorkspaceNavigation(targetId)
    target.scrollIntoView({ behavior: 'smooth', block: 'start' })
  })
}
window.addEventListener('scroll', scheduleWorkspaceNavigationUpdate, { passive: true })
window.addEventListener('resize', scheduleWorkspaceNavigationUpdate)

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

// ─── State ───────────────────────────────────────────────────────────────────

let engine: SpessaSynthEngine | null = null
let builtInSoundFontPromise: Promise<void> | null = null
const BUILT_IN_SOUND_FONT_NAME = 'FreePiano mda Piano + OpusWeave Micro GM'
let loadedMidi: BasicMIDI | null = null
let loadedInspection: MidiInspection | null = null
const mutedTracks = new Set<number>()
let take: RecordedTake | null = null
let playingTake = false

const recorder = new MidiRecorder()
const mapping = new MappingEngine()
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
    onPlaybackTime: (time, duration) => {
      $<HTMLProgressElement>('progress').value = duration > 0 ? (time / duration) * 1000 : 0
      $<HTMLSpanElement>('playback-time').textContent = `${fmtTime(time)} / ${fmtTime(duration)}`
    },
    onPlaybackEnded: () => {
      setPlaybackUi(false)
      setTranslatedStatus('midi-status', 'playback.finished', {}, 'ok')
    },
    onPlaybackState: (playing) => {
      clearPlaybackNotes()
      setPlaybackUi(playing)
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

function setPlaybackUi(playing: boolean): void {
  $<HTMLButtonElement>('btn-play').disabled = !loadedMidi
  $<HTMLButtonElement>('btn-pause').disabled = !playing
  $<HTMLButtonElement>('btn-stop').disabled = !playing
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

// ─── MIDI player ─────────────────────────────────────────────────────────────

$<HTMLInputElement>('midi-file').addEventListener('change', async (ev) => {
  const file = (ev.target as HTMLInputElement).files?.[0]
  if (!file) return
  setTranslatedStatus('midi-status', 'playback.loading', { file: file.name }, 'warn')
  try {
    const buf = await file.arrayBuffer()
    loadedMidi = importMidi(buf, file.name)
    loadedInspection = inspectMidi(buf, file.name)
    mutedTracks.clear()
    $<HTMLSpanElement>('st-file').textContent = file.name
    renderTrackList()
    const tempo = loadedInspection.tempos[0]?.bpm ?? 120
    $<HTMLSpanElement>('playback-tempo').textContent = `♩ ${tempo} BPM`
    setTranslatedStatus('midi-status', 'playback.loaded', {
      file: file.name,
      duration: fmtTime(loadedInspection.durationSeconds),
    }, 'ok')
    setPlaybackUi(false)
  } catch (err) {
    setTranslatedStatus('midi-status', 'playback.error', { error: err instanceof Error ? err.message : String(err) }, 'err')
  }
})

function renderTrackList(): void {
  const list = $<HTMLDivElement>('track-list')
  list.innerHTML = ''
  if (!loadedInspection) return
  for (const track of loadedInspection.tracks) {
    const row = document.createElement('div')
    row.className = `track-row${mutedTracks.has(track.index) ? ' muted' : ''}`
    const muteBtn = document.createElement('button')
    muteBtn.className = 'mute-btn'
    muteBtn.textContent = t(mutedTracks.has(track.index) ? 'playback.unmute' : 'playback.mute')
    muteBtn.addEventListener('click', () => {
      if (mutedTracks.has(track.index)) mutedTracks.delete(track.index)
      else mutedTracks.add(track.index)
      renderTrackList()
    })
    const name = document.createElement('span')
    name.className = 'track-name'
    name.textContent = track.name || t('playback.track', { index: track.index })
    const meta = document.createElement('span')
    meta.className = 'track-meta'
    meta.textContent = t('playback.trackMeta', {
      channels: track.channels.join(',') || '—',
      program: track.program ?? '—',
      notes: track.noteCount,
      cc: track.hasControlChanges ? ' cc' : '',
      pitchBend: track.hasPitchBend ? ' pb' : '',
    })
    row.append(muteBtn, name, meta)
    list.appendChild(row)
  }
}

$('btn-play').addEventListener('click', async () => {
  if (!loadedMidi) return
  try {
    const e = await ensureEngine()
    let source = loadedMidi
    if (mutedTracks.size > 0) source = applyTrackMutes(loadedMidi, mutedTracks)
    await e.playMidi(source.writeMIDI(), loadedMidi.fileName ?? 'song.mid')
    setPlaybackUi(true)
  } catch (err) {
    setTranslatedStatus('midi-status', 'playback.playError', { error: err instanceof Error ? err.message : String(err) }, 'err')
  }
})

$('btn-pause').addEventListener('click', () => engine?.pause())
$('btn-stop').addEventListener('click', () => {
  engine?.stop()
  $<HTMLProgressElement>('progress').value = 0
})
$('btn-restart').addEventListener('click', async () => {
  if (!loadedMidi) return
  engine?.stop()
  const e = await ensureEngine()
  let source = loadedMidi
  if (mutedTracks.size > 0) source = applyTrackMutes(loadedMidi, mutedTracks)
  await e.playMidi(source.writeMIDI(), loadedMidi.fileName ?? 'song.mid')
  setPlaybackUi(true)
})

// ─── Recording ───────────────────────────────────────────────────────────────

$('btn-record').addEventListener('click', () => {
  recorder.start(performance.now())
  take = null
  $<HTMLButtonElement>('btn-record').disabled = true
  $<HTMLButtonElement>('btn-record-stop').disabled = false
  $<HTMLButtonElement>('btn-record-export').disabled = true
  setTranslatedText('st-record', 'status.recording')
  setTranslatedStatus('record-status', 'record.recording', {}, 'warn')
})

$('btn-record-stop').addEventListener('click', () => {
  take = recorder.stop(performance.now())
  const hasEvents = take.events.length > 0
  $<HTMLButtonElement>('btn-record').disabled = false
  $<HTMLButtonElement>('btn-record-stop').disabled = true
  $<HTMLButtonElement>('btn-clear-take').disabled = !hasEvents
  $<HTMLButtonElement>('btn-play-take').disabled = !hasEvents
  $<HTMLButtonElement>('btn-record-export').disabled = !hasEvents
  setTranslatedText('st-record', 'status.idle')
  setTranslatedStatus('record-status', 'record.stopped', {
    events: take.events.length,
    duration: (take.durationMs / 1000).toFixed(2),
  }, 'ok')
})

$('btn-clear-take').addEventListener('click', () => {
  recorder.clear()
  take = null
  $<HTMLButtonElement>('btn-clear-take').disabled = true
  $<HTMLButtonElement>('btn-play-take').disabled = true
  $<HTMLButtonElement>('btn-record-export').disabled = true
  setTranslatedStatus('record-status', 'record.cleared')
})

$('btn-play-take').addEventListener('click', async () => {
  if (!take || take.events.length === 0) return
  const buf = takeToMidi(take)
  try {
    const e = await ensureEngine()
    if (!e.hasSoundFont()) {
      setTranslatedStatus('record-status', 'record.soundFontRequired', {}, 'warn')
      return
    }
    playingTake = true
    await e.playMidi(buf, 'take.mid')
    setTranslatedStatus('record-status', 'record.playing')
  } catch (err) {
    setTranslatedStatus('record-status', 'record.playError', { error: err instanceof Error ? err.message : String(err) }, 'err')
  }
  playingTake = false
})

$('btn-record-export').addEventListener('click', () => {
  if (!take) return
  const buf = takeToMidi(take)
  downloadBuffer(buf, 'opusweave-recording.mid', 'audio/midi')
  setTranslatedStatus('record-status', 'record.exported', {}, 'ok')
})

// ─── Computer keyboard (MappingEngine) ───────────────────────────────────────

const TEXT_INPUT: Record<string, true> = { INPUT: true, TEXTAREA: true, SELECT: true }
const VELOCITY_STEP = 10
const activeComputerNotes = new Map<string, Uint8Array>()
const pointerComputerKeys = new Set<string>()
const computerKeycaps = new Map<string, HTMLElement>()

const QWERTY_ROWS = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '='],
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p', '[', ']'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', ';', "'"],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.', '/'],
] as const
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
  button.textContent = computerMapExpanded ? '⌃' : '⌄'
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
  const assignments = new Map(mapping.listComputerKeyAssignments().map((assignment) => [assignment.key, assignment]))
  const actionLabels: Record<string, { label: string; velocity?: boolean }> = {
    a: { label: t('live.octaveDownKey') },
    k: { label: t('live.octaveUpKey') },
    f: { label: t('live.velocityDownKey'), velocity: true },
    '4': { label: t('live.velocityUpKey'), velocity: true },
  }

  for (const rowKeys of QWERTY_ROWS) {
    const row = document.createElement('div')
    row.className = 'qwerty-row'
    for (const keyName of rowKeys) {
      const assignment = assignments.get(keyName)
      const action = actionLabels[keyName]
      const keycap = document.createElement('span')
      keycap.className = 'computer-keycap'
      keycap.dataset.key = keyName

      if (assignment) {
        const pitchClass = ((assignment.note % 12) + 12) % 12
        if ([1, 3, 6, 8, 10].includes(pitchClass)) keycap.classList.add('accidental')
        keycap.dataset.note = String(assignment.note)
        keycap.title = `${keyName.toUpperCase()} → ${noteName(assignment.note)} (${assignment.note})`
        if (isComputerKeyVisuallyActive(keyName)) keycap.classList.add('active')
      } else if (action) {
        keycap.classList.add('action')
        if (action.velocity) keycap.classList.add('velocity-action')
        keycap.title = action.label
      } else {
        keycap.classList.add('unmapped')
      }

      const key = document.createElement('kbd')
      key.textContent = keyName.toUpperCase()
      const detail = document.createElement('small')
      detail.textContent = assignment ? noteName(assignment.note) : (action?.label ?? '—')
      keycap.append(key, detail)
      row.appendChild(keycap)
      computerKeycaps.set(keyName, keycap)
    }
    root.appendChild(row)
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
  svg.setAttribute('viewBox', `0 0 ${bridgeRect.width} ${bridgeRect.height}`)

  for (const assignment of mapping.listComputerKeyAssignments()) {
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
  for (const [key, message] of heldNotes) {
    handleMidiMessage(message, timestamp)
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
  const message = mapping.keyDownMessage(key)
  if (!message) return undefined
  const noteOff = new Uint8Array([0x80 | (message[0]! & 0x0f), message[1]!, 0x40])
  let released = false
  pointerComputerKeys.add(key)
  setComputerKeyActive(key)
  handleMidiMessage(message, performance.now())
  return () => {
    if (released) return
    released = true
    handleMidiMessage(noteOff, performance.now())
    pointerComputerKeys.delete(key)
    setComputerKeyActive(key)
  }
}

function activateComputerMapControl(key: string): boolean {
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
  if (TEXT_INPUT[target.tagName]) return

  const plainShortcut = !ev.ctrlKey && !ev.metaKey && !ev.altKey
  if (plainShortcut && (ev.code === 'KeyA' || ev.code === 'KeyK')) {
    ev.preventDefault()
    if (!ev.repeat) changeOctave(ev.code === 'KeyA' ? -1 : 1)
    return
  }
  if (plainShortcut && (ev.code === 'KeyF' || ev.code === 'Digit4')) {
    ev.preventDefault()
    changeKeyboardVelocity(ev.code === 'KeyF' ? -VELOCITY_STEP : VELOCITY_STEP)
    return
  }
  if (ev.repeat) return

  const key = ev.key.toLowerCase()
  const msg = mapping.keyDownMessage(key)
  if (msg) {
    ev.preventDefault()
    activeComputerNotes.set(key, new Uint8Array([0x80 | (msg[0]! & 0x0f), msg[1]!, 0x40]))
    setComputerKeyActive(key)
    handleMidiMessage(msg, performance.now())
  }
})

window.addEventListener('keyup', (ev) => {
  const target = ev.target as HTMLElement
  if (TEXT_INPUT[target.tagName]) return
  const key = ev.key.toLowerCase()
  const msg = activeComputerNotes.get(key)
  if (!msg) return
  ev.preventDefault()
  activeComputerNotes.delete(key)
  setComputerKeyActive(key)
  handleMidiMessage(msg, performance.now())
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
updateOctaveLabel()
setPlaybackUi(false)
renderMidiState(midiManager.getState())
requestAnimationFrame(updateWorkspaceNavigation)
void initializeComputerMapDisclosure()
builtInSoundFontPromise = loadBuiltInSoundFont()
void builtInSoundFontPromise

// Guard: exported MIDI from a take must re-import — validated by round-trip test in the suite.
