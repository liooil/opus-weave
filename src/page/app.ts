/**
 * OpusWeave — browser-side application.
 * Handles: SoundFont loading, MIDI playback, WebMIDI input monitoring,
 *           performance recording, and MIDI export.
 */
import { WorkletSynthesizer, Sequencer } from 'spessasynth_lib'
import { MIDIBuilder, BasicMIDI, type MIDIController } from 'spessasynth_core'

// ─── Types ───────────────────────────────────────────────────────────────────

interface RecordedEvent {
  deltaMs: number
  data: Uint8Array
}

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

// ─── Global state ────────────────────────────────────────────────────────────

let audioCtx: AudioContext | null = null
let synth: WorkletSynthesizer | null = null
let sequencer: Sequencer | null = null
let soundFontLoaded = false

// Recording state
let midiAccess: MIDIAccess | null = null
let activeInput: MIDIInput | null = null
let isRecording = false
let recordingStart = 0
let recordingLastTime = 0
const recordedEvents: RecordedEvent[] = []

// ─── Audio context / synthesizer init ────────────────────────────────────────

async function ensureAudioCtx(): Promise<WorkletSynthesizer> {
  if (synth) return synth

  audioCtx = new AudioContext()
  await audioCtx.audioWorklet.addModule('/spessasynth_processor.min.js')
  synth = new WorkletSynthesizer(audioCtx)
  synth.connect(audioCtx.destination)
  await synth.isReady
  return synth
}

// ─── SoundFont ───────────────────────────────────────────────────────────────

$<HTMLInputElement>('sf-file').addEventListener('change', async (ev) => {
  const file = (ev.target as HTMLInputElement).files?.[0]
  if (!file) return
  setStatus('sf-status', `Loading ${file.name}…`, 'warn')
  try {
    const buf = await file.arrayBuffer()
    const s = await ensureAudioCtx()
    await s.soundBankManager.addSoundBank(buf, 'main')
    soundFontLoaded = true
    setStatus('sf-status', `Loaded: ${file.name}`, 'ok')
    updatePlayerButtons()
  } catch (err) {
    setStatus('sf-status', `Error: ${String(err)}`, 'err')
  }
})

// ─── MIDI Player ─────────────────────────────────────────────────────────────

let loadedMidi: BasicMIDI | null = null

$<HTMLInputElement>('midi-file').addEventListener('change', async (ev) => {
  const file = (ev.target as HTMLInputElement).files?.[0]
  if (!file) return
  setStatus('midi-status', `Loading ${file.name}…`, 'warn')
  try {
    const buf = await file.arrayBuffer()
    loadedMidi = BasicMIDI.fromArrayBuffer(buf, file.name)
    setStatus('midi-status', `Loaded: ${file.name} (${fmtTime(loadedMidi.duration)})`, 'ok')
    updatePlayerButtons()
  } catch (err) {
    setStatus('midi-status', `Error: ${String(err)}`, 'err')
  }
})

$('btn-play').addEventListener('click', async () => {
  if (!loadedMidi) return
  try {
    const s = await ensureAudioCtx()
    await audioCtx!.resume()
    if (!sequencer) {
      sequencer = new Sequencer(s)
      sequencer.eventHandler.addEvent('timeChange', 'ui', (time: number) => {
        updatePlaybackTime(time)
      })
      sequencer.eventHandler.addEvent('songChange', 'ui', () => {
        updatePlaybackTime(0)
      })
    }
    sequencer.loadNewSongList([{ binary: loadedMidi.writeMIDI(), fileName: loadedMidi.fileName ?? 'song.mid' }])
    sequencer.play()
    updatePlayerButtons()
    startTimePoller()
  } catch (err) {
    setStatus('midi-status', `Playback error: ${String(err)}`, 'err')
  }
})

$('btn-pause').addEventListener('click', () => {
  sequencer?.pause()
  updatePlayerButtons()
})

$('btn-stop').addEventListener('click', () => {
  sequencer?.pause()
  sequencer = null
  updatePlaybackTime(0)
  updatePlayerButtons()
})

$<HTMLInputElement>('playback-speed').addEventListener('input', (ev) => {
  const val = parseFloat((ev.target as HTMLInputElement).value)
  $<HTMLSpanElement>('playback-speed-label').textContent = `${val.toFixed(2)}×`
  if (sequencer) sequencer.playbackRate = val
})

let timePollerActive = false
function startTimePoller(): void {
  if (timePollerActive) return
  timePollerActive = true
  const poll = (): void => {
    if (!sequencer) { timePollerActive = false; return }
    updatePlaybackTime(sequencer.currentTime)
    requestAnimationFrame(poll)
  }
  requestAnimationFrame(poll)
}

function updatePlaybackTime(current: number): void {
  const total = loadedMidi?.duration ?? 0
  $<HTMLSpanElement>('playback-time').textContent = `${fmtTime(current)} / ${fmtTime(total)}`
}

function updatePlayerButtons(): void {
  const hasFile = loadedMidi !== null
  const hasSf = soundFontLoaded
  const playing = sequencer !== null && !sequencer.isFinished
  const paused = sequencer !== null && sequencer.isFinished
  $<HTMLButtonElement>('btn-play').disabled = !(hasFile && hasSf)
  $<HTMLButtonElement>('btn-pause').disabled = !playing
  $<HTMLButtonElement>('btn-stop').disabled = !playing && !paused
}

function fmtTime(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

// ─── WebMIDI ─────────────────────────────────────────────────────────────────

async function initMidi(): Promise<void> {
  if (!navigator.requestMIDIAccess) {
    setStatus('midi-input-status', 'WebMIDI is not supported in this browser.', 'err')
    return
  }
  try {
    midiAccess = await navigator.requestMIDIAccess({ sysex: false })
    midiAccess.onstatechange = () => refreshMidiDevices()
    refreshMidiDevices()
    setStatus('midi-input-status', 'WebMIDI ready.', 'ok')
  } catch (err) {
    setStatus('midi-input-status', `WebMIDI error: ${String(err)}`, 'err')
  }
}

function refreshMidiDevices(): void {
  if (!midiAccess) return
  const sel = $<HTMLSelectElement>('midi-input-select')
  const prev = sel.value
  sel.innerHTML = '<option value="">— no device —</option>'
  for (const [id, input] of midiAccess.inputs) {
    const opt = document.createElement('option')
    opt.value = id
    opt.textContent = input.name ?? id
    sel.appendChild(opt)
  }
  if (prev && midiAccess.inputs.has(prev)) sel.value = prev
}

$<HTMLSelectElement>('midi-input-select').addEventListener('change', (ev) => {
  const id = (ev.target as HTMLSelectElement).value
  // Disconnect previous
  if (activeInput) activeInput.onmidimessage = null
  activeInput = null
  if (id && midiAccess) {
    activeInput = midiAccess.inputs.get(id) ?? null
    if (activeInput) {
      activeInput.onmidimessage = onMidiMessage
      setStatus('midi-input-status', `Connected: ${activeInput.name}`, 'ok')
      $<HTMLButtonElement>('btn-record').disabled = false
      return
    }
  }
  setStatus('midi-input-status', 'No device selected.', '')
  $<HTMLButtonElement>('btn-record').disabled = true
})

$('btn-refresh-midi').addEventListener('click', () => { void initMidi() })

// ─── MIDI monitor ─────────────────────────────────────────────────────────────

const MAX_MONITOR_LINES = 80

function onMidiMessage(ev: MIDIMessageEvent): void {
  const data = ev.data
  if (!data || data.length === 0) return

  // Route to synth for live play-through (if soundfont loaded)
  if (synth && soundFontLoaded) {
    const status = data[0]! & 0xf0
    const channel = data[0]! & 0x0f
    if (status === 0x90 && data[2] !== 0) synth.noteOn(channel, data[1]!, data[2]!)
    else if (status === 0x80 || (status === 0x90 && data[2] === 0)) synth.noteOff(channel, data[1]!)
    else if (status === 0xb0) synth.controllerChange(channel, data[1]! as MIDIController, data[2]!)
    else if (status === 0xe0) synth.pitchWheel(channel, ((data[2]! << 7) | data[1]!) - 8192)
    else if (status === 0xc0) synth.programChange(channel, data[1]!)
  }

  // Record
  if (isRecording) {
    const now = performance.now()
    recordedEvents.push({ deltaMs: now - recordingLastTime, data: Uint8Array.from(data) })
    recordingLastTime = now
  }

  // Monitor display
  appendMonitorLine(data)
}

function appendMonitorLine(data: Uint8Array): void {
  const monitor = $<HTMLDivElement>('midi-monitor')
  const status = data[0]! & 0xf0
  const channel = (data[0]! & 0x0f) + 1
  let cssClass = 'msg-other'
  let text = ''

  if (status === 0x90 && data[2] !== 0) {
    cssClass = 'msg-noteon'
    text = `NOTE ON  ch${channel}  note=${data[1]!}  vel=${data[2]!}`
  } else if (status === 0x80 || (status === 0x90 && data[2] === 0)) {
    cssClass = 'msg-noteoff'
    text = `NOTE OFF ch${channel}  note=${data[1]!}`
  } else if (status === 0xb0) {
    cssClass = 'msg-cc'
    text = `CC       ch${channel}  cc=${data[1]!}  val=${data[2]!}`
  } else if (status === 0xe0) {
    cssClass = 'msg-pb'
    const pb = ((data[2]! << 7) | data[1]!) - 8192
    text = `PITCH BND ch${channel}  val=${pb}`
  } else {
    text = Array.from(data).map(b => b.toString(16).padStart(2, '0')).join(' ')
  }

  const div = document.createElement('div')
  div.className = cssClass
  div.textContent = text
  monitor.prepend(div)

  // Limit lines
  while (monitor.children.length > MAX_MONITOR_LINES) {
    monitor.lastElementChild?.remove()
  }
}

// ─── Recording ────────────────────────────────────────────────────────────────

$('btn-record').addEventListener('click', () => {
  if (!activeInput) return
  recordedEvents.length = 0
  recordingStart = performance.now()
  recordingLastTime = recordingStart
  isRecording = true
  $<HTMLButtonElement>('btn-record').disabled = true
  $<HTMLButtonElement>('btn-record-stop').disabled = false
  setStatus('record-status', '● Recording…', 'warn')
})

$('btn-record-stop').addEventListener('click', () => {
  isRecording = false
  $<HTMLButtonElement>('btn-record').disabled = false
  $<HTMLButtonElement>('btn-record-stop').disabled = true
  $<HTMLButtonElement>('btn-record-export').disabled = recordedEvents.length === 0
  setStatus('record-status', `Stopped. ${recordedEvents.length} event(s) recorded.`, 'ok')
})

$('btn-record-export').addEventListener('click', () => {
  const midi = buildRecordingMidi()
  const buf = midi.writeMIDI()
  downloadBuffer(buf, 'recording.mid', 'audio/midi')
})

/**
 * Convert recorded events (with real-time deltas) into a MIDI Type 0 file.
 * Uses a tempo of 120 BPM and 480 ticks/quarter, so 1 beat = 500 ms = 480 ticks.
 * tick = deltaMs / 500 * 480
 */
function buildRecordingMidi(): MIDIBuilder {
  const builder = new MIDIBuilder({ timeDivision: 480, initialTempo: 120, format: 0, name: 'OpusWeave Recording' })
  builder.addTrack('Recording', 0)
  const TICKS_PER_MS = 480 / 500 // 480 ticks per 500 ms (120 BPM)
  let absoluteTick = 0
  for (const ev of recordedEvents) {
    absoluteTick += Math.max(0, Math.round(ev.deltaMs * TICKS_PER_MS))
    const status = ev.data[0]! & 0xf0
    const channel = ev.data[0]! & 0x0f
    if (status === 0x90 && ev.data.length >= 3) {
      builder.noteOn(absoluteTick, 1, channel, ev.data[1]!, ev.data[2]!)
    } else if (status === 0x80 && ev.data.length >= 3) {
      builder.noteOff(absoluteTick, 1, channel, ev.data[1]!, ev.data[2]!)
    } else if (status === 0xb0 && ev.data.length >= 3) {
      builder.controllerChange(absoluteTick, 1, channel, ev.data[1]!, ev.data[2]!)
    } else if (status === 0xe0 && ev.data.length >= 3) {
      const pb = (ev.data[2]! << 7) | ev.data[1]!
      builder.pitchWheel(absoluteTick, 1, channel, pb)
    }
  }
  return builder
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

// ─── Boot ─────────────────────────────────────────────────────────────────────

void initMidi()
updatePlayerButtons()
