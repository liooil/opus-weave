/**
 * OpusWeave browser app — orchestrates the engine, WebMIDI manager,
 * recorder, mapping engine and MIDI learn. No layer reaches into
 * spessasynth classes directly (the engine wraps them).
 */
import { SpessaSynthEngine } from '../audio/spessa-synth-engine.ts'
import { selectAudioOutputDevice, type AudioOutputDevice, type SavedAudioOutput } from '../audio/audio-output.ts'
import { WebMidiManager, type MidiManagerState } from '../midi/web-midi-manager.ts'
import { MidiRecorder, takeToMidi, type RecordedTake } from '../domain/midi/midi-recorder.ts'
import { applyTrackMutes, importMidi, inspectMidi, type MidiInspection } from '../domain/midi/midi-import.ts'
import { MappingEngine, noteName } from '../domain/devices/mapping-engine.ts'
import { MidiLearn } from '../domain/midi-learn.ts'
import { findProfileForPort, overrideControl, type DeviceProfile } from '../domain/devices/device-profile.ts'
import { midiplusTinyPlusProfile } from '../domain/devices/midiplus-tiny-plus.ts'
import { VirtualKeyboard } from './components/virtual-keyboard.ts'
import type { BasicMIDI } from 'spessasynth_core'
import { resolveLocale, setLocale, t, translateDocument, type TranslationValues } from './i18n.ts'
import { compileScoreText, midiToTake, quantizeTake, recordedTakeToOwt, takeToMidi as owtTakeToMidi } from '../domain/owt/integration.ts'
import { parseOwt } from '../domain/owt/parser.ts'
import { parseRational, rational } from '../domain/owt/rational.ts'
import { serializeOwt, serializeScore, serializeTake } from '../domain/owt/serializer.ts'
import type { OwtDocument, OwtTake } from '../domain/owt/ast.ts'
import builtInSoundFontUrl from './assets/opusweave-micro-gm.sf2' with { type: 'file' }

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

const localeSelect = $<HTMLSelectElement>('language-select')
const initialLocale = resolveLocale(window.localStorage.getItem('opusweave.locale') ?? navigator.language)
setLocale(initialLocale)
localeSelect.value = initialLocale
translateDocument()
retranslateTrackedCopy()

localeSelect.addEventListener('change', () => {
  const locale = resolveLocale(localeSelect.value)
  setLocale(locale)
  window.localStorage.setItem('opusweave.locale', locale)
  translateDocument()
  retranslateTrackedCopy()
  renderMidiState(midiManager.getState())
  renderTrackList()
  renderLearnBindings()
  populatePresets()
  void refreshAudioOutputs(false)
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

title "New Score"
ppq 480
meter 1:1 4/4
tempo 1:1 120
key 1:1 C major

track "Piano" channel=1 program=0 velocity=88

| C4:1 E4:1 G4:1 C5:1 |

end
`

// ─── State ───────────────────────────────────────────────────────────────────

let engine: SpessaSynthEngine | null = null
let builtInSoundFontPromise: Promise<void> | null = null
const BUILT_IN_SOUND_FONT_NAME = 'OpusWeave Micro GM'
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

// Virtual keyboard — starts at the TINY+ range, widens when a MIDI loads.
const keyboard = new VirtualKeyboard($('virtual-keyboard'), {
  minNote: 36,
  maxNote: 67,
  onNoteOn: (note) => handleMidiMessage(new Uint8Array([0x90, note, mapping.fixedVelocity]), performance.now()),
  onNoteOff: (note) => handleMidiMessage(new Uint8Array([0x80, note, 0x40]), performance.now()),
})

// ─── Audio engine (lazy, user-gesture created) ───────────────────────────────

async function ensureEngine(): Promise<SpessaSynthEngine> {
  if (engine) return engine
  engine = new SpessaSynthEngine(undefined, '/spessasynth_processor.min.js', {
    onPlaybackTime: (time, duration) => {
      $<HTMLProgressElement>('progress').value = duration > 0 ? (time / duration) * 1000 : 0
      $<HTMLSpanElement>('playback-time').textContent = `${fmtTime(time)} / ${fmtTime(duration)}`
    },
    onPlaybackEnded: () => {
      setPlaybackUi(false)
      setTranslatedStatus('midi-status', 'playback.finished', {}, 'ok')
    },
    onPlaybackState: (playing) => setPlaybackUi(playing),
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
    apply: () => { mapping.shiftOctave(1); updateOctaveLabel() },
  })
  midiLearn.register({
    id: 'octave-down',
    label: t('params.octaveDown'),
    apply: () => { mapping.shiftOctave(-1); updateOctaveLabel() },
  })
  return engine
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
    keyboard.setPressed(note, true)
  } else if (status === 0x80 || (status === 0x90 && vel === 0)) {
    const entry = liveNotes.get(note)
    if (entry) {
      entry.count = Math.max(0, entry.count - 1)
      if (entry.count === 0) {
        entry.el.remove()
        liveNotes.delete(note)
        keyboard.setPressed(note, false)
      }
    }
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
    const response = await fetch(builtInSoundFontUrl)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const e = await ensureEngine()
    const info = await e.loadSoundBank(await response.arrayBuffer(), BUILT_IN_SOUND_FONT_NAME)
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

async function loadMidiData(buffer: ArrayBuffer, fileName: string): Promise<void> {
  loadedMidi = importMidi(buffer, fileName)
  loadedInspection = inspectMidi(buffer, fileName)
  mutedTracks.clear()
  $<HTMLSpanElement>('st-file').textContent = fileName
  renderTrackList()
  const tempo = loadedInspection.tempos[0]?.bpm ?? 120
  $<HTMLSpanElement>('playback-tempo').textContent = `♩ ${tempo} BPM`
  const range = loadedInspection.tracks.flatMap((track) =>
    track.minNote !== null && track.maxNote !== null ? [track.minNote, track.maxNote] : [],
  )
  if (range.length >= 2) keyboard.setRange(Math.min(...range), Math.max(...range))
  setTranslatedStatus('midi-status', 'playback.loaded', {
    file: fileName,
    duration: fmtTime(loadedInspection.durationSeconds),
  }, 'ok')
  setPlaybackUi(false)
  updateOwtSourceButtons()
}

$<HTMLInputElement>('midi-file').addEventListener('change', async (ev) => {
  const file = (ev.target as HTMLInputElement).files?.[0]
  if (!file) return
  setTranslatedStatus('midi-status', 'playback.loading', { file: file.name }, 'warn')
  try {
    await loadMidiData(await file.arrayBuffer(), file.name)
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
    setTranslatedStatus('midi-status', 'playback.playing')
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
  setTranslatedStatus('midi-status', 'playback.playing')
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
  updateOwtSourceButtons()
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
  updateOwtSourceButtons()
})

$('btn-clear-take').addEventListener('click', () => {
  recorder.clear()
  take = null
  $<HTMLButtonElement>('btn-clear-take').disabled = true
  $<HTMLButtonElement>('btn-play-take').disabled = true
  $<HTMLButtonElement>('btn-record-export').disabled = true
  setTranslatedStatus('record-status', 'record.cleared')
  updateOwtSourceButtons()
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


// ─── OpusWeave Text workspace ────────────────────────────────────────────────

function updateOwtSourceButtons(): void {
  $<HTMLButtonElement>('btn-owt-from-midi').disabled = loadedMidi === null
  $<HTMLButtonElement>('btn-owt-from-recording').disabled = take === null || take.events.length === 0
}

function refreshOwtKind(document?: OwtDocument): void {
  const kind = document?.kind ?? (/^\s*owt\s+0\.1\s+take\b/m.test($<HTMLTextAreaElement>('owt-editor').value) ? 'take' : 'score')
  const badge = $('owt-kind')
  badge.textContent = kind.toUpperCase()
  badge.classList.toggle('take', kind === 'take')
  $<HTMLButtonElement>('btn-owt-quantize').disabled = kind !== 'take'
}

function renderOwtDiagnostics(diagnostics: Array<{ line: number; column: number; severity: string; code: string; message: string }>): void {
  const box = $('owt-diagnostics')
  box.innerHTML = ''
  for (const diagnostic of diagnostics) {
    const row = document.createElement('div')
    row.className = `owt-diagnostic${diagnostic.severity === 'warning' ? ' warning' : ''}`
    row.textContent = `${diagnostic.line}:${diagnostic.column} [${diagnostic.code}] ${diagnostic.message}`
    box.appendChild(row)
  }
}

function parseEditorOwt(): OwtDocument | null {
  const result = parseOwt($<HTMLTextAreaElement>('owt-editor').value)
  renderOwtDiagnostics(result.diagnostics)
  refreshOwtKind(result.document)
  if (!result.document) {
    setTranslatedStatus('owt-status', 'owt.invalid', { count: result.diagnostics.filter((item) => item.severity === 'error').length }, 'err')
    return null
  }
  return result.document
}

function owtFileName(document: OwtDocument, extension: 'owt' | 'mid'): string {
  const title = document.title?.trim() || (document.kind === 'score' ? 'opusweave-score' : 'opusweave-take')
  const safe = title.replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '') || `opusweave-${document.kind}`
  return `${safe}.${extension}`
}

function validateEditorOwt(): OwtDocument | null {
  const document = parseEditorOwt()
  if (!document) return null
  if (document.kind === 'score') {
    const compiled = compileScoreText($<HTMLTextAreaElement>('owt-editor').value)
    const notes = compiled.spec.tracks.reduce((sum, track) => sum + track.notes.length, 0)
    const beats = compiled.spec.tracks.reduce((maximum, track) => Math.max(maximum, ...track.notes.map((note) => note.startBeat + note.durationBeats), 0), 0)
    setTranslatedStatus('owt-status', 'owt.validScore', { tracks: compiled.spec.tracks.length, notes, beats }, 'ok')
  } else {
    const duration = document.events.reduce((maximum, event) => Math.max(maximum, event.kind === 'note' ? event.atMs + event.durationMs : event.atMs), 0)
    setTranslatedStatus('owt-status', 'owt.validTake', { events: document.events.length, duration: duration.toFixed(3) }, 'ok')
  }
  return document
}

function parseQuantizeGrid(text: string) {
  const fraction = parseRational(text)
  if (!fraction || fraction.numerator <= 0) throw new Error(`invalid grid: ${text}`)
  return rational(fraction.numerator * 4, fraction.denominator)
}

function parseQuantizeMeter(text: string): { numerator: number; denominator: number } {
  const match = /^(\d+)\/(\d+)$/.exec(text.trim())
  if (!match) throw new Error(`invalid meter: ${text}`)
  const numerator = Number(match[1])
  const denominator = Number(match[2])
  if (numerator < 1 || denominator < 1 || (denominator & (denominator - 1)) !== 0) throw new Error(`invalid meter: ${text}`)
  return { numerator, denominator }
}

$<HTMLTextAreaElement>('owt-editor').addEventListener('input', () => refreshOwtKind())

$('btn-owt-validate').addEventListener('click', () => {
  try {
    validateEditorOwt()
  } catch (err) {
    setTranslatedStatus('owt-status', 'owt.error', { error: err instanceof Error ? err.message : String(err) }, 'err')
  }
})

$('btn-owt-format').addEventListener('click', () => {
  const document = parseEditorOwt()
  if (!document) return
  $<HTMLTextAreaElement>('owt-editor').value = serializeOwt(document)
  renderOwtDiagnostics([])
  refreshOwtKind(document)
  setTranslatedStatus('owt-status', 'owt.formatted', {}, 'ok')
})

$('btn-owt-play').addEventListener('click', async () => {
  const document = parseEditorOwt()
  if (!document) return
  try {
    const midi = document.kind === 'score'
      ? compileScoreText($<HTMLTextAreaElement>('owt-editor').value).midi
      : owtTakeToMidi(document)
    const fileName = owtFileName(document, 'mid')
    await loadMidiData(midi, fileName)
    const e = await ensureEngine()
    await e.playMidi(midi, fileName)
    setTranslatedStatus('owt-status', 'owt.playing', { kind: document.kind.toUpperCase() }, 'ok')
    setTranslatedStatus('midi-status', 'playback.playing')
  } catch (err) {
    setTranslatedStatus('owt-status', 'owt.error', { error: err instanceof Error ? err.message : String(err) }, 'err')
  }
})

$('btn-owt-export-midi').addEventListener('click', () => {
  const document = parseEditorOwt()
  if (!document) return
  try {
    const midi = document.kind === 'score'
      ? compileScoreText($<HTMLTextAreaElement>('owt-editor').value).midi
      : owtTakeToMidi(document)
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

$<HTMLInputElement>('owt-file').addEventListener('change', async (event) => {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  $<HTMLTextAreaElement>('owt-editor').value = await file.text()
  refreshOwtKind()
  setTranslatedStatus('owt-status', 'owt.loaded', { file: file.name }, 'ok')
  validateEditorOwt()
})

$('btn-owt-new-score').addEventListener('click', () => {
  $<HTMLTextAreaElement>('owt-editor').value = DEFAULT_OWT_SCORE
  renderOwtDiagnostics([])
  refreshOwtKind()
  setTranslatedStatus('owt-status', 'owt.newReady', {}, 'ok')
})

$('btn-owt-from-midi').addEventListener('click', () => {
  if (!loadedMidi) {
    setTranslatedStatus('owt-status', 'owt.sourceMissing', {}, 'warn')
    return
  }
  const title = $<HTMLElement>('st-file').textContent || 'Current MIDI'
  const exactTake = midiToTake(loadedMidi.writeMIDI(), { title, source: title })
  $<HTMLTextAreaElement>('owt-editor').value = serializeTake(exactTake)
  renderOwtDiagnostics([])
  refreshOwtKind(exactTake)
  setTranslatedStatus('owt-status', 'owt.midiImported', {}, 'ok')
})

$('btn-owt-from-recording').addEventListener('click', () => {
  if (!take || take.events.length === 0) {
    setTranslatedStatus('owt-status', 'owt.sourceMissing', {}, 'warn')
    return
  }
  const state = midiManager.getState()
  const source = state.inputs.find((input) => input.id === state.selectedInputId)?.name
  const exactTake = recordedTakeToOwt(take, { title: 'OpusWeave Recording', source })
  $<HTMLTextAreaElement>('owt-editor').value = serializeTake(exactTake)
  renderOwtDiagnostics([])
  refreshOwtKind(exactTake)
  setTranslatedStatus('owt-status', 'owt.recordingImported', {}, 'ok')
})

$('btn-owt-quantize').addEventListener('click', () => {
  const document = parseEditorOwt()
  if (!document) return
  if (document.kind !== 'take') {
    setTranslatedStatus('owt-status', 'owt.takeRequired', {}, 'warn')
    return
  }
  try {
    const gridText = $<HTMLInputElement>('owt-grid').value.trim()
    const bpm = Number($<HTMLInputElement>('owt-bpm').value)
    const meter = parseQuantizeMeter($<HTMLInputElement>('owt-meter').value)
    const score = quantizeTake(document, { grid: parseQuantizeGrid(gridText), bpm, meter })
    $<HTMLTextAreaElement>('owt-editor').value = serializeScore(score)
    renderOwtDiagnostics([])
    refreshOwtKind(score)
    setTranslatedStatus('owt-status', 'owt.quantized', { grid: gridText }, 'ok')
  } catch (err) {
    setTranslatedStatus('owt-status', 'owt.error', { error: err instanceof Error ? err.message : String(err) }, 'err')
  }
})
// ─── Computer keyboard (MappingEngine) ───────────────────────────────────────

const TEXT_INPUT: Record<string, true> = { INPUT: true, TEXTAREA: true, SELECT: true }

window.addEventListener('keydown', (ev) => {
  const target = ev.target as HTMLElement
  if (TEXT_INPUT[target.tagName]) return
  if (ev.repeat) return
  const msg = mapping.keyDownMessage(ev.key.toLowerCase())
  if (msg) {
    ev.preventDefault()
    handleMidiMessage(msg, performance.now())
  }
})

window.addEventListener('keyup', (ev) => {
  const target = ev.target as HTMLElement
  if (TEXT_INPUT[target.tagName]) return
  const msg = mapping.keyUpMessage(ev.key.toLowerCase())
  if (msg) handleMidiMessage(msg, performance.now())
})

$('oct-up').addEventListener('click', () => {
  mapping.shiftOctave(1)
  updateOctaveLabel()
})
$('oct-down').addEventListener('click', () => {
  mapping.shiftOctave(-1)
  updateOctaveLabel()
})

function updateOctaveLabel(): void {
  $<HTMLSpanElement>('oct-label').textContent = String(mapping.currentOctaveShift / 12)
}

$<HTMLInputElement>('key-velocity').addEventListener('change', (ev) => {
  mapping.setVelocity(Number((ev.target as HTMLInputElement).value))
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
$<HTMLTextAreaElement>('owt-editor').value = DEFAULT_OWT_SCORE
refreshOwtKind()
updateOwtSourceButtons()
renderMidiState(midiManager.getState())
builtInSoundFontPromise = loadBuiltInSoundFont()
void builtInSoundFontPromise.then(() => refreshAudioOutputs(true))

void fetch('/api/startup-midi').then(async (response) => {
  if (response.status === 204 || !response.ok) return
  const encodedTitle = response.headers.get('x-opusweave-title') ?? 'OWT Score'
  const title = decodeURIComponent(encodedTitle)
  await loadMidiData(await response.arrayBuffer(), `${title}.mid`)
  setTranslatedStatus('midi-status', 'playback.clickToStart', {}, 'warn')
  window.addEventListener('pointerdown', () => $<HTMLButtonElement>('btn-play').click(), { once: true, capture: true })
}).catch((err: unknown) => {
  setTranslatedStatus('midi-status', 'playback.error', { error: err instanceof Error ? err.message : String(err) }, 'err')
})

// Guard: exported MIDI from a take must re-import — validated by round-trip test in the suite.
