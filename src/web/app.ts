/**
 * OpusWeave browser app — orchestrates the engine, WebMIDI manager,
 * recorder, mapping engine and MIDI learn. No layer reaches into
 * spessasynth classes directly (the engine wraps them).
 */
import { SpessaSynthEngine } from '../audio/spessa-synth-engine.ts'
import { WebMidiManager, type MidiManagerState } from '../midi/web-midi-manager.ts'
import { MidiRecorder, takeToMidi, type RecordedTake } from '../domain/midi/midi-recorder.ts'
import { applyTrackMutes, importMidi, inspectMidi, type MidiInspection } from '../domain/midi/midi-import.ts'
import { MappingEngine, noteName } from '../domain/devices/mapping-engine.ts'
import { MidiLearn } from '../domain/midi-learn.ts'
import { findProfileForPort, overrideControl, type DeviceProfile } from '../domain/devices/device-profile.ts'
import { midiplusTinyPlusProfile } from '../domain/devices/midiplus-tiny-plus.ts'
import { VirtualKeyboard } from './components/virtual-keyboard.ts'
import type { BasicMIDI } from 'spessasynth_core'

// ─── DOM helpers ─────────────────────────────────────────────────────────────

function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id)
  if (!el) throw new Error(`Element #${id} not found`)
  return el as unknown as T
}

function setStatus(id: string, msg: string, kind: 'ok' | 'warn' | 'err' | '' = ''): void {
  const el = $<HTMLElement>(id)
  el.textContent = msg
  el.className = `status${kind ? ` ${kind}` : ''}`
}

function showError(msg: string): void {
  const box = $<HTMLDivElement>('st-error')
  box.textContent = msg
  box.hidden = false
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

// ─── State ───────────────────────────────────────────────────────────────────

let engine: SpessaSynthEngine | null = null
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
/** User remaps for profile controls: controlId -> mapping (persisted). */
let profileOverrides: Record<string, { controller: number }> = {}

try {
  profileOverrides = JSON.parse(window.localStorage.getItem('opusweave.profile.overrides') ?? '{}') as Record<string, { controller: number }>
} catch {
  profileOverrides = {}
}

const midiManager = new WebMidiManager(window.localStorage)

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
      setStatus('midi-status', 'Playback finished.', 'ok')
    },
    onPlaybackState: (playing) => setPlaybackUi(playing),
    onSoundFontLoaded: (info) => {
      $<HTMLSpanElement>('st-soundfont').textContent = `${info.name} (${info.presetCount} presets)`
    },
    onError: (msg) => showError(msg),
  })
  await engine.ensureReady()
  $<HTMLSpanElement>('st-audio').textContent = engine ? 'ready' : '—'
  // Register learnable parameters against the engine.
  midiLearn.register({
    id: 'master-volume',
    label: 'Master volume',
    apply: (v) => engine?.setMasterVolume(v / 127),
  })
  midiLearn.register({
    id: 'synth-panic',
    label: 'Panic',
    apply: () => engine?.panic(),
  })
  midiLearn.register({
    id: 'octave-up',
    label: 'Octave up',
    apply: () => { mapping.shiftOctave(1); updateOctaveLabel() },
  })
  midiLearn.register({
    id: 'octave-down',
    label: 'Octave down',
    apply: () => { mapping.shiftOctave(-1); updateOctaveLabel() },
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
      setStatus('learn-status', `Bound ${binding.paramLabel} ← ${binding.kind} ${binding.controller ?? binding.note ?? ''}`, 'ok')
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
  $<HTMLSpanElement>('st-midi').textContent = state.supported ? 'supported' : 'not supported'
  $<HTMLSpanElement>('st-perm').textContent = state.permissionGranted ? 'granted' : state.error ? 'denied' : 'not requested'
  if (state.error) showError(state.error)

  // Input dropdown
  const sel = $<HTMLSelectElement>('midi-input-select')
  const prev = sel.value
  sel.innerHTML = '<option value="">— no device —</option>'
  for (const p of state.inputs) {
    const opt = document.createElement('option')
    opt.value = p.id
    opt.textContent = `${p.name}${isVirtual(p) ? ' (virtual)' : ''}`
    sel.appendChild(opt)
  }
  if (state.selectedInputId && state.inputs.some((p) => p.id === state.selectedInputId)) sel.value = state.selectedInputId
  else if (prev && state.inputs.some((p) => p.id === prev)) sel.value = prev
  $<HTMLSpanElement>('st-input').textContent = state.inputNote || (state.selectedInputId ? 'connected' : '—')
  if (state.inputNote) setStatus('learn-status', state.inputNote, 'warn')

  // Output dropdown
  const outSel = $<HTMLSelectElement>('midi-output-select')
  const prevOut = outSel.value
  outSel.innerHTML = '<option value="">— no device —</option>'
  for (const p of state.outputs) {
    const opt = document.createElement('option')
    opt.value = p.id
    opt.textContent = `${p.name}${isVirtual(p) ? ' (virtual)' : ''}`
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
  $<HTMLElement>('profile-name').textContent = `${activeProfile.name} — matched ${port!.name}`
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
      setStatus('learn-status', `${activeProfile!.name}: ${id} remapped to CC${v}`, 'ok')
    })
    label.appendChild(input)
    controls.appendChild(label)
  }
}

// ─── SoundFont ───────────────────────────────────────────────────────────────

$<HTMLInputElement>('sf-file').addEventListener('change', async (ev) => {
  const file = (ev.target as HTMLInputElement).files?.[0]
  if (!file) return
  setStatus('sf-status', `Loading ${file.name}…`, 'warn')
  try {
    const e = await ensureEngine()
    const info = await e.loadSoundBank(await file.arrayBuffer(), file.name)
    setStatus('sf-status', `Loaded: ${info.name} (${info.presetCount} presets)`, 'ok')
    populatePresets()
  } catch (err) {
    setStatus('sf-status', `Error: ${err instanceof Error ? err.message : String(err)}`, 'err')
  }
})

function populatePresets(): void {
  const sel = $<HTMLSelectElement>('preset-select')
  sel.disabled = true
  sel.innerHTML = '<option value="">— presets —</option>'
  if (!engine) return
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
  setStatus('midi-status', `Loading ${file.name}…`, 'warn')
  try {
    const buf = await file.arrayBuffer()
    loadedMidi = importMidi(buf, file.name)
    loadedInspection = inspectMidi(buf, file.name)
    mutedTracks.clear()
    $<HTMLSpanElement>('st-file').textContent = file.name
    renderTrackList()
    const tempo = loadedInspection.tempos[0]?.bpm ?? 120
    $<HTMLSpanElement>('playback-tempo').textContent = `♩ ${tempo} BPM`
    const range = loadedInspection.tracks.flatMap((t) => (t.minNote !== null && t.maxNote !== null ? [t.minNote, t.maxNote] : []))
    if (range.length >= 2) keyboard.setRange(Math.min(...range), Math.max(...range))
    setStatus('midi-status', `Loaded: ${file.name} (${fmtTime(loadedInspection.durationSeconds)})`, 'ok')
    setPlaybackUi(false)
  } catch (err) {
    setStatus('midi-status', `Error: ${err instanceof Error ? err.message : String(err)}`, 'err')
  }
})

function renderTrackList(): void {
  const list = $<HTMLDivElement>('track-list')
  list.innerHTML = ''
  if (!loadedInspection) return
  for (const t of loadedInspection.tracks) {
    const row = document.createElement('div')
    row.className = `track-row${mutedTracks.has(t.index) ? ' muted' : ''}`
    const muteBtn = document.createElement('button')
    muteBtn.className = 'mute-btn'
    muteBtn.textContent = mutedTracks.has(t.index) ? '🔇 Unmute' : '🔊 Mute'
    muteBtn.addEventListener('click', () => {
      if (mutedTracks.has(t.index)) mutedTracks.delete(t.index)
      else mutedTracks.add(t.index)
      renderTrackList()
    })
    const name = document.createElement('span')
    name.className = 'track-name'
    name.textContent = t.name || `Track ${t.index}`
    const meta = document.createElement('span')
    meta.className = 'track-meta'
    meta.textContent = `ch${t.channels.join(',') || '—'} prog${t.program ?? '—'} ${t.noteCount} notes${t.hasControlChanges ? ' cc' : ''}${t.hasPitchBend ? ' pb' : ''}`
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
    setStatus('midi-status', `Playback error: ${err instanceof Error ? err.message : String(err)}`, 'err')
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
  $<HTMLSpanElement>('st-record').textContent = 'recording'
  setStatus('record-status', '● Recording… (hardware keyboard or computer keyboard)', 'warn')
})

$('btn-record-stop').addEventListener('click', () => {
  take = recorder.stop(performance.now())
  const hasEvents = take.events.length > 0
  $<HTMLButtonElement>('btn-record').disabled = false
  $<HTMLButtonElement>('btn-record-stop').disabled = true
  $<HTMLButtonElement>('btn-clear-take').disabled = !hasEvents
  $<HTMLButtonElement>('btn-play-take').disabled = !hasEvents
  $<HTMLButtonElement>('btn-record-export').disabled = !hasEvents
  $<HTMLSpanElement>('st-record').textContent = 'idle'
  setStatus('record-status', `Stopped. ${take.events.length} event(s), ${(take.durationMs / 1000).toFixed(2)}s.`, 'ok')
})

$('btn-clear-take').addEventListener('click', () => {
  recorder.clear()
  take = null
  $<HTMLButtonElement>('btn-clear-take').disabled = true
  $<HTMLButtonElement>('btn-play-take').disabled = true
  $<HTMLButtonElement>('btn-record-export').disabled = true
  setStatus('record-status', 'Take cleared.', '')
})

$('btn-play-take').addEventListener('click', async () => {
  if (!take || take.events.length === 0) return
  const buf = takeToMidi(take)
  try {
    const e = await ensureEngine()
    if (!e.hasSoundFont()) {
      setStatus('record-status', 'Load a SoundFont first — the take has no sound without one.', 'warn')
      return
    }
    playingTake = true
    await e.playMidi(buf, 'take.mid')
    setStatus('record-status', 'Playing take…', '')
  } catch (err) {
    setStatus('record-status', `Take playback error: ${err instanceof Error ? err.message : String(err)}`, 'err')
  }
  playingTake = false
})

$('btn-record-export').addEventListener('click', () => {
  if (!take) return
  const buf = takeToMidi(take)
  downloadBuffer(buf, 'opusweave-recording.mid', 'audio/midi')
  setStatus('record-status', 'Exported opusweave-recording.mid (re-import it to play).', 'ok')
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
      setStatus('learn-status', `Learning: move a control on your device to bind "${midiLearn.armedParamLabel}".`, 'warn')
    })
  })
})

function renderLearnBindings(): void {
  const list = $<HTMLUListElement>('learn-bindings')
  list.innerHTML = ''
  for (const b of midiLearn.listBindings()) {
    const li = document.createElement('li')
    li.textContent = `${b.paramLabel} ← ${b.kind} ${b.controller ?? b.note ?? ''}${b.deviceName ? ` (${b.deviceName})` : ''}`
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
void ensureEngine().then(() => {
  $<HTMLSpanElement>('st-audio').textContent = 'ready (click Play to start audio)'
})

// Guard: exported MIDI from a take must re-import — validated by round-trip test in the suite.
